# Hechos del negocio — Ola 1 · Team C (Donation → Art. 257 → TOTAL VINCULANTE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **STATUS: awaiting Johan's task-by-task approval before execution.**

**Goal:** Que un hecho `donation` confirmado alimente un **cálculo determinista** del descuento por donaciones (Art. 257 E.T.) y recompute el **TOTAL VINCULANTE** (`impuestoNeto`) en `/api/tax-planning`, persistiendo un `fact_decision_record` inmutable — números que salen de cálculo determinista + registro normativo versionado, nunca de la LLM (Protocolo Élite).

**Architecture (decisiones Johan 2026-07-20):**
- **Mecánica Art. 257:** `montoCentavos` = valor donado. **Crédito** = `tasaDescuentoPct(25%) × donación`. **Descuento aplicado** = `min(crédito, limitePctImpuesto(25%) × impuestoACargoCents)`. **impuestoNeto** = `impuestoACargoCents − descuento` = TOTAL VINCULANTE.
- **Split crédito/tope:** el **crédito** (independiente del impuesto) se computa y persiste en la **confirmación del hecho**, en **una sola transacción con `reconcileFact`** (cierra el gap de atomicidad Ola-0). El **tope** (necesita el impuesto, que sólo existe en report-time) se aplica en `/api/tax-planning` como neteo read-side; el reporte **no persiste**.
- **Base del impuesto:** el `impuestoACargoCents` producido por el LLM (`= MAX(rentaOrdinaria35, TMT15)`), overlay determinista sobre base LLM (deviation Élite documentada).
- **NIIF:** sin cambio de números (a lo sumo nota narrativa en Ola 2).

**Tech Stack:** TypeScript · Drizzle (Postgres, transacciones) · Zod · Vitest (todo el cálculo puro + params) · MoneyCop BigInt.

## Global Constraints

