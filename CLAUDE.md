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
- `OPENAI_MODEL_OCR` (default `gpt-5.4-mini`) — PDF/image OCR. Por preferencia del usuario, `gpt-5.4-mini` con `reasoningEffort: 'low'` y `MAX_OUTPUT_TOKENS: 16000` da precisión suficiente para cuadernos manuscritos y balances PDF a 5x menos costo que el full. Override a `gpt-5.4` (full) si una empresa lo requiere.
- `OPENAI_MODEL_OCR_LIGHT` (default `gpt-5.4-mini`) — alias retrocompatible (mismo modelo); slot reservado por si en el futuro se diferencia (ej. nano para tirillas simples).
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
- `src/lib/security/vault.ts`: AES-256-GCM Node-side encryption for ERP credentials (`encrypted_secret` column on `erp_credentials`). Wire format `v1:gcm:<iv>:<tag>:<ct>` with base64url segments. Distinct from `encryption.ts` (pgcrypto for column-level PII). Key from `UTOPIA_VAULT_KEY`; rotation via `UTOPIA_VAULT_KEY_PREV` + `npm run db:encrypt-erp -- --rotate`. See `docs/SECURITY_ENCRYPTION.md`.

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

## Visual Token Polarity (mandatory)

UtopIA uses an **adaptive `n-0..n-1000` scale** that inverts by mode (light/dark). This makes the same class produce inverse colors in each mode — which is what enables a single component to look correct in both. The rule for picking a tint is **what role the text plays**, not what color you want it to be.

### Tint hierarchy — never violate

| Role | Token | When to use |
|---|---|---|
| Primary ink (reading, headings, KPI values, modal body) | `text-n-1000` | Default for any text the user must read |
| Secondary ink (descriptions, helper text, button labels in glass surfaces, "X" close icons that must be visible on hover) | `text-n-700` / `text-n-800` | Body copy on glass, secondary action labels |
| Tertiary / decorative | `text-n-500` / `text-n-600` | Eyebrow uppercase labels, neutral state indicators (`flat`, "no data"), separators, icons adjacent to a labeled text |
| Forbidden as readable ink | `text-n-100` / `text-n-200` / `text-n-300` / `text-n-400` | These tokens are surface/border level — they collapse against `n-0/n-50/glass-elite-elevated` to <2:1 in light mode |

### Hard rules

1. **Never use `text-n-100..n-400` as the tint of text the user must read or click.** They are reserved for: borders (`border-n-200/300`), surfaces (`bg-n-100/200`), placeholders (`placeholder:text-n-400`), and disabled states **with a non-text affordance** (icon + opacity).
2. **Disabled buttons** must use `disabled:text-n-600` minimum (not `n-400`) — WCAG AA disabled threshold is 3:1, `n-400` on `n-0` is below.
3. **Hover states must not invert polarity.** A button with `text-n-700` hover-ing to `text-n-100` becomes invisible in light mode (the GlassModal X-close bug). Hover should darken/intensify, not fade: `text-n-700 hover:text-n-1000` is canonical.
4. **`ring-offset-*` follows surface, not mode.** Inside a light modal use `ring-offset-n-0`, not `ring-offset-n-900`.
5. **Eyebrows / decorative-only text** (uppercase tracking-eyebrow font-mono labels, separators like `|`, neutral state pills) MAY use `n-500/n-600` because the form already signals "this is metadata, not content."

### When you find a violation

Apply the minimum-blast-radius fix: change the tint, don't restructure the component. If the bug appears in a shared primitive (`Button`, `GlassModal`, `IntakeModal`), fix it once at the primitive — the cascade is the win.

The `utopia-contrast-auditor` agent enforces these rules. Run it on any "no se ve / fantasma / muy claro / low contrast / WCAG" signal before touching components manually.

## Prompt patterns GPT-5.4 (outcome-first)

The GPT-5.4 family (default for every financial agent) is a reasoning model. OpenAI's official 2026 prompting guide and the AI SDK v6 docs prescribe a very different prompt shape than what worked on gpt-4o. Older prompts that were procedural (`Paso 1 …  Paso 2 …`), heavy on `ALWAYS / NEVER / MUST`, and embedded the output schema in prose **degrade quality on GPT-5.4** — they induce tool-call repetition, endless planning, and high output variance. Follow the rules below for every new or refactored financial prompt.

