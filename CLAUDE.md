# CLAUDE.md

UtopIA is an AI-powered Colombian accounting, tax, and financial advisory platform. Multi-agent orchestration via **AI SDK v6** + `@ai-sdk/openai` (default `gpt-5.4-mini`), RAG over curated tax docs, real-time web search.

## Commands

```bash
npm run dev               # Next.js dev server (localhost:3000)
npm run build             # Production build (Turbopack)
npm run lint              # ESLint
npm run lint:strict-mode  # Guard: Zod schemas headed to LLM follow strict-mode contract
npm run db:ingest         # Ingest tax documents into HNSWLib vector store
```

No test framework is configured for the chat surface — validate with `npx tsc --noEmit` and `npm run build`. Vitest is wired for the financial pipeline (`npx vitest run`, `npx vitest run --config vitest.integration.config.ts`).

## Environment

Required in `.env.local`:
- `OPENAI_API_KEY` — every LLM call (chat, financial pipelines, OCR, Realtime, embeddings). `@ai-sdk/openai` reads it automatically — **never pass `apiKey` in code**.
- `TAVILY_API_KEY` — web search (`src/lib/search/web-search.ts`).
- `UTOPIA_AGENT_MODE` — `orchestrated` | `legacy`. Controls `/api/chat` handler.

Optional model overrides live in `src/lib/config/models.ts` (`OPENAI_MODEL_CHAT`, `OPENAI_MODEL_FINANCIAL`, `OPENAI_MODEL_OCR`, `OPENAI_MODEL_CLASSIFIER`, `OPENAI_MODEL_EMBEDDINGS`, ...). Change defaults in ONE place. `envModel()` strips legacy `openai/` prefix defensively.

`@/*` resolves to `./src/*` (tsconfig). All imports use this alias.

`process.env.VERCEL` triggers fallback from HNSWLib to MemoryVectorStore in `src/lib/rag/vectorstore.ts` (Vercel filesystem is read-only).

## LLM provider — hard rules

- **Always** receive a `LanguageModel` from `@ai-sdk/openai` (e.g. `MODELS.CHAT === openai('gpt-5.4-mini')`).
- **Never** pass `apiKey`, instantiate the OpenAI SDK directly, or use the legacy `'openai/<model>'` gateway-prefixed string. The Vercel AI Gateway is **not** used (requires CC on file, was failing in production).
- Migration contract: `openai.chat.completions.create` → `generateText` / `streamText`, `max_tokens` → `maxOutputTokens`, `response.choices[0].message.content` → `result.text`. For structured output prefer `experimental_output: Output.object({ schema: zodSchema })`. Canonical example: `src/lib/agents/classifier.ts`. Full contract: `docs/AI_SDK_MIGRATION.md`.
- Realtime voice still uses direct `fetch('https://api.openai.com/v1/realtime/sessions', ...)` — AI SDK doesn't yet expose it.
- RAG embeddings use `@langchain/openai`'s own client with `OPENAI_API_KEY` (separate from AI SDK provider chain). `MODELS.EMBEDDINGS` is exported as a plain string for that consumer.

**Zod strict mode (2026):** schemas that travel to the LLM via `experimental_output` / `generateObject` **must** follow `docs/spec/zod-strict-mode-2026.md`. Short rule: `.nullable()` always — NEVER `.optional()` / `.nullish()` / `.default()` / `.passthrough()` / `z.record()`. CI guard: `npm run lint:strict-mode`.

## Financial pipelines — northstar

**`docs/spec/financial-pipeline-v2.1.md`** is authoritative for the 1+1 financial pipeline (NIIF → Strategy → Governance) **and** for Parte IV (4 dictámenes especializados) + Parte V (Meta-auditoría 12 dims + sello de calidad). When a prompt or rule conflicts with it, the spec wins. Cite by Part/Section in commits and PRs. Wave 7 runbook: [docs/wave-notes/wave-7-parte-iv-v.md](docs/wave-notes/wave-7-parte-iv-v.md).

**`docs/spec/financial-report-v8.1.md`** is authoritative for the Editor Jefe HTML 12-slide output.

Every financial agent calls `callFinancialAgent({ agentName, model, schema, system, userContent, ...MODELS_CONFIG[slot] })` from `src/lib/agents/financial/agents/runtime.ts`. Returns `{ json, meta }` (Zod-validated + reasoning/cache telemetry). When a file calls `generateText` directly it is **legacy / pending migration**.

The pipeline is split across endpoints (`/api/financial-report/{niif,strategy,governance,html}`) with `maxDuration: 800s` each — see [docs/wave-notes/wave-3-split-endpoints.md](docs/wave-notes/wave-3-split-endpoints.md).

## GPT-5.4 prompt pattern (canonical)

GPT-5.4 / 5.5 are reasoning models. Procedural `Paso 1 / Paso 2`-style prompts **degrade quality** (induce tool-call repetition, endless planning, high output variance). Every new or refactored financial prompt uses:

```
[stable header — cache-friendly: anti-hallucination guardrail, Colombia 2026 normative context]

<task>{one-line outcome}</task>
<context>{dynamic per-request payload: preprocessed balance, TOTALES VINCULANTES, instructions}</context>
<constraints>
  - Safety rails in ALWAYS / NEVER / MUST
  - Judgment in `If X then Y otherwise Z`
</constraints>
<success_criteria>{invariants & cross-identities — e.g. Activo = Pasivo + Patrimonio @ tolerancia $0}</success_criteria>
```

