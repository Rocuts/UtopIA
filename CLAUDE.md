# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is UtopIA

UtopIA is an AI-powered Colombian accounting, tax, and financial advisory platform. It uses multi-agent orchestration via **AI SDK v6** calling **OpenAI directly** through `@ai-sdk/openai` with `OPENAI_API_KEY` (default `gpt-5.4-mini`), RAG over curated tax documents, and real-time web search to deliver professional-grade consulting through a chat interface.

## Commands

```bash
npm run dev          # Start Next.js dev server (localhost:3000)
npm run build        # Production build (Turbopack)
npm run lint         # ESLint
npm run db:ingest    # Ingest tax documents into HNSWLib vector store
```

No test framework is configured. Validate changes with `npx tsc --noEmit` and `npm run build`.

## Environment Variables

Required in `.env.local`:
- `OPENAI_API_KEY` — used by every LLM call (chat orchestrator, every financial pipeline, OCR, Realtime voice, LangChain embeddings). The AI SDK provider `@ai-sdk/openai` reads it automatically — never pass `apiKey` in code.
- `TAVILY_API_KEY` — web search via `src/lib/search/web-search.ts`
- `UTOPIA_AGENT_MODE` — `orchestrated` (multi-agent) or `legacy` (monolithic). Controls which handler `/api/chat` uses

Optional model overrides (pass plain OpenAI model IDs — no `openai/` prefix; if a legacy value contains the prefix, `envModel()` strips it). Defaults are GPT-5.4 family (lanzada marzo 2026; gpt-4o deprecado):
- `OPENAI_MODEL_CHAT` (default `gpt-5.4-mini`) — chat orchestrator, specialists, synthesizer
- `OPENAI_MODEL_FINANCIAL` (default `gpt-5.4-mini`) — financial/audit/tax/valuation/etc. pipelines
- `OPENAI_MODEL_CLASSIFIER` (default `gpt-5.4-nano`) — query classifier (T1/T2/T3 routing); usa nano para ahorrar costo
- `OPENAI_MODEL_OCR` (default `gpt-5.4`) — PDF/image OCR in `/api/upload` (full model, not mini, for accuracy on accounting docs)
- `OPENAI_MODEL_OCR_LIGHT` (default `gpt-5.4-mini`) — OCR ligero para facturas y tirillas (vision-extractor pyme)
- `OPENAI_MODEL_EMBEDDINGS` (default `text-embedding-3-small`) — RAG embeddings via `@langchain/openai`
- Others in `src/lib/config/models.ts`

`process.env.VERCEL` is checked in `src/lib/rag/vectorstore.ts` to fall back from HNSWLib to MemoryVectorStore on Vercel's read-only filesystem.

## LLM Provider

- **All AI SDK calls** receive a `LanguageModel` instance from `@ai-sdk/openai` (e.g. `MODELS.CHAT === openai('gpt-5.4-mini')`). The provider reads `OPENAI_API_KEY` automatically — **never** pass an `apiKey` option, never instantiate the OpenAI SDK directly, and never use the legacy `'openai/<model>'` gateway-prefixed string. The GPT-5.4 family ships as reasoning models — AI SDK >= 3.0.55 mapea `maxOutputTokens` -> `max_completion_tokens` automaticamente, asi que las llamadas existentes siguen funcionando sin cambios.
- Models come from `src/lib/config/models.ts` (`MODELS.CHAT`, `MODELS.FINANCIAL_PIPELINE`, `MODELS.OCR`, etc.). Change model IDs in ONE place; envs override per-key. `envModel()` strips a leading `openai/` if present in env values (defensive, for legacy gateway-style overrides).
- Migration contract followed by every existing call: `openai.chat.completions.create` → `generateText` / `streamText`, `max_tokens` → `maxOutputTokens`, `response.choices[0].message.content` → `result.text`. For structured outputs, prefer `experimental_output: Output.object({ schema: zodSchema })` on `generateText` (see `src/lib/agents/classifier.ts` for the canonical pattern). The older "append `'Respond ONLY with valid JSON.'` to the system prompt" trick is acceptable for lift-and-shift but less reliable. See `docs/AI_SDK_MIGRATION.md`.
- Realtime voice still uses direct `fetch('https://api.openai.com/v1/realtime/sessions', ...)` with `OPENAI_API_KEY` — the AI SDK does not yet expose the Realtime API.
- RAG embeddings use `@langchain/openai`'s own client with `OPENAI_API_KEY` (LangChain doesn't share the AI SDK provider chain). `MODELS.EMBEDDINGS` is exported as a plain string for that consumer.
- The Vercel AI Gateway is **not** used. An earlier iteration routed everything through it, but the gateway requires a credit card on file and was failing in production. Direct OpenAI calls are simpler and use the existing `OPENAI_API_KEY` the user already provisions.

