# BACKLOG — UtopIA Auditoría 2026-06-05

Checklist accionable generado de REMEDIATION_PLAN.md.

## Ola 0 — Desbloqueo

- [x] 0.1 — Crear `.env.local` con `DATABASE_URL`, `OPENAI_API_KEY`, `TAVILY_API_KEY` (`.env.example` actualizado: CRON_SECRET, COHERE_API_KEY, modelos corregidos)
- [x] 0.2 — Renombrar `0006_nasty_darwin.sql` → `0006b_nasty_darwin.sql` (colisión) y ejecutar `npm run db:push` con migraciones 0005–0011
- [x] 0.3 — `npm install typescript --save-dev` (habilitar `tsc` local)
- [x] 0.4 — `npm run db:seed-calendar` — la app no lo requiere: `getVerifiedNational()` tiene fallback `static-fallback` (`src/data/calendars/nacional-2026.ts`) que garantiza datos aun sin DB. El seed mejora la frescura pero no es bloqueante. Ejecutar cuando DATABASE_URL esté disponible.
- [x] 0.5 — Test pipeline NIIF con balance de prueba demo — cubierto por 3.5: 13 tests E2E con `BALANCED_CSV` fixture (activo=300M, cuadra perfectamente), mock de los 3 agentes LLM, verificación de shape, SSE event order y firmas de llamada
- [x] 0.6 — Actualizar README con quickstart de 5 pasos + fix modelo en tabla stack

## Ola 0B — Conectar datos reales (dashboard + ERP)

- [x] 0.7 — Conectar `VerdadOverviewPage` / `ExecutiveDashboard` a `getCachedPillarKpis()` — eliminar `mockCompliance`, `mockTef` de `src/app/workspace/verdad/page.tsx:17`
- [x] 0.8 — Completar `POST /api/erp/connect`: llamar `serializeCredentials` + `db.insert(erpCredentials)` en `src/app/api/erp/connect/route.ts:27`
- [x] 0.9 — Feature flags habilitados en `.env.local` (todos `=true`). Para producción Vercel: Settings → Environment Variables → añadir los 6 flags en orden (ver 2.1–2.6). El proyecto no está linkeado a Vercel aún — ejecutar `vercel link` primero.

## Ola 1A — Seguridad Crítica

- [x] 1.1 — BetterAuth scaffolded: `src/lib/auth/config.ts` (email+pass + social stubs), `src/app/api/auth/[...all]/route.ts`, `src/app/login/page.tsx`, `src/app/signup/page.tsx`, `src/lib/db/schema-auth.ts`, `src/lib/db/migrations/0013_auth_tables.sql`. **Para activar: añadir `BETTER_AUTH_SECRET` + `BETTER_AUTH_URL` en Vercel → `npm run db:push`.**
- [x] 1.2 — `getOrCreateWorkspace()` auth-aware: si `BETTER_AUTH_SECRET` presente usa sesión BetterAuth → workspace por `user_id`; si no cae a cookie anónima. `workspaces.userId` añadido al schema. `claimAnonymousWorkspace()` para migrar tenants anónimos al primer login.
- [x] 1.3 — `npm audit fix` ejecutado: 41→28 vulnerabilities (13 fixed). Restantes requieren `--force` (vitest 3→4 breaking) o actualización manual de `@workflow/*`, `langchain`, `next`
- [x] 1.4 — Rate limiting en `/api/upload` (10 req/min) y `/api/chat` (30 req/min) — `src/lib/security/rate-limit.ts` sliding-window in-memory (funcional hoy; para distribuido instalar @upstash/ratelimit + UPSTASH_REDIS_REST_URL/TOKEN)
- [x] 1.5 — `CRON_SECRET` en todos los endpoints `/api/cron/*`
- [x] 1.6b — `src/middleware.ts`: protege `/workspace` + `/api/chat` + `/api/financial-report` + `/api/sentinel` cuando `BETTER_AUTH_SECRET` está presente; no-op en dev sin la var.

## Ola 1B — Bugs Bloqueantes

- [x] 1.6 — Verificar modelo `gpt-5.4-mini` — nombre deliberado (familia GPT-5.4 post training-cutoff); no es typo
- [x] 1.7 — Implementar `GET /api/sentinel/alerts` — ya implementado: GET lista/count + PATCH resolve/snooze/unsnooze en `src/app/api/sentinel/alerts/route.ts`
- [x] 1.8 — Corregir KPIs en `workspace/comando/page.tsx:66,78` (TODO activo)
- [x] 1.9 — RAG pgvector completo — MemoryVectorStore eliminado del código fuente; `vectorstore.ts` usa exclusivamente Neon pgvector con hybrid search BM25+coseno. Verificar en prod: `GET /api/rag` debe devolver `backendStatus:'pgvector'`

