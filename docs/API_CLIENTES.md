# API de Clientes (`/api/v1`) — guía operativa

Cómo funciona, cómo se opera y cómo se evoluciona el API B2B con el que los sistemas de los
clientes (ERPs, software contable, integradores) se conectan a UtopIA. La **spec de diseño**
con cada decisión, su racional y sus fuentes es
[docs/spec/api-clientes-v1.md](spec/api-clientes-v1.md) — cuando este documento y la spec
difieran, gana la spec. Contexto histórico de la entrega:
[docs/wave-notes/api-clientes-v1.md](wave-notes/api-clientes-v1.md).

---

## Qué es (y qué no es)

- **Es** una superficie server-to-server autenticada por llaves, con la que un cliente remite
  su balance de prueba PUC y recibe la **validación NIIF determinista** de la plataforma
  (anclas en centavos, ecuación contable, curator R1–R4) + webhooks firmados + contrato
  OpenAPI. Cero LLM en el camino: no hay superficie de alucinación.
- **No** escribe en `journal_lines` ni en el núcleo contable interno: las remisiones son
  documentos externos del ERP del cliente (la fuente de verdad contable interna no se toca).
- **No** dispara los pipelines LLM (reporte NIIF completo, dictámenes). Ese es el roadmap
  v1.1 con el patrón `202 Accepted + /v1/jobs/{id}` ya reservado en el contrato.

## Mapa de piezas

| Pieza | Dónde vive | Qué hace |
|---|---|---|
| Toolkit del API | `src/lib/api/` | Módulos testeables: `encoding` (base62/crockford/CRC32), `ids` (TypeID+UUIDv7), `problems` (RFC 9457), `keys` (formato+HMAC), `auth`, `handler` (`withApiV1`), `rate-limit`, `pagination` (cursores firmados), `idempotency`, `schemas` (contrato Zod), `openapi`, `trial-balances`, `webhooks` (firma/anti-SSRF), `webhook-endpoints`, `webhook-emitter`, `key-service` |
| Rutas públicas | `src/app/api/v1/` | `me`, `trial-balances` (+`[id]`), `webhook-endpoints` (+`[id]`, `+ping`), `openapi.json`, `docs` |
| Descubrimiento | `src/app/.well-known/api-catalog/` | Linkset RFC 9727 → contrato + docs |
| Admin de llaves | `src/app/api/admin/api-keys/` (+`[id]/rotate`) | Emitir / listar / revocar / rotar (gate `x-admin-token`) |
| CLI de llaves | `scripts/create-api-key.ts` | `npm run api:create-key` |
| Entrega de webhooks | `src/lib/workflows/webhook-delivery/` | Workflow durable (`'use workflow'` + steps), schedule Svix |
| Tablas | `src/lib/db/schema-api.ts` (migración `0021_smart_black_knight`) | `api_keys`, `api_idempotency_keys`, `api_trial_balances`, `api_webhook_endpoints`, `api_webhook_messages`, `api_webhook_attempts` |
| Integración plataforma | `src/proxy.ts` | `/api/v1/` en `CSRF_ALLOWLIST` + `AUTH_EXEMPT_APIS` + `RATE_LIMITS`; propaga `x-request-id` único |

## Autenticación y ciclo de vida de las llaves

**Formato del token** (se muestra **una sola vez** al emitirlo):

```
utop_sk_live_3fK9vQx2mW8pLrT5cD1nZbY7aG4Hq0Rs
└────┬─────┘ └──────────┬───────────┘└─┬──┘
  prefijo      26 chars base62 CSPRNG   checksum CRC32
 (live|test)        (~154 bits)         (base62, 6)
```

- El checksum permite descartar tokens corruptos/inventados **sin tocar la DB** y habilita
  secret scanning sin falsos positivos (diseño GitHub).
- En reposo solo existe `hex(HMAC-SHA256(pepper, token))` con `UTOPIA_API_KEY_PEPPER`
  (32 bytes base64, **solo en env** — el repo es público). Sin pepper configurado, todo
  `/api/v1` responde `503 api_disabled` (fail-closed, mismo patrón que `checkAdminToken`).
- Scopes deny-by-default: `trial_balances:read`, `trial_balances:write`, `webhooks:manage`.
- Cuotas por llave: `rpm_read` (default 120/min) y `rpm_write` (default 20/min), ajustables
  por fila en `api_keys`. El WAF de Vercel por IP es la capa exterior (`/api/v1`: 120/min).
