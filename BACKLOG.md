# BACKLOG — UtopIA Auditoría 2026-06-05

Checklist accionable generado de REMEDIATION_PLAN.md.

## Ola 0 — Desbloqueo

- [ ] 0.1 — Crear `.env.local` con `DATABASE_URL`, `OPENAI_API_KEY`, `TAVILY_API_KEY`
- [ ] 0.2 — Renombrar `0006_nasty_darwin.sql` → `0006b_nasty_darwin.sql` (colisión) y ejecutar `npm run db:push` con migraciones 0005–0011
- [ ] 0.3 — `npm install typescript --save-dev` (habilitar `tsc` local)
- [ ] 0.4 — `npm run db:seed-calendar` (datos calendario tributario)
- [ ] 0.5 — Test pipeline NIIF con balance de prueba demo
- [ ] 0.6 — Actualizar README con quickstart de 5 pasos

## Ola 0B — Conectar datos reales (dashboard + ERP)

- [ ] 0.7 — Conectar `VerdadOverviewPage` / `ExecutiveDashboard` a `getCachedPillarKpis()` — eliminar `mockCompliance`, `mockTef` de `src/app/workspace/verdad/page.tsx:17`
- [ ] 0.8 — Completar `POST /api/erp/connect`: llamar `serializeCredentials` + `db.insert(erpCredentials)` en `src/app/api/erp/connect/route.ts:27`
- [ ] 0.9 — Habilitar los 6 feature flags en Vercel env en orden: TAX_ENGINE → OCR_PROMOTE → BANK_RECON → AUTO_ADJUSTMENTS → MONTHLY_CLOSE_WORKFLOW → NOTIFICATIONS

## Ola 1A — Seguridad Crítica

- [ ] 1.1 — Implementar BetterAuth / NextAuth → workspace vinculado a usuario real
- [ ] 1.2 — `getOrCreateWorkspace()` usa user de sesión (no cookie libre)
- [ ] 1.3 — `npm audit fix` para vulns altas (`@vercel/config`, `@workflow/cli`)
- [ ] 1.4 — Rate limiting con Upstash Redis en `/api/upload` y `/api/chat`
- [ ] 1.5 — `CRON_SECRET` en todos los endpoints `/api/cron/*`

## Ola 1B — Bugs Bloqueantes

- [ ] 1.6 — Verificar modelo `gpt-5.4-mini` existe en OpenAI (posible typo)
- [ ] 1.7 — Implementar `GET /api/sentinel/alerts` — falta backend para `InsightInbox`
- [ ] 1.8 — Corregir KPIs en `workspace/comando/page.tsx:66,78` (TODO activo)
- [ ] 1.9 — Confirmar RAG pgvector completo (no MemoryVectorStore en prod)

## Ola 2A — Feature Flags (encender en orden)

- [ ] 2.1 — `UTOPIA_ENABLE_TAX_ENGINE=true` en staging
- [ ] 2.2 — `UTOPIA_ENABLE_BANK_RECON=true`
- [ ] 2.3 — `UTOPIA_ENABLE_AUTO_ADJUSTMENTS=true`
- [ ] 2.4 — `UTOPIA_ENABLE_OCR_PROMOTE=true`
- [ ] 2.5 — `UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW=true`
- [ ] 2.6 — `UTOPIA_ENABLE_NOTIFICATIONS=true` + configurar Resend key

## Ola 2B — Features Diferidas

- [ ] 2.7 — `PATCH /api/pyme/entries/bulk` (confirm-all en 1 request)
- [ ] 2.8 — `GET /api/pyme/books/[bookId]/export.xlsx`
- [ ] 2.9 — PATCH y DELETE en `/api/pyme/books/[bookId]`
- [ ] 2.10 — Redis rate limiting (Upstash via Vercel Marketplace)

## Ola 3 — Calidad

- [ ] 3.1 — Tokens WCAG: `text-warning` y `text-success` en `tailwind.config.*`
- [ ] 3.2 — Auditoría contraste con `utopia-contrast-auditor` agent
- [ ] 3.3 — Tests para `orchestrator.ts` (T1/T2/T3 classifier)
- [ ] 3.4 — Tests para `vectorstore.ts` (fallback HNSWLib↔pgvector)
- [ ] 3.5 — Tests E2E pipeline NIIF completo (mocked LLM)
- [ ] 3.6 — `vitest --coverage` en `package.json`
- [ ] 3.7 — Extraer servicio Sentinel desacoplado de escudo/fiscal-anchor
- [ ] 3.8 — Fragmentar `ChatWorkspace.tsx` (1200+ líneas)
- [ ] 3.9 — Eliminar `console.warn` con contexto en `WindowBridge.tsx`
- [ ] 3.10 — Documentar setup Neon pgvector en README