## Architecture

### Path Alias

`@/*` resolves to `./src/*` (tsconfig.json). All imports use this alias.

### Two Orchestration Systems

The codebase has two independent multi-agent systems:

**1. Chat Orchestrator** (`src/lib/agents/orchestrator.ts`) — interactive Q&A
- Classifier determines cost tier: T1 (direct, 1 call) → T2 (single specialist) → T3 (parallel specialists + synthesis)
- Prompt Enhancer rewrites vague user queries into professional prompts
- Specialist agents (tax, accounting, documents, strategy) extend `BaseSpecialist` in `src/lib/agents/specialists/base-agent.ts`
- Each specialist has a tool-calling loop with retry, accessing tools defined in `src/lib/agents/tools/registry.ts`
- T3 queries run specialists in parallel, then `synthesizer.ts` merges outputs
- Entry point: `POST /api/chat` with optional SSE via `X-Stream: true` header

**2. Financial Pipeline** (`src/lib/agents/financial/orchestrator.ts`) — structured reports
- Three agents run **sequentially** (each feeds the next): NIIF Analyst → Strategy Director → Governance Specialist
- Does NOT use `BaseSpecialist` or the tool registry — agents are plain `generateText` calls with structured Markdown prompts
- Uses `MODELS.FINANCIAL_PIPELINE` (default `gpt-5.4-mini`). Override via `OPENAI_MODEL_FINANCIAL`.
- Entry point: `POST /api/financial-report` with SSE streaming. `maxDuration: 300s`

**3. Audit Pipeline** (`src/lib/agents/financial/audit/orchestrator.ts`) — regulatory validation
- Four auditors run **in parallel** (`Promise.allSettled`): NIIF, Tax, Legal, Fiscal Reviewer
- Validates the output of the Financial Pipeline against Colombian 2026 regulations
- Each auditor produces structured findings (`AuditFinding[]`) with severity, norm reference, recommendation, impact
- The Fiscal Reviewer emits a formal audit opinion (favorable / con_salvedades / desfavorable / abstension)
- Findings are consolidated with a weighted compliance score (NIIF 30%, Tax 25%, Legal 20%, Fiscal 25%)
- Entry point: `POST /api/financial-audit` with SSE streaming. `maxDuration: 300s`

**5. Quality Meta-Auditor** (`src/lib/agents/financial/quality/agent.ts`) — best practices validation
- Single agent evaluates the ENTIRE pipeline output against 12 quality dimensions
- Frameworks: IASB Conceptual Framework, IFRS 18 readiness, ISO 25012 (data quality), ISO 42001 (AI governance), CTCP Colombia
- Scores: overall grade (A+ to F), per-dimension scores, IFRS 18 readiness, data quality metrics, AI governance metrics
- Entry point: `POST /api/financial-quality`. Accepts report + auditReport + preprocessed

**6. Tax Planning Pipeline** (`src/lib/agents/financial/tax-planning/orchestrator.ts`)
- Three agents run **sequentially**: Tax Optimizer → NIIF Impact Analyst → Compliance Validator
- Covers: Art. 240 ET (35%), SIMPLE (Arts. 903-916), Zonas Francas, ZOMAC, Art. 256/255 discounts, dividends (Art. 242), holdings (CHC)
- Entry point: `POST /api/tax-planning` with SSE streaming. `maxDuration: 300s`

**7. Transfer Pricing Pipeline** (`src/lib/agents/financial/transfer-pricing/orchestrator.ts`)
- Three agents run **sequentially**: TP Analyst → Comparable Analysis → Documentation Writer
- Covers: Arts. 260-1 to 260-11 ET, Decreto 2120/2017, 6 methods (PC/PR/CN/PD/ML/MUT), Formato 1125 DIAN
- Entry point: `POST /api/transfer-pricing` with SSE streaming. `maxDuration: 300s`