### Canonical prompt shape (CTCO + XML)

```
[stable header — composes well with the prompt cache]
  - Anti-hallucination guardrail
  - Colombia 2026 normative context

<task>{one-line outcome statement}</task>

<context>
  {dynamic per-request payload: preprocessed balance, TOTALES VINCULANTES,
   instructions, comparativos}
</context>

<constraints>
  - Reglas duras (safety rails) en ALWAYS/NEVER/MUST.
  - Reglas de juicio en formato `If X then Y otherwise Z`.
</constraints>

<success_criteria>
  - Cuadres invariantes (e.g. Activo = Pasivo + Patrimonio, tolerancia $0).
  - Identidades cruzadas (e.g. EFE cash closing == PUC 11 balance).
</success_criteria>
```

The output **schema is NOT described in prose**. It is enforced by `experimental_output: Output.object({ schema })` (Zod) — the runtime helper `callFinancialAgent` (`src/lib/agents/financial/agents/runtime.ts`) wires this for every financial agent.

### Hard rules

1. **No procedural numbering.** Don't write `Paso 1 / Paso 2 / Paso 3` or `R-Élite 1 / R-Élite 2`. Replace with XML tags and `<success_criteria>`. The reasoning model finds a better path when not handcuffed to your prescribed sequence.
2. **Reserve `ALWAYS / NEVER / MUST` for safety rails.** Anti-hallucination (cite or omit), anti-PII (mask NIT, cédula), defensa Art. 647 E.T. — these stay as MUST. Accounting judgment moves to `If X then Y otherwise Z`.
3. **No "be THOROUGH" / "double-check" language.** OpenAI's GPT-5 troubleshooting guide explicitly lists this as counterproductive — it triggers redundant tool calls and tortured outputs.
4. **Cache-friendly layout.** Stable content at the top of the system prompt, dynamic content at the bottom. Maximizes the GPT-5.4 prompt cache (40–80% better hit rate than the legacy layout).
5. **Strict schema, no optional fields.** Zod schemas for `Output.object` use `.nullable()` — never `.optional()` — because OpenAI strict json_schema rejects undefined-or-missing.
6. **`reasoning_effort` is per-slot.** Never default `high` for everything. Use `MODELS_CONFIG` in `src/lib/config/models.ts` — `minimal/low` for routing/OCR, `medium` for financial pipelines and audit, `high` only for strategic dictámenes (tax-optimizer, valuation synth, fiscal opinion).
7. **MoneyCop convention.** Cash amounts travel as strings in centavos (e.g. `"1500000"` = $15.000,00) in every JSON contract. JS `number` overflows above 2^53; `BigInt` doesn't serialize to JSON. Helpers in `src/lib/agents/financial/contracts/money.ts`.

### Runtime contract

Every refactored financial agent calls `callFinancialAgent({ agentName, model, schema, system, userContent, ...MODELS_CONFIG[slot] })`. It returns `{ json, meta }` where `json` is the Zod-validated output and `meta` exposes reasoning/cache telemetry. Downstream renderers that still need Markdown (PDF Élite, Excel) consume a deterministic JSON → Markdown adapter — the LLM never composes Markdown directly.

### Migration checkpoints

The refactor is tracked on `feat/prompts-gpt54-refactor`. Until that branch lands, the old `*.prompt.ts` builders coexist with the new contract — agents flip one at a time. When a financial agent file imports `callFinancialAgent`, it is on the new pattern; when it still calls `generateText` directly, it is legacy and pending.

## Telemetry & Observability (Financial Pipelines)

Each call to `callFinancialAgent` returns a `meta` object with `inputTokens`, `outputTokens`, `reasoningTokens`, `cachedInputTokens`, `elapsedMs`, `fallbackUsed`, `firstPassReasoningTokens`, `firstPassFinishReason`. To persist this telemetry to Postgres (`agent_telemetry` table), pass the optional `onTelemetry` callback:

```ts
import { callFinancialAgent } from '../agents/runtime';
import { persistAgentTelemetry } from '@/lib/db/telemetry';
import { MODEL_IDS } from '@/lib/config/models';

const { json, meta } = await callFinancialAgent({
  // ...existing options...
  onTelemetry: (m) => {
    void persistAgentTelemetry({
      workspaceId,                          // del cookie httpOnly utopia_workspace_id
      reportId: reportRowId ?? null,        // si el orchestrator ya creó la row
      agentName: m.agentName,
      modelId: MODEL_IDS.FINANCIAL_PIPELINE_PREMIUM, // o el que corresponda
      inputTokens: m.inputTokens ?? null,
      outputTokens: m.outputTokens ?? null,
      reasoningTokens: m.reasoningTokens ?? null,
      cachedInputTokens: m.cachedInputTokens ?? null,
      elapsedMs: m.elapsedMs,
      finishReason: m.finishReason,
      fallbackUsed: m.fallbackUsed,
      firstPassReasoningTokens: m.firstPassReasoningTokens ?? null,
      firstPassFinishReason: m.firstPassFinishReason ?? null,
    });
  },
});
```

El callback es fire-and-forget: errores de DB se loggean pero no rompen el pipeline. Para activar telemetría en un nuevo agent, propagar `workspaceId` (y opcionalmente `reportId`) desde el route handler a través del orchestrator. Helpers: `src/lib/db/telemetry.ts` (insert) y `src/lib/db/telemetry-pricing.ts` (cálculo de costo en micros USD con pricing oficial OpenAI 2026-05-12).

Para inspeccionar la telemetría agregada (últimas 24h por default, `?hours=N` para extender):

```bash
curl -H "x-admin-token: $UTOPIA_ADMIN_TOKEN" https://utopia.example.com/api/admin/telemetry
```

Devuelve totales (calls, costo USD, fallback rate, unclean finish rate), `perAgent` desglose y `alerts` activadas según los thresholds del audit team: fallback >3% → P1, finishReason!=stop >1% → P0, costo diario >$50 → P1. Requiere `UTOPIA_ADMIN_TOKEN` env var; sin ella, el endpoint responde 503 (fail-closed).

## Chunked NIIF Analyst — 3 sequential passes (Fase 3 DONE 2026-05-12)

The NIIF Analyst (`src/lib/agents/financial/agents/niif-analyst.ts`) ejecuta 3 `callFinancialAgent` secuenciales contra `MODELS.FINANCIAL_PIPELINE` (gpt-5.4-mini) en lugar de UNA llamada a `FINANCIAL_PIPELINE_PREMIUM` (gpt-5.5). El bug `finish_reason=length` que el blindaje gpt-5.5 mitigaba se vuelve estructuralmente imposible — cada pass tiene su propio reasoning budget contra un sub-schema más pequeño.

**Arquitectura (no tocar sin entender por qué cada pieza está donde está):**

```
Pass 1 — niif-analyst-pass1 (slot niifAnalystPass1, 16K maxOutputTokens, medium)
  Schema: BalanceAndPnlSubSchema
    - company, balanceSheet, incomeStatement, curatorFlags
  System prompt: buildNiifAnalystPass1Prompt(company, language, preprocessed, elite)
  Output: BalanceAndPnlSubJson

Pass 2 — niif-analyst-pass2 (slot niifAnalystPass2, 12K, medium)
  Schema: CashFlowAndEquitySubSchema
    - cashFlow (3 secciones + closure), equityChanges (rows + notes)
  System prompt: buildNiifAnalystPass2Prompt(company, lang, pass1Anchors, preprocessed, elite)
    - <previously_computed> con: totalAssetsPrimary, totalLiabilitiesPrimary,
      totalEquityPrimary, netIncomePrimary, oriPrimary, curatorFlags
  Output: CashFlowAndEquitySubJson

Pass 3 — niif-analyst-pass3 (slot niifAnalystPass3, 12K, medium)
  Schema: TechnicalNotesSubSchema
    - technicalNotes (incluye sub-notas Defensa Art. 647 E.T.)
  System prompt: buildNiifAnalystPass3Prompt(company, lang, pass1Anchors, pass2Anchors, preprocessed, elite)
    - <previously_computed> con anchors de Pass-1 + Pass-2 (cashClosing, ecpClosingTotal)
  Output: TechnicalNotesSubJson

Ensamblaje (pura función determinística, sin LLM):
  assembled = assembleNiifReport(pass1.json, pass2.json, pass3.json)
  parsed = NiifReportSchema.safeParse(assembled)  // red de seguridad estructural
  result = toNiifAnalysisResult(parsed.data)       // adapter → NiifAnalysisResult legacy
```

**Por qué dividir el schema en este eje específico:**

