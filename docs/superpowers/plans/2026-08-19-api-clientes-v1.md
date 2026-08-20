# API de Clientes v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Superficie `/api/v1` B2B con llaves, errores RFC 9457, rate limiting, idempotencia, paginación por cursor, webhooks Standard Webhooks v1 con entrega durable, recurso `trial-balances` sobre el preprocesador determinista, OpenAPI 3.1.2 y descubrimiento RFC 9727.

**Architecture:** Toolkit `src/lib/api/*` de unidades puras/testeables + route handlers delgados bajo `src/app/api/v1/*`; tablas nuevas en `src/lib/db/schema-api.ts`; entrega de webhooks con Workflow DevKit (patrón monthly-close); integración con `src/proxy.ts` vía allowlists explícitas.

**Tech Stack:** Next.js 16 App Router, Drizzle + pg (getDb), Zod v4 (`z.toJSONSchema`), Workflow DevKit (`workflow/api`), vault AES-256-GCM existente, vitest.

**Spec:** `docs/spec/api-clientes-v1.md` (leerla antes de ejecutar; este plan la implementa sección por sección).

## Global Constraints

- JSON público **snake_case**; paths **kebab-case**; fechas RFC 3339 UTC `Z`; dinero `{"amount": "<string centavos>", "currency": "COP"}`.
- Errores no-2xx SIEMPRE `application/problem+json` (RFC 9457) construidos por `problems.ts` — nunca `NextResponse.json({error})` en rutas v1.
- Todo query de recurso filtra por `workspace_id` de la llave autenticada (BOLA). 404 uniforme para recurso ajeno.
- El token de llave y los secretos `whsec_` viajan en claro SOLO en la respuesta de creación. Jamás a logs.
- Cero PII en logs (Ley 1581): solo key_id, workspace, ruta, status, latencia, row_count.
- Sin `apiKey` de OpenAI ni LLM en ninguna parte de este plan. Los schemas Zod de `src/lib/api/` NO viajan al LLM (el guard strict-mode no aplica; `.optional()/.strict()` permitidos).
- `npm run db:migrate` NO se ejecuta en esta sesión (solo `drizzle-kit generate`).
- El worktree no tiene `.env.local`: los tests setean `process.env.*` que necesiten (vault, pepper, DB_HMAC_KEY) en el propio test.
- Tests en `src/**/__tests__/*.test.ts` (patrón vitest.config.ts). Correr `npx vitest run <ruta>` por tarea y suite completa al final.
- Commits frecuentes estilo repo: `feat(api): …` en español + footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Encodings (base62, Crockford base32, CRC32)

**Files:**
- Create: `src/lib/api/encoding.ts`
- Test: `src/lib/api/__tests__/encoding.test.ts`

**Interfaces (Produces):**
```ts
export function randomBase62(length: number): string;            // CSPRNG, rejection sampling (sin sesgo módulo)
export function crc32(input: string): number;                    // >>> 0, tabla estándar IEEE 802.3
export function crc32Base62(input: string): string;              // 6 chars base62, pad '0' a la izquierda
export function encodeCrockford32(bytes: Uint8Array): string;    // 16 bytes -> 26 chars lowercase (TypeID)
export function decodeCrockford32(s: string): Uint8Array | null; // inverso estricto; null si inválido
```

- [ ] **Step 1: test que falla** — casos: `crc32('123456789') === 0xCBF43926` (vector canónico IEEE); `crc32Base62('x')` tiene length 6 y alfabeto base62; `randomBase62(26)` length y alfabeto correctos y dos llamadas difieren; roundtrip `decodeCrockford32(encodeCrockford32(bytes)) === bytes` para 16 bytes aleatorios; `encodeCrockford32` de 16 bytes produce 26 chars y el primero ∈ `01234567` (2 bits altos en cero); `decodeCrockford32('!'.repeat(26)) === null` y length ≠ 26 → null.
- [ ] **Step 2:** `npx vitest run src/lib/api/__tests__/encoding.test.ts` → FAIL (módulo no existe).
- [ ] **Step 3: implementación.** CRC32 con tabla precomputada (polinomio 0xEDB88320). Crockford alphabet `0123456789abcdefghjkmnpqrstvwxyz` (sin i,l,o,u); encode: BigInt de 128 bits → 26 dígitos base32; decode: inverso con validación de overflow (26 chars = 130 bits; los 2 altos deben ser 0). randomBase62: `crypto.randomBytes`, descartar bytes ≥ 248 (248 = 62*4) y tomar `b % 62`.
- [ ] **Step 4:** correr → PASS.
- [ ] **Step 5:** `git add -A && git commit -m "feat(api): encodings base62/crockford32/crc32 para IDs y llaves"`.

### Task 2: IDs públicos TypeID + UUIDv7

**Files:**
- Create: `src/lib/api/ids.ts`
- Test: `src/lib/api/__tests__/ids.test.ts`

**Interfaces (Produces):**
```ts
export const ID_PREFIXES = { trialBalance: 'tb', webhookEndpoint: 'whe', webhookMessage: 'msg', apiKey: 'key', request: 'req' } as const;
export function uuidv7(): string;                                   // canónico con guiones, version=7, variant=10
export function typeIdFrom(prefix: string, uuid: string): string;   // `${prefix}_${crockford26}`
export function newTypeId(prefix: string): { id: string; uuid: string };
export function parseTypeId(prefix: string, value: string): string | null; // -> uuid canónico o null
```

