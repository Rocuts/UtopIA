# GO_LIVE_RUNBOOK — UtopIA 1+1

> **Fecha**: 2026-06-17 · **Rama**: `main` (production-ready ya mergeado, HEAD `2a59e6d`)
> **Alcance**: software/servicios que faltan **activar o provisionar** para dejar UtopIA listo para producción.
> **Estado de auth elegido por el operador**: **Fase 1 (anónima)** — la activación de Fase 2 queda documentada pero diferida.
> **Método**: contraste `process.env` (código) ↔ `vercel env ls` (prod) + verificación adversarial read-only contra el código real (8 agentes, sin mutaciones a prod). Complementa a [PRODUCTION_READY_REPORT.md](PRODUCTION_READY_REPORT.md) (que certifica el **código**); este documento cubre la **infraestructura/operación**.

> **Convención de seguridad en este runbook**
> - 🟢 **LECTURA** — comando seguro (no muta prod).
> - 🔴 **ESCRIBE A PROD** — lo ejecuta un humano con supervisión; este documento no lo corre.
> - Todas las claves base64 se pegan con `printf %s` (nunca `echo`): un `\n` final corrompe el secreto (ver §6.1).

---

## 0. Estado actual — qué YA está activo en producción

Verificado con `vercel env ls` (proyecto `johan-rocuts-projects/utopia`):

| Categoría | Estado |
|---|---|
| **Código** | ✅ Listo. `tsc --noEmit` exit 0 hoy. Reporte: build 122 páginas, 1170 tests, lint 0 errores, `npm audit --omit=dev` 0 vulnerabilidades. |
| **LLM / búsqueda** | ✅ `OPENAI_API_KEY`, `TAVILY_API_KEY` en prod. |
| **DB** | ✅ Neon Postgres (set completo + pooled), `DATABASE_URL`/`_UNPOOLED` en Prod/Preview/Dev. |
| **Cifrado** | ✅ `DB_ENCRYPTION_KEY` en prod (**ya cifra datos — NUNCA cambiarla**, ver §6.2). |
| **Blob** | ✅ `BLOB_READ_WRITE_TOKEN` + `BLOB_STORE_ID` + `BLOB_WEBHOOK_PUBLIC_KEY`. |
| **Crons** | ✅ 6 jobs declarados en [vercel.ts](vercel.ts) — se registran solos en el deploy de **producción** (no en preview). Protegidos por `CRON_SECRET` (presente). |
| **Flags** | ✅ Los 7 `UTOPIA_ENABLE_*` + `UTOPIA_AGENT_MODE=orchestrated` + `UTOPIA_INTERNAL_SECRET` + `NOTIFICATIONS_FROM`. |
| **Auth** | ⚪ **Fase 1 anónima** — `BETTER_AUTH_SECRET`/`URL` ausentes en TODOS los entornos (confirmado). Enforcement inactivo por diseño. |

**Gaps que el código lee pero NO están en prod:** `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DB_HMAC_KEY`, `UTOPIA_VAULT_KEY`, `UTOPIA_ADMIN_TOKEN`, `RESEND_API_KEY`, `UPSTASH_*`, `COHERE_API_KEY`, `NEXT_PUBLIC_APP_URL`/`NEXTAUTH_URL`.

---

## 1. Lo MÍNIMO para operar bien en Fase 1 (anónima)

La app ya responde en prod, pero hay **un gap funcional real** y dos condicionales incluso sin auth:

### 1.1 🔴 RAG corpus en Neon pgvector — VERIFICAR / INGESTAR (gap funcional)
El RAG migró de HNSWLib a **Neon pgvector** (tabla `rag_chunks`). Si está vacía, el chat responde `NO_RESULTS:` (no crashea, pero el RAG es mudo).

```bash
# 🟢 LECTURA — contar corpus global vs por-tenant (DATABASE_URL de .env.local ya apunta a prod pooled)
psql "$DATABASE_URL" -c "SELECT CASE WHEN workspace_id IS NULL THEN 'global' ELSE 'tenant' END AS scope, count(*) chunks, count(DISTINCT source) sources FROM rag_chunks GROUP BY 1 ORDER BY 1;"
```