- Pass 1 es el "backbone numérico": Balance + P&L comparten la identidad `netIncome → resultadoEjercicio del ECP`. Dejarlos juntos enforza el bridge automáticamente y produce los anchors que Pass-2 necesita (`totalEquityPrimary`, `cashClosing implícito en PUC 11`). `curatorFlags` viven con los anchors porque son ecos deterministas del orchestrator.
- Pass 2 es el "estados derivados": EFE y ECP dependen ambos de cifras de Pass-1 (`cashClosing ≡ PUC 11 balance`, `ECP saldo final ≡ totalEquity`). Mantenerlos juntos en un mismo pass es coherente con la coherencia cruzada del flujo y patrimonio (cierre del ECP usa la utilidad ya anclada en Pass-1).
- Pass 3 es la "narrativa técnica" — sólo notas. Recibe anchors de los 2 passes anteriores y sus activadores Élite filtrados. No produce cifras nuevas, sólo cita las ya emitidas.

**Cumplimiento normativo (NIC 1 §10 / NIIF for SMEs §3.17):**

La normativa exige presentar un "conjunto completo de Estados Financieros" — eso es un requisito de **presentación**, no de generación. El output reensamblado (`NiifReportSchema.parse(assembled)`) cumple §3.17 byte-a-byte como cumplía antes; sólo se chunkó la generación interna. La validación post-ensamblaje (`validateNiifReportJson`, Capa 1 Elite Protocol) verifica los invariantes (Activo = Pasivo + Patrimonio, EFE = PUC 11, ECP saldo final = totalEquity, todos a $0 centavos).

**Telemetría — ahora 3 entradas por reporte:**

El bus `agent_telemetry` (ver sección "Telemetry & Observability" arriba) ya no recibe UN evento por reporte; recibe **tres**, una por pass:
- `agentName: 'niif-analyst-pass1'` con `modelId: gpt-5.4-mini` (no gpt-5.5)
- `agentName: 'niif-analyst-pass2'`
- `agentName: 'niif-analyst-pass3'`

Cuando consultes `/api/admin/telemetry?hours=N`, `perAgent.niif-analyst*` desglosa los tres. El costo agregado por reporte debe ser ~4-5x menor que el legado gpt-5.5 (input ligeramente sube por la triple re-emisión del system prompt; mitigado por `cachedInputTokens`).

**Diagnóstico de fallos por pass:**

Si Pass-N falla, el error se propaga con mensaje `"runNiifAnalyst: Pass N (descripción) falló — <causa>"` + el `cause` original preservado. NO es genérico. Cada pass se aísla.

**Reversibilidad:**

Un sólo `git revert` del commit final (Fase F) restaura el comportamiento monolítico premium. Los commits incrementales (B1, B2, C, D, E1, E2) se diseñaron para ser revertibles individualmente sin tocar otros — cada uno toca un archivo distinto. El slot legacy `niifAnalyst` (32K, premium) se conservó como `@deprecated` en `MODELS_CONFIG` por si se necesita revertir rápido sin re-introducirlo.

**Lo que NO cambió (contract con consumers downstream):**

- `runNiifAnalyst()` signature pública.
- `toNiifAnalysisResult()` adapter.
- PDF Élite + Excel — siguen leyendo el `NiifReportJson` ensamblado.
- `validateNiifReportJson` — Capa 1 Elite Protocol intacta.
- Strategy Director + Governance Specialist — siguen consumiendo `niifOutput.fullContent` (Markdown legacy). Su chunking es Fase 4 (no se incluyó aquí; el cuello de botella era niif-analyst).

**Cuando rompa en producción (runbook):**

1. Mira `/api/admin/telemetry?hours=24` — busca `perAgent.niif-analyst-passN.unclean_finish_rate` > 0.
2. Si Pass-1 rompe → puede que el schema esté demasiado denso para 16K; sube a 20K en `MODELS_CONFIG.niifAnalystPass1`.
3. Si Pass-2 rompe → probablemente el ECP/EFE de un fixture exótico desborda 12K; sube a 16K.
4. Si Pass-3 rompe → notas Art. 647 E.T. demasiado largas; sube a 16K.
5. Si el assembled falla `NiifReportSchema.safeParse(...)` post-ensamblaje (raro, estructuralmente impossible si los sub-schemas pasaron) → bug en `assembleNiifReport`; corre `npx vitest run src/lib/agents/financial/__tests__/assemble-niif-report.test.ts` para localizar.
6. Cualquier regresión grave: `git revert <hash final Fase F>` y redeploy.

