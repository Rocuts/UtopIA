# FASE 0 — Medición antes de construir (2026-08-07)

Antes de diseñar el reconciliador determinista había que saber **cuánto desobedece el LLM hoy**.
La medición devolvió algo distinto de lo esperado: en los dos balances disponibles el pipeline
**nunca llega al LLM**. El gate lo rechaza antes, y en el único archivo de cliente real lo rechaza
por un defecto del preprocesador, no del modelo.

Herramienta: [`scripts/fase0-anchor-drift.ts`](../scripts/fase0-anchor-drift.ts) — corre el
pipeline NIIF completo (preprocess → `prepareFinancialContext` → `runNiifAnalyst` 3 pases con LLM
real) y cruza cada cifra ancla emitida contra `buildReportAnchors(preprocessed)` al centavo,
además de recoger las salvedades E1..E15.

Ejecutar:

```bash
FASE0_RUNS=3 npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.scripts.json \
  scripts/fase0-anchor-drift.ts
```

> `tsconfig.scripts.json` existe porque `scripts/` corre fuera del runtime de Next: aliasea el
> sentinel `server-only` al mismo stub que usa Vitest. Sin él, cualquier script que importe el
> orquestador financiero muere con `MODULE_NOT_FOUND`.

---

## Inventario real de balances (verificado, no asumido)

| Archivo | Qué es | Sirve para medir |
|---|---|---|
| `src/lib/preprocessing/__fixtures__/elite-pulido-diamante.csv` | Fixture sintético canónico | Sí, pero **descuadra en origen** |
| `src/lib/preprocessing/__fixtures__/grupo-empresarial-2tres-sas.xlsx` | Export ERP real (206 renglones, NIT 901.714.014-6) | Sí — es el único archivo de cliente real |
| `src/data/uploads/1777392615926_1._BALANCE_1_PRUEBA.xlsx` | **Duplicado** del anterior: mismos 206 renglones, mismos totales | No aporta caso nuevo |
| `src/data/uploads/1778520*_Reporte_Financiero_1mas1_*.xlsx` (6 archivos) | **Salidas** del pipeline, no balances de entrada | No — `parseTrialBalanceCSV` devuelve 0 filas |

**Balances reales distintos disponibles en el repo: uno.** Es el techo de lo que esta medición
puede afirmar; ver *Qué falta medir* al final.

---

## Hallazgo 1 (P0) — El preprocesador no normaliza la convención de signos

El export ERP real usa **una sola columna de saldo firmado** por período
(`Saldo inicial 2024`, `Saldo final 2025`), en convención algebraica: débitos positivos,
créditos negativos. Las clases de naturaleza crédito llegan en negativo:

```
Clase 1 Activo      2025 =  4.196.558.242,90
Clase 2 Pasivo      2025 = -1.968.104.173,17   ← negativo
Clase 3 Patrimonio  2025 =         42.720,00
Clase 4 Ingresos    2025 = -2.429.109.531,57   ← negativo
Clase 5 Gasto       2025 =    188.112.741,84
Clase 7 Costos      2025 =     12.500.000,00
```