- [ ] **Step 1: test que falla** — `uuidv7()` matchea `/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`; dos uuidv7 generados con 2 ms de separación ordenan lexicográficamente ascendente; roundtrip `parseTypeId('tb', typeIdFrom('tb', u)) === u`; `parseTypeId('tb', 'whe_…') === null`; `parseTypeId('tb', 'tb_<25chars>') === null`; `parseTypeId('tb', 'tb_' + 'u'.repeat(26)) === null` (char fuera de alfabeto).
- [ ] **Step 2:** correr → FAIL.
- [ ] **Step 3: implementación.** uuidv7: 16 bytes random (`crypto.randomBytes`), sobrescribir bytes 0-5 con `Date.now()` big-endian 48 bits, nibble de versión `(b[6] & 0x0f) | 0x70`, variante `(b[8] & 0x3f) | 0x80`.
- [ ] **Step 4:** correr → PASS.
- [ ] **Step 5:** commit `feat(api): IDs públicos TypeID (prefijo + UUIDv7 crockford32)`.

### Task 3: Problems RFC 9457

**Files:**
- Create: `src/lib/api/problems.ts`
- Test: `src/lib/api/__tests__/problems.test.ts`

**Interfaces (Produces):**
```ts
export type ProblemCode = 'missing_api_key' | 'invalid_api_key' | 'api_disabled' | 'insufficient_scope'
  | 'rate_limited' | 'malformed_json' | 'validation_failed' | 'empty_trial_balance'
  | 'idempotency_key_in_use' | 'idempotency_payload_mismatch' | 'not_found' | 'payload_too_large'
  | 'precondition_required' | 'precondition_failed' | 'internal_error';
export interface ProblemValidationError { detail: string; pointer: string }
export function problemResponse(code: ProblemCode, opts: {
  requestId: string; detail?: string; instance?: string;
  errors?: ProblemValidationError[]; headers?: Record<string, string>;
}): Response;
export function zodIssuesToErrors(error: z.ZodError): ProblemValidationError[]; // pointer = '/' + path.join('/')
export const PROBLEM_STATUS: Record<ProblemCode, number>; // p.ej. rate_limited: 429, api_disabled: 503
```

Catálogo interno: cada code → `{ status, title (es), typeSlug }`. `type` = `https://utopia.app/docs/api/problems#<code>` (identificador estable; los clientes deben matchear por `code`, documentado en el propio body). Body siempre incluye `type,title,status,code,detail?,instance?,request_id,errors?`. Header `Content-Type: application/problem+json; charset=utf-8` + `Cache-Control: no-store` + `X-Request-Id`.

- [ ] **Step 1: test que falla** — `problemResponse('rate_limited', {requestId:'req_x', headers:{'Retry-After':'30'}})`: status 429, content-type problem+json, body.code='rate_limited', body.request_id='req_x', header Retry-After presente; `zodIssuesToErrors` sobre `z.object({csv: z.string()}).safeParse({csv: 5})` produce `[{detail: <no vacío>, pointer: '/csv'}]`; pointer anidado `a.b[0]` → `/a/b/0`.
- [ ] **Step 2:** FAIL → **Step 3:** implementar → **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(api): errores RFC 9457 (problem+json) con catálogo y mapping Zod`.

### Task 4: Generación y hash de llaves

**Files:**
- Create: `src/lib/api/keys.ts`
- Test: `src/lib/api/__tests__/keys.test.ts`

**Interfaces (Produces):**
```ts
export type ApiKeyMode = 'live' | 'test';
export interface GeneratedApiKey { token: string; prefix: string; last4: string; mode: ApiKeyMode }
export function generateApiKeyToken(mode: ApiKeyMode): GeneratedApiKey; // utop_sk_live_<26 b62><6 crc-b62>
export function parseApiKeyToken(token: string): { mode: ApiKeyMode; body: string; checksum: string } | null;
export function verifyApiKeyChecksum(token: string): boolean;      // crc32Base62(body) === checksum
export function hashApiKeyToken(token: string): string;            // hex HMAC-SHA256(pepper, token)
export function isApiKeyPepperConfigured(): boolean;               // lee process.env.UTOPIA_API_KEY_PEPPER por llamada (lazy)
export const CURRENT_PEPPER_VERSION = 1;
```

- [ ] **Step 1: test que falla** — con `process.env.UTOPIA_API_KEY_PEPPER = randomBytes(32).toString('base64')` en beforeEach: token matchea `/^utop_sk_(live|test)_[0-9A-Za-z]{26}[0-9A-Za-z]{6}$/`; `verifyApiKeyChecksum(token) === true`; mutar un char del body → false; `parseApiKeyToken('garbage') === null`; `hashApiKeyToken` es determinista (mismo token → mismo hex de 64), distinto pepper → distinto hash; sin env (`delete`) `isApiKeyPepperConfigured() === false` y `hashApiKeyToken` lanza.
- [ ] **Step 2:** FAIL → **Step 3:** implementar (usa Task 1: `randomBase62(26)`, `crc32Base62`; `node:crypto.createHmac`) → **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(api): formato de llave utop_sk_* con checksum CRC32 y HMAC-pepper en reposo`.