## Spec v2.0 — 1+1 Financial Pipeline (Wave 2 DONE 2026-05-12)

La especificación normativa del pipeline financiero 1+1 vive en **`docs/spec/financial-pipeline-v2.md`**. Cuando un prompt o regla determinista entre en conflicto con ese documento, el documento gana. Cita por número de Parte/Sección en commits y PRs.

**Componentes implementados (Wave 2 — 7 commits sobre `5e903e6`):**

### Reglas anti-bug críticas

- **Anti-duplicación Grupo 53** (Parte 1.3 + 8.1 CHECK 4): defensa triple en (a) prompt Pass-1 (`niif-analyst.prompt.ts` constraint + success_criteria), (b) preprocessor (`controlTotals.gastos` consolida correctamente), (c) validator E8 (`niif-json-validator.ts`). Si el LLM lista `Grupo 53 total` + subcuentas `5305/5395` como líneas independientes sumadas, E8 lo detecta y rechaza el reporte (caso histórico: $30.262.041 duplicados).
- **Tabla 8 anomalías** (Parte 5): anomalías 1-5 cubiertas por el curator existente (R1, R4, R7). Anomalías 6/7/8 nuevas: `r17-supplier-debit-balance.ts` (Cta 22 > 0), `r18-equity-negative.ts` (patrimonio neto < 0 — NIC 1 §25 / Art. 459 C.Co.), `r19-net-margin-over-70.ts` (utilidad neta / ingresos > 70% — NIA 240).
- **Cascada impuestos** (Parte 4.1): Pass-1 prompt cubre los 3 casos — Clase 54 → Cta 1805 → 35% teórico con nota provisión pendiente.

### KPIs deterministas (single source of truth)

El preprocessor (`trial-balance.ts`) ahora deriva 14 KPIs cardinales en `controlTotals` como strings decimales, emitidos en `bindingTotalsBlock` con autoridad vinculante: `razonCorriente`, `pruebaAcida`, `endeudamientoTotal`, `apalancamientoFinanc`, `coberturaIntereses`, `margenOperativo`, `margenNeto`, `roe`, `roa`, `rotacionActivos`, `diasCartera`, `diasInventario`, `diasProveedores`, `ebit`. Cuando el denominador es anómalo (< 1% ingresos para inventario/proveedores), el ratio es `null` y se renderiza como `"ND"` con diagnóstico explícito (NIA 240).

**Strategy Director consume estos pre-calculados como ancla** (con fallback defensivo). Idem PDF Élite `compose.ts:buildDialGauges` — los bugs P0 históricos (Prueba Ácida hardcoded inventario=0, Cobertura Intereses hardcoded 0) están eliminados: ahora consumen `controlTotals.{pruebaAcida|coberturaIntereses}` reales.

`KpiSchema.resultPrimary` admite `z.literal('ND')` para marcar KPIs no confiables sin romper el contrato.

### Devoluciones 4175 (Parte 1.3)

`controlTotals` ahora expone tanto `ingresos` (bruto Clase 4) como `ingresosNetos = |Σ 41xx| − |Σ 4175xx|` y `totalDevoluciones`. `bindingTotalsBlock` emite ambas con etiqueta `NIIF 15 §47`. El LLM ya no puede confundirse re-aplicando la resta.

### Decision tree 3605 (Parte 3)

`PeriodSnapshot.periodoTipo: 'cerrado' | 'parcial' | 'indeterminado'` se infiere del header del balance (Ene-Dic = cerrado; cualquier rango parcial = parcial; sin info = indeterminado). R8 (`r8-virtual-close.ts`) bifurca el texto de su finding:
- `cerrado`: "NOTA OBLIGATORIA — el contador DEBE corregir el asiento antes de firmar..."
- `parcial`: "NOTA EXPLICATIVA — corte intermedio del año fiscal; práctica habitual..."

### Validators (Capa 1 Elite Protocol extendida)

