# Smoke Test Guide — 1+1 Élite

**Archivo principal**: `scripts/smoke-test-1plus1.ts`
**Comando**: `npm run smoke`

---

## Qué hace

Valida los 6 workstreams de la Ola "1+1 Élite" end-to-end contra el dev server
y Neon Postgres, siguiendo el flujo real de HTTP (cookies, JSON bodies, CSV
multipart). Cada sección solo corre si su feature flag está activo en `.env.local`.
Con todos los flags OFF termina en <2 s con exit 0.

El runner incluye un **bootstrap idempotente** (`scripts/smoke-fixtures.ts`)
que siembra automáticamente todos los fixtures necesarios (PUC, reglas
tributarias, provisiones, período contable, pyme entries). No se requiere
exportar ninguna variable de entorno adicional más allá de `DATABASE_URL`.

---

## Precondiciones

| Requisito | Cómo verificar |
|---|---|
| Dev server corriendo | `npm run dev` en otra terminal |
| `.env.local` presente | `cat .env.local \| grep DATABASE_URL` |
| Migraciones aplicadas | `npm run db:push` |

### Variables de entorno requeridas

```bash
# Obligatorias para cualquier run
DATABASE_URL=postgresql://...   # endpoint POOLED de Neon
OPENAI_API_KEY=sk-...

# Feature flags (OFF por defecto — encender según lo que quieras probar)
UTOPIA_ENABLE_TAX_ENGINE=true
UTOPIA_ENABLE_OCR_PROMOTE=true
UTOPIA_ENABLE_BANK_RECON=true
UTOPIA_ENABLE_AUTO_ADJUSTMENTS=true
UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW=true
UTOPIA_ENABLE_NOTIFICATIONS=true
```

### Variables opcionales del runner

```bash
# URL base del dev server (default: http://localhost:3000)
SMOKE_BASE_URL=http://localhost:3000

# Timeout por request HTTP en ms (default: 30000)
SMOKE_TIMEOUT_MS=30000

# Timeout del poll de cierre mensual en ms (default: 60000)
SMOKE_CLOSE_POLL_TIMEOUT_MS=60000

# Workspace a reutilizar (default: crea uno nuevo con cada run)
SMOKE_WORKSPACE_ID=<uuid>

# Para WS6 — secreto interno que autentica /api/notifications/dispatch
UTOPIA_INTERNAL_SECRET=<secreto>

# Para WS6 — si RESEND no está configurado, el dispatch termina como WARN (esperado en dev)
RESEND_API_KEY=re_...

# Desactivar colores ANSI
NO_COLOR=1
```

> **Eliminado**: `SMOKE_CHART_ACCOUNT_ID`, `SMOKE_FA_ASSET_ACCOUNT_ID`,
> `SMOKE_FA_DEP_ACCOUNT_ID`, `SMOKE_FA_EXP_ACCOUNT_ID`, `SMOKE_PYME_ENTRY_IDS`.
> El bootstrap auto-resolve todos estos valores desde la DB.

---

## Cómo correrlo

```bash
# Run completo con flags activos en .env.local
npm run smoke

# Sin colores (para CI / logs)
NO_COLOR=1 npm run smoke

# Con base URL diferente (e.g. ngrok tunnel)
SMOKE_BASE_URL=https://abc.ngrok.io npm run smoke

# Solo verificar que el servidor está up (todos los flags OFF)
npm run smoke   # termina en <2s si ningún flag está activo
```

---

## Auto-bootstrap idempotente

Justo después de `db-reachable`, el runner llama a `bootstrapSmokeFixtures(workspaceId)`:

1. **PUC seed** — siembra ~80 cuentas del Plan Único de Cuentas PYMES (Decreto 2706/2012) si no existen.
2. **Tax rules** — siembra 6 reglas tributarias built-in + UVT 2025/2026 (idempotente ON CONFLICT DO UPDATE).
3. **Provisions** — siembra 9 provisiones laborales/fiscales Colombia 2026 (idempotente ON CONFLICT DO NOTHING).
4. **Accounting period** — crea el período del mes actual con `status='open'` (ON CONFLICT DO NOTHING).
5. **UUID resolve** — busca las cuentas PUC por código (111005, 152805, 159215, 516015) y devuelve sus UUIDs.
6. **Pyme fixtures** — crea un libro `Smoke Test Book` y 3 `pyme_entries` con `status='confirmed'`.

