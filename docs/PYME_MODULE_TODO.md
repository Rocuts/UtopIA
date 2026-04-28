# PYME Module — TODO / Technical Debt

Findings and improvements **deferred from Phase 3** (remediation pass dated 2026-04-28).
None of these block MVP launch. They are tracked here for post-MVP iteration so that
nothing falls off the radar.

---

## Deferred from Phase 3

### 1. Global contrast tokens (`text-warning` / `text-success` light variants)

The audit flagged that the warning + success utility classes used across the
ecosystem fall below WCAG AA contrast on light surfaces. This affects EVERY
module (financial reports, audits, alerts) and requires coordination with
the design-system owner — a Pyme-only patch would create inconsistency.

**Plan**: open a design-system ticket. Adjust the token definitions in
`tailwind.config.*` (or the Orbexs token export) so `text-success` and
`text-warning` meet 4.5:1 on `bg-n-0` and `bg-n-100`. Validate with the
contrast auditor agent across all modules in a single sweep.

---

### 2. Rate limiting via Upstash Redis

The current rate limit on `POST /api/pyme/uploads` is in-DB
(`countRecentUploads(bookId, 60s)`). It works for single-instance Vercel
Functions but has two limitations:

1. Each rate-check is a SQL query — adds ~30ms latency per upload.
2. No global limit per workspace — a malicious tenant can spin up many
   books and burst through the per-book cap.

**Plan**: provision Upstash Redis via Vercel Marketplace. Replace
`countRecentUploads` with `Ratelimit.slidingWindow()`. Apply a tiered
limit: per-book (5/min), per-workspace (50/min), per-IP (100/min). Same
applies to other write endpoints once Redis is in.

---

### 3. `dynamic = 'force-dynamic'` on Server Components

A few server components in `src/app/workspace/pyme/**` rely on the implicit
dynamic-rendering default. With Next.js 16 Cache Components this is
acceptable for MVP (no `'use cache'` directives, no PPR setup). Once we
migrate to Cache Components globally, we'll explicitly opt into dynamic
boundaries with `Suspense + dynamic API access` patterns and verify the
build output.

**Plan**: when `cacheComponents: true` is enabled in `next.config.ts`,
audit every Pyme page and add `Suspense` boundaries around dynamic
sections (workspace cookie reads, runtime data).

---

### 4. Bulk PATCH endpoint for "Confirm all"

`EntryReview` currently iterates draft entries and fires N parallel
PATCH requests when the user clicks "Confirm all". Works but is wasteful
on large batches.

**Plan**: add `PATCH /api/pyme/entries/bulk` accepting
`{ entryIds: string[], status: 'confirmed' }`. Single SQL `UPDATE ... WHERE
id IN (...)` scoped to ownedBookIds. Saves N-1 round trips per confirm-all.

---

### 5. Excel export endpoint

The spec mentions an optional export to `.xlsx` for compatibility with the
existing NIIF balance-sheet pipeline. Out of scope for MVP — the user can
still export the monthly report as JSON and re-import.

**Plan**: `GET /api/pyme/books/[bookId]/export.xlsx?from=YYYY-MM&to=YYYY-MM`.
Reuse `src/lib/export/excel-export.ts` patterns. Add a "Trial Balance" tab
that maps `pyme_entries.pucHint` to PUC codes for direct ingestion into
the NIIF pipeline.

---

### 6. Next.js 16 `middleware.ts` → `proxy.ts` rename codemod

Next.js 16 renamed the convention. The repo still uses `src/middleware.ts`,
which is supported but deprecated. Touching it impacts every API route
(rate limiting, CSRF, security headers) — a Pyme-only PR is the wrong place.

**Plan**: schedule a separate maintenance PR that runs `npx
@next/codemod@latest middleware-to-proxy` and validates all middleware
patterns (rate limit, CSRF, headers) still apply correctly. Test with a
preview deploy before merging.

---

### 7. Vercel Blob `access: 'public'` → `'private'`

Phase 3 mitigated the public-URL risk with `addRandomSuffix: true` plus a
proxy endpoint at `/api/pyme/uploads/[uploadId]/image`. Photos still live
in a public bucket — anyone with the full URL (which has the random
suffix) can fetch the image without an ownership check.

**Plan**: when `@vercel/blob` private storage is GA and stable, migrate:

1. Change `put(..., { access: 'private' })` in
   `src/app/api/pyme/uploads/route.ts`.
2. Replace the redirect in `[uploadId]/image/route.ts` with `get(url)` +
   stream proxy.
3. Update OCR extractor: `extractEntriesFromImage` currently passes the
   raw URL to gpt-4o vision. Private Blob URLs need a signed URL or
   inline base64 — choose based on file size.

Until then: the proxy-with-redirect pattern keeps tenant URLs out of the
client and minimizes the attack surface to URL-level leaks.

---

### 8. Transactional persistence in `processUpload`

The orchestrator inserts entries and updates upload status in two
sequential queries. If the second fails, entries exist but the upload
stays in `processing`. The Phase 3 fix added a stuck-timeout in the
status GET endpoint (5 min → reports `failed` to the client without DB
write) which is sufficient for MVP.

**Plan**: refactor `repo.insertEntries` to optionally accept a `tx` and
wrap insert + status-update in `db.transaction()`. Drizzle supports it
on the neon-http driver, but the API needs careful threading through the
orchestrator. Postpone until a need surfaces (so far we have not seen a
real stuck upload in dogfood).

---

## Notes for future maintainers

- The audit also flagged "good-enough" code paths that are intentionally
  simple for MVP (e.g. the categorizer fallback to `"Otros"` instead of
  retrying with a different prompt). These are not bugs — they are
  documented in the agent files themselves.
- All deferred items are non-blocking. The module is production-ready
  for tendero / micro-empresa users in Colombia today.
