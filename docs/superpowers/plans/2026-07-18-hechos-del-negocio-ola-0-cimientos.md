# Hechos del negocio — Ola 0 (Cimientos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la capa de cimientos (DB, contratos, lógica determinista, puntos de anclaje) que congela las interfaces que consumirán los 4 equipos paralelos de la Ola 1.

**Architecture:** Dos tablas Drizzle (`workspace_facts` + `fact_decision_records`) re-exportadas desde `schema.ts`; contratos Zod strict-mode + tipos compartidos en `src/lib/facts/`; lógica de reconciliación **pura** (unit-testable sin DB) separada del glue de acceso a datos; registro normativo versionado **in-repo** (TS) con resolución fail-loud; y un anclaje mínimo en el orquestador (campo `suggestedRoute`) para que la Ola 1 no toque `orchestrator.ts` en paralelo.

**Tech Stack:** Next.js 16 (App Router) · Drizzle ORM + `drizzle-orm/node-postgres` (pg.Pool) · Zod (strict-mode 2026) · Vitest 3 · TypeScript.

## Global Constraints

Cada tarea hereda implícitamente estas reglas (valores verbatim del spec + CLAUDE.md):

- **Zod strict-mode:** en schemas que viajan al LLM, `.nullable()` SIEMPRE — NUNCA `.optional()` / `.nullish()` / `.default()` / `.passthrough()` / `z.record()`. Guard CI: `npm run lint:strict-mode`.
- **MoneyCop:** montos en efectivo viajan como **string en centavos** (ej. `"1500000"` = $15.000,00). Aritmética vía `parseMoneyCop`/`serializeMoneyCop`/`sumMoneyCop` de `@/lib/agents/financial/contracts/money.ts`. NUNCA `number` para montos (overflow > 2^53).
- **Migraciones:** `npm run db:generate` (drizzle-kit) → inspeccionar el SQL → `npm run db:migrate` (tsx `scripts/db-migrate.ts`). **NUNCA `db:push`** (borra infra DB no declarada en TS).
- **Alias:** `@/*` → `./src/*`. Todos los imports usan este alias salvo relativos dentro del mismo dir de `src/lib/db/`.
- **DB files:** todo archivo que llame `getDb()` empieza con `import 'server-only';`.
- **Drizzle FK:** referencias vía callback lazy `() => table.col` (evita ciclos al evaluar el módulo).
- **LLM provider:** nunca pasar `apiKey` ni instanciar OpenAI directo (no aplica a Ola 0, pero se hereda).
- **Reconciliación append-only:** por auditabilidad DIAN NUNCA se edita un hecho en sitio. El "UPDATE" del vocabulario Mem0 se **realiza como SUPERSEDE** (nuevo activo + viejo `revoked` con `supersededById`). El enum de decisión es por tanto `'ADD' | 'SUPERSEDE' | 'NOOP'`.

---

## File Structure

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `src/lib/db/schema-facts.ts` (crear) | Tablas Drizzle `workspaceFacts` + `factDecisionRecords`, enums, tipos inferidos | T1 |
| `src/lib/db/schema.ts` (modificar) | Añadir `export * from './schema-facts';` | T1 |
| `src/lib/db/migrations/XXXX_*.sql` (generado) | DDL de las dos tablas nuevas | T1 |
| `src/lib/facts/contracts.ts` (crear) | Zod strict + tipos compartidos (`FactKind`, `RegistrarHechoInput`, `FactStructured`) | T2 |
| `src/lib/facts/reconcile.ts` (crear) | **Pura**: `decideReconciliation(candidate, existing[])` → `ADD/SUPERSEDE/NOOP` | T3 |
| `src/lib/facts/__tests__/reconcile.test.ts` (crear) | Unit tests de los 3 caminos | T3 |
| `src/lib/db/facts.ts` (crear) | Glue DB: `getActiveFacts`, `listFacts`, `reconcileFact`, `revokeFact`, `persistDecisionRecord` | T4 |
| `src/lib/normativa/rules-registry.ts` (crear) | Registro versionado + `resolveRule(key, fiscalPeriod)` fail-loud | T5 |
| `src/lib/normativa/__tests__/rules-registry.test.ts` (crear) | Unit tests: resuelve 2026, lanza para período sin vigencia | T5 |
| `src/lib/agents/navigation/suggested-route.ts` (crear) | **Stub** `computeSuggestedRoute(...)` → `null` (Team B lo llena en Ola 1) | T6 |
| `src/lib/agents/types.ts` (modificar) | Tipo `SuggestedRoute` + campo `suggestedRoute` en `OrchestrateResult` | T6 |
| `src/lib/agents/orchestrator.ts` (modificar) | Cablear `suggestedRoute` en los 4 sitios de construcción de `OrchestrateResult` | T6 |

---

## Task 1: Tablas `workspace_facts` + `fact_decision_records`

