# Spec — API de Clientes v1 (`/api/v1`)

**Estado:** diseño aprobable — implementación inicial en `feat/api-clientes-v1`.
**Fecha:** 2026-08-19.
**Origen:** `/goal crear un api para conectarnos con los clientes basado en las best practices en 2026`.
Las decisiones de este documento se tomaron de forma autónoma (sesión `/goal`) con base en
(a) investigación en línea verificada contra fuentes primarias (IETF, RFC Editor, spec.openapis.org,
OWASP, docs oficiales de Stripe/GitHub/Svix/OpenAI) y (b) el estado real del repo. Cada decisión
lleva su racional; **Johan debe revisar este documento antes de exponer el API a clientes reales.**

---

## 1. Propósito y alcance

Un API HTTP **B2B server-to-server** para que los sistemas de los clientes de UtopIA (ERPs,
software contable, integradores) se conecten programáticamente a la plataforma. La v1 entrega
la capacidad de mayor valor que hoy es 100 % determinista — **remitir un balance de prueba PUC
y recibir la validación NIIF completa** (anclas en centavos, ecuación contable, curator R1–R4,
discrepancias) — más la infraestructura de plataforma que cualquier API serio necesita:
autenticación por llaves, errores estándar, rate limiting, idempotencia, paginación, webhooks
firmados, OpenAPI y descubrimiento.

### Recursos v1

| Recurso | Métodos | Qué hace |
|---|---|---|
| `/api/v1/me` | GET | Introspección de la llave: workspace, scopes, límites |
| `/api/v1/trial-balances` | POST, GET | Remitir balance (CSV o filas JSON) → validación determinista; listar remisiones |
| `/api/v1/trial-balances/{id}` | GET, DELETE | Detalle recomputado (totales, discrepancias, curator); DELETE = borrado físico (Ley 1581) |
| `/api/v1/webhook-endpoints` | POST, GET | Registrar/listar endpoints de webhook del workspace |
| `/api/v1/webhook-endpoints/{id}` | GET, PATCH, DELETE | Gestionar un endpoint (ETag + If-Match en PATCH) |
| `/api/v1/webhook-endpoints/{id}/ping` | POST | Enviar evento `ping` firmado (prueba de integración) |
| `/api/v1/openapi.json` | GET | Contrato OpenAPI 3.1 generado desde los schemas Zod |
| `/api/v1/docs` | GET | Referencia HTML server-rendered (CSP-safe, sin scripts externos) |
| `/.well-known/api-catalog` | GET | Descubrimiento RFC 9727 (`application/linkset+json`) |
| `/api/admin/api-keys` | POST, GET, DELETE | Emisión/listado/revocación de llaves (gate `x-admin-token` existente) |
| `/api/admin/api-keys/{id}/rotate` | POST | Rotación con gracia de 7 días (patrón Stripe) |

### No-objetivos de v1 (explícitos)

1. **No dispara pipelines LLM** (reporte financiero, dictámenes). Son jobs de 800 s con costo
   real por corrida y hoy se orquestan desde el navegador; exponerlos exige un job-runner
   server-side con estado + decisiones de facturación. El patrón ya queda reservado en el
   contrato: `202 Accepted + Location: /v1/jobs/{id}` (RFC 9110 §15.3.3). → v1.1.
2. **No escribe en `journal_lines`** ni en el núcleo contable. Las remisiones del API son
   documentos externos inmutables del ERP del cliente; la fuente de verdad contable interna
   no se toca (respeta la decisión "single source of truth en journal_lines" de
   `src/lib/cache/preprocessed-balance.ts`).
3. **No OAuth todavía.** API keys en v1; OAuth 2.1 `client_credentials` cuando BetterAuth
   esté activo; perfil FAPI 2.0 como meta financiera de largo plazo (§10, roadmap §13).
4. **No SDK propio en v1.** El contrato OpenAPI 3.1 es el entregable; generación con
   Speakeasy queda en roadmap (Stainless fue adquirido por Anthropic 2026-05 y sus productos
   hosted se apagan; Fern fue adquirido por Postman 2026-01).

