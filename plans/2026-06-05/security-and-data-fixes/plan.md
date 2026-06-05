# Security & Data Fixes — Ola 1A

**Branch:** `fix/security-ola-1a`
**Description:** Fix 4 security vulnerabilities and 2 data integrity issues identified in the 2026-06-05 audit, using 4 parallel execution streams.

## Goal

Patch the 6 most critical findings from the audit without requiring a full auth system rewrite:
guard the 3 unauthenticated API endpoints, eliminate credentials from localStorage/client payloads,
persist ERP credentials to the AES-256-GCM vault, connect the Verdad dashboard to real DB data,
and resolve the migration journal collision.

---

## Execution Strategy

4 streams run **in parallel**. Stream A must merge before Stream B-step-3 starts (ERP chat fix
depends on DB-stored credential IDs). All other streams are fully independent.

```
Stream A: [ S1: Migrations ] → [ S2: ERP persist ] → [ S3: ERP chat refactor ]
Stream B: [ S4: Realtime guard ]          (independent)
Stream C: [ S5: Dashboard real data ]     (independent)
Stream D: [ S6: Workspace guard helper ]  (independent — used by S4)
```

Recommended order: launch B, C, D in parallel first (all standalone).
Then A sequentially (3 commits). Merge order: D → A → B → C (D provides the guard used in B).

---

## Implementation Steps

### Stream A — ERP Credential Security (3 commits, sequential)

---

#### Step A1: Fix migration journal collision
**Files:**
- `src/lib/db/migrations/0006_nasty_darwin.sql` → rename to `0006b_nasty_darwin.sql`
- `src/lib/db/migrations/meta/_journal.json` — add entry for `0006_banking` and `0006b_nasty_darwin`

**What:**
Two SQL files share the prefix `0006_`. Drizzle Kit's journal only tracks one, making `npm run db:migrate`
unreliable. Rename the conflicting file and add both to the journal with sequential `idx` values.

```json
// _journal.json — add after existing entries:
{ "idx": 5,  "version": "7", "when": 1777762294939, "tag": "0006_banking",        "breakpoints": true },
{ "idx": 6,  "version": "7", "when": 1777762294940, "tag": "0006b_nasty_darwin",  "breakpoints": true },
// ... continue reindexing 0007→idx:7, 0008→idx:8, ... 0011→idx:11
```

**⚠️ Critical:** Re-index ALL subsequent entries (`0007` through `0011`) so `idx` is gapless.
The `when` timestamps can be incremented by 1ms from the previous entry.

**Testing:**
```bash
npm run db:push   # should complete without "duplicate tag" error
```

---

#### Step A2: Persist ERP credentials to vault on connect
**Files:**
- `src/app/api/erp/connect/route.ts` — implement the TODO at line 24-27

**What:**
After `connector.testConnection(creds)` succeeds, call `serializeCredentials(creds)` then
`db.insert(erpCredentials)` with `workspaceId` from `getOrCreateWorkspace()`. Use upsert on
`(workspaceId, provider)` to handle reconnections without duplicate rows.

```typescript
// After line 52 (testConnection passes):
import { serializeCredentials, deserializeCredentials } from '@/lib/erp/credentials';
import { erpCredentials } from '@/lib/db/schema';
import { getDb } from '@/lib/db/client';
import { getOrCreateWorkspace } from '@/lib/db/workspace';

const workspace = await getOrCreateWorkspace();
const { encryptedSecret, metadata } = serializeCredentials(creds);

const db = getDb();
const [savedCred] = await db
  .insert(erpCredentials)
  .values({
    workspaceId: workspace.id,
    provider:    body.provider,      // string from request body
    label:       body.label ?? body.provider,
    encryptedSecret,
    metadata,
  })
  .onConflictDoUpdate({
    target: [erpCredentials.workspaceId, erpCredentials.provider],
    set: { encryptedSecret, metadata, updatedAt: new Date() },
  })
  .returning();

return NextResponse.json({ success: true, credentialId: savedCred.id });
```

**Note:** `onConflictDoUpdate` requires a unique index on `(workspaceId, provider)` — add it
if not present in the schema migration.

**Testing:**
- POST `/api/erp/connect` with valid Siigo creds → response includes `credentialId` UUID
- Check Neon DB: row exists in `erp_credentials` with non-null `encrypted_secret`
- POST again → same row updated (no duplicate), same UUID returned

