# Vercel BotID — Bot / Abuse Protection

Vercel BotID (npm package: `botid`, maintained by Vercel) reached GA in
May 2026. It uses Kasada-powered invisible challenges and is
recommended for AI-heavy endpoints because LLM calls cost real money
per request.

## Status in this repo (Ola 0)

- Dependency: declared in `package.json` (`botid` ^1.5.x). Install
  happens on the next `npm install` (Agente 0.A / 0.F handles the
  deploy of dep updates).
- Runtime wiring: NOT applied yet. Endpoints to protect remain unchanged.
- Activation strategy: route-level via `checkBotId()` inside each
  high-cost route handler (Agente 0.F is responsible for the
  middleware/proxy layer; we hook `checkBotId` from there or from
  individual route handlers).

## Endpoints to protect (priority)

High value (real LLM cost, unauthenticated MVP):

- `POST /api/chat`               -- chat orchestrator (T1/T2/T3)
- `POST /api/financial-report`   -- 3-agent pipeline, ~300 s budget
- `POST /api/financial-audit`    -- 4 auditors in parallel
- `POST /api/financial-quality`  -- meta auditor
- `POST /api/tax-planning`
- `POST /api/transfer-pricing`
- `POST /api/business-valuation`
- `POST /api/fiscal-audit-opinion`
- `POST /api/tax-reconciliation`
- `POST /api/feasibility-study`
- `POST /api/upload`             -- OCR (gpt-4o full model)
- `POST /api/repair-chat`

Lower priority (cheaper, can wait): `/api/feedback`, `/api/health`.

## Wiring example (deferred to Ola 0.F or Ola 2)

Vercel-hosted apps activate BotID in two places:

1. **Project setup**: enable BotID in the Vercel dashboard for the
   project (Settings -> Bot Protection -> Enable). This deploys the
   challenge JS; no code change needed for that part.

2. **Server-side enforcement** in each high-value route:
   ```ts
   // src/app/api/chat/route.ts
   import { checkBotId } from 'botid/server';

   export async function POST(req: Request) {
     const verification = await checkBotId();
     if (!verification.isHuman) {
       return new Response('Forbidden', { status: 403 });
     }
     // ...rest of handler
   }
   ```

3. **Client-side init** (only required if NOT using Next.js automatic
   integration):
   ```tsx
   // src/app/layout.tsx
   import { BotIdClient } from 'botid/client';

   export default function RootLayout({ children }) {
     return (
       <html lang="es">
         <body>
           <BotIdClient />
           {children}
         </body>
       </html>
     );
   }
   ```
   With the Next.js integration, `BotIdClient` auto-injects via the
   Vercel Toolbar in dev and the Vercel runtime in prod -- check the
   dashboard before adding it manually to avoid duplicate scripts.

## What this does NOT replace

- Per-IP rate limiting (already in `src/middleware.ts`). BotID stops
  bots; humans abusing the endpoint still need a quota.
- CSRF (origin check in middleware). Same.
- Auth. BotID is anonymous abuse protection, not authentication.

## Manual action required from Johan

- [ ] Enable BotID in Vercel dashboard for the UtopIA project.
- [ ] After Ola 0.F lands, verify each high-cost POST returns 403
      when called without the Vercel BotID token (curl from a fresh
      machine should fail). If 200, the wiring is missing.

## Limitations

- Free tier in 2026 covers a generous number of requests; AI-heavy use
  cases may exceed it. Watch the dashboard for budget alerts.
- Edge runtime support: yes. Node runtime support: yes. Both are fine
  for this repo.
- Static prerendered pages cannot enforce BotID (no server). All
  protected entry points in this repo are POST handlers, so this is
  not an issue.
