# Hechos del negocio — Ola 1 · E2 (Narrativos por id explícito) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que **múltiples narrativos coexistan** (la memoria de contexto empresarial acumula prosa, no la colapsa) y que **editar** un hecho supersede **exactamente ese hecho por id** — sin migración de DB. Hoy `reconcileFact` reconcilia por `(kind, período)`, así que un segundo narrativo distinto SUPERSEDE al primero (máx. 1 narrativo activo por período). Decisión Johan (2026-07-20): narrativos **atemporales** (período normalizado a `null`, coexisten porque los NULL son distintos en `uq_active_fact`), nunca SUPERSEDE entre sí (NOOP si idénticos), y `reconcileFact` gana un `supersedesId` para la edición explícita.

**Architecture:** (1) `decideReconciliation` se vuelve kind-aware: narrativos nunca superseden (NOOP-idéntico / ADD-distinto); estructurados sin cambio. (2) `reconcileFact` normaliza el período de narrativos a `null`, pasa `kind` a la decisión, y añade una rama `supersedesId` (revoca ese id exacto → inserta → enlaza). (3) El panel pasa el id del hecho editado como `supersedesId`; el form de narrativos deja de pedir período (es atemporal). La tool de chat de Team A **no cambia su llamada** (`supersedesId` es opcional). **Sin migración** — el índice `uq_active_fact` queda intacto (NULLs distintos).

**Tech Stack:** TypeScript · Drizzle (Postgres) · Vitest (la decisión pura) · React 19 (Server Actions).

## Global Constraints

- **Sin migración de DB.** No se toca `schema-facts.ts` ni `uq_active_fact`. La coexistencia de narrativos se logra normalizando su período a `null` (los NULL son distintos en el índice único parcial).
- **`decideReconciliation` gana un 3er parámetro `kind: FactKind` (REQUERIDO).** Su único caller de producción es `reconcileFact` (`src/lib/db/facts.ts`); su único otro caller son sus tests. Ambos se actualizan en la MISMA task (E2a) para que `tsc` no rompa.
- **Narrativos son atemporales:** `reconcileFact` fuerza `fiscalPeriod = null` cuando `kind === 'narrative'`, en el único punto autoritativo (así lo cumplen tanto la tool de chat como el panel). El form de narrativos no muestra período.
- **`supersedesId` es opcional** en `reconcileFact` y en `registerManualFactAction` → la tool de chat de Team A (que no lo pasa) sigue igual: captura de narrativo → ADD/NOOP; captura de donación → reconcile por período.
- **Contrato de orden preservado:** `reconcileFact` sigue pasando los activos en orden ASCENDENTE por `createdAt` a `decideReconciliation` (el `[length-1]` = más reciente, para el SUPERSEDE defensivo de estructurados).
- **Tenancy:** todas las queries/updates siguen scopeadas por `workspaceId`. El `supersedesId` se revoca sólo si es del mismo workspace y está `active`.
- **WIP ajeno intacto:** stage SOLO rutas exactas. No `git add -A`.
- **Gates:** `npx vitest run src/lib/facts` · `npx tsc --noEmit` · `npm run build` · `npm run lint:strict-mode`.

---

## File Structure

| Archivo | Responsabilidad | Task |
|---|---|---|
| `src/lib/facts/reconcile.ts` (modificar) | `decideReconciliation(candidate, existing, kind)` — narrativos nunca SUPERSEDE | E2a |
| `src/lib/facts/__tests__/reconcile.test.ts` (modificar) | Actualizar llamadas (+kind) + tests de narrativos | E2a |
| `src/lib/db/facts.ts` (modificar) | `reconcileFact`: normaliza narrativo→null, pasa kind, rama `supersedesId` | E2a |
| `src/lib/facts/actions/contexto-actions.ts` (modificar) | `registerManualFactAction(rawInput, supersedesId?)` | E2b |
| `src/components/workspace/contexto/ContextoPanel.tsx` (modificar) | `submit` pasa `editKey` como `supersedesId` | E2b |
| `src/components/workspace/contexto/FactForm.tsx` (modificar) | Período sólo para donación (narrativos atemporales) | E2b |

---

## Task E2a: Reconcile core — narrativos coexisten + supersede por id

**Files:**
- Modify: `src/lib/facts/reconcile.ts`, `src/lib/db/facts.ts`
- Test: `src/lib/facts/__tests__/reconcile.test.ts`

