# Mapa de lectura por tarea

Este índice orienta; el contrato detallado vive en el código y en las especificaciones enlazadas por `CLAUDE.md`. No hace falta leer todas las filas para cada tarea.

| Frente | Puntos de entrada | Verificación dirigida |
|---|---|---|
| Procedencia de informes y exportaciones | `src/lib/db/financial-report-versions.ts`, `src/app/api/financial-report/{niif,strategy,governance,export}/route.ts`, `src/lib/db/workspace.ts`, `src/components/workspace/PipelineWorkspace.tsx` | `npm run test:report-integrity` (PostgreSQL embebido); `export-integrity.route.test.ts`; contrato y límites en `docs/reviews/persisted-report-exports-2026-09-05.md` |
| Procedencia de auditoría y meta-auditoría | `src/app/api/financial-audit/route.ts`, `src/app/api/financial-quality/route.ts`, `saveAuditVersion`/`loadBoundAuditVersion`/`resolveVersionLineage` en `src/lib/db/financial-report-versions.ts` | `audit-versions.integration.test.ts` (mismo script `test:report-integrity`); el render vive en las hojas `Auditoria`/`Meta-auditoria` de `excel-export.ts` y en `pdf-elite-react/pages/{AuditFindingsPage,QualityMetaAuditPage}.tsx`; contrato y límites en `docs/reviews/audit-provenance-2026-09-05.md` |
| Aritmética y contrato NIIF | `src/lib/preprocessing/trial-balance.ts`, `src/lib/agents/financial/contracts/niif-report.ts`, `src/lib/agents/financial/contracts/money.ts`, `src/lib/agents/financial/validators/niif-json-validator.ts` | `financial-integrity-regression.test.ts`, `niif-json-validator.test.ts`, `precision-capacity.test.ts` (localizar con `rg --files src`) |
| Entrada ERP, periodo, moneda y caché | `src/lib/erp/trial-balance-serialization.ts`, `src/lib/erp/pipeline.ts`, `src/lib/erp/service.ts` | `src/lib/erp/__tests__/trial-balance-integrity.test.ts` |
| KPI y presentación de datos ausentes | `src/lib/kpis/live.ts`, `src/components/workspace/AreaCard.tsx`, `src/components/workspace/ExecutiveDashboard.tsx` | `src/lib/kpis/__tests__/live-integrity.test.ts` |
| TTD y bases fiscales | `src/lib/agents/financial/escudo-survival/fiscal-agent/tools/ccv-calculator.ts`, `schemas.ts` y `types.ts` del mismo módulo; agentes CCV y Supervivencia | `src/lib/agents/financial/escudo-survival/fiscal-agent/__tests__/ccv-tasa-minima.test.ts`; luego consumidores y narrativas |
| UVT y vigencia | `src/lib/accounting/tax-engine/constants.ts` | `src/lib/accounting/tax-engine/__tests__/constants.test.ts` |
| Excel y PDF | `src/lib/export/excel-export.ts`, `src/lib/export/pdf-elite-react/`, ruta export | `src/lib/export/__tests__/four-statements.test.ts`, `src/lib/export/pdf-elite-react/__tests__/route-integration.test.ts` |
| Auth y aislamiento | `src/proxy.ts`, `src/lib/auth/enabled.ts`, `src/lib/auth/require-session.ts`; seguir resolución de tenant y persistencia desde cada handler | `src/__tests__/proxy-auth-aliases.test.ts`, `src/lib/auth/__tests__/require-session.test.ts` y casos por endpoint |

## Comandos

Usar scripts del `package.json` del checkout actual. Para una corrección concreta, empezar por `npx vitest run <ruta-de-prueba>`.

- Suite: `npm test`.
- Persistencia/aislamiento con PostgreSQL embebido, sin secretos: `npm run test:report-integrity`.
- Tipos: `npx tsc --noEmit`.
- Lint: `npm run lint`.
- Contratos LLM: `npm run lint:strict-mode`.
- Compilación: `npm run build`.

La compilación previa usó configuración ficticia de build, sin servicios reales. No copies esos valores a producción. Pruebas de integración, carga y proveedores necesitan un entorno apropiado y autorización para sus efectos.

## Documentos por necesidad

- Continuidad: `docs/agents/HANDOFF.md`.
- Evidencia de revisión financiera: `docs/reviews/main-financial-integrity-2026-09-05.md`.
- Arquitectura amplia, solamente si la tarea la requiere: `docs/ARCHITECTURE.md`.
- Contrato financiero: `docs/spec/financial-pipeline-v2.1.md`.
- Esquemas LLM: `docs/spec/zod-strict-mode-2026.md`.
- Postura de seguridad pública: `docs/AUDITORIA_OWASP_2026-08.md` (histórico; comprobar vigencia).
