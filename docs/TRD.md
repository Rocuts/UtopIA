# TRD — Documento de Requisitos Técnicos

> **Generado**: 2026-06-05 | **Metodología**: AS-IS de evidencia · TO-BE de decisiones
> **Basado en**: `docs/PRD.md` · `AUDIT_REPORT.md` · análisis de 952 archivos TS/TSX
> **Rama**: `audit/full-diagnosis-2026-06-05`
> **Notación**: 🟢 Confirmado · 🟡 Inferido · **DECISIÓN** · **PENDIENTE DE VALIDAR**

---

## 1. Resumen Técnico

- **Stack núcleo (AS-IS):** Next.js 16.2 (App Router + Turbopack) · React 19 · TypeScript 5.9 · AI SDK v6 · GPT-5.4 family · Drizzle ORM 0.45 · Neon Postgres + pgvector · Tailwind CSS v4. Todos en versiones estables y no-EOL. 🟢
- **Arquitectura actual:** Monolito Next.js con 96 rutas API organizadas por dominio, 11 pipelines LLM multi-agente, un proxy de seguridad (`src/proxy.ts`) y un singleton de pool Postgres. El workspace es anónimo en main (cookie `utopia_workspace_id`).
- **Delta crítico AS-IS → TO-BE:** (1) Fusionar BetterAuth (PR #2) para multi-tenant real. (2) Ejecutar migración `0013_auth_tables.sql` en Neon. (3) Activar los 7 feature flags en Vercel. (4) Agregar capa de billing — la única feature de SaaS completamente ausente en el código.
- **Mayor riesgo técnico:** Sin autenticación de usuario en producción (`main`), cualquier workspace es accesible si se conoce la cookie. El pipeline financiero (`/api/financial-report`) no tiene rate-limiting a nivel de usuario (solo WAF + in-memory por IP), lo que expone costos LLM descontrolados.
- **Deuda técnica priorizada:** Race condition de DB singleton ya tiene `idleTimeoutMillis`; 9 adaptadores ERP sin tests; RAG degradado en Vercel (parcialmente resuelto); `cacheComponents: true` diferido (Ola 4 pendiente).
- **Pendiente de validar antes de implementar:** (1) Modelo de pricing/billing. (2) Si el workspace es 1-empresa/usuario o N-empresas/usuario. (3) Si `gpt-5.4-mini` es un identificador de API válido o un alias interno.

---

## 2. Contexto y Alcance Técnico

### Qué cubre este TRD
Diseño técnico para completar y arreglar UtopIA hasta ser un SaaS multi-tenant productivo. Cubre: arquitectura objetivo, decisiones de stack, contratos de API, modelo de datos final, seguridad, infra y plan de implementación.

### Qué NO cubre
- Diseño de UX/UI (cubierto en PRD §9 Flujos de Usuario)
- Decisiones de negocio no técnicas (pricing, go-to-market, ventas)
- Operación de terceros (Neon DB, Vercel Blob) más allá de cómo se integran

### Supuestos técnicos
1. El stack Next.js + Neon + OpenAI se mantiene — **DECISIÓN** documentada en §14.
2. El modelo de despliegue es Vercel Fluid Compute + GitHub Actions CI.
3. Multi-tenancy = un workspace por empresa (no por usuario). Un usuario puede tener N workspaces (empresas). **PENDIENTE DE VALIDAR** — ver §14 ADR-05.
4. Billing es una feature de Ola 4+ — no bloquea el lanzamiento pero debe diseñarse ahora para que el schema lo soporte.

---

## 3. Arquitectura

### 3.1 AS-IS (estado actual — evidencia)

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser / Cliente                                               │
│  React 19 + Tailwind CSS v4 + Motion + Lenis                    │
└─────────────────┬───────────────────────────────────────────────┘
                  │ HTTPS
┌─────────────────▼───────────────────────────────────────────────┐
│  src/proxy.ts (Next.js 16 proxy — reemplaza middleware.ts)      │
│  · Auth gate (BetterAuth cookie — ACTIVO en PR #2, no en main)  │
│  · Rate limiting (Vercel WAF + in-memory fallback)              │
│  · CSRF origin check (fail-closed en métodos mutantes)          │
│  · Headers: X-Content-Type-Options, X-Request-Id, CSP           │
└─────────────────┬───────────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────────┐
│  src/app/  — Next.js App Router                                  │
│  ├─ app/workspace/**  — Client Components (SSR hidratado)        │
│  ├─ app/api/**        — Route Handlers (96 rutas)                │
│  │   ├─ /api/financial-report/{niif,strategy,governance,html}   │
│  │   ├─ /api/escudo/**  /api/financial-audit  /api/chat         │
│  │   ├─ /api/accounting/**  (double-entry + banking + close)    │
│  │   ├─ /api/pyme/**  /api/erp/**  /api/notifications/**        │
│  │   └─ /api/cron/**  /api/admin/**  /api/auth/[...all]         │
│  └─ app/login  app/signup  app/admin                            │
└──────────┬────────────────────────────┬────────────────────────┘
           │                            │
┌──────────▼──────────┐    ┌────────────▼──────────────────────┐
│  src/lib/agents/    │    │  src/lib/db/                      │
│  financial/         │    │  client.ts → pg.Pool (max:5)      │
│  orchestrator.ts    │    │  + attachDatabasePool()           │
│  classifier.ts      │    │  drizzle-orm/node-postgres        │
│  11 pipelines LLM   │    │  schema.ts (16 archivos split)    │
│  @ai-sdk/openai     │    │  migrations/ (0000→0013)          │
│  GPT-5.4 family     │    │  Neon Postgres + pgvector         │
└──────────┬──────────┘    └────────────┬──────────────────────┘
           │                            │
┌──────────▼──────────────────────────▼──────────────────────────┐
│  Integraciones externas                                          │
│  OpenAI API   Neon DB   Vercel Blob   Tavily   Resend(OFF)      │
│  ERP providers (12 adaptadores: Siigo, SAP, Oracle + 9 más)    │
└─────────────────────────────────────────────────────────────────┘
```

**Patrones detectados:** 🟢
- Monolito Next.js — sin microservicios, sin Docker local
- Lazy singleton DB (`getDb()` — 161 dependientes)
- Feature flags vía `process.env.UTOPIA_ENABLE_*` (7 flags, todos OFF en prod)
- Auth dual-state: anónimo en main / BetterAuth en PR #2
- `callFinancialAgent()` como runtime único para 40+ agentes LLM

### 3.2 TO-BE (diseño objetivo — DECISIONES)

**DECISIÓN** — Mantener monolito Next.js (vs microservicios):
> Justificación: 952 archivos TS/TSX fuertemente acoplados, 161 dependientes de `getDb()`. Extraer a microservicios elevaría la complejidad operacional sin beneficio a la escala actual (~100 tenants). **Alternativa descartada**: serverless functions separadas — aumentaría latencia de pipelines multi-agente. **Trade-off**: se acepta que el monolito crezca hasta ~5k archivos antes de reconsiderar.

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser / Cliente (sin cambio de stack)                        │
└─────────────────┬───────────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────────┐
│  src/proxy.ts (AUTH ACTIVO — BETTER_AUTH_SECRET siempre set)    │
│  + CSRF + Rate limiting + Headers                               │
└─────────────────┬───────────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────────┐
│  Next.js App Router (sin cambio estructural)                    │
│  + cacheComponents: true (Ola 4 — cuando Suspense boundaries    │
│    estén listos en todas las páginas con estado no determinista)│
└──────────┬────────────────────────────┬────────────────────────┘
           │                            │
┌──────────▼──────────┐    ┌────────────▼──────────────────────┐
│  LLM Layer          │    │  DB Layer (cambio mínimo)         │
│  (sin cambio)       │    │  + Tabla subscriptions/billing    │
│  + Upstash Redis    │    │  + Tabla workspace_members (N:M)  │
│    para rate-limit  │    │  + user_id NOT NULL en workspaces │
│    distribuido      │    │  (tras migrar anónimos)           │
└─────────────────────┘    └───────────────────────────────────┘
```

### 3.3 Delta y camino de migración

| Área | AS-IS | TO-BE | Ola |
|---|---|---|---|
| Auth | Cookie anónima en main | BetterAuth activo (PR #2 fusionado) | Ola-auth |
| DB schema | `workspaces.user_id` nullable | `user_id` NOT NULL (post-migración anónimos) | Ola-auth |
| Feature flags | 7 OFF en Vercel | Todos ON (activación secuencial) | Ola 2 |
| Billing | Ausente | Tabla `subscriptions` + Stripe webhook | Ola 4 |
| Rate limiting | In-memory (por IP, local) | Upstash Redis (por user_id, distribuido) | Ola 3 |
| RAG | pgvector (completamente en código) | pgvector + verificación en prod | Inmediato |
| Cache Components | Desactivado | `cacheComponents: true` post Ola 4 | Ola 4 |
| 9 ERPs sin tests | Sin cobertura | Tests de integración básicos | Ola 3 |

---

## 4. Stack Tecnológico

| Componente | Tecnología | Versión | Estado | Justificación |
|---|---|---|---|---|
| Frontend framework | Next.js (App Router) | ^16.2.2 | **Mantener** | Stable, Fluid Compute nativo, sin breaking changes planificadas |
| UI Runtime | React | 19.2.3 | **Mantener** | Pairs with Next.js 16, Concurrent Mode estable |
| Language | TypeScript | ^5.9.3 | **Mantener** | Latest stable, strict mode activo |
| Styling | Tailwind CSS v4 | ^4.2.1 | **Mantener** | Plugin postcss, sin config JS, generación @theme |
| Animation | Motion (Framer) | ^12.35.2 | **Mantener** | Reemplaza Framer Motion v10 |
| Smooth scroll | Lenis | ^1.3.18 | **Mantener** | data-lenis-prevent en workspace shell |
| 3D / Viz | Three.js + @react-three/fiber | ^0.183.2 / ^9.5.0 | **PENDIENTE** — uso no confirmado en UI actual | Dep existente; si solo en homepage, evaluar lazy-load |
| AI SDK | @ai-sdk/openai | ^3.0.55 | **Mantener** | Vercel AI SDK v6, streaming SSE nativo |
| LLM | OpenAI GPT-5.4 family | gpt-5.4-mini / gpt-5.5 | **PENDIENTE DE VALIDAR** | Ver ADR-01 — identificador puede ser inválido |
| ORM | Drizzle ORM | ^0.45.2 | **Mantener** | Type-safe, soporte transacciones PG reales |
| Database | Neon Postgres + pgvector | — | **Mantener** | Serverless Postgres con pgvector 1536-dim para RAG |
| Auth | BetterAuth | ^1.6.14 | **Completar** (PR #2) | Email+pass + OAuth stubs; alternativa descartada: NextAuth (menor tipo-seguridad con drizzle) |
| DB client | pg.Pool + attachDatabasePool | ^8.20.0 | **Mantener** | Soporte db.transaction() real + Fluid Compute cleanup |
| DB migration tool | drizzle-kit | ^0.31.10 | **Mantener** | Integrado con schema.ts |
| RAG embeddings | text-embedding-3-small (1536d) | — | **Mantener** | Costo bajo, calidad suficiente para docs tributarios |
| RAG framework | LangChain + @langchain/openai | ^1.2.30 | **PENDIENTE** — evaluar reemplazar por AI SDK embeddings | LangChain agrega 3 deps pesadas; AI SDK tiene `embed()` nativo |
| Testing | Vitest | ^3.2.4 | **Mantener** | 87 tests existentes, v8 coverage |
| E2E (faltante) | — | — | **PENDIENTE DE VALIDAR** — Playwright vs Cypress | Ver ADR-08 |
| CI | GitHub Actions | ubuntu-latest + Node 24 | **Mantener** | 3 gates: tsc + vitest + build |
| Deploy | Vercel Fluid Compute | — | **Mantener** | maxDuration 800s para pipelines LLM |
| Storage | Vercel Blob | ^2.0.0 | **Mantener** | Upload hasta 100MB |
| Bot detection | BotID + @vercel/firewall | ^1.5.11 | **Mantener** | WAF nativo Vercel |
| Rate limiting (prod) | Upstash Redis | — | **Agregar** | In-memory fallback actual no funciona en multi-instancia Fluid Compute |
| Email | Resend | ^6.12.2 | **Activar** | `RESEND_API_KEY` pendiente; BetterAuth email verification lo requiere |
| Billing | — | Stripe | **Agregar en Ola 4** | Ver ADR-06 |
| Export PDF | @react-pdf/renderer | ^4.5.1 | **Mantener** | 3 tests E2E |
| Export Excel | exceljs | ^4.4.0 | **Mantener** | Export XLSX funcionando |

---

## 5. Diseño de Componentes / Módulos

| Módulo | Ruta | Responsabilidad | Interfaces | Dependencias críticas |
|---|---|---|---|---|
| **Proxy/Middleware** | `src/proxy.ts` | Auth gate, rate-limit, CSRF, headers | `NextRequest → NextResponse` | `@vercel/firewall`, `src/lib/security/rate-limit.ts` |
| **Chat Orchestrator** | `src/lib/agents/orchestrator.ts` | Classify → T1/T2/T3 routing → specialists | `orchestrate(opts) → OrchestrateResult` | `classifier`, `prompt-enhancer`, `synthesizer`, 5 specialists |
| **Financial Pipeline** | `src/lib/agents/financial/` | NIIF→Strategy→Governance→HTML generation | `callFinancialAgent(opts) → { json, meta }` | `runtime.ts`, `models.ts`, Zod schemas |
| **Accounting Engine** | `src/lib/accounting/` | Double-entry, periods, banking, adjustments | Service objects + Drizzle transactions | `getDb()`, journal schema |
| **ERP Layer** | `src/lib/erp/` | Credential vault + 12 provider adapters | `connectErp(provider, creds)`, `syncErp()` | `vault.ts`, `schema.ts:erp_credentials` |
| **Auth Layer** | `src/lib/auth/config.ts` | BetterAuth config + session management | `auth.api.handler`, `auth.handler` | BetterAuth, drizzleAdapter, schema-auth.ts |
| **RAG / Vector** | `src/lib/rag/vectorstore.ts` | Hybrid BM25+pgvector search | `searchDocuments(query, ws)`, `addDocumentsToStore()` | Neon pgvector, `rag_chunks` table |
| **Security Vault** | `src/lib/security/vault.ts` | AES-256-GCM encrypt/decrypt credentials | `serializeCredentials()`, `deserializeCredentials()` | Node.js `crypto` |
| **Telemetry** | `src/lib/db/telemetry.ts` | Persist per-call LLM metrics | `persistAgentTelemetry(meta)` | `agent_telemetry` table |
| **Sentinel** | `src/lib/sentinel/` + `workflows/sentinel/` | Alert generation + rule evaluation | `AlertView`, `triggers.ts` | `schema-sentinel.ts` |
| **Monthly Close** | `src/lib/workflows/monthly-close/` | Multi-step close workflow | `startClose(runId)`, `resumeClose()` | `schema-adjustments.ts:monthly_close_runs`, feature flag |
| **Notifications** | `src/lib/notifications/` | Email dispatch + subscription management | `dispatchNotification(type, data)` | Resend, `schema-notifications.ts` |
| **Workspace** | `src/lib/db/workspace.ts` | getOrCreate workspace + auth claim | `getOrCreateWorkspace(req)`, `claimAnonymousWorkspace()` | `workspaces` table, BetterAuth session |
| **i18n** | `src/lib/i18n/dictionaries.ts` | ES/EN strings | `getDictionary(locale)` | — |
| **Macro** | `src/lib/macro/service.ts` | IPC/TRM/BanRep cache | `getCurrentMacroFactors()` | `macro_factors` table, cron refresh |

---

## 6. Modelo de Datos

### Schema objetivo (AS-IS + delta TO-BE)

#### Tablas existentes (aplicadas) — migraciones 0000–0012 🟢

```sql
-- Tenant root
workspaces(id UUID PK, cookie_id TEXT UNIQUE, user_id UUID FK→user(id) NULLABLE→NOT NULL post-migración, created_at)

-- Auth (migración 0013 — PENDIENTE aplicar en Neon prod)
"user"(id TEXT PK, name TEXT, email TEXT UNIQUE, email_verified BOOL, image TEXT, display_name TEXT, created_at, updated_at)
"session"(id TEXT PK, expires_at TIMESTAMP, token TEXT UNIQUE, ip_address TEXT, user_agent TEXT, user_id TEXT FK→user CASCADE)
"account"(id TEXT PK, account_id TEXT, provider_id TEXT, user_id TEXT FK→user CASCADE, ...)
"verification"(id TEXT PK, identifier TEXT, value TEXT, expires_at TIMESTAMP)

-- ERP
erp_credentials(id, workspace_id FK, provider TEXT, encrypted_credentials TEXT [AES-256-GCM v1:gcm:iv:tag:ct], ...)
erp_account_mapping(id, workspace_id FK, erp_provider, erp_account_code, puc_account_id FK→chart_of_accounts)

-- Financial
reports(id, workspace_id FK, type TEXT, data JSONB, ...)
agent_telemetry(id, workspace_id FK, agent_name, input_tokens, output_tokens, reasoning_tokens, elapsed_ms, cost_micros_usd, fallback BOOL, ...)
alert_thresholds(id, workspace_id FK, kpi TEXT, operator TEXT, threshold NUMERIC, notify_email TEXT)

-- Accounting (full double-entry)
chart_of_accounts(id, workspace_id FK, code TEXT, name TEXT, type [ACTIVO|PASIVO|PATRIMONIO|INGRESO|GASTO|COSTO|ORDEN_*], level 1-5, is_postable BOOL, parent_id SELF-FK, ...)
accounting_periods(id, workspace_id FK, year INT, month INT, status [open|closed|locked], ...)
third_parties(id, workspace_id FK, nit TEXT, name TEXT, type TEXT, ...)
cost_centers(id, workspace_id FK, code TEXT, name TEXT, ...)
journal_entries(id, workspace_id FK, period_id FK, date DATE, description TEXT, status [draft|posted|reversed], source [manual|ai_generated|...], total_debit NUMERIC, total_credit NUMERIC, CHECK(total_debit=total_credit), ...)
journal_lines(id, entry_id FK, account_id FK, debit NUMERIC DEFAULT 0, credit NUMERIC DEFAULT 0, CHECK(debit=0 OR credit=0), CHECK(debit+credit>0), ...)
verified_calendars(id, year INT, slug TEXT, data JSONB, version TEXT, UNIQUE(year,slug))
macro_factors(id, date DATE UNIQUE, ipc NUMERIC, trm NUMERIC, banrep_rate NUMERIC, ...)
repair_sessions(id, workspace_id FK, status [open|closed], ...)
repair_adjustments(id, session_id FK, ...)

-- Pyme
pyme_books(id, workspace_id FK, name TEXT, currency TEXT DEFAULT 'COP', ...)
pyme_entries(id, book_id FK, kind [ingreso|egreso], amount_cents BIGINT, status [draft|confirmed], ...)
pyme_uploads(id, book_id FK, blob_url TEXT, status [pending|processing|done|failed], ...)
pyme_categories(id, book_id FK, name TEXT, ...)

-- RAG
rag_chunks(id, workspace_id UUID NULLABLE, content TEXT, embedding VECTOR(1536), ts_content TSVECTOR GENERATED, metadata JSONB, ...)
INDEX: rag_chunks_embedding_idx USING ivfflat(embedding vector_cosine_ops)
INDEX: rag_chunks_ts_idx USING GIN(ts_content)

-- Supplementary (schema-*.ts splits)
-- Banking, Tax Engine, Adjustments, Notifications, Sentinel, Activity Log
```

#### Migraciones aplicadas vs pendientes

| Migración | Estado | Contenido |
|---|---|---|
| 0000–0004 | ✅ Aplicadas | Base tables: workspaces, reports, pyme, accounting core |
| 0004b | ✅ Aplicada | Accounting triggers (DB-level validation) |
| 0005–0012 | ✅ Aplicadas | Tax, banking, adjustments, notifications, sentinel, activity, ERP uniq |
| **0013** | **❌ PENDIENTE** | Auth tables (user, session, account, verification) + workspaces.user_id |

**DECISIÓN — Estrategia de migración de workspaces anónimos a autenticados:**
```sql
-- Paso 1: Aplicar 0013_auth_tables.sql
-- Paso 2: user_id sigue nullable — workspaces anónimos siguen funcionando
-- Paso 3: Activar BETTER_AUTH_SECRET en Vercel → proxy empieza a proteger
-- Paso 4: claimAnonymousWorkspace() en primer login conecta el workspace al usuario
-- Paso 5 (Ola 4): migrar workspaces.user_id a NOT NULL cuando todos los anónimos
--   activos tengan dueño (verificar via: SELECT count(*) FROM workspaces WHERE user_id IS NULL)
```

#### Tablas TO-BE faltantes (Ola 4)

```sql
-- Billing (PENDIENTE DE VALIDAR — ver ADR-06)
subscriptions(
  id UUID PK DEFAULT gen_random_uuid(),
  workspace_id UUID UNIQUE FK→workspaces(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  plan TEXT NOT NULL,               -- 'free' | 'pro' | 'enterprise'
  status TEXT NOT NULL,             -- 'active' | 'trialing' | 'past_due' | 'canceled'
  current_period_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
)

-- Multi-workspace per user (PENDIENTE DE VALIDAR — ADR-05)
workspace_members(
  workspace_id UUID FK→workspaces(id) ON DELETE CASCADE,
  user_id TEXT FK→user(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'owner',        -- 'owner' | 'member' | 'viewer'
  PRIMARY KEY (workspace_id, user_id)
)
```

---

## 7. Diseño de API / Contratos

### Endpoints críticos (AS-IS con contratos reales)

#### `POST /api/financial-report/niif` 🟢

```typescript
// Request
{
  preprocessed: BalanceData,      // Zod schema: balance cuadrado + NIT
  language?: 'es' | 'en',
  nitContext?: string,
  stream?: boolean                 // Header X-Stream también funciona
}
// Response (streaming NDJSON cuando stream=true)
// event: niif_result → FullNiifReport (Zod validated)
// Códigos: 200 (streaming), 400 (BalanceValidationError), 500 (LLM timeout/error)
// Auth (TO-BE): Bearer session token requerido
// Rate limit: /api/chat-limit (30/min) — PENDIENTE aplicar a /api/financial-report
```

#### `POST /api/chat` 🟢

```typescript
// Request
{
  messages: { role: 'user'|'assistant', content: string }[],
  language?: 'es' | 'en',
  useCase?: string,
  documentContext?: string,        // texto extraído de documento adjunto
  nitContext?: string,
  erpConnections?: ErpConnection[]
}
// Response (streaming SSE)
// event: classifying | enhancing | routing | synthesizing | done
// final: { role: 'assistant', content: string, tier: T1|T2|T3, agentsUsed: string[] }
// Auth: proxy session cookie check (ACTIVE en PR #2)
// Rate limit: 30 req/min (in-memory, TO-BE: Upstash por user_id)
```

#### `GET/POST /api/workspace` 🟢

```typescript
// GET: Returns workspace for current session (cookie or auth)
// POST: Force-creates new workspace
// Response: { id: UUID, userId: string|null, createdAt: string }
// Auth: Ninguna (crea workspace anónimo si no hay sesión BetterAuth)
```

#### `POST /api/accounting/journal` 🟢

```typescript
// Request
{
  periodId: UUID,
  date: string,               // ISO date
  description: string,
  source: 'manual' | 'ai_generated' | ...,
  lines: {
    accountId: UUID,
    debit: string,            // MoneyCop — centavos como string
    credit: string,
    description?: string,
    costCenterId?: UUID,
    thirdPartyId?: UUID
  }[]
}
// Validación DB: CHECK(total_debit=total_credit) — lanza si no cuadra
// Response: JournalEntry (Drizzle row)
// Códigos: 201 Created | 400 ValidationError | 409 PeriodLockedError
```

#### `POST /api/erp/connect` 🟢

```typescript
// Request: { provider: ERPProvider, credentials: RawCredentials }
// Proceso: serializeCredentials(creds) → AES-256-GCM → db.insert(erp_credentials)
// Response: { id: UUID, provider, status: 'connected' }
// Códigos: 201 | 400 InvalidCredentials | 409 AlreadyConnected
```

#### `GET /api/auth/[...all]` — BetterAuth handler 🟢

```typescript
// Maneja: POST /api/auth/sign-in/email
//         POST /api/auth/sign-up/email
//         POST /api/auth/sign-out
//         GET  /api/auth/session
//         POST /api/auth/callback/google (cuando OAuth habilitado)
// Token en cookie: better-auth.session_token (HTTP-only, SameSite=lax)
```

### Endpoints TO-BE faltantes (Ola 4)

```
POST /api/billing/subscribe          → Crear suscripción Stripe
POST /api/billing/webhook            → Stripe webhook (checkout.session.completed, etc.)
GET  /api/billing/subscription       → Estado suscripción del workspace
POST /api/workspace/members/invite   → Invitar usuario a workspace (ADR-05)
GET  /api/workspace/members          → Listar miembros del workspace
```

---

## 8. Integraciones Externas

| Servicio | Contrato | Credenciales | Fallback | Estado |
|---|---|---|---|---|
| **OpenAI** | `@ai-sdk/openai` — `openai(modelId)` — NUNCA `apiKey` en código | `OPENAI_API_KEY` en Vercel env | Error propaga; retry con `effort='low'` en `callFinancialAgent` | ✅ Activo |
| **Neon Postgres** | `pg.Pool` sobre TCP hacia endpoint pooled (`-pooler` en hostname) | `DATABASE_URL` en Vercel env | Sin fallback — DB es crítica | ✅ Activo (DATABASE_URL faltante en local) |
| **Vercel Blob** | `@vercel/blob` — upload directo desde cliente con token efímero | `BLOB_READ_WRITE_TOKEN` en Vercel env | Error devuelto al usuario | ✅ Activo |
| **Tavily** | REST `POST https://api.tavily.com/search` via `src/lib/search/web-search.ts` | `TAVILY_API_KEY` en Vercel env | Herramienta `search_web` falla silenciosamente; T2/T3 siguen con RAG local | ✅ Activo |
| **Resend** | `resend.emails.send()` desde `src/lib/notifications/` | `RESEND_API_KEY` | Graceful disable — `RESEND_API_KEY` ausente → log warning, no envío | 🚧 Feature flag OFF |
| **Upstash Redis** | REST pipeline (no npm package) — sliding-window rate limit | `UPSTASH_REDIS_REST_URL` + `TOKEN` | In-memory fallback automático | 🚧 No configurado |
| **Cohere** | `@ai-sdk/cohere` — reranking RRF de resultados RAG | `COHERE_API_KEY` | RRF recíproco rank fusion si ausente | 🚧 Opcional |
| **Siigo Nube** | API REST OAuth2 — `src/lib/erp/providers/siigo-nube.ts` | Vault AES-256-GCM | Error reportado al usuario en sync | 🚧 Testado, no activado en prod |
| **SAP S/4HANA** | OData API — `src/lib/erp/providers/sap-s4hana.ts` | Vault AES-256-GCM | Ídem | 🚧 Testado |
| **Oracle Fusion** | REST API — `src/lib/erp/providers/oracle-fusion.ts` | Vault AES-256-GCM | Ídem | 🚧 Testado |
| **9 ERPs adicionales** | Alegra, ContaPyme, Dynamics, Helisa, Odoo, QuickBooks, Siigo, WO, Xero | Vault AES-256-GCM | — | ❓ Sin tests — validar si son stubs |
| **Stripe** | TO-BE — Ola 4 — `stripe` npm package, webhooks con signature verification | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | — | ❌ No implementado |

---

## 9. Requisitos No Funcionales (técnicos)

| RNF | Objetivo medible | Cómo se logra | Traza PRD |
|---|---|---|---|
| **Tiempo respuesta pipeline LLM** | p99 < 800s por endpoint | `maxDuration: 800s` en cada route handler; Fluid Compute. Si supera: bajar `maxOutputTokens` del slot | RNF-01 |
| **Disponibilidad** | 99.9% (objetivo SaaS básico) | Vercel Fluid Compute + Neon HA. Sin SPF excepto `getDb()` singleton | RNF-01 |
| **Escalabilidad concurrencia** | 50 usuarios concurrentes sin degradación | Fluid Compute escala instancias; `pg.Pool max:5` × instancias; Neon connection pooler del lado DB | — |
| **Seguridad autenticación** | 0 accesos no autorizados a workspace ajeno | BetterAuth sesión 30 días; cookie HTTP-only; proxy gate activo | RNF-06 |
| **Seguridad datos en tránsito** | TLS 1.3 | Vercel enforced, no configurable | — |
| **Seguridad datos ERP en reposo** | AES-256-GCM para credentials | `vault.ts`, formato `v1:gcm:iv:tag:ct` | RNF-02 |
| **PII en logs** | Sin PII en console.error/warn | `parseMoneyCop` error ya limpiado; `orchestrator.ts` logea solo `agentError.message` | RNF-03 |
| **Validación de entrada** | Zod en todos los contratos LLM | Zod strict mode (`npm run lint:strict-mode`), `.nullable()` only, no `.optional()` | RNF-10 |
| **Rate limiting** | /api/chat: 30 req/min; /api/upload: 10 req/min; /api/financial-report: **5 req/min PENDIENTE** | Vercel WAF primary + Upstash Redis per-user TO-BE | RNF-04 |
| **i18n** | ES primario + EN | `src/lib/i18n/dictionaries.ts` + locale param en todos los agentes | RNF-08 |
| **Accesibilidad** | WCAG AA en workspace | Paleta n-0..n-1000 con inversión dark mode; `text-n-100..400` prohibido como ink | RNF-14 |
| **Costo LLM** | P1 si daily cost > $50 USD | `agent_telemetry.cost_micros_usd` aggregated en `/api/admin/telemetry` | RNF-09 |
| **MoneyCop precision** | 0 errores de redondeo en montos COP | Montos como `bigint` en centavos; `parseMoneyCop` + `formatCopFromCents` | RNF-07 |

---

## 10. Seguridad

### AS-IS (estado actual) 🟢

| Capa | Implementación | Archivo |
|---|---|---|
| Rate limiting | Vercel WAF + in-memory sliding-window | `src/proxy.ts`, `src/lib/security/rate-limit.ts` |
| CSRF | Origin check fail-closed en métodos mutantes | `src/proxy.ts` |
| Auth gate (proxy) | Cookie check BetterAuth — **activo solo en PR #2** | `src/proxy.ts` |
| CSP | `default-src 'self'` + restricciones por directiva | `next.config.ts:headers()` |
| Security headers | X-Content-Type-Options, X-Frame-Options, Referrer-Policy | `next.config.ts:headers()` |
| ERP credentials | AES-256-GCM vault server-side, nunca en cliente | `src/lib/security/vault.ts` |
| PII filter | Regex en payloads de chat | `src/lib/security/pii-filter.ts` |
| Cron protection | `Authorization: Bearer CRON_SECRET` | Todos los `/api/cron/*` |
| Bot detection | BotID + @vercel/firewall | `next.config.ts` + `package.json` |
| Input validation | Zod en todos los contratos LLM | `docs/spec/zod-strict-mode-2026.md` |
| Open redirect | URL-based origin check en `/login?next=` | `src/app/login/page.tsx` (fix `d86b468e`) |

### Gaps de seguridad abiertos (TO-BE)

| Gap | Severidad | Acción | Ola |
|---|---|---|---|
| **Auth no activa en main** | 🔴 CRÍTICO | Fusionar PR #2 + ejecutar migración 0013 + activar BETTER_AUTH_SECRET en Vercel | Auth |
| **`/api/financial-report` sin rate-limit por user** | 🔴 ALTO | Añadir rate-limit específico `financial-5/min` en proxy + WAF rule; Upstash cuando esté activo | Ola 3 |
| **Rate limit in-memory no funciona en multi-instancia** | 🟡 MEDIO | Provisionar Upstash Redis (`vercel integration add upstash`) | Ola 3 |
| **Email verification desactivada** | 🟡 MEDIO | `requireEmailVerification: true` + configurar `RESEND_API_KEY` | Ola auth |
| **Social auth comentado** | 🟢 BAJO | Descomentar Google/GitHub en `auth/config.ts` cuando OAuth apps registradas | Ola 4 |
| **9 ERPs sin tests** | 🟡 MEDIO | Audit de código para determinar si son stubs o funcionales | Ola 3 |
| **Stripe webhooks (TO-BE)** | — | Firma HMAC-SHA256 con `STRIPE_WEBHOOK_SECRET` en handler | Ola 4 |

---

## 11. Infraestructura y Despliegue

### AS-IS 🟢

```
GitHub repo (Rocuts/UtopIA)
    │
    ├── PR → CI (github-actions: tsc + vitest + build)
    │         Node 24 LTS + npm ci
    │         Stub env vars en build (DATABASE_URL, OPENAI_API_KEY)
    │         Feature flags OFF en CI
    │
    └── Merge a main → Vercel auto-deploy (Fluid Compute)
                       Region: inferido de Neon DB location (US-East probable)
                       maxDuration: 800s para endpoints financieros
                       Blob: uploads hasta 100MB
                       Firewall: WAF rules + BotID
```

**Configuración Vercel (AS-IS sin vercel.ts):** 🟡 Inferido — no hay `vercel.json` ni `vercel.ts` visible; se infiere que la configuración es automática via `next.config.ts`.

**DECISIÓN — No usar Vercel AI Gateway:**
> El código usa `@ai-sdk/openai` directo con `OPENAI_API_KEY`. El AI Gateway requería CC en archivo y fallaba en producción (documentado en `CLAUDE.md`). **Alternativa descartada**: routing via gateway para cost tracking — reemplazado por `agent_telemetry` propio.

### TO-BE

```
Entornos:
├── Local dev: next dev + .env.local (DATABASE_URL de Neon, OPENAI_API_KEY real)
├── Preview (Vercel): cada PR → deploy de preview automático
│   Feature flags: OFF por defecto (igual que CI)
│   DATABASE_URL: apuntar a branch de Neon staging (PENDIENTE DE VALIDAR — ADR-07)
└── Production (Vercel main): feature flags activados secuencialmente

CI/CD objetivo (ampliar .github/workflows/ci.yml):
├── Quality gates (existing): tsc + vitest + build
├── Integration tests (TO-BE): vitest --config vitest.integration.config.ts
│   Requiere: Neon TEST_DATABASE_URL env secret
└── Smoke test (TO-BE): npm run smoke
    Requiere: Neon staging + OPENAI_API_KEY staging
```

**DECISIÓN — Sin Docker:**
> El proyecto no tiene Dockerfile y corre en Vercel Fluid Compute. No hay caso de uso actual para containerización local. **Alternativa descartada**: Docker Compose para dev — Neon serverless es más simple que levantar Postgres local con pgvector.

**Release strategy:**
- Feature flags controlan rollout — no hay feature branches de larga vida
- `main` siempre deployable; flags permiten activación gradual por cliente
- Rollback: Vercel "Instant Rollback" en dashboard (re-punto de commit anterior)

---

## 12. Observabilidad

### AS-IS 🟢

| Signal | Implementación | Retención |
|---|---|---|
| **LLM Telemetry** | `agent_telemetry` table: tokens, cost, elapsed, fallback, reasoningTokens | Neon — indefinido |
| **Telemetry API** | `GET /api/admin/telemetry?hours=N` + `UTOPIA_ADMIN_TOKEN` | — |
| **Activity log** | `GET /api/admin/activity` — system events | `schema-activity.ts` |
| **Console logs** | `console.error/warn` preservados en prod (removeConsole excluye error+warn) | Vercel Runtime Logs (7 días en free tier) |
| **Alertas LLM** | Thresholds en `CLAUDE.md`: fallback>3%→P1, finishReason!=stop>1%→P0, daily>$50→P1 | Manual — no hay PagerDuty/OpsGenie integrado |
| **Sentinel** | KPI threshold alerts generadas por agente + cron diario | `schema-sentinel.ts` |

### Gaps y TO-BE

| Gap | Solución TO-BE | Ola |
|---|---|---|
| Sin métricas de negocio (DAU, informes generados, workspaces activos) | Añadir tabla `usage_events(workspace_id, event_type, metadata, created_at)` + `GET /api/admin/usage` | Ola 3 |
| Sin tracing distribuido | Vercel OTel (experimental) o simplemente correlation IDs via `X-Request-Id` (ya en proxy) | Ola 4 |
| Alertas manuales | Webhook a Slack/email desde `GET /api/admin/telemetry` si threshold superado — puede hacerse con n8n | Ola 4 |
| Smoke test no en CI | `npm run smoke` requiere Neon staging + secretos — añadir job separado en CI con `if: github.ref == 'refs/heads/main'` | Ola 3 |

---

## 13. Estrategia de Pruebas

### AS-IS 🟢

```
Herramienta: Vitest 3.2.4
Tests existentes: 87 archivos
Tests que pasan en CI: ~129 casos (según workflow comment)
Cobertura medida: NO (--coverage no corre en CI)
```

**Distribución por tipo:**
- Unit (dominio puro): `money.test.ts`, `nit-validator.test.ts`, `benford.test.ts`, `csv-parser.test.ts`, formatters
- Integration (con mocks LLM): `pipeline-e2e.test.ts`, dictamen tests, audit tests, escudo validators
- Contract: `api-contract.test.ts` para accounting periods
- Smoke (`npm run smoke`): fuera de CI — requiere Neon + dev server

**Qué NO tiene tests:** RAG vectorstore search con DB real, UI components, flujos E2E de usuario completos.

### TO-BE

**DECISIÓN — Objetivo de cobertura: 70% líneas en módulos críticos:**
> Módulos críticos = `accounting/double-entry/`, `agents/orchestrator.ts`, `proxy.ts`, `vault.ts`, `auth/config.ts`. El 100% no es objetivo — tests de dominio financiero más valiosos que coverage de scaffolding.

| Capa | Herramienta | Prioridad | Ola |
|---|---|---|---|
| Unit + Integration (existentes) | Vitest | Mantener + ampliar | Continuo |
| Coverage en CI | `vitest run --coverage` con umbral 70% | Alto | Ola 3 |
| Integration con DB real | `vitest.integration.config.ts` (existe, no en CI) | Alto — detecta diferencias mock/prod | Ola 3 |
| 9 ERPs sin tests | Vitest + mocks de provider API | Medio | Ola 3 |
| E2E | **PENDIENTE DE VALIDAR** — Playwright recomendado (ver ADR-08) | Medio | Ola 4 |
| Smoke en CI (post-merge) | `npm run smoke` + Neon staging | Bajo | Ola 3 |

---

## 14. Decisiones de Arquitectura (ADR)

### ADR-01 — Identificador de modelo LLM `gpt-5.4-mini`

> **Contexto**: `CLAUDE.md` documenta "familia GPT-5.4 post training-cutoff". El AUDIT_REPORT detecta que este modelo no existe en la API de OpenAI conocida (agosto 2025 cutoff).
> **PENDIENTE DE VALIDAR** — Verificar en OpenAI Playground si `gpt-5.4-mini` es un identificador válido en la API de producción. Si no lo es, reemplazar con `gpt-4o-mini` (conocido) en `src/lib/config/models.ts`. Impacto: 40+ agentes slots.

### ADR-02 — Monolito Next.js vs microservicios

> **Contexto**: 11 pipelines LLM, 96 rutas API, 952 archivos.
> **Decisión**: Mantener monolito.
> **Justificación**: escala actual no justifica operacional de microservicios; deuda de extracción > beneficio.
> **Alternativas descartadas**: separate Workers (Cloudflare), separate services por pipeline.
> **Revisión**: reconsiderar si el monolito supera 5k archivos o si los pipelines LLM necesitan SLAs independientes.

### ADR-03 — pg.Pool TCP vs Neon HTTP / WebSocket

> **Contexto**: `drizzle-orm/neon-http` no soporta `db.transaction()` real; WebSocket no sobrevive entre requests en Fluid Compute.
> **Decisión**: `pg.Pool` sobre TCP con `attachDatabasePool()` para cleanup en evicción.
> **Consecuencia**: Requiere endpoint pooled de Neon (`-pooler` en hostname). Max 5 conexiones por instancia.

### ADR-04 — BetterAuth vs NextAuth

> **Contexto**: Se necesita autenticación con soporte drizzle-orm nativo, email+pass y OAuth.
> **Decisión**: BetterAuth 1.6.14.
> **Alternativas descartadas**: NextAuth/Auth.js — menor soporte de tipo-seguridad con drizzle; Lucia — deprecado en 2025.
> **Consecuencia**: API a `src/app/api/auth/[...all]` + cookie `better-auth.session_token`.

### ADR-05 — Modelo de workspace: 1 usuario = 1 workspace vs N workspaces

> **PENDIENTE DE VALIDAR** — Actualmente `workspaces.user_id` es 1:1 (un usuario → un workspace). Pero un contador puede manejar 3 empresas.
> **Opción A** (simple): 1 usuario = 1 workspace. El usuario crea sub-espacios dentro del workspace. Schema mínimo.
> **Opción B** (flexible): `workspace_members` tabla (N:M). Un usuario puede tener N workspaces. Un workspace puede tener N miembros con roles. Schema más complejo pero correcto para B2B.
> **Recomendación**: Opción B. Impacto: tabla `workspace_members` + UI de workspace switcher.

### ADR-06 — Billing: Stripe vs Paddle vs ausente

> **PENDIENTE DE VALIDAR** — No hay billing en el código.
> **Opción A**: Stripe — más configurable, mayor comunidad, webhooks robustos.
> **Opción B**: Paddle — merchant of record, simplifica impuestos Colombia.
> **Opción C**: Diferir billing (plataforma gratuita / demo hasta Product-Market Fit).
> **Recomendación técnica**: Stripe si hay equipo para gestionar; Paddle si no. Schema: tabla `subscriptions` ya diseñada en §6.

### ADR-07 — Entorno staging: Neon branch vs base de datos separada

> **PENDIENTE DE VALIDAR** — Neon soporta branches de DB (como git branches). Permiten tener staging sin costo adicional.
> **Recomendación**: Usar Neon branch para staging + preview deploys. Activar via `neon branches create`.

### ADR-08 — Tests E2E: Playwright vs Cypress

> **PENDIENTE DE VALIDAR**.
> **Recomendación**: Playwright — soporte nativo Next.js, más rápido, gratuito.
> **Trade-off**: requiere configurar `playwright.config.ts` + GitHub Actions job con Neon staging.

### ADR-09 — LangChain vs AI SDK para embeddings

> **Contexto**: RAG usa `@langchain/openai` para embeddings, pero AI SDK v6 tiene `embed()` y `embedMany()` nativos.
> **PENDIENTE DE VALIDAR** — LangChain tiene 3 dependencias pesadas que suman ~2MB al bundle.
> **Acción sugerida**: migrar `src/lib/rag/ingest.ts` a AI SDK embeddings en Ola 4 si no rompe tests.

---

## 15. Deuda Técnica a Resolver

(Del `AUDIT_REPORT.md`, priorizada con enfoque técnico)

| ID | Deuda | Severidad | Solución técnica | Ola |
|---|---|---|---|---|
| DT-01 | Sin autenticación de usuario en main | 🔴 | Fusionar PR #2 + migración 0013 | Auth |
| DT-02 | `/api/financial-report` sin rate-limit por user | 🔴 | Rate-limit rule `financial-5/min` en proxy.ts + WAF | Ola 3 |
| DT-03 | Rate limit in-memory (no funciona multi-instancia) | 🟡 | Upstash Redis `vercel integration add upstash` | Ola 3 |
| DT-04 | 9 adaptadores ERP sin tests ni validación | 🟡 | Audit manual del código; tests básicos o marcar como stubs en docs | Ola 3 |
| DT-05 | RAG: MemoryVectorStore fallback eliminado pero no verificado en prod | 🟡 | `GET /api/rag` debe devolver `backendStatus:'pgvector'` en prod — smoke test | Ola auth |
| DT-06 | `callFinancialAgent` cast `as z.infer<TSchema>` sin `safeParse` | 🟡 | Añadir `schema.safeParse(safeOutput(result))` y lanzar con contexto si `!success` | Ola 3 |
| DT-07 | `double-entry/service.ts` tipo `DrizzleTx` anidado 3 niveles | 🟡 | Extraer type alias `type AppTx = Parameters<typeof getDb().transaction>[0]` | Ola 3 |
| DT-08 | `vectorstore.ts:346-380` INSERT sin batch limit (N chunks en 1 statement) | 🟡 | Chunking en lotes de 100 con `for...of slice` | Ola 3 |
| DT-09 | `chatWorkspace` `removeDocument` filtra por filename — bug con nombres duplicados | 🟡 | Filtrar por ID único en vez de filename | Ola 2 |
| DT-10 | `money.ts:33-44` — `formatCopFromCents(number)` trunca floats silenciosamente | 🟡 | Cambiar tipo a `bigint` en el parámetro; ya tiene la conversión interna | Ola 3 |
| DT-11 | `'COP'` hardcoded en 4 lugares de double-entry/service.ts | 🟢 | Extraer `DEFAULT_CURRENCY = 'COP'` en `src/lib/accounting/constants.ts` | Ola 3 |
| DT-12 | Cobertura de tests no configurada en CI | 🟢 | `vitest run --coverage --reporter=json` + artefacto en CI + umbral 70% | Ola 3 |
| DT-13 | No hay Makefile / script de bootstrap único | 🟢 | `scripts/bootstrap.sh`: `npm ci && npm run db:push && npm run db:seed-calendar` | Ola 3 |
| DT-14 | LangChain deps pesadas para solo embeddings | 🟢 | Migrar a AI SDK `embed()` en Ola 4 | Ola 4 |
| DT-15 | `cacheComponents: true` diferido (Ola 4) | 🟢 | Envolver todos los Client Components con estado no-determinista en `<Suspense>` | Ola 4 |

---

## 16. Riesgos Técnicos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Modelo `gpt-5.4-mini` no existe en API → todos los chats fallidos | Media | Crítico | Verificar hoy en OpenAI Playground; si inválido, revertir a `gpt-4o-mini` en `models.ts` |
| `getDb()` falla en producción (DATABASE_URL no configurada) → 500 en todos los endpoints | Alta (local) / Baja (prod si Neon está OK) | Crítico | Smoke test post-deploy; alarma en Vercel si error rate > 5% |
| Neon connection limit superado (max 5/instancia × N instancias) | Media (a > 20 usuarios concurrentes) | Alto | Upstash Redis + PgBouncer vía Neon connection pooler; monitorear en `pg.Pool` events |
| Billing ausente → sin revenue track ni control de acceso por plan | Alta (si se lanza sin billing) | Alto | Diseñar schema `subscriptions` antes de primer pago; Stripe Checkout como solución mínima |
| Migración `workspaces.user_id` NOT NULL rompe workspaces anónimos existentes | Media | Alto | `claimAnonymousWorkspace()` ya implementada; NO hacer NOT NULL hasta verificar count=0 |
| 9 ERPs sin tests son stubs → usuarios conectan ERP y no funciona | Media | Medio | Audit manual del código; documentar estado real por provider |
| RAG en Vercel degradado (MemoryVectorStore) sin que se note | Baja (fix en PR #2) | Medio | Añadir `backendStatus` al health check del workspace |
| `monthly_close_runs` sin mecanismo de retry en fallo parcial | Media | Medio | Implementar dead-letter con reintento manual; workflow ya tiene status machine |
| Playwright / E2E inexistente → bugs de UI en producción | Alta | Medio | Añadir Playwright en Ola 4; mientras tanto, smoke test manual antes de cada release |

---

## 17. Plan de Implementación Técnica

### Ola Auth — Desbloquear seguridad real (prioridad máxima)

**Criterio de "hecho":** proxy auth activo en producción, cero workspaces accesibles sin sesión válida.

| Tarea | Archivo | Dependencia | Criterio técnico |
|---|---|---|---|
| Verificar `gpt-5.4-mini` en OpenAI API | `src/lib/config/models.ts` | Ninguna | Prompt simple en Playground → respuesta sin error |
| Activar `BETTER_AUTH_SECRET` + `BETTER_AUTH_URL` en Vercel | Vercel dashboard | PR #2 fusionado | `GET /api/auth/session` devuelve 200 |
| Ejecutar `npm run db:push` en Neon prod | CLI + DATABASE_URL | `BETTER_AUTH_SECRET` activo | Tabla `user` existe en Neon |
| Configurar `RESEND_API_KEY` en Vercel | Vercel dashboard | Cuenta Resend | Email de bienvenida llega al registrar usuario |
| Fusionar PR #2 a main | GitHub | CI passing | Proxy bloquea `/workspace` sin sesión → redirige a `/login` |
| Smoke test auth: register → login → /workspace | Manual / Playwright | Todo lo anterior | Usuario ve workspace propio, no puede ver otro |

### Ola 2 — Activar features (sin código nuevo)

| Tarea | Acción | Criterio técnico |
|---|---|---|
| Activar TAX_ENGINE | `vercel env add UTOPIA_ENABLE_TAX_ENGINE true` | `/api/accounting/tax-engine/preview` responde 200 |
| Activar BANK_RECON | `vercel env add UTOPIA_ENABLE_BANK_RECON true` | Conciliación bancaria visible en workspace |
| Activar AUTO_ADJUSTMENTS | `vercel env add UTOPIA_ENABLE_AUTO_ADJUSTMENTS true` | Preview de depreciaciones funciona |
| Activar OCR_PROMOTE | `vercel env add UTOPIA_ENABLE_OCR_PROMOTE true` | Botón "Promover" visible en Pyme |
| Activar MONTHLY_CLOSE | `vercel env add UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW true` | POST /api/accounting/close/start devuelve runId |
| Activar NOTIFICATIONS | `vercel env add UTOPIA_ENABLE_NOTIFICATIONS true` + RESEND_API_KEY | Email enviado en cierre de período |
| Fix: removeDocument por ID | `src/components/workspace/chat/` | Test: 2 docs con mismo nombre → elimina el correcto |

### Ola 3 — Calidad y observabilidad

| Tarea | Archivo(s) | Criterio técnico |
|---|---|---|
| Upstash Redis rate-limit | `src/proxy.ts` + env vars | Rate limit funciona en 2 instancias concurrentes sin estado compartido |
| Rate-limit `/api/financial-report` | `src/proxy.ts:RATE_LIMITS` | >5 req/min → 429 con Retry-After header |
| Coverage en CI | `.github/workflows/ci.yml` | CI publica coverage artifact; falla si < 70% en módulos críticos |
| Tests 9 ERPs | `src/lib/erp/providers/*.ts` | Audit de código → si stub: documentar; si funcional: test mínimo |
| Integration tests en CI | `.github/workflows/ci.yml` | `npm run test:integration` pasa con TEST_DATABASE_URL |
| ADR-06 callFinancialAgent safeParse | `src/lib/agents/financial/agents/runtime.ts:267` | Error con contexto legible si JSON inválido |
| Usage events tabla | Nueva migración + API | `GET /api/admin/usage` devuelve DAU/WAU |
| Bootstrap script | `scripts/bootstrap.sh` | Dev nuevo levanta proyecto con 1 comando |

### Ola 4 — SaaS completo

| Tarea | Archivo(s) | Criterio técnico |
|---|---|---|
| Billing Stripe | `src/app/api/billing/`, `stripe` dep, tabla `subscriptions` | Checkout → webhook → workspace.plan actualizado |
| workspace_members (ADR-05) | Nueva migración + API | Usuario puede tener 2 workspaces; invitar colaborador |
| E2E Playwright | `playwright.config.ts` + `tests/e2e/` | Suite crítica: login → cargar balance → generar informe |
| cacheComponents: true | `next.config.ts` + Suspense boundaries | Build sin errores; `<Suspense>` en todos los Client Components con `new Date()`/`Math.random()` |
| LangChain → AI SDK embeddings | `src/lib/rag/ingest.ts` | `npm run db:ingest` funciona; bundle -2MB |
| Social auth Google/GitHub | `src/lib/auth/config.ts` | OAuth callback funcional en staging |
| Vercel OTel tracing | `src/instrumentation.ts` | Traces visibles en Vercel dashboard |

---

## Tabla de Trazabilidad PRD ↔ TRD

| Req. PRD | Requisito técnico (TRD) | Componente afectado | Estado | Evidencia AS-IS |
|---|---|---|---|---|
| RF-01 | Pipeline NIIF 3-pass chunked, Zod validated, streaming SSE | `src/app/api/financial-report/niif/route.ts` | ✅ existe | `pipeline-e2e.test.ts` |
| RF-02 | HTML Editor 12 slides, maxOutputTokens:48000 | `src/app/api/financial-report/html/route.ts` | ✅ existe | `docs/spec/financial-report-v8.1.md` |
| RF-03 | Auditoría Promise.allSettled 4 agentes paralelos | `src/app/api/financial-audit/route.ts` | ✅ existe | AUDIT_REPORT Fase 1 |
| RF-04 | T1/T2/T3 classifier → orchestrator routing | `src/lib/agents/orchestrator.ts`, `classifier.ts` | ✅ existe | `classifier.test.ts` |
| RF-05 | Dictámenes con citation.validator → citas normativas verificadas | `src/lib/agents/financial/escudo-survival/normative/` | ✅ existe | `citation.validator.test.ts` |
| RF-06 | Score DIAN 6 factores con risk-score.validator | `src/lib/agents/financial/escudo-survival/fiscal-agent/` | ✅ existe | `risk-score.validator.test.ts` |
| RF-07 | DB CHECK(total_debit=total_credit) + validate.test.ts | `schema.ts:journal_entries`, `accounting/double-entry/` | ✅ existe | `validate.test.ts` |
| RF-08 | Ciclo vida períodos: open→closed→locked, permisos diferenciados | `src/lib/accounting/periods/`, `/api/accounting/periods/` | ✅ existe | `api-contract.test.ts` |
| RF-09 | AES-256-GCM vault, formato v1:gcm:iv:tag:ct | `src/lib/security/vault.ts` | ✅ existe | `vault.test.ts` |
| RF-10 | OCR → pyme_uploads → pyme_entries, feature flag PROMOTE | `src/app/api/pyme/uploads/`, `src/app/api/pyme/promote/` | 🚧 flag OFF | `pyme_uploads` table |
| RF-11 | Workflow multi-paso monthly_close_runs, status machine | `src/lib/workflows/monthly-close/` | 🚧 flag OFF | `canonical.test.ts` |
| RF-12 | CSV parser + fingerprint matching → conciliación bancaria | `src/lib/accounting/banking/` | 🚧 flag OFF | `csv-parser.test.ts` |
| RF-13 | pgvector 1536d + BM25 tsvector(spanish) hybrid search | `src/lib/rag/vectorstore.ts`, `rag_chunks` table | 🚧 degradado Vercel | `vectorstore.test.ts` |
| RF-14 | BetterAuth email+pass, sesión 30 días, cookie HTTP-only | `src/lib/auth/config.ts`, `src/app/api/auth/[...all]/` | 🚧 PR #2 no fusionado | `schema-auth.ts` |
| RF-15 | workspaces.user_id NOT NULL post-migración + workspace_members | `schema.ts:workspaces`, nueva migración | ❌ falta | `workspaces.user_id` nullable |
| RF-16 | alert_thresholds + Resend + dispatch endpoint | `src/lib/notifications/`, `schema-notifications.ts` | 🚧 flag OFF | `insight-templates.test.ts` |
| RF-17 | Cron anomaly-detection + feature flag ANOMALY_DETECTION | `/api/cron/anomaly-detection` | 🚧 flag OFF | cron route exists |
| RF-18 | ExcelJS multi-hoja + Content-Disposition attachment | `/api/financial-report/export`, `exceljs` dep | ✅ existe | route + dep |
| RF-19 | @react-pdf/renderer compose + elite styling | `src/lib/export/pdf-elite-react/` | ✅ existe | `compose.test.ts` |
| RF-20 | NIT regex + dígito verificación mod11 | `src/lib/validation/nit-validator.ts` | ✅ existe | `nit-validator.test.ts` |
| RF-21 | Forensic: benford, gaps, repeated-amounts, weekend-postings | `src/lib/agents/financial/audit/forensic/` | ✅ existe | 5 test files |
| RF-22 | Vercel Blob upload token efímero, 100MB limit | `/api/upload`, `/api/upload/blob-token` | ✅ existe | commit `95d10e8` |
| RF-23 | DCF + Monte Carlo + due-diligence pillars | `src/lib/pillars/`, `/api/business-valuation` | ✅ existe | `monte-carlo.test.ts` |
| RF-24 | OpenAI Realtime session token, gpt-4o-realtime-preview | `/api/realtime` | ✅ existe | `OPENAI_MODEL_REALTIME` |
| RF-25 | macro_factors cron + IPC/TRM/BanRep daily refresh | `src/lib/macro/`, `macro_factors` table | ✅ existe | `service.test.ts` |
| RNF-01 | `maxDuration: 800s` por endpoint financiero | Route handlers | ✅ existe | export en cada route.ts |
| RNF-02 | AES-256-GCM vault | `vault.ts` | ✅ existe | `vault.test.ts` |
| RNF-04 | Rate limiting proxy + WAF + (TO-BE Upstash) | `proxy.ts`, `rate-limit.ts` | 🚧 in-memory solo | DT-03 |
| RNF-06 | Auth gate en proxy para /workspace + /api/chat | `proxy.ts` | 🚧 PR #2 solo | Ola Auth |
| RNF-07 | MoneyCop bigint centavos, parseMoneyCop/formatCopFromCents | `contracts/money.ts` | ✅ existe | `money.test.ts` |
| RNF-10 | Zod strict mode — .nullable() only | CI lint-strict-mode | ✅ existe | `scripts/lint-strict-mode.mjs` |

---

## Decisiones técnicas abiertas (PENDIENTE DE VALIDAR)

Ordenadas por impacto — confirmar antes de implementar:

1. **ADR-01 — ¿`gpt-5.4-mini` es un identificador de API válido?** Si no lo es, todos los chats fallan silenciosamente en producción. Verificar hoy. Impacto: inmediato.

2. **ADR-05 — ¿1 workspace por usuario o N workspaces por usuario?** Define si se necesita `workspace_members` (tabla N:M) o basta con `user_id` en workspaces. Un contador con 3 empresas necesita N workspaces. Impacto: schema de DB, UI de workspace switcher.

3. **ADR-06 — ¿Cuándo y con qué plataforma de billing?** Sin respuesta, el proyecto no tiene path a revenue. Stripe vs Paddle; cuándo es la Ola 4 en el roadmap. Impacto: si se elige Stripe, diseñar schema ahora para no migrar más tarde.

4. **ADR-07 — ¿Usar Neon branch para staging o database separada?** Afecta el costo de infrastructure y la paridad staging/prod. Neon branches son gratuitas hasta X GB.

5. **ADR-08 — ¿E2E con Playwright o no en el corto plazo?** Sin E2E, los bugs de UI solo se detectan en producción. Playwright añade ~30 min al CI. Si el equipo es < 3 devs, puede diferirse; si > 3, vale el costo.

---

*TRD generado automáticamente + decisiones técnicas derivadas del código. Verificar todos los PENDIENTE DE VALIDAR con el equipo antes de iniciar Ola 4.*
