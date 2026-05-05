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
  { pymeEntryIds[], periodId, applyTaxEngine? }

1. Cargar pyme_entries confirmados del workspace (JOIN pyme_books para ownership).
2. Agrupar por (entryDate, kind) → una journal_entry por grupo.
3. Para cada grupo:
   a. Resolver cuenta principal via account-mapper:
      - Exacta: pucHint → chart_of_accounts WHERE code=pucHint AND is_postable.
      - Fallback: 12 reglas heurísticas por keywords (description + category).
   b. Contrapartida: siempre cuenta 110505 (Caja general).
   c. Opcional: si applyTaxEngine=true Y UTOPIA_ENABLE_TAX_ENGINE=true
      Y el entry parece una factura → import('@/lib/accounting/tax-engine').evaluate()
      → reemplaza la línea de Caja con líneas tributarias del motor WS1.
   d. createEntry({ status: 'draft', sourceType: 'ai_generated',
                    sourceRef: 'pyme_book:<bookId>',
                    metadata: { promotedFromPymeEntryIds: [...] } })
4. Retornar PromoteResult: { promotedCount, journalEntryIds, skipped, warnings }
```

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

# 2. Necesitas un pyme_entry confirmado y un accounting_period abierto.
# Consulta con Drizzle Studio o psql:
#   SELECT id FROM pyme_entries WHERE status='confirmed' LIMIT 1;
#   SELECT id FROM accounting_periods WHERE status='open' LIMIT 1;

ENTRY_ID="<uuid-del-entry>"
PERIOD_ID="<uuid-del-period>"

curl -X POST http://localhost:3000/api/pyme/promote \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d "{
    \"pymeEntryIds\": [\"$ENTRY_ID\"],
    \"periodId\": \"$PERIOD_ID\",
    \"applyTaxEngine\": false
  }"

# Respuesta esperada:
# { "ok": true, "promotedCount": 1, "journalEntryIds": ["<uuid>"], "skipped": [], "warnings": [] }
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
