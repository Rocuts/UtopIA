# AUDIT_REPORT — UtopIA

> **Fecha**: 2026-06-05 | **Rama**: `audit/full-diagnosis-2026-06-05`
> **Auditores**: Claude Code + 3 subagentes especializados (código, seguridad, completitud)
> **Estado**: FINAL — 3 subagentes completados (código, seguridad, completitud)

---

## Resumen Ejecutivo

| Prioridad | Hallazgo |
|-----------|----------|
| 🔴 | **Sin autenticación de usuario** — el workspace se identifica solo por cookie `utopia_workspace_id`; cualquiera con la cookie accede a todos los datos del tenant |
| 🔴 | **41 vulnerabilidades npm** (1 crítica en `vitest`, 14 altas en `@vercel/config`, `@workflow/cli`) |
| 🔴 | **TypeScript no compila localmente** — `tsc` no está disponible como binario (`node_modules/.bin/tsc` ausente), validación solo en CI/Vercel |
| 🟡 | **6 feature flags críticos OFF** — módulos completos de contabilidad deshabilitados en producción (`TAX_ENGINE`, `BANK_RECON`, `AUTO_ADJUSTMENTS`, `MONTHLY_CLOSE_WORKFLOW`, `NOTIFICATIONS`, `OCR_PROMOTE`) |
| 🟡 | **Modelo referenciado no existe** — `gpt-5.4-mini` aparece en README pero OpenAI no tiene este modelo; probablemente es `gpt-4o-mini` con nombre incorrecto |
| 🟢 | **Proyecto bien estructurado** — 952 archivos TS/TSX con convenciones consistentes, 86 archivos de test, Zod strict mode, MoneyCop pattern correcto |

---

## Fase 0 — Estado Actual

### Estructura de módulos

| Módulo | Archivos | Estado | Arranca |
|--------|----------|--------|---------|
| `src/app/api/` | ~95 rutas | ✅ Implementado | Depende de DB |
| `src/lib/agents/financial/` | ~80 archivos | ✅ Completo | Depende de OPENAI_API_KEY |
| `src/lib/accounting/` | ~60 archivos | ✅ Completo | Depende de DATABASE_URL |
| `src/lib/agents/pyme/` | ~15 archivos | ✅ Completo | Feature flags OFF |
| `src/components/workspace/` | ~50 archivos | ✅ Completo | — |
| `src/design-system/` | 12 componentes | ✅ Completo | — |
| RAG / HNSWLib | `src/lib/rag/` | ⚠️ Migrado a pgvector | Vercel: usa MemoryVectorStore |
| DB | 12 migraciones | ✅ Completo | Necesita Neon DATABASE_URL |

### Arrancabilidad

```
Estado: NO ARRANCA localmente sin .env.local con DATABASE_URL y OPENAI_API_KEY
- Sin DATABASE_URL: falla en runtime al primer request a /api/*
- Sin OPENAI_API_KEY: falla en cualquier LLM call
- TypeScript: no compila con `tsc` localmente (binario no instalado)
- npm run dev: arranca el servidor pero sin funcionalidad
```

---

## Fase 1 — Arquitectura y Grafo de Dependencias

### Grafo generado con graphify

Outputs en `graphify-out/`:
- `graph.html` — grafo interactivo (3,811 nodos, 5,379 aristas, 550 comunidades)
- `graph.json` — datos raw para GraphRAG
- `GRAPH_REPORT.md` — informe con god nodes y comunidades
- `obsidian/` — vault de Obsidian con 4,361 notas + canvas

### God Nodes (puntos únicos de falla)

| Nodo | Aristas | Riesgo |
|------|---------|--------|
| `getDb()` — `src/lib/db/client.ts` | **161** | Punto único de acceso DB — cualquier cambio rompe todo |
| `getOrCreateWorkspace()` — `src/lib/db/workspace.ts` | 67 | Patrón singleton sin auth — riesgo de tenant leakage |
| `formatCopFromCents()` — `contracts/money.ts` | 45 | Cambio en formato COP afecta 45 componentes |
| `callFinancialAgent()` — `agents/financial/agents/runtime.ts` | 35 | Runtime único para todos los agentes financieros |
| `preprocessTrialBalance()` — `preprocessing/trial-balance.ts` | 25 | Preprocesador crítico del pipeline NIIF |