### Task 5: Schema Drizzle + migración

**Files:**
- Create: `src/lib/db/schema-api.ts`
- Modify: `src/lib/db/schema.ts` (añadir `export * from './schema-api';` junto a los demás re-exports, línea ~800)
- Create (generada): `src/lib/db/migrations/00XX_*.sql` vía drizzle-kit

**Interfaces (Produces):** tablas exportadas `apiKeys, apiIdempotencyKeys, apiTrialBalances, apiWebhookEndpoints, apiWebhookMessages, apiWebhookAttempts` + tipos `$inferSelect` (`ApiKeyRow`, etc.). Columnas EXACTAS de la spec §5 (uuid PK sin `defaultRandom` — el uuidv7 lo pone la app; FKs a `workspaces.id` con `onDelete: 'cascade'`; `unique` en `api_keys.key_hash` y en `(workspace_id, endpoint, idem_key)`; index en `(workspace_id, created_at)` de trial_balances y en `(status, next_attempt_at)` de messages). Import de `workspaces` desde `./schema` (patrón schema-banking).

- [ ] **Step 1:** escribir `schema-api.ts` completo + re-export.
- [ ] **Step 2:** `npx tsc --noEmit` → sin errores nuevos.
- [ ] **Step 3:** `npx drizzle-kit generate` (directo, sin dotenv — generate no conecta a DB) → revisa el SQL generado: solo `CREATE TABLE/INDEX` aditivos.
- [ ] **Step 4:** commit `feat(api): tablas del API v1 (llaves, idempotencia, balances, webhooks) + migración`.

### Task 6: Rate limit por llave + headers draft-11

**Files:**
- Modify: `src/lib/security/rate-limit.ts` (refactor conservador)
- Create: `src/lib/api/rate-limit.ts`
- Test: `src/lib/api/__tests__/rate-limit.test.ts`

**Interfaces:**
- Consumes: backends existentes de `lib/security/rate-limit.ts`.
- Produces:
```ts
// en src/lib/security/rate-limit.ts (además de lo existente, sin romper checkRateLimit):
export interface DynamicRateLimitResult extends RateLimitResult { resetSeconds: number }
export async function checkRateLimitDynamic(key: string, limit: number): Promise<DynamicRateLimitResult>;
// en src/lib/api/rate-limit.ts:
export function rateLimitHeaders(policy: string, r: DynamicRateLimitResult): Record<string, string>;
// -> { 'RateLimit-Policy': `"${policy}";q=${limit};w=60`, 'RateLimit': `"${policy}";r=${remaining};t=${resetSeconds}` }
export async function enforceKeyRateLimit(keyId: string, kind: 'read' | 'write', limitRpm: number, requestId: string):
  Promise<{ ok: true; headers: Record<string, string> } | { ok: false; response: Response }>;
// 429 -> problemResponse('rate_limited', { headers: { 'Retry-After': String(resetSeconds), ...rateLimitHeaders } })
```
Refactor de `security/rate-limit.ts`: extraer el cuerpo de `checkRateLimitUpstash/Memory` a variantes que reciben `limit` explícito y calculan `resetSeconds` (fixed-window Upstash: segundos hasta el fin del bucket; memoria: `windowStart + WINDOW_MS - now`); `checkRateLimit(key, endpoint)` queda como wrapper `checkRateLimitDynamic(key, LIMITS[endpoint] ?? 20)` que descarta resetSeconds. Los tests existentes de `src/lib/security/__tests__` deben seguir pasando.

- [ ] **Step 1: test que falla** — `rateLimitHeaders('write', {limit:20, remaining:3, resetSeconds:41, allowed:true})` produce exactamente los dos headers con sintaxis SF; `checkRateLimitDynamic('k1', 2)` (backend memoria, sin env Upstash): 1ª y 2ª allowed, 3ª `allowed:false` con `resetSeconds` entre 1 y 60; `enforceKeyRateLimit` al exceder devuelve Response 429 con `Retry-After`.
- [ ] **Step 2:** FAIL → **Step 3:** implementar → **Step 4:** PASS + `npx vitest run src/lib/security` → PASS (sin regresión).
- [ ] **Step 5:** commit `feat(api): cuota por llave con headers RateLimit draft-11 + refactor dinámico del limiter`.

### Task 7: Cursores de paginación firmados

**Files:**
- Create: `src/lib/api/pagination.ts`
- Test: `src/lib/api/__tests__/pagination.test.ts`

**Interfaces (Produces):**
```ts
export function encodeCursor(createdAt: Date, id: string): string;              // base64url(`${ms}.${uuid}.${hmac16hex}`), HMAC con DB_HMAC_KEY
export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null; // null si firma inválida/malformado
export function parsePageParams(url: URL): { limit: number; cursor: { createdAt: Date; id: string } | null } | { invalid: string };
// limit: default 20, clamp 1..100; invalid = mensaje si limit no numérico o cursor con firma rota
```