**Interfaces:**
- Produces: `decideReconciliation(candidate: FactContent, existingActive: Array<FactContent & {id:string}>, kind: FactKind): ReconcileDecision` (kind requerido; narrativo nunca SUPERSEDE). `reconcileFact` gana `supersedesId?: string | null` en su input y normaliza `fiscalPeriod` de narrativos a `null`.
- Consumes: `FactKind` (`@/lib/facts/contracts`).

- [ ] **Step 1: Actualizar los tests (RED)** — reescribir `src/lib/facts/__tests__/reconcile.test.ts` para pasar `kind` en cada llamada + añadir el bloque de narrativos:

```ts
import { describe, expect, it } from 'vitest';
import { decideReconciliation, factContentEquals } from '../reconcile';

const donation = (montoCentavos: string) => ({
  title: 'Donación fundación X',
  body: 'Donación a la fundación X.',
  structured: { montoCentavos, articulo: '257', fiscalYear: '2026' },
});

const donationReorderedKeys = (montoCentavos: string) => ({
  title: 'Donación fundación X',
  body: 'Donación a la fundación X.',
  structured: { fiscalYear: '2026', articulo: '257', montoCentavos },
});

describe('decideReconciliation — estructurados (donation)', () => {
  it('ADD cuando no hay hechos activos equivalentes', () => {
    expect(decideReconciliation(donation('5000000000'), [], 'donation')).toEqual({ action: 'ADD' });
  });

  it('NOOP cuando el hecho ya existe idéntico', () => {
    const existing = { id: 'f1', ...donation('5000000000') };
    expect(decideReconciliation(donation('5000000000'), [existing], 'donation')).toEqual({
      action: 'NOOP',
      existingId: 'f1',
    });
  });

  it('SUPERSEDE cuando existe uno del mismo tipo/período con datos distintos', () => {
    const existing = { id: 'f1', ...donation('5000000000') };
    expect(decideReconciliation(donation('4500000000'), [existing], 'donation')).toEqual({
      action: 'SUPERSEDE',
      existingId: 'f1',
    });
  });

  it('SUPERSEDE contra el más reciente cuando (defensivo) hay más de un activo', () => {
    const older = { id: 'f1', ...donation('5000000000') };
    const newer = { id: 'f2', ...donation('4800000000') };
    const d = decideReconciliation(donation('4500000000'), [older, newer], 'donation');
    expect(d).toEqual({ action: 'SUPERSEDE', existingId: 'f2' });
  });

  it('NOOP cuando el candidato reordena las claves de structured (igualdad estable)', () => {
    const existing = { id: 'f1', ...donation('5000000000') };
    expect(decideReconciliation(donationReorderedKeys('5000000000'), [existing], 'donation')).toEqual({
      action: 'NOOP',
      existingId: 'f1',
    });
  });

  it('NOOP gana sobre SUPERSEDE cuando hay >1 activo y el candidato iguala a uno', () => {
    const older = { id: 'f1', ...donation('5000000000') };
    const newer = { id: 'f2', ...donation('4800000000') };
    expect(decideReconciliation(donation('4800000000'), [older, newer], 'donation')).toEqual({
      action: 'NOOP',
      existingId: 'f2',
    });
  });
});

describe('decideReconciliation — narrativos coexisten (nunca SUPERSEDE)', () => {
  const narr = (body: string) => ({ title: 'Contexto', body, structured: null });

  it('ADD cuando hay un narrativo activo DISTINTO (no supersede al previo)', () => {
    const existing = { id: 'n1', ...narr('Somos una SaaS B2B.') };
    expect(decideReconciliation(narr('Tenemos 3 socios.'), [existing], 'narrative')).toEqual({
      action: 'ADD',
    });
  });

  it('NOOP cuando el narrativo es idéntico (idempotencia)', () => {
    const existing = { id: 'n1', ...narr('Somos una SaaS B2B.') };
    expect(decideReconciliation(narr('Somos una SaaS B2B.'), [existing], 'narrative')).toEqual({
      action: 'NOOP',
      existingId: 'n1',
    });
  });

  it('ADD aunque haya varios narrativos activos, si el candidato es nuevo', () => {
    const a = { id: 'n1', ...narr('Somos una SaaS B2B.') };
    const b = { id: 'n2', ...narr('Tenemos 3 socios.') };
    expect(decideReconciliation(narr('Levantamos ronda seed.'), [a, b], 'narrative')).toEqual({
      action: 'ADD',
    });
  });
});

describe('factContentEquals', () => {
  it('true con las mismas entradas de structured y distinto orden de claves', () => {
    expect(factContentEquals(donation('5000000000'), donationReorderedKeys('5000000000'))).toBe(true);
  });
});
```

- [ ] **Step 2: Correr los tests → RED**

