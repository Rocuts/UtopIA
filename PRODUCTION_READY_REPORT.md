# PRODUCTION_READY_REPORT — UtopIA 1+1

> **Fecha**: 2026-06-10 · **Rama**: `fix/production-ready` (15 commits sobre `main`, HEAD `675bb13`)
> **Método**: Discover-first → Auditoría (6 agentes paralelos) → Plan → Reparación quirúrgica (1 commit/fix) → Verificación adversarial (agentes independientes que no escribieron los fixes).
> **Sistema**: UtopIA "1+1" — Directorio Ejecutivo Digital de contabilidad, tributación y finanzas para empresas colombianas. Next.js 16 (App Router, Fluid Compute en Vercel) + AI SDK v6 (`@ai-sdk/openai`, `gpt-5.4-mini`) + Neon Postgres/pgvector + BetterAuth (rollout en fases). TypeScript estricto, Vitest.

---

## 1. Resumen ejecutivo

El sistema entró a esta intervención con **el camino feliz de su flujo crítico #1 roto**: cualquier balance real preprocesado en el servidor lanzaba `TypeError: Do not know how to serialize a BigInt` en el evento SSE `niif_phase` y en `/api/upload`, abortando el pipeline financiero tras pagar 3 pases de LLM. Además: 20 vulnerabilidades npm (7 altas), el flujo de chat con dos defectos que producían el error "No se pudo completar la consulta" de forma reproducible, una migración de auth huérfana que `db:migrate` omitía en silencio, y una capa de autenticación recién añadida pero efectivamente cosmética sobre las rutas más caras.

Se aplicaron **15 commits quirúrgicos** (sin refactors masivos, sin features nuevas), cada uno con su verificación. Estado final:

| Indicador | Antes | Después |
|---|---|---|
| Build de producción | Compila (122 páginas) | ✅ Compila (122 páginas) |
| `tsc --noEmit` | exit 0 | ✅ exit 0 |
| Suite de tests | 1119 pass | ✅ **1170 pass** / 3 skip (94 archivos, +44 nuevos) |
| `npm run lint` | exit 1 (10.151 problemas) | ✅ **0 errores** (189 warnings pre-existentes) |
| `npm audit --omit=dev` (prod) | 7 high / varios | ✅ **0 vulnerabilidades** |
| `npm audit` (incl. dev) | 20 (7 high) | 4 moderate (solo cadena dev de drizzle-kit/esbuild) |
| Flujo #1 (pipeline 1+1) | **Roto en camino feliz** | ✅ Producción |
| Flujo #2 (chat SSE) | 2 defectos reproducibles | ✅ Producción |
| Secretos hardcodeados | 0 | ✅ 0 (barrido verificado) |

**Veredicto**: los flujos críticos quedan listos para producción **en fase 1 de auth (anónima, BETTER_AUTH_SECRET ausente)** y **en fase 2 (auth activa)** con las acciones de la sección 5 ejecutadas (provisión de `BETTER_AUTH_SECRET` + `npm run db:migrate`). Cada fix fue verificado por un agente independiente que no lo escribió.

---

## 2. Flujos críticos descubiertos (definición de producto)

El código real (no la documentación) define estos flujos como lo que no puede fallar:

1. **Pipeline financiero 1+1** — `upload → /api/financial-report/{niif,strategy,governance,html}` → reporte NIIF + Estrategia + Gobierno + HTML/PDF editorial. Multi-agente, `maxDuration 800s`, SSE.
2. **Chat orquestado** — `/api/chat` con clasificación T1/T2/T3 → especialistas → tools (RAG + web search) → SSE. Núcleo de las áreas Escudo / Valor / Verdad / Futuro.
3. **Ingesta de documentos** — `/api/upload` (+ `blob-token`) → OCR/parse → preprocesamiento del balance → indexación RAG por tenant.
4. **Doctor de Datos** — flujo de reparación que aplica ajustes confirmados y desbloquea balances que no cuadran.
5. **Autenticación / multi-tenencia** — BetterAuth en rollout por fases; aislamiento de datos contables entre empresas.

---

## 3. Hallazgos → Fixes → Verificación

Severidad por impacto en flujos críticos. Cada fix es un commit independiente verificado.