Si `global` = 0 → ingestar (hay **423 archivos** en `src/data/tax_docs/`):

```bash
# 🔴 ESCRIBE A PROD + cuesta tokens de embeddings (text-embedding-3-small). Corre LOCAL pero escribe a la DB de .env.local (=prod).
PURGE_BEFORE_INGEST=1 npm run db:ingest      # primera carga / recarga limpia (DELETE WHERE workspace_id IS NULL + reinsert)
```
> ⚠️ `npm run db:ingest` **sin flags NO es idempotente**: re-ejecutar **duplica** chunks (no hay UNIQUE sobre `source`). Para recargar usa siempre `PURGE_BEFORE_INGEST=1`. `SKIP_EXISTING=1` reanuda una ingesta interrumpida (se ignora si también pones PURGE). `CONTEXTUAL_RETRIEVAL=1` añade ~30% de costo (prefijos LLM para archivos ≤100KB).

Confirmar post-ingesta (🟢):
```bash
psql "$DATABASE_URL" -c "SELECT doc_type, count(*) FROM rag_chunks WHERE workspace_id IS NULL GROUP BY doc_type ORDER BY 2 DESC LIMIT 20;"
```

### 1.2 `DB_HMAC_KEY` — condicional (lookups sobre columnas cifradas)
`encryptedLookupValue()` lanza `throw` si falta y se ejecuta un lookup determinista por NIT cifrado ([encryption.ts:120-126](src/lib/security/encryption.ts#L120-L126)). Si todavía no se ejercita ese camino, no bloquea — pero provisiónala antes de habilitar PII/NIT cifrado. Ver §6.

### 1.3 `UTOPIA_VAULT_KEY` — condicional (vault de credenciales ERP)
El cron `erp-sync` corre cada 2h pero solo actúa sobre workspaces con ERP **conectado**. La primera conexión ERP llama a `encryptSecret()`, que lanza `throw` sin la clave ([vault.ts:33-40](src/lib/security/vault.ts#L33-L40)). Provisiónala antes de habilitar conectores ERP. Ver §6.

---

## 2. Verificación local pre-deploy (gate de go-live)

Secuencia del [PRODUCTION_READY_REPORT §7](PRODUCTION_READY_REPORT.md), en orden (🟢, salvo `build` que escribe `.next/` local):

```bash
npx tsc --noEmit && npm run lint && npm run lint:strict-mode && npx vitest run && npm run build && npm audit --omit=dev
```
Esperado: tsc exit 0 · lint 0 errores (189 warnings pre-existentes OK) · 1170 pass/3 skip · 122 páginas · audit `--omit=dev` = 0.

> Los conteos provienen del reporte (2026-06-10); pueden haber drifteado — re-correr antes del deploy.

### 2.1 Smoke contable (WS1–WS6) en staging
`npm run smoke` valida 6 workstreams **deterministas** (tax-engine, pyme-promote, banking, adjustments, monthly-close, notifications). **No** cubre el pipeline financiero 1+1 ni el chat (no tocan LLM). Requiere `DATABASE_URL` y un dev server; **escribe fixtures en la DB** (idempotente, pero crea un workspace de prueba → usar DB de **staging/preview, nunca prod**).

```bash
npm run dev    # en otra terminal
SMOKE_BASE_URL=https://<preview>.vercel.app npm run smoke   # DATABASE_URL de .env.local debe apuntar a la MISMA DB del preview
```

> El pipeline 1+1 end-to-end con LLM real **nunca se ejecutó** (reporte §6). Correrlo manualmente en staging con `OPENAI_API_KEY` real antes del primer deploy (chat + un reporte financiero completo).

---

## 3. Deploy a producción + rollback

```bash
vercel deploy --prod            # 🔴 registra los 6 crons (solo el deploy de prod los activa)
vercel ls utopia                # 🟢 listar deployments para elegir target de rollback
vercel rollback                 # 🔴 reapunta el alias de prod al build anterior — INSTANTÁNEO, sin rebuild
```
> `vercel rollback` revierte **código**, no env vars: si el incidente fue un cambio de env var, corrige la var y redespliega.

### 3.1 Verificación post-deploy
```bash
curl -i https://<DOMINIO-PROD>/api/workspace     # 🟢 health barato (200 + {workspace:{id}}). NO existe /api/health ni GET /api/chat.
# Chat (flujo #2) — POST con Origin (CSRF fail-closed) + cookie; consume tokens OpenAI:
curl -i -X POST https://<DOMINIO-PROD>/api/chat -H 'Content-Type: application/json' -H 'Origin: https://<DOMINIO-PROD>' -b 'utopia_workspace_id=<uuid>' -d '{"messages":[{"role":"user","content":"hola"}]}'
```

---

## 4. Servicios externos opcionales (diferidos — degradan con gracia)

Confirmado: **ninguna** de estas ausencias rompe el chat ni el pipeline financiero.

### 4.1 Resend (email — Sentinel + cierre mensual)
Sin `RESEND_API_KEY` el email es no-op con `console.warn` (`status:'skipped'`), nunca `throw` ([dispatch.ts:155-178](src/lib/notifications/dispatch.ts#L155-L178)). Orden:
```bash
printf %s 're_xxx'                       | vercel env add RESEND_API_KEY production        # 🔴
printf %s 'UtopIA <noreply@TUDOMINIO>'   | vercel env add NOTIFICATIONS_FROM production    # 🔴 dominio verificado en Resend (DNS SPF/DKIM)
printf %s 'UtopIA <noreply@TUDOMINIO>'   | vercel env add NOTIFICATIONS_FROM_ADDRESS production  # 🔴 ⚠️ ver inconsistencia abajo
printf %s 'https://<DOMINIO-PROD>'       | vercel env add NEXT_PUBLIC_APP_URL production    # 🔴 requiere REDEPLOY (NEXT_PUBLIC_* se inlinea en build)
printf %s 'https://<DOMINIO-PROD>'       | vercel env add NEXTAUTH_URL production           # 🔴 base del link de unsubscribe
```
> ⚠️ **Inconsistencia real**: `dispatch.ts` usa `NOTIFICATIONS_FROM` pero `sentinel-insight.ts` usa `NOTIFICATIONS_FROM_ADDRESS` ([sentinel-insight.ts:18,77](src/lib/notifications/sentinel-insight.ts#L18)). Para un remitente uniforme, setear **ambas**. `UTOPIA_INTERNAL_SECRET` (ya en prod) es prerequisito duro del link de unsubscribe. El flag `UTOPIA_ENABLE_NOTIFICATIONS` ya está en `true`.

### 4.2 Upstash Redis (rate-limit distribuido)
Sin Upstash el rate-limit cae a **memoria por-instancia** (Fluid Compute multi-instancia ⇒ límite efectivo × nº instancias). Es **FAIL-OPEN** ante outage de Redis (no bloquea tráfico).
```bash
vercel integration add upstash      # 🔴 inyecta UPSTASH_REDIS_REST_URL/TOKEN
vercel env pull .env.local          # 🟢 sincroniza local
```
> ✅ **NO requiere `npm i @upstash/ratelimit @upstash/redis`** — el código usa la REST API vía `fetch` ([rate-limit.ts:45-78](src/lib/security/rate-limit.ts#L45-L78)). Solo las 2 env vars.

### 4.3 Cohere (reranking RAG)
Opcional. Sin `COHERE_API_KEY` el RAG usa RRF directo ([vectorstore.ts:237](src/lib/rag/vectorstore.ts#L237)). `@ai-sdk/cohere` ya está instalado.
```bash
printf %s 'co_xxx' | vercel env add COHERE_API_KEY production   # 🔴
```

---

## 5. Activación Fase 2 de autenticación (DIFERIDA — ⚠️ NO es solo infra)

> La verificación adversarial encontró **3 blockers + 4 riesgos altos**. Esto **NO** es "setear secret + migrar". Requiere **cambios de código** y validación en preview **antes** de tocar producción. Validar tu decisión de quedarte en Fase 1 por ahora fue correcto.

### 5.1 Blockers que hay que resolver ANTES (varios son CÓDIGO, no env vars)

| # | Blocker | Evidencia | Resolución |
|---|---------|-----------|------------|
| B1 | **`db:migrate` puede saltar 0013 en silencio.** Drizzle decide por timestamp (`created_at < folderMillis`), no por hash. Dado el historial de `drizzle-kit push` en prod (borró infra el 2026-05-07, ver memoria `db:push borra drift`), `__drizzle_migrations` es incierto. | [dialect.cjs:64] · `_journal.json` 0013 `when:1780704794000` | Verificar estado real (🟢 `SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5;`). Si el último ≥ 0013, aplicar 0013 **a mano** en transacción (`psql -1 -f src/lib/db/migrations/0013_auth_tables.sql`) y verificar `SELECT to_regclass('public."user"'), to_regclass('public.session');` no-null en ambos. |
| B2 | **No hay seed de admin.** Al setear el secret, toda ruta protegida exige sesión contra una tabla `user` vacía → nadie entra salvo por `/signup`. | `require-session.ts:30-56`; único `db:seed` es calendar | Validar `/signup` end-to-end en preview, o crear script de seed (no existe). Paso bloqueante: "crear ≥1 usuario y verificar login". |
| B3 | **Falta `BETTER_AUTH_URL`** (ausente en todo entorno; fallback `localhost:3000`). Cookies emitidas para el host equivocado → login roto aunque haya usuario+tablas. | [config.ts:35](src/lib/auth/config.ts#L35) | Setear `BETTER_AUTH_URL=https://<DOMINIO-PROD>` en el **mismo paso** que el secret. Confirmar el dominio canónico real (el comentario cita `utopia.sequal.com.co` — verificar). |

### 5.2 Riesgos altos a reconciliar

- **`claimAnonymousWorkspace` es código muerto** (definido, nunca llamado → [workspace.ts:141](src/lib/agents/workspace.ts)). Al activar Fase 2, los workspaces anónimos (con `user_id NULL`) quedan **huérfanos** y cada login crea uno **nuevo vacío** → pérdida efectiva de acceso a datos pre-auth. **Decidir e implementar** el claim post-login (mapeo email→workspace) o comunicar la discontinuidad.
- **`db:push` ciego a auth.** `schema.ts` NO re-exporta `schema-auth.ts` → un `db:push` futuro **DROPearía** las tablas de auth como drift; además `workspaces.user_id` está sin FK en schema pero 0013 la añade → drift permanente. **Prohibir `db:push` para siempre en prod** + re-exportar `schema-auth.ts` (ver §6.3).
- **`PROTECTED_APIS` es un superconjunto.** El proxy gatea cookie en `/api/financial-report`, `/api/sentinel`, `/api/erp`, `/api/accounting`, `/api/pyme` aunque sus handlers NO llamen `requireAuthSession` → al activar Fase 2 puede romper tráfico server-to-server no exento. Reconciliar `PROTECTED_APIS` ↔ `AUTH_EXEMPT_APIS` antes.
- **`trustedOrigins` no seteado** → los previews `*.vercel.app` no funcionarán para auth. `requireEmailVerification:false` + `/signup` abierto sin rate-limit específico → registro masivo posible. Añadir límite a `/api/auth` y decidir verificación de email (con Resend ya configurado).

### 5.3 Orden seguro corregido (cuando se decida activar)
1. (código) Re-exportar `schema-auth.ts`; añadir `trustedOrigins`; reconciliar `PROTECTED_APIS`; resolver `claimAnonymousWorkspace`; rate-limit `/api/auth`.
2. 🔴 **Prohibir `db:push`**. Backup/snapshot del **branch exacto** de prod (`neonctl branches create ...` o `pg_dump`).
3. 🟢 Verificar estado real de `__drizzle_migrations` (B1). Aplicar 0013 (a mano si db:migrate lo saltaría). Verificar `to_regclass` de `user`+`session`.
4. 🔴 Setear `BETTER_AUTH_SECRET` + `BETTER_AUTH_URL` **solo en Preview**; crear admin y verificar login.
5. 🔴 Recién entonces activar en **Production** con rollback de 1 paso listo: `vercel env rm BETTER_AUTH_SECRET production` + redeploy (vuelve a Fase 1).
6. 🟢 Smoke: `curl -s -o /dev/null -w '%{http_code}' https://<DOMINIO-PROD>/api/chat` sin cookie → **401** = Fase 2 activa.

> Generar el secret: `openssl rand -base64 32` (o el ya generado en el Apéndice). `BETTER_AUTH_SECRET` no valida longitud — cualquier string no vacío activa el gate ([proxy.ts:10](src/proxy.ts#L10), [require-session.ts:30](src/lib/auth/require-session.ts#L30)).

---

## 6. Provisión de secretos (corregida por la auditoría cripto)

### 6.1 ⚠️ Sensibilidad a FORMA y whitespace (HIGH — fallo silencioso)
`encryption.ts` pasa el **string base64 crudo** (sin decodificar) como password a `pgp_sym_encrypt`/`hmac` de Postgres ([encryption.ts:87,106,126](src/lib/security/encryption.ts#L87)). Consecuencia:
- Un `\n` o espacio al pegar la clave en Vercel **cambia el digest HMAC** → **todos** los `WHERE nit_lookup = ...` devuelven 0 filas **sin error**. La guarda `length<24` no lo detecta.
- Mezclar forma base64 (`+`/`=`) vs base64url (`-`/`_`) del mismo valor entre entornos rompe los lookups igual.

**Regla:** generar en forma **base64 estándar**, pegar con `printf %s` (nunca `echo`), y verificar tras provisionar:
```bash
vercel env pull .env.check --environment=production --yes    # 🟢
node -e "const k=process.env.DB_HMAC_KEY; console.log(JSON.stringify(k), k.length, Buffer.from(k,'base64').length)"
# Esperado: 44 y 32, sin comillas extra ni \n
```

### 6.2 Claves DISTINTAS por entorno (HIGH — blast radius)
`UTOPIA_VAULT_KEY`, `DB_ENCRYPTION_KEY` y `DB_HMAC_KEY` deben tener **valores diferentes** en Production / Preview / Development. Reusar el mismo valor + `vercel env pull` ⇒ un `.env.local` filtrado **descifra credenciales ERP de clientes en producción**. Solo `BETTER_AUTH_SECRET`/`UTOPIA_ADMIN_TOKEN` podrían compartir valor si se acepta el riesgo.

> 🛑 **`DB_ENCRYPTION_KEY` YA está en prod cifrando datos. NO la añadas ni cambies** — un valor distinto rompe `pgp_sym_decrypt` de todas las filas existentes (solo migrable con `DB_ENCRYPTION_KEY_PREV` + re-cifrado). Déjala intacta.

### 6.3 Comandos de provisión (cuando se decida)
```bash
# Generar (base64 estándar, 32 bytes) — uno DISTINTO por entorno:
node -e "console.log(crypto.randomBytes(32).toString('base64'))"

# 🔴 ESCRIBE A PROD — pegar SIN newline:
printf %s '<VAULT_KEY_PROD>'  | vercel env add UTOPIA_VAULT_KEY production
printf %s '<HMAC_KEY_PROD>'   | vercel env add DB_HMAC_KEY production       # distinta de DB_ENCRYPTION_KEY
printf %s '<ADMIN_TOKEN>'     | vercel env add UTOPIA_ADMIN_TOKEN production # sin él, /api/admin/* devuelve 503 (fail-closed)
```
> `UTOPIA_VAULT_KEY` es el único con validación estricta (32 bytes exactos, [vault.ts:44-52](src/lib/security/vault.ts#L44-L52)). `DB_HMAC_KEY` solo exige truthy; `UTOPIA_ADMIN_TOKEN` solo truthy + comparación `!==` (no timing-safe — ver §7).

---

## 7. Hardening de código (descubierto por la auditoría — no bloquea, alto valor)

**Estado**: fixes 1 y 2 **implementados en la rama `fix/prod-hardening`** (commiteados, **NO desplegados**; inertes en el prod actual porque `DB_HMAC_KEY`/`UTOPIA_ADMIN_TOKEN` no están provisionadas). Fix 3 **retenido**. Verificado: `tsc` exit 0, `eslint` 0, tests de seguridad 22/22.

1. ✅ **`encryption.ts`** ([src/lib/security/encryption.ts](src/lib/security/encryption.ts)):
   - `encryptedLookupValue` (`DB_HMAC_KEY`): `.trim()` + valida `Buffer.from(k,'base64').length===32` y lanza si no. Seguro — la clave no está seteada, así que no existen `nit_lookup` previos escritos con otra forma.
   - `getKey` (`DB_ENCRYPTION_KEY`): **NO muta** el valor (mutar rompería el descifrado de datos ya cifrados); solo `console.warn` una vez si detecta whitespace o que no decodifica a 32 bytes. Cierra el fallo silencioso de §6.1 sin riesgo.
2. ✅ **`timingSafeEqual` en endpoints admin** (nuevo [admin-auth.ts](src/lib/security/admin-auth.ts) + telemetry + activity): comparación de tiempo constante en vez de `!==`, conservando el fail-closed 503/401.
3. ⏸️ **`schema.ts` → re-exportar `schema-auth.ts`** — RETENIDO. No es un one-liner seguro: `workspaces.user_id` está declarado sin FK pero la migración 0013 lo añade → re-exportar en aislamiento introduciría drift que un `db:push`/`generate` querría "corregir". Requiere además declarar el FK en `userId` + regenerar el snapshot de drizzle. Va con los prerequisitos de Fase 2 (§5.2).

---

## 8. Riesgos residuales / decisiones conscientes

- **CSP `unsafe-inline` en `script-src` (prod)** — deuda deliberada documentada ([next.config.ts:61-62](next.config.ts#L61)). `unsafe-eval` sí se elimina en prod. Migrar a nonces de Next.js es el cierre pendiente.
- **Fixture con datos reales** — `src/lib/preprocessing/__fixtures__/grupo-empresarial-2tres-sas.xlsx` (NIT 901714014-6, 21.913 bytes). Decisión **abierta**: anonimizar o mantener el repo privado. Solo 1 path versionado (`git ls-files | grep grupo-empresarial`).
- **Deuda SSE (no bloqueante)** — 8 dictámenes Parte IV + `/chat` + `/repair-chat` usan aún `controller.close()` + `JSON.stringify` desnudo (las 5 rutas del pipeline 1+1 ya usan `createSafeSse`). Su `data` no lleva BigInt (verificado); riesgo de unhandled-rejection ante desconexión bajo Fluid Compute. Migrar en ola posterior.
- **4 vulnerabilidades moderate dev-only** (`drizzle-kit → esbuild`, SSRF del dev-server) — aceptadas, no llegan al bundle de prod (`--omit=dev` = 0).
- **Prompt injection vía documentos** — el fencing es defensa-en-profundidad, no garantía absoluta.
- **Doc desactualizada** — `CLAUDE.md` dice que `process.env.VERCEL` cae a `MemoryVectorStore`; el código ya usa **Neon pgvector** (el `VERCEL` solo afecta `getStoragePath` de uploads). Corregir CLAUDE.md.

---

## Apéndice — secretos generados (válidos, 32 bytes verificados byte a byte)

> Usables para **un** entorno (prod). Para Preview/Dev generar **valores distintos** (§6.2).

```
BETTER_AUTH_SECRET = 9B181YzTWWydHbYXfZJOUhPOFayGCh0VA2MGdwrUwEY    # base64url; string opaco para BetterAuth
DB_HMAC_KEY        = lkUB5IN+7SsuzLhVShOIbihxgksh3Twr+6f9cvg9aYo=   # base64, decodifica a 32 bytes
UTOPIA_VAULT_KEY   = 1y0Bo+r3vp14fu+MHzOiA8U1qhLtKl1zUCiO7c0lnYQ=   # base64, 32 bytes (pasa validación estricta)
UTOPIA_ADMIN_TOKEN = weu5mZATB1a7gyRGikPv6oqZqlitQz5_kU2Wdvd-ZUc    # base64url; comparación de igualdad
```