Re-correr `npm run smoke` dos veces consecutivas es seguro: todas las inserciones
son idempotentes y no duplican filas.

---

## Salida esperada (17 ✓ 0 ⚠ 0 ✗)

```
╔════════════════════════════════════════════════════════════════════╗
║  1+1 Élite — Smoke Test Runner                                     ║
║  Base: http://localhost:3001                                        ║
║  Workspace: 0a8b2c1f-xxxx (creado automáticamente)                 ║
╚════════════════════════════════════════════════════════════════════╝

▸ Fundaciones
  ✓ health                                              [   12 ms]
  ✓ db-reachable                                        [   34 ms]

▸ Smoke Bootstrap
  ✓ smoke-bootstrap                                     [  420 ms]
    └ periodId=3f7a…, pymeEntries=3, bank=a1b2c3d4…, fa=e5f6g7h8…

▸ WS1 — Smart-Tax Engine                  [flag ON]
  ✓ tax-seed                                            [  120 ms]
  ✓ tax-preview-purchase-1m                             [   89 ms]
    └ 2 líneas, IVA=190000, base=1000000

▸ WS2 — OCR → Journal Bridge              [flag ON]
  ✓ pyme-create-entry                                   [    1 ms]
  ✓ pyme-promote                                        [  210 ms]

...
═════════════════════════════════════════════════════════════════════
  Total: 17 ✓   0 ⚠   0 ✗      Duración: 8.3 s
  Resultado: PASSED
═════════════════════════════════════════════════════════════════════
```

### Exit codes

| Código | Significado |
|---|---|
| `0` | PASSED o PASSED-con-warnings |
| `1` | Al menos un paso ✗ |

---

## Secciones y steps

### Sección 0 — Fundaciones (siempre corre)

| Step | Qué valida |
|---|---|
| `health` | GET /api/workspace responde 200 y captura cookie `utopia_workspace_id` |
| `db-reachable` | La DB Neon es alcanzable (el workspace GET requiere DB) |

Si `health` falla, el runner aborta con mensaje claro: "El runner requiere `npm run dev` corriendo".

### Bootstrap (siempre corre después de fundaciones)

| Step | Qué hace |
|---|---|
| `smoke-bootstrap` | Siembra PUC, tax rules, provisions, período y pyme entries. Resultado: ✓ (sin advertencias) o ⚠ (con advertencias no bloqueantes) |

### Sección 1 — WS1 Smart-Tax Engine (`UTOPIA_ENABLE_TAX_ENGINE`)

| Step | Qué valida |
|---|---|
| `tax-seed` | POST /api/accounting/tax-engine/seed — siembra reglas built-in |
| `tax-preview-purchase-1m` | POST /api/accounting/tax-engine/preview con $1.000.000 → verifica IVA=190.000 ±1 COP |

### Sección 2 — WS2 OCR Bridge (`UTOPIA_ENABLE_OCR_PROMOTE`)

| Step | Qué valida |
|---|---|
| `pyme-create-entry` | Verifica que el bootstrap creó ≥1 pyme_entry confirmed |
| `pyme-promote` | POST /api/pyme/promote con pymeEntryIds del bootstrap → journalEntryIds.length ≥ 1 |

### Sección 3 — WS3 Bank Reconciliation (`UTOPIA_ENABLE_BANK_RECON`)

| Step | Qué valida |
|---|---|
| `bank-acc-create` | POST /api/accounting/banking/accounts con SMOKE-1234567890 (usa cuenta 111005 del bootstrap) |
| `bank-csv-import` | POST /api/accounting/banking/imports con `fixtures/bancolombia-sample.csv` → ≥3 transacciones |
| `bank-csv-reimport` | Segunda subida → 0 nuevas, ≥3 duplicadas (idempotencia por fingerprint) |
| `bank-status` | GET /api/accounting/banking/status?periodId=X → lista cuentas con diferencia |

