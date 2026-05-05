# Smart-Tax Engine — WS1

Motor de cálculo automático de IVA, ReteFuente, ICA y ReteIVA para Colombia.
Dado el input de una transacción, propone las `JournalLineInput[]` listas para
pasar a `createEntry()` del módulo de partida doble.

---

## Arquitectura

```
TaxEvaluationInput
       │
       ▼
  rules-engine.ts   ← matchRules(): filtra reglas por tipo, régimen, umbral UVT
       │
       ▼
  line-generator.ts  ← generateLines(): BigInt aritmética, resuelve accountId
       │
       ▼
  TaxEvaluationResult
  ├── proposedLines: TaxLineProposal[]  (legible para UI)
  ├── journalLines:  JournalLineInput[] (listo para createEntry)
  ├── totalPayableCop: string           (neto a pagar/cobrar)
  └── warnings: string[]
```

Persistencia (best-effort, no bloquea al caller):
- `repository.ts` — queries a `tax_rules`, `third_party_tax_profile`, `chart_of_accounts`.
- `recordAudit()` — guarda en `tax_engine_audits` para trazabilidad.

---

## Feature flag

```bash
# .env.local
UTOPIA_ENABLE_TAX_ENGINE=true
```

Sin este flag, el endpoint `/api/accounting/tax-engine/preview` devuelve HTTP 503.

---

## Caso de smoke-test: compra de servicios de publicidad $1.000.000 COP

**Input**: `service_purchase`, subtotal `1000000`, proveedor régimen común no autorretenedor.

**Reglas matched**: `IVA_19_PURCHASE`, `RTF_SVC_4`

**Líneas propuestas** (partida doble completa con la línea base):

| # | Cuenta | Descripción | Débito | Crédito |
|---|--------|-------------|--------|---------|
| 1 | `529505` | Gasto servicios publicidad | $1.000.000 | — |
| 2 | `240810` | IVA descontable 19% | $190.000 | — |
| 3 | `236525` | ReteFuente servicios 4% | — | $40.000 |
| 4 | `233595` (o CxP) | Neto a pagar al proveedor | — | $1.150.000 |

**Explicación**:
- El proveedor factura $1.000.000 + IVA 19% = $1.190.000.
- El comprador retiene el 4% de ReteFuente = $40.000.
- Neto a girar = $1.190.000 − $40.000 = **$1.150.000**.
- El IVA descontable ($190.000) queda en `240810` para cruzar con IVA generado.

> **Nota**: la línea de CxP del proveedor (233595 o 220500) la construye el caller
> (WS2 o el usuario), no el tax engine. El motor solo propone las líneas de impuesto.
> El campo `totalPayableCop` da el neto para que el caller cree la línea de CxP.

---

## Prueba con curl

```bash
# 1. Obtener el workspace_id (primer request crea cookie)
curl -c cookies.txt http://localhost:3000/api/accounting/accounts -s -o /dev/null

# 2. Preview de impuestos
curl -X POST http://localhost:3000/api/accounting/tax-engine/preview \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "transactionType": "service_purchase",
    "subtotalCop": "1000000",
    "contextRef": "smoke-test"
  }' | jq .
```

Respuesta esperada (con PUC sembrado y reglas activas):
```json
{
  "ok": true,
  "proposedLines": [
    { "ruleCode": "IVA_19_PURCHASE", "taxAmountCop": "190000.00", "side": "debit" },
    { "ruleCode": "RTF_SVC_4",       "taxAmountCop": "40000.00",  "side": "credit" }
  ],
  "journalLines": [...],
  "totalPayableCop": "1150000.00",
  "warnings": ["Tercero sin perfil tributario registrado..."]
}
```

> Sin `thirdPartyId`, RTF_SVC_4 asume régimen común y aplica con warning.
> Con `thirdPartyId` de un proveedor `gran_contribuyente`, RTF_SVC_4 NO aplica.

---

## Enchufar nuevas reglas

### Opción A — Override workspace (UI/API)

```sql
INSERT INTO tax_rules (workspace_id, code, tax_type, description, rate,
  tax_account_code, account_side, applicable_triggers)
VALUES (
  '<workspace_uuid>',
  'ICA_MED_9',          -- código único por workspace
  'ICA',
  'ICA Medellín 9/1000',
  '0.009000',
  '236805',
  'credit',
  '{"transactionTypes":["purchase","service_purchase"],"cityCode":"05001"}'::jsonb
);
```

### Opción B — Seed built-in nueva tarifa

Agregar entrada a `BUILT_IN_RULES` en `src/lib/db/seeds/tax-rules-co-2026.ts`
y re-ejecutar `npx tsx scripts/seed-tax-rules.ts`.

---

## Correr el seed

```bash
# Prerrequisito: migración 0005_smart_tax.sql aplicada
npm run db:push   # aplica el schema actual

# Sembrar reglas y UVT
npx tsx scripts/seed-tax-rules.ts
```

---

## Decisiones diferidas

| Tema | Diferido a |
|------|-----------|
| D5 — Detección automática de régimen vía RUT DIAN | `src/lib/scrapers/dian-rut-scraper.ts` |
| Cron de UVT anual contra DIAN | `src/lib/tools/get-tax-calendar.ts` futuro |
| ReteIVA (Art. 437-1 ET) — 15% del IVA | Regla `RETEIVA_15` — no sembrada aún |
| ICA otras ciudades | Seeds municipales adicionales |
| Umbral por UVT histórico (períodos <2025) | Consultar tabla `uvt_constants` en DB |
| Validación integridad estricta en `postEntry()` | Hook en double-entry/service.ts |