- Expiración default: 365 días (`--no-expiry` para emitir sin vencimiento, decisión explícita).

**Operaciones** (todas con header `x-admin-token: $UTOPIA_ADMIN_TOKEN`):

```bash
# Emitir (CLI — recomendado)
npm run api:create-key -- --workspace <uuid> --name "ERP Producción"
npm run api:create-key -- --workspace-name "Empresa SAS" --nit 900123456 --name "Piloto" --test

# Emitir / listar / revocar (HTTP)
curl -X POST $BASE/api/admin/api-keys -H "x-admin-token: $TOKEN" \
  -H "content-type: application/json" \
  -d '{"workspace_id":"<uuid>","name":"ERP Producción","scopes":["trial_balances:write","trial_balances:read"]}'
curl $BASE/api/admin/api-keys -H "x-admin-token: $TOKEN"
curl -X DELETE "$BASE/api/admin/api-keys?id=key_…&reason=cliente_termino" -H "x-admin-token: $TOKEN"

# Rotar con gracia (la vieja convive 7 días — patrón Stripe)
curl -X POST $BASE/api/admin/api-keys/key_…/rotate -H "x-admin-token: $TOKEN"
```

## Contrato transversal

Pipeline de TODO request (orden fijo en `withApiV1`): pepper → `Authorization: Bearer` →
checksum offline → HMAC + lookup → scopes → cuota por llave → tamaño de body (2 MB) →
JSON → `Idempotency-Key` → handler → headers estándar. Cualquier throw sale como
`500 internal_error` sin filtrar internals.

**Headers en toda respuesta:** `X-Request-Id` (correlación — el proxy genera UNO y el
handler lo echa en el body de error), `Utopia-Api-Version: 2026-08-19`,
`Cache-Control: no-store`, `RateLimit` / `RateLimit-Policy` (draft-11, documentados como
draft; el contrato firme es `429 + Retry-After`).

**Errores — RFC 9457 (`application/problem+json`).** Los clientes matchean por `code`
(estable); `detail` va en español. Catálogo:

| `code` | HTTP | Cuándo |
|---|---|---|
| `missing_api_key` / `invalid_api_key` | 401 | Sin Bearer / llave mala, revocada o vencida (401 **uniforme** a propósito — no revelar cuál) |
| `api_disabled` | 503 | `UTOPIA_API_KEY_PEPPER` sin configurar |
| `insufficient_scope` | 403 | La llave no tiene el scope de la operación |
| `rate_limited` | 429 | Cuota agotada (trae `Retry-After`) |
| `malformed_json` / `validation_failed` | 400 | JSON roto / contrato Zod violado (`errors[]` con JSON Pointers) |
| `empty_trial_balance` | 422 | La remisión no contiene filas PUC reconocibles |
| `idempotency_key_in_use` / `idempotency_payload_mismatch` | 409 / 422 | Concurrencia / mismo key con otro body |
| `not_found` | 404 | Recurso inexistente o de otro workspace (**uniforme** — anti-BOLA) |
| `payload_too_large` | 413 | Body > 2 MB |
| `precondition_required` / `precondition_failed` | 428 / 412 | PATCH sin `If-Match` / ETag desactualizado |

**Convenciones de datos:** JSON `snake_case`; paths kebab-case; fechas RFC 3339 UTC `Z`;
dinero `{"amount": "<string entero en centavos>", "currency": "COP"}` (MoneyCop tal cual);
IDs públicos TypeID (`tb_…`, `whe_…`, `msg_…`, `key_…` — prefijo + UUIDv7 en base32, el PK
uuid decodificado; nunca hay columna duplicada). Paginación: `?limit=` (1–100, default 20) +
`?cursor=` opaco **firmado** (HMAC con `DB_HMAC_KEY`); respuesta
`{data, has_more, next_cursor}` + header `Link rel="next"`.

**Idempotencia (`Idempotency-Key`, POST de trial-balances):** replay dentro de 24 h devuelve
la MISMA respuesta + `Idempotent-Replayed: true`; mismo key con body distinto → 422;
concurrente → 409; los 5xx no se cachean (el retry re-ejecuta).

## Recurso `trial-balances`