Hard rules:
1. **No procedural numbering** (`Paso 1 / Paso 2 / R-Élite N`). Replace with XML tags + `<success_criteria>`.
2. Reserve `ALWAYS / NEVER / MUST` for **safety rails only** (anti-hallucination, anti-PII, defensa Art. 647 E.T.). Accounting judgment goes in `If X then Y otherwise Z`.
3. **No "be THOROUGH" / "double-check" language** — OpenAI's guide explicitly lists this as counterproductive.
4. **Cache-friendly layout**: stable content at the top of the system prompt, dynamic content at the bottom.
5. **Schema is NOT in prose** — enforced by `Output.object({ schema })` (Zod). The `callFinancialAgent` runtime wires this for every financial agent.
6. **`reasoning_effort` is per-slot.** Never default `high` for everything. Use `MODELS_CONFIG` in `src/lib/config/models.ts` — `minimal/low` for routing/OCR, `medium` for financial pipelines and audit, `high` only for strategic dictámenes.
7. **MoneyCop convention.** Cash amounts travel as strings in centavos (e.g. `"1500000"` = $15.000,00). JS `number` overflows above 2^53; `BigInt` doesn't serialize to JSON. Helpers in `src/lib/agents/financial/contracts/money.ts`.

## Visual token polarity (mandatory)

UtopIA uses an adaptive `n-0..n-1000` scale that **inverts by mode** (light/dark). The same class produces inverse colors in each mode. Pick a tint by **role**, not by color.

| Role | Token |
|---|---|
| Primary ink (reading, headings, KPI values, modal body) | `text-n-1000` |
| Secondary ink (descriptions, helper text, glass-surface labels) | `text-n-700` / `text-n-800` |
| Tertiary / decorative (eyebrows, neutral state, separators, icons next to a labeled text) | `text-n-500` / `text-n-600` |
| **Forbidden as readable ink** | `text-n-100` / `n-200` / `n-300` / `n-400` (surface/border level — collapse to <2:1 contrast) |

Hard rules:
1. **Never use `text-n-100..n-400` as the tint of text the user must read or click.** They are reserved for borders (`border-n-200/300`), surfaces (`bg-n-100/200`), placeholders (`placeholder:text-n-400`), and disabled states with a non-text affordance (icon + opacity).
2. **Disabled buttons** → `disabled:text-n-600` minimum (WCAG AA disabled threshold = 3:1).
3. **Hover states must not invert polarity.** A button with `text-n-700` hovering to `text-n-100` becomes invisible in light mode. Hover should darken/intensify: `text-n-700 hover:text-n-1000`.
4. **`ring-offset-*` follows surface, not mode.** Inside a light modal use `ring-offset-n-0`, not `ring-offset-n-900`.
5. Eyebrows / decorative-only text MAY use `n-500/n-600` — the form already signals "metadata, not content."

Run the `utopia-contrast-auditor` agent on any "no se ve / fantasma / muy claro / low contrast / WCAG" signal **before** touching components manually.

## Layout gotcha — Lenis smooth scroll

`src/app/layout.tsx` wraps the app with `<SmoothScroll>` → `ReactLenis root`. Lenis hijacks wheel events at the document level. Any subtree with internal `overflow-y-auto` (workspace shell `src/app/workspace/layout.tsx`, fullscreen modals) **must** carry `data-lenis-prevent` on an ancestor or mouse-wheel scroll dies silently. The workspace shell root `<div>` already has it — preserve it when editing that layout.

**Do not blame `overflow-hidden` for dead-wheel-scroll bugs.** Check `data-lenis-prevent` placement first.

## Conventions

- All user-facing text supports Spanish (primary) and English via `src/lib/i18n/dictionaries.ts`.
- System prompts live in `src/lib/agents/prompts/*.prompt.ts` and `src/lib/agents/financial/prompts/*.prompt.ts` — each is a builder function (language, use case, NIT context).
- Colombian tax constants: UVT 2026 = $52.374 COP. Peso formatting: dot thousands separator, `$1.234.567,89`.
- Anti-hallucination is embedded in every specialist prompt — only cite sources from search results.

## Telemetry

`callFinancialAgent` returns `meta` (input/output/reasoning/cached tokens, elapsed, fallback). Persist via `onTelemetry` callback wiring `persistAgentTelemetry` (`src/lib/db/telemetry.ts`) — fire-and-forget. Aggregated view: `GET /api/admin/telemetry?hours=N` with `UTOPIA_ADMIN_TOKEN`. Alerts: fallback >3% → P1, finishReason!=stop >1% → P0, daily cost >$50 → P1. Full pattern: [docs/TELEMETRY.md](docs/TELEMETRY.md).

## Where to look

| Need | File |
|---|---|
| Pipeline + tools + RAG + security + state architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Authoritative specs (financial pipeline v2.1, report v8.1, zod strict mode) | [docs/spec/](docs/spec/) |
| Wave notes (historical context + per-wave runbooks) | [docs/wave-notes/](docs/wave-notes/) |
| AI SDK v6 migration contract | [docs/AI_SDK_MIGRATION.md](docs/AI_SDK_MIGRATION.md) |
| Telemetry & observability | [docs/TELEMETRY.md](docs/TELEMETRY.md) |
| ERP credential vault (AES-256-GCM) | [docs/SECURITY_ENCRYPTION.md](docs/SECURITY_ENCRYPTION.md) |
| Vercel WAF rate-limit IDs | [docs/PLATFORM_MIGRATION.md](docs/PLATFORM_MIGRATION.md) |