Run: `npx vitest run src/lib/facts/__tests__/reconcile.test.ts`
Expected: FAIL de compilación/tipo — `decideReconciliation` aún acepta 2 args (los tests pasan 3) y no existe la rama narrativa. (También `tsc` rompería en `facts.ts` hasta el Step 4 — es esperado dentro de esta task.)

- [ ] **Step 3: Actualizar `src/lib/facts/reconcile.ts`** — importar `FactKind` y añadir el parámetro + la rama narrativa:

Cambiar el import:

```ts
import type { FactContent, FactKind } from './contracts';
```

Reemplazar la firma+cuerpo de `decideReconciliation` por:

```ts
/**
 * Decide qué hacer con `candidate` frente a los hechos activos equivalentes.
 *
 * ESTRUCTURADOS (donation/leasing/loss): invariante ≤1 activo por kind+período
 * (índice `uq_active_fact`). Un contenido distinto en el mismo período es una
 * CORRECCIÓN → SUPERSEDE el MÁS RECIENTE. CONTRATO DE ORDEN: el caller pasa los
 * activos ASCENDENTE por `createdAt`, así `existingActive[length-1]` es el más reciente.
 *
 * NARRATIVOS: son memoria de contexto ACUMULATIVA — dos narrativos distintos
 * COEXISTEN (nunca supersede por período). Sólo un contenido idéntico hace NOOP
 * (idempotencia). Combinado con la normalización de su período a null en
 * `reconcileFact`, múltiples narrativos activos conviven sin chocar con el índice.
 */
export function decideReconciliation(
  candidate: FactContent,
  existingActive: Array<FactContent & { id: string }>,
  kind: FactKind,
): ReconcileDecision {
  if (existingActive.length === 0) return { action: 'ADD' };
  const match = existingActive.find((e) => factContentEquals(candidate, e));
  if (match) return { action: 'NOOP', existingId: match.id };
  if (kind === 'narrative') return { action: 'ADD' };
  return { action: 'SUPERSEDE', existingId: existingActive[existingActive.length - 1].id };
}
```

- [ ] **Step 4: Actualizar `src/lib/db/facts.ts` (`reconcileFact`)** — reemplazar la función `reconcileFact` completa (desde `export async function reconcileFact(input: {` hasta su `}` de cierre) por:

```ts
export async function reconcileFact(input: {
  workspaceId: string;
  kind: FactKind;
  content: FactContent;
  fiscalPeriod: string | null;
  source: 'chat' | 'manual';
  /** Edición explícita (panel): supersede EXACTAMENTE este hecho por id. */
  supersedesId?: string | null;
}): Promise<{ decision: ReconcileDecision; fact: WorkspaceFact | null }> {
  const db = getDb();

  // Narrativos son ATEMPORALES: se normaliza el período a null (contexto que
  // alimenta TODOS los reportes). Los NULL son distintos en `uq_active_fact`,
  // así múltiples narrativos activos coexisten sin colisión.
  const fiscalPeriod = input.kind === 'narrative' ? null : input.fiscalPeriod;
  const supersedesId = input.supersedesId ?? null;

  const insertValues = {
    workspaceId: input.workspaceId,
    kind: input.kind,
    title: input.content.title,
    body: input.content.body,
    structured: input.content.structured ?? null,
    fiscalPeriod,
    source: input.source,
  };

  // Edición explícita por id: revoca ese hecho exacto (si sigue activo) e inserta
  // la versión nueva enlazada. No reconcilia por período — el usuario editó ESE hecho.
  if (supersedesId) {
    return db.transaction(async (tx) => {
      const [revoked] = await tx
        .update(workspaceFacts)
        .set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(workspaceFacts.id, supersedesId),
            eq(workspaceFacts.workspaceId, input.workspaceId),
            eq(workspaceFacts.status, 'active'),
          ),
        )
        .returning();
      const [created] = await tx.insert(workspaceFacts).values(insertValues).returning();
      if (revoked) {
        await tx
          .update(workspaceFacts)
          .set({ supersededById: created.id })
          .where(
            and(eq(workspaceFacts.id, supersedesId), eq(workspaceFacts.workspaceId, input.workspaceId)),
          );
        return { decision: { action: 'SUPERSEDE', existingId: supersedesId }, fact: created };
      }
      // El objetivo ya no estaba activo (revocado en otra pestaña): degradar a ADD.
      return { decision: { action: 'ADD' }, fact: created };
    });
  }

  // Reconciliación por (kind, período) — captura por chat o registro nuevo del panel.
  const periodClause =
    fiscalPeriod === null
      ? isNull(workspaceFacts.fiscalPeriod)
      : eq(workspaceFacts.fiscalPeriod, fiscalPeriod);
  const existing = await db
    .select()
    .from(workspaceFacts)
    .where(
      and(
        eq(workspaceFacts.workspaceId, input.workspaceId),
        eq(workspaceFacts.kind, input.kind),
        eq(workspaceFacts.status, 'active'),
        periodClause,
      ),
    )
    // Orden ASCENDENTE: contrato con decideReconciliation → el último es el más reciente.
    .orderBy(asc(workspaceFacts.createdAt));

  const decision = decideReconciliation(
    input.content,
    existing.map((e) => ({ id: e.id, title: e.title, body: e.body, structured: e.structured ?? null })),
    input.kind,
  );

  if (decision.action === 'NOOP') {
    const kept = existing.find((e) => e.id === decision.existingId) ?? null;
    return { decision, fact: kept };
  }

  return db.transaction(async (tx) => {
    if (decision.action === 'SUPERSEDE') {
      await tx
        .update(workspaceFacts)
        .set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(workspaceFacts.id, decision.existingId),
            eq(workspaceFacts.workspaceId, input.workspaceId),
          ),
        );
    }
    const [created] = await tx.insert(workspaceFacts).values(insertValues).returning();
    if (decision.action === 'SUPERSEDE') {
      await tx
        .update(workspaceFacts)
        .set({ supersededById: created.id })
        .where(
          and(
            eq(workspaceFacts.id, decision.existingId),
            eq(workspaceFacts.workspaceId, input.workspaceId),
          ),
        );
    }
    return { decision, fact: created };
  });
}
```