```bash
curl -X POST $BASE/api/v1/trial-balances \
  -H "Authorization: Bearer utop_sk_test_…" -H "content-type: application/json" \
  -H "Idempotency-Key: remision-2025-08" \
  -d '{"csv": "codigo;nombre;transaccional;saldo 2025\n110505;Caja;si;1000000\n210505;Bancos;si;400000\n310505;Capital;si;600000"}'
```

- Acepta `csv` (mismos alias de columnas que la plataforma: codigo/cuenta, saldo/débito/
  crédito, años en headers, normalización de convención de signos automática) **o** `rows[]`
  estructuradas. `period_label` opcional cuando el archivo no trae año.
- Responde `201` con `status: balanced|unbalanced`, `control_totals` en centavos-string
  (activo, pasivo, patrimonio, ingresos_netos, `equation_delta`) y conteo de findings.
  **Un balance descuadrado NO es error**: el propósito del recurso es reportarlo.
- `GET /v1/trial-balances/{id}` **recomputa** desde las filas crudas con el preprocesador
  vigente (filosofía anti-desync del repo: no se persiste el `PreprocessedBalance`) y añade
  `discrepancies[]` + `curator_findings[]`. `preprocessor_version` viaja en cada respuesta.
- Las filas crudas se guardan **cifradas** con el vault AES-256-GCM (Ley 1581 — la
  contabilidad puede contener nombres de personas naturales). El `summary` persistido no
  lleva PII.
- `DELETE /v1/trial-balances/{id}` = borrado físico (derecho de supresión).
- Emite el webhook `trial_balance.processed` al crearse.

## Webhooks (Standard Webhooks v1.0.0)

Registro: `POST /v1/webhook-endpoints` con `{url, events[]}` — URL solo `https` puerto 443,
sin credenciales, sin IPs privadas/loopback/`.local` (anti-SSRF, validada al registrar **y**
antes de cada entrega). La respuesta trae el secreto `whsec_…` **una sola vez** (en DB va
cifrado con el vault). `PATCH` exige `If-Match` con el `ETag` del GET.

Cada entrega llega con headers `webhook-id` (estable entre reintentos → clave de
deduplicación), `webhook-timestamp` (unix segundos) y `webhook-signature` (`v1,<base64>` =
HMAC-SHA256 del `"{id}.{timestamp}.{body}"` con el secreto decodificado). Verificación del
lado del cliente con la librería estándar:

```ts
import { Webhook } from 'standardwebhooks'; // npm i standardwebhooks

const wh = new Webhook(process.env.UTOPIA_WHSEC!); // 'whsec_…'

export async function POST(req: Request) {
  const payload = await req.text(); // bytes crudos — NUNCA re-serializar
  wh.verify(payload, {
    'webhook-id': req.headers.get('webhook-id')!,
    'webhook-timestamp': req.headers.get('webhook-timestamp')!, // tolerancia 5 min
    'webhook-signature': req.headers.get('webhook-signature')!,
  }); // lanza si la firma no cuadra
  // Responder 2xx RÁPIDO y procesar después (timeout de entrega: 10 s)
  return new Response(null, { status: 204 });
}
```

**Entrega** (Workflow DevKit — durable, sobrevive deploys): 8 intentos con backoff Svix
(inmediato, 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h ≈ 28 h); éxito = **solo 2xx** (3xx
cuenta como fallo); cada reintento se re-firma con timestamp fresco; bitácora por intento en
`api_webhook_attempts`. Un endpoint con fallo continuo ≥ 5 días pasa a `disabled`
(cualquier 2xx resetea el reloj; rehabilitarlo = `PATCH {status: "enabled"}`).
`POST /v1/webhook-endpoints/{id}/ping` envía un evento de prueba por el pipeline real.

Eventos v1: `ping`, `trial_balance.processed`. Envelope: `{type, timestamp RFC3339, data}`.

## Activación (runbook)

