# Hechos del negocio · Ola 2 — Integración de hechos a reportes · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inyectar los hechos NARRATIVOS del negocio como prosa (`<hechos_empresa>`) en el `<context>` dinámico de los reportes NIIF (3 passes) + Estrategia + Gobierno + HTML + Tax-Optimizer, con una confirmación pre-reporte ("N hechos se incluirán" + toggle de exclusión efímera) en el intake NIIF, y difiriendo el descuento Art. 257 del optimizador al bloque determinista.

**Architecture:** Un renderer PURO (`renderHechosEmpresaBlock`) + un loader server-only degradado-seguro (`getHechosEmpresaBlock`) alimentan cada prompt de reporte. Los NÚMEROS nunca salen de aquí (los estructurados ya viven en el path determinista de Team C); estos hechos son SÓLO contexto de redacción, con un guardrail anti-cifras co-locado en el propio bloque. La exclusión por-corrida viaja como `excludedFactIds` en el body del request (patrón `provisional`/`adjustmentLedger` ya existente), nunca muta la DB.

**Tech Stack:** Next.js App Router (RSC + Server Actions), AI SDK v6 (`callFinancialAgent` / `generateText`), Drizzle (`getActiveFacts`), Zod, Vitest, Tailwind (token polarity `n-0..n-1000`).

## Global Constraints

- **Zod strict-mode NO aplica aquí**: los schemas nuevos (`excludedFactIdsSchema`) son de request-validation, NO viajan al LLM vía `experimental_output`/`generateObject`. Reglas normales de Zod (`.optional()`, `.max()`) permitidas. Igual, `npm run lint:strict-mode` DEBE seguir verde tras cada tarea.
- **Los números NUNCA salen de la LLM ni de estos hechos** (Protocolo Élite / CLAUDE.md). El bloque `<hechos_empresa>` es contexto de PROSA; su header lleva el guardrail explícito anti-cifras.
- **`<hechos_empresa>` = SÓLO hechos `kind === 'narrative'`.** Las donaciones (estructurados) se quedan 100% en el path determinista (Team C) — no entran a este bloque (evita doble conteo, Art. 647).
- **i18n INLINE** (`const t = (es, en) => language === 'es' ? es : en`, ternarios). NUNCA `src/lib/i18n/dictionaries.ts` (WIP ajeno sin commitear).
- **Token polarity** (CLAUDE.md): tinta legible/clickeable `text-n-1000` (primaria) / `text-n-700/800` (secundaria) / `text-n-500/600` (decorativa). NUNCA `text-n-100..n-400` como tinta legible. Hover oscurece, no invierte.
- **Tenancy server-side siempre**: `workspaceId` se resuelve vía `getCurrentWorkspaceId()` (cookie/sesión, NO-create) en la route/action; NUNCA del cliente. Degrada seguro a `''`/`[]` cuando no hay workspace.
- **WIP ajeno intocable**: `src/app/login/page.tsx`, `src/app/page.tsx`, `src/components/layout/Header.tsx`, `src/components/sections/Hero.tsx`, `src/components/sections/Metrics.tsx` (borrado), `src/lib/i18n/dictionaries.ts`, `scripts/cleanup-auth-dryrun.mjs`, `src/modules/`. En cada commit usar `git add <rutas exactas>`, NUNCA `git add -A`/`.`.
- **DB**: Ola 2 NO requiere migración. NUNCA correr `npm run db:migrate`/`db:push` (tracking desalineado). Si algo pareciera requerir DB, PARAR y validar con Johan.
- **fiscalPeriod**: `company.fiscalPeriod` es texto libre (max 20). Al casar con `getActiveFacts`, normalizar extrayendo el año de 4 dígitos con `fiscalPeriod.match(/\d{4}/)?.[0] ?? null` (patrón Team C). Los narrativos tienen período `null` → matchean cualquier período de todas formas.
- **Trailer de commit obligatorio**: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Verificación estándar** (por tarea donde aplique): `npx tsc --noEmit` · `npm run lint:strict-mode` · `npx vitest run src/lib/facts src/lib/normativa src/lib/agents/financial/contracts` · `npm run build`.

---

## File Structure

**Archivos NUEVOS:**
- `src/lib/facts/hechos-empresa.ts` — renderer PURO (`renderHechosEmpresaBlock`) + selector PURO (`selectNarrativeContents`). Sin DB. TDD.
- `src/lib/facts/__tests__/hechos-empresa.test.ts` — tests del renderer/selector.
- `src/lib/facts/report-facts.ts` — `server-only`. Loader `getHechosEmpresaBlock` (glue getActiveFacts → selector → renderer, degradado-seguro).
- `src/lib/facts/actions/report-facts-actions.ts` — Server Action de LECTURA `getActiveNarrativesForReportAction` (para la confirmación pre-reporte).
- `src/components/workspace/intake/HechosEmpresaConfirm.tsx` — componente cliente autocontenido de la confirmación pre-reporte (lista + toggles). Sólo usado por el intake NIIF.

**Archivos MODIFICADOS:**
- `src/lib/validation/schemas.ts` — `excludedFactIdsSchema` (nuevo export).
- `src/lib/agents/financial/prompts/niif-analyst.prompt.ts` — `NiifAnalystEliteContext` + `SharedPromptContext` + `buildSharedContext` + 3 `<context>` blocks.
- `src/lib/agents/financial/orchestrator.ts` — `OrchestrateFinancialOptions` + `runNiifPhase` (merge del bloque) + `PhaseHandoffInput`/`GovernancePhaseInput` (hechosEmpresa en elite).
- `src/app/api/financial-report/niif/route.ts` — resolver workspaceId + excludedFactIds → options.
- `src/lib/agents/financial/prompts/strategy-director.prompt.ts` — `StrategyDirectorEliteContext` + `<context>`.
- `src/app/api/financial-report/strategy/route.ts` — resolver workspaceId + block → phase input.
- `src/lib/agents/financial/prompts/governance-specialist.prompt.ts` — `GovernanceEliteContext` + `<context>`.
- `src/app/api/financial-report/governance/route.ts` — resolver workspaceId + block → phase input.
- `src/lib/agents/financial/agents/html-editor.ts` — `runHtmlEditor(+hechosEmpresa)`.
- `src/lib/agents/financial/prompts/html-editor.prompt.ts` — `buildHtmlEditorUserContent(+hechosEmpresa)` en `<context>`.
- `src/app/api/financial-report/html/route.ts` — resolver workspaceId + block + excludedFactIds → runHtmlEditor.
- `src/lib/agents/financial/tax-planning/orchestrator.ts` — computar block + pasarlo a runTaxOptimizer.
- `src/lib/agents/financial/tax-planning/agents/tax-optimizer.ts` — `runTaxOptimizer(+hechosEmpresa)` en el `<context>` userContent.
- `src/lib/agents/financial/tax-planning/prompts/tax-optimizer.prompt.ts` — constraint "diferir descuento 257 al bloque determinista".
- `src/types/platform.ts` — `NiifReportIntake.excludedFactIds?`.
- `src/components/workspace/intake/NiifReportIntake.tsx` — estado excludedFactIds + render `<HechosEmpresaConfirm>` + finalIntake.
- `src/components/workspace/PipelineWorkspace.tsx` — threading excludedFactIds a los 4 fetch bodies.
- `.superpowers/sdd/progress.md` — ledger Ola 2.