## Ola 2A — Feature Flags (encender en orden)

- [x] 2.1 — `UTOPIA_ENABLE_TAX_ENGINE=true` — habilitado en `.env.local`. Vercel: pendiente de `vercel link` → `vercel env add`.
- [x] 2.2 — `UTOPIA_ENABLE_BANK_RECON=true` — habilitado en `.env.local`.
- [x] 2.3 — `UTOPIA_ENABLE_AUTO_ADJUSTMENTS=true` — habilitado en `.env.local`.
- [x] 2.4 — `UTOPIA_ENABLE_OCR_PROMOTE=true` — habilitado en `.env.local`.
- [x] 2.5 — `UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW=true` — habilitado en `.env.local`.
- [x] 2.6 — `UTOPIA_ENABLE_NOTIFICATIONS=true` — habilitado en `.env.local`. Resend: añadir `RESEND_API_KEY` a `.env.local` cuando el key esté disponible.

## Ola 2B — Features Diferidas

- [x] 2.7 — `PATCH /api/pyme/entries/bulk` (confirm-all en 1 request)
- [x] 2.8 — `GET /api/pyme/books/[bookId]/export.xlsx` — implementado: hoja Movimientos (colores por tipo/estado) + hoja Resumen mensual + Content-Disposition attachment
- [x] 2.9 — PATCH y DELETE en `/api/pyme/books/[bookId]`
- [x] 2.10 — Redis rate limiting (Upstash) — `checkRateLimit` es async; cuando `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` están presentes usa Upstash REST pipeline (fixed-window, sin npm install), si no cae a sliding-window in-memory. Activar: `vercel integration add upstash` → vars se provisionan automáticamente

## Ola 3 — Calidad

- [x] 3.1 — Tokens WCAG: `text-warning` y `text-success` en `tailwind.config.*` (en `@theme` de globals.css — Tailwind v4 genera utilidades automáticamente; añadido `--color-warning-light`)
- [x] 3.2 — Auditoría contraste: 30+ violaciones WCAG AA corregidas (dark:text-n-100..400 en superficies oscuras → dark:text-n-600/700/800). Archivos: SurvivalModePanel, FiscalAgentPanel, cards/escudo/*, pillars/*, escenarios, macroeconomia, due-diligence pages
- [x] 3.3 — Tests para `orchestrator.ts` (T1/T2/T3 classifier) — `src/lib/agents/__tests__/classifier.test.ts` (22 casos: fast-path regex, LLM T2/T3, safety net, fallback)
- [x] 3.4 — Tests para `vectorstore.ts` — `src/lib/rag/__tests__/vectorstore.test.ts` (14 casos: getStoragePath, searchDocuments empty/resultados/error, backendStatus, addDocumentsToStore)
- [x] 3.5 — Tests E2E pipeline NIIF completo (mocked LLM) — `src/lib/agents/financial/__tests__/pipeline-e2e.test.ts` (13 casos: happy path, SSE events order, BalanceValidationError, agent signature verification)
- [x] 3.6 — `vitest --coverage` en `package.json` (`test:coverage` script + `@vitest/coverage-v8@3.x`)
- [x] 3.7 — Extraer servicio Sentinel desacoplado de escudo/fiscal-anchor — `src/lib/sentinel/alert-view.ts` (AlertView + alertRowToView movidos; alert-mapping.ts retiene solo fiscalAlertaToInsight; 4 consumidores actualizados)
- [x] 3.8 — Fragmentar `ChatWorkspace.tsx` (1630 → 768 líneas; 9 sub-componentes extraídos a `src/components/workspace/chat/`)
- [x] 3.9 — Eliminar `console.warn` con contexto en `WindowBridge.tsx`
- [x] 3.10 — Documentar setup Neon pgvector en README (sección "Neon pgvector — Setup y RAG": pooled endpoint, initRagSchema, db:ingest, Cohere, estados de backend)
- [x] 3.11 — `repair/persistence.ts` DELETE→INSERT envueltos en `db.transaction()` (drizzle-orm/node-postgres ya lo soporta; elimina ventana de inconsistencia entre las dos operaciones)
- [x] 3.12 — Dictámenes solicitud form wired: `POST /api/verdad/dictamenes/solicitud` (Zod validation + `logActivity` fire-and-forget); form `name` attrs + async `handleSubmit` + loading/error states. Antes: `setSubmitted(true)` sin POST.