**8. Business Valuation Pipeline** (`src/lib/agents/financial/valuation/orchestrator.ts`)
- **Hybrid**: DCF Modeler + Market Comparables run **in parallel** → Valuation Synthesizer **sequential**
- Covers: NIIF 13, NIC 36, Art. 90 ET, TES/EMBI/WACC colombiano, SuperSociedades guidelines
- Entry point: `POST /api/business-valuation` with SSE streaming. `maxDuration: 300s`

**9. Fiscal Audit Opinion Pipeline** (`src/lib/agents/financial/fiscal-opinion/orchestrator.ts`)
- **Hybrid**: Going Concern + Material Misstatement + Compliance run **in parallel** → Opinion Drafter **sequential**
- Covers: NIA 200-706, Ley 43/1990, Art. 207-209 C.Co., Ley 222/1995, dictamen formal colombiano
- Entry point: `POST /api/fiscal-audit-opinion` with SSE streaming. `maxDuration: 300s`

**10. Tax Reconciliation Pipeline** (`src/lib/agents/financial/tax-reconciliation/orchestrator.ts`)
- Two agents run **sequentially**: Difference Identifier → Deferred Tax Calculator
- Covers: Art. 772-1 ET, Formato 2516 DIAN, NIC 12, Decreto 2235/2017, 35% tax rate
- Entry point: `POST /api/tax-reconciliation` with SSE streaming. `maxDuration: 300s`

**11. Feasibility Study Pipeline** (`src/lib/agents/financial/feasibility/orchestrator.ts`)
- Three agents run **sequentially**: Market Analyst → Financial Modeler → Risk Assessor
- Covers: DNP methodology, Ley 2069/2020, WACC colombiano, ZOMAC/ZF incentives, MIPYME classification
- Entry point: `POST /api/feasibility-study` with SSE streaming. `maxDuration: 300s`

**4. Preprocessing + Export** (deterministic, no LLM)
- `src/lib/preprocessing/trial-balance.ts`: parses CSV/Excel trial balances, filters auxiliaries, sums by PUC class, detects discrepancies (e.g. missing accounts like 1120 Ahorros), validates patrimonial equation. Outputs clean data + validation report for agents
- `src/lib/export/excel-export.ts`: generates multi-tab .xlsx (Balance, P&L, KPIs, Validation, Summary) using ExcelJS with corporate formatting
- `POST /api/financial-report/export`: full pipeline (preprocess → 3 agents → Excel) or export-only mode. Returns downloadable .xlsx
- The upload route (`/api/upload`) auto-detects trial balance CSVs and prepends a validation report to the extracted text

### Tool System

Tools are defined in `src/lib/agents/tools/registry.ts` using the AI SDK v6 `tool({ description, inputSchema: z.object(...) })` helper and implemented in `src/lib/tools/`. Each specialist agent gets a subset via `getToolsForAgent(name)` which returns a `Record<string, Tool>` (map keyed by tool name). Available tools: `search_docs`, `search_web`, `calculate_sanction`, `analyze_document`, `draft_dian_response`, `assess_risk`, `get_tax_calendar`.

**Important design choice** — tools in the registry have NO `execute` function. `generateText` / `streamText` return `toolCalls` without auto-invoking them. The manual loop in `BaseSpecialist.execute()` (`src/lib/agents/specialists/base-agent.ts`, `MAX_TOOL_ROUNDS = 6`) dispatches each call via `executeTool(name, args, ctx)` so the per-call `ToolExecContext` (documents, ERP connections, etc.) gets injected correctly. This is a zero-regression port of the pre-AI-SDK tool loop.

### RAG Pipeline

