# PRD — 1+1 UtopIA

> **Generado**: 2026-06-05 | **Método**: PRD inverso — deducido 100% del código, no diseñado de cero
> **Rama analizada**: `audit/full-diagnosis-2026-06-05`
> **Evidencia base**: package.json, README, 952 archivos TS/TSX, 87 tests, 20+ commits, AUDIT_REPORT.md
> **Confianza**: 🟢 Confirmado (evidencia directa) · 🟡 Inferido (varias señales) · 🔴 Ausente / Ambiguo

---

## 1. Resumen Ejecutivo

- **Qué es:** "1+1" — Directorio Ejecutivo Digital impulsado por IA para empresas colombianas; estrategia contable, tributaria y financiera en un solo centro de mando. 🟢 `package.json:description`
- **Para quién:** Contadores, revisores fiscales y directores financieros de PyMEs y medianas empresas colombianas (régimen Decreto 2706/2012 + 2420/2015 + NIIF Colombia). 🟡 Inferido de PUC chart, UVT 2026, normativa DIAN en prompts y tests de Grupo 2tres SAS.
- **Estado actual:** Producto en producción (Vercel) con funcionalidad parcialmente habilitada; 6 módulos críticos están tras feature flags OFF en producción; auth de usuarios añadida recientemente pero no fusionada a main. 🟢 `AUDIT_REPORT.md`, `.env.local` flags.
- **Hacia dónde apunta:** Plataforma SaaS multi-tenant completa con autenticación, suite contable full (NIIF + tributaria + banco), 4 "pilares" de asesoría especializada con IA, integración bidireccional con 12 ERPs colombianos e internacionales, y flujos de cierre mensual automatizados.
- **Arquitectura núcleo:** Next.js 16 (App Router) + React 19, AI SDK v6 + GPT-5.4 family, Drizzle ORM + Neon Postgres + pgvector, 11 pipelines multi-agente, 96 rutas API, 87 tests (Vitest).
- **Riesgo principal:** Actualmente sin autenticación de usuario en main — datos separados solo por cookie anónima `utopia_workspace_id`. 🔴 AUDIT_REPORT Fase 0.

---

## 2. Visión y Problema

### Problema que resuelve 🟡

Las PyMEs y medianas empresas colombianas acceden a asesoría contable, tributaria y financiera a través de contadores externos o departamentos financieros pequeños que:
- No tienen acceso en tiempo real a proyecciones fiscales y alertas de riesgo DIAN.
- Hacen el cierre contable manualmente, tardando semanas.
- No cuentan con herramientas para auditoría NIIF de calidad sin contratar firmas externas.
- Operan con ERPs aislados (Siigo, SAP, Oracle) sin síntesis estratégica.

*Señales*: vocabulario de dominio muy específico a Colombia (UVT, DIAN, Art. 365-647-648 E.T., Decreto 2706, Grupo 2 NIIF, Revisoria Fiscal), prompts de sistema con contexto normativo colombiano 2026, tests con datos de "Grupo 2tres SAS".

### Propuesta de valor inferida 🟡

Un **"director financiero virtual"** — siempre activo, con acceso completo al estado financiero del negocio, capaz de generar en minutos: un informe NIIF completo, una defensa fiscal contra la DIAN, una valoración empresarial, o un plan tributario. Transforma datos contables crudos en inteligencia accionable.

---

## 3. Usuarios y Actores

| Actor | Evidencia | Confianza |
|---|---|---|
| **Contador / CFO** (usuario principal) | Rutas `/workspace/*`, modelos de rol implícito en prompts | 🟡 |
| **Revisor Fiscal** | Módulo `/workspace/verdad/revisoria-fiscal`, `fiscal-opinion` agents, Junta en Colombia requiere Revisor Fiscal | 🟡 |
| **Director Ejecutivo** | "Directorio Ejecutivo Digital" en `package.json:description`; pilares estratégicos (Valor, Futuro) | 🟡 |
| **Administrador del sistema** | `/api/admin/telemetry`, `/api/admin/activity`, `UTOPIA_ADMIN_TOKEN` env var | 🟢 `src/app/api/admin/` |
| **Sistema DIAN** (externo) | ERP webhooks, tool `calculate_sanction`, `draft_dian_response` | 🟢 `src/app/api/tools/` |
| **ERP proveedores** (externos) | 12 adaptadores en `src/lib/erp/providers/` | 🟢 |
| **Bot/crawler** (actor no deseado) | `botid` dep + `@vercel/firewall` + `BotID` mencionado en PLATFORM_MIGRATION.md | 🟢 |

### Sistema de autenticación actual (dual estado) 🟢