> Nota: `reconcileFact` (capa DB) no tiene unit test — su cobertura es `tsc` + `build` + los tests de `decideReconciliation` (que gobierna su decisión). La rama `supersedesId` y la normalización de período se validan por tipos + compilación (round-trip DB queda para integración, GATED en migración).

- [ ] **Step 5: Correr tests → GREEN + typecheck**

Run: `npx vitest run src/lib/facts/__tests__/reconcile.test.ts`
Expected: PASS (10 tests — 6 estructurados + 3 narrativos + 1 factContentEquals).

Run: `npx tsc --noEmit`
Expected: 0 errores (facts.ts pasa `kind` a `decideReconciliation`; `supersedesId` es opcional; la tool de chat en `registry.ts` sigue compilando porque no pasa `supersedesId`).

Run: `npm run lint:strict-mode`
Expected: pass.

- [ ] **Step 6: Build (verifica la tool de chat de Team A sin cambios)**

Run: `npm run build`
Expected: OK (el case `registrar_hecho_negocio` en `registry.ts` llama `reconcileFact` sin `supersedesId` → compila; captura de narrativo ahora ADD/NOOP en vez de SUPERSEDE).

- [ ] **Step 7: Commit**

```bash
git add src/lib/facts/reconcile.ts src/lib/facts/__tests__/reconcile.test.ts src/lib/db/facts.ts
git commit -m "feat(facts): narrativos coexisten (nunca supersede) + reconcileFact supersede por id (Ola 1E2)

decideReconciliation es kind-aware; reconcileFact normaliza narrativo→período null
y añade supersedesId para edición explícita. Sin migración (NULLs distintos en uq_active_fact).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task E2b: Wiring de edición por id en el panel

**Files:**
- Modify: `src/lib/facts/actions/contexto-actions.ts`, `src/components/workspace/contexto/ContextoPanel.tsx`, `src/components/workspace/contexto/FactForm.tsx`

**Interfaces:**
- Consumes: `reconcileFact` con `supersedesId` (E2a).
- Produces: `registerManualFactAction(rawInput: unknown, supersedesId?: string | null)`; el panel pasa el id del hecho editado; el form de narrativos no pide período.

- [ ] **Step 1: `contexto-actions.ts` — propagar `supersedesId`**

Cambiar la firma de `registerManualFactAction` (línea 37) y la llamada a `reconcileFact`. Reemplazar:

```ts
export async function registerManualFactAction(rawInput: unknown): Promise<RegisterFactResult> {
```

por:

```ts
export async function registerManualFactAction(
  rawInput: unknown,
  supersedesId?: string | null,
): Promise<RegisterFactResult> {
```

Y dentro del `try`, reemplazar la llamada a `reconcileFact` por (añade `supersedesId`):

```ts
    const { decision, fact } = await reconcileFact({
      workspaceId: ws.id,
      kind: input.kind,
      content: { title: input.title, body: input.body, structured: input.structured },
      fiscalPeriod: input.fiscalPeriod,
      source: 'manual',
      supersedesId: supersedesId ?? null,
    });
```

- [ ] **Step 2: `ContextoPanel.tsx` — pasar el id editado**

En `submit`, reemplazar la llamada:

```ts
        const res = await registerManualFactAction(buildRegistrarInput(form));
```

por:

```ts
        const res = await registerManualFactAction(
          buildRegistrarInput(form),
          editKey === 'new' ? null : editKey,
        );
```

Y añadir `editKey` al array de dependencias del `useCallback` de `submit` (actual `[router, language]`) → `[router, language, editKey]`.

- [ ] **Step 3: `FactForm.tsx` — período sólo para donación (narrativos atemporales)**

Envolver el bloque del campo período (el `<div>` que contiene el label "Período fiscal (año)" y su `<input>`) en `{isDonation && (...)}`. Reemplazar:

```tsx
      <div>
        <label className={labelCls}>
          {t('Período fiscal (año)', 'Fiscal period (year)')}
          {isDonation && <span className="text-danger"> *</span>}
        </label>
        <input
          className={inputCls}
          value={form.fiscalPeriod}
          onChange={(e) => set('fiscalPeriod', e.target.value)}
          disabled={isEdit}
          maxLength={8}
          inputMode="numeric"
          placeholder="2026"
        />
      </div>
```

por:

```tsx
      {isDonation && (
        <div>
          <label className={labelCls}>
            {t('Período fiscal (año)', 'Fiscal period (year)')}
            <span className="text-danger"> *</span>
          </label>
          <input
            className={inputCls}
            value={form.fiscalPeriod}
            onChange={(e) => set('fiscalPeriod', e.target.value)}
            disabled={isEdit}
            maxLength={8}
            inputMode="numeric"
            placeholder="2026"
          />
        </div>
      )}
```

> Los narrativos ya no muestran período (son atemporales — `reconcileFact` lo fuerza a null igual). Para donación el campo sigue mostrándose, requerido y bloqueado en edición (fix de Ola 1D). El hint de edición ("El tipo y el período no cambian…") se mantiene: para donación aplica a ambos; para narrativo el tipo queda bloqueado y no hay período que mostrar.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: 0 errores (`registerManualFactAction` acepta el 2º arg opcional; `ContextoPanel` lo pasa; `FactForm` sin período para narrativo compila).

Run: `npm run build`
Expected: OK (`/workspace/contexto` compila).

- [ ] **Step 5: Commit**

```bash
git add src/lib/facts/actions/contexto-actions.ts src/components/workspace/contexto/ContextoPanel.tsx src/components/workspace/contexto/FactForm.tsx
git commit -m "feat(facts): panel edita por supersedesId + narrativos sin período (atemporales) (Ola 1E2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (contra la decisión Johan + código real)

- **Narrativos coexisten** → E2a `decideReconciliation(kind='narrative')` nunca SUPERSEDE (NOOP-idéntico / ADD-distinto). ✅
- **Narrativos atemporales sin migración** → E2a `reconcileFact` normaliza `fiscalPeriod` de narrativos a `null` (NULLs distintos en `uq_active_fact` → coexisten). Índice intacto. ✅
- **Editar = supersede por id exacto** → E2a rama `supersedesId` (revoca ese id + inserta + enlaza) + E2b (panel pasa `editKey`). ✅
- **La tool de chat de Team A no cambia** → `supersedesId` opcional; el case en `registry.ts` no lo pasa. Captura de narrativo pasa a ADD/NOOP (el comportamiento deseado). ✅
- **Tenancy** → revocación de `supersedesId` scopeada por `workspaceId` + `status='active'`. Si el objetivo no está activo → degrada a ADD (no crashea). ✅
- **Contrato de orden (ASC createdAt) preservado** para el SUPERSEDE defensivo de estructurados. ✅
- **Donación intacta:** su reconcile por `(kind, período)` no cambia; el campo período sigue requerido+bloqueado-en-edición. El fix monto>0 (E1) sigue vigente. ✅
- **Placeholder scan:** cada step trae el código real. ✅
- **Type consistency:** `decideReconciliation(...,kind)` (E2a) ↔ caller `reconcileFact` (E2a, misma task, sin romper tsc); `supersedesId` opcional en `reconcileFact` (E2a) ↔ `registerManualFactAction` (E2b) ↔ `ContextoPanel` (E2b). ✅
- **Fuera de alcance:** integración a reportes (Ola 2); Team C (financiero). El "Aparece en" y la nav al panel siguen como open items de D. ✅

### Verificación final
- `npx vitest run src/lib/facts` · `npx tsc --noEmit` · `npm run build` · `npm run lint:strict-mode`
