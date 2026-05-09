# Fixtures — Modo Supervivencia Élite

Cinco fixtures determinísticos de `PreprocessedBalance` + script de regression para el validator Elite Protocol.

## Cómo ejecutar

```bash
npx tsx src/lib/agents/financial/escudo-survival/__fixtures__/run-validation.ts
```

## Fixtures

| Fixture | Qué testea | Resultado esperado |
|---|---|---|
| `balance-pyme-tet-alta.json` | TET = 35% (nivelAlerta rojo). Capa 2 debe exigir sugerenciasOptimizacion con alta/media factibilidad. Capa 1 valida ratio impuesto/uai. | `ok: true`, `tet_alta_genera_optimizaciones: passed` |
| `balance-pyme-saldo-favor.json` | 1355 = $50M > impuesto $30M → saldo a favor $20M. Capa 2 exige acciones (compensación / devolución). Capa 1 valida suma auxiliares 135505 + 135510. | `ok: true`, `saldo_favor_genera_acciones: passed` |
| `balance-pyme-bancarizacion-violada.json` | 3 pagos en efectivo > 100 UVT (tope 2026 = $5.237.400). Capa 2 exige listado en `pagosNoDeduciblesIndividuales[]` con norma `Art. 771-5 §2 E.T.`. Capa 1 valida que mayor impuesto = 35% × total no deducible. | `ok: true`, `bancarizacion_violada_listada: passed` |
| `balance-pyme-elite-clean.json` | Balance ideal: TET 20.56%, sin saldo a favor, sin pagos en efectivo problemáticos, reserva = exactamente 10% utilidad neta. Todas las capas deben pasar. | `ok: true`, `errors: []`, `warnings: []` |
| `balance-pyme-art647-trap.json` | Balance correcto pero el report simulado cita `Art. 130 E.T.` sin marcarlo como derogado (derogado por Ley 1819/2016 art. 376). Capa 3 detecta la trampa. | `ok: false`, `descuentos_no_norma_derogada: failed` |

## Stress tests cubiertos

| Stress | Cubierto por fixture | Qué verifica |
|---|---|---|
| A — Auxiliares vs Resumen | Todos (todos los fixtures tienen `auxiliaryTotal` = suma de auxiliares postables) | Que `cls.auxiliaryTotal == cls.reportedTotal` dentro de $1 |
| B — Coherencia Caja vs Utilidad | `elite-clean` (caja $45M, utilidad $85M → ratio 1.9×, ok); `tet-alta` (caja $20M, utilidad $70M → ratio 3.5×, warning) | Ratio utilidad/caja ≤ 3.15× |
| C — Defensa Art. 647 adversarial | `art647-trap` (falla por Art. 130 sin derogado); resto pasa | Recomendaciones sin norma + normas derogadas sin disclaimer |

## Notas de diseño

- Los JSON representan `PreprocessedBalance` pero omiten los campos `BigInt` (`cents`, `raw`) que JSON no puede serializar nativamente. El script de regression los ignora (campos opcionales en `ControlTotals`).
- El campo `primary` en algunos JSON tiene el placeholder `"__REFERENCE_TO_periods[0]__"` — el script de regression lo sustituye con `periods[0]` al construir el balance.
- Los mock reports en `run-validation.ts` simulan el output que los agentes LLM producirían para cada balance. Son determinísticos y no invocan ningún LLM.
- **Capa 3, check `tarifa_general_correcta`**: el regex busca `\b(3[12349]|2[0-9]|3[0-2])\s*%` — captura 31%, 32%, 33%, 34% y porcentajes en los 20s. Si el pipeline genera texto con porcentajes como "25.5% (benchmark)" puede disparar un falso positivo. En ese caso ajustar el regex en `survival-validators.ts::runLayer3` para excluir contextos de benchmark.