**Files:**
- Create: `src/lib/db/schema-facts.ts`
- Modify: `src/lib/db/schema.ts` (bloque de re-exports, ~línea 807)
- Generated: `src/lib/db/migrations/XXXX_<name>.sql`

**Interfaces:**
- Consumes: `workspaces` (de `./schema`), patrón Drizzle de `schema-tax.ts`.
- Produces:
  - Tabla `workspaceFacts` con columnas: `id`, `workspaceId`, `kind`, `title`, `body`, `structured` (jsonb nullable), `fiscalPeriod` (nullable), `status`, `supersededById` (self-FK nullable), `source`, `createdAt`, `updatedAt`, `revokedAt` (nullable).
  - Tabla `factDecisionRecords` con: `id`, `workspaceId`, `factId`, `ruleKey`, `ruleVersion`, `inputs` (jsonb), `resultado` (jsonb), `computedAt`.
  - Tipos: `WorkspaceFact`, `NewWorkspaceFact`, `FactDecisionRecord`, `NewFactDecisionRecord`.
  - Enums: `factKindEnum` (`narrative|donation|leasing|loss_carryforward`), `factStatusEnum` (`active|revoked`), `factSourceEnum` (`chat|manual`).

- [ ] **Step 1: Crear `src/lib/db/schema-facts.ts`**

```ts
// ─── Schema split: Hechos del negocio (memoria de contexto empresarial) ──────
//
// Tablas para la memoria de hechos duraderos del negocio y su audit trail de
// cálculo. Re-exportadas desde `schema.ts` — Drizzle Kit las descubre solo.
//
// FK → workspaces: callback lazy `() => workspaces.id` (patrón schema-tax.ts).
// supersededById es self-FK: usa `AnyPgColumn` + callback para el forward-ref.
//
// Append-only: un hecho nunca se edita en sitio. Una "edición" crea una fila
// nueva `active` y marca la vieja `revoked` con `supersededById` (auditoría DIAN).

import {
  type AnyPgColumn,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { workspaces } from './schema';

// ─── Enums ───────────────────────────────────────────────────────────────────

/** Tipo de hecho. Piloto implementa `narrative` + `donation`; el resto son
 *  slots forward-compat sin handler hasta sus olas. */
export const factKindEnum = pgEnum('fact_kind', [
  'narrative',
  'donation',
  'leasing',
  'loss_carryforward',
]);

/** Ciclo de vida. `revoked` es soft-delete — nunca se borra la fila. */
export const factStatusEnum = pgEnum('fact_status', ['active', 'revoked']);

/** Origen del registro: capturado por chat o entrado a mano en el panel. */
export const factSourceEnum = pgEnum('fact_source', ['chat', 'manual']);

// ─── workspace_facts ─────────────────────────────────────────────────────────

export const workspaceFacts = pgTable(
  'workspace_facts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: factKindEnum('kind').notNull(),
    title: text('title').notNull(),
    // Narrativa anclada en las palabras del usuario. Siempre existe.
    body: text('body').notNull(),
    // Enriquecimiento tipado por kind. null para `narrative`. Montos MoneyCop.
    structured: jsonb('structured').$type<Record<string, unknown>>(),
    // Vigencia fiscal. null ⇒ vigente para cualquier reporte.
    fiscalPeriod: varchar('fiscal_period', { length: 8 }),
    status: factStatusEnum('status').notNull().default('active'),
    // Cadena de versiones: apunta a la fila que ESTA fila reemplazó.
    supersededById: uuid('superseded_by_id').references(
      (): AnyPgColumn => workspaceFacts.id,
      { onDelete: 'set null' },
    ),
    source: factSourceEnum('source').notNull().default('chat'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    // Lookup de reconciliación: hechos activos del mismo kind+período.
    index('idx_facts_reconcile').on(
      t.workspaceId,
      t.kind,
      t.fiscalPeriod,
      t.status,
    ),
  ],
);

// ─── fact_decision_records ───────────────────────────────────────────────────
//
// Audit trail inmutable por cálculo. Junto con el registro de reglas
// vigencia-fechado, da auditabilidad bitemporal SIN store bitemporal:
// reconstruye "qué regla y qué inputs produjeron este número, y cuándo".
// Sin path de UPDATE — solo INSERT.

export const factDecisionRecords = pgTable('fact_decision_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  factId: uuid('fact_id')
    .notNull()
    .references(() => workspaceFacts.id, { onDelete: 'cascade' }),
  ruleKey: varchar('rule_key', { length: 64 }).notNull(),
  ruleVersion: varchar('rule_version', { length: 32 }).notNull(),
  // Inputs y resultado del cálculo. Montos como MoneyCop strings.
  inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull(),
  resultado: jsonb('resultado').$type<Record<string, unknown>>().notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Tipos inferidos ─────────────────────────────────────────────────────────

export type WorkspaceFact = typeof workspaceFacts.$inferSelect;
export type NewWorkspaceFact = typeof workspaceFacts.$inferInsert;
export type FactDecisionRecord = typeof factDecisionRecords.$inferSelect;
export type NewFactDecisionRecord = typeof factDecisionRecords.$inferInsert;
```

