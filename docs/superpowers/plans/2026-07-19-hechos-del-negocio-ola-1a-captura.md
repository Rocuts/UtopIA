# Hechos del negocio — Ola 1 · Team A (Captura) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Que el chat orquestado pueda **registrar hechos duraderos del negocio** (donaciones, etc.) vía una tool `registrar_hecho_negocio`, con confirmación humana previa y persistencia determinista a través del handler de Ola 0.

**Architecture:** Se añade una tool AI SDK al registry de especialistas (`src/lib/agents/tools/registry.ts`), cuya `execute` delega al dispatcher `executeTool`, que llama al `reconcileFact` de Ola 0. La seguridad (solo tras confirmación, sesgo NOOP) vive en el prompt; la **validación dura** (kinds materiales exigen `fiscalPeriod` no-nulo) vive en un guard puro server-side. `workspaceId` llega vía `ctx.workspaceId` del `experimental_context`.

**Tech Stack:** AI SDK v6 (`tool`, `ToolLoopAgent`) · Zod · Vitest · TypeScript.

## Global Constraints

- **Reutiliza los contratos de Ola 0:** `registrarHechoInputSchema` / `RegistrarHechoInput` / `FactContent` de `@/lib/facts/contracts`; `reconcileFact` de `@/lib/db/facts`. No redefinir shapes.
- **MoneyCop:** `montoCentavos` viaja como **string en CENTAVOS** (50 millones de pesos = `"5000000000"`). La descripción de la tool DEBE dejarlo explícito o el LLM pasará pesos (error de 100×).
- **CRÍTICO (handoff del review final de Ola 0):** un `kind` fiscalmente material (`donation`/`leasing`/`loss_carryforward`) con `fiscalPeriod` nulo se RECHAZA — ni schema ni índice lo atrapan, va en el guard del handler. Solo `narrative` admite período nulo.
- **`server-only`:** `@/lib/db/facts` es server-only; en `registry.ts` se importa **dinámicamente** (`await import`) dentro del `case`, igual que ya se hace con `@/lib/tools/erp-query`.
- **Tenancy:** el handler resuelve `workspaceId` desde `ctx.workspaceId` (cookie, server-side). Si falta, la tool devuelve error y NO persiste.
- **Sin infra nueva:** el loop de tool-calling ya existe (`BaseSpecialist` → `getToolsForAgent` → `stopWhen`). Solo se añade la tool + su dispatch + su registro por-agente + la guía en prompts.

---

## File Structure

| Archivo | Responsabilidad | Task |
|---|---|---|
| `src/lib/facts/tool-guards.ts` (crear) | Guard PURO `assertFactInputValid(input)` → mensaje de error o null (enforcement kinds materiales) | A1 |
| `src/lib/facts/__tests__/tool-guards.test.ts` (crear) | Unit tests del guard | A1 |
| `src/lib/agents/tools/registry.ts` (modificar) | Definición de la tool `REGISTRAR_HECHO` + `case 'registrar_hecho_negocio'` en `executeTool` + alta en `AGENT_TOOLS` (tax/accounting/strategy) | A2 |
| `src/lib/agents/prompts/fragments/facts-capture.fragment.ts` (crear) | Guardrail compartido (ES/EN): flujo proponer→confirmar→llamar, sesgo NOOP | A3 |
| `src/lib/agents/prompts/{tax,accounting,strategy}-agent.prompt.ts` (modificar) | Inyectar el fragmento en cada prompt builder | A3 |

---

## Task A1: Guard puro de validación de input

**Files:**
- Create: `src/lib/facts/tool-guards.ts`
- Test: `src/lib/facts/__tests__/tool-guards.test.ts`

**Interfaces:**
- Consumes: `RegistrarHechoInput` de `@/lib/facts/contracts`.
- Produces: `function assertFactInputValid(input: RegistrarHechoInput): string | null` — devuelve un mensaje de error accionable si el input viola una regla dura, o `null` si es válido.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/facts/__tests__/tool-guards.test.ts
import { describe, expect, it } from 'vitest';
import { assertFactInputValid } from '../tool-guards';
import type { RegistrarHechoInput } from '../contracts';

const donation = (fiscalPeriod: string | null): RegistrarHechoInput => ({
  kind: 'donation',
  title: 'Donación fundación X',
  body: 'Donación a la fundación X.',
  structured: { montoCentavos: '5000000000', articulo: '257', fiscalYear: '2026' },
  fiscalPeriod,
});