- Vector store: HNSWLib-node (primary) with MemoryVectorStore fallback for Vercel
- Embeddings: `text-embedding-3-small` via `@langchain/openai` (NOT through the Gateway — LangChain's own client, uses `OPENAI_API_KEY` directly)
- Source documents: `src/data/tax_docs/*.md` (Colombian tax law, DIAN doctrine, NIIF standards)
- Ingestion: `src/lib/rag/ingest.ts` with RecursiveCharacterTextSplitter (1000 chars, 250 overlap)
- Document upload: `POST /api/upload` handles PDF, DOCX, XLSX, CSV, images. OCR is `generateText` with `{ type: 'image', image: dataUrl }` (images) or `{ type: 'file', data: buffer, mediaType: 'application/pdf' }` (scanned PDFs) against `MODELS.OCR`

### Security Layer

- `src/proxy.ts` (Next 16, formerly `src/middleware.ts`): rate limiting (workspace-id-or-IP keyed; Vercel WAF first via `@vercel/firewall`, in-memory backstop), fail-closed CSRF origin check on POST/PUT/PATCH/DELETE (with `/api/cron/*` allowlist), security headers. Only applies to `/api/*`. The list of WAF `rateLimitId`s to configure in the Vercel dashboard lives in `docs/PLATFORM_MIGRATION.md`.
- `src/lib/security/pii-filter.ts`: redacts NIT, cédula, emails, phones, cards before LLM calls. Extracts NIT context (last digit) BEFORE redacting for personalization
- `next.config.ts`: CSP headers restricting connections to OpenAI + Tavily APIs
- `src/lib/validation/schemas.ts`: Zod schemas for all API request validation

### State Management

- **Server (MVP, no auth)**: Neon Postgres via Vercel Marketplace, accessed through Drizzle ORM (`drizzle-orm/neon-http`). Schema in `src/lib/db/schema.ts` (4 tables: `workspaces`, `erp_credentials`, `reports`, `alert_thresholds`). Lazy `getDb()` in `src/lib/db/client.ts` (no Proxy — breaks adapters that introspect methods). Tenant identification is anonymous via httpOnly cookie `utopia_workspace_id` set by `getOrCreateWorkspace()` in `src/lib/db/workspace.ts`. Migrations run with `npm run db:push` (uses `dotenv-cli` to load `.env.local` since drizzle-kit doesn't auto-load it).
- **Server (legacy, in-flight)**: agent orchestrators are still stateless per request. Conversation history, intake drafts, and ERP credentials live client-side and will migrate to DB incrementally.
- **Client**: `WorkspaceContext` (active case, use case, documents, risk), `LanguageContext` (es/en), conversation history in localStorage. Intake drafts via `useIntakePersistence` (debounce 500 ms — see also `feedback_intake_guard_ref.md` memory).
- SSE progress events flow from orchestrator → API route → ChatThread.tsx for real-time status indicators
- **Adding auth later**: add a `users` table + `workspace_members` join table; the cookie-based workspace flow continues to work for anonymous sessions and gets migrated on first login.

## Conventions

- All user-facing text supports Spanish (primary) and English via `src/lib/i18n/dictionaries.ts`
- System prompts are in `src/lib/agents/prompts/*.prompt.ts` — each exports a builder function that takes language, use case, and NIT context
- Colombian tax specifics: UVT 2026 = $52,374 COP, peso formatting with dot thousands separator ($1.234.567,89)
- Anti-hallucination rules are embedded in every specialist prompt — agents must only cite sources found in search results
- New specialist agents extend `BaseSpecialist`, get a prompt file, and register in `SPECIALISTS` map in `orchestrator.ts` + `AGENT_TOOLS` map in `registry.ts`
- New financial pipeline agents are standalone functions in `src/lib/agents/financial/agents/`, wired in `src/lib/agents/financial/orchestrator.ts`
- New audit agents follow the same pattern in `src/lib/agents/financial/audit/agents/`, wired in the audit orchestrator. Each auditor outputs structured JSON findings parsed by `parseAuditorOutput()`

## Layout Gotchas

- **Lenis smooth scroll is global.** `src/app/layout.tsx` wraps the whole app with `<SmoothScroll>` → `ReactLenis root`. Lenis hijacks wheel events at the document level to drive smooth scrolling. Any subtree that relies on internal `overflow-y-auto` containers (e.g. the workspace shell `src/app/workspace/layout.tsx`, fullscreen modals) **must** carry `data-lenis-prevent` on an ancestor or wheel events never reach the scrollable child and mouse-wheel scroll dies silently. The workspace shell root `<div>` already has it — preserve it when editing that layout.
- Do not diagnose dead-wheel-scroll bugs by blaming `overflow-hidden`. `overflow-hidden` does not intercept wheel events; Lenis does. Check `data-lenis-prevent` placement first.