- **Registro normativo = fuente única (spec §4, sin literales hardcodeados):** el `0.25` de la tasa y el `25` del tope viven en `rules-registry.ts`. Se **añade** `tasaDescuentoPct: 25` a la regla `descuento_donaciones_257` (ya existe con `limitePctImpuesto: 25`, `uvt2026`, `version: '2023'`, vigencia abierta 2023+). `resolveRule` ya es **fail-loud** (lanza si no hay regla vigente / key desconocida) — sin código nuevo para eso.
- **MoneyCop:** montos como string de centavos. `money.ts` hoy expone parse/serialize/format/sum/sub/equals — **falta `pct` y `min`**. Se añaden `pctFloorMoneyCop` (trunca hacia abajo = floor para positivos, defensa Art. 647) y `minMoneyCop`. Cálculo en BigInt, `BigInt(0)` (no `0n`, target ES2017).
- **Atomicidad (Ola-0 follow-up #2):** `reconcileFact` corre su propia txn y `persistDecisionRecord` es un insert aparte → NO componibles. C3 extrae `reconcileFactCore(tx, input)` (corre dentro de una txn provista) y añade `confirmFactWithDecision` que envuelve reconcile + cálculo del crédito + insert del decision record en **una** txn. `reconcileFact` se conserva (delega a `reconcileFactCore`), sin romper sus tests.
- **Un decision record por fila-nueva de donación:** sólo se persiste cuando `decision.action ∈ {ADD, SUPERSEDE}` (hay fila nueva). En `NOOP` (re-registro idéntico) NO se duplica el record (la fila existente ya tiene el suyo).
- **Fail-loud en confirmación de donación:** `resolveRule('descuento_donaciones_257', período)` puede lanzar → hace rollback de toda la confirmación (el hecho NO se guarda sin su descuento auditado). El período de una donación es no-nulo garantizado (`assertFactInputValid`). Los callers (tool de chat, action del panel) traducen el throw a un mensaje accionable.
- **Élite / integridad aritmética:** el neteo NO toca el balance (Activo=Pasivo+Patrimonio) — es un descuento tributario, no un asiento. `impuestoNeto = impuesto − min(crédito, tope)` debe recomputar EXACTO (cubierto por los tests deterministas de C2).
- **Tenancy:** `getActiveFacts(workspaceId, período)` y todos los inserts scopeados por `workspaceId`; el report-time resuelve `workspaceId` del cookie (`getCurrentWorkspaceId`), nunca del body.
- **WIP ajeno intacto:** stage SOLO rutas exactas. No `git add -A`.
- **Gates:** `npx vitest run src/lib/facts src/lib/normativa src/lib/agents/financial/contracts` · `npx tsc --noEmit` · `npm run build` · `npm run lint:strict-mode`.

---

## File Structure

| Archivo | Responsabilidad | Task |
|---|---|---|
| `src/lib/agents/financial/contracts/money.ts` (mod) + su test | `pctFloorMoneyCop` + `minMoneyCop` | C1 |
| `src/lib/normativa/rules-registry.ts` (mod) | Añadir `tasaDescuentoPct: 25` al rule 257 | C2 |
| `src/lib/normativa/descuento-donaciones-257.ts` (crear) + test | `art257Params` + `computeCredito257` + `computeDescuentoAplicado257` | C2 |
| `src/lib/db/facts.ts` (mod) | `reconcileFactCore(tx,…)` + `confirmFactWithDecision` (atómico) | C3 |
| `src/lib/agents/tools/registry.ts` (mod) | Tool de chat → `confirmFactWithDecision` + fail-loud msg | C3 |
| `src/lib/facts/actions/contexto-actions.ts` (mod) | Panel → `confirmFactWithDecision` | C3 |
| `src/lib/agents/financial/tax-planning/{types,agents/tax-optimizer,orchestrator}.ts` + route (mod) | Exponer `impuestoACargoCents`, neteo determinista, bloque TOTAL VINCULANTE, `workspaceId` | C4 |

---

## Task C1: MoneyCop `pctFloorMoneyCop` + `minMoneyCop`

**Files:**
- Modify: `src/lib/agents/financial/contracts/money.ts`
- Test: `src/lib/agents/financial/contracts/__tests__/money.test.ts` (crear si no existe)

**Interfaces:**
- Produces: `pctFloorMoneyCop(value: string, pct: number): string` (floor para positivos), `minMoneyCop(a: string, b: string): string`.

- [ ] **Step 1: Test que falla** — crear/añadir en `src/lib/agents/financial/contracts/__tests__/money.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pctFloorMoneyCop, minMoneyCop } from '../money';

describe('pctFloorMoneyCop', () => {
  it('25% de 5.000.000.000 centavos = 1.250.000.000', () => {
    expect(pctFloorMoneyCop('5000000000', 25)).toBe('1250000000');
  });
  it('trunca hacia abajo (floor) — 25% de 101 = 25 (no 25.25)', () => {
    expect(pctFloorMoneyCop('101', 25)).toBe('25');
  });
  it('0% → 0 ; 100% → identidad', () => {
    expect(pctFloorMoneyCop('12345', 0)).toBe('0');
    expect(pctFloorMoneyCop('12345', 100)).toBe('12345');
  });
});

describe('minMoneyCop', () => {
  it('devuelve el menor', () => {
    expect(minMoneyCop('1250000000', '3000000000')).toBe('1250000000');
    expect(minMoneyCop('3000000000', '1250000000')).toBe('1250000000');
  });
  it('iguales → devuelve a', () => {
    expect(minMoneyCop('100', '100')).toBe('100');
  });
});
```

- [ ] **Step 2: RED** — `npx vitest run src/lib/agents/financial/contracts/__tests__/money.test.ts` → FAIL (`pctFloorMoneyCop`/`minMoneyCop` no existen).

- [ ] **Step 3: Implementar** — añadir al final de `src/lib/agents/financial/contracts/money.ts`:

```ts
/**
 * Porcentaje entero de un MoneyCop, TRUNCADO hacia abajo (floor para valores
 * positivos: BigInt divide truncando hacia cero). Floor-bias deliberado para
 * defensa Art. 647 (un descuento nunca sobreestimado). `pct` es entero (ej. 25).
 * Pensado para montos NO negativos (donación, impuesto).
 */
export function pctFloorMoneyCop(value: string, pct: number): string {
  if (!Number.isInteger(pct) || pct < 0) {
    throw new Error(`pctFloorMoneyCop: pct debe ser entero >= 0 (recibido ${pct}).`);
  }
  return serializeMoneyCop((parseMoneyCop(value) * BigInt(pct)) / BigInt(100));
}

/** Menor de dos MoneyCop (comparación en centavos). Empate → devuelve `a`. */
export function minMoneyCop(a: string, b: string): string {
  return parseMoneyCop(a) <= parseMoneyCop(b) ? a : b;
}
```

- [ ] **Step 4: GREEN** — `npx vitest run src/lib/agents/financial/contracts/__tests__/money.test.ts` → PASS.

- [ ] **Step 5: tsc + lint** — `npx tsc --noEmit` (0) · `npm run lint:strict-mode` (pass).

- [ ] **Step 6: Commit**

```bash
git add src/lib/agents/financial/contracts/money.ts src/lib/agents/financial/contracts/__tests__/money.test.ts
git commit -m "feat(facts): MoneyCop pctFloor + min helpers (floor-bias Art.647) (Ola 1C)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task C2: Registro (tasa) + módulo de cálculo determinista Art. 257

**Files:**
- Modify: `src/lib/normativa/rules-registry.ts`
- Create: `src/lib/normativa/descuento-donaciones-257.ts`
- Test: `src/lib/normativa/__tests__/descuento-donaciones-257.test.ts`

**Interfaces:**
- Consumes: `resolveRule` / `NormativeRuleVersion` (`./rules-registry`), `pctFloorMoneyCop` / `minMoneyCop` / `subMoneyCop` (C1).
- Produces:
  - `art257Params(rule: NormativeRuleVersion): { tasaDescuentoPct: number; limitePctImpuesto: number }`
  - `computeCredito257(montoCentavos: string, tasaDescuentoPct: number): string`
  - `computeDescuentoAplicado257(args: { creditoCents: string; impuestoBaseCents: string; limitePctImpuesto: number }): { limiteCents: string; descuentoCents: string; impuestoNetoCents: string }`

- [ ] **Step 1: Añadir la tasa al registro** — en `src/lib/normativa/rules-registry.ts`, cambiar los `params` de la única versión de `descuento_donaciones_257`:

```ts
      params: { articulo: '257 E.T.', tasaDescuentoPct: 25, limitePctImpuesto: 25, uvt2026: 52374 },
```

- [ ] **Step 2: Test que falla** — crear `src/lib/normativa/__tests__/descuento-donaciones-257.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveRule } from '../rules-registry';
import {
  art257Params,
  computeCredito257,
  computeDescuentoAplicado257,
} from '../descuento-donaciones-257';