- [ ] **Step 1: test que falla** — con `process.env.DB_HMAC_KEY` seteado: roundtrip encode→decode; alterar 1 char → null; `parsePageParams(new URL('https://x/api/v1/t?limit=200'))` → limit 100; `limit=abc` → `{invalid}`; sin cursor → `cursor: null`.
- [ ] **Step 2:** FAIL → **Step 3:** implementar (`createHmac('sha256', DB_HMAC_KEY)` truncado a 16 hex) → **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(api): paginación por cursor opaco firmado (HMAC)`.

### Task 8: Idempotencia (Stripe + códigos del draft IETF)

**Files:**
- Create: `src/lib/api/idempotency.ts`
- Test: `src/lib/api/__tests__/idempotency.test.ts`

**Interfaces (Produces):**
```ts
export interface IdempotencyScope { workspaceId: string; endpoint: string; key: string; fingerprint: string }
export type IdempotencyBegin =
  | { kind: 'new' } | { kind: 'processing' } | { kind: 'mismatch' }
  | { kind: 'completed'; status: number; body: unknown };
export interface IdempotencyStore {
  begin(scope: IdempotencyScope): Promise<IdempotencyBegin>;
  complete(scope: IdempotencyScope, status: number, body: unknown): Promise<void>;
  abandon(scope: IdempotencyScope): Promise<void>;
}
export function fingerprintBody(raw: string): string; // sha256 hex
export function createDrizzleIdempotencyStore(db: DbLike): IdempotencyStore;
export async function runIdempotent(store: IdempotencyStore, scope: IdempotencyScope | null,
  exec: () => Promise<{ status: number; body: unknown }>):
  Promise<{ status: number; body: unknown; replayed: boolean } | { conflict: 'in_use' | 'mismatch' }>;
```
Semántica: `begin` = INSERT `status='processing'` con ON CONFLICT DO NOTHING; si conflictó, SELECT y clasificar (fingerprint ≠ → mismatch; status processing → processing; completed → completed con respuesta guardada). `runIdempotent`: scope null → exec directo; new → exec, persistir con `complete` si `status < 500`, si exec lanza → `abandon` + rethrow; TTL: filas con `created_at < now()-24h` se tratan como inexistentes (begin las reclama con UPDATE). `processing` → `{conflict:'in_use'}` (409), `mismatch` → 422.

- [ ] **Step 1: test que falla** — con un `MemStore` de prueba que implemente `IdempotencyStore` (Map): primera corrida ejecuta y persiste; segunda con mismo scope NO ejecuta (spy) y devuelve `replayed:true` + mismo body; fingerprint distinto → `{conflict:'mismatch'}`; estado processing → `{conflict:'in_use'}`; exec lanza → el store queda sin la entrada (retry posible) y el error se propaga; `status 500` del exec NO se persiste.
- [ ] **Step 2:** FAIL → **Step 3:** implementar (el DrizzleStore usa `onConflictDoNothing()` + select; queda cubierto por tsc y el smoke de rollout) → **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(api): Idempotency-Key con replay, mismatch 422 y concurrencia 409`.

### Task 9: Auth + pipeline `withApiV1`

**Files:**
- Create: `src/lib/api/auth.ts`, `src/lib/api/handler.ts`
- Test: `src/lib/api/__tests__/handler.test.ts`

**Interfaces (Produces):**
```ts
// auth.ts
export interface AuthenticatedKey { id: string; workspaceId: string; scopes: string[]; rpmRead: number; rpmWrite: number }
export interface AuthDeps {
  findActiveKeyByHash(hash: string): Promise<AuthenticatedKey | null>; // filtra revoked_at IS NULL y (expires_at IS NULL o > now)
  touchLastUsed(keyId: string): void;                                   // fire-and-forget, throttled 1/min (Map módulo-level)
}
export async function authenticateApiRequest(req: Request, deps: AuthDeps):
  Promise<{ ok: true; key: AuthenticatedKey } | { ok: false; code: 'missing_api_key' | 'invalid_api_key' | 'api_disabled' }>;
export function hasScopes(key: AuthenticatedKey, required: string[]): boolean;
export const API_SCOPES = ['trial_balances:read', 'trial_balances:write', 'webhooks:manage'] as const;

// handler.ts
export interface ApiV1Context { req: Request; requestId: string; key: AuthenticatedKey; workspaceId: string; rawBody: string | null; params: Record<string, string> }
export interface ApiV1Config { scopes: string[]; kind: 'read' | 'write'; readBody?: boolean; idempotencyEndpoint?: string; maxBodyBytes?: number; deps?: Partial<HandlerDeps> }
export function withApiV1(config: ApiV1Config, handler: (ctx: ApiV1Context) => Promise<Response>):
  (req: Request, route?: { params: Promise<Record<string, string>> }) => Promise<Response>;
export function apiJson(status: number, body: unknown, requestId: string, headers?: Record<string, string>): Response;
// headers estándar en TODA respuesta: X-Request-Id, Utopia-Api-Version: '2026-08-19', Cache-Control: no-store
export const API_VERSION = '2026-08-19';
```
Pipeline en orden: pepper configurado (si no → 503 `api_disabled`) → Bearer (`Authorization: Bearer utop_sk_…`; ausente → 401 `missing_api_key`) → checksum offline (falla → 401 `invalid_api_key` SIN tocar DB) → HMAC + `findActiveKeyByHash` (null → mismo 401) → scopes (403) → `enforceKeyRateLimit(key.id, kind, rpm)` (429) → body: si `readBody`, `await req.text()`, `Buffer.byteLength > maxBodyBytes ?? 2_097_152` → 413; JSON.parse falla → 400 `malformed_json` → idempotencia (si `idempotencyEndpoint` y header `Idempotency-Key` presente; largo > 255 → 400 validation_failed) → handler → catch global → 500 `internal_error` con `console.error('[api-v1]', requestId, err)` (sin body del cliente). `requestId` = `req.headers.get('x-request-id') ?? newTypeId('req').id`. Inyección de dependencias: `HandlerDeps = { auth: AuthDeps; idempotencyStore: IdempotencyStore; rateLimit: typeof enforceKeyRateLimit }` con defaults reales (drizzle) — los tests pasan fakes vía `config.deps`.

