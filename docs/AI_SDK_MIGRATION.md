# AI SDK v6 + Direct OpenAI Provider

**Initial migration:** 2026-04-16 (commit `6753f41`) — moved off the legacy `openai` SDK to AI SDK v6 routing through the Vercel AI Gateway.

**Provider switch:** 2026-04-16 (later same day) — switched from the Vercel AI Gateway to direct `OPENAI_API_KEY` via `@ai-sdk/openai`. The gateway requires a credit card on file and was failing in production; the user already had a working `OPENAI_API_KEY` provisioned, so we cut out the middleman.

## TL;DR (current state)

- All LLM calls use **AI SDK v6** (`ai` package, v6.0.168) with the **`@ai-sdk/openai`** provider (v3.0.53, the `latest` tag pinned to the same `@ai-sdk/provider@3.0.8` that `ai@6` ships).
- `src/lib/config/models.ts` exports `MODELS.CHAT`, `MODELS.FINANCIAL_PIPELINE`, `MODELS.CLASSIFIER`, `MODELS.SYNTHESIZER`, `MODELS.OCR` as `LanguageModel` instances built with `openai('<model-id>')`. The provider reads `OPENAI_API_KEY` automatically — never pass `apiKey`.
- `MODELS.REALTIME` and `MODELS.EMBEDDINGS` stay as plain strings (Realtime is consumed via raw `fetch`; embeddings via `@langchain/openai`'s own client).
- The `openai` legacy npm dependency was removed in the first migration and is still gone.
- 37 callsites passing `model: MODELS.X` to `generateText` / `streamText` / `streamObject` work unchanged because those APIs accept both strings and `LanguageModel` instances.

## Why direct OpenAI (and not the Gateway)

The first iteration routed everything through the Vercel AI Gateway because the SDK auto-resolves `'openai/gpt-4o-mini'` strings to the gateway provider. In practice the gateway requires a credit card on the Vercel team and was returning 402 / billing errors in production. The user already had `OPENAI_API_KEY` provisioned in every Vercel environment, so direct calls are simpler, cheaper, and don't need a payment method on the Vercel side.

## Why AI SDK v6 (still the right call)

- Framework-native TypeScript surface (`generateText`, `streamText`, `tool()` with Zod `inputSchema`).
- Provider-pluggable: switching from gateway to `@ai-sdk/openai` was a one-file change in `models.ts` (37 callsites untouched).
- Streaming, tool-calling loop, and structured outputs work identically across providers.

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
  model: MODELS.FINANCIAL_PIPELINE, // LanguageModel from openai('gpt-4o-mini')
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
- Never instantiate an OpenAI client (`new OpenAI({...})`) in migrated code. Never pass `apiKey` to `generateText` / `streamText`. The `@ai-sdk/openai` provider reads `OPENAI_API_KEY` from `process.env` automatically.

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
| Image OCR (jpg/png/webp) | `generateText` with `{ type: 'image', image: dataUrl }`, `MODELS.OCR` (defaults to `gpt-4o`) |
| Scanned PDF OCR | `generateText` with `{ type: 'file', data: buffer, mediaType: 'application/pdf' }`. The old `openai.responses.create` + `input_file` path is gone; the AI SDK file part handles multipage OCR cleanly. |

Timeouts that used to live on the OpenAI client (`timeout: 90_000`) become `abortSignal: AbortSignal.timeout(90_000)` passed into `generateText`.

## Env vars

```bash
# .env.local (committed pattern, do not commit real values)
OPENAI_API_KEY=sk-...                # required — used by every LLM call + embeddings + realtime
TAVILY_API_KEY=tvly-...              # web search
```

`AI_GATEWAY_API_KEY` is no longer required. If your `.env.local` or Vercel env still sets it, it is harmless dead config — feel free to remove it from production env to reduce confusion.

All Vercel environments (production / preview / development) must have `OPENAI_API_KEY` set.

## What was NOT migrated

- **Realtime voice API** (`src/app/api/realtime/route.ts`): uses `fetch('https://api.openai.com/v1/realtime/sessions', ...)` directly with `OPENAI_API_KEY` because the AI SDK does not yet expose the Realtime API. Same pattern as before.
- **RAG embeddings**: `@langchain/openai` uses its own client with `OPENAI_API_KEY`. `MODELS.EMBEDDINGS` is exported as a plain string (no `openai/` prefix) for that consumer. Migration deferred until LangChain supports AI SDK natively or we replace LangChain with `embed` / `embedMany` from `ai`.
- **UI client rendering**: `ChatWorkspace.tsx` keeps its custom SSE parser and `ChatMessage` interface (separate from AI SDK's `UIMessage`). No `@ai-sdk/react` involved.

## Rollback

- Full rollback: `vercel rollback` to the last known-good production deployment.
- Provider rollback (back to gateway): change `src/lib/config/models.ts` to export plain string IDs again (`'openai/gpt-4o-mini'`); the SDK auto-resolves through the gateway when `AI_GATEWAY_API_KEY` is set. The 37 callsites do not need to change.
- Provider swap (different OpenAI-compatible provider): swap the `openai(...)` factory in `models.ts` for the matching `@ai-sdk/<provider>` factory. Same callsites unchanged.

## Verification checklist

Because UtopIA has no automated tests, every migration release should manually exercise:

1. Chat without documents — tests Gateway + classifier + simple tool-loop
2. Chat with an uploaded document — tests `analyze_document` dispatch + document injection
3. `POST /api/financial-report` — tests sequential pipeline (`generateText` × 3)
4. `POST /api/financial-audit` — tests `Promise.allSettled` parallel pipeline
5. `POST /api/upload` with a scanned PDF — tests `{ type: 'file' }` part against the Gateway
