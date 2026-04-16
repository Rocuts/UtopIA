# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is UtopIA

UtopIA is an AI-powered Colombian accounting, tax, and financial advisory platform. It uses multi-agent orchestration with OpenAI models, RAG over curated tax documents, and real-time web search to deliver professional-grade consulting through a chat interface.

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
- `OPENAI_API_KEY` — used by all LLM calls (chat agents, financial pipeline, OCR, embeddings, voice)
- `TAVILY_API_KEY` — web search via `src/lib/search/web-search.ts`
- `UTOPIA_AGENT_MODE` — `orchestrated` (multi-agent) or `legacy` (monolithic). Controls which handler `/api/chat` uses

`process.env.VERCEL` is checked in `src/lib/rag/vectorstore.ts` to fall back from HNSWLib to MemoryVectorStore on Vercel's read-only filesystem.

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
- Does NOT use `BaseSpecialist` or the tool registry — agents are direct LLM calls with structured prompts
- Uses `gpt-5.4-mini` (400K context) instead of `gpt-4o-mini`
- Entry point: `POST /api/financial-report` with SSE streaming. `maxDuration: 300s`

**3. Audit Pipeline** (`src/lib/agents/financial/audit/orchestrator.ts`) — regulatory validation
- Four auditors run **in parallel** (`Promise.allSettled`): NIIF, Tax, Legal, Fiscal Reviewer
- Validates the output of the Financial Pipeline against Colombian 2026 regulations
- Each auditor produces structured findings (`AuditFinding[]`) with severity, norm reference, recommendation, impact
- The Fiscal Reviewer emits a formal audit opinion (favorable / con_salvedades / desfavorable / abstension)
- Findings are consolidated with a weighted compliance score (NIIF 30%, Tax 25%, Legal 20%, Fiscal 25%)
- Entry point: `POST /api/financial-audit` with SSE streaming. `maxDuration: 300s`

### Tool System

Tools are defined in `src/lib/agents/tools/registry.ts` (OpenAI function-calling format) and implemented in `src/lib/tools/`. Each specialist agent gets a subset via `getToolsForAgent()`. Available tools: `search_docs`, `search_web`, `calculate_sanction`, `analyze_document`, `draft_dian_response`, `assess_risk`, `get_tax_calendar`.

### RAG Pipeline

- Vector store: HNSWLib-node (primary) with MemoryVectorStore fallback for Vercel
- Embeddings: OpenAI `text-embedding-3-small`
- Source documents: `src/data/tax_docs/*.md` (Colombian tax law, DIAN doctrine, NIIF standards)
- Ingestion: `src/lib/rag/ingest.ts` with RecursiveCharacterTextSplitter (1000 chars, 250 overlap)
- Document upload: `POST /api/upload` handles PDF, DOCX, XLSX, CSV, images (OCR via GPT-4o Vision)

### Security Layer

- `src/middleware.ts`: rate limiting (per-IP, per-endpoint), CSRF origin checking, security headers. Only applies to `/api/*` routes
- `src/lib/security/pii-filter.ts`: redacts NIT, cédula, emails, phones, cards before LLM calls. Extracts NIT context (last digit) BEFORE redacting for personalization
- `next.config.ts`: CSP headers restricting connections to OpenAI + Tavily APIs
- `src/lib/validation/schemas.ts`: Zod schemas for all API request validation

### State Management

- **Server**: stateless — no database, no auth. All persistence is client-side
- **Client**: `WorkspaceContext` (active case, use case, documents, risk), `LanguageContext` (es/en), conversation history in localStorage
- SSE progress events flow from orchestrator → API route → ChatThread.tsx for real-time status indicators

## Conventions

- All user-facing text supports Spanish (primary) and English via `src/lib/i18n/dictionaries.ts`
- System prompts are in `src/lib/agents/prompts/*.prompt.ts` — each exports a builder function that takes language, use case, and NIT context
- Colombian tax specifics: UVT 2026 = $52,374 COP, peso formatting with dot thousands separator ($1.234.567,89)
- Anti-hallucination rules are embedded in every specialist prompt — agents must only cite sources found in search results
- New specialist agents extend `BaseSpecialist`, get a prompt file, and register in `SPECIALISTS` map in `orchestrator.ts` + `AGENT_TOOLS` map in `registry.ts`
- New financial pipeline agents are standalone functions in `src/lib/agents/financial/agents/`, wired in `src/lib/agents/financial/orchestrator.ts`
- New audit agents follow the same pattern in `src/lib/agents/financial/audit/agents/`, wired in the audit orchestrator. Each auditor outputs structured JSON findings parsed by `parseAuditorOutput()`
