# WS2 — OCR → Journal Entry Bridge

**Owner**: Sonnet 4.6 #2  
**Feature flag**: `UTOPIA_ENABLE_OCR_PROMOTE=true`  
**Estado**: MVP entregado (2026-05-05)

## Qué hace

Toma `pyme_entries` en estado `confirmed` y los convierte en `journal_entries` formales en estado `draft` dentro del Libro Mayor de partida doble.

El usuario selecciona renglones desde el `Ledger` → pulsa "Promover a Libro Mayor" → revisa el mapping de cuentas → confirma → el bridge crea los asientos.

## Algoritmo

```
POST /api/pyme/promote
  { pymeEntryIds[], periodId, applyTaxEngine?, costCenterId? }

1. Cargar pyme_entries confirmados del workspace (JOIN pyme_books para ownership).
2. Agrupar por (entryDate, kind) → una journal_entry por grupo.
3. Para cada grupo:
   a. Resolver cuenta principal via account-mapper (3 pasos):
      1. Exacta: pucHint → chart_of_accounts WHERE code=pucHint AND is_postable.
         Si la cuenta tiene requires_cost_center=true y no se pasó costCenterId
         → accountId=null → grupo a skipped.
      2. Fallback dinámico (UNA query CASE-WHEN):
         - Con costCenterId: busca la primera cuenta postable del kind
           entre prefijos [4135, 4170, 4175, 421] (ingreso) o
           [5105, 5110, 5120, 5135, 5145, 5160, 5205, 530, 531, 540] (egreso).
         - Sin costCenterId: igual pero filtrando requires_cost_center=false.
         - Si no hay ninguna → accountId=null → grupo a skipped.
      3. Sin pucHint y sin match → accountId=null → skipped.
   b. Contrapartida: siempre cuenta 110505 (Caja general, no requiere CC).
   c. Opcional: si applyTaxEngine=true Y UTOPIA_ENABLE_TAX_ENGINE=true
      Y el entry parece una factura → import('@/lib/accounting/tax-engine').evaluate()
      → reemplaza la línea de Caja con líneas tributarias del motor WS1.
   d. createEntry({ status: 'draft', sourceType: 'ai_generated',
                    sourceRef: 'pyme_book:<bookId>',
                    metadata: { promotedFromPymeEntryIds: [...] } })
      Las líneas con requires_cost_center=true llevan costCenterId en la columna.
4. Retornar PromoteResult: { promotedCount, journalEntryIds, skipped, warnings }
```

### Centro de costos (`costCenterId`)

El campo `costCenterId` en el body de `POST /api/pyme/promote` es **opcional**.

| Escenario | Comportamiento |
|---|---|
| `costCenterId` presente | Asigna el CC a las líneas cuya cuenta tiene `requires_cost_center=true`. |
| Sin `costCenterId` + cuenta sin CC | Funciona normal; no asigna CC. |
| Sin `costCenterId` + cuenta con CC | El mapper descarta esa cuenta y busca la siguiente sin CC. Si ninguna disponible → entry a `skipped` con razón `requires_cost_center_no_default_provided:<code>`. |

El smoke-test crea automáticamente un cost_center `GENERAL` via `bootstrapSmokeFixtures()` y lo pasa en el body.

## Trazabilidad bidireccional

Sin alterar el schema de `pyme_entries`:

| Campo en `journal_entries` | Valor |
|---|---|
| `source_type` | `'ai_generated'` |
| `source_ref` | `'pyme_book:<bookId>'` |
| `metadata.promotedFromPymeEntryIds` | `string[]` — IDs de los pyme_entries del grupo |
| `metadata.promotedAt` | ISO timestamp |
| `metadata.groupKind` | `'ingreso'` \| `'egreso'` |

## Archivos

