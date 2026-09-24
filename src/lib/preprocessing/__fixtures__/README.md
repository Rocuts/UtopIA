# Preprocessing Fixtures

Fixtures sintéticos para los tests del preprocesador y del Curator NIIF.

## `elite-pulido-diamante.csv`

Balance de prueba multiperiodo (2024 → 2025) diseñado para ejercitar varias
reglas del Curator en una sola pasada del preprocesador. Lo consumen:

- `elite-pulido-diamante.test.ts` — 5 cuadraturas + sanidad del Curator (E2E).
- `elite-pulido-diamante-binding.test.ts` — smoke del bloque vinculante:
  verifica que el helper `renderSnapshotLines` del orquestador financiero
  emite las secciones del Curator que el LLM consume como totales vinculantes.

> **Actualizado 2026-09-24 (auditoría integral, niif-preproceso-31 /
> recalculo-15).** Desde la auditoría 2026-09 el Curator ya no «repara» el
> descuadre deliberado del fixture: R5 no ancla el patrimonio al ECP y R8 no
> absorbe residuales en 3710VC (niif-preproceso-06). El descuadre del archivo
> queda expuesto al centavo y bloquea. Esta sección describe el
> comportamiento verificado por `elite-pulido-diamante.test.ts`; la versión
> anterior (R5 fijaba `convergenceAdjustment.gapCop = $1.572M` y el periodo
> cuadraba) ya no es vigente.

### Activadores por regla (periodo primario 2025)

| Regla | Disparador en el fixture | Resultado verificado |
|-------|--------------------------|----------------------|
| **R1** — Saldos negativos en activos (muta) | `120505` (-$50M en 2025), saldo crédito material en una inversión | **1** reclasificación: cuenta virtual `2895VC-120505` ($50M) en Clase 2; `120505` queda en 0. La `159205` (-$130M) **no** dispara R1: es correctora de activo (depreciación acumulada) y su saldo crédito es su naturaleza (NIC 16.73 / NIIF PYMES 17.31, importe en libros neto); queda en Clase 1 con traza `CUR-R1-CA` |
| **R8** — Cierre virtual (muta) | P&G 2025 con resultado dinámico −$2,5M y un `360505` de $145M que no es el resultado del año | `3605VC` con el resultado dinámico; el `360505` ($145M) se reclasifica a `3710VC`. El residual que el traslado no explica (**$1.574.500.000,00**, huella de `379505`) **no** se absorbe: `unexplainedResidualRaw = "1574500000.00"`, `blocking = true`, motivo `CUR-R8` y `equationBalanced = false` |
| **R5** — Anclaje patrimonial Balance↔ECP | Ya no muta | `convergenceAdjustment` y `equityAnchorAdjustment` ausentes; sin motivo `CUR-R5` |
| **R6** — Cierre EFE↔Caja PUC 11 | EFE indirecto T-1→T con brecha material | R6 **no** absorbe la brecha en capital de trabajo: `reconciliationGap` ≈ $177,5M (= variación del residual no explicado entre 2024 y 2025), `reconciled = false`, hallazgo `CUR-R6` severidad alta |
| **R7** — Costo presunto (no muta) | Margen bruto $85M ingresos vs $12,5M costo = 85,29% (>85%) e inventario $1.670M > 50% × ingresos | `presumedCostWarning` con margen ≈ 0,853 y umbral 0,85 |

### Cifras verificadas

```
2025: Activo $3.270.000.000   Pasivo $880.000.000 (incluye 2895VC-120505 $50M)
      Patrimonio $815.500.000  Utilidad neta −$2.500.000
      A − (P + K) = $1.574.500.000  → residual no explicado, bloqueante
2024: Activo $2.880.000.000   Pasivo $740.000.000   Patrimonio $388.000.000
      residual no explicado $1.752.000.000 (también bloqueante)
```

Ambos periodos quedan `periodoTipo = 'indeterminado'`: el CSV no declara la
fecha de corte (ver P4-c en `trial-balance.ts`).

### Cómo ejecutar

```bash
# Test E2E del Curator (5 cuadraturas + sanidad):
npx vitest run src/lib/preprocessing/__tests__/elite-pulido-diamante.test.ts

# Smoke del bloque vinculante (4 secciones LLM-facing):
npx vitest run src/lib/preprocessing/__tests__/elite-pulido-diamante-binding.test.ts

# Suite completa del Curator + binding:
npx vitest run src/lib/preprocessing/__tests__
```

## `devoluciones-4175/`

Cuatro balances mínimos que aíslan el cálculo de **ingresos netos de
devoluciones (PUC 4175 · NIIF 15 §47)**. Los consume
`__tests__/devoluciones-4175.test.ts`.

La 4175 es una cuenta **correctora**: naturaleza débito dentro de una clase 4 de
naturaleza crédito. Según cómo exporte el ERP llega con el signo contrario al de
los ingresos ordinarios (la clase 4 **ya viene neta**) o con el mismo signo (el
export perdió el débito y la clase 4 vale bruto + devoluciones). Por eso el motor
**no** puede restar las devoluciones a `|Σ clase 4|`: la base es
`|Σ de las cuentas ORDINARIAS de clase 4|`.

Los cuatro comparten el mismo esqueleto (Activo $400M = Pasivo $60M + Patrimonio
$340M, costos $200M, gastos $60M) y **todos deben producir ingresos netos de
$450.000.000** — ésa es la comparación que hace el test.

| Fixture | Forma del grupo 4175 | Σ clase 4 | `ingresosNetos` correcto | Lo que publicaba el código defectuoso |
|---|---|---|---|---|
| `natural.csv` | ordinarias +$500M, 4175 **+$50M** (misma polaridad) | $550M | **$450M** | $500M |
| `algebraica.csv` | archivo en partida doble literal (clases 2/3/4 negativas, 4175 en débito positivo); tras `normalizeSignConvention` queda ordinarias +$500M, 4175 −$50M | $450M (ya neto) | **$450M** | $400M — doble resta |
| `signos-mixtos.csv` | 4175 = −$55M, −$0,5M y **+$5,5M** (Σ firmada −$50M) | $450M (ya neto) | **$450M** | $389M — doble resta **+** `abs` por cuenta, que invierte la cuenta de saldo contrario e infla las devoluciones a $61M |
| `sin-devoluciones.csv` | sin cuentas 4175 (control) | $450M | **$450M** | $450M — idéntico |

`signos-mixtos.csv` reproduce a escala la forma del único balance de cliente real
del repo (`grupo-empresarial-2tres-sas.xlsx`), donde la `41750503` trae saldo
débito $494.568,88 dentro de un grupo que suma −$326.922.206,12.

> **Corregido (auditoría 2026-09).** En `natural.csv` la `360505` trae la
> utilidad verdadera ($190M = netos − costos − gastos) y el motor la publica:
> `netIncome` se deriva de `ingresosNetos` (no de `Σ clase 4`) y R12 usa la
> misma cifra para la utilidad transitoria. `devoluciones-4175.test.ts` y
> `recalculo-13-14-vigencia.test.ts` lo fijan.

### Cómo ejecutar

```bash
npx vitest run src/lib/preprocessing/__tests__/devoluciones-4175.test.ts
```