---

### Task 1: Renderer + selector PUROS del bloque `<hechos_empresa>`

**Files:**
- Create: `src/lib/facts/hechos-empresa.ts`
- Test: `src/lib/facts/__tests__/hechos-empresa.test.ts`

**Interfaces:**
- Consumes: `WorkspaceFact` (`@/lib/db/schema`, sólo el tipo — Pick de `id/kind/title/body`).
- Produces:
  - `interface NarrativeContent { title: string; body: string }`
  - `selectNarrativeContents(facts: Array<Pick<WorkspaceFact,'id'|'kind'|'title'|'body'>>, excludedFactIds?: readonly string[] | null): NarrativeContent[]`
  - `renderHechosEmpresaBlock(narratives: NarrativeContent[], language: 'es'|'en'): string` — devuelve `''` cuando no hay narrativos; si hay, un bloque `<hechos_empresa>…</hechos_empresa>` con guardrail anti-cifras en el header.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/facts/__tests__/hechos-empresa.test.ts
import { describe, it, expect } from 'vitest';
import {
  selectNarrativeContents,
  renderHechosEmpresaBlock,
} from '@/lib/facts/hechos-empresa';

const fact = (over: Partial<{ id: string; kind: string; title: string; body: string }>) => ({
  id: 'id-1',
  kind: 'narrative',
  title: 'T',
  body: 'B',
  ...over,
}) as Parameters<typeof selectNarrativeContents>[0][number];

describe('selectNarrativeContents', () => {
  it('keeps only narrative kind', () => {
    const out = selectNarrativeContents([
      fact({ id: 'a', kind: 'narrative', title: 'N', body: 'nb' }),
      fact({ id: 'b', kind: 'donation', title: 'D', body: 'db' }),
    ]);
    expect(out).toEqual([{ title: 'N', body: 'nb' }]);
  });

  it('drops excluded ids (efímero, sin mutar nada)', () => {
    const out = selectNarrativeContents(
      [
        fact({ id: 'a', title: 'A', body: 'ab' }),
        fact({ id: 'b', title: 'B', body: 'bb' }),
      ],
      ['a'],
    );
    expect(out).toEqual([{ title: 'B', body: 'bb' }]);
  });

  it('tolerates null/undefined excluded', () => {
    expect(selectNarrativeContents([fact({ id: 'a', title: 'A', body: 'ab' })], null)).toHaveLength(1);
  });
});