---

## 2. Preguntas de diseño y decisiones

| # | Pregunta | Decisión | Racional |
|---|---|---|---|
| Q1 | ¿Quién es "el cliente" del API? | El **workspace** existente (empresa con NIT). Cada llave pertenece a un workspace. | Reusa el modelo de tenant real (`workspaces`), habilita aislamiento BOLA por diseño: toda query filtra por `workspace_id` derivado de la llave, jamás del payload. |
| Q2 | ¿Primer recurso de negocio? | `trial-balances` sobre `parseTrialBalanceCSV` + `preprocessTrialBalance`. | Es el motor determinista auditado del repo (anclas en centavos, curator NIIF). Cero superficie de alucinación; valor inmediato para ERPs. |
| Q3 | ¿Persistir el `PreprocessedBalance`? | **No.** Se persiste la remisión cruda (filas + metadatos) y un resumen pequeño; el detalle se **recomputa al leer** (determinista ⇒ idéntico). | Respeta la filosofía anti-desync documentada en el repo; el preprocesador corre en 200–500 ms. `preprocessor_version` viaja en la respuesta para trazabilidad. |
| Q4 | ¿Casing del JSON público? | **snake_case** (paths kebab-case, plural). | Convención fintech dominante verificada (Stripe, GitHub, OpenAI, Zalando regla 118 MUST). El brief REST prefería camelCase por consistencia de stack; se descarta porque los consumidores son integradores externos y el contrato vive en UN solo lugar (schemas Zod) — no hay capa dual que desincronizar. |
| Q5 | ¿Formato de IDs? | Estilo TypeID: prefijo + **UUIDv7 (RFC 9562) en base32** (`tb_0698fq7yv7f7btkdjq8x2xz3ec`). El PK uuid de la fila **es** el ID público decodificado — sin columna duplicada. | K-sortable (localidad B-tree en Neon), 74 bits aleatorios (no enumerable), type-safe en logs/soporte. **Caveat registrado:** RFC 9562 sugiere v4 cuando el ID participa en operaciones de seguridad; aquí NO participa — la autorización jamás depende del secreto del ID (todo query filtra por tenant) y el "leak" del v7 es el instante de creación, que el propio recurso ya publica en `created_at` a su único observador (el dueño). No hay listados cross-tenant en v1. |
| Q6 | ¿Dinero? | `{"amount": "<string entero en centavos>", "currency": "COP"}`. | MoneyCop tal cual viaja internamente (cero conversión) + práctica Stripe de unidades menores + string para no romper 2^53 en JS. |
| Q7 | ¿Dónde corre la entrega de webhooks? | **Workflow DevKit** (`'use workflow'` + `'use step'`), patrón ya establecido en `src/lib/workflows/monthly-close`. | Reintentos hasta ~28 h exigen sleeps durables y crash-safety; es la herramienta Vercel-nativa ya presente en deps. |
| Q8 | ¿Cómo convive con `proxy.ts`? | `/api/v1/` entra a `CSRF_ALLOWLIST` (server-to-server sin Origin), a `AUTH_EXEMPT_APIS` (autentica con su propia llave) y a `RATE_LIMITS` con IDs WAF propios. | Mismo patrón documentado de `/api/erp/webhook/` y `/api/cron/`. El backstop IP del proxy se mantiene; la cuota real es por llave dentro del handler. |
| Q9 | ¿Validación 400 vs 422? | 400 = JSON malformado / tipos inválidos (falla Zod). 422 = parsea pero viola reglas de negocio (0 filas PUC válidas, mismatch de idempotencia). Un balance descuadrado **no** es error: la remisión se crea y el descuadre se reporta como finding. | RFC 9110 §15.5.21; el propósito del recurso es justamente reportar el descuadre. |
| Q10 | ¿Idioma de los errores? | `type`/`code` en inglés (máquina), `detail` en español (humano — los integradores son colombianos). Documentado en la referencia. | Coherente con la plataforma ES-primero sin romper tooling. |