const narrative = (fiscalPeriod: string | null): RegistrarHechoInput => ({
  kind: 'narrative',
  title: 'Reestructuración',
  body: 'Estamos reestructurando facturas.',
  structured: null,
  fiscalPeriod,
});

describe('assertFactInputValid', () => {
  it('acepta donation con fiscalPeriod', () => {
    expect(assertFactInputValid(donation('2026'))).toBeNull();
  });

  it('RECHAZA donation con fiscalPeriod nulo (kind material)', () => {
    const err = assertFactInputValid(donation(null));
    expect(err).toMatch(/fiscalPeriod/);
  });

  it('acepta narrative sin fiscalPeriod', () => {
    expect(assertFactInputValid(narrative(null))).toBeNull();
  });

  it('RECHAZA donation sin structured', () => {
    const bad = { ...donation('2026'), structured: null } as RegistrarHechoInput;
    expect(assertFactInputValid(bad)).toMatch(/structured/);
  });
});
```

- [ ] **Step 2: Correr el test → RED**

Run: `npx vitest run src/lib/facts/__tests__/tool-guards.test.ts`
Expected: FAIL — `Cannot find module '../tool-guards'`.

- [ ] **Step 3: Implementar `src/lib/facts/tool-guards.ts`**

```ts
// Validación DURA de input de la tool `registrar_hecho_negocio`, server-side.
// Complementa a los contratos Zod: reglas de coherencia kind↔campos que el
// schema (permisivo por diseño para el LLM) no expresa. PURO (sin DB).

import type { RegistrarHechoInput, FactKind } from './contracts';

// Kinds fiscalmente materiales: mueven cifras en reportes, así que EXIGEN
// período. Sin esta regla, el residual NULL del índice único parcial dejaría
// entrar dos activos sin período y doblar una cifra (Art. 647).
const MATERIAL_KINDS: readonly FactKind[] = ['donation', 'leasing', 'loss_carryforward'];

export function assertFactInputValid(input: RegistrarHechoInput): string | null {
  const isMaterial = MATERIAL_KINDS.includes(input.kind);
  if (isMaterial && (input.fiscalPeriod === null || input.fiscalPeriod.trim() === '')) {
    return `Un hecho de tipo "${input.kind}" requiere fiscalPeriod (año 'YYYY'). Pregunta al usuario el año fiscal y reintenta.`;
  }
  if (isMaterial && input.structured === null) {
    return `Un hecho de tipo "${input.kind}" requiere el objeto "structured" con los datos (ej. montoCentavos). Reintenta con structured.`;
  }
  return null;
}
```

- [ ] **Step 4: Correr el test → GREEN**

Run: `npx vitest run src/lib/facts/__tests__/tool-guards.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Guard strict-mode (el dir src/lib/facts está cubierto)**

Run: `npm run lint:strict-mode`
Expected: pass (tool-guards.ts no tiene Zod).

- [ ] **Step 6: Commit**