`niif-json-validator.ts` ahora tiene 8 checks E1..E8:
- E1..E6: invariantes existentes (A=P+C, EFE cierre, ECP saldo, etc.).
- **E7 (nuevo)**: Variación `resultadoEjercicio` en ECP == `incomeStatement.netIncomePrimary` (tolerancia 0.5%).
- **E8 (nuevo)**: Σ líneas `incomeStatement.lines` con `account.startsWith('5')` ≤ `controlTotals.gastos` + 1% tolerance (anti-dup Grupo 53).

### Governance Specialist v2.0

`GovernanceReportSchema` extendido con:
- `complianceChecklist: z.array(ComplianceChecklistItemSchema).min(8)` — el "Checklist de cumplimiento normativo" del spec Parte III §3 (antes ausente por completo).
- `disclaimers: z.array(DisclaimerSchema)` con `code: enum` de 6 valores literales del spec Parte 9 (`laboral_sin_detalle`, `costo_insuficiente`, `impuesto_no_reconciliable`, `sin_comparativo`, `ajuste_3605`, `inversiones_negativas`).
- `FinancialNoteNumberSchema` ampliado a 1..16: Nota 15 "Partes Vinculadas" (NIC 24) + Nota 16 "Autorización para la Publicación" (NIC 10 §17).
- `ShareholderMinutesSchema.convocationStatement` — declaración Art. 424 C.Co.
- Orden del día canónico incluye "Aprobación de la gestión de los administradores" (Art. 187 §3 Ley 222/1995) y "Designación o ratificación de cargos" (Art. 187 §4).

**Detector regex anti-evasivo refactorizado**: usa look-ahead negativos para discriminar frases evasivas genéricas (bloquear) de disclaimers normados (permitir). Los 6 disclaimers del spec viven en su propio campo `disclaimers[]` y se exceptúan del escaneo por contrato.

### Tests

601 tests verde sobre 59 archivos (vs 544 baseline):
- `niif-json-validator.test.ts`: +9 (E7/E8)
- `wave2-f4.test.ts` + `wave2-f4-binding.test.ts`: +28 (KPIs determinísticos + bindingTotals)
- `spec-v2-integration.test.ts`: +20 (end-to-end por regla del spec)

### Runbook (cuando rompa en producción)

1. `/api/admin/telemetry?hours=24` → buscar pattern de finish_reason no-stop en cualquier pass.
2. Si E8 dispara con frecuencia → el LLM está confundiéndose con bindingTotals; revisar `niif-analyst.prompt.ts` Pass-1 constraint "Anti-duplicación Grupo 53".
3. Si E7 dispara → el ECP del LLM tiene inconsistencia entre `resultadoEjercicio` y la Utilidad Neta del P&L; revisar Pass-2 success_criteria.
4. Si R18 dispara → el balance recibido tiene patrimonio neto < 0 (insolvencia técnica); operativamente esperado, pero el `governance` debe emitir el dictamen "con salvedades" — verificar `governance-specialist.ts:detectForbiddenPhrasesInJson` no esté bloqueando disclaimers válidos.
5. Si la Prueba Ácida o Cobertura Intereses muestran 0 en PDF Élite cuando deberían tener valor → el snapshot recibido es pre-F4 (sin los nuevos campos `inventarios14` / `gastoFinanciero5305`); regenerar reporte con `controlTotals` actuales.
6. Reversibilidad: cada uno de los 7 commits Wave 2 (`b36acb5` F1, `da959bb` F2, `7c88e0f` F3, `74ec5a3` F4, `05c1339` F5, `d69c3ff` F6, `5e903e6` F7) es revertible individualmente sin tocar los demás. F4 es el más impactful — revertir F4 obliga a revertir F6 (depende de los nuevos campos) y los tests F7 que los citan.

## Layout Gotchas

- **Lenis smooth scroll is global.** `src/app/layout.tsx` wraps the whole app with `<SmoothScroll>` → `ReactLenis root`. Lenis hijacks wheel events at the document level to drive smooth scrolling. Any subtree that relies on internal `overflow-y-auto` containers (e.g. the workspace shell `src/app/workspace/layout.tsx`, fullscreen modals) **must** carry `data-lenis-prevent` on an ancestor or wheel events never reach the scrollable child and mouse-wheel scroll dies silently. The workspace shell root `<div>` already has it — preserve it when editing that layout.
- Do not diagnose dead-wheel-scroll bugs by blaming `overflow-hidden`. `overflow-hidden` does not intercept wheel events; Lenis does. Check `data-lenis-prevent` placement first.
