# Tests — UtopIA 1+1 Élite

## Cómo correr los tests

```bash
# Todos los tests unitarios (una sola vez)
npm test

# Modo watch (re-corre al guardar)
npm run test:watch

# Tests de integración (requieren @workflow/vitest cuando esté disponible)
npm run test:integration

# UI interactiva (explorador de tests en el browser)
npx vitest --ui
```

## Qué cubre esta suite (D6 — base unit tests)

| Archivo | Módulo | Casos | Descripción |
|---|---|---|---|
| `double-entry/__tests__/validate.test.ts` | `validateBalance`, `buildReversalLines` | 14 | Partida doble BigInt-centavos: balance, restricciones de línea, reversals, precisión flotante |
| `tax-engine/__tests__/constants.test.ts` | `UVT_2026_COP`, `uvtToCopByYear` | 7 | Constantes UVT Colombia 2026, umbrales Art. 401 ET |
| `tax-engine/__tests__/rules-engine.test.ts` | `matchRules` | 9 | Motor de reglas: filtros por transactionType, régimen, umbral UVT, workspace override |
| `tax-engine/__tests__/integrity-validator.test.ts` | `validateLines` | 6 | Validador `tax = base × rate` ±1 COP BigInt |
| `banking/__tests__/fingerprint.test.ts` | `fingerprintTransaction`, `sha256Hex` | 9 | Hash SHA-256 determinístico, normalización de espacios/montos |
| `banking/__tests__/csv-parser.test.ts` | `csvParser.parse` | 12 | Parser CSV: formatos Bancolombia/CITI, números ES-CO, latin-1, errores |
| `adjustments/depreciation/__tests__/calculator.test.ts` | `calculateDepreciation` | 9 | Depreciación lineal BigInt: cuota exacta, salvage, skip conditions, idempotencia |
| `workflows/monthly-close/__tests__/canonical.test.ts` | `buildCanonicalPayload` | 8 | Hash de período: determinismo, sort por entryNumber, encadenamiento, override |

**Total: ~74 test cases**

## Qué NO cubre esta suite

- **Tests de integración** con la base de datos real (Neon/Postgres). Requieren `DATABASE_URL` real y corren con `npm run test:integration`. Ver `vitest.integration.config.ts`.
- **Tests de UI/componentes** (React). Agregar `environment: 'happy-dom'` en `vitest.config.ts` y usar `@testing-library/react` cuando sea necesario.
- **Tests e2e** (Playwright/Cypress). No configurados.
- **Workflow steps** que usan el SDK de Vercel Workflow. Requieren `@workflow/vitest` cuando Vercel lo publique — el slot está configurado en `vitest.integration.config.ts`.
- **Pipelines financieras** (Financial Report, Audit, Tax Planning, etc.). Son tests de integración que llaman a OpenAI — usar el smoke-test script en `scripts/smoke-test-1plus1.ts`.

## Cómo agregar el próximo test

1. Crear `src/lib/<módulo>/__tests__/<nombre>.test.ts`.
2. Importar las funciones a probar usando alias `@/lib/...`.
3. Si el módulo hace I/O (DB, red): mockear el módulo con `vi.mock('@/lib/db/...')` — no modificar código de producción.
4. Correr `npm test` y verificar que pasa.
5. Correr `npx tsc --noEmit` para confirmar que compila.

## Tests de integración (patrón futuro)

Los archivos `*.integration.test.ts` son recogidos por `vitest.integration.config.ts`.
Cuando `@workflow/vitest` esté disponible como paquete NPM publicado, agregar al config:

```ts
import { workflow } from '@workflow/vitest';
// ...
plugins: [tsconfigPaths(), workflow()],
```

Y descomentar la línea en `vitest.integration.config.ts`.
