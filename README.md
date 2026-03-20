# AiVocate

AiVocate is an AI-powered guidance system for U.S. labor and employment law. It combines retrieval-augmented generation (RAG) over a curated legal knowledge base with real-time voice interaction and document ingestion, giving users contextual, citation-backed answers to questions about federal workplace regulations. It is not a legal service — it is a technical system that makes dense legal information more accessible through conversational AI.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client (React)                       │
│  ┌───────────┐  ┌────────────┐  ┌────────────────────────┐ │
│  │ Text Chat │  │ File Upload│  │ Voice (WebRTC + Orb)   │ │
│  └─────┬─────┘  └─────┬──────┘  └───────────┬────────────┘ │
└────────┼───────────────┼─────────────────────┼──────────────┘
         │               │                     │
         ▼               ▼                     ▼
┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐
│ POST /chat  │  │ POST /upload │  │ GET /realtime         │
│             │  │              │  │ (ephemeral token)     │
│ PII redact  │  │ Extract text │  └───────────┬───────────┘
│ Tool-call   │  │ Chunk + embed│              │
│ loop (≤5)   │  │ Add to store │              ▼
└──┬──────┬───┘  └──────────────┘  ┌───────────────────────┐
   │      │                        │ OpenAI Realtime API   │
   ▼      ▼                        │ (WebRTC, bidirectional│
┌──────┐ ┌──────────┐              │  audio + data channel)│
│ RAG  │ │ Web      │              └───────────────────────┘
│Search│ │ Search   │
│(HNSW)│ │(Tavily)  │
└──────┘ └──────────┘
```

### Data flow: chat request

1. User message arrives at `/api/chat`. PII patterns (SSN, email, phone, credit card) are redacted before any LLM call.
2. The message is sent to `gpt-4o-mini` (temperature 0.1) with two tool definitions: `search_legal_docs` and `search_web`.
3. The model decides whether to call tools. If it calls `search_legal_docs`, the system performs cosine similarity search (k=5) against the HNSWLib vector store. If it calls `search_web`, Tavily is queried with domain-restricted results (dol.gov, eeoc.gov, law.cornell.edu, etc.).
4. Tool results are fed back to the model. This loop runs up to 5 rounds until the model produces a final response.
5. The response includes source citations from retrieved documents or web results.

### Data flow: document ingestion

1. Legal markdown files are split into ~1000-character chunks (250 overlap) using LangChain's `RecursiveCharacterTextSplitter`.
2. Each chunk is prepended with a document-level context string (e.g., `[From FLSA — covers minimum wage, overtime, worker classification]`) — a contextual retrieval pattern that improves search relevance.
3. Chunks are embedded via OpenAI `text-embedding-3-small` (1536 dimensions) and stored in an HNSWLib index persisted to disk.

Users can also upload documents at runtime via `/api/upload`, which follows the same pipeline and merges new embeddings into the existing store.

### Data flow: voice

1. Client requests an ephemeral token from `/api/realtime`, which proxies to OpenAI's Realtime API session endpoint.
2. A WebRTC peer connection is established directly between the browser and OpenAI's Realtime API.
3. Tool calls from the voice model are received over a data channel, executed client-side against `/api/rag` and `/api/web-search`, and results are sent back through the same channel.
4. Audio input/output is streamed bidirectionally. A frequency analyser drives a 3D orb visualization (Three.js + Bloom post-processing).

## Features

- **Two-tier retrieval**: local vector search over curated legal docs, with web search fallback restricted to whitelisted government and legal domains
- **Tool-calling orchestration**: multi-round function calling loop where the LLM autonomously decides which retrieval tools to invoke
- **Voice interaction**: full-duplex audio via OpenAI Realtime API over WebRTC, with tool execution bridged through RTCDataChannel
- **Document upload**: runtime ingestion of user documents (.txt, .md, .csv, .json, .html, .xml) into the shared vector store with cache invalidation
- **PII redaction**: regex-based filtering of SSN, email, phone, and credit card patterns before any data reaches the LLM
- **Bilingual UI**: English/Spanish with auto-detection and full i18n string coverage
- **Contextual embeddings**: document-level context prepended to each chunk before embedding, improving retrieval precision for domain-specific queries

## Security considerations

### Prompt injection

The system prompt instructs the model to stay within legal guidance scope, but there is no structural enforcement. User messages are passed directly to the LLM after PII redaction. An adversarial input could attempt to:

- Override system instructions to produce out-of-scope content
- Manipulate tool-calling behavior (e.g., crafting queries that cause the model to call `search_web` with attacker-chosen terms)
- Extract system prompt contents through indirect prompting

**Current mitigation**: scope-limiting system prompt, low temperature (0.1). **Not mitigated**: no input classification, no output filtering, no prompt injection detection layer.

### Data leakage

- **Uploaded documents** are persisted to disk indefinitely (`src/data/uploads/`). There is no expiration, access control, or encryption at rest.
- **Vector store** is a shared singleton. Documents uploaded by any user are queryable by all subsequent users. There is no tenant isolation.
- **Tavily queries** are sent to a third-party API. Query content is visible to Tavily.
- **OpenAI Realtime sessions** stream audio to OpenAI's servers. Voice data handling is governed by OpenAI's data policies.

### Trust boundaries

```
Trusted                          Untrusted
───────────────────────────────  ──────────────────────────
Server-side route handlers       User input (text, voice)
Environment variables (.env)     Uploaded documents
Curated legal docs               LLM output (can hallucinate)
                                 Web search results (Tavily)
