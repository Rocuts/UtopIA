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
| **R1** — Saldos negativos en activos (muta) | `120505` (-$50M en 2025) e `159205` (-$130M en 2025) — ambos materiales sobre `max(0.0001 × |Activo|, $50K)` | 2 reclasificaciones aplicadas con `applied: true`; cuentas virtuales `2810ZZ-120505` ($50M) y `2810ZZ-159205` ($130M) inyectadas en Clase 2 |
| **R5** — Anclaje patrimonial Balance↔ECP (muta) | `379505` (-$1.572B en 2025) crea brecha entre patrimonio crudo y ECP_sum | `convergenceAdjustment.gapCop = $1,572,000,000` exacto; `controlTotals.patrimonio` anclado a $2.390B (= ECP_sum) |
| **R6** — Cierre EFE↔Caja PUC 11 (muta) | EFE indirecto sobre las variaciones T-1→T no cuadra contra Δ saldo PUC 11 — gap pequeño (~$27.5M) absorbido por `varCuentasPorCobrar` ($130M de magnitud) **dentro del guardrail de plausibilidad al 50%** introducido por Ola D | `cashFlowClosureAdjustment` poblado; post-R6 `EFE.netChangeInCash == observedChangeInCash == $150M` al centavo; `controlTotals.cashClose / cashOpen` poblados |
| **R7** — Costo presunto (no muta) | Margen bruto $85M ingresos vs $12.5M COGS = 85.29% (>85%) Y inventario $1.67B > 50% × $85M ingresos | `presumedCostWarning` con severidad alta y mensaje listo para el callout |

### Diseño matemático (post Ola D — guardrail R6 al 50%)

El fixture está calibrado para que **las 5 cuadraturas pasen al centavo en
2025** post-Curator y para que el **gap del EFE indirecto sea suficientemente
pequeño** como para ser absorbido dentro del guardrail de plausibilidad al
50% que Ola D introdujo en `r6-cashflow-closure.ts`:

```
Activo_post_R1   = $3,400,000,000   (suma Class 1 sin negativos materiales)
Pasivo_post_R1   = $1,010,000,000   (Pasivo crudo $830M + virtuales 2810ZZ-* por $180M)
Patrimonio_post_R5 = $2,390,000,000 (ECP_sum: capital + reserva + utilidad + utilidades acumuladas)
                                    = $1,865M + $100M + $145M + $280M
Activo - (Pasivo + Patrimonio) = 3,400M - 1,010M - 2,390M = $0
```

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
