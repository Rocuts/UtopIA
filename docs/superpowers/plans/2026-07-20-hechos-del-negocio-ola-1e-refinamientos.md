# Hechos del negocio — Ola 1 · Refinamientos Ola-0 (E1: monto>0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar server-side el hueco encontrado en el review final de Team D: una donación con monto ≤ 0 se persistía como hecho material de $0. El guard actual (`assertFactInputValid`) sólo exige `fiscalPeriod` + `structured` para kinds materiales, pero NO valida el monto. Endurecerlo cubre **ambas** superficies (la tool de chat de Team A y la Server Action del panel de Team D), porque ambas llaman a `assertFactInputValid`.

**Architecture:** Un único cambio en el guard puro server-side `assertFactInputValid` (`src/lib/facts/tool-guards.ts`) + tests. Sin DB, sin tocar la UI (el guard client-side de D queda como defensa-en-profundidad + feedback inmediato).

**Tech Stack:** TypeScript · Vitest · BigInt (ES2017-safe).

## Global Constraints

- **`assertFactInputValid` es PURO** (sin DB) y lo consumen dos callers: la tool `registrar_hecho_negocio` (`src/lib/agents/tools/registry.ts`, case dispatcher) y la action `registerManualFactAction` (`src/lib/facts/actions/contexto-actions.ts`). No cambiar su firma `(input: RegistrarHechoInput) => string | null` — sólo añadir una regla.
- **MoneyCop:** `structured.montoCentavos` es un string de centavos validado por `moneyCop` (`^-?\d+$`), que **admite `0` y negativos**. El guard debe rechazar `<= 0`.
- **ES2017 target:** los literales BigInt (`0n`) NO compilan (TS2737). Usar `BigInt(0)` (igual que `money.ts` / `panel-helpers.ts`).
- **`BigInt(...)` es seguro aquí:** ambos callers parsean con `registrarHechoInputSchema` ANTES de llamar al guard, así que `montoCentavos` ya es un string entero válido (`^-?\d+$`).
- **WIP ajeno intacto:** stage SOLO las rutas exactas del commit. No `git add -A`.
- **Gate:** `npx vitest run src/lib/facts/__tests__/tool-guards.test.ts` · `npx tsc --noEmit` · `npm run lint:strict-mode`.

---

## File Structure

| Archivo | Responsabilidad | Task |
|---|---|---|
| `src/lib/facts/tool-guards.ts` (modificar) | Añadir la regla donation `montoCentavos > 0` a `assertFactInputValid` | E1 |
| `src/lib/facts/__tests__/tool-guards.test.ts` (modificar) | Tests: monto 0 y negativo rechazados; positivo aceptado | E1 |

---

## Task E1: Guard `montoCentavos > 0` para donaciones

**Files:**
- Modify: `src/lib/facts/tool-guards.ts`
- Test: `src/lib/facts/__tests__/tool-guards.test.ts`

**Interfaces:**
- Consumes: `RegistrarHechoInput` (`./contracts`) — `structured: DonationStructured | null`, `structured.montoCentavos: string`.
- Produces: `assertFactInputValid` (misma firma) ahora devuelve un mensaje de error si una donación trae `montoCentavos <= 0`.

- [ ] **Step 1: Escribir los tests que fallan** — añadir estos casos al `describe('assertFactInputValid', ...)` existente en `src/lib/facts/__tests__/tool-guards.test.ts` (tras el test `RECHAZA donation sin structured`):

```ts
  it('RECHAZA donation con monto cero', () => {
    const bad: RegistrarHechoInput = {
      ...donation('2026'),
      structured: { montoCentavos: '0', articulo: '257', fiscalYear: '2026' },
    };
    expect(assertFactInputValid(bad)).toMatch(/monto/);
  });

  it('RECHAZA donation con monto negativo', () => {
    const bad: RegistrarHechoInput = {
      ...donation('2026'),
      structured: { montoCentavos: '-100', articulo: '257', fiscalYear: '2026' },
    };
    expect(assertFactInputValid(bad)).toMatch(/monto/);
  });

  it('acepta donation con monto positivo', () => {
    expect(assertFactInputValid(donation('2026'))).toBeNull(); // '5000000000' > 0
  });
```

- [ ] **Step 2: Correr los tests → RED**

Run: `npx vitest run src/lib/facts/__tests__/tool-guards.test.ts`
Expected: FAIL — los dos casos `RECHAZA ... monto cero/negativo` fallan (el guard actual devuelve `null` para monto 0/negativo). El caso positivo ya pasa.

- [ ] **Step 3: Implementar la regla en `src/lib/facts/tool-guards.ts`** — insertar el bloque tras el check de `structured === null`, antes del `return null` final:

```ts
  // Donación: el monto debe ser > 0. Un hecho material de $0 (o negativo) sería
  // basura que en un reporte no aportaría / restaría, y elude tanto a la LLM como
  // al usuario. El schema (moneyCop `^-?\d+$`) admite 0 y negativos; se rechazan
  // aquí. BigInt(0) (no `0n`) por el target ES2017.
  if (
    input.kind === 'donation' &&
    input.structured !== null &&
    BigInt(input.structured.montoCentavos) <= BigInt(0)
  ) {
    return `Una donación requiere un monto mayor a cero (montoCentavos en centavos). Pregunta al usuario el monto donado y reintenta.`;
  }
```

- [ ] **Step 4: Correr los tests → GREEN**

Run: `npx vitest run src/lib/facts/__tests__/tool-guards.test.ts`
Expected: PASS (7 tests — los 4 originales + los 3 nuevos).

- [ ] **Step 5: Typecheck + guard strict-mode**

Run: `npx tsc --noEmit` → 0 errores (`input.structured !== null` estrecha a `DonationStructured`, cuyo `montoCentavos` es `string`).
Run: `npm run lint:strict-mode` → pass (tool-guards.ts no define schemas Zod).

- [ ] **Step 6: Commit**

```bash
git add src/lib/facts/tool-guards.ts src/lib/facts/__tests__/tool-guards.test.ts
git commit -m "fix(facts): assertFactInputValid rechaza donación con monto <= 0 (Ola 1E)

Cubre panel (Server Action) y tool de chat (Team A) — ambos llaman al guard.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- Hueco del review final de Team D (monto blanco/0 → $0 material) cerrado server-side, en el guard compartido por panel + tool de chat. ✅
- Firma de `assertFactInputValid` sin cambios (sólo una regla nueva). ✅
- ES2017-safe (`BigInt(0)`, no `0n`). ✅
- Type consistency: `input.structured !== null` estrecha a `DonationStructured.montoCentavos: string`; `BigInt(string)` seguro (input ya parseado por el schema). ✅
- **Fuera de alcance (E2 — planning aparte):** el fix "narrativos por id explícito" (decisión Johan) requiere cambiar `decideReconciliation`/`reconcileFact` + una **migración del índice `uq_active_fact`** (excluir narrativos), operación GATED — se planifica y valida el approach de DB con Johan por separado.

### Verificación final
- `npx vitest run src/lib/facts/__tests__/tool-guards.test.ts` · `npx tsc --noEmit` · `npm run lint:strict-mode`