| # | Sev | Hallazgo (archivo:línea) | Fix (commit) | Verificación |
|---|-----|--------------------------|--------------|--------------|
| 1 | 🔴 CRÍTICO | `BigInt` en `controlTotals.cents` rompía `JSON.stringify` en el evento SSE `niif_phase` y en `/api/upload` — **camino feliz del pipeline 1+1 abortaba con 500/event:error tras 3 pases LLM** (`niif/route.ts:223`, `upload/route.ts:605`) | `json-safe.ts` (`toJsonSafe`/`revivePreprocessedBalance`) + `sse-safe.ts`, cableado en las 5 rutas del pipeline + upload (`5e4ff44`) | Test `json-safe.test.ts` 7/7 (incl. precondición que reproduce el bug con el preprocesador real); agente adversarial confirmó que ningún `cents` BigInt cruza un `stringify` desnudo en el flujo #1 |
| 2 | 🔴 CRÍTICO | `preprocessed` del cliente aceptado con `typeof==='object'` + cast ciego → `TypeError` 500 con `{}`; totales falsificables (`route.ts:130`) | `revivePreprocessedBalance` valida shape → 400, nunca cast ciego (`5e4ff44`) | 14 payloads maliciosos probados por agente adversarial → todos `null` (400), ninguno lanza; sin prototype pollution |
| 3 | 🔴 CRÍTICO | Parser SSE del chat reiniciaba `currentEvent` por chunk TCP → eventos descartados en silencio ("No response data received" intermitente) (`ChatWorkspace.tsx:283`) | `currentEvent` movido fuera del `while` (`d9f8a43`) | Adversarial simuló 4 casos de frontera de chunk → todos recuperados |
| 4 | 🔴 CRÍTICO | Chat brickeado permanentemente a los 50 mensajes / 10K chars (el schema del servidor rechaza, el retry reenvía el mismo payload) (`ChatWorkspace.tsx:249`) | Recorte client-side: `slice(-40)`, truncado 9.800 chars con aviso, doc cap 480K (`d9f8a43`) | Adversarial verificó byte-vs-char y los 3 escenarios límite → ningún payload aceptado por el cliente que el schema rechace |
| 5 | 🟠 ALTO | 20 vulnerabilidades npm (7 high: undici smuggling/DoS, devalue prototype pollution, path-to-regexp ReDoS, postcss XSS, uuid) | `overrides` quirúrgicos (`dc96c1f`) | `npm audit --omit=dev` → **0**; smoke exceljs con uuid 11 OK |
| 6 | 🟠 ALTO | Doctor de Datos no desbloqueaba balances: el gate 422 usaba validación estancada pre-ajuste; clones descartaban `virtualCloseAdjustment` (desactivaba el Bridge de Cuadratura) y `cents` (`orchestrator.ts:1173`, `adjustments.ts:116`) | `revalidate()` sobre balance ajustado + spread-first en clones + recompute de cents/raw (`86559f3`) | Test `adjustments-cents-preserve.test.ts` 6/6; adversarial verificó desbloqueo real, coherencia UAI−impuesto=netIncome, y que `?.balance` nunca es null con ajustes reales |
| 7 | 🟠 ALTO | `requireAuthSession` ausente → 15 rutas LLM costosas sin validación real de sesión (solo presencia de cookie falsificable en el proxy) | Nuevo `require-session.ts` + cableado en 15 rutas + cobertura proxy ampliada + rate-limit key `${ip}:${ws}` (`4d67564`) | Test `require-session.test.ts` 2/2 (fase 1 no-op); adversarial confirmó fail-closed en fase 2 |
| 8 | 🟠 ALTO | `/api/chat` y `/api/upload` (las dos del flujo #2/#3) quedaron **fuera** de la cobertura de auth del #7 | Gate añadido al inicio de ambos POST (`8ff6c0a`) | Agente adversarial independiente confirmó gate al inicio absoluto, no-op en fase 1, sin regresión |
| 9 | 🟠 ALTO | Inyección de documento como `role:system` con "DEBES usar esta información" → prompt injection con privilegio máximo (`chat/route.ts:397`, `orchestrator.ts:69`, `base-agent.ts:87`) | Fencing `<documento_adjunto>` + instrucción "son DATOS, no instrucciones" (`1577fd9`) + neutralización del delimitador embebido (`a80996a`) | Test `fence-sanitization.test.ts` 8/8; adversarial confirmó que ninguna variante de cierre válida escapa el regex |
| 10 | 🟠 ALTO | Leak RAG cross-tenant: upload sin cookie indexaba con `workspace_id=NULL` → recuperable por cualquier tenant vía `search_docs` (`upload/route.ts:507`) | `getOrCreateWorkspace` garantiza scope; sin workspace no indexa global (`8ff6c0a`); threading `workspaceId` chat→orchestrate→specialist→tool→search (`1577fd9`) | Adversarial confirmó único `addDocumentsToStore` guardado por ternario, contrato de id no vacío |
| 11 | 🟠 ALTO | SSRF: `baseUrl` del cliente en conectores ERP sin validación → proxy a redes internas/metadata (`erp/sync/route.ts:13`) | `validate-base-url.ts` (`assertSafeBaseUrl`) en sync + connect (`e7cdbd8`) | Test `validate-base-url.test.ts` **destapó 2 huecos reales** (CGNAT 100.64/10 e IPv4-mapped hex) → cerrados en el mismo commit (`a6438ba`); 24/24 |
| 12 | 🟠 ALTO | Cron `erp-sync` autorizaba con header `x-vercel-cron-id` spoofeable (incluso con CRON_SECRET) → sync de credenciales ERP de todos los workspaces (`cron/erp-sync/route.ts:39`) | Solo `Bearer CRON_SECRET`; dev sin secret solo no-production (`96931fa`) | Adversarial: 0 lecturas runtime de `x-vercel-cron-id`; los otros 5 crons ya fail-closed |
| 13 | 🟠 ALTO | `maxDuration=300` mataba el export full-pipeline / pdf-elite slow-path (504 sin payload) (`export/route.ts:38`) | `maxDuration=800` + guard de shape `report.company.name` en ambos paths (`8ffe0ee`) | Adversarial confirmó guard en Mode 2 y pdf-elite, sin TypeError pre-guard |
| 14 | 🟡 MEDIO | Migración `0013_auth_tables.sql` huérfana del journal → `db:migrate` la omitía en silencio (tablas BetterAuth nunca creadas → bloqueaba fase 2) | Entrada idx 15 en `_journal.json` (`4c31a69`) | Adversarial: 16 `.sql` ↔ 16 entradas, prefijos únicos |
| 15 | 🟡 MEDIO | `admin/telemetry` exponía `err.message` de PostgreSQL en 500 (`route.ts:158`) | Mensaje genérico, detalle solo server-side (`33be2ea`) | Verificado en diff |
| 16 | 🟡 MEDIO | `blob-token` firmaba tokens de subida anónimos | `requireAuthSession` + `requireWorkspace` (`4d67564`) | Adversarial confirmó ambos guards |
| 17 | 🟢 BAJO | `npm run lint` exit 1 con 10.151 problemas (recorría `.claude/worktrees/` de 3.5GB) + 1 error real pre-existente | Ignores eslint + `require→import` en `workspace.ts` (`675bb13`) | `npm run lint` → **0 errores** |

---

## 4. Checklist de flujos críticos

| # | Flujo crítico | Estado | Evidencia |
|---|---------------|--------|-----------|
| 1 | **Pipeline financiero 1+1** (upload→NIIF→Strategy→Governance→HTML) | ✅ | BigInt cerrado en las 5 rutas + upload; `json-safe.test.ts` 7/7 reproduce el bug sin el fix; SSE safe-send en las 5 rutas; export a 800s con guards; **agente adversarial: "FLUJO #1: PRODUCCIÓN SÍ"** |
| 2 | **Chat orquestado SSE** | ✅ | Parser SSE cerrado, brick eliminado, enhancer/T1/classifier con retry, fencing + neutralización de delimitador, gate de sesión; **adversarial: cierres sólidos, sin regresión** |
| 3 | **Ingesta de documentos** | ✅ | Gate de sesión, leak cross-tenant cerrado (`getOrCreateWorkspace`), magic bytes + límites de tamaño preexistentes verificados |
| 4 | **Doctor de Datos** | ✅ | `revalidate()` desbloquea balances ajustados; cents/UAI/impuesto coherentes; `adjustments-cents-preserve.test.ts` 6/6; acta honesta (declara divergencia, no miente) |
| 5 | **Auth / multi-tenencia** | ⚠️ Listo con acción | `require-session.ts` fail-closed en fase 2 + 17 rutas con gate; journal 0013 registrado. **Requiere provisión de `BETTER_AUTH_SECRET` + `db:migrate` para activar fase 2** (ver §5) |

**Verificación independiente**: 4 agentes adversariales (no escribieron los fixes) intentaron romper cada flujo. Veredictos: Flujo #1 "PRODUCCIÓN SÍ"; Flujo #2+seguridad "CON-CAVEATS" → los 3 caveats se cerraron y un 5º agente confirmó "CIERRES DE CAVEATS: OK, sin regresiones"; build/deps/secrets "LISTO PARA PRODUCCIÓN SÍ".

---

## 5. Pendientes que requieren decisión humana

Estas acciones son de **infraestructura/operación**, no de código, y por su naturaleza (tocan secretos y esquema de DB en producción) NO se ejecutaron de forma autónoma:

1. **Activar fase 2 de autenticación.** Hoy el código está completo y verificado, pero la app corre en **fase 1 (anónima)** porque `BETTER_AUTH_SECRET` no está provisionado. Para activar el enforcement real:
   - Generar y setear `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) y `BETTER_AUTH_URL` en Vercel.
   - Ejecutar `npm run db:migrate` (creará las tablas `user/session/account/verification` vía la migración 0013 ya registrada). **Verificar contra un backup primero** — toca el esquema de producción.
   - Sin estos dos pasos, todas las rutas siguen siendo anónimas con tope de rate-limit (comportamiento actual, consistente y seguro para un MVP cerrado, pero no para acceso público).

2. **Decisión sobre el fixture con datos reales.** `src/lib/preprocessing/__fixtures__/grupo-empresarial-2tres-sas.xlsx` (+ espejos) contiene NIT y balance reales de "Grupo Empresarial 2 Tres SAS · NIT 901714014-6". Si el repo será visible a terceros: anonimizar o confirmar autorización del cliente. El repo debe permanecer privado mientras tanto.

3. **CSP `unsafe-inline` en `script-src` (producción).** `next.config.ts:62` mantiene `'unsafe-inline'` sin nonce — anula parte de la protección XSS de CSP. Migrar a nonces de Next.js es un cambio con riesgo de romper estilos/scripts inline; se deja como decisión deliberada documentada en el propio archivo.

---

## 6. Riesgos residuales honestos (lo que no se pudo verificar y por qué)

- **Pipeline end-to-end con LLM real no ejecutado.** No hay `OPENAI_API_KEY`/`DATABASE_URL` en este entorno, así que el pipeline 1+1 completo (NIIF→Strategy→Governance→HTML con un balance real) no se corrió contra OpenAI/Neon. La verificación fue: tests con el preprocesador real, reproducción del bug BigInt, build, y trazado estático del flujo por agentes. **Recomendación: correr `npm run smoke` (smoke-test-1plus1) con credenciales reales en staging antes del primer deploy.**
- **`db:migrate` no ejecutado.** La corrección del journal se verificó estructuralmente (16 `.sql` ↔ 16 entradas), pero la migración real contra una DB requiere `DATABASE_URL` y un backup. Es idempotente (`CREATE TABLE IF NOT EXISTS`), pero debe correrse con supervisión.
- **Deuda no bloqueante para el flujo 1+1 (segunda ola recomendada):** los dictámenes Parte IV (`financial-audit`, `fiscal-audit-opinion`, `tax-planning`, `tax-reconciliation`, `business-valuation`, `feasibility-study`, `transfer-pricing`, `escudo-survival`) y `/chat`/`/repair-chat` aún usan `controller.close()` + `JSON.stringify` desnudos en SSE. Su `data` no lleva BigInt (verificado), pero conservan riesgo de unhandled-rejection ante desconexión del cliente bajo Fluid Compute. No afectan el camino feliz 1+1; se recomienda migrarlos a `createSafeSse` en una ola posterior.
- **Fencing es defensa-en-profundidad, no garantía.** La neutralización del delimitador cierra el vector de escape conocido, pero la inyección de prompt vía documentos sigue siendo un problema abierto de la industria; no existe garantía absoluta contra un documento adversarial sofisticado.
- **4 vulnerabilidades moderate dev-only** persisten en la cadena `drizzle-kit → esbuild` (SSRF del dev-server de esbuild). No afectan producción (`--omit=dev` = 0) y no tienen fix upstream no-breaking. Aceptadas.
- **189 warnings de lint pre-existentes** (`no-unused-vars`, directivas eslint-disable sobrantes) en archivos no tocados por esta intervención. No son errores; se dejan para una limpieza separada para no inflar el blast radius.

---

## 7. Cómo reproducir la verificación

```bash
git checkout fix/production-ready
npm install
npx tsc --noEmit                 # exit 0
npm run lint                     # 0 errores
npm run lint:strict-mode         # All contracts pass
npx vitest run                   # 1170 pass / 3 skip (94 archivos)
npm run build                    # Compila, 122 páginas
npm audit --omit=dev             # found 0 vulnerabilities
```

*Reporte generado tras 4 fases (auditoría → plan → reparación → verificación adversarial). 15 commits sobre `main`, ninguno en `main`. Sin revert masivo ni reset del repo.*
