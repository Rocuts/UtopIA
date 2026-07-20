# Hechos del negocio — Ola 1 · Team D (Panel "Contexto de la empresa") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una superficie human-in-the-loop en `/workspace/contexto` donde el usuario ve, registra a mano, edita (= nueva versión / SUPERSEDE) y revoca (soft-delete) sus hechos del negocio — compartiendo el mismo handler de mutaciones (`reconcileFact`/`revokeFact`) que la captura por chat, así panel y chat nunca divergen.

**Architecture:** Un **Server Component** (`page.tsx`, `force-dynamic`) resuelve `workspaceId` del cookie, lee `listFacts(wsId)`, y pasa los hechos (mapeados a un DTO serializable) a un **Client Component** `ContextoPanel`. Las mutaciones van por **Server Actions** (`contexto-actions.ts`, `'use server'`) que derivan `workspaceId` del cookie (nunca del input), aplican `requireAuthSession` + `assertFactInputValid`, y llaman a los servidores de Ola 0. La lógica pura (mapeo DTO, dinero pesos↔centavos, form→input tipado, cadena de versiones) vive en helpers unit-testeables. i18n **inline** (`language === 'es' ? … : …`), **sin tocar `dictionaries.ts`** (decisión Johan 2026-07-19: evita el WIP ajeno).

**Tech Stack:** Next 16 App Router (Server Components + Server Actions, `force-dynamic`) · React 19 · Zod · Vitest (helpers puros) · Tailwind (tokens `n-*`/`gold-*`) · lucide-react.

## Global Constraints

- **Reutiliza Ola 0 (server-only, NO redefinir):** `listFacts(workspaceId)` / `reconcileFact({workspaceId, kind, content, fiscalPeriod, source})` / `revokeFact(workspaceId, factId)` de `@/lib/db/facts`; `registrarHechoInputSchema` / `RegistrarHechoInput` / `FactContent` / `DonationStructured` de `@/lib/facts/contracts`; `assertFactInputValid` de `@/lib/facts/tool-guards`; `WorkspaceFact` de `@/lib/db/schema`.
- **Kinds del piloto:** `registrarHechoInputSchema.kind` es `z.enum(['narrative','donation'])`. El form solo ofrece esos dos. `donation` es material → `assertFactInputValid` exige `fiscalPeriod` no-nulo + `structured`.
- **Editar = SUPERSEDE, no update in-place:** editar = registrar una versión nueva (mismo kind+período, contenido distinto) → `reconcileFact` marca la vieja `revoked`+`supersededById` e inserta la nueva. El panel NO hace update en sitio (auditoría DIAN).
- **Revocar = soft-delete:** `revokeFact` marca `status='revoked'`; nunca borra.
- **Tenancy server-side:** las actions derivan `workspaceId` del cookie vía `getOrCreateWorkspace()` (patrón de `account-actions.ts`) — NUNCA del input del cliente. El page usa el mismo `getOrCreateWorkspace()` bajo `force-dynamic` (patrón de `comando/page.tsx`).
- **Auth gate:** cada action llama `requireAuthSession()` primero (fase 1 sin `BETTER_AUTH_SECRET` = no-op `{ok:true}`, dev sigue funcionando).
- **MoneyCop:** `montoCentavos` viaja como **string en CENTAVOS**. El form recibe **pesos**; el helper convierte pesos→centavos con BigInt (sin overflow). 50 millones de pesos = `"5000000000"` centavos.
- **i18n inline, sin `dictionaries.ts`:** todos los textos con ternario `language === 'es' ? … : …` (patrón de `ChatSidebar`). NO importar ni tocar `src/lib/i18n/dictionaries.ts`.
- **Contraste (CLAUDE.md token polarity):** tinta primaria `text-n-1000`, secundaria `text-n-700/800`, decorativa `n-500/600`; NUNCA `text-n-100..n-400` como tinta legible/clickeable; hover oscurece (no invierte). Acento gold para CTAs.
- **Lenis:** el shell root ya tiene `data-lenis-prevent` (`src/app/workspace/layout.tsx`) → el panel scrollea dentro de `<main>` sin necesitar su propio `data-lenis-prevent`. No añadirlo.
- **WIP ajeno intacto:** NUNCA `git add -A`/`git add .`. Stage SOLO las rutas exactas de cada task. No tocar login/page.tsx, page.tsx, Header.tsx, Hero.tsx, Metrics.tsx, dictionaries.ts, scripts/cleanup-auth-dryrun.mjs, src/modules/.
- **Gates:** helpers puros → Vitest (`src/**/__tests__/**/*.test.ts`). Superficie UI/acciones (sin framework de test per CLAUDE.md) → `npx tsc --noEmit` + `npm run build`.
- **Fuera de alcance (Ola 2):** los chips "Aparece en: [Reporte NIIF]…" reales dependen de que los reportes LEAN los hechos (Ola 2). El panel muestra una nota de período honesta ("se incluirá en tus reportes de {período}"), no chips de reportes específicos.

---

## File Structure

| Archivo | Responsabilidad | Task |
|---|---|---|
| `src/lib/facts/dto.ts` (crear) | `FactDTO` (fechas ISO, serializable RSC→client) + `toFactDTO(fact: WorkspaceFact)` | D1 |
| `src/lib/facts/panel-helpers.ts` (crear) | Puro client-safe: `pesosToCentavos` / `centavosToPesos` / `centavosToDisplay` / `donationSummary` / `FactFormState` / `buildRegistrarInput` / `factToFormState` / `versionHistoryFor` | D1 |
| `src/lib/facts/__tests__/dto.test.ts` (crear) | Tests de `toFactDTO` | D1 |
| `src/lib/facts/__tests__/panel-helpers.test.ts` (crear) | Tests de dinero, form↔input, cadena de versiones | D1 |
| `src/lib/facts/actions/contexto-actions.ts` (crear) | Server Actions `registerManualFactAction` / `revokeFactAction` (auth + cookie ws + guard + reconcile/revoke + revalidate) | D2 |
| `src/app/workspace/contexto/page.tsx` (crear) | Server Component: resuelve ws, `listFacts`, mapea a DTO, renderiza `ContextoPanel` | D3 |
| `src/components/workspace/contexto/ContextoPanel.tsx` (crear) | Client: filtros + lista + detalle/versiones + wiring del form/revoke + `router.refresh()` | D3 |
| `src/components/workspace/contexto/FactCard.tsx` (crear) | Client: una tarjeta de hecho (badge estado, resumen, período, acciones) | D3 |
| `src/components/workspace/contexto/FactForm.tsx` (crear) | Client: form tipado por kind (registrar/editar) | D3 |