- **Main branch:** Anónimo — cookie `utopia_workspace_id` (UUID) como tenant único. Sin usuarios. `src/lib/db/workspace.ts`
- **Audit branch (PR #2):** BetterAuth con email+password. Tablas `auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications`. OAuth Google/GitHub preparado pero comentado. `src/lib/auth/config.ts`

---

## 4. Objetivos y No-Objetivos

### Objetivos inferidos 🟡

1. Generar informes financieros completos (NIIF, tributario, legal, fiscal) a partir de un balance de prueba cargado, sin intervención humana.
2. Proveer defensa fiscal proactiva vs DIAN (Escudo): alertas, dictámenes, simulación de sanciones.
3. Ofrecer suite contable completa (plan de cuentas PUC, diario, cierre mensual, banco) integrable con ERPs.
4. Valorar empresas y proyectar escenarios económicos con modelos DCF + Monte Carlo.
5. Ser plataforma SaaS multi-tenant con auth propia (objetivo en progreso).

### No-objetivos deducidos 🟡

- **No es ERP:** El módulo Pyme/Contabilidad registra asientos pero no facturación, nómina, ni inventario. `schema.ts` no tiene tablas de facturación o nómina.
- **No es declaración tributaria directa:** Genera análisis y borradores, no presenta ante la DIAN directamente (no hay integración MUI/MUISCA). 🔴 Sin evidencia de API DIAN directa.
- **No cubre nómina ni RH:** Ninguna tabla ni endpoint relacionado con nómina.
- **No es multi-moneda nativo:** `pyme_books.currency` DEFAULT 'COP', constante `'COP'` hardcoded en 4 lugares. `src/lib/accounting/double-entry/service.ts:312`

---

## 5. Alcance Funcional

| Feature | Estado | Evidencia |
|---|---|---|
| **Informe financiero NIIF** (3 agentes: NIIF→Estrategia→Gobernanza) | ✅ Implementado y funcional | `/api/financial-report/niif,strategy,governance` + 12 tests |
| **Informe HTML 12-diapositivas** (Editor Jefe v10.1) | ✅ Implementado | `/api/financial-report/html`, spec `financial-report-v8.1.md` |
| **Auditoría 4 pilares** (NIIF, Tax, Legal, Fiscal) | ✅ Implementado | `/api/financial-audit`, 8 tests de auditoría |
| **Meta-auditoría calidad** (12 dimensiones + sello) | ✅ Implementado | `/api/financial-quality`, `quality/__tests__` |
| **Escudo fiscal** (6 módulos: defensa, devoluciones, conciliación, sanciones, precios transferencia, supervivencia) | ✅ Implementado | `/api/escudo/*`, 12 tests escudo |
| **Valoración empresarial** (DCF + Monte Carlo) | ✅ Implementado | `/api/business-valuation`, `monte-carlo.test.ts` |
| **Estudio de factibilidad** | ✅ Implementado | `/api/feasibility-study` |
| **Plan tributario** | ✅ Implementado | `/api/tax-planning` |
| **Conciliación tributaria** | ✅ Implementado | `/api/tax-reconciliation` |
| **Precios de transferencia** | ✅ Implementado | `/api/transfer-pricing` |
| **Opinión fiscal** (Revisoria Fiscal) | ✅ Implementado | `/api/fiscal-audit-opinion`, `signatories.test.ts` |
| **Chat con IA** (T1/T2/T3 routing) | ✅ Implementado | `/api/chat`, `classifier.test.ts` |
| **Doctor de Datos** (reparación de asientos) | ✅ Implementado | `/api/repair-chat`, `repair_sessions` table |
| **Plan de cuentas PUC** (seed + CRUD) | ✅ Implementado | `/api/accounting/accounts/seed` + tests |
| **Diario contable** (double-entry, post, reverse, void) | ✅ Implementado | `/api/accounting/journal/*`, `validate.test.ts` |
| **Períodos contables** (open/close/lock/reopen) | ✅ Implementado | `/api/accounting/periods/*` |
| **Balance de apertura** | ✅ Implementado | `/api/accounting/opening-balance` |
| **Integración ERP** (12 adaptadores: Siigo, SAP, Oracle, Alegra, ContaPyme, Dynamics, Helisa, Odoo, QuickBooks, WO, Xero) | 🚧 Parcial — 3 con tests (Siigo, SAP, Oracle), 9 potencialmente stubs | `src/lib/erp/providers/*` + solo 3 `__tests__` |
| **Motor tributario** (Smart-Tax Engine) | 🚧 Feature flag OFF en prod (`UTOPIA_ENABLE_TAX_ENGINE`) | `schema-tax.ts`, `/api/accounting/tax-engine` |
| **Conciliación bancaria** (importación CSV + reconcile) | 🚧 Feature flag OFF en prod (`UTOPIA_ENABLE_BANK_RECON`) | `banking/__tests__/csv-parser.test.ts`, `fingerprint.test.ts` |
| **Ajustes NIIF automáticos** (depreciación, amortización, provisiones) | 🚧 Feature flag OFF en prod (`UTOPIA_ENABLE_AUTO_ADJUSTMENTS`) | `/api/accounting/adjustments/*` + tests |
| **Cierre mensual automatizado** | 🚧 Feature flag OFF en prod (`UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW`) | `canonical.test.ts`, `/api/cron/monthly-close` |
| **Notificaciones** (alertas, umbrales KPI) | 🚧 Feature flag OFF en prod (`UTOPIA_ENABLE_NOTIFICATIONS`) | `schema-notifications.ts`, `insight-templates.test.ts` |
| **OCR Promote** (Pyme → contabilidad completa) | 🚧 Feature flag OFF en prod (`UTOPIA_ENABLE_OCR_PROMOTE`) | `/api/pyme/promote` |
| **Detección de anomalías** (cron) | 🚧 Feature flag OFF en prod (`UTOPIA_ENABLE_ANOMALY_DETECTION`) | `/api/cron/anomaly-detection` |
| **RAG sobre docs tributarios** | 🚧 Funcional pero degradado en Vercel (MemoryVectorStore fallback) | `vectorstore.ts:env.VERCEL`, `rag_chunks` pgvector table |
| **Módulo Pyme** (OCR + libros simplificados) | ✅ Implementado | `/api/pyme/*`, `pyme_books` + `pyme_entries` tables |
| **Export Excel/PDF** (balance + informe) | ✅ Implementado | `/api/financial-report/export`, `pdf-elite-react/__tests__` |
| **Voz (OpenAI Realtime)** | ✅ Implementado | `/api/realtime`, `OPENAI_MODEL_REALTIME` |
| **Calendario DIAN verificado** | ✅ Implementado | `verified_calendars` table, `/api/calendar/verified` |
| **Macroeconomía** (IPC, TRM, BanRep) | ✅ Implementado | `macro_factors` table, `/api/macro/current`, `service.test.ts` |
| **Sentinel / Alertas** | ✅ Implementado | `schema-sentinel.ts`, `sentinel/__tests__/triggers.test.ts` |
| **Autenticación de usuarios** | 🚧 Parcial — implementada en PR #2, no fusionada a main | `src/lib/auth/config.ts`, `schema-auth.ts` |
| **Multi-tenant con auth** | ❌ Planeada — workspaces vinculados a `user_id`, migración pendiente | `schema.ts:workspaces.user_id` (columna nullable) |
| **Social auth (Google/GitHub)** | ❌ Planeada — código comentado | `src/lib/auth/config.ts` comentarios OAuth |
| **Verificación de email** | ❌ Planeada — `requireEmailVerification: false` pending Resend | `src/lib/auth/config.ts:requireEmailVerification` |

---

## 6. Requisitos Funcionales

| ID | Requisito | Estado | Confianza | Evidencia |
|---|---|---|---|---|
| RF-01 | El sistema genera un informe financiero completo (NIIF + Estrategia + Gobernanza) a partir de un balance de prueba en formato JSON/XLSX | ✅ | 🟢 | `src/app/api/financial-report/niif/route.ts`, `src/lib/agents/financial/__tests__/pipeline-e2e.test.ts` |
| RF-02 | El informe financiero se renderiza como presentación HTML de 12 diapositivas | ✅ | 🟢 | `src/app/api/financial-report/html/route.ts`, `docs/spec/financial-report-v8.1.md` |
| RF-03 | El sistema realiza auditoría en 4 dimensiones (NIIF, Tax, Legal, Fiscal) en paralelo | ✅ | 🟢 | `src/app/api/financial-audit/route.ts` (`Promise.allSettled`) |
| RF-04 | El chat responde con T1 (directo) / T2 (especialista) / T3 (paralelo+síntesis) según complejidad | ✅ | 🟢 | `src/lib/agents/orchestrator.ts`, `src/lib/agents/__tests__/classifier.test.ts` |
| RF-05 | El módulo Escudo genera dictámenes de defensa fiscal con citas normativas verificadas | ✅ | 🟢 | `src/lib/agents/financial/escudo-survival/normative/__tests__/citation.validator.test.ts` |
| RF-06 | El módulo Escudo calcula Score DIAN (6 factores, cobertura retenciones Art. 365) | ✅ | 🟢 | Commit `912e446`, `risk-score.validator.test.ts` |
| RF-07 | El motor contable valida balance cuadrado (Activo = Pasivo + Patrimonio) en cada asiento | ✅ | 🟢 | `src/lib/accounting/double-entry/__tests__/validate.test.ts`, DB CHECK en `schema.ts` |
| RF-08 | Los períodos contables tienen ciclo de vida open → closed → locked con permisos diferenciados | ✅ | 🟢 | `src/lib/accounting/periods/__tests__/api-contract.test.ts` |
| RF-09 | El sistema integra credentials ERP cifradas con AES-256-GCM | ✅ | 🟢 | `src/lib/security/__tests__/vault.test.ts`, `docs/SECURITY_ENCRYPTION.md` |
| RF-10 | El módulo Pyme captura recibos/facturas por OCR y extrae asientos | 🚧 | 🟢 | `pyme_uploads` table + `UTOPIA_ENABLE_OCR_PROMOTE=false` en prod |
| RF-11 | El cierre mensual se automatiza con un workflow multi-paso (ajustes → cierre → notificación) | 🚧 | 🟢 | `src/lib/workflows/monthly-close/__tests__/canonical.test.ts`, feature flag OFF |
| RF-12 | El sistema concilia extractos bancarios en CSV contra el diario automáticamente | 🚧 | 🟢 | `src/lib/accounting/banking/__tests__/`, feature flag OFF |
| RF-13 | El RAG responde preguntas sobre normativa tributaria colombiana con fuentes citadas | 🚧 | 🟢 | `src/lib/rag/`, `rag_chunks` pgvector — degradado en Vercel |
| RF-14 | Los usuarios se autentican con email+password; sesión 30 días con renovación automática | 🚧 | 🟢 | `src/lib/auth/config.ts` — en PR #2, no en main |
| RF-15 | Los workspaces se vinculan a usuarios autenticados (multi-tenant con auth) | ❌ | 🟢 | `schema.ts:workspaces.user_id` nullable — migración pendiente |
| RF-16 | El sistema envía alertas de KPI por email cuando se supera un umbral configurado | 🚧 | 🟢 | `alert_thresholds` table, `UTOPIA_ENABLE_NOTIFICATIONS=false` en prod |
| RF-17 | El sistema detecta anomalías contables automáticamente vía cron diario | 🚧 | 🟢 | `/api/cron/anomaly-detection`, `UTOPIA_ENABLE_ANOMALY_DETECTION=false` |
| RF-18 | Exportar el informe financiero como archivo Excel (.xlsx) | ✅ | 🟢 | `/api/financial-report/export`, `exceljs` dep |
| RF-19 | Exportar el informe financiero como PDF con estilo élite | ✅ | 🟢 | `src/lib/export/pdf-elite-react/__tests__/compose.test.ts` |
| RF-20 | El sistema valida NITs colombianos con dígito de verificación | ✅ | 🟢 | `src/lib/validation/__tests__/nit-validator.test.ts` |
| RF-21 | El análisis forense detecta irregularidades (Ley de Benford, brechas de numeración, montos repetidos, posteos en fin de semana) | ✅ | 🟢 | `src/lib/agents/financial/audit/forensic/__tests__/` (5 tests) |
| RF-22 | El chat acepta documentos adjuntos (PDF, DOCX, XLSX, CSV, imágenes hasta 100MB) | ✅ | 🟢 | `/api/upload`, Vercel Blob — Commit `95d10e8` |
| RF-23 | El módulo Valor valora empresas con DCF + Monte Carlo + due diligence | ✅ | 🟢 | `src/lib/pillars/__tests__/monte-carlo.test.ts`, `/workspace/valor/` |
| RF-24 | El asistente de voz usa OpenAI Realtime API | ✅ | 🟢 | `/api/realtime`, `OPENAI_MODEL_REALTIME=gpt-4o-realtime-preview-2024-12-17` |
| RF-25 | El sistema sincroniza factores macroeconómicos (IPC, TRM, BanRep) automáticamente | ✅ | 🟢 | `macro_factors` table, `/api/cron/macro-refresh`, `src/lib/macro/__tests__/service.test.ts` |

---

## 7. Requisitos No Funcionales

| ID | RNF | Estado | Confianza | Evidencia |
|---|---|---|---|---|
| RNF-01 | **Tiempo de respuesta pipeline financiero**: endpoints separados con `maxDuration: 800s` | ✅ | 🟢 | `docs/wave-notes/wave-3-split-endpoints.md`, cada route.ts |
| RNF-02 | **Seguridad — AES-256-GCM** para credenciales ERP | ✅ | 🟢 | `src/lib/security/vault.ts`, formato `v1:gcm:<iv>:<tag>:<ct>` |
| RNF-03 | **Seguridad — PII filter** en payloads de chat | ✅ | 🟢 | `src/lib/security/pii-filter.ts` |
| RNF-04 | **Seguridad — Rate limiting** en proxy (Upstash Redis o in-memory fallback) | ✅ | 🟢 | `src/lib/security/rate-limit.ts`, `src/proxy.ts` |
| RNF-05 | **Seguridad — CSP headers** en respuestas | ✅ | 🟢 | `src/proxy.ts` headers CSP |
| RNF-06 | **Seguridad — Auth gate** en proxy para rutas protegidas | 🚧 | 🟢 | `src/proxy.ts` (PR #2), no en main |
| RNF-07 | **Normalización financiera — MoneyCop**: montos como strings en centavos, no floats | ✅ | 🟢 | `src/lib/agents/financial/contracts/money.ts`, `money.test.ts` |
| RNF-08 | **Internacionalización** (español primario + inglés) | ✅ | 🟢 | `src/lib/i18n/dictionaries.ts` |
| RNF-09 | **Observabilidad** — telemetría por llamada LLM (tokens, costo, fallback, elapsed) | ✅ | 🟢 | `agent_telemetry` table, `docs/TELEMETRY.md` |
| RNF-10 | **Zod strict mode** — schemas que viajan al LLM usan `.nullable()` never `.optional()` | ✅ | 🟢 | `docs/spec/zod-strict-mode-2026.md`, `npm run lint:strict-mode` |
| RNF-11 | **Modelo correcto** — `gpt-5.4-mini` como CHAT, `gpt-5.5` para financial pipeline | 🔴 | 🟡 | README menciona `gpt-5.4-mini`; AUDIT_REPORT dice este modelo no existe en OpenAI — probablemente es `gpt-4.5-mini` o alias custom |
| RNF-12 | **Rendering smooth scroll** — Lenis (`data-lenis-prevent` en workspace shell) | ✅ | 🟢 | `CLAUDE.md` explicación, `src/app/workspace/layout.tsx` |
| RNF-13 | **Bot detection** — BotID + @vercel/firewall | ✅ | 🟢 | `botid` dep, `docs/PLATFORM_MIGRATION.md` |
| RNF-14 | **Dark mode WCAG AA** — paleta n-0..n-1000 invertida, `text-n-100..n-400` prohibido como ink | ✅ | 🟢 | `CLAUDE.md` visual token polarity section, 30+ components corregidos en audit branch |
| RNF-15 | **Escalabilidad DB** — pgvector 1536-dim + BM25 tsvector('spanish') para RAG híbrido | ✅ | 🟢 | `rag_chunks` table, `vectorstore.ts` |
| RNF-16 | **Protección cron** — endpoints `/api/cron/*` requieren `Authorization: Bearer <CRON_SECRET>` | ✅ | 🟢 | `.env.local:CRON_SECRET`, `CLAUDE.md` |
| RNF-17 | **Sin API key en código** — `@ai-sdk/openai` lee `OPENAI_API_KEY` automáticamente | ✅ | 🟢 | `CLAUDE.md` LLM provider hard rules |

---

## 8. Modelo de Datos

### Entidades principales y relaciones (Drizzle ORM + Neon Postgres)

```
workspaces (tenant root)
├── erp_credentials (1:N, AES-256-GCM cifrado)
├── reports (1:N, JSONB + control totals)
├── alert_thresholds (1:N, KPI rules)
├── repair_sessions (1:N) → repair_adjustments (1:N)
├── pyme_books (1:N)
│   ├── pyme_uploads (1:N) → OCR images
│   ├── pyme_entries (1:N) → extracted ledger rows
│   └── pyme_categories (1:N)
├── chart_of_accounts (1:N, PUC 5 niveles, ACTIVO/PASIVO/PATRIMONIO/INGRESO/GASTO/COSTO/ORDEN)
├── accounting_periods (1:N, open/closed/locked)
├── third_parties (1:N, NIT/CC register)
├── cost_centers (1:N)
├── journal_entries (1:N) → journal_lines (1:N)
├── erp_account_mapping (1:N, ERP→PUC per provider)
└── [FK placeholder] auth_users (via user_id nullable — pendiente migración)

auth_users (BetterAuth — PR #2)
├── auth_sessions (1:N)
├── auth_accounts (1:N, OAuth providers)
└── auth_verifications (1:N)

rag_chunks (global + per-workspace, pgvector 1536-dim)
macro_factors (global, IPC/TRM/BanRep cache, daily)
verified_calendars (global, DIAN calendar, versioned year+slug)
agent_telemetry (global, per-LLM-call metrics)
monthly_close_runs (workspace-scoped, workflow state)

schema-tax.ts → Smart-Tax Engine tables (feature flag OFF)
schema-banking.ts → Banking reconciliation tables
schema-adjustments.ts → NIIF auto-adjustments + monthly_close_runs
schema-notifications.ts → subscriptions + notification log
schema-sentinel.ts → sentinel alert state
schema-activity.ts → admin activity log
```

### Invariante crítica 🟢

- `journal_lines`: `CHECK(debit = 0 OR credit = 0)` — una línea no puede ser simultáneamente débito y crédito
- `journal_entries`: `CHECK(total_debit = total_credit)` — partida doble forzada a nivel DB
- `MoneyCop`: montos viajan como strings en centavos — nunca como `number` (overflow >2^53)

---

## 9. Flujos de Usuario / Casos de Uso

### Flujo principal — Informe Financiero Ejecutivo 🟢

```
1. Usuario sube balance de prueba (XLSX/CSV/PDF) → /api/upload → Vercel Blob
2. Frontend llama /api/financial-report/niif (POST) con preprocessed balance JSON
   → NIIF Analyst (3 passes chunked, gpt-5.5, maxDuration 800s)
3. Resultado NIIF → /api/financial-report/strategy
   → Strategy Director (gpt-5.5, maxDuration 800s)
4. Resultado Strategy → /api/financial-report/governance
   → Governance Specialist (gpt-5.5, maxDuration 800s)
5. Pipeline completo → /api/financial-report/html
   → HTML Editor Jefe (12 diapositivas, 48k tokens, gpt-5.5)
6. Workspace renderiza diapositivas; usuario exporta PDF/XLSX
```

### Flujo Escudo — Defensa Fiscal DIAN 🟢

```
1. Usuario activa /workspace/escudo/agente-fiscal
2. Sistema construye FiscalAnchor (datos NIIF + Score DIAN 6 factores)
3. Usuario reporta/consulta riesgo → Agente Fiscal corre 6 módulos en paralelo
   (conciliación, defensa DIAN, devoluciones, precios transferencia, sanciones, supervivencia)
4. Dictamen con citas normativas verificadas (Art. 365, 647, 648 E.T.) + plan de acción
```

### Flujo Pyme — Contador Simplificado 🚧 (parcialmente detrás de flags)

```
1. Usuario crea libro contable → /api/pyme/books
2. Sube foto de recibo/factura → /api/pyme/uploads → OCR extrae asiento
3. Usuario confirma/edita asientos → /api/pyme/entries
4. (Feature flag PROMOTE) Promueve a contabilidad completa → /api/pyme/promote
5. Reporte mensual → /api/pyme/reports/monthly → Excel export
```

### Flujo Chat con IA (T1/T2/T3) 🟢

```
1. Usuario envía pregunta → /api/chat
2. Classifier (gpt-5.4-nano) clasifica complejidad → T1/T2/T3
   T1: respuesta directa (<5 tools)
   T2: delega a especialista (tax, legal, audit, etc.)
   T3: despacha hasta 3 especialistas en paralelo → synthesizer compone respuesta
3. MAX_TOOL_ROUNDS = 6 por especialista
4. Herramientas: search_docs (RAG), search_web (Tavily), calculate_sanction,
   analyze_document, draft_dian_response, assess_risk, get_tax_calendar
```

---

## 10. Integraciones Externas

| Servicio | Propósito | Estado | Evidencia |
|---|---|---|---|
| **OpenAI** (GPT-5.4 family + Realtime) | Todos los LLM calls, embeddings, voz | ✅ Activo | `@ai-sdk/openai`, `OPENAI_API_KEY` |
| **Neon** (Postgres + pgvector) | Base de datos principal + RAG | ✅ Activo | `@neondatabase/serverless`, `DATABASE_URL` |
| **Vercel Blob** | Upload de documentos hasta 100MB | ✅ Activo | `@vercel/blob`, Commit `95d10e8` |
| **Tavily** | Web search para el chat agent | ✅ Activo | `TAVILY_API_KEY`, `src/lib/search/web-search.ts` |
| **Resend** | Email notifications | 🚧 Integrado, feature flag OFF | `resend` dep, `RESEND_API_KEY` comentado |
| **Upstash Redis** | Rate limiting distribuido | 🚧 Opcional — fallback in-memory | `UPSTASH_REDIS_REST_URL/TOKEN` comentado |
| **Cohere** | RAG reranking (RRF si ausente) | 🚧 Opcional | `@ai-sdk/cohere`, `COHERE_API_KEY` comentado |
| **Siigo Nube** (ERP colombiano) | Importar datos contables | 🚧 Implementado + testado | `src/lib/erp/providers/siigo-nube.ts` + test |
| **SAP S/4HANA** (ERP) | Importar datos contables | 🚧 Implementado + testado | `src/lib/erp/providers/sap-s4hana.ts` + test |
| **Oracle Fusion** (ERP) | Importar datos contables | 🚧 Implementado + testado | `src/lib/erp/providers/oracle-fusion.ts` + test |
| **Alegra, ContaPyme, Dynamics, Helisa, Odoo, QuickBooks, Siigo, World Office, Xero** | ERP integrations | ❓ Posibles stubs — sin tests | `src/lib/erp/providers/*.ts` — sin `__tests__` |
| **@vercel/firewall + BotID** | Bot detection y WAF | ✅ Activo | `botid` dep, `docs/PLATFORM_MIGRATION.md` |
| **@react-three/fiber + drei** | Visualizaciones 3D (posiblemente para homepage o charts) | 🟡 Presente pero uso no confirmado | `@react-three/fiber`, `@react-three/drei` deps |

---

## 11. Arquitectura Técnica

### Stack 🟢

| Capa | Tecnología | Versión |
|---|---|---|
| Frontend framework | Next.js (App Router) | ^16.2.2 |
| UI Library | React | 19.2.3 |
| Language | TypeScript | ^5.9.3 |
| Styling | Tailwind CSS v4 | ^4.2.1 |
| Animation | Motion (Framer) + Lenis | ^12.35.2 / ^1.3.18 |
| AI SDK | @ai-sdk/openai (AI SDK v6) | ^3.0.55 |
| LLM | OpenAI GPT-5.4 family | gpt-5.4-mini / gpt-5.5 |
| ORM | Drizzle ORM | ^0.45.2 |
| Database | Neon Postgres + pgvector | — |
| Auth | BetterAuth | ^1.6.14 (PR #2) |
| RAG/Embeddings | LangChain + pgvector | hybrid BM25+vector |
| Testing | Vitest | ^3.2.4 |
| PDF Export | @react-pdf/renderer + jsPDF | ^4.5.1 / ^4.2.1 |
| Deployment | Vercel (Fluid Compute, Blob, Firewall) | — |

### Patrones detectados 🟢

- **Multi-agent pipeline**: NIIF→Strategy→Governance secuencial; Audit 4 agentes paralelos
- **T1/T2/T3 routing**: chat classifier dispatch por complejidad
- **Feature flags**: 7 flags vía `process.env.UTOPIA_ENABLE_*`
- **MoneyCop**: montos como strings en centavos (no floats)
- **callFinancialAgent()**: runtime único con Zod validation + telemetry + retry
- **AES-256-GCM vault**: credenciales ERP cifradas server-side
- **Wave development**: iteraciones (waves 1-7+) documentadas en `docs/wave-notes/`
- **Proxy-as-middleware**: `src/proxy.ts` (Next.js 16) en lugar de `middleware.ts`

### Puntos únicos de falla (God Nodes) 🟢

| Node | Dependientes | Riesgo |
|---|---|---|
| `getDb()` | 161 | Toda la app — sin degradación parcial |
| `getOrCreateWorkspace()` | 67 | Tenant leakage sin auth (main branch) |
| `formatCopFromCents()` | 45 | Formato COP en 45 componentes |
| `callFinancialAgent()` | 35 | Runtime único de todos los agentes financieros |

---

## 12. Métricas de Éxito

| Métrica | Evidencia | Confianza |
|---|---|---|
| Costo LLM por ejecución (tokens input/output/reasoning) | `agent_telemetry` table + `GET /api/admin/telemetry` | 🟢 |
| Tasa de fallback LLM (>3% → P1) | `callFinancialAgent` fallback flag en telemetría | 🟢 |
| `finishReason != stop` (>1% → P0) | Telemetría, `docs/TELEMETRY.md` | 🟢 |
| Costo diario OpenAI (>$50 → P1) | Telemetría en micros-USD | 🟢 |
| Tiempo de respuesta del pipeline financiero | `elapsed` en telemetría, `maxDuration: 800s` | 🟢 |
| Usuarios activos / workspaces creados | `workspaces` table count | 🟡 (no hay analytics de negocio aún) |
| NPS / satisfacción | 🔴 Sin evidencia de instrumentación de NPS o feedback in-app |
| Tasa de conversión chat → informe | 🔴 Sin tracking de funnel |

---

## 13. Supuestos y Preguntas Abiertas

### Supuestos implícitos en el código

1. **Un workspace = una empresa** — `utopia_workspace_id` es por dispositivo/sesión, no por NIT. Si el mismo contador maneja 3 empresas, usa 3 navegadores o 3 cookies. 🟡
2. **Balances vienen pre-procesados** — el pipeline NIIF recibe `preprocessed` JSON; no hay evidencia de un importador de balances nativo (salvo el módulo Pyme con OCR). 🟡
3. **Colombia 2026 solamente** — UVT 2026 = $52.374 COP hardcoded; PUC según Decreto 2706/2420. No hay indicios de soporte multi-país. 🟢
4. **Moneda única: COP** — `currency DEFAULT 'COP'` en `pyme_books`, 'COP' hardcoded en 4 lugares del double-entry service. 🟢

### Preguntas abiertas críticas (ordenadas por impacto)

1. **¿Cómo se onboarda una empresa nueva?** No hay flujo claro de incorporación: ¿el usuario sube su balance manualmente cada vez? ¿Hay integración ERP automática que sincroniza el balance? El `erp/pipeline.ts` sugiere sync automático pero el trigger no es evidente.

2. **¿Cuál es el modelo de pricing/monetización?** No hay tabla de subscripciones, `plan`, `billing` ni `stripe` en ningún lugar del código ni los schemas. ¿Es gratuito? ¿Freemium? ¿Enterprise license?

3. **¿El modelo de LLM `gpt-5.4-mini` es correcto?** El AUDIT_REPORT detecta que este modelo no existe en la API de OpenAI (agosto 2025 cutoff). ¿Es un alias del AI Gateway de Vercel, un nombre interno, o un error en README que el código ignora porque `envModel()` lo pasa directo a `openai()`?

4. **¿Cuándo se activan los feature flags en producción?** Los 7 flags están OFF en Vercel pero las features están implementadas y testeadas. ¿Hay un criterio de activación (rollout por cliente, validación QA pendiente, decisión comercial)?

5. **¿Para cuántos workspaces simultáneos está diseñado?** `getDb()` tiene 161 dependientes y no hay pool sizing visible. El race condition detectado en Fluid Compute (AUDIT_REPORT) puede escalar mal bajo carga.

6. **¿Qué pasa con los 9 ERPs sin tests** (Alegra, ContaPyme, Dynamics, Helisa, Odoo, QuickBooks, WO, Xero)? ¿Son stubs para road-map o tienen implementación funcional no testeada?

7. **¿Hay datos de clientes reales en producción?** La migración de auth (PR #2) añade `workspaces.user_id` como nullable — si hay workspaces anónimos activos en Vercel, la migración debe preservarlos.

---

## 14. Roadmap Inferido

Orden lógico deducido del estado actual del código, la secuencia de commits (waves) y lo que está incompleto:

### Inmediato (bloqueadores de producción-segura)

1. **Fusionar PR #2** — Auth BetterAuth → workspace multi-tenant. Sin esto, cualquier usuario puede ver datos de cualquier workspace si tiene la cookie.
2. **Ejecutar `npm run db:push`** — crear tablas auth en Neon producción.
3. **Activar feature flags secuencialmente**: TAX_ENGINE → OCR_PROMOTE → BANK_RECON → AUTO_ADJUSTMENTS → MONTHLY_CLOSE_WORKFLOW → NOTIFICATIONS (orden sugerido en `.env.local`).
4. **Reparar race condition DB** (`getDb()` mutex en Fluid Compute).

### Corto plazo (completar lo casi-listo)

5. **Verificación de email** — configurar Resend + `requireEmailVerification: true`.
6. **Social auth** — descomentar Google/GitHub OAuth en `src/lib/auth/config.ts`.
7. **Modelo LLM audit** — verificar que `gpt-5.4-mini` es un identificador válido o corregir a `gpt-4o-mini`.
8. **Tests para 9 ERPs** sin cobertura (Alegra, ContaPyme, Dynamics, Helisa, Odoo, QuickBooks, WO, Xero).
9. **RAG en Vercel** — migrar completamente de HNSWLib a pgvector (eliminar fallback a MemoryVectorStore).

### Mediano plazo (features faltantes)

10. **Billing / Subscriptions** — no hay modelo de precios en el código; necesario para SaaS.
11. **Onboarding flow** — importador de balance de prueba con UI guiada; actualmente no hay wizard de inicio.
12. **Multi-workspace por usuario** — un contador puede manejar N empresas; actualmente 1 cookie = 1 empresa.
13. **Multi-moneda** — soporte USD/EUR para empresas con operaciones internacionales.
14. **Módulo de nómina** — ausente completamente; natural extensión del PUC de gastos de personal.
15. **Declaraciones electrónicas DIAN** — actualmente el sistema genera análisis/borradores; la presentación electrónica vía MUISCA sería el siguiente nivel de valor.

---

## Tabla de Trazabilidad

| ID | Requisito | Estado | Confianza | Evidencia (archivo:línea / endpoint / commit) |
|---|---|---|---|---|
| RF-01 | Informe NIIF completo desde balance de prueba | ✅ | 🟢 | `src/app/api/financial-report/niif/route.ts`, `pipeline-e2e.test.ts` |
| RF-02 | HTML 12 diapositivas | ✅ | 🟢 | `src/app/api/financial-report/html/route.ts`, `docs/spec/financial-report-v8.1.md` |
| RF-03 | Auditoría 4 dimensiones paralelas | ✅ | 🟢 | `src/app/api/financial-audit/route.ts` |
| RF-04 | Chat T1/T2/T3 routing | ✅ | 🟢 | `src/lib/agents/orchestrator.ts:115`, `classifier.test.ts` |
| RF-05 | Dictámenes defensa DIAN con citas normativas | ✅ | 🟢 | `citation.validator.test.ts`, `normative.validator.test.ts` |
| RF-06 | Score DIAN 6 factores | ✅ | 🟢 | Commit `912e446`, `risk-score.validator.test.ts` |
| RF-07 | Balance cuadrado validado | ✅ | 🟢 | `double-entry/validate.test.ts`, `schema.ts` DB CHECK |
| RF-08 | Ciclo vida períodos contables | ✅ | 🟢 | `src/lib/accounting/periods/__tests__/api-contract.test.ts` |
| RF-09 | ERP credentials AES-256-GCM | ✅ | 🟢 | `src/lib/security/vault.ts`, `vault.test.ts` |
| RF-10 | Pyme OCR → asientos | 🚧 | 🟢 | `pyme_uploads` table, `UTOPIA_ENABLE_OCR_PROMOTE` flag |
| RF-11 | Cierre mensual automatizado | 🚧 | 🟢 | `canonical.test.ts`, `UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW` flag |
| RF-12 | Conciliación bancaria CSV | 🚧 | 🟢 | `csv-parser.test.ts`, `fingerprint.test.ts`, `UTOPIA_ENABLE_BANK_RECON` flag |
| RF-13 | RAG tributario con fuentes | 🚧 | 🟢 | `src/lib/rag/vectorstore.ts`, fallback MemoryVectorStore en Vercel |
| RF-14 | Auth email+password | 🚧 | 🟢 | `src/lib/auth/config.ts`, PR #2 branch `audit/full-diagnosis-2026-06-05` |
| RF-15 | Workspaces vinculados a usuarios | ❌ | 🟢 | `schema.ts:workspaces.user_id` nullable — migración pendiente |
| RF-16 | Alertas KPI por email | 🚧 | 🟢 | `alert_thresholds` table, `UTOPIA_ENABLE_NOTIFICATIONS` flag |
| RF-17 | Detección anomalías cron | 🚧 | 🟢 | `/api/cron/anomaly-detection`, `UTOPIA_ENABLE_ANOMALY_DETECTION` flag |
| RF-18 | Export Excel | ✅ | 🟢 | `/api/financial-report/export`, `exceljs` dep |
| RF-19 | Export PDF élite | ✅ | 🟢 | `pdf-elite-react/__tests__/compose.test.ts` |
| RF-20 | Validación NIT colombiano | ✅ | 🟢 | `src/lib/validation/__tests__/nit-validator.test.ts` |
| RF-21 | Análisis forense (Benford, gaps, etc.) | ✅ | 🟢 | `forensic/__tests__/` (5 tests) |
| RF-22 | Upload documentos hasta 100MB | ✅ | 🟢 | `/api/upload`, Commit `95d10e8` |
| RF-23 | Valoración DCF + Monte Carlo | ✅ | 🟢 | `monte-carlo.test.ts`, `/workspace/valor/` |
| RF-24 | Asistente de voz (Realtime) | ✅ | 🟢 | `/api/realtime`, `OPENAI_MODEL_REALTIME` |
| RF-25 | Macro factors cron | ✅ | 🟢 | `macro_factors` table, `macro/__tests__/service.test.ts` |
| RNF-01 | Timeout pipeline 800s | ✅ | 🟢 | Cada `route.ts` financiero `export const maxDuration = 800` |
| RNF-07 | MoneyCop (centavos en string) | ✅ | 🟢 | `money.ts`, `money.test.ts` |
| RNF-10 | Zod strict mode enforced | ✅ | 🟢 | `scripts/lint-strict-mode.mjs`, `npm run lint:strict-mode` |

---

*PRD generado automáticamente por análisis inverso de código. Verificar con el equipo los puntos marcados 🔴 antes de tomar decisiones de roadmap.*