---

#### Step A3: Replace localStorage ERP creds with server-side lookup
**Files:**
- `src/components/workspace/ChatWorkspace.tsx` — lines 1095-1115 (localStorage read + payload injection)
- `src/app/api/chat/route.ts` — `handleOrchestrated` signature + ERP resolution logic

**What:**
Instead of reading raw credentials from localStorage and sending them as plaintext, send only the
`provider` string in the chat payload. The server looks up the credential by `(workspaceId, provider)`,
decrypts it using `deserializeCredentials`, and passes the decrypted struct to the agent pipeline.

**Client change** (`ChatWorkspace.tsx`):
```typescript
// REMOVE: lines 1095-1106 (localStorage read + base64 decode)
// REPLACE payload injection at line 1114 with:
...(erpProviders.length > 0 ? { erpProviders } : {}),
// where erpProviders: string[] — only provider names, stored in component state
// (set when user connects an ERP via the settings UI, which now returns credentialId)
```

**Server change** (`api/chat/route.ts`):
```typescript
// In handleOrchestrated — replace erpConnections param with erpProviders: string[]
// Add near top of handler:
let resolvedErpConnections: ERPCredentials[] = [];
if (erpProviders?.length) {
  const workspace = await getOrCreateWorkspace();
  const rows = await getDb()
    .select().from(erpCredentials)
    .where(and(
      eq(erpCredentials.workspaceId, workspace.id),
      inArray(erpCredentials.provider, erpProviders),
    ));
  resolvedErpConnections = rows.map(r => deserializeCredentials(r));
}
```

**Testing:**
- Open DevTools → Network → any chat message: confirm no `credentials` object in request body
- ERP-aware answers still work (verify Siigo balance lookup returns real data)
- `localStorage.getItem('utopia_erp_connections')` can remain for UI state (provider list only)

---

### Stream B — Realtime API Guard (1 commit, standalone)

---

#### Step B1: Add workspace validation to `/api/realtime`
**Files:**
- `src/app/api/realtime/route.ts` — top of the `GET` handler (before line 6)

**What:**
Add a `requireWorkspace()` guard that rejects anonymous requests before the OpenAI token is issued.
Uses the same cookie as `getOrCreateWorkspace()` but returns `null` instead of creating a new workspace —
preventing unauthenticated clients from obtaining OpenAI tokens.

```typescript
// New helper — add to src/lib/db/workspace.ts (or inline here):
export async function requireWorkspace(): Promise<Workspace | null> {
  const jar = await cookies();
  const id = jar.get('utopia_workspace_id')?.value;
  if (!id || !isValidUUID(id)) return null;    // UUID format guard
  const found = await getDb()
    .select().from(workspaces)
    .where(eq(workspaces.id, id))
    .limit(1);
  return found[0] ?? null;
}

// In realtime/route.ts, line 4 (before the OpenAI fetch):
export async function GET() {
  const workspace = await requireWorkspace();
  if (!workspace) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // ... existing OpenAI fetch code unchanged ...
}
```

**Also apply `requireWorkspace()` to:**
- `src/app/api/erp/sync/route.ts` — before line 18 (SSRF risk)
- `src/app/api/erp/webhook/[provider]/route.ts` — already uses `timingSafeEqual`, add workspace check

**Testing:**
- `curl http://localhost:3000/api/realtime` (no cookie) → `401 Unauthorized`
- Open app normally (workspace cookie present) → realtime voice still works
- `/api/erp/sync` without cookie → `401`

---

### Stream C — Dashboard Real Data (1 commit, standalone)

---

#### Step C1: Replace mockCompliance with getCachedPillarKpis
**Files:**
- `src/app/workspace/verdad/page.tsx` — convert to async Server Component, replace mock import
- `src/lib/kpis/mocks.ts` — no change (keep mocks for test fixtures, just stop using in prod)

**What:**
`VerdadOverviewPage` currently passes `kpi={mockCompliance}` to `<VerdadArea>` — a hardcoded
fixture frozen to 2026-04-23. Replace with a real server-side fetch using `getCachedPillarKpis`,
keyed to the current workspace and the current calendar month.

