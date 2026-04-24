# Sprint 3 — ERP Credential Vault: Architecture & Migration Plan

**Author**: Agent C1 (research) — for Johan's approval
**Date**: 2026-04-24
**Status**: Decision-ready draft
**Target stack**: Next.js 16 App Router, Node.js 24 LTS on Vercel Fluid Compute, AI SDK v6, Zod v4

---

## 1. Problem statement

Today, 10 ERP credentials (Alegra, Siigo, Helisa, World Office, ContaPyme, SAP B1, Dynamics 365, QuickBooks, Xero, Odoo) are stored in the browser at `localStorage['utopia_erp_connections']`, base64-encoded plaintext. This is referenced from five components (`ERPConnector.tsx`, `ChatSidebar.tsx`, `ChatWorkspace.tsx`, `ExecutiveDashboard.tsx`, `SecuritySection.tsx`) and re-sent on every `/api/erp/*` and `/api/chat` call.

**Threats**:

1. **XSS exfiltration** — any injected script (React markdown renderer, third-party widget, compromised npm dep) reads the key in one line. Base64 is not encryption.
2. **No audit trail** — we cannot prove to a DIAN auditor who read or used a credential.
3. **No rotation** — tokens expire silently; refresh tokens are stored in clear; no centralized revocation.
4. **No multi-device sync** — Johan logs in from laptop + phone and re-enters credentials each time.
5. **No server policy** — we cannot enforce "redact on echo", rate-limit access, or revoke on anomalous IP.
6. **Habeas Data (Ley 1581/2012) exposure** — NITs and tokens are "datos personales sensibles" in the client with no consent trail.

Sprint 3 must move the source of truth server-side, encrypt at rest, and leave a single-client-device UX unchanged on day one.

---

## 2. Requirements

### Functional
- `GET /api/credentials` — list credentials for the authenticated user, **masked only** (no raw secrets in response).
- `POST /api/credentials` — create new credential entry (encrypt + persist).
- `PUT /api/credentials/:id` — update fields (re-encrypt).
- `DELETE /api/credentials/:id` — hard-delete + write tombstone audit log.
- `POST /api/credentials/:id/test` — decrypt server-side, call `connector.testConnection`, never return raw secret.
- Sync trigger: `/api/erp/sync` consumes the credential by `id` (not by raw credential payload in the request body anymore).
- Status reporting: `lastSync`, `status`, `error` on each row.

### Security
- **Encryption at rest**: AES-256-GCM, unique 12-byte IV per credential.
- **Key management**: envelope encryption with master DEK in Vercel env var; rotation without re-encrypting every row (KEK → DEK pattern).
- **Audit log**: append-only, 24-month retention.
- **Rotation support**: token `expiresAt` column + lazy refresh on read.
- **Deletion/revocation**: hard delete row, retain audit log of deletion.
- **Server-only decryption**: decrypted values never cross the serverless boundary except when making the outbound ERP call.

### Operational
- **Latency**: p95 < 100 ms for `GET /api/credentials` (list, masked).
- **Cost**: target < $5 USD/month for solo dev at MVP traffic. Free tier of Neon + Clerk covers it.
- **Observability**: structured logs (`logger.info({ userId, credentialId, action })`), Vercel Log Drain optional.
- **Backup/restore**: Neon point-in-time restore (7 days on free, 30 days on paid). Daily logical dump to Vercel Blob private bucket (cron).

### Migration
- **Zero visible downtime**: users keep existing localStorage credentials working for 30 days via a dual-read adapter.
- **Idempotent import**: a "Importar al vault" button POSTs each localStorage entry; re-runs are safe.

---

## 3. Stack options (compared)

### Option A — Neon Postgres + pgcrypto (column-level encryption)