`parseTrialBalanceCSV` sólo deriva el signo por naturaleza PUC cuando el archivo trae columnas
**débito y crédito separadas** ([`trial-balance.ts:793-796`](../src/lib/preprocessing/trial-balance.ts#L793-L796)).
Con una única columna firmada toma el valor al pie de la letra. Resultado, medido:

| | Sin normalizar | Con signos normalizados |
|---|---|---|
| Activo | 4.185.978.841,16 | 4.185.978.841,16 |
| **Pasivo** | **−1.958.169.419,86** | **1.962.538.849,62** |
| **Patrimonio** | **6.144.148.261,02** | **2.223.439.991,54** |
| **Ingresos** | **−2.429.109.531,57** | **2.429.109.531,57** |
| Residual que R8 absorbe en `3710VC` | **8.773.827.814,43** (210% del activo) | **−5.014.078,19** (0,12%) |

El balance **cierra** al normalizar. Sin normalizar no cierra por dos órdenes de magnitud, y lo
que absorbe la diferencia es la cuenta virtual del Cierre Virtual: la ecuación `A = P + K` vuelve
a cuadrar contra sí misma, así que **ninguna cuadratura del pipeline lo detecta**.

Por qué importa más que la deriva del LLM: `buildReportAnchors` devuelve esas cifras como
**anclas vinculantes**. Un reconciliador determinista que sobrescriba el output del modelo con
ellas no corrige el error — lo **cementa**, y encima le quita al modelo la única oportunidad que
hoy tiene de notar que el pasivo no puede ser negativo.

### Detector propuesto (validado sobre los dos fixtures)

En convención algebraica la suma de **todos** los saldos auxiliares es ~0 por partida doble.
En convención natural (magnitudes por naturaleza) esa suma vale `A + P + K + I + G + C`, del orden
del doble del activo. La separación medida es de tres órdenes de magnitud:

| Balance | Σ saldos auxiliares | Σ / Activo | Convención |
|---|---|---|---|
| elite-pulido-diamante 2024 | 5.508.000.000,00 | 191,25% | natural |
| elite-pulido-diamante 2025 | 5.040.500.000,00 | 156,54% | natural |
| grupo-2tres 2024 | −6.737.813,85 | **0,24%** | algebraica |
| grupo-2tres 2025 | −5.014.078,19 | **0,12%** | algebraica |

Regla: `|Σ auxiliares| / |Clase 1| < 5%` ⇒ convención algebraica ⇒ invertir el signo de las
clases 2, 3 y 4 antes de construir el snapshot.

---

## Hallazgo 2 (P1) — Ningún balance del repo atraviesa el gate

`prepareFinancialContext` lanza `BalanceValidationError` (→ 422) en **los dos** fixtures:

| Balance | Bloquea | Causa medida |
|---|---|---|
| elite-pulido-diamante | sí | Descuadra en origen: Activo 3.220M ≠ Pasivo 830M + Patrimonio 818M (brecha 1.572M). R8 absorbe 1.719,5M = 53% del activo. |
| grupo-empresarial-2tres | sí | Convención de signos (Hallazgo 1). R8 absorbe 210% del activo. |
| grupo-2tres con signos normalizados | **no** | Residual 0,12% < umbral del 1% ⇒ el *Bridge de Cuadratura* se activa. |

El bloqueo es **correcto** en ambos casos — los balances de verdad no cuadran. La consecuencia es
metodológica: **el fixture canónico del repo no puede producir un reporte por el camino real**, así
que ningún test que lo use está ejercitando el camino del cliente.

### Diagnóstico engañoso

El 422 muestra las cifras **pre-R8**, no las post-curator:

```
[2025] La ecuacion contable no cuadra: Activo (4.183.794.126,28) !=
       Pasivo (-1.960.354.134,74) + Patrimonio (42.720,00).
[2025] Total Patrimonio (42.720,00) < 1% del Activo.
```

El patrimonio post-curator es 6.144.148.261,02, no 42.720. Es el mismo patrón de *duplicación sin
sincronizar* que la auditoría integral identificó como causa raíz #3: `snapshot.validation` se
calcula en `buildSnapshotForPeriod` y nunca se recalcula después del curator.

### `centsAdjustment` no son centavos

[`r8-virtual-close.ts:211`](../src/lib/preprocessing/curator-rules/r8-virtual-close.ts#L211):

```ts
const centsAdjustment = residualGapBeforeCents;
```

Lleva el **residual completo**, no un ajuste de redondeo, y el texto que se le muestra al operador
dice `Ajuste de centavos: $8.773.827.814,43`. El *Bridge de Cuadratura* de
[`orchestrator.ts:263-274`](../src/lib/agents/financial/orchestrator.ts#L263-L274) compara ese
valor contra el 1% del activo, así que la política efectiva es "acepto un descuadre residual de
hasta el 1%" — defendible como política, pero no es lo que el nombre ni el mensaje dicen.

---

## Hallazgo 3 — Deriva del LLM

Medición sobre el balance real con signos normalizados, que es el único que atraviesa el gate.
Ver la tabla *Obediencia por campo ancla* en [`.fase0/REPORT.md`](../.fase0/REPORT.md), regenerable
con el comando de arriba.

---

## Qué falta medir

1. **Balances reales adicionales.** Con un solo archivo de cliente no se puede caracterizar la
   distribución de la deriva. Hacen falta 3-4 exports de ERP distintos — idealmente de ERPs
   distintos, porque la convención de signos varía entre ellos y es justo lo que rompió aquí.
2. **Deriva del Editor Jefe HTML.** El segundo salto de unidades (JSON → HTML, ~200 cifras
   re-tecleadas por un LLM) no está instrumentado en esta medición. Necesita su propio harness.