describe('renderHechosEmpresaBlock', () => {
  it('returns empty string when no narratives (no empty tag)', () => {
    expect(renderHechosEmpresaBlock([], 'es')).toBe('');
  });

  it('wraps items in a tagged block with the anti-figures guardrail (es)', () => {
    const out = renderHechosEmpresaBlock([{ title: 'Donación', body: 'a la fundación X' }], 'es');
    expect(out.startsWith('<hechos_empresa>')).toBe(true);
    expect(out.trimEnd().endsWith('</hechos_empresa>')).toBe(true);
    expect(out).toContain('- Donación: a la fundación X');
    expect(out).toContain('NUNCA'); // guardrail anti-cifras presente
  });

  it('renders english header when language=en', () => {
    const out = renderHechosEmpresaBlock([{ title: 'T', body: 'B' }], 'en');
    expect(out).toContain('NEVER');
    expect(out).toContain('- T: B');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/facts/__tests__/hechos-empresa.test.ts`
Expected: FAIL — `Cannot find module '@/lib/facts/hechos-empresa'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/facts/hechos-empresa.ts
// Renderer + selector PUROS del bloque <hechos_empresa> que inyecta los hechos
// NARRATIVOS del negocio como PROSA en el <context> dinámico de los prompts de
// reporte. Sin DB, sin import del árbol financiero → testeable en aislamiento.
// Los números NUNCA salen de aquí: el header del bloque lleva su propio guardrail
// anti-cifras (Protocolo Élite — todo número vinculante viene del path determinista).

import type { WorkspaceFact } from '@/lib/db/schema';

export interface NarrativeContent {
  title: string;
  body: string;
}

/**
 * Selecciona los hechos NARRATIVOS que deben entrar al reporte, excluyendo los
 * ids que el usuario desmarcó en la confirmación pre-reporte (exclusión efímera,
 * NO muta la DB). PURA: el caller pasa los facts ya leídos por getActiveFacts
 * (que ya devuelve sólo `status='active'`). El filtro `kind==='narrative'` deja
 * los estructurados (donation) fuera del bloque de prosa — sus cifras van por el
 * path determinista, nunca por aquí (Art. 647, anti doble conteo).
 */
export function selectNarrativeContents(
  facts: Array<Pick<WorkspaceFact, 'id' | 'kind' | 'title' | 'body'>>,
  excludedFactIds?: readonly string[] | null,
): NarrativeContent[] {
  const excluded = new Set(excludedFactIds ?? []);
  return facts
    .filter((f) => f.kind === 'narrative' && !excluded.has(f.id))
    .map((f) => ({ title: f.title, body: f.body }));
}

/**
 * Renderiza el bloque <hechos_empresa>. Devuelve '' cuando no hay narrativos (no
 * se inyecta un tag vacío — cache-friendly). El header lleva el guardrail
 * anti-cifras CO-LOCADO con los hechos, para que el modelo nunca derive un número
 * de este contexto.
 */
export function renderHechosEmpresaBlock(
  narratives: NarrativeContent[],
  language: 'es' | 'en',
): string {
  if (narratives.length === 0) return '';
  const header =
    language === 'es'
      ? 'Hechos duraderos del negocio confirmados por el usuario. Son CONTEXTO para la redacción (notas, análisis, narrativa); NUNCA una fuente de cifras. Todo número vinculante proviene de los TOTALES VINCULANTES / bloques deterministas, jamás de estos hechos.'
      : 'Durable business facts confirmed by the user. They are CONTEXT for the narrative (notes, analysis, prose); NEVER a source of figures. Every binding number comes from the BINDING TOTALS / deterministic blocks, never from these facts.';
  const items = narratives.map((n) => `- ${n.title}: ${n.body}`).join('\n');
  return `<hechos_empresa>
${header}
${items}
</hechos_empresa>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/facts/__tests__/hechos-empresa.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/lib/facts/hechos-empresa.ts src/lib/facts/__tests__/hechos-empresa.test.ts
git commit -m "feat(facts): renderer+selector puros del bloque <hechos_empresa> (Ola 2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Loader server-only + Server Action de lectura + schema de exclusión

**Files:**
- Create: `src/lib/facts/report-facts.ts`
- Create: `src/lib/facts/actions/report-facts-actions.ts`
- Modify: `src/lib/validation/schemas.ts` (añadir `excludedFactIdsSchema` export)

**Interfaces:**
- Consumes: `getActiveFacts` (`@/lib/db/facts`), `selectNarrativeContents`/`renderHechosEmpresaBlock` (Task 1), `getCurrentWorkspaceId` (`@/lib/db/workspace`), `toFactDTO`/`FactDTO` (`@/lib/facts/dto`).
- Produces:
  - `getHechosEmpresaBlock(workspaceId: string | null | undefined, fiscalPeriod: string | null, language: 'es'|'en', options?: { excludedFactIds?: readonly string[] | null }): Promise<string>` — bloque listo para el `<context>`, o `''`. Degrada seguro (workspace ausente o error → `''`).
  - `getActiveNarrativesForReportAction(fiscalPeriod: string | null): Promise<FactDTO[]>` — Server Action de lectura; narrativos activos del workspace del usuario (tenancy por cookie). `[]` si no hay workspace.
  - `excludedFactIdsSchema` (Zod) en `schemas.ts`: `z.array(z.string()).max(200)`.

- [ ] **Step 1: Escribir el loader server-only**

```ts
// src/lib/facts/report-facts.ts
import 'server-only';
import { getActiveFacts } from '@/lib/db/facts';
import { selectNarrativeContents, renderHechosEmpresaBlock } from './hechos-empresa';

/** Extrae el año 'YYYY' de un fiscalPeriod de texto libre (patrón Team C). */
function normalizeFiscalYear(fiscalPeriod: string | null): string | null {
  if (!fiscalPeriod) return null;
  return fiscalPeriod.match(/\d{4}/)?.[0] ?? null;
}

/**
 * Bloque <hechos_empresa> listo para inyectar en el <context> de un prompt de
 * reporte. Degrada SEGURO: sin workspaceId o ante CUALQUIER error → '' (nunca
 * tumba un reporte por los hechos). Los narrativos son atemporales (período
 * null) → matchean cualquier período de todas formas.
 */
export async function getHechosEmpresaBlock(
  workspaceId: string | null | undefined,
  fiscalPeriod: string | null,
  language: 'es' | 'en',
  options?: { excludedFactIds?: readonly string[] | null },
): Promise<string> {
  if (!workspaceId) return '';
  try {
    const facts = await getActiveFacts(workspaceId, normalizeFiscalYear(fiscalPeriod));
    const narratives = selectNarrativeContents(facts, options?.excludedFactIds ?? null);
    return renderHechosEmpresaBlock(narratives, language);
  } catch (err) {
    console.error(
      '[hechos-empresa] fallo cargando hechos (degrada a sin bloque):',
      err instanceof Error ? err.message : err,
    );
    return '';
  }
}
```

- [ ] **Step 2: Escribir la Server Action de lectura**

```ts
// src/lib/facts/actions/report-facts-actions.ts
'use server';
// Server Action de LECTURA para la confirmación pre-reporte ("N hechos se
// incluirán"). Tenancy server-side (cookie/sesión) vía getCurrentWorkspaceId
// (NO-create). Devuelve [] cuando no hay workspace. Sólo narrativos: los
// estructurados (donation) van por el path determinista, no se listan aquí.

import { requireAuthSession } from '@/lib/auth/require-session';
import { getActiveFacts } from '@/lib/db/facts';
import { getCurrentWorkspaceId } from '@/lib/db/workspace';
import { toFactDTO, type FactDTO } from '@/lib/facts/dto';

export async function getActiveNarrativesForReportAction(
  fiscalPeriod: string | null,
): Promise<FactDTO[]> {
  const gate = await requireAuthSession();
  if (!gate.ok) return [];
  const workspaceId = await getCurrentWorkspaceId().catch(() => null);
  if (!workspaceId) return [];
  const year = fiscalPeriod?.match(/\d{4}/)?.[0] ?? null;
  const facts = await getActiveFacts(workspaceId, year);
  return facts.filter((f) => f.kind === 'narrative').map(toFactDTO);
}
```

- [ ] **Step 3: Añadir `excludedFactIdsSchema` a schemas.ts**

En `src/lib/validation/schemas.ts`, inmediatamente DESPUÉS del bloque `financialReportRequestSchema` (`schemas.ts:137-147`), añadir:

```ts
/**
 * IDs de hechos del negocio a EXCLUIR de una corrida de reporte (confirmación
 * pre-reporte, exclusión efímera — no muta la DB). Viaja en el body junto a
 * rawData/company, como provisional/adjustmentLedger. NO viaja al LLM →
 * strict-mode-2026 no aplica.
 */
export const excludedFactIdsSchema = z.array(z.string()).max(200);
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run lint:strict-mode`
Expected: PASS (los nuevos schemas no van al LLM).

- [ ] **Step 5: Commit**

```bash
git add src/lib/facts/report-facts.ts src/lib/facts/actions/report-facts-actions.ts src/lib/validation/schemas.ts
git commit -m "feat(facts): loader server-only + read action + excludedFactIdsSchema (Ola 2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Inyección NIIF (3 passes) — elite-merge + workspaceId plumbing

**Files:**
- Modify: `src/lib/agents/financial/prompts/niif-analyst.prompt.ts` (`NiifAnalystEliteContext:46`, `SharedPromptContext:270`, `buildSharedContext` return `:429`, 3 `<context>` `:917`, `:1131`, `:1318`)
- Modify: `src/lib/agents/financial/orchestrator.ts` (`OrchestrateFinancialOptions:54`, `runNiifPhase:1364`)
- Modify: `src/app/api/financial-report/niif/route.ts` (POST body + ambos call sites de `runNiifPhase`)

**Interfaces:**
- Consumes: `getHechosEmpresaBlock` (Task 2), `getCurrentWorkspaceId` (`@/lib/db/workspace`), `excludedFactIdsSchema` (Task 2).
- Produces: `OrchestrateFinancialOptions` gana `workspaceId?: string` y `excludedFactIds?: string[] | null`. El bloque llega a los 3 pass-prompts vía `ctx.hechosEmpresa`.

- [ ] **Step 1: Añadir `hechosEmpresa` al tipo elite y al SharedPromptContext**

En `niif-analyst.prompt.ts`, en `NiifAnalystEliteContext` (`:46`), añadir como último campo antes del `}`:

```ts
  /** Bloque <hechos_empresa> pre-renderizado (Ola 2). '' o undefined = no se inyecta. */
  hechosEmpresa?: string | null;
```

En `SharedPromptContext` (`:270`), añadir como último campo antes del `}`:

```ts
  hechosEmpresa: string;
```

- [ ] **Step 2: Surface en `buildSharedContext`**

En `buildSharedContext` (`:314`), dentro del cuerpo antes del `return {`, añadir:

```ts
  const hechosEmpresa = elite?.hechosEmpresa ?? '';
```

Y en el objeto `return { … }` (`:429`), añadir `hechosEmpresa,` como último campo (antes de `presentationV3Data,` o al final — el orden no importa).

- [ ] **Step 3: Insertar el bloque en los 3 `<context>`**

En Pass-1 `<context>` (`:896-918`), insertar `${ctx.hechosEmpresa}` en la línea ANTES de `${ctx.langInstruction}` (`:917`):

```ts
${renderPresentationV3AnchorsBlock(ctx)}

${ctx.hechosEmpresa}

${ctx.langInstruction}
</context>`;
```

En Pass-2 `<context>` (`:1118-1132`), insertar antes de `${ctx.langInstruction}` (`:1131`):

```ts
${renderPresentationV3AnchorsBlock(ctx)}

${ctx.hechosEmpresa}

${ctx.langInstruction}
</context>`;
```

En Pass-3 `<context>` (`:1297-1319`), insertar antes de `${ctx.langInstruction}` (`:1318`):

```ts
${renderPresentationV3AnchorsBlock(ctx)}

${ctx.hechosEmpresa}

${ctx.langInstruction}
</context>`;
```

(Cuando `ctx.hechosEmpresa === ''`, esto produce a lo sumo una línea en blanco extra — consistente con los demás `renderXBlock(ctx)` que ya devuelven `''`. No cambia el output material de los fixtures sin hechos.)

- [ ] **Step 4: Añadir campos a `OrchestrateFinancialOptions`**

En `orchestrator.ts`, en `OrchestrateFinancialOptions` (`:54`), añadir como últimos campos antes del `}`:

```ts
  /** Workspace del solicitante (cookie, resuelto en la route) — para leer hechos narrativos (Ola 2). */
  workspaceId?: string;
  /** IDs de hechos a excluir SÓLO en esta corrida (confirmación pre-reporte). No muta la DB. */
  excludedFactIds?: string[] | null;
```

- [ ] **Step 5: Computar y mergear el bloque en `runNiifPhase`**

En `orchestrator.ts`, añadir el import al top del archivo (junto a los demás imports):

```ts
import { getHechosEmpresaBlock } from '@/lib/facts/report-facts';
```

En `runNiifPhase` (`:1364`), tras `const context = await prepareFinancialContext(request, options);`, añadir:

```ts
  // Ola 2 — hechos narrativos del negocio como PROSA en <context> (no mueve números).
  const hechosEmpresa = await getHechosEmpresaBlock(
    options.workspaceId,
    context.effectiveCompany.fiscalPeriod,
    language,
    { excludedFactIds: options.excludedFactIds },
  );
```

Y cambiar la llamada `runNiifAnalyst(...)` para pasar el bloque vía el bag elite. Reemplazar el arg `context.eliteForNiif,` por:

```ts
    { ...context.eliteForNiif, hechosEmpresa },
```

(El objeto `{ ...context.eliteForNiif, hechosEmpresa }` es asignable a `NiifAnalystEliteContext` — todos sus campos son opcionales y ahora incluye `hechosEmpresa`.)

- [ ] **Step 6: Resolver workspaceId + excludedFactIds en la route NIIF**

En `src/app/api/financial-report/niif/route.ts`, añadir imports:

```ts
import { getCurrentWorkspaceId } from '@/lib/db/workspace';
import { excludedFactIdsSchema } from '@/lib/validation/schemas';
```

Tras el parseo de `provisional`/`adjustmentLedger` (donde ya se lee `body`), añadir:

```ts
    const workspaceId = (await getCurrentWorkspaceId().catch(() => null)) ?? undefined;
    const excludedFactIds =
      excludedFactIdsSchema.safeParse((body as { excludedFactIds?: unknown }).excludedFactIds).data ?? null;
```

Y en AMBAS llamadas a `runNiifPhase` (la no-stream y la de streaming — buscar `runNiifPhase(`), añadir `workspaceId` y `excludedFactIds` al objeto `options` que se pasa como 2º argumento (junto a `onProgress`/`provisional`/`adjustmentLedger` ya presentes). Ejemplo del shape final del 2º arg:

```ts
      { provisional, adjustmentLedger, workspaceId, excludedFactIds, onProgress /* si aplica */ },
```

(Preservar los campos que cada call site ya pasaba; sólo AÑADIR `workspaceId` y `excludedFactIds`.)

- [ ] **Step 7: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx vitest run src/lib/agents/financial/contracts src/lib/facts`
Expected: PASS (sin regresiones — el bloque vacío no cambia contratos).
Run: `npm run build`
Expected: build OK.

- [ ] **Step 8: Commit**

```bash
git add src/lib/agents/financial/prompts/niif-analyst.prompt.ts src/lib/agents/financial/orchestrator.ts src/app/api/financial-report/niif/route.ts
git commit -m "feat(facts): narrativos -> <hechos_empresa> en los 3 passes NIIF + workspaceId plumbing (Ola 2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Inyección Estrategia — elite bag vía phase input

**Files:**
- Modify: `src/lib/agents/financial/prompts/strategy-director.prompt.ts` (`StrategyDirectorEliteContext:22`, `<context>:220`)
- Modify: `src/lib/agents/financial/orchestrator.ts` (`PhaseHandoffInput` — leer su definición en `:1464` para confirmar el campo `elite`)
- Modify: `src/app/api/financial-report/strategy/route.ts` (resolver workspaceId + block → phase input, ambos call sites)

**Interfaces:**
- Consumes: `getHechosEmpresaBlock` (Task 2), `getCurrentWorkspaceId`, `excludedFactIdsSchema`.
- Produces: `StrategyDirectorEliteContext` gana `hechosEmpresa?: string | null`. El bloque llega a `buildStrategyDirectorPrompt` vía `elite.hechosEmpresa`.

- [ ] **Step 1: Añadir `hechosEmpresa` a `StrategyDirectorEliteContext`**

En `strategy-director.prompt.ts`, en `StrategyDirectorEliteContext` (`:22`), añadir antes del `}`:

```ts
  /** Bloque <hechos_empresa> pre-renderizado (Ola 2). '' o undefined = no se inyecta. */
  hechosEmpresa?: string | null;
```

- [ ] **Step 2: Insertar el bloque en el `<context>`**

En `buildStrategyDirectorPrompt`, en el `<context>` (`:220`), insertar antes de `${langInstruction}` (última línea antes de `</context>`):

```ts
${elite?.hechosEmpresa ?? ''}

${langInstruction}
</context>`;
```

- [ ] **Step 3: Confirmar/ampliar el campo `elite` de `PhaseHandoffInput`**

Leer `PhaseHandoffInput` en `orchestrator.ts:1464`. Su campo `elite` está tipado como `StrategyDirectorEliteContext | undefined` (es lo que `runStrategyPhase` desestructura y pasa a `runStrategyDirector`). Como `StrategyDirectorEliteContext` ahora incluye `hechosEmpresa`, no hace falta cambiar `PhaseHandoffInput` salvo que su campo `elite` use un tipo inline distinto — en ese caso, añadirle `hechosEmpresa?: string | null`. NO cambiar `runStrategyPhase`/`runStrategyDirector` (ya reenvían `elite` intacto).

- [ ] **Step 4: Resolver workspaceId + block en la route Estrategia**

En `src/app/api/financial-report/strategy/route.ts`, añadir imports:

```ts
import { getCurrentWorkspaceId } from '@/lib/db/workspace';
import { getHechosEmpresaBlock } from '@/lib/facts/report-facts';
import { excludedFactIdsSchema } from '@/lib/validation/schemas';
```

Tras el destructuring de `parsed.data` (`:47`, donde ya se tiene `company`/`language`), añadir:

```ts
    const workspaceId = (await getCurrentWorkspaceId().catch(() => null)) ?? undefined;
    const excludedFactIds =
      excludedFactIdsSchema.safeParse((body as { excludedFactIds?: unknown }).excludedFactIds).data ?? null;
    const hechosEmpresa = await getHechosEmpresaBlock(
      workspaceId,
      company.fiscalPeriod,
      language,
      { excludedFactIds },
    );
```

En AMBAS llamadas a `runStrategyPhase({...})` (no-stream `:83` y streaming `:121`), añadir al objeto phase input:

```ts
      elite: hechosEmpresa ? { hechosEmpresa } : undefined,
```

(El split-endpoint hoy NO pasa `elite` → sin regresión; ahora pasa sólo `hechosEmpresa`. `company.fiscalPeriod` existe en el schema — `companyInfoSchema.fiscalPeriod`.)

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: build OK.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agents/financial/prompts/strategy-director.prompt.ts src/lib/agents/financial/orchestrator.ts src/app/api/financial-report/strategy/route.ts
git commit -m "feat(facts): narrativos -> <hechos_empresa> en Estrategia (Ola 2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Inyección Gobierno — elite bag vía phase input

**Files:**
- Modify: `src/lib/agents/financial/prompts/governance-specialist.prompt.ts` (`GovernanceEliteContext:27`, `<context>:254`)
- Modify: `src/lib/agents/financial/orchestrator.ts` (`GovernancePhaseInput` — confirmar campo `elite` en `:1527`)
- Modify: `src/app/api/financial-report/governance/route.ts` (resolver workspaceId + block → phase input, ambos call sites)

**Interfaces:**
- Consumes: `getHechosEmpresaBlock`, `getCurrentWorkspaceId`, `excludedFactIdsSchema`.
- Produces: `GovernanceEliteContext` gana `hechosEmpresa?: string | null`.

- [ ] **Step 1: Añadir `hechosEmpresa` a `GovernanceEliteContext`**

En `governance-specialist.prompt.ts`, en `GovernanceEliteContext` (`:27`), añadir antes del `}`:

```ts
  /** Bloque <hechos_empresa> pre-renderizado (Ola 2). '' o undefined = no se inyecta. */
  hechosEmpresa?: string | null;
```

- [ ] **Step 2: Insertar el bloque en el `<context>`**

En `buildGovernancePrompt`, en el `<context>` (`:254`), insertar antes de `${langInstruction}` (última línea antes de `</context>`):

```ts
${elite?.hechosEmpresa ?? ''}

${langInstruction}
</context>`;
```

- [ ] **Step 3: Confirmar campo `elite` de `GovernancePhaseInput`**

Leer `GovernancePhaseInput extends PhaseHandoffInput` (`orchestrator.ts:1527`). Su `elite` es `GovernanceEliteContext | undefined`. Como el tipo ahora incluye `hechosEmpresa`, no requiere cambio salvo tipo inline — en ese caso añadir `hechosEmpresa?: string | null`.

- [ ] **Step 4: Resolver workspaceId + block en la route Gobierno**

En `src/app/api/financial-report/governance/route.ts`, añadir imports:

```ts
import { getCurrentWorkspaceId } from '@/lib/db/workspace';
import { getHechosEmpresaBlock } from '@/lib/facts/report-facts';
import { excludedFactIdsSchema } from '@/lib/validation/schemas';
```

Tras el destructuring de `parsed.data` (`:49`), añadir:

```ts
    const workspaceId = (await getCurrentWorkspaceId().catch(() => null)) ?? undefined;
    const excludedFactIds =
      excludedFactIdsSchema.safeParse((body as { excludedFactIds?: unknown }).excludedFactIds).data ?? null;
    const hechosEmpresa = await getHechosEmpresaBlock(
      workspaceId,
      company.fiscalPeriod,
      language,
      { excludedFactIds },
    );
```

En AMBAS llamadas a `runGovernancePhase({...})` (no-stream `:90` y streaming `:138`), añadir al objeto phase input:

```ts
      elite: hechosEmpresa ? { hechosEmpresa } : undefined,
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: build OK.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agents/financial/prompts/governance-specialist.prompt.ts src/lib/agents/financial/orchestrator.ts src/app/api/financial-report/governance/route.ts
git commit -m "feat(facts): narrativos -> <hechos_empresa> en Gobierno (Ola 2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Inyección HTML (Editor Jefe) — param dedicado en user-content

**Files:**
- Modify: `src/lib/agents/financial/prompts/html-editor.prompt.ts` (`buildHtmlEditorUserContent:77`)
- Modify: `src/lib/agents/financial/agents/html-editor.ts` (`runHtmlEditor:68`, call de `buildHtmlEditorUserContent:86`)
- Modify: `src/app/api/financial-report/html/route.ts` (resolver workspaceId + block + excludedFactIds, ambos call sites de `runHtmlEditor`)

**Interfaces:**
- Consumes: `getHechosEmpresaBlock`, `getCurrentWorkspaceId`, `excludedFactIdsSchema`.
- Produces: `runHtmlEditor(input, onProgress?, signal?, hechosEmpresa?: string)`; el bloque va al `<context>` del user-content (los facts NO viajan por `HtmlEditorInputSchema` — tenancy server-side).

- [ ] **Step 1: `buildHtmlEditorUserContent` acepta el bloque**

En `html-editor.prompt.ts`, cambiar la firma (`:77`):

```ts
export function buildHtmlEditorUserContent(input: HtmlEditorInput, hechosEmpresa?: string): string {
```

Dentro del `<context>`, tras la línea `<language>${input.language}</language>` y antes de `</context>`, insertar:

```ts
<language>${input.language}</language>

${hechosEmpresa ?? ''}
</context>
```

- [ ] **Step 2: `runHtmlEditor` recibe y reenvía el bloque**

En `html-editor.ts`, cambiar la firma (`:68`) añadiendo un 4º parámetro:

```ts
export async function runHtmlEditor(
  input: HtmlEditorInput,
  onProgress?: (event: FinancialProgressEvent) => void,
  signal?: AbortSignal,
  hechosEmpresa?: string,
): Promise<HtmlEditorOutput> {
```

Y cambiar la línea `:86`:

```ts
  const userContent = buildHtmlEditorUserContent(parsed.data, hechosEmpresa);
```

- [ ] **Step 3: Resolver workspaceId + block en la route HTML**

En `src/app/api/financial-report/html/route.ts`, añadir imports:

```ts
import { getCurrentWorkspaceId } from '@/lib/db/workspace';
import { getHechosEmpresaBlock } from '@/lib/facts/report-facts';
import { excludedFactIdsSchema } from '@/lib/validation/schemas';
```

Tras `const parsed = HtmlEditorInputSchema.safeParse(body);` y su guard de error (`:43-55`), antes del primer uso de `runHtmlEditor`, añadir:

```ts
    const workspaceId = (await getCurrentWorkspaceId().catch(() => null)) ?? undefined;
    const excludedFactIds =
      excludedFactIdsSchema.safeParse((body as { excludedFactIds?: unknown }).excludedFactIds).data ?? null;
    const hechosEmpresa = await getHechosEmpresaBlock(
      workspaceId,
      parsed.data.company.fiscalPeriod,
      parsed.data.language,
      { excludedFactIds },
    );
```

En la llamada no-stream (`:66`): `const result = await runHtmlEditor(parsed.data, undefined, undefined, hechosEmpresa);`
En la llamada streaming (`:88`): `const result = await runHtmlEditor(parsed.data, onProgress, req.signal, hechosEmpresa);`

(`parsed.data.company.fiscalPeriod` — `HtmlEditorInputSchema.company` = `CompanyInfoSchema`, que tiene `fiscalPeriod`.)

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: build OK.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/financial/prompts/html-editor.prompt.ts src/lib/agents/financial/agents/html-editor.ts src/app/api/financial-report/html/route.ts
git commit -m "feat(facts): narrativos -> <hechos_empresa> en Editor Jefe HTML (Ola 2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Inyección Tax-Optimizer + diferir descuento Art. 257

**Files:**
- Modify: `src/lib/agents/financial/tax-planning/orchestrator.ts` (`orchestrateTaxPlanning:41`, call `runTaxOptimizer:57`)
- Modify: `src/lib/agents/financial/tax-planning/agents/tax-optimizer.ts` (`runTaxOptimizer:25`, userContent `<context>`)
- Modify: `src/lib/agents/financial/tax-planning/prompts/tax-optimizer.prompt.ts` (constraint diferir 257)

**Interfaces:**
- Consumes: `getHechosEmpresaBlock` (Task 2). `orchestrateTaxPlanning` YA tiene `options.workspaceId`.
- Produces: `runTaxOptimizer(rawData, company, language, instructions?, onProgress?, signal?, hechosEmpresa?)`.

- [ ] **Step 1: `runTaxOptimizer` acepta y renderiza el bloque**

En `tax-optimizer.ts`, cambiar la firma (`:25`) añadiendo un 7º parámetro tras `signal`:

```ts
export async function runTaxOptimizer(
  rawData: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  instructions?: string,
  onProgress?: (event: TaxPlanningProgressEvent) => void,
  signal?: AbortSignal,
  hechosEmpresa?: string,
): Promise<TaxOptimizerResult> {
```

En el array `userContent`, insertar el bloque ANTES del cierre `'</context>'`:

```ts
  const userContent = [
    '<context>',
    'DATOS FINANCIEROS Y TRIBUTARIOS DE LA EMPRESA:',
    '',
    rawData,
    instructions ? `\nINSTRUCCIONES ADICIONALES DEL USUARIO:\n${instructions}` : '',
    hechosEmpresa ? `\n${hechosEmpresa}` : '',
    '</context>',
  ]
    .filter(Boolean)
    .join('\n');
```

- [ ] **Step 2: `orchestrateTaxPlanning` computa y pasa el bloque**

En `tax-planning/orchestrator.ts`, añadir import:

```ts
import { getHechosEmpresaBlock } from '@/lib/facts/report-facts';
```

En `orchestrateTaxPlanning`, ANTES de la llamada `runTaxOptimizer(...)` (`:57`), añadir:

```ts
  const hechosEmpresa = await getHechosEmpresaBlock(
    options.workspaceId,
    company.fiscalPeriod,
    language,
  );
```

Y cambiar la llamada `runTaxOptimizer(...)` para pasar el bloque como último argumento:

```ts
  const taxOptimizerResult = await runTaxOptimizer(
    rawData,
    company,
    language,
    instructions,
    onProgress,
    undefined,
    hechosEmpresa,
  );
```

- [ ] **Step 3: Constraint "diferir descuento 257 al bloque determinista"**

En `tax-optimizer.prompt.ts`, dentro del `<constraints>` (empieza en `:53`), añadir como ÚLTIMO bullet inmediatamente ANTES del cierre `</constraints>`:

```
- El descuento por donaciones a ESAL (Art. 257 E.T.) lo cuantifica un bloque DETERMINISTA fuera de tu output (TOTAL VINCULANTE, netea el crédito y su tope sobre el impuesto). If el negocio realiza donaciones then descríbelas cualitativamente como oportunidad y cita la tasa/tope normativos, NEVER emitas una CIFRA de descuento 257 en recommendations ni la sumes en estimatedSavingsCents/totalAnnualSavingsCents — se duplicaría con el bloque determinista. La cifra de ese descuento no es tuya.
```

- [ ] **Step 4: Typecheck + tests + build**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx vitest run src/lib/agents/financial/contracts src/lib/normativa src/lib/facts`
Expected: PASS (Team C intacto — el bloque no toca el neteo determinista).
Run: `npm run build`
Expected: build OK.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/financial/tax-planning/orchestrator.ts src/lib/agents/financial/tax-planning/agents/tax-optimizer.ts src/lib/agents/financial/tax-planning/prompts/tax-optimizer.prompt.ts
git commit -m "feat(facts): narrativos en tax-optimizer + diferir descuento 257 al bloque determinista (Ola 2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Confirmación pre-reporte — componente + wiring en el intake NIIF

**Files:**
- Create: `src/components/workspace/intake/HechosEmpresaConfirm.tsx`
- Modify: `src/types/platform.ts` (`NiifReportIntake:136` — añadir `excludedFactIds?`)
- Modify: `src/components/workspace/intake/NiifReportIntake.tsx` (estado + render en step 4 + `finalIntake`)

**Interfaces:**
- Consumes: `getActiveNarrativesForReportAction` (Task 2), `FactDTO` (`@/lib/facts/dto`), `useLanguage` (patrón `ContextoPanel`).
- Produces: `finalIntake.excludedFactIds: string[] | undefined` en `NiifReportIntakeType`.

- [ ] **Step 1: `NiifReportIntake` gana `excludedFactIds?`**

En `src/types/platform.ts`, en `interface NiifReportIntake` (`:136`), añadir antes del `}`:

```ts
  /** Hechos del negocio a EXCLUIR de esta corrida (confirmación pre-reporte). Efímero. */
  excludedFactIds?: string[]
```

- [ ] **Step 2: Escribir el componente de confirmación**

```tsx
// src/components/workspace/intake/HechosEmpresaConfirm.tsx
'use client';

import { useEffect, useState } from 'react';
import { getActiveNarrativesForReportAction } from '@/lib/facts/actions/report-facts-actions';
import type { FactDTO } from '@/lib/facts/dto';

interface HechosEmpresaConfirmProps {
  fiscalPeriod: string;
  /** IDs actualmente EXCLUIDOS (controlado por el padre). */
  excludedIds: string[];
  onToggle: (factId: string) => void;
  language: 'es' | 'en';
}

/**
 * Confirmación human-in-the-loop pre-reporte (Ola 2): lista los hechos NARRATIVOS
 * del negocio que se incluirán como contexto en el reporte, con un toggle por hecho
 * para EXCLUIRLO sólo en esta corrida (no muta la DB). Sólo se muestra si hay hechos.
 */
export function HechosEmpresaConfirm({
  fiscalPeriod,
  excludedIds,
  onToggle,
  language,
}: HechosEmpresaConfirmProps) {
  const t = (es: string, en: string) => (language === 'es' ? es : en);
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'ready'; facts: FactDTO[] } | { status: 'error' }
  >({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    getActiveNarrativesForReportAction(fiscalPeriod)
      .then((facts) => {
        if (alive) setState({ status: 'ready', facts });
      })
      .catch(() => {
        if (alive) setState({ status: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [fiscalPeriod]);

  if (state.status === 'loading') {
    return (
      <p className="text-sm text-n-600">
        {t('Cargando hechos del negocio…', 'Loading business facts…')}
      </p>
    );
  }
  if (state.status === 'error' || state.facts.length === 0) {
    // Silencioso: sin hechos (o error de lectura) → no se muestra la sección.
    return null;
  }

  const includedCount = state.facts.filter((f) => !excludedIds.includes(f.id)).length;

  return (
    <section className="rounded-xl border border-n-200 bg-n-50 p-4">
      <h4 className="text-sm font-semibold text-n-1000">
        {t(
          `${includedCount} hecho(s) del negocio se incluirán en este reporte`,
          `${includedCount} business fact(s) will be included in this report`,
        )}
      </h4>
      <p className="mt-1 text-xs text-n-600">
        {t(
          'Contexto para la redacción del reporte. Desmarca un hecho para excluirlo sólo en esta corrida (no se elimina).',
          'Context for the report narrative. Uncheck a fact to exclude it for this run only (it is not deleted).',
        )}
      </p>
      <ul className="mt-3 space-y-2">
        {state.facts.map((f) => {
          const included = !excludedIds.includes(f.id);
          return (
            <li key={f.id}>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={included}
                  onChange={() => onToggle(f.id)}
                  className="mt-1 h-4 w-4 accent-au-600"
                />
                <span className="text-sm">
                  <span className="font-medium text-n-1000">{f.title}</span>
                  <span className="text-n-700">{f.body ? ` — ${f.body}` : ''}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

(Nota de contraste: `text-n-1000` primaria, `text-n-700`/`text-n-600` secundaria — nunca `text-n-100..n-400` como tinta. Si `accent-au-600` no existe en la paleta, usar `accent-n-900`; verificar en Task 10 build.)

- [ ] **Step 3: Wire en `NiifReportIntake` — estado + render + finalIntake**

En `src/components/workspace/intake/NiifReportIntake.tsx`:

(a) Importar el componente (junto a los demás imports de intake):

```ts
import { HechosEmpresaConfirm } from './HechosEmpresaConfirm';
```

(b) Añadir estado local (junto a los demás `useState` del wizard):

```ts
  const [excludedFactIds, setExcludedFactIds] = useState<string[]>([]);
```

(c) En `handleSubmit` (`:481`), incluir el campo en `finalIntake`:

```ts
    const finalIntake: NiifReportIntakeType = {
      ...values,
      rawData: resolvedRawData,
      excludedFactIds,
    };
```

Y añadir `excludedFactIds` al array de deps del `useCallback`.

(d) En `step4Preview` (`:1057`), renderizar la confirmación ARRIBA del `<IntakePreview>`:

```tsx
  const step4Preview = (
    <div className="space-y-4">
      <HechosEmpresaConfirm
        fiscalPeriod={values.fiscalPeriod}
        excludedIds={excludedFactIds}
        onToggle={(id) =>
          setExcludedFactIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
          )
        }
        language={language}
      />
      <IntakePreview
        caseType="niif_report"
        data={values}
        onBack={() => setStep(2)}
        onSubmit={handleSubmit}
      />
    </div>
  );
```

(Verificar que `language` esté disponible en el componente — `NiifReportIntake` usa `useLanguage()`; si no está en scope, añadir `const { language } = useLanguage();` con el import de `@/context/LanguageContext` o el hook que use el resto del intake. Confirmar el import exacto leyendo el top del archivo.)

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: build OK (`accent-au-600`/tokens válidos).

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/intake/HechosEmpresaConfirm.tsx src/types/platform.ts src/components/workspace/intake/NiifReportIntake.tsx
git commit -m "feat(facts): confirmación pre-reporte (N hechos se incluirán + toggle) en intake NIIF (Ola 2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Threading `excludedFactIds` en PipelineWorkspace → 4 fetch bodies

**Files:**
- Modify: `src/components/workspace/PipelineWorkspace.tsx` (bodies niif `:1692`, strategy `:1879`, governance `:1912`, html `:2322`)

**Interfaces:**
- Consumes: `pipelineInput.excludedFactIds` (Task 8, vía `NiifReportIntake`).
- Produces: cada fetch body incluye `excludedFactIds` cuando hay exclusiones.

- [ ] **Step 1: Derivar la lista una vez**

En `PipelineWorkspace.tsx`, cerca de donde se leen `provisional`/`adjustmentLedger` del `pipelineInput` (`:1631`), añadir:

```ts
      const excludedFactIds = pipelineInput.excludedFactIds ?? [];
```

- [ ] **Step 2: Añadir a los 4 bodies**

En el `niifBody` (`:1692`), tras la línea de `adjustmentLedger`, añadir:

```ts
        if (excludedFactIds.length) {
          niifBody.excludedFactIds = excludedFactIds;
        }
```

En los bodies de strategy (`:1879`), governance (`:1912`) y html (`:2322`), añadir `excludedFactIds` al objeto cuando `excludedFactIds.length` (mismo patrón — si el body es un objeto literal, incluir `...(excludedFactIds.length ? { excludedFactIds } : {})`). Confirmar la forma exacta de cada body leyendo esas líneas; el objetivo es que las 4 rutas reciban la misma lista que produjo la confirmación.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: build OK.

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace/PipelineWorkspace.tsx
git commit -m "feat(facts): threading excludedFactIds a los 4 endpoints del pipeline NIIF (Ola 2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Verificación de rama completa + review final

**Files:** ninguno (verificación).

- [ ] **Step 1: Suite completa**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run lint:strict-mode`
Expected: PASS.
Run: `npx vitest run src/lib/facts src/lib/normativa src/lib/agents/financial/contracts`
Expected: PASS (todos verdes; nuevos tests de `hechos-empresa` incluidos).
Run: `npm run build`
Expected: build OK.

- [ ] **Step 2: Verificación de comportamiento (degradación segura)**

Confirmar por lectura/razonamiento (no hay DB de test): con `workspaceId` ausente o sin narrativos, `getHechosEmpresaBlock` devuelve `''` y ninguna route falla; los reportes se generan idénticos al pre-Ola-2. Con narrativos presentes, el bloque aparece en el `<context>` de cada prompt y NO altera ningún TOTAL VINCULANTE.

- [ ] **Step 3: Review final de rama** (superpowers:requesting-code-review sobre el rango de Ola 2)

Dispatch un review Opus del diff de Ola 2 (desde el head pre-Ola-2 hasta HEAD). Foco: (a) tenancy — workspaceId nunca del cliente en ninguna route; (b) degradación segura — ningún path lanza por hechos; (c) el bloque vacío no cambia el output existente; (d) el guardrail anti-cifras presente; (e) contraste de `HechosEmpresaConfirm`; (f) que no se tocó WIP ajeno ni `dictionaries.ts`.

- [ ] **Step 4: Commit (si el review pide fixes, aplicarlos en commits atómicos y re-verificar)**

---

### Task 11: Actualizar el ledger

**Files:**
- Modify: `.superpowers/sdd/progress.md`

- [ ] **Step 1: Añadir sección Ola 2 al ledger** con: tareas T1–T10, decisiones (narrative-only en `<hechos_empresa>`; confirmación NIIF-family-only por decisión de Johan; tax-planning no browser-wired; elite-bag mechanism), follow-ups diferidos (panel "Aparece en:" real, RULE code, wiring del POST tax-planning si se decide), y estado merge-ready.

- [ ] **Step 2: Commit**

```bash
git add .superpowers/sdd/progress.md
git commit -m "docs(sdd): ledger Ola 2 — integración de hechos a reportes completa

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notas de diseño (para el implementador)

1. **Por qué elite-bag para NIIF/Estrategia/Gobierno y param para HTML/Tax-Optimizer:** los 3 primeros ponen su `<context>` en el SYSTEM prompt y ya threadean un objeto `elite` a sus builders → mergear un campo es la menor superficie (cero cambios de firma en `runNiifAnalyst`, que tiene 11 params posicionales). HTML y Tax-Optimizer ponen su `<context>` en el USER content y no tienen bag elite → un param dedicado es más limpio.

2. **Degradación segura, no fail-loud:** a diferencia del path determinista de donaciones (Team C, que ES fail-loud ante regla ausente), los narrativos son CONTEXTO — un fallo al leerlos NUNCA debe tumbar un reporte. Por eso `getHechosEmpresaBlock` atrapa todo y devuelve `''`.

3. **Anti doble conteo (Art. 647):** el bloque es SÓLO `kind==='narrative'`. La donación (estructurado) jamás entra como prosa; su cifra vive en el TOTAL VINCULANTE determinista. El constraint del optimizador (Task 7) cierra el último hueco donde el LLM podía narrar su propia cifra 257.

4. **tax-planning no está browser-wired** (hallazgo del scout): la inyección de narrativos al optimizador y el defer-257 quedan activos cuando `/api/tax-planning` se llama (API/tests); la confirmación pre-reporte se limita al pipeline NIIF (única generación disparada desde el browser) por decisión de Johan.

## Self-review (cobertura vs. spec §4 + continuación)

- Narrativos → PROSA en `<context>` de NIIF/Estrategia/Gobierno/HTML/Tax-Optimizer ✓ (T3–T7).
- workspaceId añadido donde faltaba (niif/strategy/governance/html) ✓ (T3–T6).
- Estructurados → números: sin cambios (Team C intacto); NIIF no recomputa ✓ (por diseño).
- Confirmación pre-reporte (N hechos + toggle efímero) ✓ (T8–T9), scope NIIF-family.
- Follow-up Team C (diferir 257 del optimizador) ✓ (T7 step 3).
- Follow-ups opcionales (RULE code, chips "Aparece en") → DIFERIDOS (ledger T11).
- Sin migración DB ✓. i18n inline ✓. WIP ajeno intocado ✓. Token polarity ✓.