describe('art257Params', () => {
  it('extrae tasa y tope del rule 2023', () => {
    const rule = resolveRule('descuento_donaciones_257', '2026');
    expect(art257Params(rule)).toEqual({ tasaDescuentoPct: 25, limitePctImpuesto: 25 });
    expect(rule.version).toBe('2023');
  });
  it('lanza si falta un param numérico', () => {
    const bad = { ...resolveRule('descuento_donaciones_257', '2026'), params: { limitePctImpuesto: 25 } };
    expect(() => art257Params(bad)).toThrow(/tasaDescuentoPct/);
  });
});

describe('computeCredito257', () => {
  it('crédito = 25% del valor donado', () => {
    expect(computeCredito257('5000000000', 25)).toBe('1250000000'); // $50M → $12.5M
  });
});

describe('computeDescuentoAplicado257', () => {
  it('el tope NO limita cuando el crédito es menor', () => {
    // crédito 1.25e9 ; impuesto 10e9 → tope 25% = 2.5e9 ; descuento = min(1.25e9, 2.5e9) = 1.25e9
    expect(
      computeDescuentoAplicado257({ creditoCents: '1250000000', impuestoBaseCents: '10000000000', limitePctImpuesto: 25 }),
    ).toEqual({ limiteCents: '2500000000', descuentoCents: '1250000000', impuestoNetoCents: '8750000000' });
  });
  it('el tope LIMITA cuando el crédito excede 25% del impuesto', () => {
    // crédito 1.25e9 ; impuesto 4e9 → tope 25% = 1e9 ; descuento = min(1.25e9, 1e9) = 1e9
    expect(
      computeDescuentoAplicado257({ creditoCents: '1250000000', impuestoBaseCents: '4000000000', limitePctImpuesto: 25 }),
    ).toEqual({ limiteCents: '1000000000', descuentoCents: '1000000000', impuestoNetoCents: '3000000000' });
  });
});
```

- [ ] **Step 3: RED** — `npx vitest run src/lib/normativa/__tests__/descuento-donaciones-257.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 4: Implementar `src/lib/normativa/descuento-donaciones-257.ts`**

