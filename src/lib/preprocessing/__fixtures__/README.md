# Preprocessing Fixtures

Fixtures sintéticos para los tests del preprocesador y del Curator NIIF.

## `elite-pulido-diamante.csv`

Balance de prueba multiperiodo (2024 → 2025) diseñado para ejercitar **las 4
reglas mutadoras del Curator Pulido Diamante** en una sola pasada del
preprocesador. Lo consumen:

- `elite-pulido-diamante.test.ts` — 5 cuadraturas + sanidad del Curator (E2E).
- `elite-pulido-diamante-binding.test.ts` — smoke del bloque vinculante:
  verifica que el helper `renderSnapshotLines` del orquestador financiero
  emite las 4 secciones Curator (R1/R5/R6/R7) que el LLM consume como
  totales vinculantes.

### Activadores por regla

| Regla | Disparador en el fixture | Resultado esperado |
|-------|--------------------------|---------------------|
| **R1** — Saldos negativos en activos (muta) | `120505` (-$50M en 2025) e `159205` (-$130M en 2025), ambos materiales sobre `max(0.0001 × \|Activo\|, $50K)` — pero `159205` es CORRECTORA de activo (depreciación acumulada), y su saldo crédito ES su naturaleza | **1** reclasificación aplicada: cuenta virtual `2895VC-120505` ($50M) en Clase 2. La `159205` se queda en Clase 1 con signo negativo: NIC 16.73 / NIIF PYMES 17.31 exigen presentar el importe en libros NETO, y NIC 1.32 no aplica porque no hay compensación activo↔pasivo |
| **R5** — Anclaje patrimonial Balance↔ECP (muta) | `379505` (-$1.572B en 2025) crea brecha entre patrimonio crudo y ECP_sum | `convergenceAdjustment.gapCop = $1,572,000,000` exacto; `controlTotals.patrimonio` anclado a $2.390B (= ECP_sum) |
| **R6** — Cierre EFE↔Caja PUC 11 (muta) | EFE indirecto sobre las variaciones T-1→T no cuadra contra Δ saldo PUC 11 — gap pequeño (~$27.5M) absorbido por `varCuentasPorCobrar` ($130M de magnitud) **dentro del guardrail de plausibilidad al 50%** introducido por Ola D | `cashFlowClosureAdjustment` poblado; post-R6 `EFE.netChangeInCash == observedChangeInCash == $150M` al centavo; `controlTotals.cashClose / cashOpen` poblados |
| **R7** — Costo presunto (no muta) | Margen bruto $85M ingresos vs $12.5M COGS = 85.29% (>85%) Y inventario $1.67B > 50% × $85M ingresos | `presumedCostWarning` con severidad alta y mensaje listo para el callout |

### Diseño matemático (post Ola D — guardrail R6 al 50%)

El fixture está calibrado para que **las 5 cuadraturas pasen al centavo en
2025** post-Curator y para que el **gap del EFE indirecto sea suficientemente
pequeño** como para ser absorbido dentro del guardrail de plausibilidad al
50% que Ola D introdujo en `r6-cashflow-closure.ts`:

```
Activo_post_R1   = $3,270,000,000   (suma Class 1 sin los negativos materiales que NO son correctoras)
Pasivo_post_R1   = $880,000,000     (Pasivo crudo $830M + virtual 2895VC-120505 por $50M)
Patrimonio_post_R5 = $2,390,000,000 (ECP_sum: capital + reserva + utilidad + utilidades acumuladas)
                                    = $1,865M + $100M + $145M + $280M
Activo - (Pasivo + Patrimonio) = 3,270M - 880M - 2,390M = $0
```

> **Corregido 2026-08.** Estas cifras decían $3.400M / $1.010M, que era el resultado del defecto
> `r1-reclasifica-cuentas-correctoras`: R1 trataba la 1592 (depreciación acumulada) como anomalía y
> la movía a Clase 2, inflando Activo y Pasivo en $130M cada uno y presentando PPE bruto. La
> ecuación seguía cerrando, así que ninguna cuadratura lo atrapaba — y este README documentaba el
> resultado defectuoso como ESPERADO, de modo que corregir el bug ponía el test en rojo. Con
> `isContraAsset` en `r1-negative-assets.ts` sólo se reclasifica la 120505 (inversión con saldo
> crédito, $50M), que sí es una anomalía real.

### Re-calibración Ola D (2026-05-08)

El guardrail `|gap| ≤ 0.5 × |bucket|` introducido por Ola D en R6 hizo que el
fixture original (con gap del EFE ~$922M contra buckets operativos de
$50–170M) fallara la Aserción 3 — porque ningún bucket clásico pasaba el
guardrail y R6 emitía un finding `crítico` sin mutar.

Para mantener las 5 cuadraturas pasando con el guardrail activo, se hicieron
**dos cambios quirúrgicos en saldos 2024**:

1. `379505` (Ajuste pendiente periodo anterior) **2024**: `$0` → `-$1,572,000,000`.
   Razón: con `Δ379505 = 0` entre 2024→2025, R2 ya no interpreta el gap de
   patrimonio como "dividendo / reducción de capital" inexistente. El gap de
   R5 sigue siendo $1.572M en 2025 (no se toca).
2. `310505` (Capital autorizado) **2024**: `$1,000,000,000` → `$1,530,000,000`.
   Razón: ajusta `ΔCapital` para que el `netChangeInCash` calculado por R2
   converja cerca del `+$150M` observado en caja, dejando un gap residual
   pequeño ($27.5M) que `varCuentasPorCobrar` ($130M) absorbe holgadamente
   al 50% (tope $65M). La empresa pasa de capital $1.530M en 2024 a $1.865M
   en 2025 — ampliación intra-año totalmente plausible para una PYME.

**Lo que NO se tocó** (es la "huella" original que dispara cada regla):

- `120505` 2025 = -$50M → dispara R1.
- `159205` 2025 = -$130M → dispara R1.
- `379505` 2025 = -$1.572M → dispara R5 (con gap exacto).
- `413505` 2025 = $85M ingresos, `613505` 2025 = $12.5M COGS, `143505` 2025 = $1.67M inventario → dispara R7.
- Caja 2024 = $250M (50+200), Caja 2025 = $400M (80+320) → `observedChangeInCash = +$150M`.

La ecuación 2024 NO cuadra (≈ $1.8B de descuadre) — eso es esperado: el
fixture solo garantiza la cuadratura post-Curator del periodo primario
(2025), y los descuadres 2024 quedan registrados como `discrepancies` sin
generar errores. La aserción "Sanidad" del test verifica únicamente
`result.primary.curator.errors`.

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

> **Riesgo residual conocido.** En `natural.csv` la `360505` trae la utilidad
> **verdadera** ($190M = netos − costos − gastos). El motor publica `utilidadNeta`
> $290M porque `netIncome` se deriva de `Σ clase 4`, no de `ingresosNetos` —
> desfase de exactamente 2 × devoluciones. Es el corolario pendiente descrito en
> `docs/AUDITORIA_CALCULOS_2026-08.md`; el test lo afirma explícitamente para que
> se ponga rojo cuando se corrija.

### Cómo ejecutar

```bash
npx vitest run src/lib/preprocessing/__tests__/devoluciones-4175.test.ts
```
