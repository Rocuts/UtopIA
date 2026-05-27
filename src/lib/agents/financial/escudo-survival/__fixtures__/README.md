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

---

## Capa 1 Fiscal — Bloque Ancora F01-F10

Cuatro fixtures determinísticos de `FiscalAnchorBlock` para el módulo `fiscal-anchor/`.
Validator: `validators/fiscal-anchor-validators.ts` (L1 + L2 + L3 Elite Protocol).

### Fixtures Fiscal

| Fixture | Qué testea | Resultado esperado |
|---|---|---|
| `fiscal-anchor-grupo-2tres-sas.json` | Golden record Grupo 2 Tres SAS · NIT 901714014-6 · 2025. Cifras exactas del spec §5. F02 = round(F01×35%), F04 = F02−F03, F10 = round(F03/F02×100, 1d). | Cero errores, cero warnings con clase54 > 0 y markdownBlock correcto. |
| `fiscal-anchor-saldo-a-favor.json` | F04 < 0 (retenciones > impuesto). NIT dígito 0. Alerta SALDO_A_FAVOR presente. F10 = 142.9% → warning L2.3 doble conteo. | L1.6 pasa, L3.4 pasa, L2.3 falla con warning. |
| `fiscal-anchor-clase54-presente.json` | F09 = 35% (empresa con provisión). NIT dígito 9. clase54Cents > 0 → L3.1 pasa. | Cero errores con clase54 correcto. |
| `fiscal-anchor-f01-cero.json` | F01 = 0 (UAI nulo). División por cero → F10 = 0 sin excepción. F04 < 0 → alerta SALDO_A_FAVOR. | Sin explosión, L1.4 y L1.6 pasan. |

### Invariantes por fixture

**grupo-2tres-sas (golden record)**
- F02 = round(222849678973 × 35 / 100) = 77997387641 ✓
- F04 = 77997387641 − 4607340776 = 73390046865 ✓
- F10 = round(4607340776 / 77997387641 × 1000) / 10 = 5.9 ✓
- NIT "901714014-6" → dígito 6 → retefuente día 13 ∈ [8..17] ✓
- Renta jurídica 2025: 2026-04-14 ∈ [2026-04-09..2026-04-22] ✓

**Edge case documentado (MEMORY.md):** F08 ($105.537.824,41) < F05 ($106.813.252,05). Imposible si F08 = abs(Grupo 24) y F05 = abs(Cta.2408) ⊂ Grupo 24. Señala error de extracción en el balance fuente. L1.3 usa F06+F07 (no F05) para evitar falsos positivos y es `severity:'warning'`.

### Comando

```bash
npx vitest run src/lib/agents/financial/escudo-survival/__tests__/fiscal-anchor-validators.test.ts
```

### Stress tests cubiertos (Capa 1 Fiscal)

| Stress | Fixture | Qué verifica |
|---|---|---|
| L1 aritmética exacta | grupo-2tres-sas | F02/F04/F10 al centavo con Math.round(f01×35/100) |
| L2 coherencia negocio | saldo-a-favor | F10 > 100% → warning doble conteo |
| L3 defensa Art. 647 | grupo-2tres-sas + clase54=0 | clase54=0 sin alerta A5 → error Art. 647 |
| Estabilidad división/cero | f01-cero | F01=0 → F10=0 sin excepción |
| NIT calendario [8..17] | Test 5 (inline) | Los 10 dígitos posibles retefuente en rango |

---

## Notas de diseño

- Los JSON representan `PreprocessedBalance` pero omiten los campos `BigInt` (`cents`, `raw`) que JSON no puede serializar nativamente. El script de regression los ignora (campos opcionales en `ControlTotals`).
- El campo `primary` en algunos JSON tiene el placeholder `"__REFERENCE_TO_periods[0]__"` — el script de regression lo sustituye con `periods[0]` al construir el balance.
- Los mock reports en `run-validation.ts` simulan el output que los agentes LLM producirían para cada balance. Son determinísticos y no invocan ningún LLM.
- **Capa 3, check `tarifa_general_correcta`**: el regex busca `\b(3[12349]|2[0-9]|3[0-2])\s*%` — captura 31%, 32%, 33%, 34% y porcentajes en los 20s. Si el pipeline genera texto con porcentajes como "25.5% (benchmark)" puede disparar un falso positivo. En ese caso ajustar el regex en `survival-validators.ts::runLayer3` para excluir contextos de benchmark.
