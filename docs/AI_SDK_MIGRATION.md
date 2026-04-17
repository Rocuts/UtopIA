# AI SDK v6 + Vercel AI Gateway Migration

**Completed:** 2026-04-16 (commit `6753f41`). 45 files changed, +1195/-987.

## TL;DR

- All LLM calls that previously used the `openai` SDK (v6.27.0) now use AI SDK v6 (`ai` package, v6.0.168).
- Models resolve automatically through the **Vercel AI Gateway** via string IDs like `'openai/gpt-4o-mini'`. No `apiKey` is ever passed.
- The `openai` npm dependency was removed. Realtime voice still calls OpenAI directly via `fetch`, and RAG embeddings still use `@langchain/openai` — these two are the only surviving direct-to-OpenAI paths.

## Why

- Vercel platform defaults (2026+) push AI Gateway for all server-side LLM calls: unified observability, per-model cost tracking, multi-provider failover, zero data retention, OIDC-based auth in prod.
- AI SDK v6 is the framework-native TypeScript surface (`generateText`, `streamText`, `tool()` with Zod `inputSchema`) and matches the bundler / Fluid Compute runtime without extra provider packages.

## Scope (37 files migrated in parallel)

| Area | Files |
|------|-------|
| Chat orchestrator core | `orchestrator.ts`, `classifier.ts`, `synthesizer.ts`, `prompt-enhancer.ts`, `specialists/base-agent.ts`, `tools/registry.ts` |
| Routes | `src/app/api/chat/route.ts`, `src/app/api/upload/route.ts` |
| Financial main | `agents/niif-analyst.ts`, `agents/strategy-director.ts`, `agents/governance-specialist.ts`, `quality/agent.ts` |
| Audit + tax-planning + reconciliation | 9 files under `financial/{audit,tax-planning,tax-reconciliation}/agents/` |
| Transfer pricing + valuation + fiscal opinion + feasibility | 13 files under `financial/{transfer-pricing,valuation,fiscal-opinion,feasibility}/agents/` |
| Standalone tools | `lib/tools/document-analyzer.ts`, `lib/tools/risk-assessor.ts`, `lib/tools/dian-response-generator.ts` |

Done with 6 Opus agents running in parallel against disjoint file groups; the `classifier.ts` was migrated first by hand to lock in the canonical pattern.

## Canonical transformation

```ts
// BEFORE
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const response = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [...],
  temperature: 0.05,
  max_tokens: 8192,
  response_format: { type: 'json_object' },
});
const text = response.choices[0].message.content || '';

// AFTER
import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';
const { text } = await generateText({
  model: MODELS.FINANCIAL_PIPELINE, // resolves to 'openai/gpt-5.4-mini'
  messages: [...],
  temperature: 0.05,
  maxOutputTokens: 8192, // renamed
});
```

- `max_tokens` → `maxOutputTokens`
- `response.choices[0].message.content` → `result.text`
- `response_format: { type: 'json_object' }` is **removed**. Two replacement patterns depending on the call site:
  - **Preferred (new code, schema-validated):** `experimental_output: Output.object({ schema: zodSchema })` on `generateText`. Access the parsed+validated object as `result.experimental_output`. The classifier (`src/lib/agents/classifier.ts`) is the canonical example — no manual JSON parsing, no brittle prompt instruction.
  - **Lift-and-shift (used during the initial migration):** drop `response_format` and end the system prompt with `"\n\nRespond ONLY with a valid JSON object. No prose, no markdown, no code fences."`, then `JSON.parse(text)`. Acceptable for files that produce Markdown with an incidental JSON section; not ideal for tight structured outputs.
- `withRetry(...)` wrapper is preserved; only the inner call changes.
- Never instantiate an OpenAI client in migrated code. Never pass `apiKey`. The Gateway uses `AI_GATEWAY_API_KEY` (dev) or `VERCEL_OIDC_TOKEN` (prod) automatically.

## Streaming

`streamText` is **synchronous** (returns the result object immediately, initiates the HTTP call when `textStream` is consumed). To keep `withRetry` semantics it is wrapped: `withRetry(() => Promise.resolve(streamText({ ... })), ...)`. Stream-consumption errors propagate; only construction errors retry, matching the prior OpenAI behavior.

```ts
const result = streamText({ model: MODELS.CHAT, messages, tools, toolChoice: 'auto' });
for await (const delta of result.textStream) ctx.onStreamToken?.(delta);
const toolCalls = await result.toolCalls;
const finalText = await result.text;
```