```ts
// Cálculo DETERMINISTA del descuento por donaciones (Art. 257 E.T.). PURO —
// los porcentajes salen del registro normativo (fuente única, sin literales
// hardcodeados). Split crédito/tope: el CRÉDITO (25% de la donación) es
// independiente del impuesto (se computa en la confirmación del hecho); el TOPE
// (25% del impuesto) se aplica en el reporte, donde existe el impuesto.

import type { NormativeRuleVersion } from './rules-registry';
import { pctFloorMoneyCop, minMoneyCop, subMoneyCop } from '@/lib/agents/financial/contracts/money';

/** Extrae y valida los porcentajes del rule resuelto. Fail-loud si faltan. */
export function art257Params(rule: NormativeRuleVersion): {
  tasaDescuentoPct: number;
  limitePctImpuesto: number;
} {
  const tasa = rule.params.tasaDescuentoPct;
  const tope = rule.params.limitePctImpuesto;
  if (typeof tasa !== 'number') {
    throw new Error('Regla 257: falta el param numérico "tasaDescuentoPct" (rules-registry.ts).');
  }
  if (typeof tope !== 'number') {
    throw new Error('Regla 257: falta el param numérico "limitePctImpuesto" (rules-registry.ts).');
  }
  return { tasaDescuentoPct: tasa, limitePctImpuesto: tope };
}

/** Crédito Art. 257 = tasa% del valor donado (floor). Independiente del impuesto. */
export function computeCredito257(montoCentavos: string, tasaDescuentoPct: number): string {
  return pctFloorMoneyCop(montoCentavos, tasaDescuentoPct);
}

/**
 * Aplica el tope (limitePct% del impuesto) al crédito y netea:
 * descuento = min(crédito, 25% × impuesto) ; impuestoNeto = impuesto − descuento.
 */
export function computeDescuentoAplicado257(args: {
  creditoCents: string;
  impuestoBaseCents: string;
  limitePctImpuesto: number;
}): { limiteCents: string; descuentoCents: string; impuestoNetoCents: string } {
  const limiteCents = pctFloorMoneyCop(args.impuestoBaseCents, args.limitePctImpuesto);
  const descuentoCents = minMoneyCop(args.creditoCents, limiteCents);
  const impuestoNetoCents = subMoneyCop(args.impuestoBaseCents, descuentoCents);
  return { limiteCents, descuentoCents, impuestoNetoCents };
}
```

- [ ] **Step 5: GREEN** — `npx vitest run src/lib/normativa/__tests__/descuento-donaciones-257.test.ts` → PASS.

- [ ] **Step 6: tsc + lint + build** — `npx tsc --noEmit` (0) · `npm run lint:strict-mode` · `npm run build` (OK — la tasa nueva no rompe consumers del registry).

- [ ] **Step 7: Commit**

```bash
git add src/lib/normativa/rules-registry.ts src/lib/normativa/descuento-donaciones-257.ts src/lib/normativa/__tests__/descuento-donaciones-257.test.ts
git commit -m "feat(facts): cálculo determinista Art.257 (crédito+tope) + tasa en el registro (Ola 1C)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task C3: Confirmación atómica (reconcile + decision record en 1 txn)

**Files:**
- Modify: `src/lib/db/facts.ts`, `src/lib/agents/tools/registry.ts`, `src/lib/facts/actions/contexto-actions.ts`

**Interfaces:**
- Produces: `confirmFactWithDecision(input): Promise<{ decision: ReconcileDecision; fact: WorkspaceFact | null; decisionRecord: FactDecisionRecord | null }>` — misma entrada que `reconcileFact` (incl. `supersedesId?`). Para `kind='donation'` con fila nueva, computa el crédito y persiste el decision record en la MISMA txn.
- Internal: `reconcileFactCore(tx, input)` — la lógica de reconcile corriendo dentro de una txn provista.

- [ ] **Step 1: Refactor `reconcileFact` → `reconcileFactCore(tx, …)` en `src/lib/db/facts.ts`**

Añadir imports (junto a los existentes):

```ts
import { resolveRule } from '@/lib/normativa/rules-registry';
import { art257Params, computeCredito257 } from '@/lib/normativa/descuento-donaciones-257';
import type { PgTransaction } from 'drizzle-orm/pg-core';
```

> Nota de tipo: usar el tipo del callback de `db.transaction` para `tx`. Si `PgTransaction` genérico es engorroso, tipar `tx` como `Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]` o extraer `type Tx = Parameters<typeof cb>` — el implementador elige la forma que compile limpio; lo esencial: `reconcileFactCore(tx, input)` recibe el mismo objeto `tx` que hoy usa el `db.transaction(async (tx) => …)`.

Extraer el cuerpo actual de `reconcileFact` (todo salvo la firma pública) a:

```ts
async function reconcileFactCore(
  tx: DbTx,
  input: {
    workspaceId: string;
    kind: FactKind;
    content: FactContent;
    fiscalPeriod: string | null;
    source: 'chat' | 'manual';
    supersedesId?: string | null;
  },
): Promise<{ decision: ReconcileDecision; fact: WorkspaceFact | null }> {
  // === cuerpo ACTUAL de reconcileFact, con estos cambios mecánicos: ===
  //  - usar `tx` en TODAS las queries (select/insert/update) en vez de `db` y `db.transaction`.
  //  - las ramas que hoy abren `db.transaction(async (tx2) => …)` ya NO abren txn:
  //    corren directamente sobre el `tx` provisto (el caller ya está en una txn).
  //  - la normalización de período narrativo→null y la rama supersedesId se preservan idénticas.
}
```

Y reescribir la firma pública para delegar:

```ts
export async function reconcileFact(input: {
  workspaceId: string;
  kind: FactKind;
  content: FactContent;
  fiscalPeriod: string | null;
  source: 'chat' | 'manual';
  supersedesId?: string | null;
}): Promise<{ decision: ReconcileDecision; fact: WorkspaceFact | null }> {
  const db = getDb();
  return db.transaction((tx) => reconcileFactCore(tx, input));
}
```

Definir el alias `DbTx` cerca de los imports:

```ts
type DbTx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];
```

- [ ] **Step 2: Añadir `confirmFactWithDecision` en `src/lib/db/facts.ts`** (tras `reconcileFact`)

```ts
/**
 * Confirma un hecho Y, si es una donación con fila nueva, computa el crédito
 * Art. 257 determinista y persiste su decision record — TODO en UNA transacción
 * (cierra el gap de atomicidad Ola-0). El tope (25% del impuesto) NO se aplica
 * aquí: necesita el impuesto (report-time). Fail-loud: si no hay regla vigente,
 * la txn hace rollback y el hecho NO se guarda.
 */