---

## Task D1: Helpers puros + tests

**Files:**
- Create: `src/lib/facts/dto.ts`, `src/lib/facts/panel-helpers.ts`
- Test: `src/lib/facts/__tests__/dto.test.ts`, `src/lib/facts/__tests__/panel-helpers.test.ts`

**Interfaces:**
- Consumes: `WorkspaceFact` (`@/lib/db/schema`, type-only), `RegistrarHechoInput` / `FactKind` (`@/lib/facts/contracts`).
- Produces:
  - `interface FactDTO { id; kind: FactKind; title; body; structured: Record<string,unknown>|null; fiscalPeriod: string|null; status: 'active'|'revoked'; supersededById: string|null; source: 'chat'|'manual'; createdAt: string; updatedAt: string; revokedAt: string|null }`
  - `toFactDTO(fact: WorkspaceFact): FactDTO`
  - `pesosToCentavos(pesos: string): string`, `centavosToPesos(centavos: string): string`, `centavosToDisplay(centavos: string): string`
  - `donationSummary(structured: Record<string,unknown>|null, language: 'es'|'en'): string | null`
  - `interface FactFormState { kind: 'narrative'|'donation'; title: string; body: string; fiscalPeriod: string; montoPesos: string; articulo: string }`
  - `buildRegistrarInput(form: FactFormState): RegistrarHechoInput`
  - `factToFormState(fact: FactDTO): FactFormState`
  - `versionHistoryFor(active: FactDTO, all: FactDTO[]): FactDTO[]` (predecesores, más reciente primero)

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/lib/facts/__tests__/dto.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toFactDTO } from '../dto';
import type { WorkspaceFact } from '@/lib/db/schema';

const base: WorkspaceFact = {
  id: 'f1',
  workspaceId: 'w1',
  kind: 'donation',
  title: 'Donación fundación X',
  body: 'Donación a la fundación X.',
  structured: { montoCentavos: '5000000000', articulo: '257', fiscalYear: '2026' },
  fiscalPeriod: '2026',
  status: 'active',
  supersededById: null,
  source: 'manual',
  createdAt: new Date('2026-07-18T10:00:00.000Z'),
  updatedAt: new Date('2026-07-18T10:00:00.000Z'),
  revokedAt: null,
};

describe('toFactDTO', () => {
  it('serializa fechas a ISO y preserva el resto', () => {
    const dto = toFactDTO(base);
    expect(dto.createdAt).toBe('2026-07-18T10:00:00.000Z');
    expect(dto.revokedAt).toBeNull();
    expect(dto.kind).toBe('donation');
    expect(dto.structured).toEqual({ montoCentavos: '5000000000', articulo: '257', fiscalYear: '2026' });
    expect(dto.fiscalPeriod).toBe('2026');
  });

  it('serializa revokedAt cuando existe', () => {
    const dto = toFactDTO({ ...base, status: 'revoked', revokedAt: new Date('2026-07-19T00:00:00.000Z') });
    expect(dto.revokedAt).toBe('2026-07-19T00:00:00.000Z');
    expect(dto.status).toBe('revoked');
  });

  it('structured null (narrative) se preserva', () => {
    const dto = toFactDTO({ ...base, kind: 'narrative', structured: null });
    expect(dto.structured).toBeNull();
  });
});
```

Crear `src/lib/facts/__tests__/panel-helpers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  pesosToCentavos,
  centavosToPesos,
  centavosToDisplay,
  donationSummary,
  buildRegistrarInput,
  factToFormState,
  versionHistoryFor,
  type FactFormState,
} from '../panel-helpers';
import type { FactDTO } from '../dto';

const dto = (over: Partial<FactDTO>): FactDTO => ({
  id: 'x', kind: 'donation', title: 't', body: 'b',
  structured: { montoCentavos: '5000000000', articulo: '257', fiscalYear: '2026' },
  fiscalPeriod: '2026', status: 'active', supersededById: null, source: 'manual',
  createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:00:00.000Z', revokedAt: null,
  ...over,
});

describe('dinero MoneyCop', () => {
  it('pesos → centavos (×100, sin overflow)', () => {
    expect(pesosToCentavos('50000000')).toBe('5000000000');
    expect(pesosToCentavos('0')).toBe('0');
    expect(pesosToCentavos(' 1.234.567 ')).toBe('123456700'); // tolera separadores/espacios
  });
  it('centavos → pesos (parte entera)', () => {
    expect(centavosToPesos('5000000000')).toBe('50000000');
    expect(centavosToPesos('5000000050')).toBe('50000000'); // trunca centavos residuales
  });
  it('centavos → display COP con separador de miles y decimales', () => {
    expect(centavosToDisplay('5000000000')).toBe('$50.000.000,00');
    expect(centavosToDisplay('123456')).toBe('$1.234,56');
  });
});

describe('donationSummary', () => {
  it('describe la donación en ES', () => {
    const s = donationSummary({ montoCentavos: '5000000000', articulo: '257', fiscalYear: '2026' }, 'es');
    expect(s).toContain('$50.000.000,00');
    expect(s).toContain('257');
  });
  it('devuelve null sin structured', () => {
    expect(donationSummary(null, 'es')).toBeNull();
  });
});

