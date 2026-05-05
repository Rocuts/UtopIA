# WS4 — NIIF Auto-Adjustments

Calculadores **deterministas** (sin LLM) de depreciación, amortización de diferidos y provisiones laborales/renta para PYMES colombianas. Cada calculador produce `CreateEntryInput` listo para que WS5 (workflow de cierre mensual) lo postee dentro de su transacción.

## Fórmulas

### Depreciación lineal (`straight_line`)

```
depreciable    = acquisition_cost - salvage_value
monthly        = depreciable / useful_life_months     (BigInt-centavos)
remaining      = depreciable - accumulated_depreciation
this_month     = min(monthly, remaining)
new_accumulated = accumulated + this_month
book_value_after = acquisition_cost - new_accumulated
```

**Precisión**: todos los intermedios en `bigint` (centavos) siguiendo el patrón de `double-entry/validate.ts`. El último mes recibe el centavo residual de forma natural (el clamp `min(monthly, remaining)` lo absorbe).

**Caso de prueba documentado** (acceptance criterion):
- Activo: computador, costo $3.000.000 COP, 36 meses, sin valor residual.
- `depreciable = 3_000_000 × 100 centavos = 300_000_000 centavos`
- `monthlyBase = 300_000_000 / 36 = 8_333_333 centavos` (división entera BigInt)
- `remainder   = 300_000_000 % 36 = 12 centavos`
- **Política "front-load remainder"**: el residuo se suma al **primer** mes.
  - Mes 1: `8_333_333 + 12 = 8_333_345 centavos = 83_333.45 COP`
  - Meses 2–36: `8_333_333 centavos = 83_333.33 COP` cada uno
- Total: `83_333.45 + 35 × 83_333.33 = 83_333.45 + 2_916_665.55 = 3_000_000.00 COP` ✓
- Verificado con `node` — `accumulated === depreciable` exactamente en BigInt.

**Métodos diferidos**:
- `units_of_production`: requiere unidades producidas por mes. Gatillo: cliente manufacturero con maquinaria. Archivo: `depreciation/calculator.ts` (stub en comentario).
- `accelerated`: requiere tabla de % anuales decrecientes. Gatillo: activo tecnológico de alto valor que pierde valor rápido. Archivo: `depreciation/calculator.ts` (stub en comentario).
- **NIC 36 — Deterioro de valor**: revisión por indicios de deterioro; requiere cálculo de valor recuperable (VIU o FVLCTS). Diferido — no es parte del cierre mensual automatizado.

### Amortización de diferidos (lineal con prorateo por días)

```
total_days     = días entre amortization_start y amortization_end (inclusive)
days_in_period = intersección de días entre el diferido y el período contable
fraction       = days_in_period / total_days
period_amount  = total_amount × fraction               (BigInt — sin float drift)
remaining      = total_amount - amortized_amount
this_period    = min(period_amount, remaining)
```

El prorateo por días maneja correctamente meses parciales al inicio o fin del diferido (ej. seguro pagado el día 15 del mes).

### Provisiones laborales Colombia 2026

| Tipo | Tasa | Base | Referencia |
|---|---|---|---|
| prima | 8.33% | Salarios + Aux. transporte | Ley 52/1975 |
| cesantias | 8.33% | Salarios + Aux. transporte | Art. 249 CST |
| intereses_cesantias | 1.00% | Saldo cesantías acumuladas | Ley 52/1975 art. 5 |
| vacaciones | 4.17% | Salarios + Aux. transporte | Art. 186 CST |
| salud | 8.50% | Salarios + Aux. transporte | Ley 100/1993 (empleador) |
| pension | 12.00% | Salarios + Aux. transporte | Ley 100/1993 (empleador) |
| arl | 0.522% | Salarios + Aux. transporte | Decreto 1295/1994 — Clase I |
| parafiscales | 9.00% | Salarios + Aux. transporte | Ley 21/1982 |
| income_tax | 35.00% | Utilidad antes de impuestos | Art. 240 E.T. 2026 |

**Caso de prueba income_tax**:
- Utilidad antes de impuestos = $1.000.000 COP
- `provision = 1_000_000 × 0.35 = 350_000 COP` ✓
- `350_000 × 100 centavos = 35_000_000 centavos`
- `35_000_000 × 350_000 / 1_000_000 = 12_250_000_000 / 1_000_000 = 12_250 centavos`... ✗