## 3. Enfoques considerados

- **A. Gateway delgado sobre las rutas internas existentes** — descartado: las rutas internas
  asumen cookie de workspace + Origin de navegador + sesión BetterAuth futura; no hay contrato
  estable ni tenancy por llave. Acoplar el contrato externo a handlers de UI es deuda inmediata.
- **B. Superficie dedicada `/api/v1` + toolkit compartido `src/lib/api/` (elegido)** — rutas
  nuevas con contrato propio, reutilizando dominio (preprocesador), DB (`getDb`), seguridad
  (vault, admin-auth, rate-limit) y el proxy. Control total del contrato, cero acoplamiento a UI.
- **C. Servicio/gateway separado (proyecto aparte, Kong/Apigee)** — descartado: infra nueva,
  segundo deploy, overkill para la escala actual; nada lo exige en Vercel.

---

## 4. Estándares adoptados (verificados en línea, agosto 2026)

| Estándar | Estado verificado | Uso en este API |
|---|---|---|
| OpenAPI **3.1.2** (patch 2025-09-19; 3.2.0 existe desde la misma fecha) | Vigente; 3.2 es superset | Contrato declarado `3.1.2` — máxima compatibilidad de tooling de los clientes; migrar a 3.2 es cero-costo cuando la cadena lo soporte |
| **RFC 9457** Problem Details (jul-2023, obsoleta 7807) | Estándar indiscutido de errores | Todo error no-2xx es `application/problem+json` con extensión `errors[]` (JSON Pointer desde Zod) y `request_id` |
| **RFC 6585** 429 + Retry-After | Estable desde 2012 | Contrato firme de rate limiting |
| `draft-ietf-httpapi-ratelimit-headers-11` (2026-05-23) | **Aún draft** | Headers `RateLimit` / `RateLimit-Policy` (Structured Fields RFC 9651) emitidos y documentados como sujetos al draft |
| `Idempotency-Key` (draft IETF **expirado** -07; de facto = Stripe) | Estándar de facto | Semántica Stripe + códigos del draft: replay ⇒ misma respuesta + `Idempotent-Replayed: true`; mismatch ⇒ 422; concurrente ⇒ 409; TTL 24 h |
| **RFC 9745** `Deprecation: @unix` (mar-2025) + **RFC 8594** `Sunset: HTTP-date` | Vigentes | Helper de lifecycle listo desde el día 1 (hoy sin endpoints deprecados) |
| **RFC 9727** `/.well-known/api-catalog` (jun-2025) | Vigente | Publicado, apunta a OpenAPI + docs |
| **RFC 9110/9111** (STD 97/98) | Base semántica | 201+Location en creación; 202 reservado para jobs; ETag/If-Match/412 en PATCH de webhooks |
| **RFC 8288** Link header | Vigente | `Link: <…>; rel="next"` duplicando `next_cursor` |
| **Standard Webhooks v1.0.0** | Ganó: OpenAI, Anthropic, Gemini, Svix, Twilio la usan | Firma, headers y envelope exactos (§9) |
| **RFC 9562** UUIDv7 (may-2024) | Vigente | IDs de recurso (§2 Q5) |
| Versionado | Sin consenso industria; path = Google AIP-185, header fecha = Stripe/GitHub | **`/v1` en path**, evolución solo aditiva; header por fecha se añadiría encima sin romper |
| Paginación | Consenso cursor > offset (Zalando 160, AIP-158, Stripe) | `limit` (1–100, default 20) + `cursor` opaco (base64url de `(created_at,id)` firmado HMAC); respuesta `{data, has_more, next_cursor}` |

---

## 5. Arquitectura

