# UtopIA — Architecture

Operational reference for the codebase. Read this when you need the lay of the land. The code is the source of truth — when this doc and the code disagree, the code wins and this doc gets updated. Historical context lives in [wave-notes/](wave-notes/), authoritative contracts in [spec/](spec/).

## Two orchestration systems

UtopIA has two independent multi-agent systems with different invariants.

### 1. Chat Orchestrator — interactive Q&A
`src/lib/agents/orchestrator.ts`

- Classifier determines cost tier: T1 (direct, 1 call) → T2 (single specialist) → T3 (parallel specialists + synthesis).
- Prompt Enhancer rewrites vague user queries into professional prompts.
- Specialists extend `BaseSpecialist` (`src/lib/agents/specialists/base-agent.ts`) and have a tool-calling loop with retry, accessing tools defined in `src/lib/agents/tools/registry.ts`.
- T3 queries run specialists in parallel, then `synthesizer.ts` merges outputs.
- Entry point: `POST /api/chat` with optional SSE via `X-Stream: true`.

### 2. Financial Pipeline — structured reports (1+1)
`src/lib/agents/financial/orchestrator.ts`

Three agents run **sequentially**: NIIF Analyst → Strategy Director → Governance Specialist. Does NOT use `BaseSpecialist` or the tool registry — agents are `callFinancialAgent` calls with structured Zod-typed outputs. Uses `MODELS.FINANCIAL_PIPELINE`. Each phase has its own endpoint with `maxDuration: 800s` (Wave 3 split — see [wave-notes/wave-3-split-endpoints.md](wave-notes/wave-3-split-endpoints.md)):

- `POST /api/financial-report/niif` → NIIF Analyst (3 sequential passes — see [wave-notes/chunked-niif-analyst.md](wave-notes/chunked-niif-analyst.md))
- `POST /api/financial-report/strategy` → Strategy Director
- `POST /api/financial-report/governance` → Governance Specialist
- `POST /api/financial-report` (legacy composer) — `@deprecated`, backward-compat for `/export`

### 3. Audit Pipeline — regulatory validation
`src/lib/agents/financial/audit/orchestrator.ts`

Four auditors run **in parallel** (`Promise.allSettled`): NIIF, Tax, Legal, Fiscal Reviewer. Validates the Financial Pipeline output against Colombian 2026 regulations. Each emits structured `AuditFinding[]` with severity/norm/recommendation/impact. The Fiscal Reviewer emits a formal opinion (favorable / con_salvedades / desfavorable / abstension). Findings are consolidated with a weighted compliance score (NIIF 30%, Tax 25%, Legal 20%, Fiscal 25%). Entry point: `POST /api/financial-audit` (SSE, `maxDuration: 300s`).

### 4. Preprocessing + Export (deterministic, no LLM)

- `src/lib/preprocessing/trial-balance.ts`: parses CSV/Excel trial balances, filters auxiliaries, sums by PUC class, detects discrepancies, validates patrimonial equation. Outputs clean data + validation report + 14 deterministic KPIs in `controlTotals` (single source of truth — Strategy Director consumes them as anchor).
- `src/lib/export/excel-export.ts`: generates multi-tab `.xlsx` (Balance, P&L, KPIs, Validation, Summary) via ExcelJS with corporate formatting.
- `POST /api/financial-report/export`: full pipeline (preprocess → 3 agents → Excel) or export-only mode.
- The upload route (`/api/upload`) auto-detects trial balance CSVs and prepends a validation report to the extracted text.

### 5. Quality Meta-Auditor — best practices validation
`src/lib/agents/financial/quality/agent.ts`

Single agent evaluating the ENTIRE pipeline output against 12 quality dimensions. Frameworks: IASB Conceptual Framework, IFRS 18 readiness, ISO 25012 (data quality), ISO 42001 (AI governance), CTCP Colombia. Scores: overall grade A+→F, per-dimension scores, IFRS 18 readiness, data quality metrics, AI governance metrics. Entry point: `POST /api/financial-quality` (accepts report + auditReport + preprocessed).