### Comunidades principales

| Cluster | Nodos | Descripción |
|---------|-------|-------------|
| C0 | 306 | Accounting Shared Utilities (helpers, error responses) |
| C1 | 189 | Financial Agent Pipelines (CCV, DCF, conciliación) |
| C2 | 121 | Audit & Compliance Agents |
| C3 | 98 | Core API Routes |
| C4 | 90 | Escudo Survival Validators |
| C5 | 87 | Accounting UI Components |
| C6 | 85 | NIIF Analyst Pipeline |
| C7 | 77 | Áncora / Context Builders |
| C8 | 69 | AI SDK & Model Config |
| C9 | 68 | Opinion & Dictamen Drafters |

### Problemas estructurales

1. **God node `getDb()` con 161 dependientes** — toda la app pasa por un único pool. Si falla, no hay degradación parcial.
2. **Patrón workspace sin auth** — `getOrCreateWorkspace()` crea workspace por cookie sin verificar identidad.
3. **Acoplamiento bidireccional Sentinel↔Escudo** — `PATCH` en `escudo/fiscal-anchor/alerts/[id]` llama directamente a `lib/workflows/sentinel/repository.ts` sin capa de servicio intermedia.
4. **RAG inconsistente** — `next.config.ts` comenta que HNSWLib fue migrado a pgvector, pero `src/lib/rag/vectorstore.ts` aún tiene el código HNSWLib con fallback a MemoryVectorStore en Vercel.

---

## Fase 2 — Calidad de Código

**Resumen**: 28 hallazgos (4🔴 alta / 15🟡 media / 9🟢 baja)

### Top 3 críticos

1. **`src/app/api/financial-report/route.ts:71` 🔴** — Endpoint sin auth ni rate-limit activa pipeline de ~24 min / ~$10-30 por ejecución. Un actor malicioso puede vaciar la cuenta OpenAI.
2. **`src/components/workspace/ChatWorkspace.tsx:1096-1106` 🔴** — Credenciales ERP descodificadas en cliente con `atob + JSON.parse` y enviadas en cada payload de chat. Deben vivir solo en el vault AES-256-GCM del servidor.
3. **`src/lib/db/client.ts:31-32` 🔴** — Race condition en inicialización del pool DB bajo Fluid Compute — puede crear pools zombies que no se cierran al evictar la instancia.

### Hallazgos completos

| Archivo | Línea | Severidad | Hallazgo |
|---------|-------|-----------|---------|
| `api/financial-report/route.ts` | 71 | 🔴 | Sin auth ni rate-limit — pipeline costoso expuesto públicamente |
| `ChatWorkspace.tsx` | 1096-1106 | 🔴 | Credenciales ERP en payload con solo Base64 — usar vault server-side |
| `db/client.ts` | 31-32 | 🔴 | Singleton DB sin mutex — race condition en Fluid Compute |
| `api/financial-report/route.ts` | 128-135 | 🟡 | Campo `preprocessed` acepta sin validación Zod |
| `api/financial-report/route.ts` | 147-215 | 🟡 | Función POST de 215 líneas — mezcla parsing + LLM dispatch |
| `api/financial-report/route.ts` | 229-232 | 🟡 | Doble mecanismo streaming (header `X-Stream` vs query `stream=1`) |
| `orchestrator.ts` | 235 | 🔴 | `finalContent` declarado sin inicializar — undefined en nuevo tier |
| `orchestrator.ts` | 115-116 | 🟡 | `slice(-6)` magic number — ventana de contexto hardcoded |
| `orchestrator.ts` | 179 | 🟡 | `messages[length-1]` sin guard — crash si array vacío |
| `runtime.ts` | 267 | 🟡 | Cast ciego `safeOutput as z.infer<TSchema>` sin safeParse |
| `double-entry/service.ts` | 59 | 🟡 | `MAX_RETRIES=3` pero loop hace 4 iteraciones |
| `double-entry/service.ts` | 105-135 | 🟡 | Tipo `DrizzleTx` anidado 3 niveles — frágil |
| `vectorstore.ts` | 223 | 🟡 | Cast `(rows as any)` en ruta caliente de búsqueda |
| `vectorstore.ts` | 181-182 | 🟡 | Orden duplicado en CTE pgvector — redundante |
| `vectorstore.ts` | 382-388 | 🟡 | `addDocumentsToStore` silencia fallos devolviendo `0` |
| `money.ts` | 33-44 | 🟡 | `formatCopFromCents(number)` trunca floats silenciosamente |
| `money.ts` | 13-17 | 🟡 | `parseMoneyCop` expone valor raw del usuario en mensaje de error |
| `ChatWorkspace.tsx` | 1434-1440 | 🟡 | `removeDocument` filtra por filename — bug con nombres duplicados |
| `ChatWorkspace.tsx` | 1073-1333 | 🟡 | `sendMessage` 260 líneas — mezcla SSE + state + persistencia |
| `db/client.ts` | 42-53 | 🟡 | Pool sin `idleTimeoutMillis` — conexiones inactivas nunca liberadas |
| `orchestrator.ts` | 257, 273 | 🟢 | `console.error` con mensaje de agente — posible PII en logs |
| `runtime.ts` | 211 | 🟢 | Backoff plano (`baseDelay=maxDelay=2000`) — no aliviana carga |
| `runtime.ts` | 256-263 | 🟢 | `console.warn` no usa callback de telemetría existente |
| `double-entry/service.ts` | 312 | 🟢 | `'COP'` hardcoded en 4 lugares — extraer constante |
| `double-entry/service.ts` | 406-411 | 🟢 | Dynamic import en hot path — confunde tree-shaking |
| `vectorstore.ts` | 346-380 | 🟢 | INSERT sin batch limit — N chunks en 1 statement |
| `money.ts` | 60-65 | 🟢 | `toleranceCents` sin documentar que es centavos no pesos |
| `ChatWorkspace.tsx` | 149-156 | 🟢 | Fallback ID usa `Math.random` — posible colisión |