```
src/lib/api/                      ← toolkit del API público (unidad testeable c/u)
  ids.ts            TypeID: uuidv7(), encode/decode prefijo+base32, validación
  problems.ts       RFC 9457: problem(), zodToProblem(), catálogo de types/codes
  auth.ts           parseo Bearer, SHA-256, lookup por hash, scopes, last_used throttled
  keys.ts           generación utop_live_/utop_test_, prefijo visible, last4
  rate-limit.ts     cuota por llave (reusa lib/security/rate-limit) + headers draft-11
  idempotency.ts    fingerprint SHA-256, replay/mismatch/in-flight sobre Postgres
  pagination.ts     cursores opacos firmados (DB_HMAC_KEY), Link header
  handler.ts        withApiV1({scopes, limit, idempotent}) — composición del pipeline
  webhooks.ts       firma Standard Webhooks v1, creación de mensajes, dispatch
  openapi.ts        documento OpenAPI 3.1.2 desde los schemas Zod (z.toJSONSchema)
  schemas.ts        TODOS los schemas Zod del contrato (única fuente de verdad)
src/lib/workflows/webhook-delivery/
  index.ts          'use workflow' — schedule Svix 8 intentos (~28 h)
  steps/attempt.ts  'use step' — fetch con timeout 10 s, registro de intento
  steps/finalize.ts 'use step' — exhausted / desactivación endpoint (~5 días)
src/lib/db/schema-api.ts          ← tablas (re-exportado desde schema.ts)
src/app/api/v1/…                  ← route handlers delgados (validar→dominio→serializar)
src/app/api/admin/api-keys/route.ts
src/app/.well-known/api-catalog/route.ts
scripts/create-api-key.ts         ← emisión CLI (además del endpoint admin)
```

**Pipeline de `withApiV1`** (orden fijo):
`request_id` → auth (Bearer → hash → llave activa) → scope → rate limit por llave →
`Idempotency-Key` (si POST y declarado) → validación Zod → handler de dominio →
serialización + headers (`X-Request-Id`, `RateLimit*`, `Utopia-Api-Version`).
Cualquier throw se convierte en problem+json; los 5xx no filtran internals (patrón del
repo en `/api/admin/telemetry`).

### Modelo de datos (`schema-api.ts`)

```
api_keys              id uuid PK (v7, jamás expuesto) · workspace_id FK · name
                      · key_hash char(64) unique (hex de HMAC-SHA256(pepper, token))
                      · pepper_version smallint · prefix ("utop_sk_live_") · last4
                      · scopes text[] · rpm_read int · rpm_write int
                      · expires_at? · revoked_at? · revoked_reason? · created_by?
                      · rotated_from_key_id? (self-FK, gracia 7 días estilo Stripe)
                      · last_used_at? (throttled 1/min) · created_at
api_idempotency_keys  id uuid PK · workspace_id FK · endpoint · idem_key ·
                      request_fingerprint (sha256) · status processing|completed ·
                      response_status? · response_body jsonb? · created_at
                      unique (workspace_id, endpoint, idem_key)
api_trial_balances    id uuid PK (v7 = ID público tb_…) · workspace_id FK ·
                      source csv|rows · period_label ·
                      raw_rows_encrypted text (envelope vault AES-256-GCM del JSON de
                      RawAccountRow[] — Ley 1581: los nombres de cuentas pueden contener
                      personas naturales; Neon cifra en reposo, esto añade capa app) ·
                      row_count · status balanced|unbalanced · summary jsonb (totales cents
                      como string, equation_delta, counts de findings — sin PII) ·
                      preprocessor_version · idempotency_key? · created_at
api_webhook_endpoints id uuid PK (v7 = whe_…) · workspace_id FK · url · description? ·
                      events text[] · secret_encrypted (vault AES-256-GCM) ·
                      status enabled|disabled · first_failing_at? · disabled_at? ·
                      created_at · updated_at
api_webhook_messages  id uuid PK (v7 = msg_…) · workspace_id FK · endpoint_id FK ·
                      event_type · payload jsonb · status pending|delivered|exhausted ·
                      attempt_count · next_attempt_at? · delivered_at? · created_at
api_webhook_attempts  id uuid PK · message_id FK · attempt_n · response_status? ·
                      error? · elapsed_ms · created_at
```