- [ ] **Step 2: Re-exportar desde `schema.ts`**

En `src/lib/db/schema.ts`, en el bloque de `export *` (junto a `export * from './schema-tax';`, ~línea 807), añadir:

```ts
export * from './schema-facts';
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos en `schema-facts.ts` (el self-FK con `AnyPgColumn` compila).

- [ ] **Step 4: Generar la migración**

Run: `npm run db:generate`
Expected: crea un archivo nuevo en `src/lib/db/migrations/` (ej. `0021_<random>.sql`).

- [ ] **Step 5: Inspeccionar el SQL generado (GUARD anti-drift)**

Run: `git status --short src/lib/db/migrations && git diff --stat`
Abrir el `.sql` generado y **verificar que SOLO contiene**: `CREATE TYPE ... fact_kind/fact_status/fact_source`, `CREATE TABLE workspace_facts`, `CREATE TABLE fact_decision_records`, sus índices y FKs.
Expected: **cero** `DROP TABLE` / `ALTER TABLE ... DROP` de tablas ajenas. Si aparece algún DROP de infra existente, DETENERSE — es drift del journal (ver memoria `db:push borra drift`), no continuar con migrate.

- [ ] **Step 6: Aplicar la migración**

Run: `npm run db:migrate`
Expected: `Migrations applied.` (requiere `DATABASE_URL`; si no está en local, este paso corre en deploy — commitear la migración igual).

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/schema-facts.ts src/lib/db/schema.ts src/lib/db/migrations
git commit -m "feat(facts): tablas workspace_facts + fact_decision_records (Ola 0 T1)"
```

---

## Task 2: Contratos Zod + tipos compartidos

**Files:**
- Create: `src/lib/facts/contracts.ts`
- Test: `src/lib/facts/__tests__/contracts.test.ts`

**Interfaces:**
- Consumes: nada externo (Zod puro; sin import de DB, safe para cliente y tool).
- Produces:
  - `FactKind` = `'narrative' | 'donation' | 'leasing' | 'loss_carryforward'`.
  - `donationStructuredSchema` (Zod) + `DonationStructured` (tipo).
  - `registrarHechoInputSchema` (Zod strict) + `RegistrarHechoInput` (tipo) — el contrato de la tool.
  - `FactContent` = `{ title: string; body: string; structured: Record<string, unknown> | null }` (lo que compara la reconciliación).

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/facts/__tests__/contracts.test.ts
import { describe, expect, it } from 'vitest';
import { registrarHechoInputSchema } from '../contracts';