```

LLM output is treated as trusted in the current implementation — responses are rendered as markdown without sanitization. This is a known gap: if retrieval returns adversarial content (e.g., from a malicious uploaded document), it could influence model output.

### Additional attack surface

- **File upload**: text extraction is UTF-8 decode only; no sandboxing for malformed inputs. 5MB size limit is the only constraint.
- **No authentication**: all endpoints are publicly accessible. No rate limiting.
- **No audit logging**: API calls, tool invocations, and uploads are not logged.
- **Error exposure**: catch blocks return raw error messages in some routes.

## Design decisions

| Decision | Rationale | Tradeoff |
|----------|-----------|----------|
| HNSWLib (in-process) over managed vector DB | Zero infrastructure dependencies; suitable for small corpus (~100 chunks). Simplifies deployment. | No concurrent write safety. Doesn't scale beyond a single process. |
| `gpt-4o-mini` over `gpt-4o` | Cost efficiency for a guidance tool where latency matters more than maximum reasoning depth. | Reduced performance on nuanced legal reasoning. |
| Client-side tool execution for voice | OpenAI Realtime API sends tool calls over data channel; executing them client-side avoids a server round-trip. | Tool results transit the browser, expanding the trust boundary. |
| Domain-restricted web search | Tavily queries are filtered to 14 government/legal domains to reduce hallucination from unreliable sources. | May miss relevant results from legal blogs, law firm analyses, or court databases not in the whitelist. |
| PII redaction via regex | Simple, fast, no external dependencies. | High false-negative rate. Won't catch paraphrased PII, context-dependent sensitive info, or non-US formats. |
| Shared vector store (no tenancy) | Simplicity for single-user or demo use. | Fundamentally incompatible with multi-user deployment without a complete storage redesign. |

## Tech stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| LLM | OpenAI `gpt-4o-mini` (chat), `gpt-4o-realtime-preview` (voice), `text-embedding-3-small` (embeddings) |
| RAG | LangChain (splitter, embeddings, document loaders), HNSWLib-node (vector store) |
| Web search | Tavily API with domain filtering |
| Voice | OpenAI Realtime API over WebRTC |
| UI | Tailwind CSS 4, Motion, React Three Fiber + drei + postprocessing |
| i18n | Custom context-based (en/es) with localStorage persistence |

## Getting started

```bash
# Install dependencies
npm install

# Configure environment
# Create .env.local with:
#   OPENAI_API_KEY=sk-...
#   TAVILY_API_KEY=tvly-...

# Build the vector store from legal docs
npm run db:ingest

# Start development server
npm run dev
```

The app runs at `http://localhost:3000`. Voice mode requires microphone permissions and a valid OpenAI API key with Realtime API access.

## Project structure

```
src/
├── app/api/
│   ├── chat/route.ts         # Chat endpoint with tool-calling loop
│   ├── realtime/route.ts     # Ephemeral token for WebRTC voice
│   ├── upload/route.ts       # Document ingestion endpoint
│   ├── rag/route.ts          # Direct vector store query
│   └── web-search/route.ts   # Tavily search endpoint
├── lib/
│   ├── rag/
│   │   ├── ingest.ts         # Batch ingestion pipeline
│   │   └── vectorstore.ts    # HNSWLib loader + similarity search
│   ├── search/web-search.ts  # Tavily client with domain filtering
│   └── security/pii-filter.ts
├── hooks/
│   └── useRealtimeAPI.ts     # WebRTC + data channel orchestration
├── components/sections/
│   └── ChatWidget.tsx        # Main chat/voice UI
└── data/
    ├── legal_docs/           # Source legal documents (5 .md files)
    └── vector_store/         # Persisted HNSWLib index
```

## Current status

This is an actively developed prototype. It demonstrates a working RAG pipeline with voice interaction and document ingestion, but it is **not production-ready**. Key gaps before production use:

- No authentication or authorization
- No tenant isolation in the vector store
- No rate limiting on API endpoints
- No structured logging or observability
- PII redaction is regex-only (no ML-based NER)
- No prompt injection detection or output filtering
- Uploaded files have no lifecycle management

## Legal disclaimer

AiVocate provides general information about U.S. labor and employment law. It does not constitute legal advice, does not create an attorney-client relationship, and should not be used as a substitute for consultation with a qualified attorney.