| Dimension | Detail |
|---|---|
| Storage | Neon Serverless Postgres (Vercel Marketplace native) |
| Encryption | `pgcrypto.pgp_sym_encrypt(secret, key)` per column, OR app-side AES-GCM before insert |
| Key mgmt | Master key in `CREDENTIAL_MASTER_KEY` env var; pass to pgcrypto via SET LOCAL |
| Auth integration | Uses `session.userId` from Clerk as row-level partition key |
| Cost | Free tier: 0.5 GB storage, 190 compute-hours, 1 project. ~$0/mo at MVP |
| Vercel integration | Native Marketplace. `npm i @neondatabase/serverless` (driver v1.x) auto-provisions `DATABASE_URL`, `DATABASE_URL_UNPOOLED` |
| Ops complexity | **Medium** — need SQL schema, migrations (`drizzle-kit` or `node-pg-migrate`), typed client |
| Pros | ACID, queries, joins, RLS, mature, rich audit log pattern (INSERT triggers), JSON columns for flexible credential shape, branching for staging |
| Cons | Most code to write upfront (migrations, typed queries); pgcrypto less standard than app-level AES-GCM |

### Option B — Vercel Blob (private) + app-level AES-GCM via `node:crypto`

| Dimension | Detail |
|---|---|
| Storage | Vercel Blob, private bucket, one JSON blob per credential at path `vault/{userId}/{credentialId}.json.enc` |
| Encryption | App-level AES-256-GCM using Node 24's built-in `node:crypto` |
| Key mgmt | Master key in `CREDENTIAL_MASTER_KEY`; envelope: per-tenant DEK wrapped by KEK |
| Auth integration | Clerk user ID becomes blob prefix |
| Cost | Blob: 5 GB storage + 100 GB bandwidth free. ~$0/mo at MVP |
| Vercel integration | First-party (`@vercel/blob`), dead simple. Private access via signed URLs or server-only reads |
| Ops complexity | **Low** — no migrations, no schema. Trivial to start |
| Pros | Zero-migration path; file-per-credential is conceptually simple; fine-grained deletion; envelope encryption plays naturally |
| Cons | No query/index (must LIST blobs to enumerate; wasteful). No joins. Audit log needs separate store. Latency ~50-150 ms per read. Concurrent writes on same key risk last-write-wins |

### Option C — Upstash Redis (TLS) + app-level encryption