- [ ] **Step 1: test que falla** (handler.test.ts, con deps fake y pepper seteado) — sin Authorization → 401 problem code missing_api_key; token con checksum roto → 401 y `findActiveKeyByHash` NO llamado; token válido no en store → 401 invalid_api_key; llave sin scope → 403; rate limit fake que niega → 429 con Retry-After; body > max → 413; JSON roto → 400; feliz → 200 con X-Request-Id y Utopia-Api-Version; con Idempotency-Key repetido → segunda respuesta `replayed` con header `Idempotent-Replayed: true`.
- [ ] **Step 2:** FAIL → **Step 3:** implementar → **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(api): autenticación Bearer por llave y pipeline withApiV1`.

### Task 10: Webhooks — secreto, firma, validación de URL

**Files:**
- Create: `src/lib/api/webhooks.ts`
- Test: `src/lib/api/__tests__/webhooks.test.ts`

**Interfaces (Produces):**
```ts
export function generateWebhookSecret(): string; // 'whsec_' + base64(randomBytes(32))
export function signWebhookPayload(secret: string, msgId: string, timestampSec: number, payload: string): string;
// base64(HMAC_SHA256(base64decode(secret sin 'whsec_'), `${msgId}.${timestampSec}.${payload}`)) con prefijo 'v1,'
export function buildEventEnvelope(eventType: string, data: unknown, nowIso: string): string; // JSON.stringify({type, timestamp, data})
export function validateWebhookUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string };
export const WEBHOOK_EVENT_TYPES = ['ping', 'trial_balance.processed'] as const;
```
`validateWebhookUrl`: https obligatorio; sin credenciales en URL; hostname NO puede ser IP literal privada/loopback/link-local (v4: 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 0.0.0.0; v6: ::1, fc00::/7, fe80::/10) ni `localhost`/`*.local`/`*.internal`; puerto solo 443 o vacío.

- [ ] **Step 1: test que falla** — vector de la spec Standard Webhooks: con `secret = 'whsec_' + base64('MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw')`… usar vector propio verificable: firmar con secreto conocido y verificar con `createHmac` recomputado en el test (independiente de la implementación) + formato `/^v1,[A-Za-z0-9+/=]+$/`; `signWebhookPayload` decodifica el base64 del secreto ANTES de firmar (test: firmar con secret y con base64decode manual dan lo mismo); URLs: `http://` → no ok; `https://10.0.0.1/x` → no ok; `https://[::1]/x` → no ok; `https://hooks.cliente.com/utopia` → ok; `https://user:pass@h.com` → no ok; puerto 8443 → no ok.
- [ ] **Step 2:** FAIL → **Step 3:** implementar → **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(api): firma Standard Webhooks v1 y validación anti-SSRF de URLs`.

### Task 11: Entrega durable (Workflow DevKit) + emisión de eventos

**Files:**
- Create: `src/lib/workflows/webhook-delivery/policy.ts` (puro), `src/lib/workflows/webhook-delivery/index.ts` (`'use workflow'`), `src/lib/workflows/webhook-delivery/steps/attempt.ts` (`'use step'`), `src/lib/workflows/webhook-delivery/steps/finalize.ts` (`'use step'`)
- Modify: `src/lib/api/webhooks.ts` (añadir `emitWebhookEvent`)
- Test: `src/lib/workflows/webhook-delivery/__tests__/policy.test.ts`

**Interfaces:**
- Consumes: `signWebhookPayload`, `buildEventEnvelope` (Task 10); `decryptSecret` de `@/lib/security/vault`; tablas Task 5; `start` de `workflow/api`.
- Produces:
```ts
// policy.ts (puro, testeado)
export const RETRY_DELAYS_MS = [0, 5_000, 300_000, 1_800_000, 7_200_000, 18_000_000, 36_000_000, 36_000_000] as const; // schedule Svix
export function isDeliverySuccess(status: number): boolean;            // solo 2xx (3xx = fallo)
export function shouldDisableEndpoint(firstFailingAt: Date | null, now: Date): boolean; // >= 5 días
export const DELIVERY_TIMEOUT_MS = 10_000;
// index.ts
export async function deliverWebhookMessage(input: { messageId: string }): Promise<void>; // 'use workflow'
// webhooks.ts
export async function emitWebhookEvent(workspaceId: string, eventType: WebhookEventType, data: unknown): Promise<void>;
// inserta un message por endpoint habilitado suscrito y start(deliverWebhookMessage, [{messageId}]) cada uno; errores → console.error, jamás rompen al caller
```
Workflow: `for (i, delay) of RETRY_DELAYS_MS`: `if (delay) await sleep(ms(delay))` (verificar export real de `workflow`: si `sleep` acepta string, usar `'5s'`-style; adaptar al API real del paquete instalado) → `const r = await attemptDelivery({messageId, attemptN: i+1})` → si `r.done` return. Al agotar: `await finalizeExhausted({messageId})`. `attemptDelivery` (step): carga message+endpoint (si faltan o endpoint disabled → `{done:true}`); firma con timestamp fresco; `fetch(url, {method:'POST', redirect:'error', signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS), headers: {'content-type':'application/json', 'webhook-id', 'webhook-timestamp', 'webhook-signature'}, body: envelope})`; registra fila en `api_webhook_attempts`; éxito → update message `delivered` + endpoint `first_failing_at = null` → `{done:true}`; fallo → endpoint `first_failing_at ??= now` → `{done:false}`. `finalizeExhausted`: message `exhausted`; si `shouldDisableEndpoint` → endpoint `status='disabled', disabled_at=now`.

- [ ] **Step 1: test que falla** (solo policy.ts) — schedule tiene 8 entradas y suma ~28h; `isDeliverySuccess(204)===true`, `(301)===false`, `(429)===false`; `shouldDisableEndpoint(null, now)===false`, `(now-4d)===false`, `(now-5d1m)===true`.
- [ ] **Step 2:** FAIL → **Step 3:** implementar policy + workflow + steps + emitWebhookEvent → **Step 4:** PASS + `npx tsc --noEmit`.
- [ ] **Step 5:** commit `feat(api): entrega durable de webhooks (schedule Svix, timeout 10s, desactivación 5 días)`.

### Task 12: Servicio trial-balances

**Files:**
- Create: `src/lib/api/trial-balances.ts`
- Test: `src/lib/api/__tests__/trial-balances.test.ts`

**Interfaces:**
- Consumes: `parseTrialBalanceCSV`, `preprocessTrialBalance`, tipos de `@/lib/preprocessing/trial-balance`; `encryptSecret/decryptSecret` del vault; `toJsonSafe` de `@/lib/preprocessing/json-safe`; tablas Task 5; `emitWebhookEvent` (Task 11).
- Produces:
```ts
export const PREPROCESSOR_CONTRACT_VERSION = 'tb-2026-08-19';
export interface TrialBalanceSummary { status: 'balanced' | 'unbalanced'; row_count: number; period_label: string;
  control_totals: { activo: Money; pasivo: Money; patrimonio: Money; ingresos?: Money; equation_delta: Money };
  findings: { discrepancies: number; curator: number } }