1. **Pepper** — generar y configurar en Vercel (+ `vercel env pull`):
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` →
   `UTOPIA_API_KEY_PEPPER`. Sin él, `/api/v1` responde 503.
2. **Migración** — `npm run db:migrate` aplica `0021_smart_black_knight.sql`
   (6 tablas `api_*`, 100 % aditiva — cero riesgo de drift). Nota: NO confundir con
   `0020_workspaces_user_id_uq.sql`, que va a mano y fuera del journal a propósito
   (ver INSUMOS §C3) — por eso esta se numeró 0021.
3. **Primera llave** — `npm run api:create-key -- --workspace-name "ERP Piloto" --name "Piloto" --test`.
4. **Smoke** — el `curl` de trial-balances de arriba → `201` con `equation_delta = "0"`;
   registrar un webhook de prueba y `POST …/ping` → verificar firma en el receptor.
5. **WAF** — crear las reglas con id `api_v1` en el dashboard de Vercel (el proxy ya emite
   ese `rateLimitId`; sin regla, aplica el backstop en memoria + cuota por llave).
6. **GitHub** — custom pattern + push protection para `utop_sk_` en la org (repo público);
   más adelante, registro en el secret scanning partner program (revocar + notificar).

## Troubleshooting

| Síntoma | Causa probable | Acción |
|---|---|---|
| Todo responde `503 api_disabled` | Falta `UTOPIA_API_KEY_PEPPER` en el entorno | Configurarlo y redeploy; es fail-closed por diseño |
| `401 invalid_api_key` con llave recién emitida | Pepper distinto entre quien emitió y quien valida (local vs Vercel) | El HMAC depende del pepper: emitir y validar contra el MISMO entorno |
| `500` en POST trial-balances con env OK | Migración `0020` sin aplicar | `npm run db:migrate` |
| Webhooks no llegan | Endpoint `disabled` (5 días de fallo) o URL rechazada anti-SSRF | `GET /v1/webhook-endpoints/{id}` → status; rehabilitar con PATCH; revisar `api_webhook_attempts` |
| Cliente reporta error | Pedirle el `X-Request-Id` | Buscarlo en los logs de Vercel — el proxy y el body de error comparten el mismo id |
| `git pull` en el checkout de main tras el merge | — | `git pull --ff-only` (el merge fue fast-forward) |

## Seguridad y datos personales

Mapa completo OWASP API Top 10 (2023) → mitigación en la spec §10. Los pilares: BOLA
resuelto por construcción (`workspace_id` sale SIEMPRE de la llave, jamás del request; 404
uniforme), serializadores allowlist (nunca `SELECT * → JSON`), anti-SSRF en URLs de webhook,
cero PII en logs (solo key_id, workspace, ruta, status, latencia, row_count).

**Ley 1581/2012:** el cliente es **Responsable** del tratamiento y UtopIA **Encargado**.
Obligaciones cableadas: cifrado app-level de las remisiones, minimización (Zod `strict`
rechaza campos no procesados), borrado a solicitud (`DELETE`). Ante un incidente de
seguridad: reporte a la SIC dentro de **15 días hábiles** desde la detección (Arts. 17-18 +
Decreto 1377/2013 + Circular Única). Pendientes de negocio (Johan): cláusula de encargo de
tratamiento en los términos del API y política de retención.

## Evolución del contrato

- Dentro de `/v1` los cambios son **solo aditivos** (campos nuevos opcionales, endpoints
  nuevos). Todo cambio de shape público se refleja en `src/lib/api/schemas.ts` /
  `openapi.ts` — el test `openapi.test.ts` exige que cada `route.ts` tenga su path declarado
  (anti-drift).
- Para retirar algo: header `Deprecation: @<unix>` (RFC 9745) + `Sunset: <HTTP-date>`
  (RFC 8594) + `Link rel="deprecation"`, con ventana ≥ 12 meses (referente GitHub: ≥ 24).
- Subir `PREPROCESSOR_CONTRACT_VERSION` cuando el preprocesador cambie de forma observable.
- Roadmap: **v1.1** jobs asíncronos (`202 + /v1/jobs/{id}`) para el pipeline NIIF + evento
  `report.ready`; **v1.2** OAuth 2.0 `client_credentials` (RFC 9700); **v2** FAPI 2.0 con
  DPoP si el API llega a mover dinero; SDK TypeScript (Speakeasy).

## Verificación de la entrega (2026-08-19)

Suite completa 2.319 tests ✓ (102 del API) · `npm run build` ✓ · `tsc --noEmit` 0 errores ·
`npm run lint` completo 0 errores · `lint:strict-mode` ✓ (los schemas de `src/lib/api/` no
viajan al LLM — el guard no aplica; su aviso sobre `openapi.ts "schemaRef"` es ruido
conocido, no error).