describe('registrarHechoInputSchema', () => {
  it('acepta un hecho narrativo con structured null', () => {
    const parsed = registrarHechoInputSchema.parse({
      kind: 'narrative',
      title: 'Reestructuración de facturas',
      body: 'Estamos reestructurando facturas para donar a la fundación X.',
      structured: null,
      fiscalPeriod: '2026',
    });
    expect(parsed.kind).toBe('narrative');
    expect(parsed.structured).toBeNull();
  });

  it('acepta una donación con structured tipado y monto MoneyCop', () => {
    const parsed = registrarHechoInputSchema.parse({
      kind: 'donation',
      title: 'Donación fundación X',
      body: 'Donación de 50 millones a la fundación X.',
      structured: { montoCentavos: '5000000000', articulo: '257', fiscalYear: '2026' },
      fiscalPeriod: '2026',
    });
    expect(parsed.structured?.montoCentavos).toBe('5000000000');
  });

  it('rechaza montoCentavos no entero', () => {
    const r = registrarHechoInputSchema.safeParse({
      kind: 'donation',
      title: 'x',
      body: 'y',
      structured: { montoCentavos: '50.5', articulo: '257', fiscalYear: '2026' },
      fiscalPeriod: '2026',
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/lib/facts/__tests__/contracts.test.ts`
Expected: FAIL — `Cannot find module '../contracts'`.

- [ ] **Step 3: Escribir `src/lib/facts/contracts.ts`**

```ts
// Contratos Zod + tipos compartidos de la memoria de hechos del negocio.
// SIN import de DB — safe para cliente, tool y panel. Strict-mode 2026:
// `.nullable()` siempre, nunca `.optional()`/`.default()`/`z.record()`.

import { z } from 'zod';

export type FactKind = 'narrative' | 'donation' | 'leasing' | 'loss_carryforward';

/** MoneyCop: entero serializado en centavos. Regex compartido con money.ts. */
const moneyCop = z.string().regex(/^-?\d+$/, 'monto debe ser entero en centavos (MoneyCop)');

/** Structured de una donación (piloto Art. 257 E.T.). */
export const donationStructuredSchema = z.object({
  montoCentavos: moneyCop,
  articulo: z.string(),
  fiscalYear: z.string(),
});
export type DonationStructured = z.infer<typeof donationStructuredSchema>;

/**
 * Contrato de la tool `registrar_hecho_negocio`. Piloto: kind ∈
 * {narrative, donation}. `structured` es null para narrative y el objeto
 * de donación para donation (coherencia kind↔structured la valida el
 * handler server-side, no el LLM).
 */
export const registrarHechoInputSchema = z.object({
  kind: z.enum(['narrative', 'donation']),
  title: z.string(),
  body: z.string(),
  structured: donationStructuredSchema.nullable(),
  fiscalPeriod: z.string().nullable(),
});
export type RegistrarHechoInput = z.infer<typeof registrarHechoInputSchema>;

/** Contenido semántico que compara la reconciliación (T3). */
export interface FactContent {
  title: string;
  body: string;
  structured: Record<string, unknown> | null;
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run src/lib/facts/__tests__/contracts.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Verificar el guard de strict-mode**

Run: `npm run lint:strict-mode`
Expected: sin violaciones (usamos `.nullable()`, no `.optional()`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/facts/contracts.ts src/lib/facts/__tests__/contracts.test.ts
git commit -m "feat(facts): contratos Zod strict + tipos compartidos (Ola 0 T2)"
```

---

## Task 3: Lógica de reconciliación (pura)

**Files:**
- Create: `src/lib/facts/reconcile.ts`
- Test: `src/lib/facts/__tests__/reconcile.test.ts`

**Interfaces:**
- Consumes: `FactContent` de `./contracts`.
- Produces:
  - `type ReconcileDecision = { action: 'ADD' } | { action: 'NOOP'; existingId: string } | { action: 'SUPERSEDE'; existingId: string }`.
  - `function decideReconciliation(candidate: FactContent, existingActive: Array<FactContent & { id: string }>): ReconcileDecision`.
  - `function factContentEquals(a: FactContent, b: FactContent): boolean`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/facts/__tests__/reconcile.test.ts
import { describe, expect, it } from 'vitest';
import { decideReconciliation } from '../reconcile';

const donation = (montoCentavos: string) => ({
  title: 'Donación fundación X',
  body: 'Donación a la fundación X.',
  structured: { montoCentavos, articulo: '257', fiscalYear: '2026' },
});

describe('decideReconciliation', () => {
  it('ADD cuando no hay hechos activos equivalentes', () => {
    expect(decideReconciliation(donation('5000000000'), [])).toEqual({ action: 'ADD' });
  });

  it('NOOP cuando el hecho ya existe idéntico', () => {
    const existing = { id: 'f1', ...donation('5000000000') };
    expect(decideReconciliation(donation('5000000000'), [existing])).toEqual({
      action: 'NOOP',
      existingId: 'f1',
    });
  });

  it('SUPERSEDE cuando existe uno del mismo tipo/período con datos distintos', () => {
    const existing = { id: 'f1', ...donation('5000000000') };
    expect(decideReconciliation(donation('4500000000'), [existing])).toEqual({
      action: 'SUPERSEDE',
      existingId: 'f1',
    });
  });

  it('SUPERSEDE contra el más reciente cuando (defensivo) hay más de un activo', () => {
    const older = { id: 'f1', ...donation('5000000000') };
    const newer = { id: 'f2', ...donation('4800000000') };
    const d = decideReconciliation(donation('4500000000'), [older, newer]);
    expect(d).toEqual({ action: 'SUPERSEDE', existingId: 'f2' });
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/lib/facts/__tests__/reconcile.test.ts`
Expected: FAIL — `Cannot find module '../reconcile'`.

- [ ] **Step 3: Escribir `src/lib/facts/reconcile.ts`**

```ts
// Decisión de reconciliación PURA (sin DB) — el corazón anti-duplicados.
// Patrón Mem0 (extract→update) adaptado a append-only DIAN: UPDATE se realiza
// como SUPERSEDE. El caller (db/facts.ts) pasa los hechos ACTIVOS del mismo
// kind+fiscalPeriod (ya filtrados por query) y aplica la decisión.

import type { FactContent } from './contracts';

export type ReconcileDecision =
  | { action: 'ADD' }
  | { action: 'NOOP'; existingId: string }
  | { action: 'SUPERSEDE'; existingId: string };

/** Serializa un objeto con claves ordenadas para comparación estable. */
function stableStringify(value: Record<string, unknown> | null): string {
  if (value === null) return 'null';
  const keys = Object.keys(value).sort();
  return JSON.stringify(keys.map((k) => [k, value[k]]));
}

export function factContentEquals(a: FactContent, b: FactContent): boolean {
  return (
    a.title === b.title &&
    a.body === b.body &&
    stableStringify(a.structured) === stableStringify(b.structured)
  );
}

/**
 * Decide qué hacer con `candidate` frente a los hechos activos equivalentes.
 * Invariante mantenida por la reconciliación: ≤1 activo por kind+período. El
 * caso defensivo (>1 activo) supersede el ÚLTIMO del array (el más reciente,
 * por orden `createdAt desc` que garantiza el caller).
 */
export function decideReconciliation(
  candidate: FactContent,
  existingActive: Array<FactContent & { id: string }>,
): ReconcileDecision {
  if (existingActive.length === 0) return { action: 'ADD' };
  const match = existingActive.find((e) => factContentEquals(candidate, e));
  if (match) return { action: 'NOOP', existingId: match.id };
  return { action: 'SUPERSEDE', existingId: existingActive[existingActive.length - 1].id };
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run src/lib/facts/__tests__/reconcile.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/facts/reconcile.ts src/lib/facts/__tests__/reconcile.test.ts
git commit -m "feat(facts): lógica de reconciliación pura ADD/SUPERSEDE/NOOP (Ola 0 T3)"
```

---

## Task 4: Glue de acceso a datos (`db/facts.ts`)

**Files:**
- Create: `src/lib/db/facts.ts`

**Interfaces:**
- Consumes: `getDb` (de `./client`); `workspaceFacts`, `factDecisionRecords`, tipos inferidos (de `./schema`); `decideReconciliation`, `FactContent` (de `@/lib/facts/reconcile` y `@/lib/facts/contracts`).
- Produces (firmas que Ola 1 consumirá):
  - `getActiveFacts(workspaceId: string, fiscalPeriod: string | null): Promise<WorkspaceFact[]>` — activos cuyo período cubre el del reporte (período exacto **o** `fiscalPeriod IS NULL`).
  - `listFacts(workspaceId: string): Promise<WorkspaceFact[]>` — todos (incl. revoked), para el panel.
  - `reconcileFact(input: { workspaceId: string; kind: FactKind; content: FactContent; fiscalPeriod: string | null; source: 'chat' | 'manual' }): Promise<{ decision: ReconcileDecision; fact: WorkspaceFact | null }>`.
  - `revokeFact(workspaceId: string, factId: string): Promise<WorkspaceFact | null>`.
  - `persistDecisionRecord(rec: NewFactDecisionRecord): Promise<FactDecisionRecord>`.

- [ ] **Step 1: Escribir `src/lib/db/facts.ts`**

```ts
import 'server-only';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { getDb } from './client';
import {
  factDecisionRecords,
  workspaceFacts,
  type FactDecisionRecord,
  type NewFactDecisionRecord,
  type WorkspaceFact,
} from './schema';
import type { FactKind, FactContent } from '@/lib/facts/contracts';
import { decideReconciliation, type ReconcileDecision } from '@/lib/facts/reconcile';

// Patrón lazy getDb() (igual a pyme.ts). Tenant scoping: TODAS las funciones
// filtran por workspaceId — el caller (handler API/tool) lo resuelve server-side.

/** Activos cuyo período cubre el del reporte: match exacto o sin período. */
export async function getActiveFacts(
  workspaceId: string,
  fiscalPeriod: string | null,
): Promise<WorkspaceFact[]> {
  const db = getDb();
  const periodClause =
    fiscalPeriod === null
      ? isNull(workspaceFacts.fiscalPeriod)
      : or(eq(workspaceFacts.fiscalPeriod, fiscalPeriod), isNull(workspaceFacts.fiscalPeriod));
  return db
    .select()
    .from(workspaceFacts)
    .where(
      and(
        eq(workspaceFacts.workspaceId, workspaceId),
        eq(workspaceFacts.status, 'active'),
        periodClause,
      ),
    )
    .orderBy(desc(workspaceFacts.createdAt));
}

/** Todos los hechos del workspace (incl. revoked) para el panel Contexto. */
export async function listFacts(workspaceId: string): Promise<WorkspaceFact[]> {
  const db = getDb();
  return db
    .select()
    .from(workspaceFacts)
    .where(eq(workspaceFacts.workspaceId, workspaceId))
    .orderBy(desc(workspaceFacts.createdAt));
}

/**
 * Reconcilia un hecho candidato contra los activos del mismo kind+período.
 * ADD → inserta. NOOP → no muta, devuelve el existente. SUPERSEDE → marca el
 * viejo revoked+supersededById e inserta el nuevo (append-only, auditable).
 */
export async function reconcileFact(input: {
  workspaceId: string;
  kind: FactKind;
  content: FactContent;
  fiscalPeriod: string | null;
  source: 'chat' | 'manual';
}): Promise<{ decision: ReconcileDecision; fact: WorkspaceFact | null }> {
  const db = getDb();
  // Activos del mismo kind+período exacto (la reconciliación es por período).
  const periodClause =
    input.fiscalPeriod === null
      ? isNull(workspaceFacts.fiscalPeriod)
      : eq(workspaceFacts.fiscalPeriod, input.fiscalPeriod);
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
    .orderBy(desc(workspaceFacts.createdAt));

  const decision = decideReconciliation(
    input.content,
    existing.map((e) => ({
      id: e.id,
      title: e.title,
      body: e.body,
      structured: e.structured ?? null,
    })),
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
        .where(eq(workspaceFacts.id, decision.existingId));
    }
    const [created] = await tx
      .insert(workspaceFacts)
      .values({
        workspaceId: input.workspaceId,
        kind: input.kind,
        title: input.content.title,
        body: input.content.body,
        structured: input.content.structured ?? undefined,
        fiscalPeriod: input.fiscalPeriod,
        source: input.source,
      })
      .returning();
    // Cierre de la cadena de versiones: el viejo apunta al nuevo.
    if (decision.action === 'SUPERSEDE') {
      await tx
        .update(workspaceFacts)
        .set({ supersededById: created.id })
        .where(eq(workspaceFacts.id, decision.existingId));
    }
    return { decision, fact: created };
  });
}

/** Soft-delete: marca revoked. Nunca borra (auditabilidad DIAN). */
export async function revokeFact(
  workspaceId: string,
  factId: string,
): Promise<WorkspaceFact | null> {
  const db = getDb();
  const [updated] = await db
    .update(workspaceFacts)
    .set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(workspaceFacts.id, factId), eq(workspaceFacts.workspaceId, workspaceId)))
    .returning();
  return updated ?? null;
}

/** Persiste un decision record inmutable (audit trail de cálculo). */
export async function persistDecisionRecord(
  rec: NewFactDecisionRecord,
): Promise<FactDecisionRecord> {
  const db = getDb();
  const [created] = await db.insert(factDecisionRecords).values(rec).returning();
  return created;
}
```

- [ ] **Step 2: Verificar que compila y que el build pasa**

Run: `npx tsc --noEmit`
Expected: sin errores. (Valida que las firmas Drizzle, el `transaction`, y los imports `@/lib/facts/*` resuelven.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/facts.ts
git commit -m "feat(facts): glue de acceso a datos + reconcileFact + decision records (Ola 0 T4)"
```

---

## Task 5: Registro normativo versionado

**Files:**
- Create: `src/lib/normativa/rules-registry.ts`
- Test: `src/lib/normativa/__tests__/rules-registry.test.ts`

**Interfaces:**
- Consumes: nada externo (registro TS puro).
- Produces:
  - `interface NormativeRuleVersion { vigencia: { desde: string; hasta: string | null }; version: string; params: Record<string, unknown>; fuente: string; revisadoPara: string }`.
  - `const RULES_REGISTRY: Record<string, NormativeRuleVersion[]>`.
  - `function resolveRule(ruleKey: string, fiscalPeriod: string): NormativeRuleVersion` — **fail-loud**: lanza si no hay versión vigente.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/normativa/__tests__/rules-registry.test.ts
import { describe, expect, it } from 'vitest';
import { resolveRule } from '../rules-registry';

describe('resolveRule', () => {
  it('resuelve la versión vigente de Art. 257 para 2026', () => {
    const r = resolveRule('descuento_donaciones_257', '2026');
    expect(r.params.limitePctImpuesto).toBe(25);
    expect(r.params.articulo).toBe('257 E.T.');
  });

  it('FAIL-LOUD: lanza para un período sin regla vigente cargada', () => {
    expect(() => resolveRule('descuento_donaciones_257', '2099')).toThrow(
      /No hay regla vigente/,
    );
  });

  it('FAIL-LOUD: lanza para una ruleKey desconocida', () => {
    expect(() => resolveRule('regla_inexistente', '2026')).toThrow(/desconocida/);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/lib/normativa/__tests__/rules-registry.test.ts`
Expected: FAIL — `Cannot find module '../rules-registry'`.

- [ ] **Step 3: Escribir `src/lib/normativa/rules-registry.ts`**

```ts
// Registro normativo versionado (Rules as Code) — FUENTE ÚNICA DE VERDAD
// determinista para cálculos estructurados. Versionado por git: el propio
// historial del repo ES el audit trail de definiciones.
//
// Actualización manual: ante una reforma se AGREGA una versión nueva con
// `vigencia.desde` y se cierra la anterior con `vigencia.hasta`. NUNCA se
// edita una versión en su lugar (rompería la reconstrucción histórica).
//
// El binding es uni-temporal (eje vigencia). El eje "tiempo de conocimiento"
// lo aporta fact_decision_records (auditabilidad bitemporal sin store bitemporal).

export interface NormativeRuleVersion {
  vigencia: { desde: string; hasta: string | null }; // ISO date; hasta null = abierta
  version: string;
  params: Record<string, unknown>;
  fuente: string;
  revisadoPara: string; // año para el que se verificó vigencia por última vez
}

export const RULES_REGISTRY: Record<string, NormativeRuleVersion[]> = {
  descuento_donaciones_257: [
    {
      vigencia: { desde: '2023-01-01', hasta: null },
      version: '2023',
      params: { articulo: '257 E.T.', limitePctImpuesto: 25, uvt2026: 52374 },
      fuente: 'Estatuto Tributario Art. 257 (descuento por donaciones).',
      revisadoPara: '2026',
    },
  ],
};

/** ¿El `fiscalPeriod` (año 'YYYY') cae dentro de la vigencia? */
function periodEnVigencia(period: string, v: NormativeRuleVersion): boolean {
  const year = Number.parseInt(period, 10);
  const desdeYear = Number.parseInt(v.vigencia.desde.slice(0, 4), 10);
  const hastaYear = v.vigencia.hasta ? Number.parseInt(v.vigencia.hasta.slice(0, 4), 10) : null;
  return year >= desdeYear && (hastaYear === null || year <= hastaYear);
}

/**
 * Resuelve la versión de regla vigente para un período fiscal. FAIL-LOUD: si
 * la ruleKey no existe o no hay versión vigente para el período, LANZA — nunca
 * cae silenciosamente a una regla vieja (esto es lo que impide la deriva).
 */
export function resolveRule(ruleKey: string, fiscalPeriod: string): NormativeRuleVersion {
  const versions = RULES_REGISTRY[ruleKey];
  if (!versions) {
    throw new Error(`Regla normativa desconocida: "${ruleKey}".`);
  }
  const match = versions.find((v) => periodEnVigencia(fiscalPeriod, v));
  if (!match) {
    throw new Error(
      `No hay regla vigente de "${ruleKey}" para el período ${fiscalPeriod} — actualiza el registro normativo (src/lib/normativa/rules-registry.ts).`,
    );
  }
  return match;
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run src/lib/normativa/__tests__/rules-registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/normativa/rules-registry.ts src/lib/normativa/__tests__/rules-registry.test.ts
git commit -m "feat(normativa): registro versionado + resolveRule fail-loud (Ola 0 T5)"
```

---

## Task 6: Anclaje de navegación en el orquestador

Deja lista la interfaz que consumirá el Equipo B (Ola 1) **sin que B toque `orchestrator.ts`**: el campo existe y se llena vía un stub que B reemplaza en su propio archivo. (Refinamiento del spec: el *slot de registro de la tool* se mantiene con el Equipo A en Ola 1 — Ola 0 corre antes, así que A es el único que toca el loop de tools y no hay colisión paralela.)

**Files:**
- Create: `src/lib/agents/navigation/suggested-route.ts`
- Modify: `src/lib/agents/types.ts` (interface `OrchestrateResult`, ~línea 123)
- Modify: `src/lib/agents/orchestrator.ts` (4 sitios de construcción de `OrchestrateResult`: ~149, ~170, ~318, ~355)

**Interfaces:**
- Produces:
  - `interface SuggestedRoute { label: string; href: string; moduleKey: string }` **definido en `types.ts`** (evita ciclo de import types↔navigation).
  - Campo `suggestedRoute: SuggestedRoute | null` en `OrchestrateResult`.
  - `function computeSuggestedRoute(input: { domains: AgentDomain[]; intent: string; confidence: number }): SuggestedRoute | null` — **stub que retorna `null`**.
- Consumes: `AgentDomain` + `SuggestedRoute` (ambos de `../types`); en el orquestador, `classification.intent`, `classification.confidence`, y `domains` ya en scope.

- [ ] **Step 1: Crear el stub `src/lib/agents/navigation/suggested-route.ts`**

```ts
// Chip de navegación contextual. Rescata domains/intent del classifier y
// sugiere UNA ruta del workspace. STUB de Ola 0: retorna null. El Equipo B
// (Ola 1) llena la tabla de mapeo determinista AQUÍ — sin tocar orchestrator.ts.
//
// El anti-ruido "no sugerir la ruta que ya estás viendo" se resuelve
// client-side en ChatSidebar (que conoce el pathname); esta función solo
// mapea señal→ruta y aplica el umbral de confianza.

import type { AgentDomain, SuggestedRoute } from '../types';

export function computeSuggestedRoute(_input: {
  domains: AgentDomain[];
  intent: string;
  confidence: number;
}): SuggestedRoute | null {
  // TODO(Equipo B, Ola 1): tabla de mapeo domain/intent → ruta + umbral confianza.
  return null;
}
```

> Nota: este `TODO` marca el punto de extensión del Equipo B, no un placeholder de Ola 0 — el stub es un deliverable completo y compilable (retorna `null`, comportamiento definido).

- [ ] **Step 2: Añadir el tipo y el campo en `types.ts`**

En `src/lib/agents/types.ts`, definir la interfaz `SuggestedRoute` (cerca de `OrchestrateResult`, ~línea 122) y añadir el campo a `OrchestrateResult`. **Definir aquí** (no importar de navigation) para que la dirección de dependencia sea única: `navigation/suggested-route.ts` → `types.ts`.

```ts
export interface SuggestedRoute {
  label: string;
  href: string;
  moduleKey: string;
}

export interface OrchestrateResult {
  role: 'assistant';
  content: string;
  tier: CostTier;
  agentsUsed: string[];
  enhancedQuery?: string;
  webSearchUsed: boolean;
  webSources?: string[];
  riskAssessment?: SpecialistResult['riskAssessment'];
  sanctionCalculation?: SpecialistResult['sanctionCalculation'];
  /** Chip de navegación contextual sugerido (Ola 1 Equipo B). null = sin sugerencia. */
  suggestedRoute: SuggestedRoute | null;
}
```

- [ ] **Step 3: Cablear los sitios de construcción en `orchestrator.ts`**

Importar el stub (junto a los imports existentes, ~línea 16):

```ts
import { computeSuggestedRoute } from './navigation/suggested-route';
```

En los **dos returns de `handleT1`** (~líneas 149 y 170 — camino T1 saludo/confirmación, sin dominios) añadir la propiedad al objeto retornado:

```ts
    suggestedRoute: null,
```

En los **dos returns del camino principal** (~líneas 318 y 355, donde ya existe `tier: classification.tier,`) añadir junto a esa línea:

```ts
    suggestedRoute: computeSuggestedRoute({
      domains,
      intent: classification.intent,
      confidence: classification.confidence,
    }),
```

- [ ] **Step 4: Verificar que compila (fail-loud de completitud)**

Run: `npx tsc --noEmit`
Expected: sin errores. Si `tsc` reporta que a otro sitio de construcción de `OrchestrateResult` le falta `suggestedRoute`, añadir ahí `suggestedRoute: null,` (T1 no navega).

- [ ] **Step 5: Build de producción**

Run: `npm run build`
Expected: build OK (Turbopack).

- [ ] **Step 6: Commit**

```bash
git add src/lib/agents/navigation/suggested-route.ts src/lib/agents/types.ts src/lib/agents/orchestrator.ts
git commit -m "feat(nav): anclaje suggestedRoute en OrchestrateResult + stub (Ola 0 T6)"
```

---

## Cierre de Ola 0 — verificación integral

- [ ] **Correr toda la suite nueva**

Run: `npx vitest run src/lib/facts src/lib/normativa`
Expected: PASS (contracts 3 + reconcile 4 + rules-registry 3 = 10 tests).

- [ ] **Typecheck + build + guards**

Run: `npx tsc --noEmit && npm run lint:strict-mode && npm run build`
Expected: los tres verdes.

**Interfaces congeladas para Ola 1** (lo que cada equipo consumirá):
- Equipo A (Captura): `registrarHechoInputSchema`/`RegistrarHechoInput` (`@/lib/facts/contracts`), `reconcileFact` (`@/lib/db/facts`).
- Equipo B (Navegación): `computeSuggestedRoute` (`@/lib/agents/navigation/suggested-route`) — rellenar el stub; `OrchestrateResult.suggestedRoute` ya viaja.
- Equipo C (Reglas+cálculo): `resolveRule` (`@/lib/normativa/rules-registry`), `persistDecisionRecord` + `getActiveFacts` (`@/lib/db/facts`).
- Equipo D (Panel): `listFacts`/`reconcileFact`/`revokeFact` (`@/lib/db/facts`), contratos de `@/lib/facts/contracts`.

---

## Self-Review (contra el spec)

**Cobertura del spec (secciones que Ola 0 debe cimentar):**
- §1 Modelo de datos → T1 (`workspace_facts`, `fact_decision_records`, enums, `supersededById`, soft-delete). ✅
- §2 Reconciliación determinista ADD/SUPERSEDE/NOOP → T3 (pura) + T4 (glue). ✅ (UPDATE→SUPERSEDE documentado en Global Constraints.)
- §2 Contrato Zod de la tool → T2. ✅
- §4 Registro normativo vigencia-fechado + fail-loud → T5. ✅
- §4 Decision records inmutables → T1 (tabla) + T4 (`persistDecisionRecord`). ✅
- §3 Campo `suggestedRoute` como anclaje → T6. ✅
- **Fuera de alcance de Ola 0 (van en Ola 1+):** la tool en sí, el mapeo del chip, el hook de cálculo `donation`, el panel, la inyección `<hechos_empresa>`. Correcto — Ola 0 solo congela interfaces.

**Placeholder scan:** el único `TODO` (T6 stub) está anotado como punto de extensión con comportamiento definido (`return null`), no como trabajo incompleto de Ola 0. Sin otros TBD/TODO. ✅

**Consistencia de tipos:** `FactContent` (T2) ← consumido por `decideReconciliation` (T3) y `reconcileFact` (T4). `ReconcileDecision` (T3) ← retornado por `reconcileFact` (T4). `SuggestedRoute` (T6) ← campo de `OrchestrateResult` (T6). Firmas de `db/facts.ts` coinciden con el bloque "Interfaces congeladas". ✅