---

## Fase 3 — Tests y Cobertura

### Estado de la suite

```
Archivos de test: 86
Framework: Vitest (configurado)
Cobertura medida: No configurada
```

### Distribución por módulo

| Módulo | Tests | Cobertura estimada |
|--------|-------|-------------------|
| `lib/agents/financial/audit/` | 10 archivos | Alta |
| `lib/accounting/` | 8 archivos | Media |
| `lib/agents/financial/escudo-survival/` | 6 archivos | Alta |
| `lib/agents/financial/__tests__/` | 6 archivos | Media |
| `src/app/api/financial-report/` | 4 archivos | Media |
| Chat orchestrator | 0 archivos | ❌ Sin tests |
| UI Components | 0 archivos | ❌ Sin tests |
| RAG / vectorstore | 0 archivos | ❌ Sin tests |
| Workspace pages | 0 archivos | ❌ Sin tests |
| Notifications | 0 archivos | ❌ Sin tests |

### Zonas críticas sin cobertura

- `src/lib/agents/orchestrator.ts` — lógica T1/T2/T3 sin tests
- `src/lib/rag/vectorstore.ts` — fallback HNSWLib↔pgvector no testeado
- `src/components/workspace/ChatWorkspace.tsx` — componente de 1200+ líneas
- `src/lib/workflows/monthly-close/` — workflow de cierre mensual

---

## Fase 4 — Seguridad

**Resumen**: 20 hallazgos (4🔴 críticos / 6🟠 altos / 7🟡 medios / 3🟢 bajos)

### Top 3 riesgos críticos

1. **F-03** `src/lib/db/workspace.ts:19` 🔴 — **Plataforma sin autenticación real.** Tenant = cookie anónima no firmada. Cualquiera puede cambiar el `utopia_workspace_id` en el navegador y acceder a datos contables de otras empresas.
2. **F-02** `ChatWorkspace.tsx:1098` 🔴 — **Credenciales ERP viajan en texto plano** (solo Base64) en cada request de chat. Visibles en Network tab, logs de servidor, cualquier XSS.
3. **F-01** `src/app/api/realtime/route.ts:4` 🔴 — **Token de OpenAI Realtime API sin auth.** Cualquier bot anónimo puede obtener tokens y drenar el presupuesto de Realtime en horas.

### Vulnerabilidades npm