export interface Money { amount: string; currency: 'COP' }
export function centsToMoney(v: bigint): Money;
export function buildRawRowsFromInput(input: { csv?: string; rows?: RawRowInput[]; period_label?: string }):
  { ok: true; rows: RawAccountRow[] } | { ok: false; code: 'empty_trial_balance' };
export function summarize(pre: PreprocessedBalance, periodLabel: string): TrialBalanceSummary;
// status = 'balanced' si |activo - (pasivo+patrimonio)| === 0n en cents del snapshot primario
export function serializeTrialBalance(id: string, row: { createdAt: Date; summary: TrialBalanceSummary; preprocessorVersion: string }): Record<string, unknown>; // shape público snake_case de la spec §7
export function serializeTrialBalanceDetail(base: ReturnType<typeof serializeTrialBalance>, pre: PreprocessedBalance): Record<string, unknown>; // + discrepancies[] y curator_findings[] (map allowlist de Discrepancy: location, reported, calculated, difference, description)
export async function createTrialBalance(db, input: { workspaceId: string; body: unknown; idempotencyKey: string | null }): Promise<{ status: 201; body } | { status: 400 | 422; problem: ProblemCode; errors?: ProblemValidationError[] }>;
export async function getTrialBalanceDetail(db, workspaceId: string, publicId: string): Promise<Record<string, unknown> | null>; // decrypt + recompute
export async function listTrialBalances(db, workspaceId: string, page): Promise<{ data: unknown[]; has_more: boolean; next_cursor: string | null }>;
export async function deleteTrialBalance(db, workspaceId: string, publicId: string): Promise<boolean>;
```
Nota de implementación: los nombres exactos de los campos cents del `PeriodSnapshot` (p.ej. `controlTotalsCents.activo`) se leen del código real en `src/lib/preprocessing/trial-balance.ts` (interfaces `ControlTotalsCents`/`PeriodSnapshot`) — adaptar el `summarize` a esos nombres, no inventar.

- [ ] **Step 1: test que falla** — con `UTOPIA_VAULT_KEY` seteado en el test: `buildRawRowsFromInput({csv: '<fixture mínimo: clase 1 = clase 2+3, 6 filas>'})` produce filas; `summarize` de un balance cuadrado → status 'balanced' y `equation_delta.amount === '0'`; de uno descuadrado → 'unbalanced'; `centsToMoney(150000n)` → `{amount:'150000', currency:'COP'}`; roundtrip cifrado: encrypt(JSON rows) → decrypt → mismas filas; `buildRawRowsFromInput({csv: 'basura sin columnas'})` → `empty_trial_balance`; serialize produce snake_case (`period_label`, `control_totals`, `created_at` RFC3339 con Z).
- [ ] **Step 2:** FAIL → **Step 3:** implementar → **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(api): servicio trial-balances (preprocesador determinista + vault + recompute-on-read)`.