```
src/lib/agents/pyme/promote/
├── index.ts          — función promoteEntries() + isOcrPromoteEnabled()
├── account-mapper.ts — pucHint/keywords → UUID en chart_of_accounts
├── entry-builder.ts  — grupos → CreateEntryInput[] + groupEntries()
├── repository.ts     — queries DB (loadConfirmedEntries, extractBookId)
├── types.ts          — PromoteInput, PromoteResult, tipos locales
└── README.md         — este archivo

src/app/api/pyme/promote/
└── route.ts          — POST handler (Zod + feature flag + workspace cookie)

src/components/workspace/pyme/
└── PromoteEntries.tsx — botón + diálogo de revisión + estado de resultado
```

## Encender el feature

```bash
# Desarrollo
echo 'UTOPIA_ENABLE_OCR_PROMOTE=true' >> .env.local
npm run dev
```

## Smoke-test manual (curl)

```bash
# 1. Obtener workspace cookie desde el navegador (Dev Tools → Application → Cookies)
COOKIE="utopia_workspace_id=<UUID>"

# 2. Necesitas un pyme_entry confirmado, un accounting_period abierto y un cost_center.
# Consulta con Drizzle Studio o psql:
#   SELECT id FROM pyme_entries WHERE status='confirmed' LIMIT 1;
#   SELECT id FROM accounting_periods WHERE status='open' LIMIT 1;
#   SELECT id FROM cost_centers WHERE code='GENERAL' LIMIT 1;

ENTRY_ID="<uuid-del-entry>"
PERIOD_ID="<uuid-del-period>"
CC_ID="<uuid-del-cost-center>"

curl -X POST http://localhost:3000/api/pyme/promote \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d "{
    \"pymeEntryIds\": [\"$ENTRY_ID\"],
    \"periodId\": \"$PERIOD_ID\",
    \"applyTaxEngine\": false,
    \"costCenterId\": \"$CC_ID\"
  }"

# Respuesta esperada:
# { "ok": true, "promotedCount": 1, "journalEntryIds": ["<uuid>"], "skipped": [], "warnings": [] }

# Sin costCenterId (solo funciona si la cuenta resuelta NO requiere CC):
curl -X POST http://localhost:3000/api/pyme/promote \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d "{
    \"pymeEntryIds\": [\"$ENTRY_ID\"],
    \"periodId\": \"$PERIOD_ID\",
    \"applyTaxEngine\": false
  }"
```

## Límites del MVP (decisión D2 honrada)

- **Sin auto-promote**: la acción es siempre explícita. El usuario debe seleccionar y pulsar "Promover".
- **Sin aprendizaje**: el clasificador no aprende del PUC final que el contador ratifica vs el `pucHint` sugerido. Diferido a `auto-rules.ts`.
- **Sin promote retroactivo masivo**: el endpoint acepta máximo 200 entries por request para no saturar el período.
- **Caja única**: la contrapartida del MVP es siempre 110505 (Caja general). CxP/CxC solo se generan si el tax engine está activo y detecta factura.
- **Agrupación por (fecha, kind)**: una journal_entry por (día, tipo). Entries de días distintos o kinds distintos generan asientos separados.

## TODOs encolados

- `auto-rules.ts`: promote automático cuando confidence > 0.9 y hay N promociones manuales previas del mismo pucHint.
- Aprendizaje: guardar en `pyme_categories.pucHint` el código ratificado por el contador tras promote.
- Promote retroactivo paginado: endpoint `POST /api/pyme/promote/bulk?bookId=X&month=YYYY-MM` para migrar un mes completo.
- Link bidireccional inverso: en el detalle del journal_entry, mostrar botón "Ver en OCR Pyme" que va a `/workspace/pyme/<bookId>` filtrando por fecha.
- Selector de cuenta manual en el diálogo: si el mapping es heurístico, mostrar un `<select>` de cuentas postables para que el contador corrija antes de confirmar.
- Migración 0009 (si se decide mover el link a columna): `ALTER TABLE pyme_entries ADD COLUMN promoted_journal_entry_id UUID REFERENCES journal_entries(id)`. Por ahora el link vive en `journal_entries.metadata.promotedFromPymeEntryIds`.