Reglas: TODA query de recurso filtra por `workspace_id` de la llave autenticada (BOLA);
`summary` guarda centavos como **string** (jsonb no preserva bigint); el detalle completo
se recomputa con `preprocessTrialBalance(raw_rows)` al hacer GET del recurso.

---

## 6. Contrato transversal

- **Auth:** `Authorization: Bearer utop_live_<token>`. Sin llave → 401 problem
  `missing_api_key`; llave desconocida/revocada/expirada → 401 `invalid_api_key`
  (mismo mensaje — no revelar cuál); scope insuficiente → 403 `insufficient_scope`.
- **Errores (RFC 9457):**

```json
{
  "type": "https://utopia.example/docs/api/problems/validation-failed",
  "title": "La remisión no es válida",
  "status": 400,
  "detail": "El cuerpo no cumple el contrato del recurso.",
  "instance": "/api/v1/trial-balances",
  "code": "validation_failed",
  "request_id": "req_0698fq7yv7f7btkdjq8x2xz3ec",
  "errors": [{ "detail": "Se esperaba string, llegó number", "pointer": "/csv" }]
}
```

- **Rate limit:** por llave y clase de operación (read `rpm_read`, write `rpm_write`,
  defaults 120/20 por minuto). 429 + `Retry-After` (segundos) + `RateLimit`/`RateLimit-Policy`
  draft-11. El WAF de Vercel (por IP) queda como capa exterior con IDs `api_v1_read`/`api_v1_write`.
- **Paginación:** `?limit=&cursor=`; respuesta `{"data": [...], "has_more": true, "next_cursor": "..."}`;
  cursor = base64url(`created_at|id|hmac`) — opaco y a prueba de manipulación (firma con `DB_HMAC_KEY`).
- **Fechas:** RFC 3339 UTC `Z` (`"2026-08-19T15:04:05Z"`).
- **Cuerpos:** máximo 2 MB (413 `payload_too_large`) — presupuesto OWASP API4.
- **Concurrencia:** GET de webhook-endpoint devuelve `ETag` fuerte; PATCH exige `If-Match`
  (sin header → 428 `precondition_required`; mismatch → 412 `precondition_failed`).

## 7. Recurso `trial-balances` (contrato resumido)

`POST /api/v1/trial-balances` — body **uno de**:

```json
{ "period_label": "2025", "csv": "codigo;nombre;saldo\n1105;Caja;1500000\n…" }
{ "period_label": "2025", "rows": [ { "code": "1105", "name": "Caja", "level": "Cuenta", "transactional": true, "balances_by_period": { "2025": 1500000 } } ] }
```

Respuesta `201 Created` + `Location` (y webhook `trial_balance.processed` al workspace):

```json
{
  "id": "tb_0698fq7yv7f7btkdjq8x2xz3ec",
  "object": "trial_balance",
  "status": "unbalanced",
  "period_label": "2025",
  "row_count": 184,
  "control_totals": {
    "activo":     { "amount": "123456789012", "currency": "COP" },
    "pasivo":     { "amount": "45678901234",  "currency": "COP" },
    "patrimonio": { "amount": "77777887778",  "currency": "COP" },
    "equation_delta": { "amount": "0", "currency": "COP" }
  },
  "findings": { "discrepancies": 3, "curator": 2 },
  "preprocessor_version": "…",
  "created_at": "2026-08-19T15:04:05Z"
}
```

`GET /api/v1/trial-balances/{id}` añade `discrepancies[]` y `curator_findings[]` completos
(recomputados). El CSV acepta los mismos alias de columnas del parser interno
(codigo/cuenta/débito/crédito/saldo por año). 422 `empty_trial_balance` si no se reconoce
ninguna fila válida.

---

## 8. Emisión y gestión de llaves

Diseño validado contra NIST SP 800-63B-4 (final 2025-07-31), el formato de tokens de GitHub
(blog de ingeniería 2021-04-05) y las prácticas vigentes de Stripe:

- **Formato del token:** `utop_sk_live_` | `utop_sk_test_` + **26 chars base62 CSPRNG
  (≈154 bits)** + **6 chars de checksum CRC32 en base62** (diseño GitHub: validación
  offline que descarta basura sin tocar la DB y elimina falsos positivos de secret
  scanning). El `_` no es carácter base64 ⇒ doble-clic selecciona el token completo.
  Prefijo `utop_` único y registrable en el GitHub secret scanning partner program
  (mientras tanto: custom pattern + push protection en la org — el repo es público).
- **En reposo:** `key_hash = hex(HMAC-SHA256(pepper, token_completo))` con
  `UTOPIA_API_KEY_PEPPER` (32 bytes, env — nunca en DB ni repo) y columna
  `pepper_version` para rotar el pepper sin re-emitir llaves de golpe. Racional
  verificado: NIST permite hash rápido para secretos ≥112 bits y recomienda (SHOULD)
  la iteración con sal secreta del verificador; argon2/bcrypt son para secretos de baja
  entropía y solo añadirían latencia por request. Sin pepper configurado ⇒ el API
  responde 503 fail-closed (mismo patrón que `checkAdminToken`).
- **Validación por request:** parsear prefijo → verificar checksum offline → HMAC →
  lookup por índice único → `revoked_at`/`expires_at`/scope. Fallo = 401 opaco único.
- Se muestra **una sola vez** en la respuesta de creación (`POST /api/admin/api-keys`,
  gate `checkAdminToken` existente) y en `scripts/create-api-key.ts`.
- **Rotación con gracia:** `POST /api/admin/api-keys/{id}/rotate` crea llave nueva con
  los mismos scopes, enlaza `rotated_from_key_id` y fija `expires_at = now()+7 días` en
  la vieja (patrón Stripe: ambas conviven mientras el cliente migra).
- `last_used_at` se actualiza como máximo 1 vez/minuto por llave (evita write-amplification).
- Revocación = `revoked_at` + `revoked_reason` (soft) — la fila queda para auditoría.

## 9. Webhooks (Standard Webhooks v1.0.0)

- Secreto por endpoint: `whsec_` + base64(32 bytes CSPRNG), cifrado en reposo con el vault
  AES-256-GCM existente (`encryptSecret`). Se muestra completo solo al crear el endpoint.
- Headers de cada entrega: `webhook-id` (`msg_…`, estable entre reintentos),
  `webhook-timestamp` (unix segundos), `webhook-signature: v1,<base64 hmac>`.
- Firma: `base64(HMAC_SHA256(base64decode(secret sin whsec_), "{msg_id}.{timestamp}.{body}"))`
  sobre los **bytes exactos** del body.
- Envelope: `{"type": "trial_balance.processed", "timestamp": "<RFC3339>", "data": {…}}`.
- Eventos v1: `ping`, `trial_balance.processed`.
- Entrega: Workflow DevKit; schedule Svix — inmediato, 5 s, 5 min, 30 min, 2 h, 5 h, 10 h,
  10 h (8 intentos, ~28 h); éxito = solo 2xx (3xx cuenta como fallo); timeout 10 s por
  intento; cada reintento re-firma con timestamp nuevo. Al agotar: mensaje `exhausted`.
  Endpoint con fallo continuo ≥5 días ⇒ `disabled` (se resetea `first_failing_at` con
  cualquier 2xx). URLs: solo `https://` y host público (anti-SSRF: se rechazan IPs
  privadas/loopback/link-local al registrar y al entregar).

## 10. Seguridad (mapa OWASP API Security Top 10 2023)

