# 1+1 — Roadmap maestro de la Ola Élite

**Fecha**: 2026-05-05
**Owner**: Johan (developer@basileasystems.com)
**Especificación fuente**: conversación de Andreita Coco (DET — Documento de Especificaciones Técnicas).

Este documento es el **mapa unificado** de la Ola Élite del módulo "1+1": qué construimos, en qué orden, quién lo hace, qué archivos toca cada stream, y dónde está cada pieza al cierre del MVP.

> 👉 Para decisiones de alcance MVP vs diferido, ver [`MVP_DECISIONS_DEFERRED.md`](./MVP_DECISIONS_DEFERRED.md).

---

## Mapa de fases del DET → estado real al iniciar la Ola

| Fase del DET | Status pre-Ola | Cobertura post-Ola |
|---|---|---|
| **Fase 1 — Núcleo de hierro** (PUC, partida doble, parser balance, audit log) | **~95%** ✅ | 100% |
| **Fase 1.6 — Cuentas-impuesto inteligentes** (Smart-Tax) | **~5%** ❌ | 100% (WS1) |
| **Fase 2 — Automatización inteligente** (DIAN FE, OCR→libro, conciliación, ML) | **~30%** ⚠️ | 70% (WS2 + WS3, DIAN/OFX diferidos) |
| **Fase 3 — Módulos satélites** (Nómina, Inventarios, motor fiscal always-on) | **0%** ❌ | 30% (provisiones laborales en WS4; Nómina UI e Inventarios siguen diferidos) |
| **Fase 4 — Capa estratégica** (4 pilares + NIIF + cascada real-time) | **~50%** ⚠️ | 80% (cascada via cache invalidación, WS6) |
| **Fase 5 — Cierre + auditoría + alertas** (cierre mensual, lock, hash, push) | **~40%** ⚠️ | 90% (WS5 + WS6; PKCS#7 y forense automatizado diferidos) |

---

## Los 6 streams (workstreams)

Cada stream:
- Trabaja sobre **archivos disjuntos** (sin pisarse con los demás).
- Consume **schemas y tipos** que Opus 4.7 ya creó como fundaciones.
- Está protegido por un **feature flag OFF por defecto** (`UTOPIA_ENABLE_*`).
- Garantiza `npx tsc --noEmit` y `npm run build` limpios al cierre.

### WS1 — Smart-Tax Engine
**Owner**: Sonnet 4.6 #1
**Feature flag**: `UTOPIA_ENABLE_TAX_ENGINE`
**Schema**: `src/lib/db/schema-tax.ts` (creado por Opus)
**Tipos**: `src/lib/accounting/tax-engine/types.ts` (creado por Opus)
**Owns**:
- `src/lib/accounting/tax-engine/constants.ts` (UVT 2026, mínimos retención).
- `src/lib/accounting/tax-engine/rules-engine.ts` (motor de evaluación).
- `src/lib/accounting/tax-engine/line-generator.ts` (factura → propuesta de líneas).
- `src/lib/accounting/tax-engine/integrity-validator.ts` (`tax = base × rate`).
- `src/lib/db/seeds/tax-rules-co-2026.ts` (6 reglas built-in).
- `src/app/api/accounting/tax-engine/preview/route.ts` (POST: input invoice → líneas propuestas).

**Deliverables MVP**:
- Build de `tax_rules` por workspace con override de las reglas built-in.
- API preview que dado `{ subtotal, supplierThirdPartyId, invoiceType, accountId }` devuelve `{ lines: JournalLineInput[] }` listos para `createEntry`.
- Validador que rechaza si `|tax_amount - base * rate| > 1 COP`.

---

### WS2 — OCR → Journal Entry Bridge
**Owner**: Sonnet 4.6 #2
**Feature flag**: `UTOPIA_ENABLE_OCR_PROMOTE`
**Owns**:
- `src/lib/agents/pyme/promote/index.ts` (función `promoteEntry(pymeEntryId, options)`).
- `src/lib/agents/pyme/promote/account-mapper.ts` (categoría/pucHint → accountId).
- `src/lib/agents/pyme/promote/types.ts`.
- `src/app/api/pyme/promote/route.ts` (POST con array de pymeEntryIds).
- `src/components/workspace/pyme/PromoteEntries.tsx`.

**Deliverables MVP**:
- Botón "Promover a Libro Mayor" en el listado de `pyme_entries` confirmados.
- Bridge crea `journal_entries` en `draft` (no postea).
- Si la categoría tiene flag `is_invoice = true` y existe NIT del tercero, llama a `tax_engine.previewLines()` y agrega las líneas tributarias propuestas.

---

### WS3 — Bank Reconciliation
**Owner**: Sonnet 4.6 #3
**Feature flag**: `UTOPIA_ENABLE_BANK_RECON`
**Schema**: `src/lib/db/schema-banking.ts` (creado por Opus)
**Tipos**: `src/lib/accounting/banking/types.ts` (creado por Opus)
**Owns**:
- `src/lib/accounting/banking/parsers/csv.ts` (CSV genérico tipo extracto).
- `src/lib/accounting/banking/matcher/heuristic.ts` (matcher monto+fecha+cuenta).
- `src/lib/accounting/banking/services/reconciliation.ts`.
- `src/lib/accounting/banking/services/import.ts` (deduplica por fingerprint).
- `src/app/api/accounting/banking/accounts/route.ts` (CRUD bank_accounts).
- `src/app/api/accounting/banking/imports/route.ts` (POST CSV).
- `src/app/api/accounting/banking/reconcile/route.ts`.
- `src/app/workspace/contabilidad/conciliacion/page.tsx`.
- `src/components/workspace/contabilidad/ReconciliationView.tsx`.

**Deliverables MVP**:
- UI: subir CSV → preview transacciones → import → reconciliación heurística automática → revisión manual de no-matches.
- Servicio `getLedgerVsBankDifference(periodId, bankAccountId)` que el WS5 (cierre mensual) consulta.

---

### WS4 — NIIF Auto-Adjustments
**Owner**: Sonnet 4.6 #4
**Feature flag**: `UTOPIA_ENABLE_AUTO_ADJUSTMENTS`
**Schema**: `src/lib/db/schema-adjustments.ts` (creado por Opus)
**Tipos**: `src/lib/accounting/adjustments/types.ts` (creado por Opus)
**Owns**:
- `src/lib/accounting/adjustments/depreciation/calculator.ts` (lineal MVP).
- `src/lib/accounting/adjustments/amortization/calculator.ts`.
- `src/lib/accounting/adjustments/provisions/calculator.ts` (Prima 8.33%, Cesantías 8.33%, Intereses 1%, Vacaciones 4.17%, Salud 8.5%, Pensión 12%, ARL Clase I 0.522%, Parafiscales 9%).
- `src/lib/accounting/adjustments/provisions/income-tax.ts` (provisión renta 35% sobre utilidad).
- `src/lib/db/seeds/provisions-config-co-2026.ts`.
- `src/app/api/accounting/adjustments/depreciation/route.ts` (POST: ejecuta deprec del período).
- `src/app/api/accounting/adjustments/amortization/route.ts`.
- `src/app/api/accounting/adjustments/provisions/route.ts`.
- `src/app/api/accounting/adjustments/preview/route.ts` (vista previa sin postear).
- CRUD `fixed_assets`, `deferred_assets`, `provisions_config` en `src/app/api/accounting/adjustments/{fixed-assets,deferred-assets,provisions}/route.ts`.

**Deliverables MVP**:
- Cada calculator emite `CreateEntryInput` compatible con `createEntry()` del double-entry service. **No postea directamente** — es WS5 quien decide postearlos en el workflow de cierre.
- Endpoint `POST /api/accounting/adjustments/preview?periodId=X` que retorna las 3 propuestas (deprec/amort/provisiones) sin postear.

---

### WS5 — Monthly Close Workflow
**Owner**: Sonnet 4.6 #5
**Feature flag**: `UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW`
**Schema**: `src/lib/db/schema-adjustments.ts::monthlyCloseRuns` (creado por Opus)
**Tipos**: `src/lib/accounting/closing/types.ts` (creado por Opus)
**Dependencias npm**: `workflow`, `@workflow/next`, `@workflow/ai` (instalar como parte del stream).
**Owns**:
- `src/lib/workflows/monthly-close/index.ts` (export `closeMonthWorkflow`).
- `src/lib/workflows/monthly-close/steps/health-check.ts`.
- `src/lib/workflows/monthly-close/steps/run-adjustments.ts` (llama WS4).
- `src/lib/workflows/monthly-close/steps/closing-entry.ts` (zero-out a Patrimonio).
- `src/lib/workflows/monthly-close/steps/lock-period.ts`.
- `src/lib/workflows/monthly-close/steps/period-hash.ts` (sha256 encadenado).
- `src/lib/workflows/monthly-close/steps/generate-pdf.ts`.
- `src/lib/workflows/monthly-close/steps/notify.ts` (llama WS6).
- `src/lib/export/pdf-elite.ts` (PDF Dark Premium con sello hash).
- `src/app/api/cron/monthly-close/route.ts` (cron wrapper).
- `src/app/api/accounting/close/start/route.ts` (manual trigger).
- `src/app/api/accounting/close/status/[runId]/route.ts`.
- `src/app/api/accounting/close/resume/route.ts` (resumeHook para health-check failures).
- Modificación a `vercel.ts`: agregar cron `0 6 1 * *` y maxDuration al endpoint de start.

**Deliverables MVP**:
- Workflow durable que pausa con `createHook` cuando el health-check falla y reanuda al `resumeHook`.
- Cron mensual el 1ro a las 6 UTC (1am Colombia) que arranca el cierre del mes anterior para todos los workspaces con flag activo.
- PDF élite gold/black con: balance, P&L, certificado de integridad (hash + previous_hash), KPIs por pilar.

---

### WS6 — Email Notifications + Pillar KPI Cache
**Owner**: Sonnet 4.6 #6
**Feature flag**: `UTOPIA_ENABLE_NOTIFICATIONS`
**Schema**: `src/lib/db/schema-notifications.ts` (creado por Opus)
**Tipos**: `src/lib/notifications/types.ts` (creado por Opus)
**Dependencias npm**: `resend` (instalar como parte del stream).
**Owns**:
- `src/lib/notifications/email/resend-client.ts`.
- `src/lib/notifications/email/templates/period-locked.tsx` (React Email para Resend).
- `src/lib/notifications/dispatch.ts` (router por canal).
- `src/lib/notifications/web-push.ts` (stub que retorna `not_implemented` — para futuro).
- `src/lib/notifications/whatsapp.ts` (stub).
- `src/lib/kpis/cache.ts` (view + Vercel Runtime Cache invalidation).
- `src/app/api/notifications/subscriptions/route.ts` (CRUD).
- `src/app/api/notifications/dispatch/route.ts` (interno: llamado por WS5).
- `src/components/workspace/AlertDashboard.tsx` (lee últimas notificaciones).
- Migración SQL nueva: view `pillar_kpis_view` que agrega journal_lines en los 4 pilares.
- Hook en `src/lib/accounting/double-entry/service.ts::postEntry()` (1 línea agregada al final): invalidar tag de cache.

**Deliverables MVP**:
- Email automático al locked owner del workspace con plantilla élite.
- View `pillar_kpis_view` consultada en el dashboard reduce el cálculo on-demand de los 4 pilares.

---

## Fundaciones (creadas por Opus 4.7 antes de despachar)

```
src/lib/db/
├── schema.ts                     (modificado: re-exporta los 4 splits)
├── schema-tax.ts                 (NUEVO)
├── schema-banking.ts             (NUEVO)
├── schema-adjustments.ts         (NUEVO)
├── schema-notifications.ts       (NUEVO)
└── migrations/
    ├── 0005_smart_tax.sql        (NUEVO)
    ├── 0006_banking.sql          (NUEVO)
    ├── 0007_adjustments_close.sql (NUEVO)
    └── 0008_notifications.sql    (NUEVO)

src/lib/accounting/
├── tax-engine/types.ts           (NUEVO — contrato WS1)
├── banking/types.ts              (NUEVO — contrato WS3)
├── adjustments/types.ts          (NUEVO — contrato WS4)
└── closing/types.ts              (NUEVO — contrato WS5, importa WS4)

src/lib/notifications/
└── types.ts                      (NUEVO — contrato WS6)

docs/
├── 1PLUS1_ROADMAP.md             (este archivo)
└── MVP_DECISIONS_DEFERRED.md     (decisiones diferidas)
```

---

## Dependencias entre streams

```
WS1 (Smart-Tax)  ──────►  WS2 (OCR Bridge)  [opcional, si invoice]
                     │
                     ▼
WS4 (NIIF Adj)  ──────►  WS5 (Workflow)  ──────►  WS6 (Notify)
                                  ▲
WS3 (Bank Recon) ─────────────────┘  [WS5 consulta diferencia para health-check]
```

Todos pueden arrancar en paralelo gracias a los **tipos compartidos pre-creados**. Las llamadas cross-stream se hacen contra las **interfaces** documentadas en los `types.ts`, no contra implementaciones.

---

## Aplicación de migraciones

```bash
# 1. Verificar que .env.local tiene DATABASE_URL apuntando a Neon
cat .env.local | grep DATABASE_URL

# 2. Aplicar migraciones (orden 0005 → 0008, ya numeradas)
npm run db:push   # state-based, push del schema.ts actual

# 3. Verificar
npm run db:studio  # abrir Drizzle Studio
```

Si prefieres `npm run db:migrate` (file-based), las migraciones SQL ya están escritas en orden.

---

## Encendido de feature flags

Tras `npm run build` limpio:

```bash
# Encender todo en local
echo "UTOPIA_ENABLE_TAX_ENGINE=true" >> .env.local
echo "UTOPIA_ENABLE_OCR_PROMOTE=true" >> .env.local
echo "UTOPIA_ENABLE_BANK_RECON=true" >> .env.local
echo "UTOPIA_ENABLE_AUTO_ADJUSTMENTS=true" >> .env.local
echo "UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW=true" >> .env.local
echo "UTOPIA_ENABLE_NOTIFICATIONS=true" >> .env.local

# Smoke-test stream por stream antes de encender en preview/prod
```

---

## Smoke-tests post-MVP por stream

| Stream | Smoke-test |
|---|---|
| WS1 | `POST /api/accounting/tax-engine/preview { subtotal: 1000000, type: "service_purchase", supplierRegime: "regimen_comun" }` → 4 líneas (529505 Db, 240810 Db, 236525 Cr, 233595 Cr) cuadradas. |
| WS2 | Tomar un `pyme_entry` confirmado y pulsar "Promover" → aparece un `journal_entries` draft. |
| WS3 | Subir CSV de ejemplo de Bancolombia → ver match heurístico ≥80% sobre asientos de ese período. |
| WS4 | Crear `fixed_asset` (computador 3M, 36 meses) → `POST adjustments/depreciation/preview` → entry de 83.333,33 al gasto. |
| WS5 | `POST /api/accounting/close/start` → workflow visible en `npx workflow web <runId>` → cierre completa o pausa con hook esperado. |
| WS6 | Forzar evento `period.locked` → llega email de Resend con template élite. |