export async function confirmFactWithDecision(input: {
  workspaceId: string;
  kind: FactKind;
  content: FactContent;
  fiscalPeriod: string | null;
  source: 'chat' | 'manual';
  supersedesId?: string | null;
}): Promise<{
  decision: ReconcileDecision;
  fact: WorkspaceFact | null;
  decisionRecord: FactDecisionRecord | null;
}> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const { decision, fact } = await reconcileFactCore(tx, input);

    // Sólo donaciones con fila NUEVA (ADD/SUPERSEDE) generan decision record.
    if (input.kind !== 'donation' || fact === null || decision.action === 'NOOP') {
      return { decision, fact, decisionRecord: null };
    }

    // Donación material → período no-nulo garantizado por assertFactInputValid.
    const period = input.fiscalPeriod ?? fact.fiscalPeriod;
    if (period === null) {
      throw new Error('confirmFactWithDecision: donación sin período — inválida (assertFactInputValid).');
    }
    const rule = resolveRule('descuento_donaciones_257', period); // fail-loud
    const { tasaDescuentoPct } = art257Params(rule);
    const montoCentavos =
      typeof (fact.structured as { montoCentavos?: unknown } | null)?.montoCentavos === 'string'
        ? (fact.structured as { montoCentavos: string }).montoCentavos
        : '0';
    const creditoCents = computeCredito257(montoCentavos, tasaDescuentoPct);

    const [decisionRecord] = await tx
      .insert(factDecisionRecords)
      .values({
        workspaceId: input.workspaceId,
        factId: fact.id,
        ruleKey: 'descuento_donaciones_257',
        ruleVersion: rule.version,
        inputs: { montoCentavos, tasaDescuentoPct },
        resultado: { creditoCents },
      })
      .returning();

    return { decision, fact, decisionRecord };
  });
}
```

- [ ] **Step 3: Wire la tool de chat (`src/lib/agents/tools/registry.ts`)** — en el `case 'registrar_hecho_negocio':`, reemplazar el import/uso de `reconcileFact` por `confirmFactWithDecision`, envuelto en try/catch para el fail-loud:

```ts
      let decision, fact;
      try {
        const { reconcileFact: _omit, ...rest } = await import('@/lib/db/facts');
        void _omit;
        const res = await rest.confirmFactWithDecision({
          workspaceId: ctx.workspaceId,
          kind: input.kind,
          content: { title: input.title, body: input.body, structured: input.structured },
          fiscalPeriod: input.fiscalPeriod,
          source: 'chat',
        });
        decision = res.decision;
        fact = res.fact;
      } catch (err) {
        // Fail-loud del registro normativo (p.ej. sin regla vigente para el período).
        return {
          content: `NO_REGISTRADO: no se pudo calcular el descuento normativo (${err instanceof Error ? err.message : 'error'}). Avísale al usuario y no reintentes sin corregir el período.`,
        };
      }