| Severidad | Paquetes | Acción |
|-----------|----------|--------|
| 🔴 Crítica | `vitest` (1) | Dev only — bajo riesgo en prod |
| 🟠 Alta | `@vercel/config`, `@workflow/cli` y 12 más | Actualizar |
| 🟡 Moderada | `@langchain/classic`, `uuid`, drizzle-kit (17) | Planear actualización |
| 🟢 Baja | `@workflow/*` (9) | Baja prioridad |

### Hallazgos de seguridad completos

| ID | Archivo:Línea | Severidad | Hallazgo |
|----|---------------|-----------|---------|
| F-01 | `api/realtime/route.ts:4` | 🔴 Crítica | Token OpenAI Realtime sin auth — draining attack posible |
| F-02 | `ChatWorkspace.tsx:1098` | 🔴 Crítica | Credenciales ERP en localStorage y en cada payload de chat |
| F-03 | `lib/db/workspace.ts:19` | 🔴 Crítica | Sin autenticación — cookie anónima como único tenant identifier |
| F-04 | `api/erp/sync/route.ts:18` | 🔴 Crítica | ERP sync sin auth — SSRF risk + oracle de credenciales |
| F-05 | `api/erp/connect/route.ts:28` | 🟠 Alta | Credential oracle anónimo para validar API keys de ERPs |
| F-06 | `api/realtime/route.ts:126` | 🟠 Alta | `client_secret` expuesto directamente en response body |
| F-07 | `api/upload/route.ts:600` | 🟠 Alta | `extractedText` con PII en response → guardado en localStorage sin cifrar |
| F-08 | `api/chat/route.ts:370` | 🟠 Alta | `documentContext` inyectado sin sanitización — prompt injection |
| F-09 | `docs/SECURITY_BOTID.md:17` | 🟠 Alta | BotID declarado pero NO implementado en ningún endpoint LLM |
| F-10 | `api/accounting/**` | 🟠 Alta | Audit trail incompleto — no hay userId en logs, solo workspaceId anónimo |
| F-11 | `next.config.ts:62` | 🟡 Media | CSP con `unsafe-inline` en prod — anula protección XSS de CSP |
| F-12 | `api/admin/telemetry/route.ts:157` | 🟡 Media | Error details de PostgreSQL expuestos en respuestas 500 |
| F-13 | `api/upload/route.ts:37-43` | 🟡 Media | Magic bytes débiles — TIFF LE solo, sin validación para .heic/.csv |
| F-14 | `lib/security/pii-filter.ts:44` | 🟡 Media | Regex NIT con falsos positivos — puede redactar números de factura |
| F-15 | `api/erp/webhook/[provider]/route.ts:116` | 🟡 Media | Timing oracle: latencia DB varía según número de workspaces |
| F-16 | `src/proxy.ts:239` | 🟡 Media | Rate limit bypassable rotando cookie `utopia_workspace_id` |
| F-17 | `api/cron/erp-sync/route.ts:46` | 🟡 Media | Auth bypass en entorno no-production si `NODE_ENV` no está seteado |
| F-18 | `next.config.ts:41` | 🟢 Baja | IP privada `192.168.40.67` hardcodeada en `allowedDevOrigins` |
| F-19 | `lib/security/encryption.ts:87` | 🟢 Baja | `pgp_sym_encrypt` recibe key como parámetro SQL — visible en pg query logs |
| F-20 | `api/upload/blob-token/route.ts:47` | 🟢 Baja | Token de Vercel Blob sin auth — upload anónimo hasta 100MB |

### Controles bien implementados ✅

- `src/lib/security/vault.ts` — AES-256-GCM correcto (IV 12 bytes, tag 128 bits, key rotation)
- `src/lib/security/pii-filter.ts` — Tokenización bidireccional PII correcta
- `api/erp/webhook/.../route.ts` — `timingSafeEqual` con padding correcto
- `src/proxy.ts` — CSRF fail-closed para métodos mutantes
- `api/notifications/dispatch/route.ts` — `server-only`, fail-closed si secret ausente
- `api/admin/telemetry/route.ts` — fail-closed si `UTOPIA_ADMIN_TOKEN` ausente (503)

---

## Fase 5 — Completitud

**Resumen**: 15 features ✅ completas / 11 🚧 parciales (mayormente flags OFF) / 5 ❌ ausentes / 1 ❓ ambigua

### Matriz de features

