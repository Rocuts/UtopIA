# Mapa de lectura por tarea

Este índice orienta; el contrato detallado vive en el código y en las especificaciones enlazadas por `CLAUDE.md`. No hace falta leer todas las filas para cada tarea.

| Frente | Puntos de entrada | Verificación dirigida |
|---|---|---|
| Procedencia de informes y exportaciones | `src/app/api/financial-report/export/route.ts`, `src/lib/export/financial-export-validation.ts`, `src/lib/storage/conversation-history.ts`, `src/lib/auth/require-session.ts` | `src/app/api/financial-report/__tests__/export-integrity.route.test.ts`; seguir el almacenamiento servidor desde imports y referencias antes de diseñar otro |
| Entrada del balance (UI, XLSX, API v1) | `src/app/api/upload/route.ts` (campo `rawData` limpio), `src/lib/upload/xlsx-csv.ts` (RFC 4180), `src/lib/preprocessing/raw-data.ts` (recorte del informe antepuesto, bloques `[period=…]`), `src/lib/api/trial-balances.ts` | `niif-ui-upload-chain.test.ts`, `export-raw-data.route.test.ts`, `src/lib/api/__tests__/trial-balances.test.ts` |
| Aritmética y contrato NIIF | `src/lib/preprocessing/trial-balance.ts` (parseo, anclas, KPIs), `src/lib/preprocessing/curator-rules/` (R8 sin absorción, bloqueos en `curator-blockers.ts`), `src/lib/agents/financial/contracts/{anchors,deterministic-breakdown,niif-report,money}.ts`, `src/lib/agents/financial/validators/niif-json-validator.ts` (E1–E20; E18 EFE vs determinista) | `anclas-pyg-y-comparativo.test.ts`, `efe-cruce-determinista.test.ts`, `validador-ecp-esf-anclas.test.ts`, `curator-integridad-2026-09.test.ts`, `financial-integrity-regression.test.ts`, `precision-capacity.test.ts` |
| Flujo del pipeline y gates | `src/lib/agents/financial/orchestrator.ts` (TOTALES VINCULANTES, Bridge de Cuadratura), `src/lib/agents/financial/validators/strategy-anchors.ts`, `src/app/api/financial-report/{niif,consolidate,html,export}/route.ts`, `src/lib/pillars/audit-report-emittable.ts` | `bridge-motivos-persistentes.test.ts`, `niif-phase-e18-reconciliation.test.ts`, `strategy-anchors.test.ts`, `consolidate.route.test.ts`, `export-single-source.route.test.ts` |
| Métricas canónicas | `src/lib/pillars/ebitda.ts` (EBITDA único), `src/lib/export/revenue.ts` (ingresos operacionales 41 − 4175), `src/lib/pillars/shared-metrics.ts`, `src/lib/accounting/renta-credit.ts` (regla única de crédito de renta) | pruebas de cada módulo en su `__tests__` |
| Entrada ERP, periodo, moneda y caché | `src/lib/erp/trial-balance-serialization.ts`, `src/lib/erp/pipeline.ts`, `src/lib/erp/service.ts` | `src/lib/erp/__tests__/trial-balance-integrity.test.ts` |
| KPI y presentación de datos ausentes | `src/lib/kpis/live.ts`, `src/components/workspace/AreaCard.tsx`, `src/components/workspace/ExecutiveDashboard.tsx` | `src/lib/kpis/__tests__/live-integrity.test.ts` |
| TTD y bases fiscales | `src/lib/agents/financial/escudo-survival/fiscal-agent/tools/ccv-calculator.ts`, `schemas.ts` y `types.ts` del mismo módulo; agentes CCV y Supervivencia | `src/lib/agents/financial/escudo-survival/fiscal-agent/__tests__/ccv-tasa-minima.test.ts`; luego consumidores y narrativas |
| UVT y vigencia | `src/lib/accounting/tax-engine/constants.ts` | `src/lib/accounting/tax-engine/__tests__/constants.test.ts` |
| Excel y PDF | `src/lib/export/excel-export.ts`, `src/lib/export/statement-presentation.ts` (signos y rótulos compartidos), `src/lib/export/pdf-elite-react/`, ruta export | `src/lib/export/__tests__/four-statements.test.ts`, `src/lib/export/pdf-elite-react/__tests__/route-integration.test.ts` |
| Auth y aislamiento | `src/proxy.ts`, `src/lib/auth/enabled.ts`, `src/lib/auth/require-session.ts`; seguir resolución de tenant y persistencia desde cada handler | `src/__tests__/proxy-auth-aliases.test.ts`, `src/lib/auth/__tests__/require-session.test.ts` y casos por endpoint |

## Comandos

Usar scripts del `package.json` del checkout actual. Para una corrección concreta, empezar por `npx vitest run <ruta-de-prueba>`.

- Suite: `npm test`.
- Tipos: `npx tsc --noEmit`.
- Lint: `npm run lint`.
- Contratos LLM: `npm run lint:strict-mode`.
- Compilación: `npm run build`.

La compilación previa usó configuración ficticia de build, sin servicios reales. No copies esos valores a producción. Pruebas de integración, carga y proveedores necesitan un entorno apropiado y autorización para sus efectos.

## Documentos por necesidad

- Continuidad: `docs/agents/HANDOFF.md`.
- Evidencia de revisión financiera: `docs/reviews/auditoria-integral-niif-2026-09-24.md` (vigente) y `docs/reviews/main-financial-integrity-2026-09-05.md` (anterior).
- Arquitectura amplia, solamente si la tarea la requiere: `docs/ARCHITECTURE.md`.
- Contrato financiero: `docs/spec/financial-pipeline-v2.1.md`.
- Esquemas LLM: `docs/spec/zod-strict-mode-2026.md`.
- Postura de seguridad pública: `docs/AUDITORIA_OWASP_2026-08.md` (histórico; comprobar vigencia).