```

> El resto del `case` (construcción de `periodTxt` gateado por kind, y `msg` por `decision.action`) queda **idéntico** — `decision`/`fact` tienen la misma forma. (El import dinámico simple `const { confirmFactWithDecision } = await import('@/lib/db/facts');` es preferible si no molesta al linter; el implementador usa la forma que compile limpio.)

- [ ] **Step 4: Wire el panel (`src/lib/facts/actions/contexto-actions.ts`)** — en `registerManualFactAction`, reemplazar la llamada a `reconcileFact` por `confirmFactWithDecision` (mismo objeto + `supersedesId`):

```ts
    const { reconcileFact } = await import(''); // (eliminar el import estático de reconcileFact si queda sin uso)
```

Concretamente: cambiar el import de `@/lib/db/facts` de `reconcileFact` a `confirmFactWithDecision`, y la llamada:

```ts
    const { decision, fact } = await confirmFactWithDecision({
      workspaceId: ws.id,
      kind: input.kind,
      content: { title: input.title, body: input.body, structured: input.structured },
      fiscalPeriod: input.fiscalPeriod,
      source: 'manual',
      supersedesId: supersedesId ?? null,
    });
```

El `try/catch` existente ya atrapa el throw del fail-loud → devuelve `{ ok:false, code:'INTERNAL' }` (aceptable para el piloto; el período de una donación es válido ≥2023 y la regla es vigente). `revokeFact` sigue usando `reconcileFact`? No — `revokeFactAction` usa `revokeFact`, sin cambios.

- [ ] **Step 5: tsc + build** — `npx tsc --noEmit` (0 — `confirmFactWithDecision` resuelve; `DbTx` compila; los callers cuadran). `npm run build` (OK). `npx vitest run src/lib/facts src/lib/normativa` (los tests de reconcile siguen verdes — `reconcileFact` delega a `reconcileFactCore`, comportamiento idéntico).

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/facts.ts src/lib/agents/tools/registry.ts src/lib/facts/actions/contexto-actions.ts
git commit -m "feat(facts): confirmación atómica donation+decision record en 1 txn (Ola 1C)

reconcileFactCore(tx) extraído; confirmFactWithDecision computa crédito Art.257 y
persiste el decision record en la misma txn que reconcile (cierra gap atomicidad Ola-0).
Wire tool de chat + panel; fail-loud si no hay regla vigente.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task C4: Neteo determinista del tope + TOTAL VINCULANTE en `/api/tax-planning`

**Files:**
- Modify: `src/lib/agents/financial/tax-planning/agents/tax-optimizer.ts`, `.../tax-planning/types.ts`, `.../tax-planning/orchestrator.ts`, `src/app/api/tax-planning/route.ts`

**Interfaces:**
- Consumes: `getActiveFacts` (`@/lib/db/facts`), `resolveRule` (`@/lib/normativa/rules-registry`), `art257Params` + `computeCredito257` + `computeDescuentoAplicado257` (C2), `getCurrentWorkspaceId` (`@/lib/db/workspace`), `formatCopFromCents` (money).
- Produces: `TaxOptimizerResult.impuestoACargoCents: string`; `TaxPlanningReport.donationDiscount: DonationDiscountBlock | null`; el reporte consolidado incluye una sección **TOTAL VINCULANTE** determinista.

- [ ] **Step 1: Exponer `impuestoACargoCents` desde el optimizador** — en `src/lib/agents/financial/tax-planning/agents/tax-optimizer.ts`, en `toLegacyShape(json)`, añadir el campo al objeto retornado:

```ts
  return {
    currentStructureAnalysis,
    optimizationStrategies,
    projectedSavings,
    implementationRoadmap,
    fullContent,
    impuestoACargoCents: json.currentDiagnosis.dualCalculation.impuestoACargoCents,
  };
```

- [ ] **Step 2: Extender los tipos** — en `.../tax-planning/types.ts`:

Añadir a `TaxOptimizerResult`:

```ts
  /** Impuesto a cargo del período (MAX ordinaria/TMT), en centavos MoneyCop.
   *  Base determinista para el neteo del descuento por donaciones (Art. 257). */
  impuestoACargoCents: string;
```

Y añadir el bloque + su campo en `TaxPlanningReport`:

```ts
export interface DonationDiscountBlock {
  fiscalPeriod: string;
  ruleKey: string;
  ruleVersion: string;
  montoDonadoCents: string;
  creditoCents: string;
  limiteCents: string;
  descuentoCents: string;
  impuestoACargoCents: string;
  /** TOTAL VINCULANTE: impuesto a cargo − descuento aplicado. */
  impuestoNetoCents: string;
}
```

En `TaxPlanningReport` añadir:

```ts
  /** Neteo determinista del descuento por donaciones (Art. 257). null si el
   *  workspace no tiene una donación activa para el período. */
  donationDiscount: DonationDiscountBlock | null;
