# Smoke Test Guide — 1+1 Élite

**Archivo principal**: `scripts/smoke-test-1plus1.ts`
**Comando**: `npm run smoke`

---

## Qué hace

Valida los 6 workstreams de la Ola "1+1 Élite" end-to-end contra el dev server
y Neon Postgres, siguiendo el flujo real de HTTP (cookies, JSON bodies, CSV
multipart). Cada sección solo corre si su feature flag está activo en `.env.local`.
Con todos los flags OFF termina en <2 s con exit 0.

---

## Precondiciones

| Requisito | Cómo verificar |
|---|---|
| Dev server corriendo | `npm run dev` en otra terminal |
| `.env.local` presente | `cat .env.local \| grep DATABASE_URL` |
| Migraciones aplicadas | `npm run db:push` |
| Reglas tributarias sembradas | `npx dotenv -e .env.local -- tsx scripts/seed-tax-rules.ts` (si WS1 está activo) |

### Variables de entorno requeridas

```bash
# Obligatorias para cualquier run
DATABASE_URL=postgresql://...
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

# Para WS3 — UUID de chart_of_accounts que actúa como cuenta contable del extracto
SMOKE_CHART_ACCOUNT_ID=<uuid de chart_of_accounts>

# Para WS4 — UUIDs de cuentas PUC del activo fijo demo
SMOKE_FA_ASSET_ACCOUNT_ID=<uuid>   # Cuenta activo (e.g. 1524 Equipos de cómputo)
SMOKE_FA_DEP_ACCOUNT_ID=<uuid>     # Cuenta depreciación acumulada (e.g. 1592)
SMOKE_FA_EXP_ACCOUNT_ID=<uuid>     # Cuenta gasto depreciación (e.g. 5160)

# Para WS2 — IDs de pyme_entries confirmados (separados por coma)
SMOKE_PYME_ENTRY_IDS=<uuid1>,<uuid2>

# Para WS6 — secreto interno que autentica /api/notifications/dispatch
UTOPIA_INTERNAL_SECRET=<secreto>

# Para WS6 — si RESEND no está configurado, el dispatch termina como WARN (esperado en dev)
RESEND_API_KEY=re_...

# Desactivar colores ANSI
NO_COLOR=1
```

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

## Salida esperada

```
╔════════════════════════════════════════════════════════════════════╗
║  1+1 Élite — Smoke Test Runner                                     ║
║  Base: http://localhost:3000                                        ║
║  Workspace: 0a8b2c1f-xxxx (creado automáticamente)                 ║
╚════════════════════════════════════════════════════════════════════╝

▸ Fundaciones
  ✓ health                                              [   12 ms]
  ✓ db-reachable                                        [   34 ms]

▸ WS1 — Smart-Tax Engine                  [flag ON]
  ✓ tax-seed                                            [  120 ms]
  ✓ tax-preview-purchase-1m                             [   89 ms]
    └ 2 líneas, IVA=190000, base=1000000

▸ WS2 — OCR → Journal Bridge              [flag OFF, saltado]
...
═════════════════════════════════════════════════════════════════════
  Total: 8 ✓   1 ⚠   0 ✗      Duración: 4.2 s
  Resultado: PASSED (con warnings)
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

### Sección 1 — WS1 Smart-Tax Engine (`UTOPIA_ENABLE_TAX_ENGINE`)

| Step | Qué valida |
|---|---|
| `tax-seed` | POST /api/accounting/tax-engine/seed — siembra reglas built-in. Si el endpoint no existe, retorna WARN con instrucción manual |
| `tax-preview-purchase-1m` | POST /api/accounting/tax-engine/preview con $1.000.000 → verifica IVA=190.000 ±1 COP |

### Sección 2 — WS2 OCR Bridge (`UTOPIA_ENABLE_OCR_PROMOTE`)

| Step | Qué valida |
|---|---|
| `pyme-create-entry` | WARN con instrucción: requiere INSERT directo en DB (no hay endpoint de creación con status=confirmed) |
| `pyme-promote` | POST /api/pyme/promote con `SMOKE_PYME_ENTRY_IDS` → verifica journalEntryIds.length >= 1 |

**Para probar WS2 completo:**
```sql
-- Insertar pyme_entries confirmados directamente en Neon:
INSERT INTO pyme_entries (book_id, entry_date, description, kind, amount, status)
VALUES
  ('<book_id>', NOW(), 'Venta efectivo', 'ingreso', '500000', 'confirmed'),
  ('<book_id>', NOW(), 'Compra suministros', 'egreso', '200000', 'confirmed')