### Task 13: Contrato Zod + OpenAPI 3.1.2 + anti-drift

**Files:**
- Create: `src/lib/api/schemas.ts`, `src/lib/api/openapi.ts`
- Test: `src/lib/api/__tests__/openapi.test.ts`

**Interfaces (Produces):**
```ts
// schemas.ts — TODOS strict (minimización Ley 1581):
export const RawRowInputSchema = z.strictObject({ code: z.string().min(1).max(20), name: z.string().max(300),
  level: z.string().max(20), transactional: z.boolean(), balances_by_period: z.record(z.string().max(10), z.number()) });
export const TrialBalanceCreateSchema = z.strictObject({ period_label: z.string().max(20).optional(),
  csv: z.string().max(2_000_000).optional(), rows: z.array(RawRowInputSchema).max(20_000).optional() })
  .refine(v => Boolean(v.csv) !== Boolean(v.rows), { message: 'Enviar exactamente uno: csv o rows' });
export const WebhookEndpointCreateSchema = z.strictObject({ url: z.string().max(2000), description: z.string().max(500).optional(),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1) });
export const WebhookEndpointUpdateSchema = z.strictObject({ url: …optional, description: …optional, events: …optional, status: z.enum(['enabled','disabled']).optional() });
// openapi.ts
export function buildOpenApiDocument(): Record<string, unknown>; // openapi: '3.1.2', info, servers, tags, securitySchemes bearer, paths (TODAS las rutas v1), webhooks: {ping, trial_balance.processed}, components via z.toJSONSchema
export const OPENAPI_PATHS: string[]; // ['/v1/me', '/v1/trial-balances', '/v1/trial-balances/{id}', '/v1/webhook-endpoints', '/v1/webhook-endpoints/{id}', '/v1/webhook-endpoints/{id}/ping', '/v1/openapi.json']
```
`z.record` está bien aquí (NO viaja al LLM). Nota: `z.record` con 2 args es la firma Zod v4.

- [ ] **Step 1: test que falla** — `buildOpenApiDocument()`: `openapi === '3.1.2'`; todas las entradas de `OPENAPI_PATHS` existen en `paths`; el doc serializa a JSON sin throw (sin bigint); `webhooks` contiene las dos claves; **anti-drift**: usando `fs.readdirSync` recursivo sobre `src/app/api/v1`, cada `route.ts` (excepto `docs` y `openapi.json`) mapea a un path declarado — el test convierte `[id]` → `{id}` y antepone `/v1`. (Este test se escribe AHORA y quedará rojo en la parte anti-drift hasta que Task 14 cree las rutas; para mantener el ciclo verde, la aserción anti-drift se activa con `existsSync(src/app/api/v1)` y en esta tarea la carpeta aún no existe.)
- [ ] **Step 2:** FAIL → **Step 3:** implementar → **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(api): contrato Zod estricto + documento OpenAPI 3.1.2 generado`.

### Task 14: Rutas v1 + admin + plataforma (proxy, catalog, docs, env, script)

**Files:**
- Create: `src/app/api/v1/me/route.ts`; `src/app/api/v1/trial-balances/route.ts`; `src/app/api/v1/trial-balances/[id]/route.ts`; `src/app/api/v1/webhook-endpoints/route.ts`; `src/app/api/v1/webhook-endpoints/[id]/route.ts`; `src/app/api/v1/webhook-endpoints/[id]/ping/route.ts`; `src/app/api/v1/openapi.json/route.ts`; `src/app/api/v1/docs/route.ts`; `src/app/.well-known/api-catalog/route.ts`; `src/app/api/admin/api-keys/route.ts`; `src/app/api/admin/api-keys/[id]/rotate/route.ts`; `scripts/create-api-key.ts`
- Modify: `src/proxy.ts`, `.env.example`, `package.json` (script `api:create-key`), `CLAUDE.md` (fila en "Where to look")

**Interfaces:** consume todo lo anterior. Contratos por ruta (status/headers exactos):

| Ruta | Auth | Contrato |
|---|---|---|
| GET /v1/me | cualquiera scope | 200 `{object:'api_key', name, workspace:{id? NO — solo nit,name}, scopes[], rate_limits:{read_rpm,write_rpm}, mode}` |
| POST /v1/trial-balances | `trial_balances:write` + idempotente (`idempotencyEndpoint:'trial-balances.create'`) | 201 + `Location: /api/v1/trial-balances/{id}` + emit `trial_balance.processed`; 400/422 según Task 12 |
| GET /v1/trial-balances | `trial_balances:read` | 200 `{data,has_more,next_cursor}` + `Link: <…>; rel="next"` si hay más |
| GET /v1/trial-balances/{id} | read | 200 detalle recomputado; id malformado o ajeno → 404 uniforme |
| DELETE /v1/trial-balances/{id} | write | 204 sin body; ajeno → 404 |
| POST /v1/webhook-endpoints | `webhooks:manage` | 201 con `secret` UNA VEZ; URL inválida → 422 `validation_failed` con pointer /url |
| GET /v1/webhook-endpoints | manage | 200 lista (sin secreto; `secret_preview: 'whsec_…'+last4`) |
| GET /v1/webhook-endpoints/{id} | manage | 200 + `ETag: "W/<updated_at ms>"` fuerte → usar hash sha256 corto del row |
| PATCH /v1/webhook-endpoints/{id} | manage | exige `If-Match` (sin él → 428; distinto → 412); 200 |
| DELETE /v1/webhook-endpoints/{id} | manage | 204 |
| POST /v1/webhook-endpoints/{id}/ping | manage | 202 `{message_id}` — emite evento `ping` solo a ese endpoint |
| GET /v1/openapi.json | **público** (sin llave) | 200 doc + `Cache-Control: public, max-age=300` |
| GET /v1/docs | público | 200 HTML server-rendered desde el doc OpenAPI (sin scripts externos — CSP) |
| GET /.well-known/api-catalog | público | 200 `application/linkset+json` RFC 9727: linkset con `service-desc` → openapi.json, `service-doc` → /api/v1/docs |
| POST /api/admin/api-keys | `checkAdminToken` | body `{workspace_id | workspace:{name,nit?}, name, scopes?, mode?, expires_days?}` → 201 con `token` UNA VEZ |
| GET /api/admin/api-keys | admin | lista con prefix+last4, sin hash |
| DELETE /api/admin/api-keys?id= | admin | revoca (`revoked_at`, `revoked_reason`) |
| POST /api/admin/api-keys/{id}/rotate | admin | crea nueva con mismos scopes, vieja `expires_at=now()+7d`, `rotated_from_key_id` |

`src/proxy.ts` (3 ediciones quirúrgicas + request-id):
```ts
const AUTH_EXEMPT_APIS = [ …existentes, '/api/v1/' ]; // autentica con llave propia (Bearer) dentro del handler
const CSRF_ALLOWLIST = [ …existentes,
  // API pública de clientes: server-to-server con Bearer utop_sk_*; sin Origin por diseño.
  '/api/v1/' ];