| Amenaza | Mitigación en este diseño |
|---|---|
| API1 BOLA | `workspace_id` sale SIEMPRE de la llave; IDs UUIDv7 no enumerables; 404 uniforme para recurso ajeno |
| API2 Broken Auth | Bearer + hash SHA-256 + revocación/expiración; timing-safe por diseño; sin fallback anónimo |
| API3 Object property level | Serializadores allowlist (patrón `toPublicWorkspace` del repo): jamás se devuelve la fila cruda |
| API4 Resource consumption | Body cap 2 MB; `limit` ≤ 100; cuotas por llave + WAF por IP; timeout 10 s en fetches salientes |
| API5 Function-level auth | Scopes por operación; admin separado bajo `x-admin-token` |
| API6 Sensitive business flows | v1 solo expone validación determinista; pipelines LLM ($) quedan fuera |
| API7 SSRF | URLs de webhook validadas (https, no IP privada/loopback) en registro Y en entrega |
| API8 Misconfig | proxy.ts: CSRF fail-closed intacto para el resto; `/api/v1` con allowlist explícita y auth propia; headers de seguridad heredados |
| API9 Inventory | OpenAPI + `/.well-known/api-catalog` + spec versionada en repo |
| API10 Unsafe consumption | Respuestas de endpoints de webhook tratadas como opacas (solo status code) |

### Datos personales — Ley 1581 de 2012 (verificado contra el texto oficial y conceptos SIC)

La contabilidad remitida **contiene datos de personas naturales** (nombres en cuentas de
nómina, CxC/CxP de personas naturales, representantes) ⇒ la ley aplica de lleno: el cliente
es **Responsable** del tratamiento y UtopIA actúa como **Encargado** (Art. 3). Obligaciones
materializadas en el diseño:

1. **Cero PII en logs** (Art. 4 g/h): se loggea `key_id`, workspace, ruta, status, latencia,
   `row_count` — jamás el payload contable ni nombres de cuentas.
2. **Cifrado en reposo con capa de aplicación:** `raw_rows_encrypted` usa el vault
   AES-256-GCM existente además del cifrado de plataforma de Neon.
3. **Minimización:** el contrato Zod rechaza campos no procesados (`strict`).
4. **Encargo de tratamiento:** los términos del API deben incluir la cláusula de encargo
   (pendiente legal — insumo para Johan).
5. **Runbook de incidente:** ante violación de seguridad, reporte a la SIC dentro de
   **15 días hábiles** desde la detección (Arts. 17-18, Decreto 1377/2013, Circular Única;
   concepto SIC 2021-04-20) — añadir al runbook operativo.
6. **Retención y borrado:** `DELETE /v1/trial-balances/{id}` disponible para el Responsable
   (borrado físico de `raw_rows_encrypted`); política de retención por definir con Johan.

Nota: el proyecto de reforma de la 1581 (radicado 2025-08-27, PL 214/274) **no consta
aprobado** a 2026-08 — el marco vigente sigue siendo Ley 1581/2012 + Decreto 1377/2013.

## 11. Testing

- Unit (vitest, `src/lib/api/__tests__/`): ids (roundtrip encode/decode, orden v7),
  problems (shape 9457, mapping Zod→pointers), keys (formato, hash, una-sola-vez),
  firma de webhook (vector conocido + verificación con la librería `standardwebhooks` como
  referencia cruzada de la spec), cursores (firma/manipulación), idempotencia (replay/
  mismatch/concurrencia — con doble de DB), rate-limit headers (sintaxis SF).
- Contrato: test que recorre `src/app/api/v1/**/route.ts` y exige entrada correspondiente
  en el documento OpenAPI (anti-drift, lección "duplicación sin sincronizar").
- Verificación repo: `npx tsc --noEmit`, `npm run lint` completo, `npm run lint:strict-mode`
  (los schemas del API no viajan al LLM — fuera del alcance del guard), `npm run build`,
  `npx vitest run`.

## 12. Rollout

1. Migración: `npm run db:generate` (tablas nuevas, aditivas). **Aplicar con
   `npm run db:migrate` — NO se ejecuta en esta sesión** (gate del repo: migraciones las
   aplica Johan; ver memoria db:push/drift).