```bash
git add src/lib/facts/tool-guards.ts src/lib/facts/__tests__/tool-guards.test.ts
git commit -m "feat(facts): guard puro assertFactInputValid — kinds materiales exigen período (Ola 1A)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task A2: Tool `registrar_hecho_negocio` en el registry

**Files:**
- Modify: `src/lib/agents/tools/registry.ts` (definición de tool + `case` en `executeTool` + alta en `AGENT_TOOLS`)

**Interfaces:**
- Consumes: `registrarHechoInputSchema` (`@/lib/facts/contracts`), `assertFactInputValid` (`@/lib/facts/tool-guards`), `reconcileFact` (`@/lib/db/facts`, import dinámico), `ToolExecContext.workspaceId`.
- Produces: la tool `registrar_hecho_negocio` disponible para los agentes tax/accounting/strategy; el `case` en el dispatcher que persiste y devuelve un `content` de confirmación.

- [ ] **Step 1: Añadir imports al inicio de `registry.ts`** (junto a los imports existentes)

```ts
import { registrarHechoInputSchema } from '@/lib/facts/contracts';
import { assertFactInputValid } from '@/lib/facts/tool-guards';
```

- [ ] **Step 2: Definir la tool** (tras `const QUERY_ERP = tool({...});`, antes de `AGENT_TOOLS`)

```ts
const REGISTRAR_HECHO = tool({
  description:
    'Registra un HECHO DURADERO del negocio del usuario (ej. una donación) para que ' +
    'PERSISTA y alimente sus reportes futuros. ' +
    'LLAMA esta tool SOLO cuando el usuario ya CONFIRMÓ explícitamente en el turno anterior ' +
    'el hecho exacto que le reformulaste. NUNCA la llames para hipótesis, preguntas, ejemplos, ' +
    'o ideas tuyas — solo para afirmaciones reales y duraderas que el usuario confirmó. ' +
    'Ante la duda, NO la llames. ' +
    'kind="narrative" para contexto de negocio (structured=null, fiscalPeriod opcional). ' +
    'kind="donation" para una donación con descuento Art. 257 E.T. (REQUIERE fiscalPeriod=año y ' +
    'structured). IMPORTANTE: montoCentavos va en CENTAVOS como string — 50 millones de pesos = "5000000000".',
  inputSchema: registrarHechoInputSchema,
  execute: async (args, options) => {
    const bag = readBag(options);
    const result = await executeTool('registrar_hecho_negocio', args, bag.ctx);
    return result.content;
  },
});
```

- [ ] **Step 3: Añadir el `case` en `executeTool`** (dentro del `switch (toolName)`, antes del `default`)

```ts
    case 'registrar_hecho_negocio': {
      if (!ctx.workspaceId) {
        return { content: 'ERROR: no hay workspace activo — no se puede registrar el hecho. No reintentes.' };
      }
      const parsed = registrarHechoInputSchema.safeParse(args);
      if (!parsed.success) {
        return { content: `ERROR de validación del hecho: ${parsed.error.message}. Corrige y reintenta.` };
      }
      const input = parsed.data;
      const guardErr = assertFactInputValid(input);
      if (guardErr) {
        return { content: `NO_REGISTRADO: ${guardErr}` };
      }
      const { reconcileFact } = await import('@/lib/db/facts');
      const { decision, fact } = await reconcileFact({
        workspaceId: ctx.workspaceId,
        kind: input.kind,
        content: { title: input.title, body: input.body, structured: input.structured },
        fiscalPeriod: input.fiscalPeriod,
        source: 'chat',
      });
      const periodTxt = input.fiscalPeriod ? ` (período ${input.fiscalPeriod})` : '';
      const msg =
        decision.action === 'NOOP'
          ? `YA_REGISTRADO: "${input.title}"${periodTxt} ya estaba registrado idéntico. Dile al usuario que ya lo tenías.`
          : decision.action === 'SUPERSEDE'
            ? `ACTUALIZADO: "${input.title}"${periodTxt} reemplazó una versión previa (id ${fact?.id}). Dile al usuario que lo actualizaste y que puede verlo/editarlo en "Contexto de la empresa".`
            : `REGISTRADO: "${input.title}"${periodTxt} (id ${fact?.id}). Dile al usuario que lo tendrás en cuenta en su próximo reporte y que puede verlo/editarlo en "Contexto de la empresa".`;
      return { content: msg };
    }
```

- [ ] **Step 4: Registrar la tool por-agente** en `AGENT_TOOLS` — añadir `registrar_hecho_negocio: REGISTRAR_HECHO,` a las claves `tax`, `accounting` y `strategy` (NO a documents ni litigation).

Ejemplo para `tax` (repetir el patrón en `accounting` y `strategy`):

```ts
  tax: {
    search_docs: SEARCH_DOCS,
    search_web: SEARCH_WEB,
    calculate_sanction: CALCULATE_SANCTION,
    analyze_document: ANALYZE_DOCUMENT,
    assess_risk: ASSESS_RISK,
    get_tax_calendar: GET_TAX_CALENDAR,
    query_erp: QUERY_ERP,
    registrar_hecho_negocio: REGISTRAR_HECHO,
  },
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: 0 errores (valida que `structured: DonationStructured | null` es asignable a `FactContent.structured: Record<string,unknown> | null`, y que el import dinámico resuelve).

Run: `npm run build`
Expected: build OK.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agents/tools/registry.ts
git commit -m "feat(facts): tool registrar_hecho_negocio en el registry + dispatch a reconcileFact (Ola 1A)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task A3: Guardrail en los prompts de especialistas

**Files:**
- Create: `src/lib/agents/prompts/fragments/facts-capture.fragment.ts`
- Modify: `src/lib/agents/prompts/tax-agent.prompt.ts`, `accounting-agent.prompt.ts`, `strategy-agent.prompt.ts`

**Interfaces:**
- Produces: `function factsCaptureGuardrail(language: 'es' | 'en'): string` — bloque de guardrail para inyectar en el `return` de cada prompt builder.

- [ ] **Step 1: Crear el fragmento compartido**