### 6. Tax Planning Pipeline
`src/lib/agents/financial/tax-planning/orchestrator.ts` — three agents **sequentially**: Tax Optimizer → NIIF Impact Analyst → Compliance Validator. Covers Art. 240 ET (35%), SIMPLE (Arts. 903-916), Zonas Francas, ZOMAC, Art. 256/255 discounts, dividends (Art. 242), holdings (CHC). `POST /api/tax-planning` (SSE, `maxDuration: 300s`).

### 7. Transfer Pricing Pipeline
`src/lib/agents/financial/transfer-pricing/orchestrator.ts` — three agents **sequentially**: TP Analyst → Comparable Analysis → Documentation Writer. Covers Arts. 260-1 to 260-11 ET, Decreto 2120/2017, 6 methods (PC/PR/CN/PD/ML/MUT), Formato 1125 DIAN. `POST /api/transfer-pricing` (SSE, `maxDuration: 300s`).

### 8. Business Valuation Pipeline
`src/lib/agents/financial/valuation/orchestrator.ts` — **hybrid**: DCF Modeler + Market Comparables run **in parallel** → Valuation Synthesizer **sequential**. Covers NIIF 13, NIC 36, Art. 90 ET, TES/EMBI/WACC colombiano, SuperSociedades guidelines. `POST /api/business-valuation` (SSE, `maxDuration: 300s`).

### 9. Fiscal Audit Opinion Pipeline
`src/lib/agents/financial/fiscal-opinion/orchestrator.ts` — **hybrid**: Going Concern + Material Misstatement + Compliance in **parallel** → Opinion Drafter **sequential**. Covers NIA 200-706, Ley 43/1990, Art. 207-209 C.Co., Ley 222/1995, dictamen formal colombiano. `POST /api/fiscal-audit-opinion` (SSE, `maxDuration: 300s`).

### 10. Tax Reconciliation Pipeline
`src/lib/agents/financial/tax-reconciliation/orchestrator.ts` — two agents **sequentially**: Difference Identifier → Deferred Tax Calculator. Covers Art. 772-1 ET, Formato 2516 DIAN, NIC 12, Decreto 2235/2017, 35% tax rate. `POST /api/tax-reconciliation` (SSE, `maxDuration: 300s`).

### 11. Feasibility Study Pipeline
`src/lib/agents/financial/feasibility/orchestrator.ts` — three agents **sequentially**: Market Analyst → Financial Modeler → Risk Assessor. Covers DNP methodology, Ley 2069/2020, WACC colombiano, ZOMAC/ZF incentives, MIPYME classification. `POST /api/feasibility-study` (SSE, `maxDuration: 300s`).

## Tool system (chat orchestrator only)

Tools are defined in `src/lib/agents/tools/registry.ts` using the AI SDK v6 `tool({ description, inputSchema: z.object(...) })` helper and implemented in `src/lib/tools/`. Each specialist gets a subset via `getToolsForAgent(name)` which returns a `Record<string, Tool>` map. Available: `search_docs`, `search_web`, `calculate_sanction`, `analyze_document`, `draft_dian_response`, `assess_risk`, `get_tax_calendar`.

**Important design choice** — tools in the registry have NO `execute` function. `generateText` / `streamText` return `toolCalls` without auto-invoking them. The manual loop in `BaseSpecialist.execute()` (`MAX_TOOL_ROUNDS = 6`) dispatches each call via `executeTool(name, args, ctx)` so the per-call `ToolExecContext` (documents, ERP connections) gets injected correctly.

## RAG pipeline