2. `.env.example`: **una variable nueva obligatoria para activar el API**:
   `UTOPIA_API_KEY_PEPPER` (32 bytes base64; sin ella `/api/v1` responde 503 fail-closed).
   El resto reusa `DATABASE_URL`, `UTOPIA_VAULT_KEY`, `DB_HMAC_KEY`, `UTOPIA_ADMIN_TOKEN`.
   En la org de GitHub: configurar custom pattern + push protection para `utop_sk_`
   (el repo es público).
3. Vercel WAF: crear reglas `api_v1_read` / `api_v1_write` en el dashboard (IDs ya emitidos
   por proxy.ts).
4. Emitir primera llave de prueba: `npx tsx scripts/create-api-key.ts --workspace <uuid> --name "ERP Piloto" --test`.
5. Smoke: `POST /v1/trial-balances` con fixture del repo → 201; `GET` → recompute idéntico;
   `ping` de webhook contra endpoint de prueba.

## 13. Roadmap

- **v1.1:** jobs asíncronos (`202 + /v1/jobs/{id}`) para disparar el pipeline NIIF completo;
  evento `report.ready`.
- **v1.2:** OAuth 2.0 `client_credentials` conforme a RFC 9700 (BCP 240, ene-2025 — OAuth
  2.1 sigue en draft -15 y no hay que esperarlo) con IdP gestionado; registro del prefijo
  `utop_` en el GitHub secret scanning partner program (revocar + notificar en el callback).
- **v2:** perfil **FAPI 2.0** (Final 2025-02-22: private_key_jwt + PAR + tokens
  sender-constrained) si el API pasa a mover dinero u órdenes — en Vercel el camino es
  **DPoP (RFC 9449)**, no mTLS entrante (inviable detrás del proxy de la plataforma);
  SDK TypeScript generado (Speakeasy); versionado por fecha estilo Stripe encima de `/v1`.

## 14. Fuentes de la investigación (verificadas 2026-08-19)

OpenAPI 3.2/3.1.2: spec.openapis.org · openapis.org blog 2025-09-23. RFC 9457, 9745, 8594,
9727, 9110/9111, 6585, 8288, 9562: rfc-editor.org. RateLimit draft-11 e Idempotency-Key
(expirado): datatracker.ietf.org (WG httpapi). Stripe: docs.stripe.com (versioning,
idempotent_requests, webhooks, currencies, pagination). GitHub: docs.github.com (api-versions,
webhooks timeout/redelivery). Svix: docs.svix.com/retries. Standard Webhooks v1.0.0:
github.com/standard-webhooks (spec) + adopción OpenAI/Anthropic verificada. Guías: Microsoft
api-guidelines (push 2026-08-05), Google AIP-140/158/185, Zalando RESTful API Guidelines
(push 2026-07-08, regla 176→RFC 9457). Mercado SDKs: TechCrunch 2026-05-18 (Stainless→
Anthropic), Postman blog 2026-01 (Fern). OWASP API Security Top 10 2023 (edición vigente,
sin sucesora anunciada): owasp.org/API-Security. NIST SP 800-63B-4 (final 2025-07-31):
csrc.nist.gov. RFC 9700 (BCP 240): rfc-editor.org. OAuth 2.1: draft-ietf-oauth-v2-1-15
(2026-03-02, aún draft). FAPI 2.0 Security Profile (Final 2025-02-22) + Message Signing
(Final 2025-09-26): openid.net. Formato de tokens GitHub (checksum CRC32 base62, prefijos,
178 bits): github.blog 2021-04-05. Stripe keys best practices (rotación 7 días, restricted
keys, una-sola-vez): docs.stripe.com/keys-best-practices. TLS: RFC 8996 (BCP 195) + NIST
SP 800-52r2 (Rev. 3 en comentarios hasta 2026-07-10). Ley 1581/2012 (texto oficial
alcaldiabogota.gov.co), Decreto 1377/2013, concepto SIC 2021-04-20 (15 días hábiles),
reforma PL 214/274 de 2025 radicada 2025-08-27 (no aprobada a 2026-08).