| Feature | Estado | Archivo principal | Notas |
|---------|--------|-------------------|-------|
| Chat AI — Defensa DIAN | ✅ | `api/chat/route.ts` + `workspace/escudo/defensa-dian` | Pipeline RAG + tool-calling activo |
| Chat AI — Devoluciones saldos a favor | ✅ | `workspace/escudo/devoluciones` | UI conectada al pipeline chat |
| Chat AI — Due Diligence / Preparación | ✅ | `workspace/valor/due-diligence` | Conectada a `financial-intelligence` |
| Chat AI — Inteligencia Financiera | ✅ | `workspace/valor/inteligencia-financiera` | Pipeline con contexto de valoración |
| Pipeline NIIF (Analista → Estrategia → Gobierno) | ✅ | `api/financial-report/{niif,strategy,governance}` | 3 endpoints, maxDuration 800s, SSE |
| Pipeline auditoría financiera | ✅ | `api/financial-audit/route.ts` | 4 auditores paralelos NIIF/Tax/Legal/Fiscal |
| Dictamen Revisor Fiscal | ✅ | `api/fiscal-audit-opinion/route.ts` | 4 agentes + sintetizador |
| Planeación tributaria | ✅ | `api/tax-planning/route.ts` | 3 agentes secuenciales |
| Precios de transferencia | ✅ | `api/transfer-pricing/route.ts` | 3 agentes, SSE |
| Conciliación fiscal (Formato 2516) | ✅ | `api/tax-reconciliation/route.ts` | 2 agentes (diferencias + impuesto diferido) |
| Valoración empresarial (DCF + comparables) | ✅ | `api/business-valuation/route.ts` | 3 agentes paralelos |
| Estudio de factibilidad | ✅ | `api/feasibility-study/route.ts` | 3 agentes secuenciales |
| Factores macro Colombia | ✅ | `api/macro/current/route.ts` | Cache CDN 1h |
| Modo Supervivencia Elite (Escudo) | ✅ | `api/escudo-survival/route.ts` | 5 agentes + sintetizador |
| Agente Fiscal El Escudo | ✅ | `components/workspace/escudo/FiscalAgentPanel` | SSE consumer |
| **Dictámenes especiales** | 🚧 | `workspace/verdad/dictamenes/page.tsx` | UI completa, pero modal no hace POST — solicitudes se pierden |
| **WS1 — Motor tributario (Smart-Tax)** | 🚧 | `api/accounting/tax-engine/preview` | Backend listo, `UTOPIA_ENABLE_TAX_ENGINE` **OFF** |
| **WS2 — OCR → Libro Mayor (promote)** | 🚧 | `api/pyme/promote/route.ts` | Backend listo, `UTOPIA_ENABLE_OCR_PROMOTE` **OFF** |
| **WS3 — Conciliación bancaria** | 🚧 | `api/accounting/banking/reconcile` | Backend CSV parser listo, `UTOPIA_ENABLE_BANK_RECON` **OFF** |
| **WS4 — NIIF Auto-Adjustments** | 🚧 | `api/accounting/adjustments/preview` | Calculadoras listas, `UTOPIA_ENABLE_AUTO_ADJUSTMENTS` **OFF** |
| **WS5 — Workflow cierre mensual** | 🚧 | `lib/workflows/monthly-close/index.ts` | Workflow durable 10 pasos listo, `UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW` **OFF** |
| **WS6 — Notificaciones email (Resend)** | 🚧 | `lib/notifications/dispatch.ts` | 4 templates React Email listos, `UTOPIA_ENABLE_NOTIFICATIONS` **OFF** |
| **Dashboard KPI (4 pilares)** | 🚧 | `app/workspace/verdad/page.tsx:17` | Usa `kpi={mockCompliance}` hardcoded — `getCachedPillarKpis()` existe pero no se llama |
| **Sentinel / alertas inteligentes** | 🚧 | `lib/workflows/sentinel/orchestrator.ts` | Cron activo, UI presente, sin "snooze/dismiss" verificado |
| **ERP Connector (Siigo, Helisa…)** | 🚧 | `api/erp/connect/route.ts:27` | **TODO explícito**: valida credenciales pero NO las persiste en DB |
| Autenticación / multi-tenencia | ❌ | — | Sin Auth.js / Clerk / NextAuth. Solo cookie anónima `utopia_workspace_id` |
| Historial conversaciones persistente | ❌ | — | Vive en estado React. Sin tabla `conversations`/`messages` en DB |
| Exportación Excel (.xlsx) PYME | ❌ | — | `excel-export.ts` existe para otro flujo; endpoint `GET .../export.xlsx` no existe |
| Web Push / WhatsApp notifications | ❌ | `lib/notifications/web-push.ts` | Stubs retornando `channel_disabled_in_mvp` |
| Firma digital PKCS#7 | ❌ | — | Diferido D4 |
| Cron detección anomalías forense | ❓ | `api/cron/anomaly-detection/route.ts` | Ruta implementada, `UTOPIA_ENABLE_ANOMALY_DETECTION` OFF, `forensic.ts` no verificado en profundidad |