- Vector store: HNSWLib-node (primary) with MemoryVectorStore fallback for Vercel (`src/lib/rag/vectorstore.ts` checks `process.env.VERCEL`).
- Embeddings: `text-embedding-3-small` via `@langchain/openai` (NOT through the AI SDK provider — LangChain's own client, uses `OPENAI_API_KEY` directly).
- Source documents: `src/data/tax_docs/*.md` (Colombian tax law, DIAN doctrine, NIIF standards).
- Ingestion: `src/lib/rag/ingest.ts` with `RecursiveCharacterTextSplitter` (1000 chars, 250 overlap). Run `npm run db:ingest`.
- Document upload: `POST /api/upload` handles PDF, DOCX, XLSX, CSV, images. OCR is `generateText` with `{ type: 'image', image: dataUrl }` (images) or `{ type: 'file', data: buffer, mediaType: 'application/pdf' }` (scanned PDFs) against `MODELS.OCR`.

## Security layer

- `src/proxy.ts` (Next 16, formerly `src/middleware.ts`): rate limiting (workspace-id-or-IP keyed; Vercel WAF first via `@vercel/firewall`, in-memory backstop), fail-closed CSRF origin check on POST/PUT/PATCH/DELETE (with `/api/cron/*` allowlist), security headers. Only applies to `/api/*`. WAF `rateLimitId`s to configure: `docs/PLATFORM_MIGRATION.md`.
- `src/lib/security/pii-filter.ts`: redacts NIT, cédula, emails, phones, cards before LLM calls. Extracts NIT context (last digit) BEFORE redacting for personalization.
- `next.config.ts`: CSP headers restricting connections to OpenAI + Tavily APIs.
- `src/lib/validation/schemas.ts`: Zod schemas for all API request validation.
- `src/lib/security/vault.ts`: AES-256-GCM Node-side encryption for ERP credentials (`encrypted_secret` column on `erp_credentials`). Wire format `v1:gcm:<iv>:<tag>:<ct>` with base64url segments. Distinct from `encryption.ts` (pgcrypto for column-level PII). Key from `UTOPIA_VAULT_KEY`; rotation via `UTOPIA_VAULT_KEY_PREV` + `npm run db:encrypt-erp -- --rotate`. See `docs/SECURITY_ENCRYPTION.md`.

## State management

- **Server (MVP, no auth)**: Neon Postgres via Vercel Marketplace, accessed through Drizzle ORM (`drizzle-orm/neon-http`). Schema in `src/lib/db/schema.ts` (4 tables: `workspaces`, `erp_credentials`, `reports`, `alert_thresholds`). Lazy `getDb()` in `src/lib/db/client.ts` (no Proxy — breaks adapters that introspect methods). Tenant identification is anonymous via httpOnly cookie `utopia_workspace_id` set by `getOrCreateWorkspace()` in `src/lib/db/workspace.ts`. Migrations run with `npm run db:push` (uses `dotenv-cli` to load `.env.local`).
- **Server (legacy, in-flight)**: agent orchestrators are stateless per request. Conversation history, intake drafts, and ERP credentials live client-side and will migrate to DB incrementally.
- **Client**: `WorkspaceContext` (active case, use case, documents, risk), `LanguageContext` (es/en), conversation history in localStorage. Intake drafts via `useIntakePersistence` (debounce 500ms).
- SSE progress events flow from orchestrator → API route → `ChatThread.tsx` for real-time status indicators.
- **Adding auth later**: add a `users` table + `workspace_members` join table; the cookie-based workspace flow continues to work for anonymous sessions and gets migrated on first login.

## Adding new agents

- **New chat specialist**: extend `BaseSpecialist`, add a prompt in `src/lib/agents/prompts/*.prompt.ts` (builder function taking language, use case, NIT context), register in `SPECIALISTS` map in `orchestrator.ts` + `AGENT_TOOLS` map in `registry.ts`.
- **New financial pipeline agent**: standalone function in `src/lib/agents/financial/agents/`, must call `callFinancialAgent` from `runtime.ts` (NOT `generateText` directly). Wire in `src/lib/agents/financial/orchestrator.ts`.
- **New audit agent**: same pattern in `src/lib/agents/financial/audit/agents/`. Output structured JSON findings parsed by `parseAuditorOutput()`.

## Layout gotcha — Lenis smooth scroll

`src/app/layout.tsx` wraps the app with `<SmoothScroll>` → `ReactLenis root`. Lenis hijacks wheel events at the document level. Any subtree with internal `overflow-y-auto` (workspace shell, fullscreen modals) **must** carry `data-lenis-prevent` on an ancestor or mouse-wheel scroll dies silently. The workspace shell root `<div>` already has it — preserve it when editing `src/app/workspace/layout.tsx`.

**Do not blame `overflow-hidden` for dead-wheel-scroll bugs.** Check `data-lenis-prevent` first.