### Sección 4 — WS4 NIIF Auto-Adjustments (`UTOPIA_ENABLE_AUTO_ADJUSTMENTS`)

| Step | Qué valida |
|---|---|
| `adj-setup` | POST /api/accounting/adjustments/setup → 9 provisions_config Colombia 2026 |
| `fa-create` | POST /api/accounting/adjustments/fixed-assets → computador 3M/36 meses (usa cuentas 152805/159215/516015 del bootstrap) |
| `adj-preview` | POST /api/accounting/adjustments/preview → depreciación = 83.333,33 COP/mes ±1 |

### Sección 5 — WS5 Monthly Close (`UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW`)

| Step | Qué valida |
|---|---|
| `close-start` | POST /api/accounting/close/start → recibe workflowRunId (usa periodId del bootstrap) |
| `close-status-poll → completed` | Poll cada 2s hasta completado (max 60s). Verifica `period_hash` poblado |

### Sección 6 — WS6 Notifications (`UTOPIA_ENABLE_NOTIFICATIONS`)

| Step | Qué valida |
|---|---|
| `notif-sub-create` | POST /api/notifications/subscriptions → suscripción email creada |
| `notif-dispatch-test` | POST /api/notifications/dispatch (con `x-utopia-internal-secret`) → sent=1 o skipped=1 (WARN si Resend no configurado) |

**RESEND_API_KEY no configurada** termina como `⚠ WARN`, nunca como `✗ FAIL` — comportamiento esperado en desarrollo local.

---

## Fixture CSV (WS3)

`scripts/smoke-test-1plus1/fixtures/bancolombia-sample.csv` contiene 5 transacciones demo con formato:
```
fecha,descripcion,referencia,debito,credito,saldo
```
El importador WS3 parsea y deduplica por fingerprint (fecha+monto+descripción). La segunda subida del mismo CSV verifica idempotencia.

---

## Idempotencia y re-runs

El runner es **seguro de ejecutar múltiples veces**:

- Cada run crea un **workspace nuevo** (a menos que `SMOKE_WORKSPACE_ID` esté fijado).
- El bootstrap usa `ON CONFLICT DO NOTHING` en todas las inserciones — no duplica filas.
- Las reglas tributarias son `ON CONFLICT DO UPDATE` — idempotentes.
- Las cuentas bancarias y activos fijos usan códigos únicos (`SMOKE-*`) — si ya existen, el runner los detecta y continúa.

---

## Cómo agregar un step nuevo

1. Encuentra la sección correspondiente (`runWS1` … `runWS6`) en `scripts/smoke-test-1plus1.ts`.

2. Agrega un bloque al array `steps`:

```ts
{
  const t = now();
  try {
    const res = await ctx.http.post('/api/mi-endpoint', { campo: 'valor' });
    if (res.ok) {
      steps.push({ name: 'mi-step', result: pass('OK', undefined, t) });
    } else {
      steps.push({ name: 'mi-step', result: fail(`HTTP ${res.status}`, t) });
    }
  } catch (err) {
    steps.push({ name: 'mi-step', result: fail(err instanceof Error ? err.message : String(err), t) });
  }
}
```

3. Si el step produce un ID que otros pasos necesitan, guárdalo en `ctx`.

4. Si el step es idempotente (ON CONFLICT / duplicados OK), usa `warn` en lugar de `fail`.

5. Si el step necesita fixtures de DB (UUIDs, entries), agrégalos al bootstrap en `scripts/smoke-fixtures.ts`.

6. Actualiza este documento con la fila correspondiente en la tabla de la sección.

---

## TODOs pendientes

- **WS5 period_hash chain**: agregar validación de que `period_hash` de este cierre encadena correctamente con el `previous_period_hash` del cierre anterior.
- **CI integration**: agregar este runner al workflow de GitHub Actions con `npm run smoke` después del `npm run build`, usando un preview URL de Vercel.