const RATE_LIMITS = { …existentes, '/api/v1': 120 }; // backstop IP; cuota real por llave en el handler
```
y en la rama API: generar `requestId` una vez, propagarlo como request header `x-request-id` (patrón x-nonce) y usar el MISMO valor en el response header `X-Request-Id`.

`.env.example`: bloque `UTOPIA_API_KEY_PEPPER=` con instrucción de generación (`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`).
`scripts/create-api-key.ts`: parsea `--workspace <uuid> | --workspace-name <str>`, `--name`, `--scopes a,b`, `--test`, `--expires-days N`; usa `generateApiKeyToken` + `getDb()`; imprime el token una vez con advertencia. `package.json`: `"api:create-key": "dotenv -e .env.local -- tsx scripts/create-api-key.ts"`.
`CLAUDE.md`: fila `| API público de clientes (/api/v1): contrato, llaves, webhooks | [docs/spec/api-clientes-v1.md](docs/spec/api-clientes-v1.md) |`.

- [ ] **Step 1:** crear rutas v1 (usar `withApiV1`; rutas dinámicas Next 16: `{ params }: { params: Promise<{ id: string }> }`).
- [ ] **Step 2:** rutas admin + script + proxy + env + CLAUDE.md.
- [ ] **Step 3:** `npx vitest run src/lib/api` → el anti-drift de Task 13 ahora valida las rutas reales → PASS.
- [ ] **Step 4:** `npx tsc --noEmit` → PASS.
- [ ] **Step 5:** commit `feat(api): rutas /api/v1 + admin de llaves + catálogo RFC 9727 + integración proxy`.

### Task 15: Verificación final

- [ ] **Step 1:** `npx tsc --noEmit` limpio.
- [ ] **Step 2:** `npm run lint` COMPLETO limpio (gate 0-errores del repo) + `npm run lint:strict-mode`.
- [ ] **Step 3:** `npx vitest run` suite completa verde (incluye baseline previo).
- [ ] **Step 4:** `npm run build` verde.
- [ ] **Step 5:** commit final si hubo fixes: `fix(api): ajustes de verificación (lint/build)`.

## Self-Review (ejecutado al escribir)

1. **Cobertura spec→plan:** §1 recursos → Tasks 12/14; §5 modelo → Task 5; §6 transversal → Tasks 3/6/7/8/9; §7 → Task 12; §8 llaves → Tasks 4/14(admin+rotate); §9 webhooks → Tasks 10/11/14; §10 seguridad → distribuida (SSRF T10, BOLA T12/14 vía workspace_id, PII: constraints globales); §11 testing → cada task + T15; §12 rollout → T14 (env/proxy) + doc; OpenAPI/catalog §1/§4 → T13/14. Sin huecos.
2. **Placeholders:** ninguno — cada task trae firmas exactas y casos de test concretos; el único "adaptar al código real" es la lectura de nombres de campos cents del preprocesador (T12) y el export exacto de `sleep` del paquete workflow (T11), ambos señalados como verificación contra código fuente existente, no como TBD de diseño.
3. **Consistencia de tipos:** `DynamicRateLimitResult` (T6) usada por `enforceKeyRateLimit` (T6→T9); `IdempotencyStore` (T8) consumida por `withApiV1` (T9); `WEBHOOK_EVENT_TYPES` (T10) usada por schemas (T13) y ping (T14); `newTypeId` (T2) usada en T9/T12/T14. Nombres verificados coincidentes.