describe('buildRegistrarInput', () => {
  const form: FactFormState = {
    kind: 'donation', title: 'Donación X', body: 'cuerpo',
    fiscalPeriod: '2026', montoPesos: '50000000', articulo: '257',
  };
  it('donation: arma structured (centavos) + fiscalYear = período', () => {
    const input = buildRegistrarInput(form);
    expect(input).toEqual({
      kind: 'donation', title: 'Donación X', body: 'cuerpo', fiscalPeriod: '2026',
      structured: { montoCentavos: '5000000000', articulo: '257', fiscalYear: '2026' },
    });
  });
  it('narrative: structured null + período null si vacío', () => {
    const input = buildRegistrarInput({ ...form, kind: 'narrative', fiscalPeriod: '' });
    expect(input.structured).toBeNull();
    expect(input.fiscalPeriod).toBeNull();
  });
});

describe('factToFormState (edit prefill)', () => {
  it('rehidrata pesos + artículo desde structured', () => {
    const f = factToFormState(dto({}));
    expect(f).toEqual({
      kind: 'donation', title: 't', body: 'b', fiscalPeriod: '2026',
      montoPesos: '50000000', articulo: '257',
    });
  });
  it('round-trip factToFormState → buildRegistrarInput preserva structured', () => {
    const input = buildRegistrarInput(factToFormState(dto({})));
    expect(input.structured).toEqual({ montoCentavos: '5000000000', articulo: '257', fiscalYear: '2026' });
  });
});