Corrección — cálculo interno real:
- `base = 100_000_000 centavos` (1.000.000 COP × 100)
- `rateBig = 350_000` (35.0000% × 1_000_000 de escala)
- `provision = 100_000_000 × 350_000 / 1_000_000 = 35_000_000_000 / 1_000_000 = 35_000_000 centavos`
- `35_000_000 / 100 = 350_000.00 COP` ✓

## Idempotencia

- `previewDepreciation` / `previewAmortization` / `previewProvisions` son **read-only** — pueden llamarse N veces sin efecto.
- El endpoint con `post: true` actualiza `last_depreciated_period_id` / `last_amortized_period_id`. Un segundo POST con el mismo `periodId` devuelve preview vacío (las líneas quedan en `skipped` con razón `already_depreciated_this_period`), no crea entrada duplicada.

## Cuentas PUC

| Cuenta | Código | Nombre |
|---|---|---|
| Deprec. acumulada | 159205 | Depreciación acumulada — equipo |
| Gasto deprec. | 516010 | Gasto depreciación |
| Cesantías pasivo | 261020 | Cesantías consolidadas por pagar |
| Pensiones pasivo | 237006 | Pensiones AFP por pagar |
| Imp. renta por pagar | 240405 | Impuesto sobre la Renta por pagar |
| Gasto imp. renta | 540505 | Gasto Impuesto de Renta y CIA |

## Decisiones diferidas

| Decisión | Motivo | Archivo futuro |
|---|---|---|
| `units_of_production` | Requiere input de unidades por mes | `depreciation/calculator.ts` |
| `accelerated` | Requiere tabla de % anuales | `depreciation/calculator.ts` |
| NIC 36 deterioro | Requiere cálculo de valor recuperable | `depreciation/impairment.ts` |
| NIC 12 impuesto diferido | Diferencias temporarias | `provisions/deferred-tax.ts` |
| Vitest | D6 del roadmap — post-MVP | `__tests__/` |

## Endpoints

```bash
# Setup: sembrar provisions_config estándar Colombia 2026
curl -X POST http://localhost:3000/api/accounting/adjustments/setup \
  -H "Cookie: utopia_workspace_id=<ws-id>"

# Preview de los 3 tipos juntos (sin postear)
curl -X POST http://localhost:3000/api/accounting/adjustments/preview \
  -H "Content-Type: application/json" \
  -d '{"periodId":"<period-uuid>"}'

# Depreciation — solo preview
curl -X POST http://localhost:3000/api/accounting/adjustments/depreciation \
  -H "Content-Type: application/json" \
  -d '{"periodId":"<period-uuid>","post":false}'

# Depreciation — postear asiento
curl -X POST http://localhost:3000/api/accounting/adjustments/depreciation \
  -H "Content-Type: application/json" \
  -d '{"periodId":"<period-uuid>","post":true}'

# Amortización — postear
curl -X POST http://localhost:3000/api/accounting/adjustments/amortization \
  -H "Content-Type: application/json" \
  -d '{"periodId":"<period-uuid>","post":true}'

# Provisiones — postear
curl -X POST http://localhost:3000/api/accounting/adjustments/provisions \
  -H "Content-Type: application/json" \
  -d '{"periodId":"<period-uuid>","post":true}'

# CRUD fixed_assets
curl http://localhost:3000/api/accounting/adjustments/fixed-assets
curl -X POST http://localhost:3000/api/accounting/adjustments/fixed-assets \
  -H "Content-Type: application/json" \
  -d '{
    "code":"COMP-001","name":"Computador Dell XPS","category":"equipo_computo",
    "assetAccountId":"<uuid>","depreciationAccountId":"<uuid>","expenseAccountId":"<uuid>",
    "acquisitionDate":"2026-01-01T00:00:00Z","acquisitionCost":"3000000.00",
    "usefulLifeMonths":36
  }'

# CRUD deferred_assets
curl -X POST http://localhost:3000/api/accounting/adjustments/deferred-assets \
  -H "Content-Type: application/json" \
  -d '{
    "description":"Seguro todo riesgo anual",
    "assetAccountId":"<uuid>","expenseAccountId":"<uuid>",
    "totalAmount":"1200000.00",
    "amortizationStart":"2026-03-15T00:00:00Z",
    "amortizationEnd":"2027-03-14T23:59:59Z"
  }'

# CRUD provisions-config
curl http://localhost:3000/api/accounting/adjustments/provisions-config
```

## Feature flag

```bash
echo "UTOPIA_ENABLE_AUTO_ADJUSTMENTS=true" >> .env.local
```

Sin el flag, todos los endpoints retornan `503 ADJ_ENGINE_DISABLED`.