## Tool-calling loop

Custom loop in `BaseSpecialist.execute()` preserved exactly (`MAX_TOOL_ROUNDS = 6`, per-call retry, onStreamToken, abortSignal, progress events). Design choice: registry tools have NO `execute`, so AI SDK returns `toolCalls` without auto-invoking. The manual loop dispatches via `executeTool(name, args, ctx)` and injects the per-call `ToolExecContext` (`documentContext`, `erpConnections`, etc.).

JSON Schema → Zod:

```ts
// Before
parameters: {
  type: 'object',
  properties: { query: { type: 'string' } },
  required: ['query'],
}

// After
inputSchema: z.object({ query: z.string().describe('...') })
```

`getToolsForAgent(name)` return shape changed: `ChatCompletionTool[]` → `Record<string, Tool>`. Only caller is `base-agent.ts`.

### Tool-result messages (assistant → tool round-trip)

AI SDK v6 uses a stricter shape than OpenAI's `{ role: 'tool', tool_call_id, content }`:

```ts
// Assistant message with tool calls + optional reasoning text
messages.push({
  role: 'assistant',
  content: [
    { type: 'text', text: reasoningIfAny },
    { type: 'tool-call', toolCallId, toolName, input },
  ],
});

// Tool results — array of parts under one 'tool' role message
const toolResultParts: ToolResultPart[] = [
  {
    type: 'tool-result',
    toolCallId,
    toolName,
    output: { type: 'json', value: result }, // or 'text' / 'error-text'
  },
];
messages.push({ role: 'tool', content: toolResultParts });
```

Errors use `{ type: 'error-text', value: ... }` so the model can react differently to failures than to successful JSON payloads.

## OCR

| Case | Implementation |
|------|----------------|
| Image OCR (jpg/png/webp) | `generateText` with `{ type: 'image', image: dataUrl }`, `MODELS.OCR` (defaults to `openai/gpt-5.4`) |
| Scanned PDF OCR | `generateText` with `{ type: 'file', data: buffer, mediaType: 'application/pdf' }`. Replaces the old `openai.responses.create` + `input_file` path (Responses API is not exposed via Gateway as of 2026-04). |

Timeouts that used to live on the OpenAI client (`timeout: 90_000`) become `abortSignal: AbortSignal.timeout(90_000)` passed into `generateText`.

## Env vars

```bash
# .env.local (committed pattern, do not commit real values)
AI_GATEWAY_API_KEY=vck_...           # required — gets auto-provisioned per environment on Vercel
OPENAI_API_KEY=sk-...                # ONLY for Realtime voice route + LangChain embeddings
TAVILY_API_KEY=tvly-...              # web search
```

All three targets on Vercel (production / preview / development) must have `AI_GATEWAY_API_KEY`. Production + Development were added via CLI; Preview had to go through the REST API because `vercel@51.5.1` rejects both `--yes` without a branch and any production branch as a preview scope (open CLI bug).

## What was NOT migrated

- **Realtime voice API** (`src/app/api/realtime/route.ts`): still uses `fetch('https://api.openai.com/v1/realtime/sessions', ...)` with `OPENAI_API_KEY`. The Gateway does not expose this API yet.
- **RAG embeddings**: `@langchain/openai` is used inside LangChain's own client. Works unchanged; migration deferred until LangChain supports AI SDK or we replace LangChain with `embed` / `embedMany` from `ai`.
- **UI client rendering**: `ChatWorkspace.tsx` keeps its custom SSE parser and `ChatMessage` interface (separate from AI SDK's `UIMessage`). No `@ai-sdk/react` involved.

## Rollback

- Full rollback: `vercel rollback` to the last known-good production deployment (pre-migration commits still on the main branch deploy list).
- Partial rollback (models only): set `OPENAI_MODEL_*` envs to non-gateway strings and configure a direct provider. The shape of the code won't need to change.

## Verification checklist

Because UtopIA has no automated tests, every migration release should manually exercise:

1. Chat without documents — tests Gateway + classifier + simple tool-loop
2. Chat with an uploaded document — tests `analyze_document` dispatch + document injection
3. `POST /api/financial-report` — tests sequential pipeline (`generateText` × 3)
4. `POST /api/financial-audit` — tests `Promise.allSettled` parallel pipeline
5. `POST /api/upload` with a scanned PDF — tests `{ type: 'file' }` part against the Gateway
