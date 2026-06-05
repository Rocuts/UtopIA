# REMEDIATION_PLAN — UtopIA

> **Fecha**: 2026-06-05 | **Basado en**: AUDIT_REPORT.md
> **Principio**: lean first — desbloquear → estabilizar → completar → calidad

---

## Ola 0 — Desbloqueo (para que arranque y sea usable)

Objetivo: cualquier dev puede clonar, levantar y demostrar el MVP end-to-end.

| # | Tarea | Esfuerzo | Archivo | Criterio "hecho" |
|---|-------|----------|---------|-----------------|
| 0.1 | Crear `.env.local` con `DATABASE_URL`, `OPENAI_API_KEY`, `TAVILY_API_KEY` | XS | `.env.local` | `npm run dev` arranca sin errores |
| 0.2 | Resolver colisión de migración: renombrar `0006_nasty_darwin.sql` → `0006b_nasty_darwin.sql`, luego ejecutar `npm run db:push` con migraciones 0005–0011 | S | `src/lib/db/migrations/` | Tablas `tax_rules`, `bank_accounts`, `fixed_assets`, `notification_subscriptions`, `sentinel_alerts` creadas |
| 0.3 | Instalar TypeScript como binario local: `npm install typescript --save-dev` | XS | `package.json` | `npx tsc --noEmit` ejecuta |
| 0.4 | Seed datos iniciales: `npm run db:seed-calendar` | XS | — | Calendario tributario cargado |
| 0.5 | Verificar pipeline NIIF end-to-end con balance de prueba de demo | M | — | `/api/financial-report` responde con SSE stream |
| 0.6 | Documentar en README el quickstart de 5 pasos (clone → install → env → db:push → dev) | XS | `README.md` | Dev nuevo puede arrancar en <15 min |

---

## Ola 1 — Estabilización (seguridad crítica + bugs bloqueantes)

### 1A — Seguridad crítica

| # | Tarea | Esfuerzo | Dependencia | Criterio "hecho" |
|---|-------|----------|-------------|-----------------|
| 1.1 | Implementar auth básica (BetterAuth o NextAuth) — vincular workspace a usuario | L | 0.1 | `/api/*` require sesión activa |
| 1.2 | Reemplazar cookie-based tenant por user_id verificado | M | 1.1 | `getOrCreateWorkspace` usa user de sesión |
| 1.3 | Actualizar dependencias con vulnerabilidades altas: `@vercel/config`, `@workflow/cli` | S | — | `npm audit` muestra 0 high |
| 1.4 | Agregar rate limiting en `/api/upload` y `/api/chat` con Upstash Redis | M | — | 429 con header Retry-After |
| 1.5 | Agregar CRON_SECRET a endpoints de cron (`/api/cron/*`) | S | — | Sin secret → 401 |

### 1B — Bugs bloqueantes

| # | Tarea | Esfuerzo | Archivo | Criterio "hecho" |
|---|-------|----------|---------|-----------------|
| 1.6 | Verificar/corregir nombre de modelo: `gpt-5.4-mini` vs `gpt-4o-mini` | S | `src/lib/config/models.ts` | Modelo existe en OpenAI API |
| 1.7 | Implementar `/api/sentinel/alerts` faltante — `InsightInbox.tsx:57` usa endpoint inexistente | M | `src/app/api/sentinel/alerts/route.ts` | GET devuelve lista de alertas |
| 1.8 | Conectar métricas reales en `workspace/comando/page.tsx:66,78` (TODOs activos) | S | `src/app/workspace/comando/page.tsx` | KPIs de razon ácida y financieros correctos |
| 1.9 | Validar que RAG migración HNSWLib→pgvector esté completa en todos los entornos | M | `src/lib/rag/vectorstore.ts` | No usa MemoryVectorStore en producción |

---

## Ola 2 — Completar Features Parciales

### 2A — Módulo Contabilidad (feature flags ON)

Encender de a uno post-smoke-test. Orden recomendado por dependencias:

| # | Flag | Tarea | Esfuerzo | Prerequisito |
|---|------|-------|----------|-------------|
| 2.1 | `UTOPIA_ENABLE_TAX_ENGINE` | Verificar motor tributario en staging | S | 1.2 (auth) |
| 2.2 | `UTOPIA_ENABLE_BANK_RECON` | Bank reconciliation UI + backend | S | 2.1 |
| 2.3 | `UTOPIA_ENABLE_AUTO_ADJUSTMENTS` | Auto-adjustments contables | S | 2.2 |
| 2.4 | `UTOPIA_ENABLE_OCR_PROMOTE` | Promote OCR → journal | S | 2.3 |
| 2.5 | `UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW` | Workflow cierre mensual | M | 2.4 |
| 2.6 | `UTOPIA_ENABLE_NOTIFICATIONS` | Email transaccional con Resend | S | 2.5 |

### 2B — Features diferidas de alto impacto

| # | Tarea | Esfuerzo | Archivo | Criterio "hecho" |
|---|-------|----------|---------|-----------------|
| 2.7 | `PATCH /api/pyme/entries/bulk` — confirm-all eficiente | S | nuevo route | N-1 round trips reducidos |
| 2.8 | `GET /api/pyme/books/[bookId]/export.xlsx` | M | reutilizar excel-export.ts | .xlsx descargable con balance PYME |
| 2.9 | `/api/pyme/books/[bookId]` PATCH y DELETE | S | route existente | Renombrar y eliminar libros |
| 2.10 | Rate limiting con Redis (Upstash via Vercel Marketplace) | M | `src/app/api/pyme/uploads/route.ts` | Límite deslizante 5/min/libro |

---

## Ola 3 — Calidad (deuda técnica, refactors, cobertura)

### 3A — Contraste y accesibilidad

| # | Tarea | Esfuerzo | Archivo |
|---|-------|----------|---------|
| 3.1 | Corregir tokens `text-warning` y `text-success` → cumplir WCAG AA 4.5:1 | M | `tailwind.config.*` |
| 3.2 | Auditar contraste con `utopia-contrast-auditor` agent en todos los módulos | S | — |

### 3B — Tests

| # | Tarea | Esfuerzo | Qué cubrir |
|---|-------|----------|-----------|
| 3.3 | Tests para `orchestrator.ts` — clasificación T1/T2/T3 | M | lógica de tiers |
| 3.4 | Tests para `vectorstore.ts` — fallback HNSWLib↔pgvector | S | comportamiento Vercel vs local |
| 3.5 | Tests E2E para pipeline NIIF completo (mocked LLM) | L | flujo de 8 nodos |
| 3.6 | Agregar coverage report: `vitest --coverage` | XS | `package.json` |

### 3C — Refactors

| # | Tarea | Esfuerzo | Impacto |
|---|-------|----------|---------|
| 3.7 | Extraer capa de servicio Sentinel — desacoplar de escudo/fiscal-anchor | M | Elimina conexión sorpresa del grafo |
| 3.8 | Fragmentar `ChatWorkspace.tsx` (componente de 1200+ líneas) | L | Mantenibilidad |
| 3.9 | Eliminar `console.warn` con datos de contexto en producción | S | `WindowBridge.tsx`, `ChatSidebar.tsx` |
| 3.10 | Documentar setup Neon pgvector en README | XS | Reproducibilidad |

---

## Esfuerzo estimado

| Ola | Items | Esfuerzo total estimado |
|-----|-------|------------------------|
| 0 (desbloqueo) | 6 | ~4h |
| 1 (estabilización) | 9 | ~2-3 días |
| 2 (completar) | 10 | ~1 semana |
| 3 (calidad) | 10 | ~1.5 semanas |

**Tamaño**: XS=30min, S=2h, M=4-8h, L=1-2 días

---

## Pregunta para empezar a ejecutar

**¿Cuál Ola quieres que empiece a ejecutar?**

- **Ola 0** — Para poder hacer una demo funcional hoy mismo
- **Ola 1** — Si ya tienes `.env.local` y quieres security + bugs críticos
- **Ola 2** — Para activar el módulo contable completo
- **Ola 3** — Para mejorar la calidad del codebase existente