```ts
// src/lib/agents/prompts/fragments/facts-capture.fragment.ts
//
// Guardrail ÚNICO para la tool `registrar_hecho_negocio` — safety rail
// compartido por tax/accounting/strategy (una sola fuente de verdad).
// Patrón GPT-5.4: ALWAYS/NEVER/MUST solo para el rail de seguridad.

export function factsCaptureGuardrail(language: 'es' | 'en'): string {
  if (language === 'en') {
    return `
## MEMORIA DE HECHOS DEL NEGOCIO (tool registrar_hecho_negocio)
When the user states a REAL, DURABLE fact about their business (e.g. a donation), you may persist it so it feeds their future reports.
- NEVER call registrar_hecho_negocio without the user's EXPLICIT confirmation in the previous turn. When in doubt, do NOT propose (NOOP bias).
- NEVER propose registering a hypothesis, a question, an example, or your own idea — only real, durable facts the user asserted.
- MUST first re-state the exact, typed fact and ask for confirmation ("I'll register: donation $50,000,000 · 2026 · Art. 257 discount. Correct?"). Only after "yes" call the tool.
- For a donation: fiscalPeriod (year) is REQUIRED and montoCentavos is in CENTAVOS as a string.`;
  }
  return `
## MEMORIA DE HECHOS DEL NEGOCIO (tool registrar_hecho_negocio)
Cuando el usuario afirme un HECHO REAL y DURADERO de su empresa (ej. una donación), puedes persistirlo para que alimente sus reportes futuros.
- NUNCA llames registrar_hecho_negocio sin confirmación EXPLÍCITA del usuario en el turno anterior. Ante la duda, NO propongas (sesgo NOOP).
- NUNCA propongas registrar una hipótesis, una pregunta, un ejemplo, o una idea tuya — solo hechos reales y duraderos que el usuario afirmó.
- DEBES primero re-formular el hecho exacto y tipado y pedir confirmación ("Voy a registrar: donaciones $50.000.000 · 2026 · descuento Art. 257 ET. ¿Correcto?"). Solo tras el "sí" llamas la tool.
- Para una donación: fiscalPeriod (año) es OBLIGATORIO y montoCentavos va en CENTAVOS como string.`;
}
```

- [ ] **Step 2: Inyectar en `tax-agent.prompt.ts`**

Añadir el import al inicio del archivo:

```ts
import { factsCaptureGuardrail } from './fragments/facts-capture.fragment';
```

E insertar el guardrail en el string retornado por `buildTaxPrompt`, cerca del final del template (antes del cierre del backtick del `return`), interpolando `${factsCaptureGuardrail(language)}`.

- [ ] **Step 3: Repetir Step 2 en `accounting-agent.prompt.ts` y `strategy-agent.prompt.ts`**

Cada uno: import + `${factsCaptureGuardrail(language)}` interpolado en su template de retorno. (Cada builder recibe `language` como primer parámetro — verifícalo.)

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: 0 errores (los 3 builders reciben `language` e interpolan el fragmento).

Run: `npm run build`
Expected: build OK.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/prompts/fragments/facts-capture.fragment.ts src/lib/agents/prompts/tax-agent.prompt.ts src/lib/agents/prompts/accounting-agent.prompt.ts src/lib/agents/prompts/strategy-agent.prompt.ts
git commit -m "feat(facts): guardrail de captura en prompts tax/accounting/strategy (Ola 1A)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (contra el spec + handoff de Ola 0)

- §2 Captura conversacional (tool + reconciliación) → A2 (tool + dispatch a `reconcileFact`). ✅
- §2 Guardrails (solo tras confirmación, sesgo NOOP, re-formular) → A3 (prompt) + descripción de la tool. ✅
- **Handoff CRÍTICO (non-null período para kinds materiales)** → A1 (`assertFactInputValid`) + A2 (dispatcher lo aplica). ✅
- MoneyCop centavos → explícito en la descripción de la tool (A2) y el guardrail (A3). ✅
- Tenancy server-side (`ctx.workspaceId`) → A2 (error si falta). ✅
- Reutiliza contratos + `reconcileFact` de Ola 0 (sin redefinir). ✅
- **Fuera de alcance (otras olas/teams):** el chip de navegación (Team B), el cálculo estructurado donation→TOTAL VINCULANTE + decision records (Team C), el panel Contexto (Team D), la confirmación pre-reporte (Ola 2). Correcto — Team A solo captura+persiste.

**No placeholders:** cada step trae el código real. **Type consistency:** `registrarHechoInputSchema`/`RegistrarHechoInput` (A1/A2), `assertFactInputValid` (A1→A2), `reconcileFact` firma de Ola 0 (A2). ✅