```typescript
// src/app/workspace/verdad/page.tsx
import { getCachedPillarKpis } from '@/lib/kpis/cache';
import { getOrCreateWorkspace } from '@/lib/db/workspace';

// Helper (same pattern as cron/erp-sync):
function currentPeriodId(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default async function VerdadOverviewPage() {
  const workspace = await getOrCreateWorkspace();
  const kpis = await getCachedPillarKpis(workspace.id, currentPeriodId());

  // Map PillarKpis → KpiResult shape that VerdadArea expects:
  const kpi = buildKpiResult(kpis);   // helper to map PillarKpis → KpiResult

  return (
    <AreaShell areaAccent="verdad">
      <VerdadArea kpi={kpi} lastOpinion="favorable" />
    </AreaShell>
  );
}
```

**Note:** `VerdadArea` receives a `KpiResult` type. `PillarKpis` has different field names — need a
`buildKpiResult(pillar: PillarKpis): KpiResult` mapper. Check `src/lib/kpis/types.ts` for the
`KpiResult` interface to build this adapter. If the shapes are incompatible, document the
mismatch as a TODO rather than silently casting.

**Error handling:** Wrap in `try/catch` — if DB is down, fall back to mocks with a `console.warn`.

**Testing:**
- With Neon DB connected: Dashboard shows real numbers (will be `0` or near-`0` if no data yet)
- Verify cache works: two navigations to `/workspace/verdad` → only one DB query in 60s window
- Verify workspace isolation: two workspaces → each sees their own numbers

---

### Stream D — Workspace Guard Helper (1 commit, standalone)

---

#### Step D1: Add `requireWorkspace()` + UUID validation to workspace.ts
**Files:**
- `src/lib/db/workspace.ts` — add `requireWorkspace()` export + UUID regex guard

**What:**
Extract the shared guard logic so Stream B (realtime route) and any future route can use it.
This is the foundation step that Stream B depends on — do D before B.

```typescript
// src/lib/db/workspace.ts — add after getOrCreateWorkspace():
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Returns the workspace for the current request's cookie, or null if the
 * cookie is absent, malformed, or doesn't match any workspace in the DB.
 *
 * Unlike getOrCreateWorkspace(), this never creates a new workspace.
 * Use this to gate sensitive endpoints (realtime, ERP sync, etc.).
 */
export async function requireWorkspace(): Promise<Workspace | null> {
  const jar = await cookies();
  const id = jar.get(COOKIE_NAME)?.value;
  if (!id || !UUID_RE.test(id)) return null;
  const found = await getDb()
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, id))
    .limit(1);
  return found[0] ?? null;
}
```

**Testing:**
- Unit test (vitest): `requireWorkspace()` returns `null` for missing cookie, invalid UUID, unknown UUID
- `requireWorkspace()` returns workspace for valid cookie matching DB row

---

## Merge Order

```
1. Stream D  → adds requireWorkspace() to workspace.ts
2. Stream A1 → fixes migration journal (prerequisite for A2)
3. Stream A2 → persists ERP credentials
4. Stream A3 → removes creds from chat payload (depends on A2)
5. Stream B  → uses requireWorkspace() from D
6. Stream C  → independent, can merge anytime
```

---

## Environment Variables Required

| Variable | Needed for | Status |
|----------|-----------|--------|
| `UTOPIA_VAULT_KEY` | ERP credential encryption (A2) | Must be set in `.env.local` — 32 bytes base64 |
| `DATABASE_URL` | All DB access | Already required |
| `OPENAI_API_KEY` | Realtime + chat | Already required |

If `UTOPIA_VAULT_KEY` is missing, `encryptSecret()` throws at startup. Generate with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## What This Does NOT Fix (Out of Scope)

- **Full user authentication** (NextAuth/BetterAuth with login page) — this is Ola 1A week 2.
  `requireWorkspace()` prevents unauthenticated abuse but does not bind workspaces to user accounts.
- **Rate limiting** (Upstash Redis) — deferred to Ola 2B.
- **npm audit vulnerabilities** — tracked separately in BACKLOG.md.

---

## Estimated Effort

| Stream | Commits | Effort |
|--------|---------|--------|
| A (migrations + ERP persist + chat fix) | 3 | ~6h total |
| B (realtime guard) | 1 | ~1h |
| C (dashboard real data) | 1 | ~2h |
| D (workspace guard helper) | 1 | ~30min |
| **Total (parallel)** | **6** | **~6h wall-clock** |