RETURNING id;

-- Luego exportar los IDs:
export SMOKE_PYME_ENTRY_IDS=<id1>,<id2>
```

### Sección 3 — WS3 Bank Reconciliation (`UTOPIA_ENABLE_BANK_RECON`)

| Step | Qué valida |
|---|---|
| `bank-acc-create` | POST /api/accounting/banking/accounts con SMOKE-1234567890 |
| `bank-csv-import` | POST /api/accounting/banking/imports con `fixtures/bancolombia-sample.csv` → ≥3 transacciones |
| `bank-csv-reimport` | Segunda subida → 0 nuevas, ≥3 duplicadas (idempotencia por fingerprint) |
| `bank-status` | GET /api/accounting/banking/status?periodId=X → lista cuentas con diferencia |

**Requiere `SMOKE_CHART_ACCOUNT_ID`:** UUID de una cuenta postable en `chart_of_accounts` del workspace. Ejemplo típico: código `111005` (Caja general) o `111010` (Bancos nacionales).

### Sección 4 — WS4 NIIF Auto-Adjustments (`UTOPIA_ENABLE_AUTO_ADJUSTMENTS`)

| Step | Qué valida |
|---|---|
| `adj-setup` | POST /api/accounting/adjustments/setup → 9 provisions_config Colombia 2026 |
| `fa-create` | POST /api/accounting/adjustments/fixed-assets → computador 3M/36 meses |
| `adj-preview` | POST /api/accounting/adjustments/preview → depreciación = 83.333,33 COP/mes ±1 |

**Requiere variables de cuentas PUC** (`SMOKE_FA_*_ACCOUNT_ID`). Cuentas típicas PYMES decreto 2706:
- Activo: `152435` (Equipos de cómputo y comunicación)
- Depreciación acumulada: `159235` (Depreciación acumulada equipos)
- Gasto: `516040` (Depreciación de propiedades planta y equipo)

### Sección 5 — WS5 Monthly Close (`UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW`)

| Step | Qué valida |
|---|---|
| `close-start` | POST /api/accounting/close/start → recibe workflowRunId |
| `close-status-poll → completed` | Poll cada 2s hasta completado (max 60s). Si queda `awaiting_resolution`, envía resume automático con `approved=true` y vuelve a hacer poll |

**Nota sobre el workflow:** WS5 usa `workflow` (Vercel Workflow DevKit). Si el servidor de workflow no está corriendo localmente, el start puede retornar 202 pero el poll nunca llega a `completed` — terminará como WARN/timeout.

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
El importador WS3 debe parsearlas y deduplicarlas por fingerprint (fecha+monto+descripción). La segunda subida del mismo CSV verifica la idempotencia.

---

## Idempotencia y re-runs

El runner es **seguro de ejecutar múltiples veces**:

- Cada run crea un **workspace nuevo** (a menos que `SMOKE_WORKSPACE_ID` esté fijado).
- Las cuentas bancarias, activos fijos y suscripciones usan códigos/números únicos (`SMOKE-*`) — si ya existen, el runner los detecta y continúa.
- Las reglas tributarias son `ON CONFLICT DO UPDATE` — idempotentes.
- Las pyme_entries de WS2 y los períodos de WS5 pueden requerir cleanup manual si se quiere testear el estado inicial.

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

5. Actualiza este documento con la fila correspondiente en la tabla de la sección.

---

## TODOs pendientes

- **WS2 completo**: agregar endpoint `POST /api/pyme/entries` que acepte `status='confirmed'` para que el runner no necesite insertar directo en DB.
- **WS5 period_hash chain**: agregar validación de que `period_hash` de este cierre encadena correctamente con el `previous_period_hash` del cierre anterior.
- **WS3 chart_of_accounts**: agregar un helper de bootstrap que llame al seed de PUC del workspace antes de crear la cuenta bancaria, eliminando la necesidad de `SMOKE_CHART_ACCOUNT_ID` manual.
- **WS4 account auto-resolve**: resolver las cuentas PUC por código (e.g. `152435`) en lugar de UUID, para no necesitar `SMOKE_FA_*` vars.
- **CI integration**: agregar este runner al workflow de GitHub Actions con `npm run smoke` después del `npm run build`, usando un preview URL de Vercel.