describe('versionHistoryFor', () => {
  it('devuelve predecesores (más reciente primero)', () => {
    const v1 = dto({ id: 'v1', status: 'revoked', supersededById: 'v2', createdAt: '2026-01-01T00:00:00.000Z' });
    const v2 = dto({ id: 'v2', status: 'revoked', supersededById: 'v3', createdAt: '2026-02-01T00:00:00.000Z' });
    const v3 = dto({ id: 'v3', status: 'active', supersededById: null, createdAt: '2026-03-01T00:00:00.000Z' });
    expect(versionHistoryFor(v3, [v1, v2, v3]).map((f) => f.id)).toEqual(['v2', 'v1']);
  });
  it('sin predecesores → []', () => {
    const only = dto({ id: 'a', supersededById: null });
    expect(versionHistoryFor(only, [only])).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr los tests → RED**

Run: `npx vitest run src/lib/facts/__tests__/dto.test.ts src/lib/facts/__tests__/panel-helpers.test.ts`
Expected: FAIL — `Cannot find module '../dto'` / `'../panel-helpers'`.

- [ ] **Step 3: Implementar `src/lib/facts/dto.ts`**

```ts
// DTO serializable de un hecho para cruzar el borde RSC→Client (fechas como
// ISO strings, sin objetos Date ni tipos de Drizzle en el cliente).

import type { WorkspaceFact } from '@/lib/db/schema';
import type { FactKind } from '@/lib/facts/contracts';

export interface FactDTO {
  id: string;
  kind: FactKind;
  title: string;
  body: string;
  structured: Record<string, unknown> | null;
  fiscalPeriod: string | null;
  status: 'active' | 'revoked';
  supersededById: string | null;
  source: 'chat' | 'manual';
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export function toFactDTO(fact: WorkspaceFact): FactDTO {
  return {
    id: fact.id,
    kind: fact.kind,
    title: fact.title,
    body: fact.body,
    structured: fact.structured ?? null,
    fiscalPeriod: fact.fiscalPeriod ?? null,
    status: fact.status,
    supersededById: fact.supersededById ?? null,
    source: fact.source,
    createdAt: fact.createdAt.toISOString(),
    updatedAt: fact.updatedAt.toISOString(),
    revokedAt: fact.revokedAt ? fact.revokedAt.toISOString() : null,
  };
}
```

- [ ] **Step 4: Implementar `src/lib/facts/panel-helpers.ts`**

```ts
// Helpers PUROS y client-safe del panel Contexto (sin imports de DB/server).
// Dinero en MoneyCop (centavos, string), form↔input tipado, cadena de versiones.

import type { RegistrarHechoInput } from '@/lib/facts/contracts';
import type { FactDTO } from './dto';

/** Pesos (enteros; tolera separadores) → centavos MoneyCop (BigInt, sin overflow). */
export function pesosToCentavos(pesos: string): string {
  const digits = pesos.replace(/[^\d]/g, '');
  if (digits === '') return '0';
  return (BigInt(digits) * 100n).toString();
}

/** Centavos → pesos (parte entera; trunca los 2 dígitos de centavos). */
export function centavosToPesos(centavos: string): string {
  const digits = centavos.replace(/[^\d]/g, '');
  if (digits === '') return '0';
  return (BigInt(digits) / 100n).toString();
}

/** Centavos → "$50.000.000,00" (formato COP: punto miles, coma decimales). */
export function centavosToDisplay(centavos: string): string {
  const digits = centavos.replace(/[^\d]/g, '') || '0';
  const cents = BigInt(digits);
  const whole = (cents / 100n).toString();
  const frac = (cents % 100n).toString().padStart(2, '0');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `$${grouped},${frac}`;
}

/** Resumen legible de una donación, o null si no hay structured. */
export function donationSummary(
  structured: Record<string, unknown> | null,
  language: 'es' | 'en',
): string | null {
  if (!structured) return null;
  const monto = typeof structured.montoCentavos === 'string' ? structured.montoCentavos : null;
  const articulo = typeof structured.articulo === 'string' ? structured.articulo : null;
  if (!monto) return null;
  const money = centavosToDisplay(monto);
  const art = articulo ? ` · Art. ${articulo} E.T.` : '';
  return language === 'es' ? `Donación ${money}${art}` : `Donation ${money}${art}`;
}

export interface FactFormState {
  kind: 'narrative' | 'donation';
  title: string;
  body: string;
  fiscalPeriod: string;
  montoPesos: string;
  articulo: string;
}

/** Form → input tipado de la tool (mismo contrato Zod que la captura por chat). */
export function buildRegistrarInput(form: FactFormState): RegistrarHechoInput {
  const period = form.fiscalPeriod.trim() === '' ? null : form.fiscalPeriod.trim();
  if (form.kind === 'donation') {
    return {
      kind: 'donation',
      title: form.title,
      body: form.body,
      fiscalPeriod: period,
      structured: {
        montoCentavos: pesosToCentavos(form.montoPesos),
        articulo: form.articulo.trim() === '' ? '257' : form.articulo.trim(),
        fiscalYear: period ?? '',
      },
    };
  }
  return { kind: 'narrative', title: form.title, body: form.body, fiscalPeriod: period, structured: null };
}

/** Hecho → estado de form (prefill para editar). Kinds no-piloto caen a narrative. */
export function factToFormState(fact: FactDTO): FactFormState {
  const kind: 'narrative' | 'donation' = fact.kind === 'donation' ? 'donation' : 'narrative';
  const s = fact.structured ?? {};
  const monto = typeof s.montoCentavos === 'string' ? s.montoCentavos : null;
  const articulo = typeof s.articulo === 'string' ? s.articulo : '257';
  return {
    kind,
    title: fact.title,
    body: fact.body,
    fiscalPeriod: fact.fiscalPeriod ?? '',
    montoPesos: monto ? centavosToPesos(monto) : '',
    articulo,
  };
}

/**
 * Predecesores de un hecho activo, más reciente primero. La fila revocada
 * apunta con `supersededById` a la fila que la reemplazó (contrato de
 * reconcileFact), así que caminamos hacia atrás: quién tiene supersededById
 * === el id actual.
 */
export function versionHistoryFor(active: FactDTO, all: FactDTO[]): FactDTO[] {
  const chain: FactDTO[] = [];
  let currentId = active.id;
  const bySuperseded = new Map<string, FactDTO>();
  for (const f of all) {
    if (f.supersededById) bySuperseded.set(f.supersededById, f);
  }
  // Evita ciclos: limita a all.length iteraciones.
  for (let i = 0; i < all.length; i++) {
    const predecessor = bySuperseded.get(currentId);
    if (!predecessor) break;
    chain.push(predecessor);
    currentId = predecessor.id;
  }
  return chain;
}
```

- [ ] **Step 5: Correr los tests → GREEN**

Run: `npx vitest run src/lib/facts/__tests__/dto.test.ts src/lib/facts/__tests__/panel-helpers.test.ts`
Expected: PASS (todos).

- [ ] **Step 6: Typecheck + guard strict-mode**

Run: `npx tsc --noEmit` → 0 errores.
Run: `npm run lint:strict-mode` → pass (estos archivos no definen schemas Zod nuevos).

- [ ] **Step 7: Commit**

```bash
git add src/lib/facts/dto.ts src/lib/facts/panel-helpers.ts src/lib/facts/__tests__/dto.test.ts src/lib/facts/__tests__/panel-helpers.test.ts
git commit -m "feat(facts): helpers puros del panel Contexto — DTO, MoneyCop, form↔input, versiones (Ola 1D)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task D2: Server Actions del panel

**Files:**
- Create: `src/lib/facts/actions/contexto-actions.ts`

**Interfaces:**
- Consumes: `requireAuthSession` (`@/lib/auth/require-session`), `getOrCreateWorkspace` (`@/lib/db/workspace`), `reconcileFact`/`revokeFact` (`@/lib/db/facts`), `registrarHechoInputSchema` (`@/lib/facts/contracts`), `assertFactInputValid` (`@/lib/facts/tool-guards`), `revalidatePath` (`next/cache`).
- Produces:
  - `type FactActionError = { ok: false; code: 'UNAUTHENTICATED'|'INVALID_INPUT'|'GUARD'|'INTERNAL'; message: string; issues?: Array<{ path: string; message: string }> }`
  - `type RegisterFactResult = { ok: true; action: 'ADD'|'SUPERSEDE'|'NOOP'; factId: string | null } | FactActionError`
  - `type RevokeFactResult = { ok: true; revoked: boolean } | FactActionError`
  - `registerManualFactAction(rawInput: unknown): Promise<RegisterFactResult>`
  - `revokeFactAction(rawFactId: unknown): Promise<RevokeFactResult>`

- [ ] **Step 1: Implementar `src/lib/facts/actions/contexto-actions.ts`**

```ts
'use server';
// ---------------------------------------------------------------------------
// Server Actions — Panel "Contexto de la empresa" (Hechos del negocio, Ola 1D)
// ---------------------------------------------------------------------------
// Comparten el MISMO handler de mutaciones (reconcileFact/revokeFact) que la
// captura por chat, así panel y chat nunca divergen. Cada acción:
//   1. Gate de sesión (requireAuthSession — fase 1 = no-op).
//   2. Deriva workspaceId del cookie (NUNCA del input).
//   3. Valida input (Zod registrarHechoInputSchema) + guard duro
//      (assertFactInputValid — kinds materiales exigen período + structured).
//   4. Llama reconcileFact({source:'manual'}) / revokeFact.
//   5. revalidatePath('/workspace/contexto') para refrescar el server component.
// ---------------------------------------------------------------------------

import { revalidatePath } from 'next/cache';
import { requireAuthSession } from '@/lib/auth/require-session';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { reconcileFact, revokeFact } from '@/lib/db/facts';
import { registrarHechoInputSchema } from '@/lib/facts/contracts';
import { assertFactInputValid } from '@/lib/facts/tool-guards';

const ROUTE = '/workspace/contexto';

export type FactActionError = {
  ok: false;
  code: 'UNAUTHENTICATED' | 'INVALID_INPUT' | 'GUARD' | 'INTERNAL';
  message: string;
  issues?: Array<{ path: string; message: string }>;
};

export type RegisterFactResult =
  | { ok: true; action: 'ADD' | 'SUPERSEDE' | 'NOOP'; factId: string | null }
  | FactActionError;

export type RevokeFactResult = { ok: true; revoked: boolean } | FactActionError;

export async function registerManualFactAction(rawInput: unknown): Promise<RegisterFactResult> {
  const gate = await requireAuthSession();
  if (!gate.ok) return { ok: false, code: 'UNAUTHENTICATED', message: 'Sesión requerida.' };

  const parsed = registrarHechoInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Datos del hecho inválidos.',
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  const input = parsed.data;
  const guardErr = assertFactInputValid(input);
  if (guardErr) return { ok: false, code: 'GUARD', message: guardErr };

  try {
    const ws = await getOrCreateWorkspace();
    const { decision, fact } = await reconcileFact({
      workspaceId: ws.id,
      kind: input.kind,
      content: { title: input.title, body: input.body, structured: input.structured },
      fiscalPeriod: input.fiscalPeriod,
      source: 'manual',
    });
    revalidatePath(ROUTE);
    return { ok: true, action: decision.action, factId: fact?.id ?? null };
  } catch (err) {
    console.error('[facts/actions/contexto] register', err);
    return { ok: false, code: 'INTERNAL', message: 'Error interno al registrar el hecho.' };
  }
}

export async function revokeFactAction(rawFactId: unknown): Promise<RevokeFactResult> {
  const gate = await requireAuthSession();
  if (!gate.ok) return { ok: false, code: 'UNAUTHENTICATED', message: 'Sesión requerida.' };

  if (typeof rawFactId !== 'string' || rawFactId.trim() === '') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Falta el id del hecho.' };
  }

  try {
    const ws = await getOrCreateWorkspace();
    const updated = await revokeFact(ws.id, rawFactId);
    revalidatePath(ROUTE);
    return { ok: true, revoked: updated !== null };
  } catch (err) {
    console.error('[facts/actions/contexto] revoke', err);
    return { ok: false, code: 'INTERNAL', message: 'Error interno al revocar el hecho.' };
  }
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit` → 0 errores (valida que `reconcileFact`/`revokeFact`/`registrarHechoInputSchema`/`assertFactInputValid` resuelven y las firmas cuadran).
Run: `npm run build` → OK.

- [ ] **Step 3: Commit**

```bash
git add src/lib/facts/actions/contexto-actions.ts
git commit -m "feat(facts): Server Actions del panel Contexto — registrar manual (SUPERSEDE) + revocar (Ola 1D)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task D3: Ruta `/workspace/contexto` + panel (server page + client UI)

**Files:**
- Create: `src/app/workspace/contexto/page.tsx`
- Create: `src/components/workspace/contexto/ContextoPanel.tsx`
- Create: `src/components/workspace/contexto/FactCard.tsx`
- Create: `src/components/workspace/contexto/FactForm.tsx`

**Interfaces:**
- Consumes: `getOrCreateWorkspace` (`@/lib/db/workspace`), `listFacts` (`@/lib/db/facts`), `toFactDTO`/`FactDTO` (`@/lib/facts/dto`), helpers de `@/lib/facts/panel-helpers`, actions de `@/lib/facts/actions/contexto-actions`, `useLanguage` (`@/context/LanguageContext`), `cn` (`@/lib/utils`).
- Produces: la ruta `/workspace/contexto` renderizada dentro del shell del workspace.

- [ ] **Step 1: Server page `src/app/workspace/contexto/page.tsx`**

```tsx
// /workspace/contexto — Panel "Contexto de la empresa" (Hechos del negocio, Ola 1D).
// Server Component: resuelve el workspace del cookie, lee los hechos y los pasa
// (mapeados a DTO serializable) al panel cliente. Fallback vacío si algo falla
// server-side (patrón de comando/page.tsx — nunca pantalla blanca).

import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { listFacts } from '@/lib/db/facts';
import { toFactDTO } from '@/lib/facts/dto';
import { ContextoPanel } from '@/components/workspace/contexto/ContextoPanel';

export const dynamic = 'force-dynamic'; // el cookie de workspace obliga SSR per request

export default async function ContextoPage() {
  try {
    const ws = await getOrCreateWorkspace();
    const facts = await listFacts(ws.id);
    return <ContextoPanel facts={facts.map(toFactDTO)} />;
  } catch (err) {
    console.warn('[/workspace/contexto] fallback vacío:', err);
    return <ContextoPanel facts={[]} />;
  }
}
```

- [ ] **Step 2: `src/components/workspace/contexto/FactForm.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { FactFormState } from '@/lib/facts/panel-helpers';

const inputCls = cn(
  'w-full h-10 px-3 rounded-lg border bg-n-0 border-n-200',
  'text-sm text-n-1000 placeholder:text-n-500',
  'focus:outline-none focus:border-gold-500/60 focus-visible:ring-2 focus-visible:ring-gold-500/40 transition-colors',
);
const labelCls = 'block text-xs font-medium text-n-800 mb-1';

export function FactForm({
  initial,
  submitting,
  error,
  language,
  onSubmit,
  onCancel,
}: {
  initial: FactFormState;
  submitting: boolean;
  error: string | null;
  language: 'es' | 'en';
  onSubmit: (form: FactFormState) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FactFormState>(initial);
  const set = <K extends keyof FactFormState>(k: K, v: FactFormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const isDonation = form.kind === 'donation';
  const t = (es: string, en: string) => (language === 'es' ? es : en);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
      className="rounded-xl border border-n-200 bg-n-0 p-4 space-y-3"
    >
      <div>
        <label className={labelCls}>{t('Tipo de hecho', 'Fact type')}</label>
        <select
          value={form.kind}
          onChange={(e) => set('kind', e.target.value as FactFormState['kind'])}
          className={inputCls}
          aria-label={t('Tipo de hecho', 'Fact type')}
        >
          <option value="narrative">{t('Narrativo (contexto)', 'Narrative (context)')}</option>
          <option value="donation">{t('Donación (Art. 257 E.T.)', 'Donation (Art. 257)')}</option>
        </select>
      </div>

      <div>
        <label className={labelCls}>{t('Título', 'Title')}</label>
        <input
          className={inputCls}
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          required
          maxLength={200}
          placeholder={t('Donación fundación X', 'Donation to foundation X')}
        />
      </div>

      <div>
        <label className={labelCls}>{t('Descripción', 'Description')}</label>
        <textarea
          className={cn(inputCls, 'h-auto min-h-[72px] py-2 resize-y')}
          value={form.body}
          onChange={(e) => set('body', e.target.value)}
          required
          placeholder={t('Anclado en tus palabras…', 'Anchored in your words…')}
        />
      </div>

      <div>
        <label className={labelCls}>
          {t('Período fiscal (año)', 'Fiscal period (year)')}
          {isDonation && <span className="text-danger"> *</span>}
        </label>
        <input
          className={inputCls}
          value={form.fiscalPeriod}
          onChange={(e) => set('fiscalPeriod', e.target.value)}
          maxLength={8}
          inputMode="numeric"
          placeholder="2026"
        />
      </div>

      {isDonation && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>
              {t('Monto donado (COP)', 'Donation amount (COP)')}<span className="text-danger"> *</span>
            </label>
            <input
              className={inputCls}
              value={form.montoPesos}
              onChange={(e) => set('montoPesos', e.target.value)}
              inputMode="numeric"
              placeholder="50000000"
            />
          </div>
          <div>
            <label className={labelCls}>{t('Artículo E.T.', 'E.T. article')}</label>
            <input
              className={inputCls}
              value={form.articulo}
              onChange={(e) => set('articulo', e.target.value)}
              placeholder="257"
            />
          </div>
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="h-9 px-3 rounded-lg text-sm text-n-800 hover:text-n-1000 hover:bg-gold-500/6 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
        >
          {t('Cancelar', 'Cancel')}
        </button>
        <button
          type="submit"
          disabled={submitting}
          className={cn(
            'h-9 px-4 rounded-lg text-sm font-semibold bg-gold-500 text-n-0',
            'hover:bg-gold-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {submitting ? t('Guardando…', 'Saving…') : t('Guardar', 'Save')}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: `src/components/workspace/contexto/FactCard.tsx`**

```tsx
'use client';

import { cn } from '@/lib/utils';
import { Pencil, Ban } from 'lucide-react';
import type { FactDTO } from '@/lib/facts/dto';
import { donationSummary } from '@/lib/facts/panel-helpers';

const KIND_LABEL: Record<string, { es: string; en: string }> = {
  narrative: { es: 'Narrativo', en: 'Narrative' },
  donation: { es: 'Donación', en: 'Donation' },
  leasing: { es: 'Leasing', en: 'Leasing' },
  loss_carryforward: { es: 'Pérdida fiscal', en: 'Loss carryforward' },
};

export function FactCard({
  fact,
  language,
  onEdit,
  onRevoke,
  onToggleHistory,
  historyCount,
  historyOpen,
}: {
  fact: FactDTO;
  language: 'es' | 'en';
  onEdit: (fact: FactDTO) => void;
  onRevoke: (fact: FactDTO) => void;
  onToggleHistory: (fact: FactDTO) => void;
  historyCount: number;
  historyOpen: boolean;
}) {
  const t = (es: string, en: string) => (language === 'es' ? es : en);
  const isActive = fact.status === 'active';
  const isPilotKind = fact.kind === 'narrative' || fact.kind === 'donation';
  const summary = donationSummary(fact.structured, language);
  const kindLabel = (KIND_LABEL[fact.kind] ?? KIND_LABEL.narrative)[language];
  const created = new Date(fact.createdAt).toLocaleDateString(language === 'es' ? 'es-CO' : 'en-US');

  return (
    <article className={cn('rounded-xl border p-4', isActive ? 'border-n-200 bg-n-0' : 'border-n-200 bg-n-50/60')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono uppercase tracking-widest text-n-600">{kindLabel}</span>
            {fact.fiscalPeriod && (
              <span className="text-[10px] font-mono text-n-600">· {fact.fiscalPeriod}</span>
            )}
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full',
                isActive ? 'bg-gold-500/10 text-n-900' : 'bg-n-100 text-n-700',
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', isActive ? 'bg-gold-500' : 'bg-n-500')} />
              {isActive ? t('activo', 'active') : t('revocado', 'revoked')}
            </span>
          </div>
          <h3 className="mt-1 text-sm font-semibold text-n-1000 truncate">{fact.title}</h3>
          {summary && <p className="mt-0.5 text-xs text-n-800">{summary}</p>}
          <p className="mt-1 text-xs text-n-700 line-clamp-2">{fact.body}</p>
          <p className="mt-1.5 text-[10px] font-mono text-n-500">
            {fact.source === 'chat' ? 'chat' : t('manual', 'manual')} · {created}
          </p>
          {isActive && fact.fiscalPeriod && (
            <p className="mt-1 text-[10px] text-n-600">
              {t(
                `Se incluirá en tus reportes de ${fact.fiscalPeriod}.`,
                `Will be included in your ${fact.fiscalPeriod} reports.`,
              )}
            </p>
          )}
        </div>

        {isActive && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onEdit(fact)}
              disabled={!isPilotKind}
              title={t('Editar (nueva versión)', 'Edit (new version)')}
              aria-label={t('Editar', 'Edit')}
              className="p-1.5 rounded-md text-n-700 hover:text-n-1000 hover:bg-gold-500/6 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onRevoke(fact)}
              title={t('Revocar', 'Revoke')}
              aria-label={t('Revocar', 'Revoke')}
              className="p-1.5 rounded-md text-n-700 hover:text-danger hover:bg-danger/6 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
            >
              <Ban className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {historyCount > 0 && (
        <button
          type="button"
          onClick={() => onToggleHistory(fact)}
          className="mt-2 text-[10px] font-mono uppercase tracking-wider text-n-600 hover:text-n-900 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 rounded"
          aria-expanded={historyOpen}
        >
          {historyOpen ? '▾' : '▸'} {t('Historial de versiones', 'Version history')} ({historyCount})
        </button>
      )}
    </article>
  );
}
```

- [ ] **Step 4: `src/components/workspace/contexto/ContextoPanel.tsx`**

```tsx
'use client';

// Panel "Contexto de la empresa": lista/filtra/registra/edita/revoca hechos.
// Comparte el handler de mutación con el chat vía las Server Actions.

import { useMemo, useState, useTransition, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/context/LanguageContext';
import type { FactDTO } from '@/lib/facts/dto';
import type { FactFormState } from '@/lib/facts/panel-helpers';
import { buildRegistrarInput, factToFormState, versionHistoryFor } from '@/lib/facts/panel-helpers';
import {
  registerManualFactAction,
  revokeFactAction,
} from '@/lib/facts/actions/contexto-actions';
import { FactCard } from './FactCard';
import { FactForm } from './FactForm';

const EMPTY_FORM: FactFormState = {
  kind: 'narrative', title: '', body: '', fiscalPeriod: '', montoPesos: '', articulo: '257',
};

type KindFilter = 'all' | 'narrative' | 'donation';

export function ContextoPanel({ facts }: { facts: FactDTO[] }) {
  const { language } = useLanguage();
  const router = useRouter();
  const t = (es: string, en: string) => (language === 'es' ? es : en);

  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [periodFilter, setPeriodFilter] = useState<string>('all');
  const [onlyActive, setOnlyActive] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [formInitial, setFormInitial] = useState<FactFormState>(EMPTY_FORM);
  // Remonta FactForm al cambiar de destino (registrar vs editar A vs editar B):
  // FactForm siembra su estado interno con `initial` SOLO en el mount.
  const [editKey, setEditKey] = useState('new');
  const [formError, setFormError] = useState<string | null>(null);
  const [openHistory, setOpenHistory] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const periods = useMemo(() => {
    const set = new Set<string>();
    for (const f of facts) if (f.fiscalPeriod) set.add(f.fiscalPeriod);
    return [...set].sort().reverse();
  }, [facts]);

  const visible = useMemo(() => {
    return facts.filter((f) => {
      if (onlyActive && f.status !== 'active') return false;
      if (kindFilter !== 'all' && f.kind !== kindFilter) return false;
      if (periodFilter !== 'all' && f.fiscalPeriod !== periodFilter) return false;
      return true;
    });
  }, [facts, onlyActive, kindFilter, periodFilter]);

  const openRegister = useCallback(() => {
    setFormInitial(EMPTY_FORM);
    setEditKey('new');
    setFormError(null);
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((fact: FactDTO) => {
    setFormInitial(factToFormState(fact));
    setEditKey(fact.id);
    setFormError(null);
    setFormOpen(true);
  }, []);

  const submit = useCallback(
    (form: FactFormState) => {
      setFormError(null);
      startTransition(async () => {
        const res = await registerManualFactAction(buildRegistrarInput(form));
        if (res.ok) {
          setFormOpen(false);
          router.refresh();
        } else {
          setFormError(res.message);
        }
      });
    },
    [router],
  );

  const revoke = useCallback(
    (fact: FactDTO) => {
      const msg =
        language === 'es'
          ? '¿Revocar este hecho? No se borra (queda como revocado).'
          : 'Revoke this fact? It is soft-deleted, never erased.';
      if (!window.confirm(msg)) return;
      startTransition(async () => {
        const res = await revokeFactAction(fact.id);
        if (res.ok) router.refresh();
        else window.alert(res.message);
      });
    },
    [router, language],
  );

  const toggleHistory = useCallback((fact: FactDTO) => {
    setOpenHistory((prev) => {
      const next = new Set(prev);
      if (next.has(fact.id)) next.delete(fact.id);
      else next.add(fact.id);
      return next;
    });
  }, []);

  const selectCls = cn(
    'h-9 px-2 rounded-lg border bg-n-0 border-n-200 text-xs text-n-1000',
    'focus:outline-none focus:border-gold-500/60 focus-visible:ring-2 focus-visible:ring-gold-500/40',
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8 md:py-10">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Info className="h-4 w-4 text-gold-500" aria-hidden="true" />
          <p className="font-mono text-xs uppercase tracking-widest text-gold-600 font-semibold">
            {t('Memoria de contexto', 'Context memory')}
          </p>
        </div>
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <h1 className="font-serif text-3xl font-bold text-n-1000 tracking-tight">
            {t('Contexto de la empresa', 'Company context')}
          </h1>
          <button
            type="button"
            onClick={openRegister}
            className={cn(
              'inline-flex items-center gap-1.5 h-10 px-4 rounded-lg',
              'bg-gold-500 text-n-0 text-sm font-semibold hover:bg-gold-600 transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
            )}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('Registrar hecho', 'Add fact')}
          </button>
        </div>
        <p className="mt-1.5 text-sm text-n-700 max-w-xl">
          {t(
            'Los hechos duraderos de tu negocio que alimentan tus reportes. Editar crea una versión nueva; revocar nunca borra (auditoría DIAN).',
            'Durable facts about your business that feed your reports. Editing creates a new version; revoking never erases (DIAN audit).',
          )}
        </p>
      </header>

      {/* Filtros */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <select className={selectCls} value={kindFilter} onChange={(e) => setKindFilter(e.target.value as KindFilter)} aria-label={t('Filtrar por tipo', 'Filter by kind')}>
          <option value="all">{t('Todos los tipos', 'All kinds')}</option>
          <option value="narrative">{t('Narrativos', 'Narrative')}</option>
          <option value="donation">{t('Donaciones', 'Donations')}</option>
        </select>
        <select className={selectCls} value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)} aria-label={t('Filtrar por período', 'Filter by period')}>
          <option value="all">{t('Todos los períodos', 'All periods')}</option>
          {periods.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1.5 text-xs text-n-800 select-none cursor-pointer">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} className="accent-gold-500" />
          {t('Solo activos', 'Active only')}
        </label>
      </div>

      {formOpen && (
        <div className="mb-5">
          <FactForm
            key={editKey}
            initial={formInitial}
            submitting={pending}
            error={formError}
            language={language}
            onSubmit={submit}
            onCancel={() => setFormOpen(false)}
          />
        </div>
      )}

      {/* Lista */}
      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-n-200 py-12 text-center">
          <p className="text-sm text-n-700">
            {t('Aún no hay hechos que coincidan. Regístralos aquí o menciónalos en el chat.', 'No matching facts yet. Add them here or mention them in chat.')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((fact) => {
            const history = fact.status === 'active' ? versionHistoryFor(fact, facts) : [];
            const isOpen = openHistory.has(fact.id);
            return (
              <div key={fact.id}>
                <FactCard
                  fact={fact}
                  language={language}
                  onEdit={openEdit}
                  onRevoke={revoke}
                  onToggleHistory={toggleHistory}
                  historyCount={history.length}
                  historyOpen={isOpen}
                />
                {isOpen && history.length > 0 && (
                  <ul className="mt-1 ml-3 border-l border-n-200 pl-3 space-y-1">
                    {history.map((h) => (
                      <li key={h.id} className="text-xs text-n-600">
                        <span className="font-mono text-[10px] text-n-500">
                          {new Date(h.createdAt).toLocaleDateString(language === 'es' ? 'es-CO' : 'en-US')}
                        </span>{' '}
                        · {h.title}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ContextoPanel;
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit` → 0 errores.
Run: `npm run build` → OK (`/workspace/contexto` compila como ruta `force-dynamic`; el chunk cliente resuelve el import de las Server Actions).

- [ ] **Step 6: Commit**

```bash
git add src/app/workspace/contexto/page.tsx src/components/workspace/contexto/ContextoPanel.tsx src/components/workspace/contexto/FactCard.tsx src/components/workspace/contexto/FactForm.tsx
git commit -m "feat(facts): ruta /workspace/contexto + panel (lista/filtros/form/revoca/versiones) (Ola 1D)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (contra el spec §5 + código real)

- §5 "ruta propia `/workspace/contexto` (nueva), accesible desde el shell, deep-linking" → D3 page (route existe; deep-linkable por URL). **Nota:** el enlace desde el mensaje de confirmación del chat y una entrada de nav en el shell (EliteHeader/CommandPalette) quedan como follow-up (no bloquean el piloto; evitan tocar shells compartidos). Listado en open items.
- §5 "lista con filtros [kind][período][☑ solo activos]" → D3 ContextoPanel (3 filtros). ✅
- §5 "tarjeta: monto+artículo, cuerpo, source+fecha, estado ● activo" → D3 FactCard (donationSummary + body + source/fecha + badge). ✅
- §5 "Editar → crea nueva versión (SUPERSEDE), nunca in-place" → D3 openEdit prefill (`factToFormState`) + submit vía `registerManualFactAction` → `reconcileFact` supersede. ✅
- §5 "Revocar → soft-delete con confirmación, jamás borra" → D3 `revoke` (window.confirm) → `revokeFactAction` → `revokeFact`. ✅
- §5 "Registrar hecho → formulario tipado por kind, mismo contrato Zod, source='manual'" → D3 FactForm + D2 action (`registrarHechoInputSchema` + `source:'manual'`). ✅
- §5 "Historial de versiones plegado por defecto; cadena supersededById" → D1 `versionHistoryFor` + D3 toggle plegado. ✅
- §5 "Chips 'Aparece en:'" → **diferido a Ola 2** (depende de que los reportes lean hechos); el panel muestra una nota de período honesta en su lugar. Documentado como open item.
- §5 "comparte un solo handler de mutaciones con la tool" → D2 usa `reconcileFact`/`revokeFact` de Ola 0 (los mismos que la tool de Team A). ✅
- §5 "i18n" → **inline ternarios**, sin tocar `dictionaries.ts` (decisión Johan). ✅
- §5 "requireAuthSession + workspaceId por cookie" → D2 (`requireAuthSession` + `getOrCreateWorkspace`; workspaceId NUNCA del input). ✅
- **Handoff CRÍTICO Ola 0** (kinds materiales exigen período no-nulo) → D2 aplica `assertFactInputValid` antes de `reconcileFact`. ✅
- **MoneyCop** → D1 `pesosToCentavos` (BigInt) + tests; el form recibe pesos, persiste centavos. ✅
- **Placeholder scan:** cada step trae código real completo (helpers, tests, actions, page, 3 componentes). ✅
- **Type consistency:** `FactDTO` (D1) consumido por D3; `FactFormState` (D1) por D3 FactForm/Panel; `RegisterFactResult`/`RevokeFactResult` (D2) por D3; firmas de Ola 0 (`reconcileFact`/`revokeFact`/`listFacts`) sin redefinir. ✅
- **Fuera de alcance:** captura por chat (Team A ✅), chip de navegación (Team B ✅), cálculo donation→TOTAL VINCULANTE + decision records (Team C), integración a reportes (Ola 2). ✅

### Open items (follow-up, no bloquean D)
1. Entrada de navegación al panel desde el shell (EliteHeader AreaNav o CommandPalette) + convertir la mención "Contexto de la empresa" del mensaje de confirmación del chat (Team A) en enlace real. Requiere decisión de dónde colgar el acceso.
2. Chips "Aparece en: [Reporte NIIF][Planeación]" reales — Ola 2 (cuando los reportes lean hechos).
3. Feedback de éxito vía Toast del design-system en vez de cerrar el form en silencio / `window.alert` en revoke (polish).

### Verificación final de rama (tras D1+D2+D3)
- `npx tsc --noEmit` · `npm run build` · `npm run lint:strict-mode` · `npx vitest run src/lib/facts`