```

- [ ] **Step 3: Neteo determinista en el orchestrator** — en `.../tax-planning/orchestrator.ts`:

Añadir imports:

```ts
import { getActiveFacts } from '@/lib/db/facts';
import { resolveRule } from '@/lib/normativa/rules-registry';
import { art257Params, computeCredito257, computeDescuentoAplicado257 } from '@/lib/normativa/descuento-donaciones-257';
import { formatCopFromCents, parseMoneyCop } from '../contracts/money';
import type { DonationDiscountBlock } from './types';
```

Extender `OrchestrateTaxPlanningOptions`:

```ts
export interface OrchestrateTaxPlanningOptions {
  onProgress?: (event: TaxPlanningProgressEvent) => void;
  /** Workspace del solicitante (cookie, resuelto en la route) — para leer hechos. */
  workspaceId?: string;
}
```

Tras el Stage 1 (después de `taxOptimizerResult`), añadir el paso determinista (usa `company.fiscalPeriod` + `workspaceId`):

```ts
  // ---------------------------------------------------------------------------
  // Neteo determinista: descuento por donaciones (Art. 257) → TOTAL VINCULANTE.
  // Números de cálculo determinista (no LLM): lee la donación activa del período,
  // recomputa el crédito y aplica el tope contra el impuesto a cargo del optimizador.
  // ---------------------------------------------------------------------------
  const donationDiscount = await computeDonationDiscount(
    options.workspaceId,
    company.fiscalPeriod,
    taxOptimizerResult.impuestoACargoCents,
  );
```

Y añadir el helper + la inyección del bloque. El helper (server-side; degrada a `null` si no hay ws/donación, fail-loud sólo si hay donación pero no regla):

```ts
async function computeDonationDiscount(
  workspaceId: string | undefined,
  fiscalPeriod: string,
  impuestoACargoCents: string,
): Promise<DonationDiscountBlock | null> {
  if (!workspaceId) return null;
  const facts = await getActiveFacts(workspaceId, fiscalPeriod);
  const donation = facts.find(
    (f) => f.kind === 'donation' && f.fiscalPeriod === fiscalPeriod,
  );
  if (!donation) return null;
  const montoDonadoCents =
    typeof (donation.structured as { montoCentavos?: unknown } | null)?.montoCentavos === 'string'
      ? (donation.structured as { montoCentavos: string }).montoCentavos
      : '0';
  const rule = resolveRule('descuento_donaciones_257', fiscalPeriod); // fail-loud
  const { tasaDescuentoPct, limitePctImpuesto } = art257Params(rule);
  const creditoCents = computeCredito257(montoDonadoCents, tasaDescuentoPct);
  const { limiteCents, descuentoCents, impuestoNetoCents } = computeDescuentoAplicado257({
    creditoCents,
    impuestoBaseCents: impuestoACargoCents,
    limitePctImpuesto,
  });
  return {
    fiscalPeriod,
    ruleKey: 'descuento_donaciones_257',
    ruleVersion: rule.version,
    montoDonadoCents,
    creditoCents,
    limiteCents,
    descuentoCents,
    impuestoACargoCents,
    impuestoNetoCents,
  };
}
```

Inyectar el bloque en el reporte: pasar `donationDiscount` a `buildConsolidatedReport` y renderizar una sección **antes** de la Parte I (o tras el header) sólo si `donationDiscount !== null`:

```ts
function renderDonationDiscountBlock(b: DonationDiscountBlock, language: 'es' | 'en'): string {
  const money = (c: string) => formatCopFromCents(parseMoneyCop(c), false);
  const t = (es: string, en: string) => (language === 'es' ? es : en);
  return [
    `## ${t('DESCUENTO POR DONACIONES (Art. 257 E.T.) — TOTAL VINCULANTE', 'DONATION DISCOUNT (Art. 257) — BINDING TOTAL')}`,
    `> ${t('Cálculo DETERMINISTA (no estimado por IA). Regla', 'DETERMINISTIC calc (not AI-estimated). Rule')} ${b.ruleKey} v${b.ruleVersion}.`,
    '',
    '| Concepto | Valor |',
    '|---|---|',
    `| ${t('Valor donado', 'Donation value')} | ${money(b.montoDonadoCents)} |`,
    `| ${t('Crédito Art. 257 (25%)', 'Art. 257 credit (25%)')} | ${money(b.creditoCents)} |`,
    `| ${t('Tope (25% del impuesto)', 'Cap (25% of tax)')} | ${money(b.limiteCents)} |`,
    `| ${t('Descuento aplicado', 'Applied discount')} | ${money(b.descuentoCents)} |`,
    `| ${t('Impuesto a cargo', 'Tax before discount')} | ${money(b.impuestoACargoCents)} |`,
    `| **${t('Impuesto neto (TOTAL VINCULANTE)', 'Net tax (BINDING TOTAL)')}** | **${money(b.impuestoNetoCents)}** |`,
  ].join('\n');
}
```

`buildConsolidatedReport` recibe `donationDiscount` y antepone `renderDonationDiscountBlock(...)` (si no es null) tras el `---` del header. Y el `report` objeto incluye `donationDiscount`.

- [ ] **Step 4: Resolver `workspaceId` en la route** — en `src/app/api/tax-planning/route.ts`:

Añadir import + resolverlo y pasarlo a ambas invocaciones de `orchestrateTaxPlanning` (streaming y no-streaming):

```ts
import { getCurrentWorkspaceId } from '@/lib/db/workspace';
```

Antes de invocar: `const workspaceId = (await getCurrentWorkspaceId().catch(() => null)) ?? undefined;` y pasar `{ workspaceId }` en `options` (no-streaming: 2º arg; streaming: propagar a `handleStreaming` y a su `orchestrateTaxPlanning(..., { onProgress, workspaceId })`).

- [ ] **Step 5: tsc + build** — `npx tsc --noEmit` (0) · `npm run build` (OK; `/api/tax-planning` compila; el orchestrator importa la capa de facts/normativa server-side).

- [ ] **Step 6: Commit**

```bash
git add src/lib/agents/financial/tax-planning/agents/tax-optimizer.ts src/lib/agents/financial/tax-planning/types.ts src/lib/agents/financial/tax-planning/orchestrator.ts src/app/api/tax-planning/route.ts
git commit -m "feat(facts): neteo determinista Art.257 → TOTAL VINCULANTE en /api/tax-planning (Ola 1C)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (contra las decisiones Johan + código real)

