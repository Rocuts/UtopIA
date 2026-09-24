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

#### Server-side report provenance (`src/lib/reports/`)

The last step of the split pipeline, `POST /api/financial-report/consolidate`, receives the three parts (`reportParts`), re-derives the trial balance from `rawData` (with the confirmed Doctor de Datos ledger), assembles the final report (the verdicts of the three Partes recomputed against the re-derived balance in `src/lib/reports/part-verdicts.ts` —Parte I JSON invariants, the minutes' deterministic arithmetic, figures quoted in the prose of notes and minutes, and Parte II anchors plus prose; the server verdict can only tighten the one received—, the Markdown of each Parte re-rendered from its JSON (see below), qualifications folded, `fiscalSnapshot` and Âncora computed server-side) and stores it as a `reports` row (`kind = 'financial_report'`) of the **session's** workspace (`getCurrentWorkspaceId`; never from the body). The row's `data` jsonb holds the report and the preprocessed balance in canonical JSON, SHA-256 fingerprints of both (`reportHash`, `sourceHash`) and of the received `rawData`, the rules contract (`FINANCIAL_REPORT_CONTRACT_VERSION`) and the preprocessor contract. The response carries `reportRef = {reportId, reportHash}`; the UI keeps it on the report (`serverVersion`) and drops it when the report is edited in the browser.

- `/export` (Excel, PDF), `/html` and `/api/escudo/fiscal-anchor` accept `reportRef` and load **that** version within the session's workspace; figures in the request body are ignored and the same export gate (`financialExportBlockers`, for Excel, PDF and HTML alike) re-runs on that version against the persisted balance (anchors always present). Malformed ref → 400; other workspace or unknown id → the same 404; same id with another hash, or a row whose content no longer matches its fingerprint → 409.
- Artifacts are stamped inside the file (Excel summary block, PDF appendix line, HTML `<meta>` + visible banner) and with `X-Report-Provenance` headers: *procedencia verificada* (version id, fingerprints, contract) or *procedencia no verificada* when there is no persisted version (historical reports, sessions without `DATABASE_URL` or workspace). The unverified path keeps the previous behavior; a client-sent `preprocessed` is always re-derived (from `rawData`, or from its own `rawRows` plus the confirmed ledger) and rejected with 422 if its control totals differ. The same cross-check (`resolveClientPreprocessed`, `src/lib/reports/client-preprocessed.ts`) guards `/strategy`, `/governance`, `/api/financial-quality`, `/api/financial-audit`, `/api/fiscal-audit-opinion`, the `/niif` fallback and the legacy route (422 `PREPROCESSED_MISMATCH`); the UI sends the confirmed `adjustmentLedger` with the adjusted preprocessed, also when resuming a run.
- Without a reference, `/export` and `/html` recompute the same verdicts from the re-derived balance before the gate (`/export` for every path, `/html` via `serverActaVerdict` and the common arithmetic gate); a client `clean: true` never lifts them. By reference, `/export` re-runs them on the persisted version with the current rules.
- Markdown of Partes I–III (I3, `src/lib/reports/part-markdown.ts`). Each Parte's Markdown is a deterministic function of its validated JSON: Parte I `toNiifAnalysisResult` (renderer.ts) plus the analyst seal (`buildQualificationSeal`, pure over the reconciliation), the degraded-pass notice and the `runNiifPhase` integrity seals (JSON validator and cash-flow invariants, recomputed with the same functions); Parte II `renderStrategicAnalysisResult` over the JSON passed again through the phase's own deterministic post-processor (`postProcessStrategyJson`: liquidity gate and opening cash from the anchors, break-even and margin of safety, scenario reconciliation, trends from both periods, N/D or recomputed KPIs; idempotent over what the phase published, so a JSON altered in those derived figures does not print them and the version carries the derived JSON) plus the seal and verification note of `qualifyStrategyResult`; Parte III `renderGovernanceResult` with the minutes' arithmetic plus the arithmetic and prose seals of `runGovernancePhase`. That Markdown is what the PDF prints (notes, minutes, recommendations, break-even, projections) and what the Excel prints (Parte II, Summary tab = consolidated report). `withServerRenderedParts` computes the server verdicts (`applyServerPartVerdicts`, which now also recomputes the Parte I JSON invariants) and **re-renders** every Parte from its JSON with the seals of those verdicts; the Markdown received from the browser is discarded. `/consolidate` does this before building the consolidated report, running its text gates (V8/V9/V10/V15) and persisting. `/export` does it by reference (`withServerRenderedPersisted`; a version persisted before I3 may hold browser text: only the Partes segment of its server-built consolidated report is replaced, from `# PARTE I` to the legal note, and the text gate of `/consolidate` is recomputed over it, since such a version may have passed V10/V15 with the browser's text) and without reference (the consolidated report is rebuilt with `consolidateSplitReport`, keeping the BORRADOR notice if the received one had it, and the adjustments trail is computed from the request ledger; the post-render validation and the text-dependent blockers of that same gate (V8/V9/V10/V15; since I5 every blocker of the gate, see below) are folded over the received ones with `foldServerEmittability`, so a clean emittability declared for another text does not lift them, and each Parte keeps only its known keys). The full-pipeline `/export` path produces its own Markdown and is not re-rendered. `/html` consumes only the three JSON, never the Markdown; by reference it applies the same `withServerRenderedPersisted` recomputation as `/export` before its gate and before building the Editor Jefe input. For an honest report the re-render equals the phases' text byte for byte (parity test with the real `/niif`, `/strategy`, `/governance` routes in `markdown-procedencia.route.test.ts`, clean and sealed). A Parte II/III whose JSON is missing or fails its contract is sealed (its text, if any, is replaced by the seal; an empty Parte stays empty and the gate reports it incomplete). Contract `informe-niif-2026-09-24.2` (`.3` since I5). Known limits: the Parte I issuance-gate seal (pre-flight, V3/V15, period) is not reproduced in the Markdown (its reasons remain in `emittability`/`validation` and the reconciliation stays `clean: false`); the "scenario summary differed from its table" note of Parte II is not reproduced (the JSON already carries the table figure); the `degraded` flag of Partes II/III is taken from the client (it only adds a notice) and Parte I degraded passes are limited to the analyst's labels.
- I5 (server remnants, contract `informe-niif-2026-09-24.3`):
  - Partes IV/V audit the server's text: `/api/financial-audit`, `/api/financial-quality` and `/api/fiscal-audit-opinion` pass their LLMs the consolidated report rebuilt from the Partes' JSON (`resolveAuditedReport` → `withServerRenderedClientReport`, with the re-derived preprocessed balance and the request ledger's adjustments trail), and derive the Parte IV integrity from it. A report without Partes I–III gets 422 `REPORT_PARTS_REQUIRED`. The Parte IV `auditReport` forwarded to Parte V and to the dictamen is still client text (LLM output with no JSON to re-render).
  - Identity of Partes II/III: `serverPartChecks` compares name, NIT and period of each Parte's JSON with the statements (NIIF JSON; without it `report.company`). Name without accents, case, punctuation or spaces; NIT by digits, allowing the check digit on one side. A mismatch makes the Parte `clean: false` and the re-render prints "PARTE II/III CON SALVEDADES — IDENTIDAD".
  - Parte I prose: `checkNiifNarrative` (validators/narrative-anchors.ts) cross-checks the anchored concepts (net income/loss, cash, equity, assets, liabilities, revenue) quoted in the statement notes, the cash-flow method note and the technical notes, with the Partes II/III prose rules; cash and equity also accept the balances printed by the report's own cash-flow and equity statements, including the comparative ones (with three cuts, the opening of the comparative period is the cut before it). `runNiifPhase` and `serverNiifIntegrity` use the same sources (parity) and seal with "REPORTE CON SALVEDADES — CIFRAS EN NOTAS SIN RESPALDO".
  - `/export` without reference folds every blocker of the recomputed gate (V1–V15; V5/V6 only when the request carries `rawData`), recomputes `fiscalSnapshot` and Âncora with `deriveReportSidecars` (the function `/niif` and `/consolidate` use) instead of forwarding the body's, and replaces an invalid or future `generatedAt`.
  - The provenance stamp names the contract the version was persisted under and the one it was re-rendered with (Excel, PDF, HTML, `X-Report-Contract` / `X-Report-Rendered-Contract`).
  - UI: a resume takes `provisional`, instructions and excluded facts from the checkpoint (`resolveRunOptions`, persisted with the checkpoint ledger record); the Doctor de Datos accumulates the confirmed ledger across sessions (`mergeConfirmedAdjustments`) and seeds a new session with the adjustments the run already applied.
- Draft override (pipeline-flujo-21): `/consolidate` reads `provisional` (same schema as `/niif`) and `consolidateSplitReport` prepends the BORRADOR header to the consolidated report, so the persisted version, the PDF watermark and the provenance stamp (*procedencia verificada — BORRADOR*, header `X-Report-Draft: true`) all say draft. It lifts no gate, and the Stage 0 balance gate still rejects an unbalanced trial balance with or without the override.
- `unitMultiplier` / `maturityOverrides` sent as body fields to `/niif` are accepted with the same contract by `/consolidate` and `/export` (`src/lib/reports/ingest-confirmations.ts`), so re-deriving the balance from the original `rawData` does not drop the confirmed unit or the declared maturities.
- `/api/escudo/fiscal-anchor` only persists the snapshot and Âncora of a persisted version (`reportRef` required).
- Limits: the audit (Parte IV) and quality (Parte V) results are not part of the persisted version, so the PDF still omits client-sent ones; tenant isolation relies on the existing workspace resolution (session or anonymous cookie).

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

## Public client API (`/api/v1`)

B2B server-to-server surface (ERPs/integrators push PUC trial balances, get the
deterministic NIIF validation back; signed webhooks notify them). Everything flows through
`withApiV1` (`src/lib/api/handler.ts`): pepper fail-closed → Bearer `utop_sk_*` (CRC32
checksum offline, HMAC-pepper lookup) → scopes → per-key quota → body caps → Zod →
`Idempotency-Key` → RFC 9457 `problem+json` on every error. Tables in
`src/lib/db/schema-api.ts` (migration `0021`); webhook delivery is a durable Workflow DevKit
workflow (`src/lib/workflows/webhook-delivery/`, Svix retry schedule). `proxy.ts` exempts
`/api/v1/` from the CSRF/origin gate and the BetterAuth cookie gate (it carries its own
auth) but keeps the IP rate-limit backstop. OpenAPI 3.1.2 is generated from the same Zod
schemas (`/api/v1/openapi.json`; `openapi.test.ts` enforces route↔contract sync). Ops guide:
`docs/API_CLIENTES.md`; authoritative design spec: `docs/spec/api-clientes-v1.md`.

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