| Dimension | Detail |
|---|---|
| Storage | Upstash Redis (Vercel Marketplace). Key: `vault:{userId}:{credentialId}` → encrypted JSON value |
| Encryption | App-level AES-256-GCM; envelope same as Option B |
| Key mgmt | Master key in env; DEK-per-tenant cached in-memory |
| Auth integration | Clerk user ID is key prefix |
| Cost | Free tier: 500k commands/mo, 256 MB. ~$0/mo at MVP |
| Vercel integration | Marketplace; auto-provisioned `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` |
| Ops complexity | **Low** — REST client, no schema |
| Pros | Sub-10 ms reads; TTL native for token rotation; MULTI for atomic update; scales to many users trivially |
| Cons | **Not durable enough as primary store for auditable records**; Colombian retention norms expect persisted records, Redis (even Upstash's persistent tier) is positioned as cache; no SQL; audit log must live elsewhere; hard to run complex reports (who has Alegra?); eviction semantics on free tier |

### Option D (hybrid) — Neon Postgres for metadata + audit + Vercel Blob for encrypted payloads

| Dimension | Detail |
|---|---|
| Storage | Neon: `credentials` table (id, userId, provider, companyName, blobKey, maskedHint, expiresAt, createdAt). Blob: the encrypted `ERPCredentials` JSON |
| Encryption | App-level AES-256-GCM on the blob |
| Ops complexity | **High** — two stores, two clients, more moving parts |
| Pros | Separates metadata (frequent reads) from secrets (rare reads at connect/sync time). Theoretical "limit blast radius if DB leaks, since only ciphertext is in Blob and masters live in env" — but the Blob key + Neon URL both live in Vercel env anyway, so this is marginal |
| Cons | 2× surface area, 2× failure modes, 2× backup plans, 2× debugging |

---

## 4. Recommendation

**Pick Option A: Neon Postgres, with app-level AES-256-GCM encryption in Node (not pgcrypto).**

### Why this wins for Johan

1. **Auth-ready substrate.** Clerk (our auth pick — see section 8) webhooks push user events into Neon easily. All other features Johan will build next (conversation history server-side, shared workspaces, multi-tenant billing) need a relational DB anyway. Picking Neon now means Sprint 3 doubles as the platform's DB foundation.
2. **Ops burden is a one-time cost.** A single migration file + Drizzle ORM schema is ~150 LOC and Johan writes it once. In return he gets: queryability ("which users still have expired QuickBooks tokens?"), RLS policies, audit joins, branching for preview deploys.
3. **Cost is effectively zero** at MVP traffic (free tier covers ~tens of thousands of reads/day).
4. **Compliance fit for Ley 1581/2012.** Auditable INSERT/DELETE triggers; defined retention on audit table; can produce a "datos personales" export on demand (ARCO rights: Acceso, Rectificación, Cancelación, Oposición).
5. **Migration is safe.** Drizzle migrations give Johan a textual diff for each schema change, reviewable in PR.
6. **App-level AES-GCM (not pgcrypto)** because:
   - The Node 24 `node:crypto` API is stable, zero-dependency, widely audited.
   - Keeps the DB dump opaque even if a misconfigured psql session leaks the master key (pgcrypto needs the key passed in the query, which ends up in query logs unless every caller is disciplined).
   - Portable: if we ever migrate stores, ciphertext moves unchanged.

### Why not each alternative
- **B (Blob-only)**: no query layer; listing all Alegra users requires fetching every blob.
- **C (Redis)**: persistence guarantees are not auditor-grade for the Colombian context.
- **D (hybrid)**: 2× the ops burden for a marginal security win over A.

---

## 5. Encryption model

### Scheme — envelope encryption

```
                    CREDENTIAL_MASTER_KEY (env var, 32 bytes)
                           │
                           ▼
                 ┌─────────────────────┐
                 │ KEK (Key-Encrypting │  lives only in process memory,
                 │ Key, per process)   │  derived once per cold start
                 └─────────────────────┘
                           │
                    wraps/unwraps
                           ▼
                 ┌─────────────────────┐
                 │ DEK (Data-Encrypting│  stored encrypted in the
                 │ Key, per tenant)    │  `tenants.dek_wrapped` column
                 └─────────────────────┘
                           │
                    encrypts/decrypts
                           ▼
                 ┌─────────────────────┐
                 │ Credential row      │  `credentials.ciphertext_b64`
                 └─────────────────────┘
```

### Concrete choices
- **Algorithm**: AES-256-GCM (FIPS-140-compatible, authenticated).
- **IV (nonce)**: 12 bytes, random per encryption (`crypto.randomBytes(12)`). **Never reuse an IV with the same key.**
- **Auth tag**: 16 bytes, stored alongside ciphertext.
- **Storage format**: single base64url string of `version(1B) || iv(12B) || tag(16B) || ciphertext(N)`. Version byte allows future algorithm rotation.
- **Key derivation**: master key raw bytes are the KEK (HKDF only if we later derive domain-separated sub-keys; not needed for v1).

### Pseudocode (server-only, `src/lib/crypto/vault.ts`)

```ts
// ILLUSTRATIVE — not production-ready. Reviewed in implementation sprint.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 0x01;
const KEK = Buffer.from(process.env.CREDENTIAL_MASTER_KEY!, 'base64'); // 32B

export function encrypt(plaintext: string, dek: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ct]).toString('base64url');
}

export function decrypt(packed: string, dek: Buffer): string {
  const buf = Buffer.from(packed, 'base64url');
  const [version, iv, tag, ct] = [buf[0], buf.subarray(1, 13), buf.subarray(13, 29), buf.subarray(29)];
  if (version !== VERSION) throw new Error('Unsupported ciphertext version');
  const decipher = createDecipheriv('aes-256-gcm', dek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
```

### Master key source
- `CREDENTIAL_MASTER_KEY` as a Vercel env var, Production + Preview + Development scopes.
- Generated once: `openssl rand -base64 32`.
- **Never** committed. **Never** passed to the client. **Never** logged.
- Add to `next.config.ts` CSP: no impact (server-only).

### Rotation strategy
- Store `key_version` on each ciphertext row.
- Monthly/on-demand: add `CREDENTIAL_MASTER_KEY_V2`, mark new writes with v2.
- Background job (future): decrypt+re-encrypt v1 rows into v2.
- For DEK rotation: write `tenants.dek_wrapped_v2`, re-encrypt all credentials for that tenant in a transaction.

### Per-credential vs per-tenant envelope
- **Per-tenant DEK** (recommended). One DEK per `tenantId`, wrapped by KEK. This enables "delete tenant" ≡ drop DEK row ≡ cryptographic shredding of all credentials for that tenant in one SQL statement.
- Per-credential DEK is overkill for MVP; adds I/O on every call.

### Where decryption happens
- **Only** inside `/api/credentials/:id/test`, `/api/erp/sync`, and `/api/erp/refresh` — all Node.js runtime (not Edge; Edge has no `node:crypto` AES-GCM).
- Decrypted value lives in a local `const` inside the handler and is discarded on return.
- **Never** returned to the client. The client only sees masks: `{ provider, companyName, maskedHint: "API Token ••••1234", lastSync, status }`.

---

## 6. API contract

All endpoints require Clerk session cookie; a 401 is returned otherwise. All responses are JSON. All routes run the Node.js runtime (not Edge) because `node:crypto` is required for AES-GCM decryption and our ERP connectors use Node APIs.

### 6.1 `GET /api/credentials`

**Response 200**
```json
{
  "credentials": [
    {
      "id": "cr_01JTB...",
      "provider": "alegra",
      "companyName": "ACME SAS",
      "companyNit": "900123456-7",
      "maskedHint": "usuario@empresa.com · token ••••a7f3",
      "status": "connected",
      "connectedAt": "2026-04-10T14:22:11Z",
      "lastSync": "2026-04-23T09:15:03Z",
      "expiresAt": null
    }
  ]
}
```

### 6.2 `POST /api/credentials`

**Request**
```json
{
  "provider": "alegra",
  "companyName": "ACME SAS",
  "companyNit": "900123456-7",
  "credentials": { "username": "usuario@empresa.com", "apiToken": "<raw>" }
}
```
Server validates with `credentialsSchema` (Zod), calls `connector.testConnection(creds)`, and only persists if the test passes.

**Response 201**
```json
{ "id": "cr_01JTB...", "maskedHint": "usuario@empresa.com · token ••••a7f3" }
```

### 6.3 `PUT /api/credentials/:id`

**Request**: partial body (e.g. new `refreshToken`). Server re-encrypts and bumps `updated_at`.

**Response 200**: same shape as GET (single entry).

### 6.4 `DELETE /api/credentials/:id`

**Response 204**. Writes a `deleted` row in `credential_audit_log`.

### 6.5 `POST /api/credentials/:id/test`

**Response 200** on success: `{ ok: true, latencyMs: 312 }`. **401** on invalid credentials. Raw credential never echoed.

### 6.6 Updated downstream routes

- `/api/erp/sync` stops accepting `credentials` in the request body. New contract:
  ```json
  { "credentialId": "cr_01JTB...", "syncType": "trial_balance", "period": "2025" }
  ```
  The handler loads + decrypts server-side, then delegates to the connector. This is the single biggest security win of Sprint 3.

- `/api/erp/connect` becomes a pass-through to `POST /api/credentials` (kept as alias for one release, then removed).

### Response masking rule
Define `maskField(value)` centrally: `value.slice(0, 2) + '•'.repeat(Math.max(0, value.length - 6)) + value.slice(-4)`. Apply on every write of metadata. Raw bytes never leave the decrypt boundary.

---

## 7. Migration plan (phases)

### Phase 1 — Dual-write, dual-read (days 1–3 of sprint)

- **Files touched**:
  - NEW: `src/lib/vault/client.ts` (client-side abstraction with `listCredentials`, `createCredential`, etc.)
  - NEW: `src/app/api/credentials/route.ts`, `src/app/api/credentials/[id]/route.ts`, `src/app/api/credentials/[id]/test/route.ts`
  - NEW: `src/lib/crypto/vault.ts`, `src/lib/db/schema.ts` (Drizzle), `src/lib/db/client.ts`
  - EDIT: `src/components/workspace/ERPConnector.tsx` — replace `loadConnections()` with `async () => { try { return await vault.list(); } catch { return loadLocalStorage(); } }`. Writes go to both stores.
  - EDIT: 4 other consumers (`ChatSidebar.tsx`, `ChatWorkspace.tsx`, `ExecutiveDashboard.tsx`, `ResetSection.tsx`) to read from the vault API.
- **Rollback**: delete the new API routes; components fall back to localStorage branch.
- **Verification**: new credential flows hit Neon (check `SELECT * FROM credentials LIMIT 5`); old localStorage entries still readable.
- **Risk**: **Low**. Pure additive.

### Phase 2 — Migration UI (day 4)

- **Files touched**:
  - EDIT: `src/components/settings/sections/SecuritySection.tsx` — add "Importar credenciales al vault seguro" button + progress indicator.
  - NEW: `src/lib/vault/migrate.ts` — iterate localStorage entries, POST each.
- **Rollback**: remove the button; data already in vault stays.
- **Verification**: button idempotent (running twice produces no duplicates; dedupe on `(userId, provider, companyNit)`).
- **Risk**: **Low**.

### Phase 3 — Deprecate localStorage read path (day 10, after 7-day soak)

- **Files touched**: the 5 consumers lose their localStorage fallback branch; keep localStorage **write** for 30 days as a panic restore.
- **Rollback**: single-line revert of the fallback removal.
- **Verification**: clear localStorage in Chrome DevTools; ERP list still renders from server.
- **Risk**: **Medium**. Users without migration may see empty state. Mitigation: in-app banner 7 days prior.

### Phase 4 — Full removal (day 40)

- **Files touched**: remove all `localStorage.getItem('utopia_erp_connections')` and sibling setItem calls; remove `STORAGE_KEY` from `ResetSection.tsx`, `SecuritySection.tsx`.
- **Rollback**: git revert the PR.
- **Verification**: grep `utopia_erp_connections` returns zero matches outside changelog.
- **Risk**: **Low** (by this point all active users have migrated).

---

## 8. Auth dependency

**Recommendation: Clerk**, provisioned via Vercel Marketplace.

**Rationale**: Clerk is first-party on the Vercel Marketplace (auto-provisioned env vars, unified billing), ships a `@clerk/nextjs` middleware that composes with Next.js 16 proxy/middleware, and has a free tier of 10k MAU — Johan's MVP uptake will not approach that. For a solo Colombian-accounting founder, the value is "sign-in UI, password reset, email verification, magic link, MFA TOTP, session management, user JSON webhook into Neon" out of the box — none of which Johan should spend a sprint on. Auth.js is cheaper but you build more; Descope is good but less common, and Sign-in-with-Vercel ties users to Vercel accounts (unsuitable for accounting clients).

**Minimal integration scope**:
- `src/middleware.ts` — wrap existing rate-limit / CSRF middleware with `clerkMiddleware()` so every `/api/*` request has `await auth()` available.
- New routes to protect: `/api/credentials/*`, `/api/erp/sync`, `/api/erp/connect`, `/api/chat`, `/api/financial-*`.
- Public routes: landing page, `/api/erp/providers` (read-only, no PII).
- UI: `<SignInButton />` in the top nav; on protected routes, `auth().redirectToSignIn()` server-side.
- Env vars auto-injected: `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.
- Webhook: `user.created` POSTs a row into `tenants` (and generates its DEK).

---

## 9. Audit logging

### Events (complete enum)

| Action | Trigger |
|---|---|
| `credential.create` | POST /api/credentials success |
| `credential.read` | Every decryption (sync, test, refresh) — **this is the "sensitive read"** |
| `credential.update` | PUT success |
| `credential.delete` | DELETE success |
| `credential.test` | POST /api/credentials/:id/test (regardless of result) |
| `credential.export` | future: GDPR/Habeas Data export endpoint |
| `credential.rotate` | DEK/KEK rotation jobs |

### Storage

Same Postgres DB, separate table `credential_audit_log` (append-only; `REVOKE UPDATE, DELETE` via `GRANT` on the role; a DB trigger blocks updates).

### Retention

**24 months.** Rationale: aligned with Colombian accounting retention for supporting documents (DIAN doctrine) while shorter than the 5-year "libros contables" rule because credentials are *access* metadata, not *accounting records*. A monthly cron (`/api/internal/audit-gc`, Vercel Cron Job) deletes rows older than 24 months and writes a single "gc" summary row.

### Schema

```sql
CREATE TABLE credential_audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp    timestamptz NOT NULL DEFAULT now(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  user_id      text NOT NULL,              -- Clerk user id
  action       text NOT NULL,              -- enum above
  credential_id uuid,                      -- null for gc / rotation ops
  provider     text,                       -- e.g. 'alegra'
  ip           inet,
  user_agent   text,
  result       text NOT NULL,              -- 'ok' | 'error' | 'forbidden'
  error_code   text,
  metadata     jsonb                       -- small: e.g. { latencyMs: 312 }
);
CREATE INDEX idx_cal_tenant_time ON credential_audit_log (tenant_id, timestamp DESC);
CREATE INDEX idx_cal_credential  ON credential_audit_log (credential_id);
```

Optional: mirror high-severity events (`credential.delete`, repeated `credential.read` failures) to a Vercel Log Drain for out-of-band SIEM-style retention.

---

## 10. Colombian compliance notes

### Ley 1581/2012 "Habeas Data"

- Credentials + NIT qualify as **datos personales sensibles** (tied to RUT/identity of the data subject) when the NIT belongs to a natural person.
- **Autorización**: the sign-up flow must surface an explicit checkbox "Autorizo el tratamiento de mis datos según la Política de Tratamiento de Datos" — store the consent timestamp alongside the `tenants` row.
- **Finalidad**: the policy must state credentials are used exclusively for authorized ERP sync.
- **Derechos ARCO**: ensure `DELETE /api/credentials/:id` cascades into DEK-level shredding; the audit log retains the delete event but not the secret.
- **Localización**: Vercel has no Colombia region. Data will live in `us-east-1` or `eu-central-1` (Neon-dependent). This is permitted under Ley 1581 Art. 26 ("transferencia internacional") because the US is on the SIC-recognized list with adequate protection contracts; document this in the Privacy Policy. **Action item**: register the international transfer with SIC (`www.sic.gov.co`), low admin burden.

### DIAN retention

- DIAN requires **5-year retention for "libros y registros contables"** (Art. 46 C.Co., Dec. 2106/2019). Credentials are not libros — they are *operational access keys*. However, the *audit log* acts as supporting documentation of data origin, so we conservatively target 24 months; 5 years is available if Johan wants to lean audit-proof (storage cost is negligible).
- The **sync payloads** (trial balances, invoices pulled from ERPs) — when persisted as `/api/financial-report` artifacts — must follow the 5-year rule. Out of scope for Sprint 3 but flag for Sprint 4.

### GDPR parallel

Clerk provides Article 28 DPA; Neon provides SCCs; Vercel provides DPA + subprocessor list. Maintaining Ley 1581 compliance means UtopIA is substantially GDPR-compliant for EU clients. Add a cookie consent banner for the marketing site (separate task).

---

## 11. Effort estimate

Rough solo-dev days assume Johan works with Claude-assist.

| Sub-sprint | Scope | Files | LOC | Days |
|---|---|---|---|---|
| **3.0 Auth bootstrap** | Clerk install, `src/middleware.ts` wire, `tenants` table, webhook handler | 4 new / 1 edit | ~200 | 1.5 |
| **3.1 Vault core** | Drizzle schema + migration, `src/lib/crypto/vault.ts`, `src/lib/db/client.ts`, 4 API routes (list/create/update/delete/test), Zod schemas | 10 new / 0 edit | ~600 | 2.5 |
| **3.2 Consumer migration** | Replace localStorage reads in 5 components, add `src/lib/vault/client.ts`, swap `/api/erp/sync` contract, update `SecuritySection` | 1 new / 7 edit | ~400 | 1.5 |
| **3.3 Migration UI** | "Importar al vault" button, progress indicator, idempotency logic | 1 new / 1 edit | ~150 | 0.5 |
| **3.4 Audit logging** | `credential_audit_log` table, append-only trigger, insert calls on every vault op, audit viewer UI in settings | 2 new / 3 edit | ~250 | 1.0 |
| **3.5 Deprecation cleanup** | Remove localStorage fallbacks after soak, clean tests | 0 new / 7 edit | -200 LOC | 0.5 |
| **Total** | | ~18 new / ~19 edit | ~1400 net | **7.5 dev-days** |

Buffer 30% for unknowns → **~10 calendar days** for Sprint 3.

---

## 12. Open questions for Johan

1. **Auth provider pick** — approve Clerk, or prefer Auth.js (cheaper, more code) / Descope?
2. **Tenant model** —
   - **Single-user tenant** (1 Clerk user = 1 tenant = 1 DEK) — simpler, matches today's single-user UX.
   - **Org-scoped tenant** (Clerk Organizations = tenant, many users share credentials) — required later for accounting firms managing multiple clients.
   - *Recommendation*: start with single-user; design `tenants.owner_user_id` now but allow `tenants.org_id` later without schema break.
3. **Key rotation SLA** — what's the cadence? 90 days default; or "on compromise only"?
4. **Retention for the audit log** — 24 months (my rec) or 60 months to match accounting record retention?
5. **Existing DB contract?** — is there a Neon/Postgres instance already provisioned from previous work I should reuse, or do we provision fresh?
6. **Clerk billing** — confirm the Vercel-managed billing (bundled into Vercel invoice) vs. direct-with-Clerk.
7. **Habeas Data policy copy** — who drafts the formal "Política de Tratamiento de Datos" document (lawyer or template-based)?
8. **Rollout communication** — in-app banner, email, or silent migration with "Settings" notice only?

---

## Appendix — file inventory touched by Sprint 3

**New files**
- `src/lib/db/client.ts` — Neon driver wrapper.
- `src/lib/db/schema.ts` — Drizzle schema: `tenants`, `credentials`, `credential_audit_log`.
- `src/lib/db/migrations/0001_init_vault.sql` — initial migration.
- `src/lib/crypto/vault.ts` — AES-GCM encrypt/decrypt, DEK wrap/unwrap.
- `src/lib/crypto/envelope.ts` — tenant DEK lifecycle.
- `src/lib/vault/client.ts` — server-only repo: `getCredential`, `listCredentials`, `createCredential`, etc.
- `src/lib/vault/migrate.ts` — one-shot localStorage-to-vault import helper.
- `src/app/api/credentials/route.ts` — GET, POST.
- `src/app/api/credentials/[id]/route.ts` — PUT, DELETE.
- `src/app/api/credentials/[id]/test/route.ts` — POST.
- `src/app/api/internal/audit-gc/route.ts` — Vercel Cron target.
- `src/lib/auth/session.ts` — thin wrapper over `auth()` from Clerk.

**Edited files**
- `src/middleware.ts` — wrap with `clerkMiddleware`.
- `src/components/workspace/ERPConnector.tsx` — swap `loadConnections`/`saveConnections` to async vault calls.
- `src/components/workspace/ChatSidebar.tsx` — read credential names from vault (line 744).
- `src/components/workspace/ChatWorkspace.tsx` — stop sending raw credentials; send `credentialId` (line 1095).
- `src/components/workspace/ExecutiveDashboard.tsx` — use vault for summary count (line 91).
- `src/components/settings/sections/SecuritySection.tsx` — add migration button; remove "localStorage" advisory when migration complete.
- `src/components/settings/sections/ResetSection.tsx` — add "reset vault" action (calls DELETE for all).
- `src/app/api/erp/sync/route.ts` — consume `credentialId`, decrypt server-side.
- `src/app/api/erp/connect/route.ts` — rename to alias of POST /api/credentials for one release.
- `.env.local.example` — add `CREDENTIAL_MASTER_KEY`, `DATABASE_URL`, Clerk keys.
- `next.config.ts` — no change (CSP already permits required origins).

**End of document.**