### Endpoints stub / semi-stub

| Endpoint | Problema | Archivo |
|----------|----------|---------|
| `POST /api/erp/connect` | Valida pero **no persiste** credenciales en DB — `serializeCredentials` no se llama | `api/erp/connect/route.ts:27` |
| Modal "Solicitar dictamen" | `handleSubmit` hace `setSubmitted(true)` sin POST — solicitudes se pierden | `workspace/verdad/dictamenes/page.tsx:179-183` |
| `PATCH /api/pyme/entries/bulk` | No existe — UI dispara N requests individuales | `PYME_MODULE_TODO.md` item 4 |
| `GET /api/pyme/books/[bookId]/export.xlsx` | No existe — diferido en docs | `PYME_MODULE_TODO.md` item 5 |

### Colisión de migraciones

```
ALERTA: Dos archivos comparten el prefijo 0006_:
  - 0006_banking.sql
  - 0006_nasty_darwin.sql
```

Esto puede causar que `npm run db:migrate` falle o aplique en orden incorrecto. Renombrar uno a `0006b_...` antes de ejecutar en producción.

### Feature flags OFF → impacto en producción

| Flag | Feature bloqueada | Consecuencia |
|------|-------------------|-------------|
| `UTOPIA_ENABLE_TAX_ENGINE` | Motor tributario | OCR promote no aplica impuestos; sin cálculo IVA/retefuente/ICA |
| `UTOPIA_ENABLE_OCR_PROMOTE` | Botón "Promover a Libro Mayor" | Flujo PYME → Contabilidad roto |
| `UTOPIA_ENABLE_BANK_RECON` | UI + lógica conciliación bancaria | Health-check del cierre siempre bloqueado |
| `UTOPIA_ENABLE_AUTO_ADJUSTMENTS` | Deprec, amortización, provisiones | WS5 paso 4 no genera ajustes NIIF |
| `UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW` | Workflow cierre, PDF elite, hash integridad | El módulo contable core no existe para el usuario |
| `UTOPIA_ENABLE_NOTIFICATIONS` | Email transaccional al cierre | Cliente no sabe que el período se cerró |

---

## Fase 6 — Documentación y Reproducibilidad

### Un dev nuevo puede levantar el proyecto?

```
✅ README.md completo con arquitectura, casos de uso y API docs
✅ .env.example con todas las variables documentadas
✅ CLAUDE.md con convenciones de desarrollo claras
✅ docs/ con 42 documentos de arquitectura, specs y wave notes
⚠️ Falta: instrucción explícita para hacer `npm install` en README
⚠️ Falta: db:push / db:seed en el quickstart
⚠️ Falta: cómo obtener Neon DATABASE_URL (solo dice "vercel integration add neon")
❌ No hay Makefile / script de bootstrap único
❌ TypeScript no disponible como binario local en .npmrc/.nvmrc
```

---

## Diagramas del Grafo

Los grafos de dependencias se encuentran en:

```
graphify-out/
├── graph.html          # Interactivo — abrir en browser
├── GRAPH_REPORT.md     # Informe con god nodes y comunidades
├── graph.json          # Datos raw GraphRAG
└── obsidian/           # Vault Obsidian (4,361 notas + canvas)
    ├── graph.canvas    # Layout estructurado por comunidades
    └── _COMMUNITY_*/   # Notas de resumen por comunidad
```

---

*Nota: Este reporte será actualizado con los hallazgos completos de los 3 subagentes especializados (código, seguridad, completitud) cuando finalicen su ejecución.*