- Mecánica: crédito = 25%×donación ; descuento = min(crédito, 25%×impuestoACargo) ; impuestoNeto = impuesto − descuento → C2 (puro, testeado) + C4 (wiring). ✅
- Split crédito@confirmación / tope@reporte → C3 (crédito + decision record atómico) + C4 (tope read-side, sin persistir). ✅
- Sin literales hardcodeados: tasa+tope en el registro (C2); `resolveRule` fail-loud reusado. ✅
- Atomicidad Ola-0 cerrada: `reconcileFactCore(tx)` + `confirmFactWithDecision` en 1 txn (C3). ✅
- 1 record por fila-nueva de donación (ADD/SUPERSEDE, no NOOP) → C3. ✅
- Base = impuestoACargoCents del LLM, expuesto desde el optimizador → C4. ✅
- TOTAL VINCULANTE renderizado como bloque DETERMINISTA marcado (no IA) → C4. ✅
- NIIF sin cambio de números. ✅ (fuera de alcance; Ola 2 = nota narrativa)
- MoneyCop floor-bias (Art. 647) → C1 `pctFloorMoneyCop`. ✅
- Tenancy: getActiveFacts scopeado; workspaceId del cookie en la route. ✅
- **Type consistency:** `pctFloorMoneyCop`/`minMoneyCop` (C1) → C2 calc → C3 (crédito) + C4 (neteo); `confirmFactWithDecision` (C3) ← tool + panel; `impuestoACargoCents` expuesto (C4 step1) ← neteo (C4 step3). ✅
- **Riesgos a vigilar (para el review):** (a) el tipo `DbTx` debe compilar limpio — si el genérico de Drizzle es problemático, el implementador reporta DONE_WITH_CONCERNS; (b) el import dinámico en la tool (registry.ts) debe quedar simple; (c) el fail-loud en el panel cae a `INTERNAL` (mensaje genérico) — aceptable piloto, follow-up: mapear a un code 'RULE'.
- **Fuera de alcance:** confirmación pre-reporte "N hechos se incluirán" + narrativos→`<hechos_empresa>` = **Ola 2**. El "Aparece en" del panel = Ola 2.

### Regresión Élite (verificación C2 + fixture)
Los tests deterministas de C2 (tope-no-limita / tope-limita / impuestoNeto exacto) SON la regresión Art. 647 del neteo. El balance (Activo=Pasivo+Patrimonio) no lo toca un descuento tributario.

### Verificación final de rama (tras C1-C4)
- `npx vitest run src/lib/facts src/lib/normativa src/lib/agents/financial/contracts` · `npx tsc --noEmit` · `npm run build` · `npm run lint:strict-mode`
