# Anexo — inventario cifra por cifra y hallazgos completos

Generado desde los resultados estructurados de los 8 auditores y los 18 escépticos de la ola
`utopia-auditoria-calculos` (27 agentes Opus, effort max, 2026-08-08). No es un resumen escrito a
mano: cada fila viene del reporte del agente que la midió.

## Conteo del escrutinio adversarial

| Veredicto del escéptico | Cantidad |
|---|---|
| CONFIRMADO | 9 |
| PARCIAL | 9 |

Total de hallazgos P0 sometidos a refutación: **18**. Refutados: **0**.


---

## Estado de Resultados (P&G)

**Veredicto:** `sin-garantia`

### Resumen del auditor

De los cinco subtotales del P&G, exactamente UNO está garantizado: la Utilidad Neta (primaria y comparativa), anclada por E14/E9 con call-site real y por `reconcileAnchors`, que además alimenta el bloqueo de descarga. Utilidad Bruta, EBIT y sus dos comparativos son LIBRES: los autora el LLM y ninguna regla los cruza contra fuente determinista. Lo verifiqué ejecutando: inflar `grossProfitPrimary` en $500.000.000 sobre el balance del cliente real produce 0 errores, 0 warnings nuevos, `reconciliation.clean = true`, descarga habilitada, y la cifra se reimprime tal cual en Markdown, PDF Élite, Excel y HTML.

Los RENGLONES del P&G están descubiertos por completo. El desglose determinista que se acaba de construir cubre sólo clases 1/2/3 (`deterministic-breakdown.ts:98-102`) y E15 sólo recorre assets/liabilities/equity (`niif-json-validator.ts:671-675`). Vaciar `incomeStatement.lines` entero deja el Estado de Resultados con sus cuatro totales y CERO líneas debajo: 0 errores, 0 warnings. Es exactamente el fallo que motivó la sesión anterior en el Balance, reproducido en el P&G sin ninguna protección.

Buena noticia medida, no inferida: en las tres corridas con LLM real de FASE 0 el modelo cumple la cascada al centavo. `grossProfit = Clase4 − Clase6 − Clase7`, `EBIT = grossProfit − G51 − G52`, `netIncome = (EBIT − G53) − G54`, y la suma de renglones con signo por clase PUC da exactamente `netIncomePrimary` — 3/3 idéntico. El modelo hace bien la aritmética; el sistema simplemente no lo comprueba.

La mala: hay una cifra DETERMINISTA que está mal. `ingresosNetos` resta las devoluciones 4175 dos veces cuando el archivo viene en convención algebraica —que es el caso del único balance de cliente real del repo—: $327.911.343,88 de subestimación (13,5% de los ingresos). Arrastra a `controlTotals.ebit` y de ahí a A07/A09/X01 del Áncora y a margen operativo, margen neto, rotación de activos y días de cartera. Resultado medido: el mismo informe muestra Utilidad Bruta $2.416.609.531,57 en el P&G y $2.088.698.187,69 en el Áncora. Y en convención natural el error se invierte y contamina la Utilidad Neta, que es el ancla dura: fixture sintético con ventas $1.000M y devoluciones $100M produce utilidadNeta $450.000.000 cuando la real es $250.000.000.

El impuesto de renta del periodo lo autora el LLM sin ningún contraste. El preprocesador SÍ calcula `impuestoCausado` y `utilidadAntesImpuestos` en centavos exactos, el orchestrator SÍ los pasa al validador (`orchestrator.ts:1591-1594`)… y el validador nunca los lee: `anchorCheck` sólo se invoca para TotalAssets, TotalLiabilities, TotalEquity y NetIncome. Una línea de impuesto de $700.000.000 inventada, o de −$700.000.000 (impuesto presentado como ingreso), pasan las dos con 0 errores.

Sobre normativa: la tarifa del 35% (Art. 240 E.T.) que usan `RENTA_NOMINAL_RATE`, `build-ancora.ts` F02 y el prompt es CORRECTA hoy para el año gravable 2026, y la TMT del 15% del parágrafo 6 sigue vigente. Verificado contra fuente, no de memoria.

### Inventario cifra por cifra

| Cifra | Estado | Productor | Validador |
|---|---|---|---|
| netIncomePrimary (Utilidad Neta del periodo) | ANCLADA | `src/lib/agents/financial/agents/niif-analyst.ts:214 (Pass-1, BalanceAndPnlSubSchema) — fuente determinista: src/lib/preprocessing/trial-balance.ts:1370` | src/lib/agents/financial/validators/niif-json-validator.ts:173 (E14, tolerancia $0) — CORRE en producción vía src/lib/agents/financial/orchestrator.ts:1598. Además src/lib/agents/financial/agents/reconcile-anchors.ts:190 la detecta (write:null, no sobrescribe) y alimenta reconciliation.clean → bloqu |
| netIncomeComparative | ANCLADA | `src/lib/agents/financial/agents/niif-analyst.ts:214` | src/lib/agents/financial/validators/niif-json-validator.ts:501 (E9 crossCheck) — CORRE: buildComparativeAnchorsForValidator (orchestrator.ts:186) sí emite netIncome |
| grossProfitPrimary (Utilidad Bruta) | **LIBRE** | `src/lib/agents/financial/agents/niif-analyst.ts:214 (schema: contracts/niif-report.ts:214)` | NINGUNO. E14 (niif-json-validator.ts:152-173) no incluye grossProfit. E5 (:248) sólo compara magnitudes gross vs op y emite warning |
| operatingProfitPrimary (EBIT) | **LIBRE** | `src/lib/agents/financial/agents/niif-analyst.ts:214 (schema: contracts/niif-report.ts:216)` | src/lib/agents/financial/validators/niif-json-validator.ts:260-273 (E5) — CORRE pero es heurístico: sólo error duro si \|op − net\| < $1.000 y \|net\| > $1.000.000. NO verifica EBIT = grossProfit − G51 − G52 |
| grossProfitComparative | **LIBRE** | `src/lib/agents/financial/agents/niif-analyst.ts:214` | src/lib/agents/financial/validators/niif-json-validator.ts:499 (E9 crossCheck) — NO CORRE: buildComparativeAnchorsForValidator (orchestrator.ts:163-187) documenta explícitamente que no emite grossProfit; el crossCheck hace `if (expected === undefined) return` |
| operatingProfitComparative | **LIBRE** | `src/lib/agents/financial/agents/niif-analyst.ts:214` | src/lib/agents/financial/validators/niif-json-validator.ts:500 (E9 crossCheck) — NO CORRE, misma causa |
| incomeStatement.lines[] (todos los renglones del P&G) | **LIBRE** | `src/lib/agents/financial/agents/niif-analyst.ts:214 (schema: contracts/niif-report.ts:213)` | NINGUNO. E15 (niif-json-validator.ts:671-675) itera sólo Activo/Pasivo/Patrimonio. reconcile-anchors.ts:322-326 (lineGaps) idem. contracts/deterministic-breakdown.ts:98-102 sólo mapea clases 1/2/3 |
| Línea de impuesto de renta del periodo (cuenta 54 en el P&G) | **LIBRE** | `src/lib/agents/financial/agents/niif-analyst.ts:214 — el LLM la autora como renglón; regla en prompts/niif-analyst.prompt.ts:910-914` | NINGUNO. Las anclas `impuestoCausado` y `utilidadAntesImpuestos` se calculan (trial-balance.ts:1417/1423), se pasan (orchestrator.ts:1591-1594) y el validador NUNCA las lee: anchorCheck sólo se invoca 4 veces (niif-json-validator.ts:170-173) |
| oriPrimary / oriComparative (Otro Resultado Integral) | ANCLADA | `src/lib/agents/financial/agents/niif-analyst.ts:214` | src/lib/agents/financial/validators/niif-json-validator.ts:281 (E6, warning) contra Δ ORI del ECP — CORRE; :632 (E13) sólo si presentationV3.oriComponents.length > 0 |
| controlTotals.ingresos (Clase 4) | **DETERMINISTA** | `src/lib/preprocessing/trial-balance.ts:1366` | — |
| controlTotals.totalDevoluciones (4175) | **DETERMINISTA** | `src/lib/preprocessing/trial-balance.ts:1461-1471` | — |
| controlTotals.ingresosNetos | **DETERMINISTA** | `src/lib/preprocessing/trial-balance.ts:1473` | — |
| controlTotals.ebit (EBIT determinista) | **DETERMINISTA** | `src/lib/preprocessing/trial-balance.ts:1484` | — |
| controlTotals.utilidadAntesImpuestos (UAI) | **DETERMINISTA** | `src/lib/preprocessing/trial-balance.ts:1423` | src/lib/agents/financial/validators/niif-json-validator.ts:118 declara el campo `bindingPrimaryTotalsCents.utilidadAntesImpuestos` y NUNCA lo lee — ancla muerta |
| controlTotals.impuestoCausado (grupo 54) | **DETERMINISTA** | `src/lib/preprocessing/trial-balance.ts:1417` | src/lib/agents/financial/validators/niif-json-validator.ts:119 declara `bindingPrimaryTotalsCents.impuestoCausado` y NUNCA lo lee — ancla muerta |
| Áncora A07 Ingresos / A09 EBIT / X01 Ganancia Bruta | **DETERMINISTA** | `src/lib/agents/financial/ancora/build-ancora.ts:100, :110, :117` | — |
| Áncora F02 (impuesto referencial 35% sobre UAI) | **DETERMINISTA** | `src/lib/agents/financial/ancora/build-ancora.ts:184 (`uai * 0.35`); constante gemela en src/lib/preprocessing/curator-rules/types.ts:190 (RENTA_NOMINAL_RATE)` | — |
| CUR-R4 taxProvisionRisk (brecha de provisión de renta) | **DETERMINISTA** | `src/lib/preprocessing/curator-rules/r4-tax-provision-sufficiency.ts:29` | — (es él mismo un control). El objeto `taxProvisionRisk` no tiene NINGÚN consumidor fuera de tests; el finding CUR-R4 sí llega al pilar Verdad (src/lib/pillars/verdad-bars.ts:74) pero no al P&G ni al informe |

Reparto: **9** deterministas · **3** ancladas · **6** libres.

### Hallazgos

#### P0 · PYG-01 — Doble resta de devoluciones 4175: `ingresosNetos` y `ebit` están mal en el único balance de cliente real

**Dónde:** `src/lib/preprocessing/trial-balance.ts:1461-1484`  
**Verificado ejecutando:** sí

**Escenario medido:**

Balance real `src/lib/preprocessing/__fixtures__/grupo-empresarial-2tres-sas.xlsx`, periodo 2025 (convención algebraica → `normalizeSignConvention` niega la clase 4). Las tres cuentas 4175 quedan sumando −$326.922.206,12 DENTRO de la Clase 4, así que `totalRevenue` = $2.429.109.531,57 YA está neto. Entonces `ingresosNetos = |2.429.109.531,57| − Σ|4175| = 2.429.109.531,57 − 327.911.343,88 = $2.101.198.187,69`: las devoluciones se restan dos veces. Consecuencias medidas: `controlTotals.ebit` = $1.916.725.454,27 frente al EBIT del P&G $2.244.636.798,15; Áncora A07 $2.101.198.187,69, A09 $1.916.725.454,27, X01 $2.088.698.187,69 — todas $327.911.343,88 (13,5%) por debajo del Estado de Resultados del MISMO informe. margenOperativo, margenNeto, rotacionActivos y diasCartera usan ese denominador y salen inflados. Extra: `totalDevoluciones` usa Σ|saldo| por cuenta, así que la 41750503 'Devolución en descuentos' con saldo crédito +$494.568,88 se resta en vez de sumarse → $989.137,76 de error adicional. Caso espejo verificado con fixture sintético en convención NATURAL (ventas 413550 $1.000.000.000 + devoluciones 417505 $100.000.000 positivas): Clase 4 = $1.100.000.000 = bruto + devoluciones, `ingresosNetos` = $1.000.000.000 (correcto) pero `utilidadNeta` = $450.000.000 cuando la real es $250.000.000 — es decir, en convención natural el error contamina el ANCLA DURA del informe en $200.000.000 (2× las devoluciones). El código hace lo mismo en las dos convenciones, así que una de las dos siempre está mal.

**Corrección:**

Derivar la posición de 4175 de la convención detectada, que `normalizeSignConvention` ya conoce: (a) exponer `SignConventionDetection` en el snapshot; (b) si es ALGEBRAICA, `ingresosBruto = Σ(Clase4) + |Σ 4175 neto|` e `ingresosNetos = Σ(Clase4)`; si es NATURAL, `ingresosBruto = Σ(Clase4) − Σ(4175)` e `ingresosNetos = ingresosBruto − Σ(4175)`. (c) `totalDevoluciones` debe ser el NETO firmado del grupo 4175, no Σ de valores absolutos por cuenta. (d) Recalcular `utilidadAntesImpuestos`, `utilidadNeta` y `netIncome` sobre el ingreso neto en ambas ramas, no sobre `getClassTotal(4)` crudo. (e) Añadir al corpus patológico dos fixtures con 4175 —uno natural, uno algebraico— con aserciones incondicionales: hoy NINGÚN fixture CSV del repo contiene 4175, y el único archivo que ejercita la ruta es el balance del cliente.

**Normativa:** NIIF 15 §47 y NIIF para PYMES §23.5 exigen presentar los ingresos netos de devoluciones, descuentos y rebajas. PUC Decreto 2650/1993, grupo 4175 'Devoluciones en ventas', naturaleza débito. No requirió consulta externa: la norma no cambió y el defecto es aritmético.

#### P0 · PYG-02 — Utilidad Bruta y EBIT del periodo primario no se cruzan contra ninguna fuente determinista

**Dónde:** `src/lib/agents/financial/validators/niif-json-validator.ts:152-173`  
**Verificado ejecutando:** sí

**Escenario medido:**

Partiendo del output real del LLM sobre el balance de cliente (.fase0/raw-grupo-2tres-signos-ok-run1.json) y llamando a `validateNiifReportJson` con EXACTAMENTE el juego de opciones que pasa producción (orchestrator.ts:1598): mutar `grossProfitPrimary` de $2.416.609.531,57 a $2.916.609.531,57 (+$500.000.000) devuelve 0 errores y 0 warnings nuevos — sólo los dos E15 del Balance que ya estaban. `reconciliation.clean` permanece true, el informe NO se sella como CON SALVEDADES, la descarga NO se bloquea (PipelineWorkspace.tsx:1158-1160 sólo mira `reconciliation.clean`), y la cifra falsa se reimprime en el Markdown (renderer.ts:366), en el PDF Élite (compose-statements-from-json.ts:220), en el Excel (excel-export.ts:725) y como binding figure del HTML (contracts/html-editor.ts:307) — donde `reconcileBindingFigures` la vuelve obligatoria, convirtiendo una cifra no verificada en un requisito de fidelidad. `bindingPrimaryTotalsCents` (E14) sólo cubre TotalAssets, TotalLiabilities, TotalEquity y NetIncome.

**Corrección:**

Añadir `grossProfit` y `operatingProfit` a `AnchorKey`/`buildPeriodAnchors` (contracts/anchors.ts:33-43) calculados por el preprocesador —después de arreglar PYG-01, porque hoy `controlTotals.ebit` es la cifra incorrecta— y cruzarlos en E14 con tolerancia $0, igual que los otros cuatro. Añadirlos también a `PRIMARY_BINDINGS` de reconcile-anchors.ts:163-205 con `write` habilitado: a diferencia de netIncome, sobrescribir la Utilidad Bruta y el EBIT no rompe ninguna identidad cruzada del ECP ni del EFE.

#### P0 · PYG-03 — Los renglones del Estado de Resultados no tienen invariante: E15 y el desglose determinista sólo cubren el Balance

**Dónde:** `src/lib/agents/financial/validators/niif-json-validator.ts:671-675`  
**Verificado ejecutando:** sí

**Escenario medido:**

Mismo arranque (output real del LLM + opciones de producción). Caso A: vaciar `incomeStatement.lines = []` → 0 errores, 0 warnings nuevos; el Estado de Resultados sale impreso con UTILIDAD BRUTA $2.416.609.531,57, EBIT $2.244.636.798,15 y UTILIDAD NETA $2.228.496.789,73 y CERO renglones debajo — exactamente el fallo que la sesión anterior midió en el Balance (Pasivo con dos encabezados y ningún renglón) y que motivó `deterministic-breakdown.ts`. Caso B: triplicar el renglón de ingresos (de $2.429.109.531,57 a $7.287.328.594,71) → 0 errores; los renglones dejan de sumar la utilidad neta impresa y nadie lo dice. Causa: E15 itera un array literal de tres tuplas [Activo, Pasivo, Patrimonio] (:671-675); `reconcileAnchors` construye `statements` igual (reconcile-anchors.ts:322-326); y `CLASS_BY_SECTION` de deterministic-breakdown.ts:98-102 sólo mapea assets→1, liabilities→2, equity→3. Contraste medido: en 3/3 corridas reales el modelo SÍ emitió renglones correctos —Σ con signo por clase PUC = $2.228.496.789,73 = netIncomePrimary al centavo, y cada renglón idéntico al total del grupo PUC del preprocesador (Clase 4 $2.429.109.531,57; Clase 7 $12.500.000,00; G51 $166.541.334,10; G52 $5.431.399,32; G53 $16.140.008,42; G54 $0,00)—, así que hoy funciona por comportamiento del modelo, no por control.

**Corrección:**

Dos piezas simétricas a lo que ya existe para el Balance. (1) Un E16 en el validador: Σ de los renglones de `incomeStatement.lines` con `account` no nulo, FIRMADA por clase PUC (clase 4 suma, clases 5/6/7 restan, en valor absoluto porque `isAbsolute` viaja en true), debe igualar `netIncomePrimary`; y los subtotales declarados deben coincidir con los cortes de esa misma suma. El helper de suma va en `contracts/statement-lines.ts` junto a `sumStatementDetail`, con una variante `sumIncomeStatementDetail` que aplique el signo por clase. (2) Extender `buildDeterministicBreakdown` a una sección `income` que agrupe las clases 4/5/6/7 por grupo PUC y cablearla en `completeBreakdownFromSnapshot` (reconcile-anchors.ts:473) — la aritmética del P&G es tan proyección del balance de prueba como la del Balance. Y meter el gap del P&G en `lineGaps` para que alimente el sello y el bloqueo de descarga.

#### P1 · PYG-04 — E8 (anti-duplicación Grupo 53) es un validador vivo sin call-site en producción

**Dónde:** `src/lib/agents/financial/orchestrator.ts:1598`  
**Verificado ejecutando:** sí

**Escenario medido:**

El único call-site de `validateNiifReportJson` en producción pasa `bindingComparativeTotalsCents`, `bindingPrimaryTotalsCents` y `presentationV3`. NO pasa `totalExpensesClass5Cents`, y E8 hace `if (options.totalExpensesClass5Cents !== undefined)` (niif-json-validator.ts:426) — nunca entra. Medido sobre el balance real: añadiendo a `incomeStatement.lines` el total del Grupo 53 ($16.140.008,42) MÁS las subcuentas 5305 ($4.102.683,25) y 5395 ($12.019.350,12) —el patrón exacto que el prompt prohíbe en niif-analyst.prompt.ts:879—, con las opciones de producción el resultado es 0 errores. Pasando `totalExpensesClass5Cents = 18811274184`, la MISMA entrada dispara: «E8. Σ líneas Clase 5 en incomeStatement ($204.234.775,21) excede total preprocesado ($188.112.741,84) en más de tolerancia ($1.882.127,41)». Es decir, el gasto duplicado de $16.122.033,37 lo detecta un validador que existe, funciona y nadie llama. La anti-duplicación del Grupo 53 vive HOY sólo en el prompt. Nota adicional del mismo call-site: `cashAnchorCents` se calcula en :1571-1577 y se descarta con `void` — E3 tampoco corre (fuera de mi superficie, pero es el mismo defecto).

**Corrección:**

En orchestrator.ts:1598 añadir `totalExpensesClass5Cents: centsOrUndefined(<Σ hojas Clase 5 del snapshot primario>)`. La Clase 5 ya está en `context.preprocessed.primary.classes`; conviene exponerla como ancla en `contracts/anchors.ts` (`gastosClase5`) para que el cálculo no se duplique en el orchestrator. De paso, cablear `cashAccountPuc11Cents` con `primaryAnchors.cents.efectivoCuenta11` en vez de `void`earlo.

#### P1 · PYG-05 — E5 no verifica la identidad de la cascada que su propio comentario declara

**Dónde:** `src/lib/agents/financial/validators/niif-json-validator.ts:235-273`  
**Verificado ejecutando:** sí

**Escenario medido:**

El comentario de E5 y el prompt (niif-analyst.prompt.ts:805-807) declaran «EBIT = grossProfit − Grupo 51 − Grupo 52; el Grupo 53 se deduce DESPUÉS». E5 no comprueba esa identidad: sólo compara magnitudes. Su único error duro exige |op − net| < $1.000 Y |net| > $1.000.000. Medido: emitir `operatingProfitPrimary` = UAI = $2.328.496.789,73 (es decir, deduciendo el Grupo 53 dentro del EBIT) con un impuesto material de $100.000.000 que deja `netIncomePrimary` = $2.228.496.789,73 → 0 errores y 0 warnings, porque op − net = $100.000.000 > $1.000. El P&G queda estructuralmente mal —UAI desaparece como subtotal y el EBIT publicado incluye gasto no operacional— y el sistema no dice nada. La rama que sí funciona es la degenerada: igualar op a net exactamente sí dispara el error. Y cuando dispara, el error viaja como evento SSE `warning` (orchestrator.ts:1604-1610): el cliente SÍ lo muestra desde la auditoría anterior (PipelineWorkspace.tsx:2055 `collectWarnings` → banner de salvedades en :3014), pero NO alimenta `reconciliation.clean`, así que el informe no se sella y la descarga sigue habilitada.

**Corrección:**

Sustituir la heurística por la identidad, que es computable con los datos que ya existen: con `grossProfit`, `operatingProfit` y los grupos 51/52/53/54 del preprocesador, verificar al centavo `operatingProfit = grossProfit − G51 − G52` y `netIncome = operatingProfit − G53 − G54`. Requiere pasar los totales de grupo como opciones del validador (mismo mecanismo que `totalExpensesClass5Cents`). Y decidir explícitamente si un error del validador JSON debe poner `reconciliation.clean = false`: hoy el gate de descarga ignora E1..E15 por completo.

#### P1 · PYG-06 — El impuesto de renta del periodo lo autora el LLM y sus dos anclas deterministas están declaradas pero no se leen

**Dónde:** `src/lib/agents/financial/validators/niif-json-validator.ts:113-120 y :152-173`  
**Verificado ejecutando:** sí

**Escenario medido:**

`NiifJsonValidatorOptions.bindingPrimaryTotalsCents` declara `utilidadAntesImpuestos` e `impuestoCausado` (:118-119); el orchestrator los calcula y los pasa (:1591-1594); `anchorCheck` sólo se invoca cuatro veces —TotalAssets, TotalLiabilities, TotalEquity, NetIncome (:170-173)—, así que ambos se ignoran. Además `IncomeStatementSchema` (contracts/niif-report.ts:212-229) no tiene campo para UAI ni para el impuesto: sólo existen como renglones libres. Medido sobre el output real del LLM: (a) cambiar la línea de la cuenta 54 de $0,00 a $700.000.000 → 0 errores; (b) ponerla en −$700.000.000, es decir el impuesto presentado como INGRESO → 0 errores. V13 de audit-report-emittable.ts:328 sí vigila el signo, pero mira `cents.impuestoCausado` del preprocesador, no la línea que el modelo imprimió. Contexto del caso real: el balance del cliente tiene Clase 54 = $0,00 sobre una UAI de $2.228.496.789,73, y el informe publica «(-) Gasto por impuesto de renta y complementarios ... $0» con una Utilidad Neta que es en realidad pre-impuesto. El control determinista que sí detecta esto —CUR-R4, que calcula una brecha crítica de $674.436.052 (provisión en 24xx $105.537.824,41 frente a la teórica al 35% $779.973.876,41)— llega al pilar Verdad pero no al P&G, y el objeto `taxProvisionRisk` no tiene ningún consumidor en `src/` fuera de tests. V11 tampoco bloquea: sólo dispara con 54xx > 0 y 24xx ≈ 0 (audit-report-emittable.ts:307), y aquí 54xx = 0.

**Corrección:**

(1) Leer las dos anclas que ya viajan: añadir `anchorCheck('UtilidadAntesImpuestos', ...)` y un cruce del renglón de la cuenta 54 contra `bpt.impuestoCausado` con tolerancia $0. (2) Elevar UAI e impuesto a campos de primera clase del `IncomeStatementSchema` (`profitBeforeTaxPrimary`, `incomeTaxExpensePrimary`) para que sean anclables como los demás, en vez de esconderse en `lines`. (3) Cablear `taxProvisionRisk` al P&G: cuando CUR-R4 sea crítico, el Estado de Resultados debe llevar la nota, y conviene evaluar si entra al veredicto de emitibilidad. (4) Extender V11 al caso simétrico —54xx = $0 con UAI positiva material—, que hoy pasa el gate.

**Normativa:** Tarifa general Art. 240 E.T. = 35% para el año gravable 2026 (modificado por el art. 10 de la Ley 2277 de 2022): VERIFICADA HOY contra actualicese.com/tarifa-general-del-impuesto-de-renta-2026-para-personas-juridicas — sin cambios para 2026; la reforma estructural presentada en septiembre de 2025 se hundió en el Congreso el 9 de diciembre de 2025 y la emergencia económica posterior fue declarada inexequible por la Corte Constitucional en abril de 2026. Tasa Mínima de Tributación del 15% (parágrafo 6 Art. 240 E.T., adicionado por la Ley 2277 de 2022): VIGENTE, confirmada contra normograma.dian.gov.co (Concepto 4228 de 2026) y estatuto.co/240. Conclusión: `RENTA_NOMINAL_RATE = 0.35` (curator-rules/types.ts:190), el `uai * 0.35` de build-ancora.ts:184 y el 35% del prompt son CORRECTOS hoy. Salvedad técnica, no normativa: la base es la UAI CONTABLE, no la renta líquida fiscal, y ninguna de las dos rutas aplica las sobretasas del Art. 240 (hidroeléctricas +3pp hasta 2026, financieras +5pp hasta 2027) — está disclaimado en escudo-survival/legal-strings.ts:19 pero no en el Áncora.

#### P2 · PYG-07 — El prompt se contradice sobre el impuesto teórico y la bifurcación vale $779.973.876,41 en el balance real

**Dónde:** `src/lib/agents/financial/prompts/niif-analyst.prompt.ts:203 vs :913`  
**Verificado ejecutando:** sí

**Escenario medido:**

La cabecera estable dice (línea 203): «Cuando NO existe Clase 54 en el balance de prueba: Impuesto de renta en el P&L = $0,00; Utilidad Neta = Utilidad Antes de Impuestos». El bloque de cascada dice (línea 913): «Else if UAI > 0 Y no hay ni Clase 54 ni 1805/135515 then calcular impuesto teórico = UAI × 35% ... anclar el monto como cálculo del modelo (NO como anchor de TOTALES VINCULANTES)». Sobre el balance real —UAI $2.228.496.789,73, Clase 54 = $0,00— las dos ramas dan resultados distintos: la 203 produce netIncome $2.228.496.789,73 (que es el ancla E14 y pasa limpio); la 913 produce netIncome $1.448.522.913,32, que choca con el ancla en $779.973.876,41, genera una deviation `utilidadNeta` NO sobrescribible (reconcile-anchors.ts:190, write:null), pone `reconciliation.clean = false`, sella el informe como REPORTE CON SALVEDADES y bloquea la descarga. Las tres corridas medidas con LLM real tomaron la rama 203, así que el riesgo es de varianza, no un fallo observado; pero es una bifurcación de $779.973.876,41 resuelta por criterio del modelo. Añado que el bloque vinculante rotula la línea como «Impuesto de Renta causado del periodo (clase 54)» (orchestrator.ts:513) mientras el prompt condiciona sobre un identificador que no existe en el bloque, `impuestoCausadoPeriodo` (:911): el modelo tiene que adivinar si «$0,00 [MoneyCop: 0]» cuenta como «contiene» o no.

**Corrección:**

Elegir UNA regla y borrar la otra. Si se conserva la provisión teórica, el ancla `utilidadNeta` deja de ser el resultado contable y hay que emitir una segunda ancla explícita (`utilidadNetaConProvisionTeorica`) para que E14 y el reconciliador no la traten como desviación. Si se conserva el $0,00, borrar la rama 913 y dejar la señal en la nota + CUR-R4. En cualquier caso, alinear el identificador del prompt con la etiqueta que el bloque vinculante realmente imprime.

#### P3 · PYG-08 — El renderer del P&G no emite nota de descuadre, a diferencia del renderer del Balance

**Dónde:** `src/lib/agents/financial/agents/renderer.ts:344-408`  
**Verificado ejecutando:** sí

**Escenario medido:**

`renderBalanceSheet` compara Activo contra Pasivo + Patrimonio y antepone un `descuadreNote` visible cuando no cuadran (renderer.ts:~196-204). `renderIncomeStatement` imprime `p.lines` y luego los cuatro totales sin comprobar nada: ni que los renglones sumen los totales, ni que los totales cumplan la cascada. Con el escenario PYG-03 caso B (ingresos ×3 = $7.287.328.594,71 bajo una Utilidad Neta de $2.228.496.789,73) la tabla Markdown sale sin una sola advertencia, y lo mismo el PDF Élite (compose-statements-from-json.ts:206-228) y el Excel (excel-export.ts:708-727), que reproducen `lines` verbatim.

**Corrección:**

Una vez exista el invariante de PYG-03, reutilizarlo en `renderIncomeStatement` para emitir el mismo tipo de nota que ya emite el Balance. Es una línea de defensa barata que sobrevive aunque el validador no se cablee.

### Lo que este auditor NO pudo medir

- No corrí el pipeline con LLM real en esta sesión. Reutilicé los tres JSON crudos que la sesión anterior dejó en `.fase0/raw-grupo-2tres-signos-ok-run{1,2,3}.json` — son output real de gpt-5.4-mini sobre el balance de cliente, pero de ANTES de que entrara `deterministic-breakdown.ts`. Eso no afecta a mis conclusiones sobre el P&G (el desglose determinista no toca `incomeStatement`, y lo verifiqué leyendo `CLASS_BY_SECTION`), pero significa que la estabilidad del P&G que reporto —3/3 cascada exacta— está medida sobre la build anterior. Reconfirmarla con 2 corridas post-cambio cuesta ~10 minutos con `scripts/fase0-anchor-drift.ts`.
- No pude medir el comportamiento del P&G con un balance que tenga 4175 en convención NATURAL de un ERP real: no existe ninguno en el repo. El caso lo demostré con un fixture sintético que construí (ventas $1.000.000.000 + devoluciones $100.000.000 positivas). El detector `detectSignConvention` clasifica ese archivo como natural y no lo toca, así que la ruta de código es real; lo sintético es sólo la entrada.
- No medí la deriva del P&G en el salto JSON → HTML (Editor Jefe). Verifiqué por lectura que `grossProfitPrimary` y `operatingProfitPrimary` entran como binding figures (contracts/html-editor.ts:307-308) y que `reconcileBindingFigures` existe (html-editor-validator.ts:834), pero no ejecuté ese tramo. La consecuencia relevante para mi superficie es conceptual y no depende de la medición: esa reconciliación garantiza FIDELIDAD al número del NIIF Analyst, no su corrección.
- No verifiqué si el finding CUR-R4 se renderiza efectivamente en alguna pantalla que el usuario mire. Confirmé por lectura que `snapshot.curator.findings` lo consumen `pillars/verdad-bars.ts:74` y `pillars/verdad-cards.ts:141`, y que el objeto estructurado `taxProvisionRisk` no tiene ningún consumidor en `src/`. No seguí la cadena hasta el componente React.
- No evalué las sobretasas del Art. 240 E.T. (hidroeléctricas +3pp vigente hasta 2026, financieras +5pp hasta 2027, carbón variable) contra el CIIU de la empresa: el código no las modela y el balance de prueba de la muestra no permite determinar si aplicarían. Lo dejo señalado, no concluido.
- No revisé los agentes de Parte IV/V (dictámenes especializados y meta-auditoría) ni `tax-planning`: pueden recalcular cifras del P&G por su cuenta y no entraban en mi superficie.


---

## Estado de Flujos de Efectivo (NIC 7 / NIIF para las PYMES Sec. 7)

**Veredicto:** `sin-garantia`

### Resumen del auditor

Cual EFE llega al informe: el del LLM, sin excepcion. Existen dos. R2 construye uno determinista (`cashFlowIndirecto`) que R6 cierra contra el PUC 11; ese se imprime en el bloque vinculante rotulado \"AUTORIDAD ... VINCULANTES\", alimenta el gate V3 y las tarjetas del dashboard, y despues se descarta. Lo que se renderiza en el Markdown (renderer.ts:412), en el PDF Elite (compose-statements-from-json.ts:232) y de ahi al HTML es `json.cashFlow`, autorado por Pass-2. No hay un solo cruce entre los dos. Si divergen, gana el LLM en silencio.\n\nQue se cruza de verdad. De las doce cifras que componen el estado, UNA tiene gate bloqueante: `cashClosing`, via reconcile-anchors.ts:197-204 contra `efectivoCuenta11`, tolerancia $0, que alimenta `reconciliation.clean` y por tanto el sello \"REPORTE CON SALVEDADES\" y el bloqueo de descarga. E2 (netChange = Σ netFlow y cashClosing = cashOpening + netChange) SI corre en produccion con tolerancia $0 exacta —verificado: dispara con una brecha de $0,01— pero es no bloqueante: sale por evento SSE `warning`, que hoy si tiene handler y pinta un banner (PipelineWorkspace.tsx:3014), y no viaja al HTML, al PDF ni al Excel. E11 (primer renglon de operacion = utilidad neta) y E10 (etiquetas de flujo ficticio) corren igual, por el mismo canal. E3 (cashClosing == PUC 11) esta escrito y NO corre: orchestrator.ts:1576 descarta el ancla con `void cashAnchorCents` apoyandose en un comentario incorrecto.\n\nQue queda libre. `cashOpening` no lo ancla, no lo valida y ni siquiera lo menciona nadie —verificado ejecutando: un EFE con la apertura inventada en $500M frente a los $1.563.485.554,01 reales, con el cierre clavado en el PUC 11, sale con cero hallazgos. Los tres subtotales de seccion pueden repartirse el netChange como el modelo quiera. Y no existe invariante \"los renglones suman el subtotal\" para el EFE: E15 solo itera el Balance. Ejecutado sobre el balance real: una seccion de operacion con dos renglones que suman $2.228.496.889,73 bajo un subtotal en negrita de $2.421.190.071,93, y una seccion de financiacion con CERO renglones bajo ($1.570.997.737,30), produce `clean = true`, informe sin sello y descarga permitida. Es exactamente el defecto que FASE 0 midio inestable en el Balance (0,10% / 41,2% / 99,9% segun corrida) — alli se cerro con `deterministic-breakdown.ts`, aqui no hay ni detector.\n\nR6 sobre el balance real: DESCARTO la acusacion previa. No emite \"brecha excede tope de plausibilidad en TODOS los buckets\" ni severidad critica. Absorbe -$13.714.221,38 en `varCuentasPorCobrar` con `reconciled = true` y finding de severidad media. Aquella medicion es anterior a `preprocessing/sign-convention.ts`: con las clases 2/3/4 invertidas los Δ de R2 salian al reves y la brecha era enorme frente a los buckets. Lo que si es cierto, y es peor de lo reportado: la brecha absorbida es EXACTAMENTE Δ(grupo 28) $16.630.887,38 − Δ(grupo 18) $2.916.666,00 — los dos unicos grupos de balance con movimiento que R2 no mapea. No es ruido de transferencias internas como dice su comentario: es una omision aritmetica que el codigo ya puede calcular, disfrazada de cartera. El renglon \"Variacion Cuentas por Cobrar\" que se imprime queda mal en un 94,5% (-$14.509.877,73 frente a -$28.224.099,11). Y el guardrail que separa \"absorber en silencio\" de \"finding critico que bloquea\" pasa por 1,4 puntos: 48,59% contra un tope de 50%.\n\nEl plug figure sigue vivo: niif-analyst.prompt.ts:1069, \"SEGUNDO PATH — Revisar magnitudes/signos de las variaciones de capital de trabajo (varCuentasPorCobrar, varInventarios, varCuentasPorPagar) hasta que el EFE cuadre matematicamente con tolerancia $0 al centavo\". Son cifras deterministas que el mismo prompt declara vinculantes doce lineas antes. Y en el ECP (superficie ajena) esta la version literal: \"ajustar montos hasta cuadrar\" (:1132).\n\nLo mas grave no lo autora el LLM: lo autora el codigo. Sobre el unico balance de cliente real, R2 emite \"Dividendos estimados: -$1.570.997.737,30\" — el 64,9% del flujo operativo — como salida de caja por financiacion. Verificado: ese numero es al centavo −(utilidad neta 2024) + Δ37, y el Δ36 que lo genera es la resta de las cuentas VIRTUALES 3605VC que el propio Curator R8 inyecta en cada periodo. No hay cuenta 2360 ni 3305 en el balance. El propio preprocesador dice, en el mismo informe, que los libros no estan cerrados. Es un flujo ficticio de $1.571 millones que el codigo entrega al modelo rotulado como vinculante — exactamente lo que la regla E10 fue escrita para impedir, y que E10 no ve porque solo inspecciona etiquetas del LLM.

### Inventario cifra por cifra

| Cifra | Estado | Productor | Validador |
|---|---|---|---|
| cashFlowIndirecto (EFE completo de R2, post-R6) | **DETERMINISTA** | `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/preprocessing/curator-rules/r2-indirect-cashflow.ts:109 (y :298 en modo single-period); mutado por r6-cashflow-closure.ts:164-170` | n/a — pero NUNCA llega al informe. Verificado ejecutando: renderer.ts:412 y compose-statements-from-json.ts:232 leen json.cashFlow (el del LLM). cashFlowIndirecto solo alimenta el prompt (orchestrator.ts:814-895), V3 (audit-report-emittable.ts:181) y los dashboards (valor-cards.ts:151, valor-bars.ts |
| cashFlow.cashClosing (Efectivo al final del periodo) | ANCLADA | `LLM Pass-2 → contracts/niif-report.ts:162 CashFlowStatementSchema` | /Users/rocuts/Documents/GitHub/UtopIA/src/lib/agents/financial/agents/reconcile-anchors.ts:197-204 (binding key efectivoCuenta11, write:null) invocado en niif-analyst.ts:413. CORRE en produccion, tolerancia $0, alimenta reconciliation.clean → sello + bloqueo de descarga. El segundo cinturon E3 (niif |
| cashFlow.netChange (Aumento/disminucion neto en efectivo) | ANCLADA | `LLM Pass-2` | E2 en niif-json-validator.ts:201-214, invocado desde orchestrator.ts:1598 (runNiifPhase). CORRE, tolerancia $0 exacta (verificado: dispara con brecha de $0,01). NO bloqueante: sale como evento SSE 'warning' → banner en PipelineWorkspace.tsx:3014. No sella ni bloquea descarga, no viaja al HTML/PDF/Ex |
| cashFlow.sections[operating].lines[0].amountPrimary | ANCLADA | `LLM Pass-2` | E11 en niif-json-validator.ts:561-587 (== netIncomePrimary, tolerancia $0). CORRE en produccion, no bloqueante (canal warning). |
| cashFlow.sections[].lines[].label | ANCLADA | `LLM Pass-2` | E10 en niif-json-validator.ts:505-559 (5 patrones regex de flujo ficticio 3605). CORRE, no bloqueante. |
| cashFlow.cashOpening (Efectivo al inicio del periodo) | **LIBRE** | `LLM Pass-2` | NINGUNO. COMPARATIVE_BINDINGS de reconcile-anchors.ts:207-238 no incluye efectivoCuenta11. E2 lo usa como INSUMO, no lo valida. controlTotals.cashOpen (r6:75) no lo lee nadie. El bloque vinculante no dice 'Efectivo al inicio' en ninguna linea (verificado ejecutando). |
| cashFlow.sections[].netFlow (3 subtotales: operacion, inversion, financiacion) | **LIBRE** | `LLM Pass-2` | Solo E2 exige que los TRES sumen netChange. Ningun cruce contra cashFlowIndirecto.operating.total / investing.total / financing.total. |
| cashFlow.sections[].lines[].amountPrimary (todos salvo el primero de operating) | **LIBRE** | `LLM Pass-2` | NINGUNO. E15 (niif-json-validator.ts:671-699) itera SOLO assets/liabilities/equity. No existe invariante 'Σ lines == netFlow' para el EFE. |
| cashFlow.sections[investing\|financing].lines (existencia) | **LIBRE** | `LLM Pass-2` | NINGUNO. Una seccion con CERO renglones y subtotal material pasa limpia (verificado ejecutando). |
| cashFlow.degeneracyFlag y cashFlow.methodNote | **LIBRE** | `LLM Pass-2` | NINGUNO. |
| amountComparative de todas las lineas del EFE | **LIBRE** | `LLM Pass-2` | NINGUNO (E9 solo cubre los 6 totales de Balance y P&L). |
| financing.dividendosEstimados (dentro del EFE determinista) | **DETERMINISTA** | `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/preprocessing/curator-rules/r2-indirect-cashflow.ts:93-96` | Ninguno. Se inyecta al prompt como VINCULANTE (orchestrator.ts:884). |
| operating.varCuentasPorCobrar (dentro del EFE determinista) | **DETERMINISTA** | `r2-indirect-cashflow.ts:60 + MUTADA por r6-cashflow-closure.ts:124` | Ninguno. |
| investing.total (dentro del EFE determinista) | **DETERMINISTA** | `r2-indirect-cashflow.ts:80-82` | Ninguno. |
| controlTotals.efectivoCuenta11 / cashClose / cashOpen | **DETERMINISTA** | `trial-balance.ts (efectivoCuenta11) y r6-cashflow-closure.ts:74-75 (cashClose/cashOpen)` | n/a (fuente). |

Reparto: **5** deterministas · **4** ancladas · **6** libres.

### Hallazgos

#### P0 · EFE-01 — R2 fabrica una salida de caja por financiacion de $1.570.997.737,30 en el unico balance de cliente real: 'Dividendos estimados' que nunca se pagaron

**Dónde:** `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/preprocessing/curator-rules/r2-indirect-cashflow.ts:93-96`  
**Verificado ejecutando:** sí

**Escenario medido:**

grupo-empresarial-2tres-sas.xlsx, 2025 vs 2024. Ejecutado: Δ36 = $655.775.316,77; Δ37 = $1.723.735,66; utilidadNeta 2025 = $2.228.496.789,73. dividendosEstimados = min(0, (Δ36+Δ37) − utilidadNeta) = -$1.570.997.737,30. Ese numero coincide AL CENTAVO con −(utilidad neta 2024 = $1.572.721.472,96) + Δ37. Y Δ36 no es una distribucion: es la resta de las cuentas VIRTUALES que el propio Curator R8 inyecta en cada periodo (3605VC 2025 = $2.228.496.789,73 contra 3605VC 2024 = $1.572.721.472,96). En el balance NO existe cuenta 2360 ni 3305 (dividendos por pagar / decretados) — verificado: 0 cuentas. El EFE resultante declara Financiacion = -$1.570.997.737,30, el 64,9% del flujo operativo ($2.421.190.071,93), y el bloque vinculante se lo entrega al LLM rotulado 'AUTORIDAD: estos valores son VINCULANTES' (orchestrator.ts:884, 892-894). El propio balance trae el finding CUR-R12 'Libros NO cerrados — utilidad del ejercicio sin trasladar al patrimonio', asi que el 3605 real vale $0: los $1.571M no existen en ninguna parte salvo en la aritmetica de R2.

**Corrección:**

Excluir de deltaUtilAcum las cuentas virtuales que inyecta R8 (sufijo VC) y condicionar dividendosEstimados a evidencia: saldo o movimiento en 2360/2365 (dividendos por pagar) o 3305, o un movimiento de caja documentado. Sin evidencia, la diferencia va como partida de conciliacion no monetaria en operating (que es lo que el propio prompt ya ordena en su PRIMER PATH, niif-analyst.prompt.ts:1061-1067), nunca como salida en financiacion.

**Normativa:** NIC 7 parr. 17 y 21 (actividades de financiacion = cambios en el tamano y composicion de los capitales propios y prestamos, con flujos REALES) y NIC 7 parr. 18(b) (metodo indirecto: se ajusta el resultado por transacciones NO monetarias). Verificado 2026-08 contra ICAC (texto oficial en espanol de la NIC 7, versiones dic-2023 / jul-2025 / feb-2026) y contra la traduccion oficial de la IFRS Foundation publicada por el MEF de Peru. Para el Grupo 2 colombiano rige el Anexo 2 del Decreto 2420/2015 (NIIF para las PYMES, Seccion 7) — vigente, confirmado en el Gestor Normativo de Funcion Publica. Ademas, es exactamente el flujo ficticio que la regla E10 del propio repo prohibe por Defensa Art. 647 E.T.; E10 no lo atrapa porque solo inspecciona etiquetas emitidas por el LLM.

#### P0 · EFE-02 — cashOpening ('Efectivo al inicio del periodo') es LIBRE: nadie lo ancla, nadie lo valida, y ni siquiera figura en el bloque vinculante

**Dónde:** `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/agents/financial/agents/reconcile-anchors.ts:207-238`  
**Verificado ejecutando:** sí

**Escenario medido:**

Ejecutado sobre el balance real. Se construyo un EFE con cashOpening = $500.000.000 (el PUC 11 real de 2024 es $1.563.485.554,01), netChange = $1.913.677.888,64 y cashClosing = $2.413.677.888,64 (= PUC 11 de 2025, exacto). Resultado: validateNiifReportJson con las opciones EXACTAS de produccion devuelve 0 errores que mencionen cashOpening; reconcileAnchors devuelve 0 desviaciones sobre cashFlow. El informe declara una variacion neta de caja de $1.913,7M cuando la real es $850,2M — un error de $1.063,5M — y sale limpio, sin sello y con la descarga habilitada. Confirmado ademas que el bloque vinculante NO contiene la cadena 'Efectivo al inicio' y que NINGUNA linea con PUC 11 lleva token [MoneyCop: N] (las 26 lineas con token son las de Balance y P&L).

**Corrección:**

Anadir un binding 'efectivoCuenta11' a COMPARATIVE_BINDINGS en reconcile-anchors.ts (write:null, igual que el primary) y emitir el PUC 11 de apertura en el bloque vinculante con anchorLine() para que viaje como [MoneyCop: N], no como pesos formateados dentro de la lista 'Big Four'. controlTotals.cashOpen ya esta calculado en r6-cashflow-closure.ts:75 y hoy no lo consume nadie.

**Normativa:** NIC 7 parr. 45: la entidad revelara los componentes del efectivo y equivalentes y presentara una conciliacion de los importes de su estado de flujos de efectivo con las partidas equivalentes del estado de situacion financiera. La conciliacion exige AMBOS extremos, no solo el de cierre. Fuente verificada 2026-08: ICAC (NIC 7, texto oficial en espanol) y traduccion oficial IFRS Foundation via MEF Peru.

#### P0 · EFE-03 — No existe invariante 'los renglones del EFE suman su subtotal': E15 solo cubre el Balance, y un EFE sin renglones se entrega limpio y descargable

**Dónde:** `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/agents/financial/validators/niif-json-validator.ts:671-699`  
**Verificado ejecutando:** sí

**Escenario medido:**

Ejecutado sobre el balance real. EFE con: seccion operacion = 2 renglones ($2.228.496.789,73 + $100,00 = $2.228.496.889,73) bajo un subtotal en negrita de $2.421.190.071,93 (hueco de $192.693.182,20); seccion financiacion = CERO renglones bajo un subtotal en negrita de ($1.570.997.737,30); netChange = Σ netFlow = $850.192.334,63; cashClosing = $2.413.677.888,64 = PUC 11. Resultado en produccion: validateNiifReportJson emite CERO hallazgos sobre el cashFlow (el unico error es E5, del P&L de mi fixture) y reconcileAnchors devuelve clean = true → informe SIN sello 'REPORTE CON SALVEDADES' y DESCARGA PERMITIDA. renderCashFlowStatement lo imprime tal cual: el cliente ve una columna que no suma. Es el mismo defecto que FASE 0 midio inestable en el Balance (0,10% / 41,2% / 99,9% de renglones faltantes segun la corrida) — pero en el Balance ya existe E15 + el desglose determinista, y en el EFE no existe ni lo uno ni lo otro.

**Corrección:**

Dos capas. (1) Anadir a niif-json-validator.ts un invariante por seccion: Σ(lines[].amountPrimary) == netFlow, con la misma doctrina de E15 (seccion con netFlow material y 0 renglones = brecha del 100%), y elevarlo al canal que sella (reconciliation), no al de warnings. (2) Extender contracts/deterministic-breakdown.ts al EFE: R2 ya tiene los 8 renglones de operacion en centavos, asi que el desglose del EFE puede construirse desde el preprocesador igual que se hizo con el Balance, y al modelo le queda la etiqueta y la narrativa.

**Normativa:** NIC 7 parr. 10 y 18 (el estado presenta los flujos clasificados por actividades; el metodo indirecto presenta el resultado ajustado por partidas identificadas). NIIF para las PYMES Sec. 7 (Anexo 2 Decreto 2420/2015, vigente) para el Grupo 2, que es como se procesa este cliente. Un subtotal sin renglones que lo sustenten no es un estado de flujos de efectivo presentado.

#### P1 · EFE-04 — E3 (EFE cashClosing == PUC 11) esta escrito y desconectado: el call-site de produccion descarta el ancla con un `void`

**Dónde:** `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/agents/financial/orchestrator.ts:1570-1577`  
**Verificado ejecutando:** sí

**Escenario medido:**

orchestrator.ts:1571-1576 calcula cashAnchorCents desde el snapshot COMPARATIVO y lo tira: `void cashAnchorCents; // PUC 11 del primary ya se cruza en validateConsolidatedReport`. La llamada de la linea 1598 no pasa cashAccountPuc11Cents, asi que el bloque E3 (niif-json-validator.ts:217) nunca entra. Ejecutado: con cashClosing = $1.000.000.000 y PUC 11 real = $2.413.677.888,64, con las opciones de produccion E3 NO aparece; con cashAccountPuc11Cents si aparece ('E3. EFE cashClosing ≠ PUC 11 ... Brecha: -$1.413.677.888,64'). El comentario que justifica el descarte es incorrecto: validateConsolidatedReport cruza el EFE por REGEX sobre el Markdown (report-validator.ts:393-412) y solo se invoca en orchestrator.ts:1916, dentro de orchestrateFinancialReport (camino legacy), no en runNiifPhase, que es el que sirve /api/financial-report/niif. Ademas el ancla que se calculaba era la del periodo comparativo, no la del primario. La cifra sigue ANCLADA porque reconcileAnchors si la cruza, pero el segundo cinturon y el unico mensaje explicativo estan muertos.

**Corrección:**

Pasar `cashAccountPuc11Cents: centsOrUndefined(primaryAnchors.cents.efectivoCuenta11)` en la llamada de orchestrator.ts:1598 y borrar el `void`. Corregir tambien el comentario, que documenta como cubierto un camino que no corre.

#### P1 · EFE-05 — R6 disfraza de 'Variacion Cuentas por Cobrar' una omision aritmetica que el codigo ya puede calcular al centavo, y el guardrail pasa por 1,4 puntos

**Dónde:** `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/preprocessing/curator-rules/r6-cashflow-closure.ts:108-124`  
**Verificado ejecutando:** sí

**Escenario medido:**

Balance real 2025 vs 2024. Ejecutado: la brecha es -$13.714.221,38 y R6 la resta de varCuentasPorCobrar, que pasa de -$28.224.099,11 (el Δ real del grupo 13, que es lo que R2 calculo) a -$14.509.877,73, que es lo que ve el LLM y lo que se imprime. El renglon queda mal en un 94,5%. Y la brecha NO es 'ruido de transferencias internas' como afirma el comentario de cabecera (r6:5-8): es EXACTAMENTE Δ(grupo 28 'otros pasivos') $16.630.887,38 − Δ(grupo 18 'otros activos') $2.916.666,00 = $13.714.221,38 — los dos unicos grupos de balance con movimiento que R2 no mapea a ninguna linea (r2:60-96 solo cubre 13, 14, 22, 23, 24, 25, 15, 21, 31, 32, 33, 36, 37). Coincidencia al centavo. Ademas el guardrail de plausibilidad pasa por 1,4 puntos: |gap| / |bucket| = 48,59% contra un tope de 50,00%. La frontera entre 'informe emitido en silencio' e 'informe bloqueado por finding critico' esta, en el unico cliente real del repo, a 1,4 puntos porcentuales de cartera.

**Corrección:**

Mapear en R2 los grupos que hoy faltan (12, 16, 17, 18, 19 en inversion; 26, 27, 28 en operacion o financiacion segun naturaleza) y calcular el residual como 'Otras variaciones netas' con su propio renglon visible. Un plug que se puede calcular no es un plug: es una linea que falta. Mientras exista residual, no contaminar un renglon con nombre contable — llevarlo siempre a varCapitalTrabajoAjuste, que al menos se llama por lo que es.

**Normativa:** NIC 7 parr. 18(b): en el metodo indirecto el resultado se ajusta por los efectos de transacciones no monetarias, aplazamientos y devengos, y partidas asociadas a inversion o financiacion — los ajustes son partidas identificadas, no un residuo imputado a una cuenta ajena. Verificado 2026-08 contra el texto oficial del ICAC.

#### P1 · EFE-06 — El bloque vinculante ordena contar dos veces el ajuste de cierre de R6

**Dónde:** `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/agents/financial/orchestrator.ts:826-914`  
**Verificado ejecutando:** sí

**Escenario medido:**

Balance real. La seccion C0 (orchestrator.ts:826-860) imprime los 8 renglones de operacion YA mutados por R6, que suman exactamente $2.421.190.071,93 = el subtotal declarado (verificado ejecutando: diferencia $0,00). Acto seguido la seccion C (orchestrator.ts:896-914) ordena: 'Linea de absorcion a reportar: literal "Variaciones en Capital de Trabajo (ajuste de cierre)" en Actividades de Operacion, monto -$13.714.221,38', y niif-analyst.prompt.ts:1099 repite la orden. Si el modelo obedece ambas cosas —que es lo que le piden— la seccion de operacion impresa suma $2.407.475.850,55 bajo un subtotal de $2.421.190.071,93, y el cierre implicito cae a $2.399.963.667,26, desviando -$13.714.221,38 del ancla PUC 11 ($2.413.677.888,64). Entonces reconcileAnchors marca la desviacion de cashFlow.cashClosing y el informe se sella con salvedades — por una contradiccion que le puso el propio codigo.

**Corrección:**

Elegir uno de los dos. O bien C0 imprime el bloque operativo PRE-R6 y C anade la linea de ajuste (coherente y auditable), o bien C0 imprime el post-R6 y C se limita a explicar el ajuste sin ordenar una linea adicional. Hoy conviven las dos instrucciones sobre las mismas cifras.

#### P2 · EFE-07 — La instruccion de plug figure sigue viva en el prompt del EFE: 'revisar magnitudes/signos ... hasta que el EFE cuadre'

**Dónde:** `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/agents/financial/prompts/niif-analyst.prompt.ts:1069`  
**Verificado ejecutando:** no

**Escenario medido:**

Texto literal vigente hoy: '2. SEGUNDO PATH — Revisar magnitudes/signos de las variaciones de capital de trabajo (varCuentasPorCobrar, varInventarios, varCuentasPorPagar) hasta que el EFE cuadre matematicamente con tolerancia $0 al centavo.' Esas tres cifras son DETERMINISTAS: las calcula R2 desde el balance y el mismo prompt las declara vinculantes doce lineas mas arriba (:1097) y en el bloque C0 ('cita las lineas de capital de trabajo LITERALMENTE'). Sobre el balance real eso significa autorizar al modelo a mover ΔInventarios (-$506.441.623,92) o ΔProveedores ($685.467.946,92) hasta que la resta le de. La instruccion convive en el mismo bloque con 'NEVER crear flujos ficticios de financiacion' (:1073), que solo protege la seccion de financiacion. Ningun validador detecta un capital de trabajo movido: no hay cruce entre cashFlow.sections[].lines y cashFlowIndirecto.operating. Adyacente (superficie ECP, no la mia): la misma orden literal existe en :1132 — 'Si cualquiera falla → NO emitir el ECP; ajustar montos hasta cuadrar.'

**Corrección:**

Sustituir el SEGUNDO PATH por: si el EFE no cuadra tras el ajuste no-cash del PRIMER PATH, emitir degeneracyFlag = 'indirect_method_unreliable' (que ya es el TERCER PATH) — nunca alterar una variacion de capital de trabajo, que es una cifra del preprocesador. Y anadir el cruce Σ(lines) vs cashFlowIndirecto por bucket para que la desobediencia sea detectable.

**Normativa:** NIC 7 parr. 18(b) y NIIF para las PYMES Sec. 7 (Anexo 2 Decreto 2420/2015, vigente): las variaciones de capital de trabajo son hechos medidos, no variables de cuadre. Defensa Art. 647 E.T.: una cifra ajustada para cuadrar carece de sustento documental.

#### P2 · EFE-08 — El escape-hatch de R6 no tiene guardrail y su cifra no se imprime: el bloque vinculante puede declarar un subtotal que sus renglones no suman

**Dónde:** `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/preprocessing/curator-rules/r6-cashflow-closure.ts:157-161`  
**Verificado ejecutando:** sí

**Escenario medido:**

Ejecutado sobre src/lib/preprocessing/__fixtures__/patologicos/cifras-mayores-2e53.csv. Los 4 buckets clasicos valen $0, asi que R6 salta el guardrail de plausibilidad (esta explicitamente exento, r6:157-158) y escribe varCapitalTrabajoAjuste = $40.000.000.000.000,00, llevando operating.total de $0,00 a $40 billones — el 100% del subtotal es plug. El renderizador del bloque vinculante (orchestrator.ts:826-860) imprime SOLO los 8 campos con nombre y NO varCapitalTrabajoAjuste, de modo que Pass-2 recibe ocho renglones que suman $0,00 bajo la linea '= Flujo neto Actividades de Operacion: $40.000.000.000.000,00'. Honestidad: ese fixture concreto muere despues en el gate de liquidez de prepareFinancialContext (BalanceValidationError: Activo Corriente < Pasivo Corriente), asi que no lo pude llevar hasta un informe emitido; la ruta de codigo si esta confirmada por ejecucion, y el disparador (los cuatro buckets en cero) es plausible en una empresa de servicios sin cartera ni inventario.

**Corrección:**

Aplicar el mismo guardrail de plausibilidad al fallback (referido al |netChange| observado, no a un bucket que vale cero) y anadir varCapitalTrabajoAjuste al renderizador del bloque C0 para que el subtotal impreso siempre sea la suma de los renglones impresos.

#### P2 · EFE-09 — V3 del gate de emision compara codigo contra codigo: nunca mira el EFE del LLM

**Dónde:** `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/pillars/audit-report-emittable.ts:181-190`  
**Verificado ejecutando:** sí

**Escenario medido:**

V3 compara snapshot.cashFlowIndirecto.netChangeInCash con .observedChangeInCash — dos campos que R6 acaba de igualar por construccion (r6-cashflow-closure.ts:167-168 los fuerza al mismo valor cuando muta). Solo puede disparar cuando R6 ABORTO. Verificado ejecutando: sobre patologicos/descuadrado-en-origen.csv R6 aborta (brecha -$170.000.000, reconciled=false) y V3 si bloquea ('V3: EFE no concilia con cuenta 11 (diferencia = -$170000000.00 COP)'); sobre el balance real R6 cierra y V3 calla. En ningun caso V3 lee json.cashFlow. Es decir: el gate de emision no tiene ninguna verificacion sobre el estado de flujos que el cliente recibe. Nota de contexto: sobre el balance real el pre-vuelo bloquea igualmente por V12 (libros no cerrados), V5 (identidad no extraida) y V14 (costo de ventas no descargado).

**Corrección:**

Anadir al gate un V-check sobre el EFE emitido: cashClosing == PUC 11, Σ(lines) == netFlow por seccion, y coherencia de signo entre secciones y el cashFlowIndirecto. Hoy el gate solo audita el snapshot.

#### P3 · EFE-10 — Las citas normativas del EFE apuntan al marco del Grupo 1 en un pipeline que procesa al cliente real como Grupo 2

**Dónde:** `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/preprocessing/curator-rules/r2-indirect-cashflow.ts:151`  
**Verificado ejecutando:** sí

**Escenario medido:**

r2-indirect-cashflow.ts:151 y :343 y r6-cashflow-closure.ts:144 y :195 citan unicamente 'NIC 7'. El unico balance de cliente real del repo se procesa con niifGroup = 2 (verificado en el contexto que arma prepareFinancialContext), y esos findings viajan al informe como sustento normativo. Para el Grupo 2 el marco tecnico vigente es el Anexo 2 del Decreto 2420/2015 — NIIF para las PYMES, Seccion 7 (Estado de Flujos de Efectivo); la NIC 7 vive en el Anexo 1 y aplica al Grupo 1. El prompt si cita ambos ('NIC 7 §18(b) / Sec. 7.7-7.8 PYMES', niif-analyst.prompt.ts:1097) y el renderer titula el estado con ambos; el curator no.

**Corrección:**

Hacer condicional el normReference de R2/R6 al niifGroup del contexto: 'NIIF para las PYMES Sec. 7 (Anexo 2 Decreto 2420/2015)' para Grupo 2/3 y 'NIC 7 (Anexo 1 Decreto 2420/2015)' para Grupo 1.

**Normativa:** Decreto 2420 de 2015, Anexo 2 — marco tecnico normativo para preparadores del Grupo 2; los estados financieros individuales deben cumplir las Secciones 3 a 7 de la NIIF para las PYMES. Verificado 2026-08 en el Gestor Normativo de Funcion Publica (funcionpublica.gov.co/eva/gestornormativo, Decreto 2420 Anexo 2 de 2015) y en el INCP. Existe un proyecto de decreto del MinCIT de julio de 2025 con enmiendas al Anexo 2 que NO pude confirmar como expedido.

### Lo que este auditor NO pudo medir

- NO corri el pipeline con LLM real sobre el EFE (cuesta ~5 min/corrida y mi superficie se podia resolver con ejecucion determinista). Todo lo que afirmo sobre lo que el modelo EMITE en el EFE es capacidad demostrada —escenarios que el sistema acepta y entrega limpios—, no frecuencia observada. No se con que frecuencia el modelo deja una seccion sin renglones: FASE 0 midio eso para el Balance (0,10% / 41,2% / 99,9% segun corrida) pero sus artefactos guardados (.fase0*/raw-*.json) no se analizaron por seccion del EFE. La medicion que falta es concreta: 3 corridas midiendo Σ(sections[].lines) vs sections[].netFlow y cashOpening contra el PUC 11 del comparativo.
- No pude llevar el fallback varCapitalTrabajoAjuste (EFE-08) hasta un informe completo: el unico fixture del corpus que lo dispara (cifras-mayores-2e53.csv) muere antes en el gate de liquidez de prepareFinancialContext. La ruta de codigo si esta confirmada por ejecucion; el impacto end-to-end no.
- No pude extraer el texto literal de NIIF para las PYMES parr. 7.7, 7.8 y 7.20: los PDF oficiales de la IFRS Foundation, del ICAC y de niifsuperfaciles vienen comprimidos y WebFetch no los convirtio. Verifique NIC 7 parr. 18(b) y parr. 45 por fuentes oficiales secundarias (ICAC — texto oficial en espanol, y la traduccion oficial de la IFRS Foundation publicada por el MEF de Peru) y la vigencia del Anexo 2 del Decreto 2420/2015 para el Grupo 2 en el Gestor Normativo de Funcion Publica. El ICAC publica una version de la NIC 7 de febrero de 2026 que no logre leer: no descarto enmiendas recientes (probablemente consecuenciales de la NIIF 18, obligatoria 2027, que cambia el punto de partida del metodo indirecto).
- No verifique si el HTML Editor (/api/financial-report/html) reimprime el EFE con cifras propias o si copia las del Markdown. Si confirme por lectura que el Markdown (renderer.ts:412) y el PDF Elite (compose-statements-from-json.ts:232) leen json.cashFlow, es decir el EFE del LLM.
- No medi el round-trip de cache de preprocessed-balance.ts. Si el snapshot cacheado pierde controlTotals.cents (BigInt no sobrevive JSON), buildPeriodAnchors cae al nivel `number` y podria introducir deriva de 1 centavo contra una tolerancia de $0, generando salvedades falsas. Es transversal, no exclusivo del EFE.


---

## Estado de Cambios en el Patrimonio (ECP)

**Veredicto:** `parcialmente-garantizado`

### Resumen del auditor

Del Estado de Cambios en el Patrimonio, el codigo no calcula NI UNA sola cifra. El desglose determinista que se acaba de construir (contracts/deterministic-breakdown.ts) cubre exclusivamente las clases PUC 1/2/3 del BALANCE — verificado en CLASS_BY_SECTION, lineas 98-102 — y reconcileAnchors ni siquiera lee el objeto equityChanges: se lo pase entero y salio byte-identico. Las 40 celdas de un ECP tipico de 5 filas las autora el LLM.

De esas 40, UNA esta anclada de verdad a una fuente determinista: closing_balance.total, que E4 cruza al centavo contra el Total Patrimonio del Balance (que si es determinista, porque lo sobrescribe el reconciliador). E4 corre en produccion — orchestrator.ts:1598, en la ruta de /api/financial-report/niif — y detecta una desviacion de $0,01. Otras tres cifras tienen anclaje debil: E7a ata el resultado del ejercicio a la utilidad neta con tolerancia del 0,5%, E7c exige que cada columna cuadre contra su propia suma con tolerancia de $1.000, y E6 cruza el ORI del ECP contra el del P&G, que tambien lo escribe el modelo. E7a y E7c solo se ejecutan si el modelo emite una fila que el schema no le exige.

Todo lo demas es LIBRE, y son tres huecos concretos. Primero: nadie comprueba que el `total` de una fila sea la suma de sus 7 columnas. Lo medi sobre el ECP real del cliente inflando el capital social en $1.000.000.000,00 sin tocar la columna TOTAL — 0 errores, 0 warnings, y la tabla que se entrega imprime una fila cuyas celdas suman $3.223.439.991,54 bajo un total de $2.223.439.991,54. Segundo: el saldo INICIAL no se cruza contra nada; un opening_balance.total de $0,00 frente a un patrimonio comparativo real de $1.565.940.939,11 pasa limpio. Tercero, y es lo mas grave del conjunto: ningun veredicto del ECP sella el informe ni bloquea la descarga. reconciliation.clean se calcula solo desde reconcileAnchors, asi que E4 y E7 salen por un canal paralelo como evento SSE `warning` y se quedan en un banner amarillo. Una brecha de $0,01 en el desglose del Balance bloquea el Excel; la misma brecha en el ECP no.

Y el patrimonio SI tiene dos fuentes, y SI divergen. equityBreakdown —lo que consumen el prompt del ECP y el bloque TOTALES VINCULANTES— suma $2.228.454.069,73 en 2025 frente al ancla de $2.223.439.991,54: brecha de $5.014.078,19, y $6.737.813,85 en 2024. La causa es que R8 mete el residual en la cuenta virtual 3710VC y equityBreakdown no la ve, mientras R5 —que lo registraria como ajuste de convergencia— retorna vacio por su propio guard justamente porque R8 ya cuadro la ecuacion. El resultado practico es que el bloque declarado AUTORIDAD le dice al modelo 'utilidades acumuladas -$42.720,00' mientras el Balance del mismo informe imprime -$5.056.798,19. Construi el ECP siguiendo el prompt al pie de la letra y falla E7c por esos $5.014.078,19 exactos.

Sobre lo que si funciona, con la misma honestidad: en 8 corridas con LLM real sobre el unico balance de cliente del repo —7 persistidas de la sesion anterior mas una que lance hoy— el ECP salio correcto en los dos ejes las 8 veces, con el cierre y la apertura exactos al centavo contra las anclas. El modelo incluso ACERTO ignorando el prompt: derivo la apertura del patrimonio comparativo anclado en vez de la equityBreakdown que el prompt le ordena usar. Es un buen resultado y hay que decirlo. Pero es criterio del modelo, no propiedad del sistema: cuando el ECP sale bien, sale bien porque el modelo quiso, no porque el codigo lo garantice.

Ademas: el blocker V4 se llama 'ECP === patrimonio del balance' y no toca el ECP —compara dos cifras del preprocesador entre si, porque auditReportEmittable nunca recibe el NiifReportJson—, las cuentas virtuales del curator pueden imprimirse en el ECP firmado porque E12 solo escanea el Balance (y en una corrida real ya se colo la jerga 'Cierre Virtual'), el ECP no tiene columnas comparativas aunque el prompt las exija y el informe se declare comparativo, el Excel entregable no incluye el ECP en ninguna de sus seis hojas, y E7a/E7b/E7c no tienen un solo test en todo el repo.

### Inventario cifra por cifra

| Cifra | Estado | Productor | Validador |
|---|---|---|---|
| closing_balance.total (saldo final del ECP) | ANCLADA | `LLM Pass-2 — src/lib/agents/financial/agents/niif-analyst.ts:344 (CashFlowAndEquitySubSchema)` | src/lib/agents/financial/validators/niif-json-validator.ts:226-233 (E4), tolerancia $0 exacta (moneyCopEquals). CORRE en produccion: si — orchestrator.ts:1598 en la ruta runNiifPhase que usa /api/financial-report/niif. Cruza contra balanceSheet.totalEquityPrimary, que SI es determinista (lo sobrescr |
| profit_for_period.resultadoEjercicio | ANCLADA | `LLM Pass-2 — niif-analyst.ts:344` | niif-json-validator.ts:328-339 (E7a). Tolerancia 0,5% de \|netIncome\| + $100 COP (linea 323). CORRE en produccion. Cruza contra incomeStatement.netIncomePrimary, que NO es determinista (reconcile-anchors.ts:190-195 lo deja sin `write` a proposito) pero SI se cruza contra el preprocesador por E14. |
| Cuadre vertical por columna (Σ filas no-closing == closing, 8 columnas) | ANCLADA | `LLM Pass-2` | niif-json-validator.ts:364-390 (E7c). Tolerancia $1.000 COP POR COLUMNA (linea 375). CORRE en produccion. |
| Columna ORI del ECP | ANCLADA | `LLM Pass-2` | niif-json-validator.ts:275-288 (E6). Compara Δ(ORI) del ECP contra incomeStatement.oriPrimary. Es WARNING, no error. CORRE en produccion. |
| row.total vs la suma de sus 7 columnas (EJE HORIZONTAL) — todas las filas | **LIBRE** | `LLM Pass-2 — niif-analyst.ts:344; se imprime literal en renderer.ts:505-521 y en pdf-elite-react/compose-statements-from-json.ts:284-297` | NINGUNO. E7c recorre las columnas de forma independiente (incluida 'total') y nunca compara una fila contra si misma. |
| opening_balance.total (saldo inicial del ECP) | **LIBRE** | `LLM Pass-2` | NINGUNO. E4 solo mira closing_balance (findEquityClosingRow, niif-json-validator.ts:66-72). Ningun invariante lo cruza contra balanceSheet.totalEquityComparative. |
| Composicion por rubro del cierre: capitalSocial, primaColocacion, reservaLegal, otrasReservas, resultadosAcumulados | **LIBRE** | `LLM Pass-2` | Parcial. E7c ata cada columna a la suma de sus propias filas, pero NINGUNA de las cinco se cruza contra el balance de prueba. El bloque TOTALES VINCULANTES no ancla una sola columna del ECP (verificado ejecutando renderSnapshotLines sobre el balance real: 'NO'). |
| label de cada fila del ECP | **LIBRE** | `LLM Pass-2; se imprime verbatim en renderer.ts:521 y en el PDF Elite` | NINGUNO para el ECP. E12 (cuentas PUC ficticias, niif-json-validator.ts:596-619) escanea EXCLUSIVAMENTE balanceSheet.assets/liabilities/equity. |
| Cifras del periodo COMPARATIVO en el ECP | **LIBRE** | `No existen` | N/A |
| equityChanges.notes (narrativa y citas normativas del ECP) | **LIBRE** | `LLM Pass-2` | Solo filtros de vocabulario en el prompt (verbos comparativos, superlativos). Ninguna verificacion de la cita normativa. |

Reparto: **0** deterministas · **4** ancladas · **6** libres.

### Hallazgos

#### P1 · ECP-01 — Nadie comprueba que el `total` de una fila sea la suma de sus 7 columnas — el eje horizontal del ECP no tiene validador

**Dónde:** `src/lib/agents/financial/validators/niif-json-validator.ts:364-390`  
**Verificado ejecutando:** sí

**Escenario medido:**

Partiendo del ECP REAL que emitio el LLM sobre el balance del cliente (.fase0-final2/run1), sumo $1.000.000.000,00 a capitalSocial en la fila de apertura Y en la de cierre, sin tocar la columna `total` de ninguna fila. El eje vertical sigue cuadrando y closing.total sigue siendo $2.223.439.991,54. Resultado ejecutado: validateNiifReportJson -> ok=true, 0 errores, 0 warnings. La tabla que recibe el cliente imprime: Saldo al 31 dic 2025 | $1.000.000.000,00 | $0,00 | $0,00 | $0,00 | ($5.056.798,19) | $2.228.496.789,73 | $0,00 | TOTAL $2.223.439.991,54. El lector suma la fila y obtiene $3.223.439.991,54: se equivoca en exactamente $1.000.000.000,00. Ademas el capital social es 100% inventado — el balance de prueba de esta SAS no tiene ni una cuenta PUC 31. El informe NO sale sellado y la descarga NO se bloquea.

**Corrección:**

Anadir el invariante horizontal al mismo bucle de E7c: para CADA fila, Σ(capitalSocial..ori) == total con tolerancia $0. Es aritmetica pura sobre datos que ya estan en memoria. Emitirlo con el mismo peso que E4.

#### P1 · ECP-02 — Ningun veredicto del ECP sella el informe ni bloquea la descarga: E4 y E7 mueren como banner amarillo

**Dónde:** `src/lib/agents/financial/agents/niif-analyst.ts:415-425`  
**Verificado ejecutando:** sí

**Escenario medido:**

`reconciliation.clean` — el booleano del que cuelgan el sello REPORTE CON SALVEDADES y el bloqueo de descarga (PipelineWorkspace.tsx:1159-1163 y :1392) — se calcula EXCLUSIVAMENTE a partir de reconcileAnchors, que nunca lee equityChanges. Verificado ejecutando: pase por reconcileAnchors un ECP cuyo cierre declara $0,01 y el objeto equityChanges salio byte-identico ('equityChanges cambiado por reconcileAnchors: NO'), deviations y lineGaps no lo mencionan. Escenario concreto: ECP con closing_balance.total = $2.223.439.991,55 frente al patrimonio real $2.223.439.991,54. E4 dispara ('Brecha: $0,01') -> viaja como evento SSE `warning` -> banner amarillo -> reconciliation.clean sigue en true -> el boton de Excel sigue habilitado y el informe no lleva sello. Asimetria medida: una brecha de $0,01 en el DESGLOSE del Balance si bloquea la descarga; la misma brecha en el ECP no.

**Corrección:**

Alimentar el veredicto de validateNiifReportJson (al menos E4/E7a/E7c) al mismo ReconciliationOutcome que ya gobierna el sello y el bloqueo, en vez de emitirlo por un canal paralelo. La funcion ya corre en el sitio correcto (orchestrator.ts:1598), justo despues de tener niif.json y niif.reconciliation.

#### P1 · ECP-03 — El saldo INICIAL del ECP no se cruza contra el patrimonio del periodo comparativo, y el prompt ordena construirlo desde una fuente equivocada

**Dónde:** `src/lib/agents/financial/validators/niif-json-validator.ts:66-72`  
**Verificado ejecutando:** sí

**Escenario medido:**

Dos medidas sobre el balance real. (a) E4 solo mira la fila closing_balance: con el patrimonio 2024 anclado en $1.565.940.939,11, un ECP cuyo opening_balance.total declara $0,00 pasa SIN SALVEDADES (ejecutado). (b) El prompt Pass-2 ordena literalmente 'If isComparative=true Y existe preprocessed.comparative.equityBreakdown then opening_balance del ECP toma SUS cifras' (niif-analyst.prompt.ts:1146). Ejecutado sobre el balance real, esa fuente suma $1.572.678.752,96 — $6.737.813,85 POR ENCIMA del patrimonio comparativo anclado. Construi el ECP siguiendo el prompt al pie de la letra y falla E7c en la columna `total` por $5.014.078,19. Es decir: obedecer el prompt produce un ECP incorrecto; en las 8 corridas medidas el modelo acerto porque IGNORO esa instruccion y uso el patrimonio anclado.

**Corrección:**

(1) Extender E4 con un segundo cruce: opening_balance.total == balanceSheet.totalEquityComparative con tolerancia $0 cuando hay comparativo. (2) Corregir la instruccion del prompt para que el saldo inicial se tome del ancla de patrimonio comparativo, no de equityBreakdown.

#### P1 · ECP-04 — Hay DOS fuentes para el patrimonio y divergen $5.014.078,19 en el balance real; el bloque VINCULANTE publica la equivocada

**Dónde:** `src/lib/preprocessing/curator-rules/r5-equity-anchor.ts:70-75`  
**Verificado ejecutando:** sí

**Escenario medido:**

Ejecutado sobre grupo-empresarial-2tres-sas.xlsx. Fuente A = snapshot.equityBreakdown, que es lo que consumen el prompt del ECP y el bloque TOTALES VINCULANTES: 2025 = {utilidadesAcumuladas: -42.720, utilidadEjercicio: 2.228.496.789,73}, Σ = $2.228.454.069,73. Fuente B = buildDeterministicBreakdown(primary,'equity'), lo que ahora imprime el BALANCE: grupo 36 = $2.228.496.789,73 + grupo 37 = -$5.056.798,19, Σ = $2.223.439.991,54 = el ancla. BRECHA 2025 = $5.014.078,19; BRECHA 2024 = $6.737.813,85. Causa raiz medida: R8 absorbe el residual en la cuenta virtual 3710VC (-$5.014.078,19) y equityBreakdown no la ve; R5 —que lo registraria como convergenceAdjustment— retorna vacio por su propio guard porque R8 ya cuadro la ecuacion. Consecuencia visible: el bloque declarado AUTORIDAD imprime 'Desglose patrimonio: ... utilidades acumuladas -$42.720,00' mientras el Balance del MISMO informe imprime grupo 37 = -$5.056.798,19.

**Corrección:**

Sincronizar equityBreakdown con las cuentas post-curator (que 3710VC entre en utilidadesAcumuladas, o que R5 registre convergenceAdjustment aunque R8 haya cuadrado), o dejar de emitir la linea 'Desglose patrimonio' en el bloque vinculante y sustituirla por el desglose determinista por grupo PUC, que es la fuente que ya gobierna el Balance. Es el mismo patron de duplicacion sin sincronizar que la auditoria integral marco como causa raiz.

#### P2 · ECP-05 — Las cuentas virtuales del curator (3605VC / 3710VC / 3710ZZ) pueden llegar al ECP firmado; E12 no mira el ECP

**Dónde:** `src/lib/agents/financial/validators/niif-json-validator.ts:596-619`  
**Verificado ejecutando:** sí

**Escenario medido:**

Ejecutado: un ECP con la fila etiquetada '3710VC Resultados Acumulados — Cierre Virtual (curator R8)' devuelve 0 errores y 0 warnings, y renderEquityChanges la imprime verbatim en el Markdown ('| 3710VC Resultados Acumulados — Cierre Virtual (curator R8) | $0,00 | ...') y niifJsonToEquityTable la lleva igual al PDF Elite. Contraprueba ejecutada: la MISMA cadena en balanceSheet.equity SI dispara E12. El riesgo no es teorico: el bloque vinculante alimenta esos codigos al modelo de forma explicita ('Ajuste residual absorbido en 3710VC: -$5.014.078,19', 'inyectada en cuenta virtual 3605VC'), y en una de las 7 corridas reales ya persistidas (.fase0-post/run1) la jerga 'Cierre Virtual' SI aparecio dentro del ECP.

**Corrección:**

Aplicar el mismo FICTITIOUS_PATTERN de E12 a equityChanges.rows[].label y a equityChanges.notes. El PUC (Decreto 2650/1993) es un catalogo cerrado en el ECP igual que en el Balance.

#### P2 · ECP-06 — El blocker V4 se llama 'ECP === patrimonio del balance' y no mira el ECP: da garantia falsa

**Dónde:** `src/lib/pillars/audit-report-emittable.ts:193-202`  
**Verificado ejecutando:** sí

**Escenario medido:**

V4 compara BigInt(snapshot.summary.totalEquity*100) contra snapshot.controlTotals.cents.patrimonio. Ambas son cifras del PREPROCESADOR. La firma de auditReportEmittable (audit-report-emittable.ts:111-116) recibe FinancialReport + PeriodSnapshot + company: el NiifReportJson que contiene equityChanges NUNCA entra a la funcion. Escenario: un ECP cuyo closing_balance.total declare $1,00 frente a un patrimonio de $2.223.439.991,54 deja V4 en verde, porque V4 esta comprobando que el preprocesador es coherente consigo mismo. El unico control real del cierre del ECP es E4, y ya vimos (ECP-02) que su veredicto no sella nada.

**Corrección:**

Renombrar V4 a lo que de verdad comprueba (coherencia interna del snapshot) y, si se quiere el blocker que el nombre promete, pasarle el NiifReportJson y cruzar closing_balance.total contra controlTotals.cents.patrimonio con tolerancia 0n.

#### P2 · ECP-07 — El Excel entregable no contiene el Estado de Cambios en el Patrimonio (ni el EFE)

**Dónde:** `src/lib/export/excel-export.ts:320`  
**Verificado ejecutando:** sí

**Escenario medido:**

Las hojas que crea el libro son exactamente seis: 'Balance NIIF' (:320), 'Estado Resultados' (:750), 'KPIs' (:879), 'Validacion' (:1136), 'Resumen' (:1240) y 'Pulido Diamante' (:1602). Verificado por grep exhaustivo de addWorksheet(. Ademas grep de 'cashFlowStatement|Flujos de Efectivo' sobre el archivo devuelve 0 coincidencias. El cliente que descarga el Excel recibe dos de los cuatro estados financieros. El Markdown y el PDF Elite si llevan el ECP.

**Corrección:**

Anadir hoja 'Cambios en Patrimonio' (y 'Flujo de Efectivo') al libro, alimentadas desde niifAnalysis.json.equityChanges / .cashFlow, que ya viajan en el reporte.

**Normativa:** NIIF para las PYMES §3.17 (conjunto completo de estados financieros) y NIC 1 §10, vigentes en Colombia por el Decreto Unico Reglamentario 2420 de 2015 — Anexo 2 para Grupo 2, que es el grupo de esta entidad, incorporado por el Decreto 2483 de 2018 y que sigue conteniendo la version 2015 de la NIIF para las PYMES: la tercera edicion emitida por el IASB en febrero de 2025 AUN NO esta adoptada en Colombia (el CTCP la mantiene en su plan de trabajo del segundo semestre de 2026). Fuentes consultadas: funcionpublica.gov.co Gestor Normativo (norma.php?i=76745) e INCP.

#### P2 · ECP-08 — El ECP no admite periodo comparativo: el schema no tiene columnas comparativas y el prompt exige lo que el contrato no puede expresar

**Dónde:** `src/lib/agents/financial/contracts/niif-report.ts:125-148`  
**Verificado ejecutando:** sí

**Escenario medido:**

Verificado sobre la forma del schema en runtime: los campos de EquityChangeRowSchema son exactamente kind, label, capitalSocial, primaColocacion, reservaLegal, otrasReservas, resultadosAcumulados, resultadoEjercicio, ori, total. Ninguno es *Comparative. Sin embargo el prompt Pass-2 ordena 'MUST: ... amountComparative en lineas del EFE y filas del ECP DEBE reflejar esa cifra (incluso si es 0). NUNCA null-ear silenciosamente'. Sobre el balance real, con reportMode=COMPARATIVO_COMPLETO, el informe entrega un Balance y un P&G a dos columnas junto a un ECP de una sola: la fila opening_balance es lo unico que representa 2024. Ademas E9 —que si exige los seis totales comparativos— no cubre ninguna cifra del ECP.

**Corrección:**

O bien anadir el eje comparativo al ECP (segundo bloque de filas para el periodo anterior, que es la presentacion canonica), o bien declarar explicitamente en equityChanges.notes la impracticabilidad citando NIIF para PYMES §3.14/§10.21 en vez de emitir un estado a una columna dentro de un informe declarado comparativo.

**Normativa:** NIC 1 §38 exige informacion comparativa para todos los importes incluidos en los estados financieros del periodo corriente, y el estado de cambios en el patrimonio forma parte del conjunto completo por §10. El equivalente para Grupo 2 es NIIF para las PYMES §3.14. Fuente consultada: texto oficial de la NIC 1 en ifrs.org (html-standards/spanish/2022/issued/ias1.html). Marco vigente hoy en Colombia: Decreto 2420 de 2015. NIIF 18, que sustituye a la NIC 1 con vigencia internacional 01/01/2027, aun NO esta incorporada en Colombia: el CTCP la recomendo en diciembre de 2025 y el MinCIT publico el proyecto de decreto el 28/04/2026, con aplicacion obligatoria prevista para 2028 y voluntaria anticipada desde 2027 — asi que la cita del codigo a NIC 1 §106 es la correcta HOY, igual que su blocker V8 que prohibe mencionar IFRS 18 en informes de Grupo 2.

#### P2 · ECP-09 — E7a/E7b/E7c no corren si el modelo omite la fila `profit_for_period`, y ni el schema la exige ni hay un solo test que los cubra

**Dónde:** `src/lib/agents/financial/validators/niif-json-validator.ts:328`  
**Verificado ejecutando:** sí

**Escenario medido:**

Los tres checks viven dentro de `if (profitRow)`. Sin esa fila se cae al camino legacy, que solo compara el delta de resultadoEjercicio y solo cuando opening_balance.resultadoEjercicio no es material — las otras seis columnas quedan sin ningun control. Ejecutado: un ECP de dos filas donde capitalSocial pasa de 300.000 a 1 centavo y aparece una reserva legal inventada de 399.999 centavos devuelve 0 errores y 0 warnings. El schema no impone la fila (niif-report.ts:231-234 es un array sin refine): solo la pide el prompt. Y grep de 'E7a|E7b|E7c' sobre todos los *.test.ts del repo devuelve CERO coincidencias: los unicos tests de E7 (niif-json-validator.test.ts:194-228) ejercitan el camino legacy. Mitigante medido: en 8 corridas con LLM real sobre el balance de cliente, 8/8 emitieron profit_for_period — la exposicion es latente, no observada.

**Corrección:**

Exigir la fila en el propio schema (superRefine que obligue a profit_for_period cuando netIncomePrimary es material) o, mejor, ejecutar E7c SIEMPRE, con o sin esa fila. Y anadir tests: hoy tres reglas duras del ECP no tienen ninguno.

#### P3 · ECP-10 — La tolerancia de E7c es absoluta ($1.000 COP por columna), no relativa

**Dónde:** `src/lib/agents/financial/validators/niif-json-validator.ts:375`  
**Verificado ejecutando:** sí

**Escenario medido:**

Ejecutado: dos columnas desviadas $999,99 cada una en sentidos opuestos pasan sin salvedades. Con 7 columnas el margen acumulado es de ~$7.000 COP. Es la unica tolerancia no-$0 de todo el ECP y contrasta con E4, que si es exacta al centavo. Sobre este balance el importe es inmaterial; en un cierre que se firma, un descuadre de columna deberia ser $0 como el resto.

**Corrección:**

Bajar TOL a 0n. Las cifras viajan en BigInt centavos y las filas del ECP las autora el mismo modelo que ya cuadra al centavo el resto del informe: no hay fuente de redondeo que justifique el margen.

#### P3 · ECP-11 — Codigo muerto: la funcion `abs` del validador no tiene ningun importador

**Dónde:** `src/lib/agents/financial/validators/niif-json-validator.ts:709`  
**Verificado ejecutando:** sí

**Escenario medido:**

function abs(v: bigint) esta declarada al final del archivo, no se exporta y no se llama en ninguna parte del modulo (los cinco sitios que necesitan valor absoluto lo hacen inline con `x < ZERO ? -x : x`). No produce una cifra incorrecta; es ruido en el archivo que gobierna los invariantes del informe.

**Corrección:**

Borrarla, o usarla en los cinco sitios que repiten el ternario.

### Lo que este auditor NO pudo medir

- El ECP sobre un balance SIN periodo comparativo. El prompt ordena opening_balance.total = 0 cuando no hay comparativo (niif-analyst.prompt.ts:1146), lo que deja el saldo inicial sin ancla alguna y obliga al modelo a inventar movimientos por el patrimonio entero. Sobre el fixture patologico sin-comparativo.csv eso serian $383.000.000 de patrimonio de los cuales solo $187.000.000 son la utilidad del periodo: los otros $196.000.000 no tienen origen anclado. Es inferencia de codigo, no medicion — haria falta una corrida con LLM sobre ese fixture.
- El salto JSON->HTML del ECP. Medido estructuralmente: de las ~40 celdas numericas de un ECP de 5 filas, collectBindingFigures (html-editor.ts:296-314) declara vinculante UNA sola, equityChanges.closing_balance.total; las otras 39 las re-teclea el Editor Jefe sin reconciliacion. Ademas el Check 7 del validador HTML (html-editor-validator.ts:645-712) suma en VERTICAL y solo evalua filas que isTotalRow reconoce (clase con 'total', <tfoot>, o etiqueta que empiece por 'total'): la fila de cierre del ECP se llama 'Saldo al 31 de diciembre de 2025', asi que probablemente ni se evalua. NO ejecute el Editor Jefe con LLM real para confirmarlo.
- La distribucion del error. El repo tiene UN solo balance de cliente real. Mis conclusiones sobre el comportamiento del modelo se apoyan en 8 corridas (7 persistidas de la sesion anterior en .fase0/.fase0-post/.fase0-final2 + 1 que lance hoy) sobre ESE balance. 8 de 8 produjeron un ECP correcto en ambos ejes, con closing.total y opening.total exactos al centavo contra las anclas y sin fuga de cuentas virtuales. Ocho aciertos sobre un balance no son una garantia: los agujeros que reporto son estructurales y siguen abiertos.
- La columna reservaLegal contra la norma. Verifique que el Art. 371 del Codigo de Comercio (10% de las utilidades liquidas hasta el 50% del capital suscrito) NO obliga automaticamente a una SAS — Ley 1258 de 2008 art. 45 y Supersociedades Oficio 220-069664 del 27/03/2017 —, y el prompt de Gobierno ya lo modela bien con su rama isSAS. Pero en el ECP no hay codigo que produzca ni valide esa columna, asi que no habia nada que medir: solo constatar que esta libre.


---

## Gobierno corporativo

**Veredicto:** `sin-garantia`

### Resumen del auditor

Mi superficie no tiene una sola cifra garantizada. El acta societaria —el documento que el cliente firma, inscribe en Cámara de Comercio y usa para repartir dinero— es hoy 100% autorada por el LLM en su aritmética, y ningún validador la cruza contra el preprocesador en el camino que usa el producto.\n\nMEDIDO EJECUTANDO, sobre el balance real (NIT 901.714.014-6, utilidad neta determinista $2.228.496.789,73): construí un informe con la reserva legal calculada sobre el patrimonio en vez de sobre la utilidad ($222.343.999,15 en vez de $222.849.678,97) y con la capitalización deslizada de 40% a 4% ($89.139.871,58 en vez de $891.398.715,89). validateConsolidatedReport devolvió ok:true con cero errores y cero advertencias; auditReportEmittable devolvió emittable:true con cero bloqueantes. Ningún blocker menciona reserva, capitalización ni distribución. Un error de $802 millones en la proposición de capitalización atraviesa el sistema entero sin una sola señal.\n\nLA CAUSA ES LA MISMA QUE ENCONTRÓ LA AUDITORÍA INTEGRAL: los gates existen pero están desconectados. CHECK 4 (`applyCheck4ActaVsPL`) es la única ancla de la utilidad del acta y ni siquiera está exportado del módulo — su único call-site vive dentro de `orchestrateFinancialReport`, que está marcado @deprecated y que el navegador no usa. El navegador va por /api/financial-report/governance → runGovernancePhase, que emite dos eventos SSE y devuelve sin validar nada. El gate `auditReportEmittable` con V8/V9/V10 corre en el mismo sitio muerto; lo que sí corre, el pre-vuelo de Stage 0, los salta explícitamente con `skipReportTextChecks: true`. Y `report.emittability`, que alimenta la sección de bloqueantes del PDF Élite, sólo lo escribe el orquestador legacy: en producción llega undefined.\n\nY cuando ese gate se cablee, va a bloquear lo correcto. V9 —el que vigila que una SAS no constituya reserva legal— dispara contra el texto LITERAL que el propio prompt ordena escribir para las SAS conformes: medí ocho redacciones y dispara en cuatro, incluida la mandatoria. Con el gate completo y V12 neutralizado, el acta SAS conforme sale emittable:false con V9 como único bloqueante. El test que lo cubre lo evalúa contra la cadena '# Informe stub para test': el fixture convierte el caso peligroso en el caso neutro, exactamente el patrón que la sesión anterior ya había identificado.\n\nEN NORMATIVA hay cuatro defectos verificados contra fuente oficial. (1) El acta afirma que la capitalización queda exenta por el Art. 36-3 E.T.; ese beneficio, para utilidades que exceden la porción no gravada, aplica exclusivamente a sociedades que cotizan en bolsa — la del fixture es una SAS cerrada. (2) La distribución por defecto 10/50/40 deja $891.398.715,89 de dividendo cuando el mínimo del Art. 155 C.Co. es $1.114.227.034,86: un déficit de $222.828.318,97 que sólo el voto del 78% habilita, y el prompt prohíbe expresamente declarar porcentajes de capital representado. (3) El bloque normativo compartido atribuye la reserva legal de las SAS al Art. 40 de la Ley 1258/2008, que regula el arbitraje societario; la correcta es el Art. 45 (Remisión), que el prompt del Agente 3 sí cita bien. (4) La proposición de capitalización cita el Art. 5 (contenido del documento de constitución) para una reforma estatutaria, cuyo artículo es el 29. Además, el describe del schema del Auditor Legal ordena hablar de una «retención del 10% (Art. 242 E.T.)» que el prompt del mismo agente prohíbe y que la norma vigente contradice (0% hasta 1.090 UVT, 15% sobre el exceso; sobre esa distribución la diferencia son $36.006.786,79).\n\nDOS COSAS QUE DESCARTO CON ARGUMENTO. Primera: CHECK 4 ya NO autocorrige el acta. La acusación de la auditoría previa era cierta y dejó de serlo en el commit 86559f32 («acta honesta»); la función declara «este check NO muta el JSON del acta» y la nota que redacta termina en «el texto del acta no fue modificado». Lo único que queda de aquello es un comentario obsoleto en la línea 1900. Segunda: el 40% de capitalización NO tiene fundamento normativo, y el repositorio ya lo sabe — `derive-ancora-view.ts:16-18` lo declara literalmente «heurístico estratégico… NO porcentaje legal». El problema no es que el 40% esté mal calculado: es que el acta lo presenta como una proposición societaria con cita legal, y encima compromete el mismo importe dos veces (el 40% capitalizable es exactamente el 40% que la misma tabla declara distribuible).\n\nLO QUE FALTA POR ENCIMA DE TODO ESO: el techo del Art. 452 no se evalúa y no se puede evaluar — en el balance real la Clase 3 son tres renglones (37100501 por -$42.720 y dos cuentas virtuales del curator), sin cuentas 31 ni 33, así que capitalSuscritoPagado y reservaLegal llegan undefined al Agente 3. Con capital suscrito inexistente el techo es $0 y la apropiación exigible es $0, pero el prompt ordenaría $222.849.678,97 en cuanto alguien marque la entidad como SA o LTDA. Y el interruptor que decide todo el régimen, `estatutosRequierenReservaLegal`, no tiene ningún productor en el repositorio: es siempre undefined, así que toda SAS declara —sobre sus propios estatutos, con firma del representante legal— algo que nadie le preguntó.\n\nEL CAMINO DE SALIDA es el mismo que ya funcionó para el Balance. `money.ts:74` tiene `pctFloorMoneyCop` en BigInt y ningún consumidor del acta lo usa. El 10%, el 40% y cada renglón de destinación son proyecciones deterministas de una cifra que el preprocesador ya conoce al centavo; no son juicio contable. Mientras el modelo los autore, el techo de esta superficie no es «entrega bien» — es «ni siquiera detecta que entregó mal».

### Inventario cifra por cifra

| Cifra | Estado | Productor | Validador |
|---|---|---|---|
| Utilidad Neta del Ejercicio en el acta (shareholderMinutes.resultDistribution.netIncomeCop) | **LIBRE** | `src/lib/agents/financial/agents/governance-specialist.ts:97-107 (el LLM la autora dentro de GovernanceReportSchema); render en :176-178` | src/lib/agents/financial/orchestrator.ts:2098-2134 applyCheck4ActaVsPL, tolerancia 1 centavo. NO CORRE EN PRODUCCION: único call-site en :1901 dentro de orchestrateFinancialReport (legacy, @deprecated). Medido: la función NO está exportada — exports reales del módulo = BalanceValidationError, extrac |
| Líneas de destinación de resultados (10% reserva legal / 50% reserva ocasional / 40% distribuible) | **LIBRE** | `Regla en src/lib/agents/financial/prompts/governance-specialist.prompt.ts:130 y :170; contrato en contracts/governance-report.ts:156-167; render pass-through en agents/governance-specialist.ts:179-190` | NINGUNO. Medido ejecutando: validateConsolidatedReport → ok:true, 0 errores, 0 warnings; auditReportEmittable → emittable:true, 0 blockers, con la reserva legal falsificada. |
| capitalizationProposal.retainedEarningsBaseCop (base del 40%) | **LIBRE** | `prompt governance-specialist.prompt.ts:133 y :172-176; contrato contracts/governance-report.ts:169-175` | NINGUNO. CHECK 4 sólo compara netIncomeCop; no toca base ni monto. |
| capitalizationProposal.capitalizationAmountCop (= base × 0,40) | **LIBRE** | `prompt governance-specialist.prompt.ts:150 y :174; render en agents/governance-specialist.ts:192-201` | NINGUNO (medido). |
| Régimen de reserva legal (aplica SÍ/NO) + cita normativa | **DETERMINISTA** | `src/lib/agents/financial/prompts/governance-specialist.prompt.ts:46-65 (isSAS + estatutosRequierenReservaLegal → reservaLegalAplica, reserveLegalCitation)` | src/lib/pillars/audit-report-emittable.ts:275-289 (V9) — NO corre en producción (ver hallazgo GOV-02) y además tiene falso positivo (GOV-03). |
| Techo del Art. 452 C.Co. (reserva legal ≤ 50% del capital suscrito) | **LIBRE** | `No lo calcula nadie. El desglose patrimonial que llega al Agente 3 se arma en orchestrator.ts:581-598 con `fmtCop` y SIN token MoneyCop.` | NINGUNO |
| Retención en la fuente sobre dividendos (Art. 242 E.T.) en el acta | **LIBRE** | `No existe: no hay campo en ShareholderMinutesSchema / ResultDistributionSchema ni instrucción en el prompt.` | NINGUNO |
| patrimonyDistribution del Auditor Legal (montoReserva10pctCop, utilidadDisponibleCop) — Parte IV | **LIBRE** | `src/lib/agents/financial/contracts/audit-report.ts:501-522; agente en audit/agents/legal-auditor.ts:42-45 (callFinancialAgent)` | NINGUNO |
| D7 «acta cumple ley aplicable, reserva legal 10%» (meta-auditoría Parte V) | **LIBRE** | `src/lib/agents/financial/quality/prompt.ts:51; agente en quality/agent.ts:47-50 (callFinancialAgent)` | Es él mismo un LLM: LLM juzgando a LLM, sin fuente determinista. |
| Cifras del acta al llegar al HTML/PDF | **LIBRE** | `src/lib/agents/financial/agents/html-editor-validator.ts:834-869` | reconcileBindingFigures corre en producción (html-editor.ts:277) PERO `collectBindingFigures(input.niifReport)` sólo toma cifras del NIIF; `collectPayloadRenderings(input)` (:777-819) camina TODO el payload incluido `governanceReport` para construir la lista de PERMITIDAS. |

Reparto: **1** deterministas · **0** ancladas · **9** libres.

### Hallazgos

#### P0 · GOV-01 — Toda la aritmética del acta la autora el LLM y ningún validador la cruza contra el preprocesador

**Dónde:** `src/lib/agents/financial/prompts/governance-specialist.prompt.ts:130,133,170,172-176 + src/lib/agents/financial/agents/governance-specialist.ts:179-201`  
**Verificado ejecutando:** sí

**Escenario medido:**

Balance real grupo-empresarial-2tres-sas.xlsx, periodo 2025, utilidad neta determinista = $2.228.496.789,73 (cents 222849678973, medido). Entrada: se marca la entidad como SA (o LTDA) ⇒ el prompt ordena constituir el 10% de reserva legal. El modelo aplica el 10% sobre el PATRIMONIO ($2.223.439.991,54) en vez de sobre la utilidad y emite reserva legal = $222.343.999,15 en lugar de $222.849.678,97 (error $505.679,82); y sufre el desliz 40%→4% en la capitalización emitiendo $89.139.871,58 en lugar de $891.398.715,89 (error $802.258.844,31). Salida observada EJECUTANDO ambos validadores sobre ese informe consolidado: validateConsolidatedReport → ok:true, errors:[], warnings:[]; auditReportEmittable → emittable:true, blockers:[] (V12 neutralizado para aislar). Ningún blocker menciona reserva, capitalización ni distribución (medido: false). Además la suma de los tres renglones de destinación ($2.227.991.109,90) queda $505.679,83 por debajo de la utilidad declarada y tampoco se detecta.

**Corrección:**

Calcular en el preprocesador, en centavos BigInt, y entregarlas al prompt como anclas copiables `[MoneyCop: N]` igual que las del Balance: reservaLegalCents = pctFloorMoneyCop(utilidadNeta, 10) acotado por el techo del Art. 452, capitalizacionCents y cada renglón de destinación. Después de la respuesta del LLM, extender el reconciliador determinista (agents/reconcile-anchors.ts) a los campos del acta: sobrescribir amountCop de cada línea y capitalizationAmountCop, y reportar como salvedad que sum(lines) ≠ netIncomeCop. Es exactamente el movimiento de frontera que ya se hizo para el desglose del Balance en contracts/deterministic-breakdown.ts.

**Normativa:** Art. 452 C.Co. (reserva legal): «constituirán una reserva legal que ascenderá por lo menos al 50% del capital suscrito, formada con el 10% de las utilidades líquidas de cada ejercicio». Art. 371 C.Co. extiende la obligación a las Ltda. Fuentes: leyes.co/codigo_de_comercio/452.htm y Oficios Supersociedades 340-59858 y 340-48752 (supersociedades.gov.co).

#### P0 · GOV-02 — CHECK 4 y el gate V8/V9/V10 no corren en el camino que usa el producto

**Dónde:** `src/lib/agents/financial/orchestrator.ts:1899-1904 (call-site), :2098-2134 (función), :1447-1466 (pre-vuelo con skipReportTextChecks:true), :1983 (gate completo)`  
**Verificado ejecutando:** sí

**Escenario medido:**

El navegador corre PipelineWorkspace.tsx:2048/2258/2296 → /api/financial-report/{niif,strategy,governance} y ensambla el consolidado en el cliente (:2324). El route de gobierno (src/app/api/financial-report/governance/route.ts:190) llama runGovernancePhase, que en orchestrator.ts:1746-1785 sólo emite SSE y devuelve — cero validación. Medido: applyCheck4ActaVsPL NO está en los exports del módulo (lista real: BalanceValidationError, extractCompanyMetadata, orchestrateFinancialReport, prepareFinancialContext, renderSnapshotLines, runGovernancePhase, runNiifPhase, runStrategyPhase), luego ningún otro archivo puede invocarlo. El único gate que sí corre es el pre-vuelo de Stage 0 con `skipReportTextChecks: true`, que salta V8/V9/V10 por diseño. Consecuencia numérica: si el acta declara utilidad de $22,28 y el P&G $2.228.496.789,73 (el desliz /10^8 que el propio prompt documenta como bandera roja v2.2 #5), en producción nadie lo detecta ni lo nota al pie. El resultado de auditReportEmittable tampoco viaja: report.emittability sólo lo escribe orchestrateFinancialReport (:1993) y lo lee el compositor del PDF (lib/export/pdf-elite-react/compose.ts:1085); en el camino real es undefined, así que el PDF Élite se imprime sin sección de bloqueantes. Y ctx.preflight no tiene ningún consumidor fuera del orquestador (grep: 0 resultados).

**Corrección:**

Mover applyCheck4ActaVsPL y el gate de texto (V8/V9/V10) a runGovernancePhase, que es la única función que atraviesan tanto el camino legacy como el partido — el mismo patrón que ya se aplicó a auditReportEmittable en prepareFinancialContext. Sobre el JSON del acta el check ni siquiera necesita el markdown consolidado: govJson.shareholderMinutes vs niifJson.incomeStatement.netIncomePrimary. Y propagar el resultado al artefacto (sello CON SALVEDADES) en vez de a un evento SSE.

#### P1 · GOV-03 — V9 dispara contra el texto que el propio prompt ordena escribir: bloquearía toda SAS conforme

**Dónde:** `src/lib/pillars/audit-report-emittable.ts:412-422 (RESERVA_LEGAL_REGEX) + prompts/governance-specialist.prompt.ts:170`  
**Verificado ejecutando:** sí

**Escenario medido:**

El prompt ordena, para SAS sin habilitación estatutaria, el neutralProposalText LITERAL: «…sin constitución de reserva legal por no exigirla los estatutos sociales (Art. 45 Ley 1258/2008 …)». RESERVA_LEGAL_REGEX = /(constitución|constituye|aplicación|aplicar|apropiar|apropiación|asignación)\s+(?:la\s+|una\s+|de\s+(?:la\s+)?)?reserva\s+legal/i captura «constitución de reserva legal» aunque venga precedido de «sin». Medido ejecutando reportConstituyeReservaLegal sobre 8 redacciones: DISPARA con (a) el neutralProposalText literal del prompt, (b) «La entidad no constituye reserva legal por no exigirlo los estatutos», (c) «No aplica la constitución de la reserva legal en esta SAS», (d) «Art. 40 Ley 1258/2008» en orden natural español. Sólo NO dispara con «Reserva legal NO obligatoria» y con la cita del bloque compartido tal como está escrita (orden invertido). Ejecutando el gate completo con el acta SAS conforme y V12 neutralizado: emittable:false con V9 como ÚNICO bloqueante. Es decir: si mañana se cablea V9 (GOV-02), todo informe de SAS —que es el default de entityType— pasa a NO EMITIBLE por decir correctamente que no constituye reserva. El test que supuestamente lo cubre (src/__tests__/integration-grupo-empresarial-2tres-sas.test.ts:161) lo evalúa contra consolidatedReport = '# Informe stub para test', un texto sin acta: el fixture convierte el caso peligroso en el caso neutro.

**Corrección:**

Añadir look-behind negativo por negación en RESERVA_LEGAL_REGEX (`sin`, `no `, `no aplica`, `NO obligatoria`) o, mejor, dejar de inspeccionar prosa: V9 puede leer el JSON estructurado — govJson.shareholderMinutes.resultDistribution.applies === true y alguna línea cuyo label o normReference cite reserva legal. Y sustituir el stub del test por el acta que el prompt realmente ordena.

**Normativa:** Ley 1258/2008 Art. 45 (Remisión) es la cita correcta y el prompt la usa bien; verificado en funcionpublica.gov.co/eva/gestornormativo/norma.php?i=34130 y leyes.co/se_crea_la_sociedad_por_acciones_simplificada/45.htm. La doctrina que invoca existe: Supersociedades Oficio 220-115333 del 15-09-2009 y Oficio 220-069664 del 27-03-2017 — la reserva legal no es obligatoria en la SAS salvo previsión estatutaria.

#### P1 · GOV-04 — El acta afirma que la capitalización queda exenta por el Art. 36-3 E.T.; para una sociedad no listada en bolsa eso no es cierto

**Dónde:** `src/lib/agents/financial/prompts/governance-specialist.prompt.ts:175 (texto LITERAL de la proposición) y :133 (legalReference)`  
**Verificado ejecutando:** no

**Escenario medido:**

Con la utilidad real de $2.228.496.789,73 el prompt ordena emitir, palabra por palabra, una proposición de capitalizar $891.398.715,89 que termina: «Este movimiento queda exento del impuesto a los dividendos conforme E.T. art. 36-3, al constituir una reorganización patrimonial sin distribución efectiva». El Art. 36-3 E.T. declara INCRNGO (i) la capitalización de la cuenta de Revalorización del Patrimonio, de la reserva del art. 130 y de la prima en colocación de acciones, y (ii) —sólo «en el caso de las sociedades cuyas acciones se cotizan en bolsa»— la capitalización de las utilidades que excedan la porción no gravada de los arts. 48 y 49. La entidad del fixture es una SAS cerrada. Resultado: el acta entrega al accionista una afirmación tributaria favorable sobre $891.398.715,89 que no le aplica, sin haber calculado el máximo no gravado del Art. 49 (que el pipeline tampoco calcula en esta superficie). Es la clase de afirmación que expone al cliente ante el Art. 647 E.T.

**Corrección:**

Condicionar el texto: si la sociedad no cotiza en bolsa, la capitalización de utilidades corrientes se rige por los arts. 48/49 E.T. (la porción no gravada es INCRNGO por serlo el dividendo, no por el 36-3) y el exceso es dividendo gravado. Retirar la afirmación categórica de exención o exigir el cálculo previo del máximo no gravado del Art. 49. La cita del 36-3 sólo se sostiene si lo capitalizado es Revalorización del Patrimonio, reserva art. 130 o prima en colocación.

**Normativa:** Art. 36-3 E.T. «Capitalizaciones no gravadas para los socios o accionistas», última modificación Ley 1819 de 2016. Verificado en actualicese.com/estatutotributario/36-3/ y estatuto.co/36-3: el beneficio para utilidades que exceden la parte no gravada de los arts. 48/49 aplica exclusivamente a sociedades cuyas acciones se cotizan en bolsa.

#### P1 · GOV-05 — La distribución por defecto (10/50/40) deja el dividendo por debajo del mínimo legal del Art. 155 C.Co., y el prompt prohíbe declarar la mayoría que lo habilitaría

**Dónde:** `src/lib/agents/financial/prompts/governance-specialist.prompt.ts:130 y :170 (10% legal + 50% ocasional + 40% distribuible, presentados como «porcentajes legalmente tipificados») + :165 (prohibición de declarar porcentajes de capital)`  
**Verificado ejecutando:** sí

**Escenario medido:**

Balance real, utilidad neta $2.228.496.789,73, pérdidas de ejercicios anteriores -$42.720,00. Base del Art. 155 = $2.228.454.069,73; dividendo mínimo legal (50%) = $1.114.227.034,86. El acta que ordena el prompt propone como distribuible el 40% = $891.398.715,89 — un déficit de $222.828.318,97 frente al mínimo. Ese reparto sólo es válido con el voto favorable del 78% de las acciones representadas (Art. 155 C.Co., modificado por el art. 240 de la Ley 222/1995), pero la misma línea :165 del prompt obliga a redactar el quorum como «se verificó el quorum conforme a los estatutos sociales» y prohíbe expresamente citar porcentajes de capital representado. El acta resultante propone una destinación que requiere supermayoría sin dejar constancia de ella: es impugnable por ese solo defecto. Agravante medido: el 40% capitalizable ($891.398.715,89) es exactamente el mismo importe que el 40% «distribuible», así que el acta compromete el mismo dinero dos veces; y 10+50+40 con truncamiento suma $2.228.496.789,72, un centavo por debajo de la utilidad.

**Corrección:**

Dejar de presentar 10/50/40 como «legalmente tipificado». Lo tipificado es: 10% de reserva legal (Art. 452 C.Co., con techo) y, del resto, un mínimo del 50% de las utilidades líquidas a dividendo salvo aprobación del 78% (Art. 155 C.Co.). Si el acta propone retener por encima de ese umbral, el schema debe exigir un campo estructurado con la mayoría efectivamente obtenida y el renderer imprimirla; si no se conoce, el acta debe caer al reparto mínimo legal. Y resolver el doble compromiso del 40%: capitalizar y distribuir la misma porción es aritméticamente imposible.

**Normativa:** Art. 155 C.Co., modificado por el art. 240 de la Ley 222 de 1995: la distribución se aprueba con el voto favorable de por lo menos el 78% de las acciones representadas; sin esa mayoría se repartirá como mínimo el 50% de las utilidades líquidas o del saldo tras enjugar pérdidas de ejercicios anteriores. Art. 454 C.Co.: 70% cuando las reservas superan el 100% del capital suscrito. Fuentes: leyes.co/codigo_de_comercio/155.htm y Oficio Supersociedades 220-081667.

#### P1 · GOV-06 — Falta el techo del Art. 452 y el balance no trae los datos para evaluarlo; el acta apropiaría una reserva que no es exigible

**Dónde:** `src/lib/agents/financial/orchestrator.ts:581-598 (desglose patrimonial sin capital suscrito ni reserva legal, y sin token MoneyCop) + prompts/governance-specialist.prompt.ts:170 (regla sin condición de techo)`  
**Verificado ejecutando:** sí

**Escenario medido:**

Medido sobre el balance real: la Clase 3 completa son tres renglones — 37100501 «Otros aportes de capital» -$42.720,00 y las dos cuentas virtuales del curator 3605VC / 3710VC. No hay cuentas 31 (capital social) ni 33 (reservas): equityBreakdown.capitalSuscritoPagado = undefined, equityBreakdown.reservaLegal = undefined. Bajo el Art. 452 el techo es 50% × capital suscrito = $0,00, ya alcanzado, luego la apropiación legalmente exigible es $0,00. Si el usuario marca la entidad como SA o LTDA, el prompt ordena apropiar $222.849.678,97. Nadie lo contrasta: el bloque vinculante que recibe el Agente 3 imprime «Desglose patrimonio: utilidad del ejercicio $2.228.496.789,73, utilidades acumuladas -$42.720,00» y nada más. El bloque compartido sí menciona el techo (colombia-2026-context.ts:132) pero como marco general; la instrucción operativa no lo condiciona y el dato no viaja.

**Corrección:**

Emitir capitalSuscritoPagado y reservaLegal como anclas con token MoneyCop en el bloque vinculante y calcular en código reservaExigible = min(10% × utilidadLíquida, max(0, 50% × capitalSuscrito − reservaExistente)). Si el capital suscrito no está en el balance, el acta debe declararlo como dato faltante en preparerNotes en vez de apropiar una cifra, y el gate debe reportarlo.

**Normativa:** Art. 452 C.Co.: alcanzado el 50% del capital suscrito la sociedad no está obligada a seguir apropiando el 10%; si disminuye, vuelve a apropiarlo hasta el límite. Verificado en leyes.co/codigo_de_comercio/452.htm.

#### P1 · GOV-07 — El discriminador legal más importante del acta, `estatutosRequierenReservaLegal`, no tiene productor en todo el repositorio

**Dónde:** `src/lib/agents/financial/orchestrator.ts:2160-2168 (getEstatutosFlag) + prompts/governance-specialist.prompt.ts:57-60 + pillars/audit-report-emittable.ts:280`  
**Verificado ejecutando:** sí

**Escenario medido:**

grep sobre todo src: sólo hay CONSUMIDORES (orchestrator.ts:1456, :1970, :2165; el prompt; el gate). Ninguna pantalla de intake, ningún schema de request y ninguna Server Action lo escribe (DueDiligenceIntake.tsx, NiifReportIntake.tsx y GenericPipelineIntake.tsx capturan entityType pero no este flag). Resultado: siempre `undefined`. Consecuencia concreta: una SAS cuyos estatutos SÍ prevén la reserva legal (perfectamente frecuente) recibe un acta que declara «sin constitución de reserva legal por no exigirla los estatutos sociales» — una afirmación falsa sobre sus propios estatutos, firmada por el representante legal. En el balance real eso significa omitir una apropiación de $222.849.678,97 legítimamente debida.

**Corrección:**

Capturarlo en el intake como tri-estado explícito (sí / no / no verificado) y, cuando sea «no verificado», que el acta lo declare en preparerNotes en lugar de afirmar categóricamente el régimen. El tipo ya es tri-estado (`boolean | undefined`) — falta el productor y falta que el prompt distinga «no» de «no sé».

#### P2 · GOV-08 — El bloque normativo compartido atribuye la reserva legal de las SAS al Art. 40 de la Ley 1258/2008, que regula la resolución de conflictos societarios

**Dónde:** `src/lib/agents/financial/prompts/colombia-2026-context.ts:134 (ES) y :231 (EN)`  
**Verificado ejecutando:** sí

**Escenario medido:**

El bloque dice «Ley 1258 de 2008 — SAS — Art. 40 (reserva legal para SAS, aplicable cuando los estatutos así lo disponen)» y se antepone a los TRES agentes, incluido el de Gobierno (governance-specialist.prompt.ts:74 lo inyecta; medido: el prompt construido contiene esa línea = true). El Art. 40 de la Ley 1258/2008 es «Resolución de conflictos societarios» (arbitraje o amigables componedores). El artículo pertinente es el 45 (Remisión), que es el que el prompt del Agente 3 cita correctamente en :63 y :170. Doble daño: (a) el informe puede salir citando un artículo que no dice lo que se afirma; (b) si el modelo reescribe la cita en orden natural español —«Art. 40 Ley 1258/2008»— el gate V9 la trata como flag rojo automático (audit-report-emittable.ts:419) y bloquea el informe. Medido ejecutando: reportConstituyeReservaLegal('Régimen: Art. 40 Ley 1258/2008 — la reserva legal no se constituye.') = true.

**Corrección:**

Cambiar Art. 40 por Art. 45 (Remisión) en las dos versiones del bloque, y alinear el detector de V9 con esa cita.

**Normativa:** Ley 1258 de 2008: Art. 40 = Resolución de conflictos societarios; Art. 45 = Remisión. Verificado en funcionpublica.gov.co/eva/gestornormativo/norma.php?i=34130 y leyes.co/se_crea_la_sociedad_por_acciones_simplificada/45.htm.

#### P2 · GOV-09 — La proposición de capitalización cita el Art. 5 de la Ley 1258/2008 para una reforma estatutaria; la norma aplicable es el Art. 29

**Dónde:** `src/lib/agents/financial/prompts/governance-specialist.prompt.ts:133 y :175`  
**Verificado ejecutando:** no

**Escenario medido:**

El texto LITERAL que ordena el prompt dice «mediante reforma estatutaria conforme Ley 1258/2008 art. 5 (SAS) — documento privado inscrito en Cámara de Comercio», y legalReference = «Ley 1258/2008 art. 5 (SAS) + E.T. art. 36-3». El Art. 5 de la Ley 1258/2008 es «Contenido del documento de constitución» (nombre de los accionistas, denominación, domicilio, término de duración…). Las reformas estatutarias están en el Art. 29: se aprueban con el voto favorable de accionistas que representen cuando menos la mitad más una de las acciones presentes y constan en documento privado inscrito en el registro mercantil, salvo que impliquen transferencia de bienes por escritura pública. El acta de capitalización de $891.398.715,89 sale citando el artículo equivocado y omitiendo la mayoría que el Art. 29 exige.

**Corrección:**

Sustituir la cita por «Ley 1258/2008 art. 29 (reformas estatutarias)» e incorporar al acta la constancia de la mayoría del art. 29.

**Normativa:** Ley 1258 de 2008 Art. 5 (contenido del documento de constitución) y Art. 29 (reformas estatutarias). Verificado en leyes.co/se_crea_la_sociedad_por_acciones_simplificada/29.htm y en la guía práctica de la Cámara de Comercio de Barranquilla (camarabaq.org.co).

#### P2 · GOV-10 — El describe del schema del Auditor Legal ordena al modelo hablar de una retención del 10% del Art. 242 E.T. que su propio prompt prohíbe

**Dónde:** `src/lib/agents/financial/contracts/audit-report.ts:519-521 vs src/lib/agents/financial/audit/prompts/legal-auditor.prompt.ts:111`  
**Verificado ejecutando:** no

**Escenario medido:**

El campo impuestoDividendosComment lleva .describe('Comentario sobre la retención del 10% (Art. 242 E.T.) o aplicabilidad.'). Ese describe viaja al modelo dentro del JSON Schema de `experimental_output` (el agente usa callFinancialAgent con LegalAuditReportSchema, legal-auditor.ts:42-45). El prompt del mismo agente termina con «NEVER escribas 'retencion 10%' asociada al Art. 242 E.T.». El modelo recibe la orden y su contraria en la misma llamada. La cifra correcta hoy es: 0% hasta 1.090 UVT y 15% sobre el exceso (parágrafo del Art. 242 E.T., reglamentado por el Decreto 1103 de 2023); el 10% trasladable e imputable es el Art. 242-1 (sociedades nacionales) y el 20% es el Art. 245 (no residentes). Con la UVT 2026, 1.090 UVT = $57.087.660, de modo que sobre una distribución de $891.398.715,89 a persona natural residente la retención es (891.398.715,89 − 57.087.660) × 15% = $125.146.658,38 — no $89.139.871,59 como saldría del 10%: una diferencia de $36.006.786,79 en un dictamen que el cliente usa para decidir el reparto.

**Corrección:**

Reescribir el describe: «Comentario sobre la retención del parágrafo del Art. 242 E.T. (0% hasta 1.090 UVT; 15% sobre el exceso) y, si aplica, Art. 242-1 (10% sociedades nacionales) o Art. 245 (20% no residentes)».

**Normativa:** Art. 242 E.T. (mod. art. 3 Ley 2277/2022) y su parágrafo reglamentado por el Decreto 1103 de 2023: 0 a 1.090 UVT → 0%; sobre el exceso de 1.090 UVT → 15%. Verificado en el texto oficial de normograma.dian.gov.co/dian/compilacion/docs/decreto_1103_2023.htm (vigente desde 01-ene-2023). UVT 2026 = $52.374, Resolución DIAN 000238 del 15-dic-2025 (confirmada en incp.org.co y en el Comunicado de Prensa 128 de 2025 de la DIAN) ⇒ 1.090 UVT = $57.087.660. La ley de financiamiento fue hundida por la Comisión Cuarta del Senado el 09-dic-2025 y la reforma radicada el 20-jul-2026 aún no es ley, así que el marco de la Ley 2277/2022 sigue vigente en 2026.

#### P2 · GOV-11 — El orden del día y la reserva ocasional se atribuyen a «Art. 187 Ley 222/1995»; el Art. 187 es del Código de Comercio

**Dónde:** `src/lib/agents/financial/prompts/governance-specialist.prompt.ts:129,170,212,217,219 y contracts/governance-report.ts:209-213`  
**Verificado ejecutando:** no

**Escenario medido:**

Seis apariciones citan «Art. 187 Ley 222/1995» como fuente del orden del día canónico y del 50% de reserva ocasional. Las funciones de la asamblea/junta de socios están en el Art. 187 del Código de Comercio. La Ley 222/1995 interviene en esta materia por su art. 240, que modificó el Art. 155 C.Co. (mayoría del 78% y mínimo del 50%). El acta que firma el cliente sale con una cita normativa inexistente en cinco puntos del orden del día, y además el 50% de reserva ocasional se presenta como si tuviera respaldo legal cuando es justo lo contrario (ver GOV-05).

**Corrección:**

Sustituir por «Art. 187 C.Co.» donde se trate de funciones de la asamblea, y por «Art. 155 C.Co. (mod. art. 240 Ley 222/1995)» donde se trate de la destinación de utilidades. Mantener «Art. 46 Ley 222/1995» para el informe de gestión, que sí es correcto.

**Normativa:** Art. 187 C.Co. — funciones de la junta de socios o asamblea. Art. 240 Ley 222/1995 — modifica el Art. 155 C.Co. Verificado en secretariasenado.gov.co/senado/basedoc/codigo_comercio_pr004.html y funcionpublica.gov.co/eva/gestornormativo/norma.php?i=6739.

#### P2 · GOV-12 — Las cifras del acta se blanquean como «rastreables» en la reconciliación del HTML

**Dónde:** `src/lib/agents/financial/agents/html-editor-validator.ts:777-819 (collectPayloadRenderings) y :855-869 (regla R2)`  
**Verificado ejecutando:** no

**Escenario medido:**

reconcileBindingFigures sí corre en producción (html-editor.ts:277). Pero las cifras VINCULANTES que exige (R1) salen sólo de collectBindingFigures(input.niifReport), mientras el conjunto de cifras PERMITIDAS (R2) se construye caminando todo el payload, `governanceReport` incluido (HtmlEditorInputSchema:169). Escenario: el acta emite la reserva legal falsa de $222.343.999,15; al llegar al HTML esa cifra está en el conjunto `allowed` porque proviene del JSON de gobierno, así que R2 no la marca como no rastreable y R1 nunca la buscó. El error atraviesa el HTML y el PDF sin una sola señal.

**Corrección:**

Añadir las cifras del acta al conjunto de figuras VINCULANTES (R1) una vez existan como anclas deterministas (GOV-01), en lugar de sólo al conjunto permitido.

#### P3 · GOV-13 — El detector de frases evasivas y de vocabulario prohibido nunca bloquea, aunque el prompt lo anuncia como bloqueante

**Dónde:** `src/lib/agents/financial/agents/governance-specialist.ts:115-126 vs prompts/governance-specialist.prompt.ts:196`  
**Verificado ejecutando:** no

**Escenario medido:**

detectForbiddenPhrasesInJson devuelve los hits y el agente hace console.warn + un evento SSE `stage_progress` con el conteo; el resultado se descarta y `result` se devuelve igual. El prompt le dice al modelo «El detector regex post-generación captura estas palabras como violaciones bloqueantes» (:196). No lo son. Un acta con «un año sólido y excelente» sale al cliente idéntica a una limpia.

**Corrección:**

O bien propagar los hits al artefacto como salvedad (el mecanismo de sello CON SALVEDADES ya existe), o bien corregir el prompt para no prometer una consecuencia que no ocurre.

#### P3 · GOV-14 — El comentario del call-site sigue afirmando que CHECK 4 autocorrige el acta — la autocorrección se retiró hace tiempo

**Dónde:** `src/lib/agents/financial/orchestrator.ts:1899-1900`  
**Verificado ejecutando:** sí

**Escenario medido:**

El comentario dice «CHECK 4 … Autocorrige el acta si difieren y agrega la nota tecnica al pie del reporte». La función (:2085-2134) documenta y hace lo contrario: «este check NO muta el JSON del acta» y la nota redactada termina en «el texto del acta no fue modificado». `git log -S` sitúa el cambio de comportamiento en el commit 86559f32 («acta honesta»); el comentario del call-site viene de 1b9ea84c y nunca se actualizó. DESCARGO EXPRESO: la acusación de la auditoría previa —«autocorregir un acta societaria sin decirlo»— ya no es cierta en el código de hoy; lo único que queda es el comentario obsoleto. El problema real de CHECK 4 es otro y es peor: no corre (GOV-02).

**Corrección:**

Borrar la frase «Autocorrige el acta si difieren» del comentario de :1900.

### Lo que este auditor NO pudo medir

- No corrí el Agente 3 con LLM real. El mandato pedía hacerlo sólo si la superficie lo exigía y no podía concluir de otro modo, y no lo exigía: todo lo que afirmo está medido sin LLM — (a) qué le pide el prompt, sobre el prompt construido con el balance real del cliente; (b) qué hacen los validadores, ejecutándolos sobre actas sintéticas con cifras derivadas del balance real. Lo que NO sé, por tanto, es la FRECUENCIA con que el modelo se equivoca hoy en el 10% de reserva legal o en el 40% de capitalización. Sé que si se equivoca, nadie lo ve. Medir esa frecuencia exige un harness tipo scripts/fase0-anchor-drift.ts apuntando a runGovernanceSpecialist y cruzando resultDistribution/capitalizationProposal contra pctFloorMoneyCop.
- No pude leer el texto oficial de los Oficios Supersociedades 220-115333/2009 y 220-069664/2017 en supersociedades.gov.co. Su existencia, fecha y sentido (la reserva legal no es obligatoria en la SAS salvo previsión estatutaria) están confirmados por fuentes secundarias especializadas (actualicese.com, accounter.co), no por el PDF oficial.
- No verifiqué si alguno de los decretos legislativos expedidos al amparo de la emergencia económica del Decreto 1390 de 2025 modificó el Art. 242 E.T. para 2026. Lo que sí verifiqué contra fuente oficial (normograma DIAN) es que el Decreto 1103 de 2023 —tabla 0% hasta 1.090 UVT / 15% sobre el exceso— sigue publicado como vigente, y que la ley de financiamiento fue hundida el 09-dic-2025 y la reforma radicada el 20-jul-2026 aún no es ley. Varios de esos decretos de emergencia están bajo revisión constitucional y el bloque colombia-2026-context.ts no los menciona.
- No medí el camino legacy /api/financial-report ni el slow-path de /export con LLM real. Ahí CHECK 4 y el gate completo sí corren; verifiqué por lectura y por los exports del módulo que ninguno de los dos es el camino que usa el navegador (PipelineWorkspace usa los endpoints partidos y el fast-path de export con el reporte ya construido, export/route.ts:63-81).
- No evalué la validación cruzada entre el acta del Agente 3 y el patrimonyDistribution del Auditor Legal (Parte IV): son dos cálculos independientes del mismo 10%, ambos del LLM. Comprobé que ninguno cita al otro; no medí cuánto divergen en una corrida real.


---

## Periodo comparativo del Balance (Estado de Situación Financiera) y del P&G (Estado de Resultados)

**Veredicto:** `sin-garantia`

### Resumen del auditor

Sí existe el retroceso que se sospechaba, y lo confirmé sobre los artefactos REALES de la medición de cierre del 2026-08-08 (.fase0-final2/), no sobre un caso construido. `completeBreakdownFromSnapshot` reemplaza la sección entera con `amountComparative: null`, y en las 2/2 corridas de cierre —las que el documento declara "0 desviaciones, 0 warnings, 0 errores"— el Balance salió con la columna 2024 en blanco: renderizado por el compositor real del PDF Élite, las 11 líneas de detalle dicen literalmente "n/c" mientras TOTAL ACTIVOS muestra $2.798.204.117,50. El informe se entrega como LIMPIO y descargable. Es incumplimiento directo de NIIF para las PYMES §3.14 ("información comparativa... para TODOS los importes presentados"). Y el arreglo ya está construido: `buildDeterministicBreakdown(pp.comparative, sec)` produce la columna comparativa exacta —lo ejecuté: 11/13/14/15/18 suman $2.798.204.117,50 al centavo— sólo que nadie se la pasa. Debajo de eso, la superficie es peor de lo que el retroceso sugiere: de las seis cifras comparativas que el modelo autora, cuatro están ancladas y aplicadas (el tríptico se sobrescribe, netIncomeComparative bloquea la descarga) pero grossProfitComparative, operatingProfitComparative y oriComparative son LIBRES —les puse $9.999.999.999,99 / $8.888.888.888,88 / $777.777.777,77 y salieron cero errores, cero warnings, cero desviaciones—, y el PDF llegó a imprimir dos EBIT comparativos distintos en la misma tabla. La columna comparativa del desglose tampoco tiene invariante: la puse a la mitad (brecha −$705.214.696,93) y nadie dijo nada; los 12 renglones del P&G comparativo a $0,01 tampoco. Y hay una cifra DETERMINISTA que está mal: `ingresosNetos` resta las devoluciones 4175 dos veces —ya vienen negativas dentro de la clase 4—, así que el ingreso comparativo del Áncora (A08) sale $1.446.700.612,59 cuando el real es $1.676.315.150,47, $229.614.537,88 de menos, y A10 arrastra el mismo error. Descarto tres sospechas con evidencia: las anclas comparativas SÍ cuadran A=P+K a $0 (sobrescribir el tríptico es seguro), E9 SÍ corre en producción y SÍ llega a la UI, y LINEA_BASE está bien manejado en el gate y en el bloque vinculante.

### Inventario cifra por cifra

| Cifra | Estado | Productor | Validador |
|---|---|---|---|
| balanceSheet.totalAssetsComparative | ANCLADA | `Autora el LLM en Pass-1: src/lib/agents/financial/agents/niif-analyst.ts:214-222 (schema src/lib/agents/financial/contracts/niif-report.ts:196)` | src/lib/agents/financial/agents/reconcile-anchors.ts:207-215 la SOBRESCRIBE con la del preprocesador + E9 en src/lib/agents/financial/validators/niif-json-validator.ts:496. CORRE en producción: orchestrator.ts:1598 dentro de runNiifPhase, invocado por src/app/api/financial-report/niif/route.ts:219 |
| balanceSheet.totalLiabilitiesComparative | ANCLADA | `LLM Pass-1` | reconcile-anchors.ts:216-223 (sobrescribe) + niif-json-validator.ts:497 (E9). CORRE |
| balanceSheet.totalEquityComparative | ANCLADA | `LLM Pass-1` | reconcile-anchors.ts:224-231 (sobrescribe) + niif-json-validator.ts:498 (E9). CORRE |
| incomeStatement.netIncomeComparative | ANCLADA | `LLM Pass-1` | reconcile-anchors.ts:232-238 (write:null → se REPORTA, no se corrige) + niif-json-validator.ts:501 (E9). CORRE |
| incomeStatement.grossProfitComparative | **LIBRE** | `LLM Pass-1 (niif-report.ts:215)` | NINGUNO. E9 sólo comprueba que no sea null (niif-json-validator.ts:466). El comentario de orchestrator.ts:158-161 lo admite: 'grossProfit/operatingProfit no se cruzan'. No hay binding en COMPARATIVE_BINDINGS. |
| incomeStatement.operatingProfitComparative | **LIBRE** | `LLM Pass-1 (niif-report.ts:217)` | NINGUNO. E5 (coherencia de la cascada) sólo lee *Primary — niif-json-validator.ts:245-273. |
| incomeStatement.oriComparative | **LIBRE** | `LLM Pass-1 (niif-report.ts:221)` | NINGUNO. Ni siquiera está en la lista NOT-NULL de E9 (niif-json-validator.ts:463-468). |
| balanceSheet.assets[].amountComparative / liabilities[] / equity[] (columna comparativa del desglose) | **LIBRE** | `LLM Pass-1; y el código la DESTRUYE en reconcile-anchors.ts:503 (`amountComparative: null`) cuando completa el desglose` | NINGUNO. E15 (niif-json-validator.ts:671-699) y el reconciliador (reconcile-anchors.ts:322-348) suman sólo `amountPrimary` — la firma de StatementLineLike en contracts/statement-lines.ts:30-35 ni siquiera declara el campo comparativo. |
| incomeStatement.lines[].amountComparative (renglones del P&G) | **LIBRE** | `LLM Pass-1 (contracts/base.ts:202)` | NINGUNO. No existe un E15 del P&G, ni primario ni comparativo. |
| company.comparativePeriod | **LIBRE** | `LLM Pass-1 → propagado literal por assembleNiifReport (contracts/niif-report.ts:376). El `effectiveCompany.comparativePeriod` que el código deriva en orchestrator.ts:1371-1396 NUNCA lo sobrescribe.` | NINGUNO — y además es la GUARDA de E9 (niif-json-validator.ts:460). |
| controlTotals.ingresosNetos (periodo comparativo) | **DETERMINISTA** | `src/lib/preprocessing/trial-balance.ts:1473` | N/A (lo calcula el código) — pero es INCORRECTA |
| controlTotals.ebit (periodo comparativo) | **DETERMINISTA** | `src/lib/preprocessing/trial-balance.ts:1478-1480` | N/A — hereda el error de ingresosNetos |
| Áncora A08 (Ingresos comparativo) y A10 (EBIT comparativo) | **DETERMINISTA** | `src/lib/agents/financial/ancora/build-ancora.ts:100-110 y 126-127` | N/A — INCORRECTAS por herencia |
| Áncora A02/A04/A06/A12/A14 (activo, pasivo, patrimonio neto, utilidad neta y efectivo comparativos) | **DETERMINISTA** | `src/lib/agents/financial/ancora/build-ancora.ts:118-131` | N/A |
| Bloque TOTALES VINCULANTES — sección '=== Periodo comparativo (2024) ===' | **DETERMINISTA** | `src/lib/agents/financial/orchestrator.ts:999-1002 → renderSnapshotLines (orchestrator.ts:417)` | N/A |
| Modo LINEA_BASE (anchors.comparative = null) | **DETERMINISTA** | `deriveReportMode en src/lib/preprocessing/v8-helpers.ts:93-108; buildPeriodAnchors devuelve null en contracts/anchors.ts:84` | N/A |

Reparto: **6** deterministas · **4** ancladas · **6** libres.

### Hallazgos

#### P0 · COMP-1 — El completado determinista del desglose BORRA la columna comparativa del Balance — el cliente recibe 'n/c' en todas las líneas

**Dónde:** `src/lib/agents/financial/agents/reconcile-anchors.ts:503 (amountComparative: null) y su call-site src/lib/agents/financial/agents/niif-analyst.ts:259-275`  
**Verificado ejecutando:** sí

**Escenario medido:**

Balance real grupo-empresarial-2tres-sas.xlsx (NIT 901.714.014-6, 2025 vs 2024). El modelo emite el desglose del Activo con la columna comparativa poblada —11 $1.563.485.554,01 / 13 $83.669.381,22 / 14 $1.150.059.923,99 / 15 $66.386,28, Σ = $2.797.281.245,50— pero omite el renglón del grupo 18 ($3.839.538,00 primario). El reconciliador detecta lineGap Activo −$3.839.538,00 y `completeBreakdownFromSnapshot` REEMPLAZA la sección entera: el primario queda perfecto ($4.185.978.841,16 al centavo, 5 renglones) y las 5 celdas comparativas quedan en null. Pérdida medida: $2.797.281.245,50 de columna comparativa. Ejecutado sobre los artefactos REALES de la medición de cierre (.fase0-final2/raw-*.json, 2026-08-08): en run 1 el código escribió assets+liabilities+equity (11/11 líneas con amountComparative=null) y en run 2 assets+liabilities (9/9 en null). Renderizado con el compositor real del PDF Élite (niifJsonToBalanceTable), la tabla sale con headers ["Cuenta","2025","2024"] y: '11 — Efectivo y equivalentes de efectivo | $2.413.677.888,64 | n/c' ... 'TOTAL ACTIVOS | $4.185.978.841,16 | $2.798.204.117,50'. En Markdown la celda sale VACÍA. Y reconciliation.clean queda true → sin sello de salvedades y con descarga habilitada. Frecuencia medida: 2 de 2 corridas post-fix sobre el único balance de cliente real.

**Corrección:**

`completeBreakdownFromSnapshot` debe recibir también el snapshot comparativo y poblar `amountComparative` con `buildDeterministicBreakdown(preprocessed.comparative, section)`, emparejando por código de grupo PUC (null sólo cuando el grupo no existe en el comparativo, que es el único caso legítimo bajo §3.14). Lo ejecuté y la proyección comparativa ya existe y cuadra al centavo: Activo 11 $1.563.485.554,01 + 13 $83.669.381,22 + 14 $1.150.059.923,99 + 15 $66.386,28 + 18 $922.872,00 = $2.798.204.117,50 = totalAssetsComparative; Pasivo 22/23/24/28 = $1.232.263.178,39; Patrimonio 36 $1.572.721.472,96 + 37 −$6.780.533,85 = $1.565.940.939,11. Es aritmética que el código ya sabe hacer y no está usando. Mientras no se haga, un desglose sin columna comparativa debería marcar clean=false, no salir limpio.

**Normativa:** NIIF para las PYMES §3.14 (texto oficial IFRS Foundation en español): 'A menos que esta NIIF permita o requiera otra cosa, una entidad revelará información comparativa respecto del periodo comparable anterior para todos los importes presentados en los estados financieros del periodo corriente.' §3.20: 'un conjunto completo de estados financieros significa que la entidad presentará, como mínimo, dos de cada uno de los estados financieros requeridos y de las notas relacionadas.' Marco vigente en Colombia para Grupo 2 a 2026-08: Anexo 2 del DUR 2420 de 2015 (modificado por Decretos 2496/2015, 2131/2016, 2170/2017, 2483/2018 y Decreto 0701 de 2026, vigente desde 2026-07-09, que sólo tocó la Sección 29 — Pilar Dos). La tercera edición de la NIIF para PYMES (IASB, feb-2025) aún NO está incorporada en Colombia.

#### P1 · COMP-2 — La columna comparativa del desglose del Balance no tiene ningún invariante: E15 y el reconciliador suman sólo amountPrimary

**Dónde:** `src/lib/agents/financial/contracts/statement-lines.ts:30-57 (StatementLineLike sólo declara amountPrimary), src/lib/agents/financial/validators/niif-json-validator.ts:671-699 (E15), src/lib/agents/financial/agents/reconcile-anchors.ts:322-348`  
**Verificado ejecutando:** sí

**Escenario medido:**

Sobre el mismo balance real, construí un Balance cuya columna comparativa del Activo es la MITAD de la primaria en cada renglón: 11 $1.206.838.944,32 / 13 $49.089.629,47 / 14 $835.107.884,64 / 15 $33.193,14 / 18 $1.919.769,00, Σ = $2.092.989.420,57 frente a totalAssetsComparative = $2.798.204.117,50. Brecha −$705.214.696,93 (25,2%). Ejecutado: reconcileAnchors devuelve lineGaps=[] y deviations=0; validateNiifReportJson con las anclas comparativas del preprocesador devuelve 0 errores y 0 warnings. El lector suma la columna 2024 y le faltan $705 millones, y el sistema declara el informe limpio y firmable.

**Corrección:**

Extender `StatementLineLike` con `amountComparative: string | null` y añadir a `sumStatementDetail` una segunda suma; hacer que E15 y el reconciliador crucen la suma comparativa contra `total*Comparative` con la misma tolerancia $0, saltando sólo los renglones cuyo grupo no exista en el comparativo. Es el mismo cambio que habilita la corrección de COMP-1.

**Normativa:** NIIF para las PYMES §3.14 y §3.20 (misma fuente y vigencia que COMP-1): la columna comparativa es parte de los estados financieros, no un adorno; un total comparativo que no es la suma de sus renglones comparativos es un estado financiero incorrecto.

#### P1 · COMP-3 — `ingresosNetos` resta las devoluciones 4175 DOS veces — el ingreso y el EBIT comparativos del Áncora salen $229.614.537,88 por debajo

**Dónde:** `src/lib/preprocessing/trial-balance.ts:1461-1473 (y su propagación en 1478-1480 → ebit; consumido en src/lib/agents/financial/ancora/build-ancora.ts:100-110 y publicado como VINCULANTE en src/lib/agents/financial/orchestrator.ts:463-471)`  
**Verificado ejecutando:** sí

**Escenario medido:**

Balance real, periodo comparativo 2024. Las hojas de clase 4 son: 41350101 $1.903.622.073,98 / 41350102 −$6.798.340,32 / 41750501 −$228.168.030,00 / 41750502 −$951.939,00 / 41750503 +$494.568,88 / 41800101 $8.043.144,00. Σ firmada = $1.676.315.150,47 = controlTotals.ingresos, es decir las devoluciones YA están restadas dentro del total de la clase. Pero la línea 1473 hace `ingresosNetos = |ingresos| − Σ|4175|` = $1.676.315.150,47 − $229.614.537,88 = $1.446.700.612,59: resta lo mismo por segunda vez. Efectos medidos ejecutando: Áncora A08 (Ingresos comparativo) = $1.446.700.612,59 en vez de $1.676.315.150,47; A10 (EBIT comparativo) = $1.350.689.517,33 mientras el informe entregado imprime $1.580.304.055,21 para el mismo concepto y periodo — dos EBIT distintos para 2024, brecha $229.614.537,88. En el periodo primario el mismo defecto vale $327.911.343,88 (A07 $2.101.198.187,69 vs real $2.429.109.531,57; A09 $1.916.725.454,27 vs $2.244.636.798,15). Agravante: la cuenta 41750503 llega con saldo POSITIVO +$494.568,88 (suma) y el `Math.abs` de la línea 1466 la convierte en resta. Y el bloque TOTALES VINCULANTES le presenta al modelo esa cifra como autoritativa: si el modelo la hubiera obedecido, la cascada del P&G comparativo no habría podido cerrar contra netIncomeComparative (que sí está anclada) — acertó por desobedecer.

**Corrección:**

Detectar si las 4175 ya vienen netas antes de restarlas: si `Σ firmada de las 4175 < 0` dentro del total de clase 4, entonces `ingresosNetos = ingresos` (ya es neto) y `totalDevoluciones` es sólo informativo para la nota; sólo restar cuando las 4175 llegan como magnitud positiva (convención en la que el total de clase se construyó con valores absolutos). Nunca `Math.abs` por cuenta: 41750503 tiene signo contrario legítimo. Es el mismo error de forma que la convención de signos ya corregida en `preprocessing/sign-convention.ts`.

**Normativa:** PUC colombiano, Decreto 2650 de 1993: cuenta 4175 'Devoluciones en ventas (DB)' — naturaleza DÉBITO, contra-ingreso que reduce el total de la clase 4. NIIF para las PYMES §23.3 (texto oficial IFRS Foundation en español): 'Una entidad medirá los ingresos de actividades ordinarias al valor razonable de la contraprestación recibida o por recibir. El valor razonable de la contraprestación... tiene en cuenta el importe de cualesquiera descuentos comerciales, descuentos por pronto pago y rebajas por volumen de ventas que sean practicados por la entidad.' Nota adicional: el comentario del código en trial-balance.ts:1465 y en orchestrator.ts:452 cita 'NIIF 15 §47' — NIIF 15 pertenece al Anexo 1 del DUR 2420/2015 (Grupo 1); para esta entidad (niifGroup 2) la norma aplicable es la Sección 23 del Anexo 2. Mis-cita normativa que además viaja al prompt del modelo.

#### P1 · COMP-4 — grossProfitComparative y operatingProfitComparative son LIBRES — el PDF llega a imprimir dos EBIT comparativos distintos en la misma tabla

**Dónde:** `src/lib/agents/financial/validators/niif-json-validator.ts:479-502 (E9 no los cruza) y src/lib/agents/financial/agents/reconcile-anchors.ts:207-238 (COMPARATIVE_BINDINGS no los incluye)`  
**Verificado ejecutando:** sí

**Escenario medido:**

Balance real. Fijé grossProfitComparative = '500000000000' ($5.000.000.000,00) y operatingProfitComparative = '400000000000' ($4.000.000.000,00), dejando netIncomeComparative correcto para que E9 no lo atrape. Ejecutado: validateNiifReportJson con las anclas comparativas → 0 errores, 0 warnings. reconcileAnchors → 0 desviaciones, 0 lineGaps. El valor inventado ($5.000M) es 1,8 veces el activo comparativo total ($2.798.204.117,50) y 3 veces la cifra correcta ($1.663.815.150,47), y aun así el informe sale limpio. Peor: renderIncomeStatement imprime en la MISMA tabla el renglón 'UTILIDAD BRUTA (NIIF para PYMES, Sección 5) | $2.416.609.531,57 | $1.663.815.150,47' (derivado de las líneas) y dos filas más abajo 'UTILIDAD BRUTA | $2.416.609.531,57 | $5.000.000.000,00' (bloque de totales). Nada obliga a que coincidan. Con oriComparative pasa lo mismo: $777.777.777,77 → 0 errores, y ni siquiera figura en la lista NOT-NULL de E9 (líneas 463-468), así que null-earlo tampoco alerta.

**Corrección:**

Dos capas. (a) Determinista: el preprocesador ya tiene todo lo necesario para calcular la utilidad bruta y el EBIT comparativos —lo ejecuté: clase 4 $1.676.315.150,47, grupo 74 $12.500.000,00, grupo 51 $78.862.228,59, grupo 52 $4.648.866,67— así que estas dos cifras deberían anclarse en `buildPeriodAnchors` y sobrescribirse en cascada igual que el tríptico, no autorarlas el modelo. (b) Mínimo inmediato: extender `bindingComparativeTotalsCents` con grossProfit/operatingProfit (el propio comentario de orchestrator.ts:158-161 anticipa este hueco: 'Cuando esos campos lleguen al preprocesador, agregar aquí') y replicar E5 para la cascada comparativa (gross ≥ operating ≥ UAI). Y forzar que el renglón de subtotal del P&G y el campo de total del mismo concepto sean la misma cifra.

**Normativa:** NIIF para las PYMES §3.14 y §5.5 (partidas mínimas del estado del resultado integral, Anexo 2 DUR 2420/2015 vigente). Defensa Art. 647 E.T.: una utilidad bruta comparativa inventada en un informe que se presenta como soporte contable es exactamente el tipo de inexactitud que la sanción castiga.

#### P2 · COMP-5 — Los renglones del P&G comparativo no tienen ningún invariante — no existe un E15 del Estado de Resultados

**Dónde:** `src/lib/agents/financial/validators/niif-json-validator.ts:671-699 (E15 sólo recorre bs.assets / bs.liabilities / bs.equity)`  
**Verificado ejecutando:** sí

**Escenario medido:**

Balance real, output real del modelo. Puse los 12 valores de `incomeStatement.lines[].amountComparative` a '1' ($0,01 cada uno). Ejecutado: validateNiifReportJson con las anclas comparativas → 0 errores, 0 warnings; reconcileAnchors → 0 desviaciones. El P&G comparativo del informe pasaría a mostrar 'Ingresos de actividades ordinarias $0,01' bajo una 'UTILIDAD NETA DEL PERÍODO $1.572.721.472,96' anclada y correcta. En la corrida real el modelo acertó los seis renglones con código PUC al centavo contra el preprocesador (4 $1.676.315.150,47 / 74 $12.500.000,00 / 51 $78.862.228,59 / 52 $4.648.866,67 / 53 $7.582.582,25 / 54 $0,00) — la exactitud existe, la garantía no.

**Corrección:**

Añadir un E16 que cruce la cascada del P&G en ambas columnas: Σ(renglones con código PUC de clase 4) − Σ(clases 6/7) = grossProfit; grossProfit − grupos 51/52 = operatingProfit; operatingProfit − grupo 53 = UAI; UAI − grupo 54 = netIncome. Los cuatro términos existen ya en el preprocesador por periodo. Con eso el P&G comparativo pasa de LIBRE a ANCLADO sin pedirle nada nuevo al modelo.

**Normativa:** NIIF para las PYMES §3.14 (información comparativa para todos los importes) y §5.5 (partidas mínimas del resultado), Anexo 2 DUR 2420/2015 vigente a 2026-08.

#### P2 · COMP-6 — `company.comparativePeriod` lo autora el modelo, nadie lo cruza, y es la GUARDA de todo E9

**Dónde:** `src/lib/agents/financial/contracts/niif-report.ts:376 (assembleNiifReport propaga pass1.company literal) frente a src/lib/agents/financial/orchestrator.ts:1371-1396 (el código deriva effectiveCompany.comparativePeriod y nunca lo impone); guarda en src/lib/agents/financial/validators/niif-json-validator.ts:460`  
**Verificado ejecutando:** sí

**Escenario medido:**

Balance real con dos periodos (2025 y 2024, preprocesados y anclados). Emití el reporte con `company.comparativePeriod = null` dejando intactos los seis totales comparativos correctos. Ejecutado: validateNiifReportJson → 0 errores y 0 warnings (E9 entero se salta por la guarda de la línea 460); reconcileAnchors → 0 desviaciones y 0 lineGaps. renderBalanceSheet pasa de '| Rubro | 2025 | 2024 |' a '| Rubro | 2025 |' y la fila queda 'TOTAL ACTIVOS | $4.185.978.841,16' — el periodo comparativo entero, $2.798.204.117,50 de activo incluidos, desaparece del entregable sin una sola alerta. Un validador cuya activación depende de un campo que autora el mismo agente que vigila es un validador que el agente puede apagar.

**Corrección:**

Sobrescribir `json.company.comparativePeriod` desde `effectiveCompany` (que ya lo deriva de `preprocessed.periods`) en el reconciliador, junto al tríptico; y disparar E9 según el PREPROCESADOR (`preprocessed.comparative != null`), nunca según el campo emitido por el modelo. Además reportar como desviación cualquier discrepancia entre ambos.

#### P2 · COMP-7 — En LINEA_BASE los comparativos inventados sobreviven intactos y se convierten en cifras VINCULANTES obligatorias para el Editor Jefe HTML

**Dónde:** `src/lib/agents/financial/agents/reconcile-anchors.ts:265 (`if (!periodAnchors) return;` — salida temprana sin reportar nada) y src/lib/agents/financial/contracts/html-editor.ts:304-306 (collectBindingFigures incluye los comparativos sin condicionar a comparativePeriod)`  
**Verificado ejecutando:** sí

**Escenario medido:**

Fixture patologicos/sin-comparativo.csv: un solo periodo, pp.comparative = null, deriveReportMode = LINEA_BASE, el gate pasa y el bloque vinculante dice 'solo hay un periodo' — todo correcto hasta ahí. Pero si el modelo emite igualmente totalAssetsComparative = '100000000000' ($1.000.000.000,00) auto-consistente con pasivo $400.000.000,00 + patrimonio $600.000.000,00: ejecutado, reconcileAnchors con comparative=null sale por la línea 265 sin tocar ni reportar nada (0 desviaciones) y la cifra sobrevive; validateNiifReportJson con comparativePeriod=null no ejecuta E9 y el soft-check E1-comparativo no salta porque la ecuación cuadra consigo misma → 0 errores, 0 warnings. Markdown/PDF/Excel no la imprimen (hasComparative=false), pero `collectBindingFigures` SÍ la emite: {path:'balanceSheet.totalAssetsComparative', formatted:'$1.000.000.000,00'} — y `reconcileBindingFigures` (html-editor-validator.ts:843-866) marca severity:'block' si esa cifra NO aparece en el HTML. Es decir: en LINEA_BASE el pipeline puede terminar EXIGIENDO que el HTML imprima un comparativo inventado.

**Corrección:**

En el reconciliador, cuando `anchors.comparative === null` y el reporte trae cualquier campo *Comparative no nulo, reportarlo como desviación y null-earlo (el preprocesador es la autoridad sobre si existe comparativo). Y condicionar las tres entradas comparativas de `collectBindingFigures` a `niifReport.company.comparativePeriod !== null`, tomado del preprocesador tras la corrección de COMP-6.

#### P3 · COMP-8 — Una desviación del tríptico comparativo se corrige en silencio: el informe sale limpio y el usuario nunca sabe que el modelo se equivocó

**Dónde:** `src/lib/agents/financial/agents/niif-analyst.ts:415-425 (clean se calcula SÓLO sobre finalReconciled) y src/lib/agents/financial/agents/reconcile-anchors.ts:111-112 (describeQualifications retorna [] si clean)`  
**Verificado ejecutando:** sí

**Escenario medido:**

Balance real. El modelo emite totalAssetsComparative $1.000.000.000,00 / totalLiabilitiesComparative $400.000.000,00 / totalEquityComparative $600.000.000,00 (los tres mal, brecha del activo −$1.798.204.117,50). La primera reconciliación los sobrescribe con $2.798.204.117,50 / $1.232.263.178,39 / $1.565.940.939,11 y registra tres desviaciones marcadas 'SOBRESCRITA'. Como `clean` se evalúa sobre la SEGUNDA reconciliación —que ya corre sobre el JSON corregido—, sale clean=true, buildQualificationSeal devuelve cadena vacía y las tres desviaciones quedan sólo en `reconciliation.deviations`, que ninguna superficie del informe muestra. La corrección es la correcta y el número entregado es el bueno; lo que se pierde es la señal de que ese modelo, ese día, desvió tres cifras del periodo comparativo. Es justo la telemetría de obediencia que el módulo dice ser su segundo objetivo.

**Corrección:**

Persistir las desviaciones sobrescritas por `persistAgentTelemetry` (el canal ya existe, docs/TELEMETRY.md) y añadirlas a las notas técnicas del informe como 'corregido automáticamente', sin bloquear la descarga. Mantener clean=true es defendible; perder el dato no.

### Lo que este auditor NO pudo medir

- NO corrí el LLM en vivo en esta ola. Todo lo que reporto lo ejecuté sobre (a) el balance de cliente real preprocesado y (b) los JSON crudos que el modelo produjo en la medición de cierre del 2026-08-08 (.fase0-final2/raw-grupo-empresarial-2tres-run{1,2}.json), pasándolos por el código real de reconciliación, validación y renderizado. Consecuencia: no puedo dar una frecuencia estadística de con qué probabilidad el modelo autora mal la columna comparativa, porque en las 2 corridas disponibles el código la sobrescribió antes de que se pudiera observar.
- Sólo hay UN balance real con periodo comparativo en el repo, y es también el único con cuentas 4175. La generalidad del hallazgo COMP-3 fuera de ese archivo no la puedo caracterizar: en los cinco fixtures restantes (elite-pulido-diamante, signos-algebraicos, sin-comparativo, perdida-y-patrimonio-negativo) no hay ninguna 4175, así que ingresosNetos == ingresos y el defecto no se manifiesta. Ningún test lo cubre.
- No pude leer el Anexo 2 del Decreto 2420 de 2015 en funcionpublica.gov.co: la conexión falló con 'unable to verify the first certificate'. Verifiqué §3.14, §3.20 y §23.3 contra la edición oficial en español de la IFRS Foundation (NIIF para las PYMES, julio 2009, © IASCF), que es el texto que el Anexo 2 incorpora. Confirmé por fuentes secundarias que el Decreto 0701 de 2026 (vigente desde 2026-07-09) sólo modificó la Sección 29 para Pilar Dos y que la tercera edición de la NIIF para PYMES (IASB, feb-2025) NO está incorporada en Colombia; no pude confirmarlo contra el diario oficial.
- No medí el EFE ni el ECP comparativos: quedan fuera de mi superficie y los cruzan otras reglas (E2, E4, E7c).
- No medí si el Editor Jefe HTML reproduce la columna comparativa del desglose ni cuántas de sus ~200 cifras se desvían — esa superficie no es mía y sigue sin harness, tal como FASE0_MEDICION_2026-08.md ya anotaba como pendiente.
- No verifiqué el impacto de COMP-3 en las 4 áreas que consumen el Áncora vía useAncoraView (El Escudo, etc.). Confirmé que A08 y A10 salen mal de buildNiifAncora; qué hace cada área con esos valores no lo medí.


---

## El Escudo

**Veredicto:** `sin-garantia`

### Resumen del auditor

Medí ejecutando sobre el balance de cliente real (Grupo Empresarial 2 Tres SAS 2025), el corpus patológico y 10 escenarios sintéticos construidos para forzar cada camino. Lo bueno primero: F01 (UAI) es DETERMINISTA y coincide al centavo con el ancla NIIF en el balance real y en los 6 fixtures patológicos (gap $0,00, medido). El calendario DIAN está bien construido (Decreto 2229/2023, dígito sin DV, festivos verificados, marca `verificar` cuando no sabe). Y las constantes normativas que verifiqué contra fuente oficial vigente están BIEN: UVT 2026 $52.374 (Res. DIAN 000238 del 15-dic-2025), tarifa Art. 240 35%, bancarización 100 UVT individual / 40%-40.000 UVT-35% general, tarifas de retención 2026 post-Decreto 0572/2025 (vigente desde 01-jul-2026 tras el auto del Consejo de Estado del 02-jun-2026), Art. 648 (100/15/200/160/20/50%) y Art. 670 (10/20/+100%). Ese trabajo normativo está hecho y está correcto.

Lo grave es lo demás. (1) Hay DOS derivaciones deterministas independientes de F01..F10 —`buildFiscalAnchor` de El Escudo y `buildCcvFiscal` del Âncora NIIF— que alimentan el MISMO campo del MISMO componente de UI vía `deriveAncoraView`, y NO coinciden: sobre el balance real F05 "IVA por pagar" sale $106.813.252,05 en una y $931.302.967,85 en la otra (8,72×, brecha de $824.489.715,80); en una empresa en pérdida una devuelve F02=$0 y la otra F02=−$70.000.000 (un impuesto de renta negativo que se convierte en un saldo a favor inexistente). Cuál ve el cliente depende de si el snapshot se persistió, no de su balance. (2) El Score de Riesgo DIAN mide si el contador ya causó el impuesto, no riesgo fiscal: la misma empresa, mismas cifras, puntúa 31/100 "medio" sin la provisión de renta y 1/100 "bajo" con la provisión al 35% exacto — 30 puntos de swing; sobre el balance real del cliente el score publicado es 70/100 "muy_alto" y 30 de esos 70 vienen de que el balance de prueba aún no tiene grupo 54. Una empresa en pérdida franca puntúa 30/100 "medio" con el texto "tasa efectiva nula sobre utilidad". (3) Ningún validador de esta superficie corre en producción: `validateSurvivalReport`, `validateFiscalAnchorAll`, `validateFiscalResponse` y `validateNormativeResponse` sólo tienen importadores en tests/fixtures. Por tanto TODA cifra que autora el LLM en El Escudo es LIBRE — el mayor impuesto por bancarización, las retenciones acumuladas, la TET, los tres escenarios de dividendos, los escenarios de planeación. Cero ancladas.

### Inventario cifra por cifra

| Cifra | Estado | Productor | Validador |
|---|---|---|---|
| F01 — UAI contable | **DETERMINISTA** | `src/lib/agents/financial/escudo-survival/fiscal-anchor/index.ts:50-56 (controlTotals.cents.utilidadAntesImpuestos)` | src/lib/agents/financial/escudo-survival/validators/fiscal-anchor-validators.ts — NO CORRE en producción (importadores sólo en __tests__) |
| F02 — impuesto de referencia 35% | **DETERMINISTA** | `src/lib/agents/financial/escudo-survival/fiscal-anchor/calculator.ts:23,71 (TARIFA_RENTA_PCT=35n, pctOfCents BigInt)` | fiscal-anchor-validators.ts:73 calcF02 — NO CORRE |
| F03 — retenciones a favor | **DETERMINISTA** | `src/lib/agents/financial/escudo-survival/fiscal-anchor/extractor.ts:82 — sumLeavesByPrefix(['1355','1805'])` | ninguno en producción |
| F04 — neto a pagar / saldo a favor | **DETERMINISTA** | `calculator.ts:73 (F02 − F03)` | ninguno en producción |
| F05 — IVA por pagar | **DETERMINISTA** | `extractor.ts:83 — absBigInt(Σ hojas '2408')` | ninguno en producción |
| F06 — retefuente por declarar | **DETERMINISTA** | `extractor.ts:84 — absBigInt(Σ hojas '2365')` | ninguno en producción |
| F07 — ICA por pagar | **DETERMINISTA** | `extractor.ts:85 — absBigInt(Σ hojas '2368')` | ninguno en producción |
| F08 — total pasivos fiscales | **DETERMINISTA** | `extractor.ts:86 — absBigInt(Σ hojas prefijo '24')` | ninguno en producción |
| F09 — tasa efectiva de tributación | **DETERMINISTA** | `calculator.ts:79 — ratioPct1Decimal(impuestoCausado, F01)` | ninguno en producción |
| F10 — cobertura de retenciones | **DETERMINISTA** | `calculator.ts:80 — ratioPct1Decimal(F03, F02)` | ninguno en producción |
| Score de Riesgo DIAN (0-100) y nivel | **DETERMINISTA** | `src/lib/agents/financial/escudo-survival/fiscal-agent/tools/risk-score-calculator.ts:295-306` | fiscal-agent/validators/risk-score.validator.ts:242 — NO CORRE en producción, y además tipa `Modulo3RiskScore` (factor1_tetVsSector…factor5_historicoSanciones), una forma que ningún agente del pipeline produce |
| Vencimientos del calendario DIAN (fechas) | **DETERMINISTA** | `src/lib/agents/financial/escudo-survival/fiscal-anchor/dian-calendar.ts:201-298` | fiscal-anchor-validators.ts (rangos defensivos) — NO CORRE |
| valorEstimado de cada vencimiento | **DETERMINISTA** | `dian-calendar.ts:386-402 (mapea baseCcv → F03..F07)` | ninguno |
| costosTotales (base del tope Art. 771-5 §1) | **DETERMINISTA** | `src/lib/agents/financial/escudo-survival/lib/extract-totals.ts:128 — `gastos + costosVenta + costosProd`` | ninguno |
| pagosEfectivoTotal (bancarización) | **LIBRE** | `prompts/anti-dian-auditor.prompt.ts:69 — el LLM lo copia del saldo 1105 que le pasa extract-totals.ts:130` | survival-validators.ts:226 C1.3 — NO CORRE en producción |
| pagosNoDeduciblesIndividuales[] (Art. 771-5 §2) | **LIBRE** | `agents/anti-dian-auditor.ts:40 (AntiDianAuditReportSchema)` | survival-validators.ts:485 C2.3 `bancarizacion_violada_listada` — NO CORRE |
| excesoNoDeducibleGeneral (Art. 771-5 §1) | **LIBRE** | `prompt anti-dian-auditor.prompt.ts:72 — el LLM ejecuta min(40%·pagos, 40.000 UVT, 35%·costos)` | ninguno que reconcilie este campo; TOPE_GENERAL_UVT=40000 está declarado en types.ts:21 y NO tiene ningún consumidor |
| mayorImpuestoEstimado (35% del rechazo) | **LIBRE** | `AntiDianResult.data.mayorImpuestoEstimado` | survival-validators.ts:301 C1.5 `mayorImpuesto_es_35pct_excedente`, tolerancia 1% — NO CORRE en producción |
| TET, TTD, impuestoProyectado, nivelAlerta | **LIBRE** | `escudo-survival/agents/tet-calculator.ts (TetCalculatorResult.data)` | survival-validators.ts:119 C1.1 `tet_calculada_reconcilia` (0,1 pp) y C2.4 `tet_no_implausible` — NO CORREN |
| retencionesAcumuladas, saldoAFavorProyectado | **LIBRE** | `escudo-survival/agents/retention-shield.ts (RetentionShieldResult.data)` | survival-validators.ts:162 C1.2 `retencionesAcumuladas_suma_subcuentas` (tolerancia $1) — NO CORRE |
| reservaSugerida / utilidadNeta (contingencia) | **LIBRE** | `escudo-survival/agents/contingency-reserve.ts` | survival-validators.ts:271 C1.4 `reservaSugerida_es_10pct_utilidadNeta` — NO CORRE |
| Escenarios de dividendos (ahorroSocio, impuestoSocio, netoSocio) | **LIBRE** | `escudo-survival/agents/dividend-optimizer.ts` | survival-validators.ts:363 C1.6 (capitalizar ⇒ impuestoSocio=0, Art. 36-3) — NO CORRE |
| topRecommendations[].impacto (COP) | **LIBRE** | `escudo-survival/orchestrator.ts:50-63 synthesizerSchema` | survival-validators.ts:587 C2.5 — NO CORRE |
| Score/nivel/factores del módulo LLM Risk Score | **LIBRE** | `fiscal-agent/agents/risk-score.agent.ts:58 (riskScoreModuleSchema)` | fiscal-agent/validators/risk-score.validator.ts — NO CORRE, y valida otra forma |
| Escenarios de planeación (impuestoBase, impuestoEscenario, ahorroEstimado, ahorroPct) | **LIBRE** | `fiscal-agent/agents/planeacion.agent.ts (planeacionModuleSchema)` | ninguno en producción |
| Tarifas y bases de retención (honorarios, servicios, compras, arrendamientos) | **LIBRE** | `normative/catalog/tarifas-retencion.ts — el catálogo sólo se consume vía buildMotorNormativoPrompt (normative/index.ts:22 → fiscal-agent/prompts/fiscal-agent.prompt.ts:17)` | normative/validators/citation.validator.ts + blacklist.validator.ts, orquestados por validateNormativeResponse — NO CORREN (único importador: fiscal-agent/validators/index.ts:21, que a su vez está muerto) |
| Sanciones (Arts. 639/641/644/647/648/643/402) | **LIBRE** | `normative/catalog/sanciones.ts — mismo camino de prompt` | mismo — NO CORRE |

Reparto: **14** deterministas · **0** ancladas · **13** libres.

### Hallazgos

#### P0 · ESC-01 — Dos derivaciones deterministas de F01..F10 alimentan el mismo campo de UI y no coinciden: F05 difiere 8,72× ($824M) en el balance del cliente real

**Dónde:** `src/lib/agents/financial/ancora/build-ancora.ts:154-222 (buildCcvFiscal) vs src/lib/agents/financial/escudo-survival/fiscal-anchor/extractor.ts:77-95 (buildFiscalAnchor); el selector está en src/lib/ancora/derive-ancora-view.ts:134-147`  
**Verificado ejecutando:** sí

**Escenario medido:**

Balance real Grupo Empresarial 2 Tres SAS 2025 (src/lib/preprocessing/__fixtures__/grupo-empresarial-2tres-sas.xlsx). La cuenta 2408 tiene 7 hojas con signos mezclados: +516.275.781,44 / −26.900.000,00 / −856,80 / −324.066.290,67 / +2.782.328,51 / −7.556,76 / −61.270.153,67. `buildFiscalAnchor` calcula |Σ saldos| = $106.813.252,05 (el IVA neto real). `buildCcvFiscal` calcula Σ|saldo| (build-ancora.ts:55-59 `sumAbsAccountsByPrefix`) = $931.302.967,85. Brecha $824.489.715,80 = 8,72×. Igual F06: $17.658.936,02 vs $17.947.406,78; F07: $19.525,04 vs $19.819,66; F10: 4,5% vs 4,55%. En una empresa en PÉRDIDA (UAI = −$200.000.000) medí: `buildFiscalAnchor` devuelve F02=$0,00 y F04=$0,00 (pctOfCents corta en cero); `buildCcvFiscal` devuelve F02 = −$70.000.000,00 y F04 = −$70.000.000,00 — un impuesto de renta NEGATIVO, y como F04<0 significa 'saldo a favor', la UI le anuncia a una empresa sin retenciones un crédito fiscal de $70M. `deriveAncoraView` elige con `fa ? centsToPesos(fa.f05) : centsToPesos(f.F05)` y pinta ambos en el mismo campo `view.fiscal.f05` con la misma etiqueta. La rama de fallback está viva: GET /api/escudo/fiscal-anchor (route.ts:200-247) hace DOS consultas independientes a `reports` (kind 'escudo_fiscal' y kind 'escudo_niif_ancora') y devuelve `fiscalSnapshot: null` con `ancora` presente; `useAncoraView.ts:101-106` sólo puebla `fiscalAnchor` si `data.fiscalSnapshot?.anchor` existe.

**Corrección:**

Borrar `buildCcvFiscal` y hacer que `NiifAncora.ccvFiscal` se llene desde `buildFiscalAnchor` (o al revés). Una sola derivación. Mientras tanto, `deriveAncoraView` no debe caer al `ccvFiscal` en silencio: si no hay `fiscalSnapshot.anchor`, devolver null y que la UI muestre 'no calculado' en vez de una cifra distinta con la misma etiqueta. Y `buildCcvFiscal` debe guardar `uai <= 0 ⇒ F02 = 0` como hace el calculador del Escudo.

#### P0 · ESC-02 — El Score de Riesgo DIAN mide si el contador ya causó el impuesto, no riesgo fiscal: 30 de los 70 puntos del cliente real vienen de que el balance de prueba no tiene grupo 54

**Dónde:** `src/lib/agents/financial/escudo-survival/fiscal-agent/tools/risk-score-calculator.ts:88-110 (factorTet)`  
**Verificado ejecutando:** sí

**Escenario medido:**

MEDIDO, tres corridas. (a) Balance real Grupo Empresarial 2 Tres SAS 2025: no existe cuenta del grupo 54 ⇒ `controlTotals.cents.impuestoCausado = $0,00` ⇒ F09 = 0% ⇒ `factorTet` entra por `if (f09 <= 0.01)` y otorga 30 puntos con el texto 'F09 = 0% — tasa efectiva nula sobre utilidad. Activa Modo Supervivencia.'. Score total = 70/100, nivel 'muy_alto' (se muestra al usuario como ALTO en un gauge). Sin ese factor: 40/100, nivel 'medio'. (b) Construí la MISMA empresa dos veces, idénticas salvo la provisión de renta: sin 5405 ⇒ F09 = 0%, factorTet = 30, score 31/100 'medio'; con 5405 = $119.348.876,41 (exactamente el 35% de la UAI de $340.996.789,73, es decir un contribuyente impecable) ⇒ F09 = 35%, factorTet = 0, score 1/100 'bajo'. 30 puntos de swing y un salto de nivel sobre sustancia fiscal idéntica. (c) Empresa en PÉRDIDA franca (ingresos $500M, costos+gastos $700M, UAI = −$200.000.000): `ratioPct1Decimal` devuelve 0 cuando el denominador ≤ 0, así que F09 = 0 ⇒ 30 puntos ⇒ score 30/100 'medio', con el mensaje 'tasa efectiva nula sobre utilidad' para una empresa que no tiene utilidad y que por el Art. 240 E.T. no debe impuesto. (d) Los tres fixtures del corpus patológico que no tienen P&G (cifras-mayores-2e53, cuentas-sin-clasificar, descuadrado-en-origen) puntúan los mismos 30/100 'medio' con F01 = $0,00: un balance vacío o roto produce un score de riesgo presentado como medición. El sistema YA SABE distinguir el caso: `alerts.ts:37` emite A5_SIN_PROVISION (severidad error) exactamente cuando `impuestoCausado === 0 && F01 > 0`. Esa información no llega al factor. Y los otros cinco factores SÍ tienen rama 'no aplicable' (`factorMargenNeto`/`factorCostoBajo` guardan con `ingresos <= 0`, `factorCrecimiento` con `prev === null`, `factorCoberturaRetenciones` con `F02 <= 0`). Factor 1 es el único sin ella.

**Corrección:**

`factorTet` necesita tres ramas, no una: (i) si F01 ≤ 0 ⇒ 0 puntos y detalle 'sin utilidad, la tasa efectiva no es aplicable'; (ii) si F01 > 0 y no existe ninguna cuenta del grupo 54 en el balance ⇒ 0 puntos de riesgo y un aviso separado de 'balance sin causación de impuesto — no se puede medir la TET' (que es lo que A5_SIN_PROVISION ya dice); (iii) sólo si hay grupo 54 con saldo y F09 sale bajo, aplicar la escala. Además el score no debería publicarse cuando el input no permite calcularlo: con F01 = $0,00 devolver `null` en vez de 30/100.

**Normativa:** Art. 240 par. 6 E.T. (tasa mínima de tributación, TTD 15%): la TTD se calcula como Impuesto Depurado / Utilidad Depurada, no como impuesto causado / UAI contable, y no aplica a sociedades sin utilidad depurada positiva. El mensaje de `factorTet` para F09 entre 0,01% y 15% cita 'el umbral 15% de TTD (Art. 240 par. 6 E.T.)' sobre un ratio que no es la TTD. Fuente consultada: actualicese.com/rutas/books/tasa-minima-de-tributacion-normativa-calculos-y-obligados y estatuto.co/240.

#### P0 · ESC-03 — Los cuatro validadores de El Escudo están muertos en producción: ninguna cifra autorada por el LLM tiene contraste

**Dónde:** `src/lib/agents/financial/escudo-survival/validators/survival-validators.ts:1132; validators/fiscal-anchor-validators.ts; fiscal-agent/validators/index.ts:113; normative/validators/normative.validator.ts`  
**Verificado ejecutando:** sí

**Escenario medido:**

Grep exhaustivo sobre src/ y scripts/ (excluyendo graphify-out): `validateSurvivalReport` tiene UN solo importador, `escudo-survival/__fixtures__/run-validation.ts:16` (un harness de fixtures). `validateFiscalAnchorAll` / `validateFiscalAnchorL1..L3` sólo se importan desde `fiscal-anchor/__tests__/buildFiscalAnchor-grupo2tres.test.ts:18-22`. `validateFiscalResponse` y `summarizeFiscalChecks` sólo desde `fiscal-agent/__tests__/integration.test.ts:15`. `validateNormativeResponse` sólo desde `fiscal-agent/validators/index.ts:21`, que a su vez no tiene importador de producción. Los dos endpoints reales no los llaman: `POST /api/escudo-survival` (route.ts:58 y :82) devuelve el reporte de `orchestrateEscudoSurvival` sin validar — el propio orquestador deja `validation` sin poblar (orchestrator.ts:202-218) —, y `POST /api/escudo/fiscal` (route.ts) devuelve `orchestrateFiscalAgent` igual. Consecuencia concreta y numerable: `survival-validators.ts:301` contiene C1.5 `mayorImpuesto_es_35pct_excedente` con tolerancia del 1%, que es exactamente el cruce que haría falta para el mayor impuesto por bancarización; `:162` contiene C1.2 que cruzaría `retencionesAcumuladas` contra la suma de auxiliares 1355 con tolerancia $1 (el Escudo ya tiene ese número exacto en F03 = $35.485.806,02); `:119` contiene C1.1 que reconciliaría la TET con tolerancia 0,1 pp. Los tres existen, están escritos y probados, y ninguno se ejecuta cuando el cliente pide el informe.

**Corrección:**

Cablear `validateSurvivalReport(report, preprocessed)` al final de `orchestrateEscudoSurvival` (antes del `return`), poblando `report.validation`, y `validateFiscalResponse` al final de `orchestrateFiscalAgent`. Los hard fails de capa 1 y 3 deben sellar el reporte ('ESCUDO CON SALVEDADES') y bloquear la descarga, con el mismo patrón que la sesión de exactitud aplicó al NIIF — no como evento SSE, que ya se comprobó que muere en el navegador. Antes de cablearlos hay que arreglar ESC-10: `validateRiskScore` tipa `Modulo3RiskScore`, una forma que el pipeline nunca produce.

#### P1 · ESC-04 — F05/F06/F07 toman valor absoluto de un neto: un saldo a FAVOR de IVA se presenta como IVA por pagar, y el calendario DIAN le dice al cliente que lo pague

**Dónde:** `src/lib/agents/financial/escudo-survival/fiscal-anchor/extractor.ts:31-33 (absBigInt) y :83-85; el valor viaja al calendario en dian-calendar.ts:386-402`  
**Verificado ejecutando:** sí

**Escenario medido:**

MEDIDO (escenario S3). Balance con IVA generado $30.000.000 (crédito) e IVA descontable $90.000.000 (débito), ambos bajo 2408: Σ = −$60.000.000, es decir un saldo a FAVOR de IVA de $60M. `absBigInt` lo convierte en F05 = $60.000.000,00, que el block-builder rotula 'F05 · IVA por pagar (|Cta.2408|)' (block-builder.ts:66) y que `buildCalendarioDian` publica en la fila 'IVA bimestral' como `valorEstimado` = $60.000.000,00 a pagar. El contribuyente tiene $60M a favor y el sistema le anuncia $60M a pagar: un error de $120.000.000 en la dirección del flujo de caja, sobre la obligación que el calendario le está diciendo que cumpla. Mismo patrón en F06 (2365) y F07 (2368), que también pueden quedar netos deudores cuando hay devoluciones de retención — en el balance real la 23654002 'Devolución Retención por compras 2' trae −$144.235,38 y la 23680513 'Reteica 4' −$147,31.

**Corrección:**

Conservar el signo del neto y decidir la presentación por signo, no por magnitud: si Σ(2408) > 0 ⇒ 'IVA por pagar'; si < 0 ⇒ 'IVA a favor (saldo susceptible de imputación o devolución, Art. 850 E.T.)' y `valorEstimado` del vencimiento = 0. El tipo `FiscalRawBase` ya es BigInt con signo; el `absBigInt` de extractor.ts:83-85 es lo único que hay que quitar, propagando el signo a block-builder y a `valorEstimadoCents`.

**Normativa:** Art. 850 E.T. — derecho a devolución/compensación de saldos a favor; Art. 815 E.T. — imputación del saldo a favor de IVA al período siguiente. Consultado en estatuto.co.

#### P1 · ESC-05 — F08 'Total pasivos fiscales' no es monótona (un activo mayor produce un pasivo mayor) y excluye por construcción retefuente, reteIVA y reteICA por pagar

**Dónde:** `src/lib/agents/financial/escudo-survival/fiscal-anchor/extractor.ts:86 — absBigInt(sumLeavesByPrefix(leaves, ['24']))`  
**Verificado ejecutando:** sí

**Escenario medido:**

MEDIDO, barrido con IVA por pagar fijo en $100.000.000 (2408 crédito) y anticipo de renta (2404, débito, un ACTIVO fiscal) variable:
  anticipo $0 → F08 = $100.000.000,00
  anticipo $50M → F08 = $50.000.000,00
  anticipo $100M → F08 = $0,00  (la pantalla dice 'total pasivos fiscales $0' mientras la empresa debe $100M de IVA)
  anticipo $200M → F08 = $100.000.000,00
  anticipo $250M → F08 = $150.000.000,00
  anticipo $400M → F08 = $300.000.000,00  (un anticipo de $400M genera $300M de 'pasivos fiscales')
Curva en V: aumentar un activo fiscal aumenta el pasivo fiscal reportado. En ese mismo barrido F06 = $40.000.000,00 de retefuente por pagar NUNCA entra en F08, en ningún punto, porque el PUC ubica 2365 (Retención en la fuente), 2367 (Impuesto a las ventas retenido) y 2368 (ICA retenido) en el GRUPO 23 'Cuentas por pagar', no en el 24. Sobre el balance real esto produce una contradicción visible con calculadora: F08 = $105.537.824,41 es MENOR que F05 = $106.813.252,05, que es uno de sus propios componentes (la diferencia son los −$1.275.427,64 de la cuenta 24950103 'Impuesto al consumo en compras', de saldo débito). Y el total real de pasivos fiscales del balance —grupo 24 más 2365 ($17.658.936,02) más 2367 (−$1.226.613,00) más 2368 ($19.525,04)— es ~$122M, un 16% por encima de lo que F08 declara.

**Corrección:**

F08 debe sumar magnitudes de las cuentas ACREEDORAS de impuestos, no el valor absoluto de un neto mixto: Σ de los saldos crédito del grupo 24 más 2365 + 2367 + 2368, y presentar por separado los saldos débito del grupo 24 (anticipos/retenciones a favor) como activo fiscal. Renombrar mientras tanto: 'Impuestos, gravámenes y tasas — neto grupo 24' es lo que hoy calcula; 'Total pasivos fiscales' no lo es.

**Normativa:** PUC Decreto 2650 de 1993: grupo 23 'Cuentas por pagar' contiene 2365 Retención en la fuente (con 236505..236575), 2367 Impuesto a las ventas retenido y 2368 Impuesto de industria y comercio retenido; grupo 24 'Impuestos, gravámenes y tasas'. Verificado en puc.com.co/2365, puc.com.co/23 y el texto del Decreto 2650 (politecnicomayor.edu.co/virtual/documentos/PUC.pdf).

#### P1 · ESC-06 — F03 suma el grupo PUC 1805 ('Bienes de arte y cultura') como retención a favor: genera una solicitud de devolución inexistente con exposición Art. 670 E.T.

**Dónde:** `src/lib/agents/financial/escudo-survival/fiscal-anchor/extractor.ts:82 — sumLeavesByPrefix(leaves, ['1355','1805']); duplicado en src/lib/agents/financial/ancora/build-ancora.ts:183`  
**Verificado ejecutando:** sí

**Escenario medido:**

MEDIDO (escenario S5). Empresa con 1355 = $0 (cero retenciones practicadas a su favor) y una cuenta 180505 'Bienes de arte y cultura' con $500.000.000. Resultado: F03 = $500.000.000,00 rotulado 'Retenciones a favor (Cta.1355 + Cta.1805)'; F02 = $157.500.000,00; F04 = F02 − F03 = −$342.500.000,00; como F04 < 0, `alerts.ts:47` emite la alerta SALDO_A_FAVOR con norma 'Art. 850 E.T.' y `factorSaldoFavor` suma 10 puntos al score por 'saldo a favor sin solicitar… prescribe en 2 años (Art. 854 E.T.)'. F10 sale 317,5%. La empresa no tiene ni un peso de saldo a favor. Si el cliente actúa sobre esa recomendación y radica la solicitud de devolución, la sanción del Art. 670 num. 2 E.T. es el 20% del valor devuelto improcedentemente = $68.500.000, más intereses moratorios. Sobre el balance real el efecto es menor pero presente: la 18050504 aporta $3.839.538,00 de los $35.485.806,02 de F03 (10,8%), y ese mismo peso aparece en el Estado de Situación Financiera del informe NIIF como '18 Otros activos'. La misma cifra se clasifica de dos maneras según qué módulo la mire.

**Corrección:**

Quitar '1805' de la lista de prefijos de F03. El crédito fiscal por retenciones y anticipos vive en 1355 (Anticipo de impuestos y contribuciones o saldos a favor), y si un ERP concreto lo contabiliza fuera de allí eso se resuelve con un mapeo por nombre de cuenta declarado y auditable, no ampliando el prefijo a un grupo entero. Complemento: la alerta SALDO_A_FAVOR y el factor de 10 puntos no deberían dispararse cuando F03 no proviene íntegramente de 1355.

**Normativa:** PUC Decreto 2650 de 1993: cuenta 1805 = 'Bienes de arte y cultura', subcuentas 180505 Obras de arte, 180510 Bibliotecas, 180595 Otros — 'registra el costo de las adquisiciones… en obras de arte, artesanías y libros con el propósito de fomentar actividades culturales y de investigación'. Verificado en puc.com.co/1805 y puc.com.co/180505. Art. 670 num. 2 E.T. (mod. Art. 293 Ley 1819/2016): 20% del valor devuelto o compensado en exceso cuando la DIAN rechaza o modifica el saldo a favor; num. 1: 10% si el propio contribuyente corrige.

#### P1 · ESC-07 — `costosTotales`, la base del tope del 35% del Art. 771-5 §1, duplica las clases 6 y 7: hasta +71,6% medido, y subestima el mayor impuesto por bancarización

**Dónde:** `src/lib/agents/financial/escudo-survival/lib/extract-totals.ts:126-128`  
**Verificado ejecutando:** sí

**Escenario medido:**

MEDIDO. `const costosTotales = gastos + costosVenta + costosProd` donde `gastos = ct.gastos`, que el preprocesador ya define como clases 5+6+7 (verificado sobre el balance real: ct.gastos = $200.612.741,84 = clase 5 $188.112.741,84 + clase 7 $12.500.000,00, con clase 6 = $0). Resultados: balance real → costosTotales = $213.112.741,84 contra $200.612.741,84 reales, +$12.500.000,00 (+6,2%). Comercializadora sintética (clase 5 $475M, clase 6 $1.200M) → $2.875.000.000,00 contra $1.675.000.000,00 reales, +$1.200.000.000,00 (+71,6%). El bloque que ve el LLM (buildAnchorBlock, extract-totals.ts:194) lo rotula 'Costos totales (clases 5+6+7): $2.875.000.000' y además rotula la línea anterior 'Gastos (clase 5): $1.675.000.000' cuando ese número también incluye 6 y 7. Impacto fiscal medido en un caso donde el tope del 35% es el vinculante (caja 1105 = $900.000.000, clase 5 $450M + clase 6 $400M = $850M de costos reales): topes → 40%·pagos = $360.000.000, 40.000 UVT = $2.094.960.000, 35%·costos reales = $297.500.000 ⇒ exceso no deducible correcto $602.500.000 y mayor impuesto al 35% = $210.875.000. Con el costosTotales del código ($1.250.000.000): 35%·costos = $437.500.000 ⇒ exceso $540.000.000 y mayor impuesto $189.000.000. Subestimación de $21.875.000 (10,4%) en la cifra de exposición que el cliente lee.

**Corrección:**

`costosTotales = gastos` (ya son 5+6+7), o mejor, calcularlo explícitamente como Σclase5 + Σclase6 + Σclase7 y dejar de reutilizar `ct.gastos` para dos cosas. Corregir la etiqueta 'Gastos (clase 5)' del bloque ANCHOR, que hoy publica un número que no es la clase 5. Nota: la base del Art. 771-5 §1 son los 'costos y deducciones totales' fiscales, no el gasto contable — la aproximación debería declararse en el prompt como se declara la del saldo 1105.

**Normativa:** Art. 771-5 par. 1 num. 4 E.T. — desde el cuarto año: el menor entre el 40% de lo pagado en efectivo (tope 40.000 UVT) y el 35% de los costos y deducciones totales. Verificado vigente para 2026 en rivasyasociados.com.co/limites-pagos-efectivo-2026-individual-general-bancarizacion y gerencie.com/pagos-en-efectivo-no-seran-deducibles.html. Los tres topes que usa el prompt son correctos; el defecto está en el dato que se le entrega.

#### P1 · ESC-08 — El catálogo normativo le dice al modelo que el tope de 100 UVT se mide 'por NIT' — la lectura acumulativa que el Consejo de Estado anuló en 2023 — mientras el prompt del mismo módulo le dice lo contrario

**Dónde:** `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:1153 (entrada ART_771_5_ET) y src/lib/agents/financial/escudo-survival/types.ts:20`  
**Verificado ejecutando:** no

**Escenario medido:**

El catálogo dice literalmente: '§2: tope individual 100 UVT por NIT ($5.237.400 COP 2026)'. `types.ts:20` repite: '// Art. 771-5 §2 — pago efectivo a un mismo NIT'. Ambos textos llegan al modelo: el catálogo vía `buildMotorNormativoPrompt` (normative/index.ts:22 → fiscal-agent/prompts/fiscal-agent.prompt.ts:17), que sí está en el camino de producción de /api/escudo/fiscal. Pero `prompts/anti-dian-auditor.prompt.ts:38` le ordena lo contrario con la misma fuerza: 'NEVER sumes los pagos en efectivo hechos a un mismo NIT durante el año para compararlos contra las 100 UVT… El tope del §2 se mide PAGO POR PAGO'. Escenario numérico de la contradicción: doce pagos mensuales de $2.000.000 al mismo proveedor, $24.000.000 en el año. Lectura 'por NIT' (la del catálogo, anulada): $24.000.000 > $5.237.400 ⇒ se rechaza la totalidad ⇒ mayor impuesto 35% = $8.400.000, más sanción por inexactitud del Art. 647/648 al 100% = otros $8.400.000 ⇒ $16.800.000 de exposición anunciada que no existe. Lectura vigente (pago por pago): cada pago de $2.000.000 < $5.237.400 ⇒ cero rechazo. Cuál de las dos instrucciones sigue el modelo no lo determina nada: son dos afirmaciones contradictorias en el mismo contexto, y ningún validador corre (ESC-03).

**Corrección:**

Corregir el `resumen` de ART_771_5_ET a 'tope por PAGO INDIVIDUAL de 100 UVT ($5.237.400 COP 2026); la unidad de medida es la transacción, no el acumulado anual por beneficiario (C. de E., Secc. Cuarta, Sent. 11001-03-27-000-2022-00041-00 (26676) del 19-jul-2023)' y añadir esa sentencia al sub-catálogo de jurisprudencia. Corregir el comentario de types.ts:20. Añadir 'por NIT'/'acumulado anual' a la blacklist del `blacklist.validator` para que la contradicción se detecte en el texto de salida — una vez el validador esté cableado.

**Normativa:** Consejo de Estado, Sección Cuarta, Sentencia 11001-03-27-000-2022-00041-00 (26676) del 19-jul-2023: declaró la nulidad parcial de los Oficios DIAN 0935 del 25-jul-2018 y 1275 del 31-jul-2018; el límite de 100 UVT del par. 2 del Art. 771-5 se aplica por transacción individual y no al acumulado anual al mismo tercero. Verificado en consejodeestado.gov.co/documentos/boletines/269/11001-03-27-000-2022-00041-00(26676).pdf y auren.com/co/blog/consejo-de-estado-corrige-interpretacion-de-la-dian-sobre-pagos-en-efectivo. El prompt del auditor anti-DIAN ya lo cita correctamente; el catálogo no.

#### P2 · ESC-09 — F02 aplica el 35% sin rama para las tarifas del 38% y 40% que siguen vigentes en 2026

**Dónde:** `src/lib/agents/financial/escudo-survival/fiscal-anchor/calculator.ts:23 (TARIFA_RENTA_PCT = 35n)`  
**Verificado ejecutando:** sí

**Escenario medido:**

Una entidad aseguradora o financiera con UAI de $2.228.496.789,73 (la del balance real) obtiene F02 = $779.973.876,41 al 35%. Su tarifa es del 40% (35% + 5 puntos adicionales), es decir $891.398.715,89: F02 subestima el impuesto de referencia en $111.424.839,48 (12,5%), y con ello F04 subestima el saldo a pagar en el mismo monto y F10 sobrestima la cobertura de retenciones (4,5% en vez de 3,98%). Para una generadora hidroeléctrica la tarifa es del 38% y la subestimación es de $66.854.903,69. El propio repo sabe que estas tarifas existen: `survival-validators.ts:760-761` documenta '35% (general), 38% (hidroeléctricas), 40% (financieras/seguros/bolsas)' — pero eso está en el validador muerto, no en el calculador.

**Corrección:**

Parametrizar la tarifa por `CompanyContext.ciiu` / sector con las tres opciones vigentes y su vigencia temporal (40% para financieras y aseguradoras en los períodos gravables 2023-2027; 38% para generación eléctrica con recursos hídricos en 2023-2026). Cuando no se conozca el CIIU, aplicar el 35% y declarar el supuesto en el bloque, no asumirlo en silencio.

**Normativa:** Art. 240 E.T. (mod. Art. 10 Ley 2277 de 2022): tarifa general 35% para el año gravable 2026 — CORRECTA en el código. Par. 7: instituciones financieras, entidades aseguradoras y reaseguradoras y comisionistas de bolsa liquidan cinco puntos adicionales (40% total) durante los períodos gravables 2023 a 2027. Par. 8: generación eléctrica a través de recursos hídricos, tres puntos adicionales (38% total) durante 2023 a 2026. Verificado en actualicese.com/tarifa-general-del-impuesto-de-renta-2026-para-personas-juridicas y estatuto.co/240.

#### P2 · ESC-10 — El contrato del Risk Score está roto en tres puntos: el schema no puede representar el sexto factor, `score` no tiene cota, y el validador tipa una forma que nadie produce

**Dónde:** `src/lib/agents/financial/escudo-survival/fiscal-agent/schemas.ts:117-140 y fiscal-agent/validators/types.ts:99-111 vs tools/risk-score-calculator.ts:295-306`  
**Verificado ejecutando:** sí

**Escenario medido:**

MEDIDO sobre el balance real: `computeRiskScore` devuelve SEIS factores — tet_baja=30, margen_alto=25, costo_bajo=10, crecimiento_inusual=0, saldo_favor_sin_solicitar=0, cobertura_retenciones_baja=5 — total 70. `risk-score.agent.ts:28-38` los inyecta en el prompt como 'SCORE_RIESGO_DIAN_PRECOMPUTADO (vinculante — no recalcular)'. Pero `riskFactorSchema.factor` (schemas.ts:118-124) es un enum de CINCO valores que no incluye 'cobertura_retenciones_baja': el modelo no puede devolver el desglose que se le pidió copiar. O deja fuera el sexto factor (y sus `factores` suman 65 contra un `score` de 70) o emite un valor de enum inválido y Zod lo rechaza. Segundo: `score: z.number()` sin `.min(0).max(100)` y sin ninguna comprobación de que iguale `breakdown.score`. Tercero: `validateRiskScoreL1` (risk-score.validator.ts:73) valida `Modulo3RiskScore`, con campos `factor1_tetVsSector`, `factor2_rentaPresuntiva`, `factor3_proporcionDeducciones`, `factor4_consistenciaIVA`, `factor5_historicoSanciones` — una taxonomía que NINGÚN productor del repo emite; su check L1.3 ('score = suma exacta de los cinco factores') tampoco podría pasar sobre un score de seis factores. Añadido: el encabezado documental de risk-score-calculator.ts:8-30 describe cinco factores con máximo 100 (30+25+20+15+10), mientras la implementación tiene seis con máximo 105 y un `Math.min(100, …)` que trunca sin avisar.

**Corrección:**

Dejar de pedirle al LLM que reproduzca el score. `computeRiskScore` ya es determinista: pasar `breakdown` directo al `RiskScoreModuleResult` y reservar al modelo únicamente `interpretacion` y `recomendaciones`. Si se conserva el campo, añadir 'cobertura_retenciones_baja' al enum, acotar `score` a [0,100] y reconciliar contra el breakdown antes de devolver. Reescribir `Modulo3RiskScore` sobre la forma real o borrar el validador.

#### P2 · ESC-11 — La sanción mínima del catálogo omite la aproximación del Art. 868 E.T.: dice $523.740 donde la cifra diligenciable es $524.000, y el propio repo la calcula bien en otro archivo

**Dónde:** `src/lib/agents/financial/escudo-survival/normative/catalog/sanciones.ts:98-99 (SANCION_MINIMA_ART639)`  
**Verificado ejecutando:** no

**Escenario medido:**

El catálogo declara `tarifa: '10 UVT'` y `tope: '10 UVT = $523.740 COP (UVT 2026: $52.374).'`. 10 × 52.374 = 523.740, pero el Art. 868 E.T. inciso final lit. c) obliga a aproximar al múltiplo de mil más cercano todo valor absoluto derivado de la UVT que supere $10.000, de modo que la sanción mínima 2026 es $524.000. El mismo repositorio ya lo resuelve correctamente: `src/lib/tools/sanction-calculator.ts` define `aproximarValorAbsolutoUvt` y calcula MIN_SANCTION = $524.000 citando el Concepto DIAN 65791 del 16-10-2013. Es la misma constante con dos valores en dos archivos. Impacto: $260 por sanción, trivial en monto pero la cifra del catálogo no es diligenciable en el formulario DIAN, y este catálogo es precisamente el texto que se inyecta en el prompt del Agente Fiscal como fuente normativa autorizada.

**Corrección:**

Cambiar el `tope` de SANCION_MINIMA_ART639 a '10 UVT = $524.000 COP (10 × $52.374 = $523.740, aproximado al múltiplo de mil más cercano por el Art. 868 E.T. inciso final lit. c)'. Mejor aún: importar `aproximarValorAbsolutoUvt` desde sanction-calculator.ts y derivar la cifra, en vez de escribirla a mano por segunda vez.

**Normativa:** Art. 639 E.T. — sanción mínima 10 UVT. Art. 868 E.T. inciso final lit. c) — aproximación al múltiplo de mil más cercano de los valores absolutos superiores a $10.000. UVT 2026 = $52.374 (Resolución DIAN 000238 del 15-dic-2025). Sanción mínima 2026 = $524.000, verificado en actualicese.com/esta-es-la-sancion-minima-tributaria-2026 y accounter.co/noticias/editorial/accounter-uvt-2026-el-nuevo-numero-que-redefine-sanciones-topes-y-planeacion-tributaria.html.

#### P2 · ESC-12 — El Factor 3 del score está documentado como 'Clases 6+7 / Ingresos' pero se calcula sobre las clases 5+6+7: 10 puntos de diferencia en el balance real

**Dónde:** `src/lib/agents/financial/escudo-survival/fiscal-agent/tools/risk-score-calculator.ts:19-22 (encabezado) vs :149-179 (factorCostoBajo)`  
**Verificado ejecutando:** sí

**Escenario medido:**

MEDIDO. El encabezado del archivo define el factor como '3. Costo de ventas bajo (Clases 6+7 / Ingresos): <1% → +20; 1-10% → +10; >10% → +0'. La implementación usa `cents.gastos − cents.impuestoCausado`, y `gastos` son las clases 5+6+7. Sobre el balance real: clase 6 = $0, clase 7 = $12.500.000, ingresos = $2.429.109.531,57 ⇒ según la definición documentada el ratio es 0,51% ⇒ 20 puntos. Según la implementación el ratio es 8,26% ('Costos/Ingresos = 8.25%' en el detalle emitido) ⇒ 10 puntos. Score 70 con la implementación, 80 con la definición. En este balance ambos caen en 'muy_alto' (61-80), pero un cliente con score 55 pasaría de 'alto' a 'muy_alto' según cuál de las dos se aplique. Comentario aparte: en el balance real la clase 6 es $0 y el costo de ventas contabilizado es $12,5M contra ventas de $2.429M con inventario de $1.670M — es decir, el balance tampoco tiene causado el costo de ventas. Junto con ESC-02 esto confirma que sobre este archivo el score está midiendo el grado de avance del cierre contable.

**Corrección:**

Decidir cuál es la definición correcta y dejar una sola. Si el objetivo es detectar 'costo de ventas atípicamente bajo' (que es lo que dice el nombre `costo_bajo` y el detalle 'posible falta de soportes'), el denominador debe ser clases 6+7 y no la clase 5. Y añadir la misma guarda que ESC-02 pide para el Factor 1: si las clases 6 y 7 están ausentes del balance, el factor no es aplicable, no es riesgo máximo.

#### P2 · ESC-13 — 'Score de Riesgo DIAN' presenta como medición del riesgo ante la DIAN una heurística interna sin ninguna calibración externa

**Dónde:** `src/lib/agents/financial/escudo-survival/fiscal-agent/tools/risk-score-calculator.ts:1-37 y src/components/workspace/areas/EscudoArea.tsx:448-449 (GaugeDIAN + RiskScoreKpiRow)`  
**Verificado ejecutando:** sí

**Escenario medido:**

La fórmula (seis factores con pesos 30/25/20/15/10/5 y cortes en 20/40/60/80) está fijada en el propio archivo, sin referencia a ninguna fuente, ninguna calibración contra resultados reales de fiscalización, y ningún test que compare su salida con un caso conocido. La DIAN sí opera un modelo de gestión de riesgos de cumplimiento (TAC) con motores de reglas y perfiles de riesgo, pero su metodología y ponderaciones son documentación interna y no están publicadas, de modo que la fórmula del repo no puede estar alineada con ella ni verificarse contra ella. La UI la presenta con un gauge y la etiqueta 'Score de Riesgo DIAN — 70/100 — ALTO', que se lee como una estimación del riesgo real. Ver ESC-02 para el escenario numérico de cuánto se mueve el número por razones ajenas al riesgo fiscal.

**Corrección:**

Renombrarlo por lo que es —'Índice interno de señales de atención UtopIA'— o publicarlo con la metodología y sus límites visibles junto al número, incluyendo qué input no se pudo medir (ausencia de grupo 54, ausencia de comparativo). Si se mantiene el nombre DIAN, hace falta al menos un conjunto de casos de referencia con desenlace conocido y un test que fije la salida esperada.

**Normativa:** El 'Modelo de Riesgos de Cumplimiento TAC' de la DIAN (motor de reglas para la selectividad y caracterizador de usuarios como base de modelos de scoring / perfil de riesgo) está descrito en dian.gov.co/dian/Documents/Aviso-Modelo-Riesgos-de-Cumplimiento-TAC-VPB.pdf, pero sus factores y ponderaciones no son públicos.

#### P3 · ESC-14 — `TOPE_GENERAL_UVT = 40000` está declarado y no lo consume nadie: el tope general del Art. 771-5 §1 sólo existe como texto del prompt

**Dónde:** `src/lib/agents/financial/escudo-survival/types.ts:21`  
**Verificado ejecutando:** sí

**Escenario medido:**

Grep sobre src/ y scripts/: `TOPE_GENERAL_UVT` aparece únicamente en su propia declaración. `TOPE_INDIVIDUAL_UVT` tiene un único consumidor, `survival-validators.ts:487`, que no corre en producción (ESC-03). El valor 40.000 UVT es normativamente correcto, pero el único lugar donde el tope llega a un cálculo es la prosa del prompt anti-DIAN ('40.000 UVT = $2.094.960.000', que también es correcto): si la UVT cambia en 2027, la constante y el prompt se desincronizan sin que nada lo note. Ese es exactamente el patrón de duplicación sin sincronizar que ya identificó la auditoría integral.

**Corrección:**

Calcular el tope general en TypeScript desde las constantes y pasar el resultado en pesos al prompt, en vez de escribirlo dos veces. Lo mismo con los $5.237.400 del tope individual.

**Normativa:** Art. 771-5 par. 1 num. 4 E.T. — 40.000 UVT; con UVT 2026 = $52.374 ⇒ $2.094.960.000. Ambas cifras del repo son correctas hoy.

#### P3 · ESC-15 — El catálogo de sanciones no tiene entrada para el Art. 651 E.T. (no enviar información exógena), que es la sanción más probable del perfil de cliente

**Dónde:** `src/lib/agents/financial/escudo-survival/normative/catalog/sanciones.ts (SANCIONES: 6 entradas, ninguna 651)`  
**Verificado ejecutando:** sí

**Escenario medido:**

`SANCIONES` cubre 641/642, 644, 647/648, 639, 402 y 643. El Art. 651 sólo aparece de pasada dentro del resumen de otra entrada (estatuto-tributario.ts:1260) y en un prompt de otro módulo (tax-planning/prompts/compliance-validator.prompt.ts:46, que además dice 'hasta 5% montos' sin el tope de 15.000 UVT). El módulo anti-DIAN del Escudo trabaja precisamente sobre cruces de información exógena y cita las Resoluciones DIAN 000227/2025 y 000233/2025, pero cuando el modelo tenga que cuantificar la sanción por no informar no encontrará porcentajes en el catálogo y los pondrá de su cabeza — y ningún validador de citas corre (ESC-03).

**Corrección:**

Añadir una entrada SANCION_NO_INFORMAR_ART651 con los cuatro literales del numeral 1 (5% de las sumas no suministradas, 4% de las erróneas, 3% de las extemporáneas, 0,5% de los ingresos netos cuando no sea posible establecer la base), el tope de 15.000 UVT, el desconocimiento de costos y deducciones del numeral 2, y las reducciones del parágrafo. Verificar los porcentajes contra fuente oficial antes de escribirlos — yo no los verifiqué en esta corrida.

**Normativa:** NO VERIFICADO en esta sesión. Los porcentajes del Art. 651 E.T. (mod. Art. 289 Ley 1819/2016) que recuerdo son 5%/4%/3%/0,5% con tope de 15.000 UVT, pero no los contrasté contra fuente oficial y no deben codificarse sin hacerlo.

### Lo que este auditor NO pudo medir

- Comportamiento real del LLM en El Escudo. NO corrí ningún agente con LLM real: `orchestrateEscudoSurvival` (5 agentes + sintetizador) ni `orchestrateFiscalAgent` (7 módulos + sintetizador). Todo lo que digo sobre las cifras LIBRES es estructural —qué campo autora el modelo y qué validador lo contrastaría si estuviera cableado—, no una medición de su deriva. La magnitud de esa deriva sigue sin medir en esta superficie, igual que la del Editor Jefe HTML sigue sin medir en la del NIIF. El harness que haría falta es el mismo patrón de scripts/fase0-anchor-drift.ts: cruzar `AntiDianResult.data.mayorImpuestoEstimado` contra C1.5, `retencionesAcumuladas` contra F03 y `tet` contra F09, sobre N corridas del balance real.
- ESC-08 y ESC-11 están marcados verificadoEjecutando:false: los verifiqué leyendo el código y contrastando la norma contra fuente oficial, pero no ejecuté el pipeline para observar qué hace el modelo ante las dos instrucciones contradictorias (ESC-08) ni qué cifra imprime para la sanción mínima (ESC-11).
- Art. 651 E.T. — NO verifiqué sus porcentajes ni su tope en UVT contra fuente oficial. Lo reporto como hueco del catálogo (ESC-15), no como error de cifra, y advierto explícitamente que las cifras que menciono son de memoria y no deben codificarse sin verificar.
- Autorretención especial por CIIU (RTF_AUTORETENCIONES_ESPECIALES_CIIU en tarifas-retencion.ts): verifiqué que el Decreto 0572/2025 rige desde el 01-jul-2026 tras el auto del Consejo de Estado del 02-jun-2026 que revocó la suspensión, y que la ventana de suspensión del 07-may-2026 existió — todo eso coincide con lo que dice el catálogo. Lo que NO verifiqué es la tabla completa de escalones por código CIIU (0,55% a 4,50%) ni los ejemplos concretos que el catálogo cita (carbón 4,50%, transporte de carga 3,50%, etc.). Cada uno requeriría leer el Art. 1.2.6.8 del DUR sustituido. Tampoco verifiqué el proceso de nulidad de fondo, que sigue abierto.
- El régimen especial del Art. 771-5 §5 (agro / comercializadores SIMPLE / cooperativas de productores, 70% de costos desde 2022) y el Concepto DIAN 010383 del 22-jun-2026 que el prompt cita: no los verifiqué contra fuente oficial. El prompt los maneja con cuidado (aplica el régimen general por defecto y declara la salvedad), pero el porcentaje del 70% y ese concepto quedan sin contrastar.
- Reteica y el calendario de ICA de Bogotá: las seis fechas de ICA_BOGOTA_BIMESTRAL_2026 (Resolución SDH-000195 del 12-dic-2025) no las verifiqué contra la Secretaría Distrital de Hacienda. El código las marca `requiereVerificacion: true` siempre, que es la conducta correcta, así que el riesgo está acotado — pero las fechas en sí quedan sin contrastar.
- Tarifas de ReteIVA (15% general Art. 437-1, 100% Arts. 437-4/437-5) y de dividendos (Art. 242 tras la Ley 2277/2022): no las verifiqué en esta corrida. Las tres tarifas de retención que sí verifiqué (compras, servicios, honorarios, arrendamientos, rendimientos financieros) salieron todas correctas, lo que da confianza sobre el catálogo, pero no es evidencia sobre estas entradas.
- Persistencia y frecuencia real del fallback de ESC-01: comprobé que la ruta GET /api/escudo/fiscal-anchor PUEDE devolver `fiscalSnapshot: null` con `ancora` presente (dos consultas independientes a la tabla `reports`, kinds distintos) y que `useAncoraView` cae al `ccvFiscal` en ese caso. NO consulté la base de producción para saber cuántos workspaces están hoy en ese estado, es decir cuántos clientes están viendo la derivación divergente.


---

## Ratios, KPIs y proyecciones del Strategy Director (Agente 2): 13 ratios financieros, dashboard ejecutivo, DuPont, tendencias YoY, punto de equilibrio, flujo de caja proyectado Big Four a 3 años, KPIs de control de caja y alertas técnicas

**Veredicto:** `sin-garantia`

### Resumen del auditor

Medido con LLM real (1 corrida, 169s) sobre el balance de cliente real, más 9 corridas deterministas sobre ese balance, el fixture élite y los 6 patológicos.

LA BUENA NOTICIA, MEDIDA: los 13 ratios NO los inventa el modelo. Los calcula el código (`computeDerivedKpis`) y viajan al prompt como "KPIs PRE-CALCULADOS ... VINCULANTES". Con LLM real el Strategy Director los copió: 10/13 exactos al redondeo, 2 respetaron el sentinel "ND", 1 (Días de Cartera) redondeado a lo que el propio bloque imprime. Las 5 cifras ancla del dashboard (Activo/Pasivo/Patrimonio/Ingresos/Utilidad Neta) salieron al centavo. La obediencia del modelo NO es el problema de esta superficie.

LA MALA, TAMBIÉN MEDIDA — tres capas:

(1) LA CIFRA DETERMINISTA ESTÁ MAL. `ingresos` (clase 4) ya viene neto de devoluciones porque la 4175 vive DENTRO de la clase 4 con signo negativo (medido: −$326.922.206,12). Luego `ingresosNetos` vuelve a restar Σ|4175| = $327.911.343,88. Resultado publicado: MARGEN NETO 106,06% — una utilidad mayor que los ingresos, imposible. El modelo lo imprimió obediente ("106,1%") porque el bloque dice "NO los recalcules, cita LITERAL". Contamina además margen operativo, rotación de activos y días de cartera.

(2) EL MISMO PDF IMPRIME TRES NÚMEROS PARA EL MISMO RATIO. Página 4 (KPIGridPage): "Margen Neto 106,1%". Página 10 (OrbitalPillarsPage): "Margen Neto Real 91,7%". Lo que da la calculadora del contador con las cifras impresas: 91,74%. Dispersión 14,41 puntos porcentuales dentro de un solo documento. Igual con "Días de Autonomía": 5713 (pág. 4) / 4392 (pág. 10) / 4932 (Markdown y HTML). Y con EBITDA: $2.242.618.823,10 (PDF) vs $2.244.636.798,15 (Strategy). La auditoría integral acertó el diagnóstico; el reparto de caminos cambió (Excel y PDF ya leen `controlTotals`), pero la divergencia sigue viva por el motor de pilares, que reimplementa margen y autonomía con fórmulas propias.

(3) LA PROYECCIÓN ES LIBRE, SIN EXCEPCIÓN. Punto de equilibrio, los 3 escenarios × 13 líneas × 4 años, los KPIs de control, DuPont, tendencias y bandas: los autora el modelo entero. Existen tres validadores escritos para exactamente esto (`detectInflatedCash`, `detectMissingWorkingCapital`, `detectMissingControlKPIs`) y NINGUNO CORRE en producción: sólo los invoca `validateConsolidatedReport`, importado únicamente por `orchestrateFinancialReport`, y el navegador ensambla el informe con `buildClientConsolidatedReport` — que en su propio comentario declara que no ejecuta ese validador. `/export` entra por FAST PATH y tampoco. Es el patrón "gate existente pero desconectado" que ya identificó la auditoría integral.

Y una trampa para quien vaya a conectarlos: `detectInflatedCash` está roto. Medido sobre el Markdown real, acusa "Saldo Inicial Caja $4,20 vs $2.413.677.888,64 (100,0%)" porque su regex engancha el ENCABEZADO "### 4.2 Saldo Inicial Depurado" y lee el "4.2" del número de sección. La línea de dato real es correcta al centavo. Conectarlo hoy bloquearía todo informe correcto.

Sustancia económica de la proyección, medida: la aritmética interna cuadra al centavo (verifiqué el escenario base Año+1 línea por línea: $2.241.339.825,50 exacto), pero los supuestos no los fija ni el cliente ni el dato — los fija el prompt (−15%/+2,5%/+15%) o el modelo. La proyección nunca paga el impuesto de renta del año base: presenta "(-) Impuesto de renta causado $0" sobre una utilidad de $2.228.496.789,73 (≈$780M al 35%, Art. 240 E.T.) y acumula $7.753.778.428,71 de caja al Año+3. Y el punto de equilibrio deja $16.140.008,42 de la base de costos fuera de la partición fijo/variable.

Monte Carlo: existe simulación REAL en código (Mulberry32 + Box-Muller, 9.600 iteraciones, `src/lib/pillars/monte-carlo.ts`) pero vive en /workspace/comando, no en esta superficie. Los "3 escenarios" del Strategy Director no son simulación: son tres aritméticas deterministas con tasas fijadas en el prompt.

NORMATIVA: las constantes fiscales que el prompt inyecta están CORRECTAS hoy — UVT 2026 $52.374 (Res. DIAN 000238 de 15-dic-2025), renta PJ 35% (Art. 240 E.T. mod. Art. 10 Ley 2277/2022), TMT 15% (par. 6 Art. 240). El prompt sí omite las sobretasas del Art. 240 (financieras 40% hasta 2027, hidroeléctricas 38% hasta 2026): irrelevante para esta empresa de comercio, latente para un cliente financiero.

### Inventario cifra por cifra

| Cifra | Estado | Productor | Validador |
|---|---|---|---|
| Los 13 ratios financieros (razón corriente, prueba ácida, endeudamiento, apalancamiento, cobertura intereses, margen operativo, margen neto, ROE, ROA, rotación activos, días cartera/inventario/proveedores) | **DETERMINISTA** | `src/lib/preprocessing/trial-balance.ts:2094 (computeDerivedKpis); recomputados post-curator en trial-balance.ts:1023-1064; emitidos al LLM en src/lib/agents/financial/orchestrator.ts:667-700` | No aplica — los calcula el código. PERO nadie audita la CORRECCIÓN de la fórmula: margen neto/operativo/rotación/días-cartera usan `ingresosNetos`, que resta las devoluciones dos veces (ver H1). Se calculan en `number` de JS, no en BigInt/centavos. |
| KPIs del Strategy Director (kpis[].resultPrimary / resultComparative) | ANCLADA | `src/lib/agents/financial/agents/strategy-director.ts:83-95 (callFinancialAgent); prompt de anclaje en src/lib/agents/financial/prompts/strategy-director.prompt.ts:165-203` | NINGUNO. `runStrategyPhase` (orchestrator.ts:1704-1732) llama a `runStrategyDirector` y devuelve `toStrategicAnalysisResult(json)` (strategy-director.ts:334) sin cruzar una sola cifra. La validación se agota en el schema Zod (tipos, no valores). |
| Dashboard ejecutivo — Total Activo, Pasivo, Patrimonio, Ingresos, Utilidad Neta | ANCLADA | `src/lib/agents/financial/contracts/strategy-report.ts:143-150 (ExecutiveDashboardRowSchema); render en strategy-director.ts:132-159` | Ninguno en esta fase. Aguas abajo `reconcileBindingFigures` (agents/html-editor-validator.ts:834) exige presencia literal, pero SÓLO de las cifras del NIIF (`collectBindingFigures(input.niifReport)`); el JSON de strategy entra únicamente como lista permisiva. |
| Dashboard — EBITDA | **LIBRE** | `strategy-director.ts:132-159 (fila libre del dashboard, sin campo dedicado en el schema)` | Ninguno. |
| Dashboard — Impuesto de renta causado | ANCLADA | `strategy-director.ts:132-159; identidad exigida en prompts/strategy-director.prompt.ts:100 y :117` | La identidad utilidadNeta = UAI − impuestoCausado la vigila el niif-json-validator (E-codes), no esta fase. |
| Punto de equilibrio — fixedCostsCop, variableCostsCop, breakEvenPointCop, marginOfSafetyPct, classificationNote | **LIBRE** | `src/lib/agents/financial/contracts/strategy-report.ts:158-165 (BreakEvenAnalysisSchema); render en strategy-director.ts:208-219` | NINGUNO. No existe validador de break-even en el repo — ni conectado ni desconectado. |
| Flujo de caja proyectado — 3 escenarios × 13 líneas × 4 años, saldos finales | **LIBRE** | `src/lib/agents/financial/contracts/strategy-report.ts:208-220 (ProjectedCashFlowSchema); render en strategy-director.ts:223-285` | src/lib/agents/financial/validators/report-validator.ts:489 (detectInflatedCash, HARD FAIL), :572 (detectMissingWorkingCapital) y :614 (detectMissingControlKPIs) EXISTEN pero NO CORREN en producción: sólo los invoca validateConsolidatedReport (report-validator.ts:180), importado únicamente por orche |
| liquidityGate (AC, PC, brecha) y saldo inicial de caja PUC 11 | ANCLADA | `contracts/strategy-report.ts:192-198 y :210; render en strategy-director.ts:226-247` | detectInflatedCash (report-validator.ts:489) sería el validador — pero NO CORRE en producción y además está roto (ver H6). |
| KPIs de control de caja (net_cash_margin, days_of_autonomy, cumulative_return_on_flow) | **LIBRE** | `contracts/strategy-report.ts:200-206; render en strategy-director.ts:268-281` | detectMissingControlKPIs (report-validator.ts:614) sólo comprueba PRESENCIA de las etiquetas, nunca los valores — y no corre; y pide 'Tasa de Retorno sobre Flujo Acumulado' mientras el productor imprime 'Retorno sobre Flujo Acumulado' (strategy-director.ts:276). |
| Análisis DuPont (roe, netMargin, assetTurnover, financialLeverage) | **LIBRE** | `contracts/strategy-report.ts:324-333; render en strategy-director.ts:180-190` | Ninguno. El prompt describe un 'CHECK auto-validable' (strategy-director.prompt.ts:191) que exige dupontAnalysis.roe == KPI ROE, pero es una instrucción al modelo, no código. |
| Tendencias YoY (yoyRevenue, yoyEbitda, yoyNetIncome, yoyEquity, marginDeltaPp) | **LIBRE** | `contracts/strategy-report.ts:336-346; render en strategy-director.ts:195-207` | Ninguno. |
| benchmarkBand, anomalyFlag, confidence por KPI | **LIBRE** | `contracts/strategy-report.ts:65-69, :120-128` | Ninguno. No existe catálogo de bandas sectoriales CIIU en el repo; el prompt cita 'benchmark CTCP/DANE' (strategy-director.prompt.ts:149) sin fuente cableada. |
| technicalAlerts (semáforo del resumen ejecutivo) | **LIBRE** | `contracts/strategy-report.ts:250-257, :317-319` | Ninguno. |
| Ratios impresos en el PDF Élite (KPIGridPage, pág. 4) | **DETERMINISTA** | `src/lib/export/pdf-elite-react/compose.ts:678 (resolveRatios) y :704 (buildKpiGrid)` | Ninguno cruza el grid contra las otras páginas del mismo PDF. |
| Ratios impresos en el Excel (hoja 'KPIs') | **DETERMINISTA** | `src/lib/export/excel-export.ts:1051 (ratioFromControlTotals) y :1065 (computeKPIs)` | Ninguno. |
| Margen Neto Real y ROE Dinámico del Pilar Valor (PDF pág. 10 + workspace) | **LIBRE** | `src/lib/pillars/valor.ts:37 (margenNeto = (utilidadNeta − reclassImpact)/ingresos) y :65 (roe)` | Ninguno cruza los pilares contra controlTotals. Existe src/lib/pillars/single-source-validator.ts y sync-validator.ts — no verifiqué si cubren estos dos KPIs. |
| Días de Autonomía | **LIBRE** | `Tres productores: src/lib/pillars/escudo-cards.ts:209-213 (5712,73), src/lib/pillars/escudo.ts:47 (4391,51) y el LLM en contracts/strategy-report.ts:200-206 (4932)` | Ninguno. |
| Ratios del HTML (Editor Jefe — el entregable que más lee el cliente) | **LIBRE** | `src/lib/agents/financial/prompts/html-editor.prompt.ts:183 ('ROE consistente ... fórmula única de controlTotals.roe')` | validateHtmlChecklist y reconcileBindingFigures SÍ corren (agents/html-editor.ts:269 y :279) pero NO cubren ratios: checkColumnArithmetic (html-editor-validator.ts:644) sólo suma celdas que contienen '$' y descarta explícitamente ratios y porcentajes (comentario en :604-606); reconcileBindingFigures |
| Margen neto de la vista Áncora del workspace | **LIBRE** | `src/lib/ancora/derive-ancora-view.ts:157 (margenNetoPct = utilidadNeta/ingresos × 100)` | Ninguno. |
| Simulación Monte Carlo | **DETERMINISTA** | `src/lib/pillars/monte-carlo.ts (mulberry32 + Box-Muller, 9.600 iteraciones, seed fijo)` | No aplica. |

Reparto: **4** deterministas · **4** ancladas · **12** libres.

### Hallazgos

#### P0 · H1 — Doble resta de devoluciones (PUC 4175): el margen neto publicado es 106,06% — mayor que los ingresos

**Dónde:** `src/lib/preprocessing/trial-balance.ts:1473 (ingresosNetos = ingresosBrutoAbs − totalDevoluciones) contra :1366 (totalRevenue = getClassTotal(4))`  
**Verificado ejecutando:** sí

**Escenario medido:**

Balance real grupo-empresarial-2tres-sas.xlsx, periodo 2025. Medido: las hojas de clase 4 suman $2.429.109.531,57 y DENTRO de esa suma el grupo 4175 aporta −$326.922.206,12 (41750501 −$326.131.036,00; 41750502 −$1.285.739,00; 41750503 +$494.568,88). Es decir `ingresos` YA está neto de devoluciones. Acto seguido `totalDevoluciones` suma los VALORES ABSOLUTOS de esas mismas hojas = $327.911.343,88 y los vuelve a restar: ingresosNetos = 2.429.109.531,57 − 327.911.343,88 = $2.101.198.187,69. Como `netIncome` (trial-balance.ts:1370) sí usa el bruto de clase 4, el numerador queda arriba del denominador. Salidas incorrectas medidas: margenNeto 106,0584% (correcto 91,7413%), margenOperativo 91,2206% (correcto 92,4058%, porque el EBIT arrastra la misma resta), rotacionActivos 0,6017 (correcto 0,6956), diasCartera 16,68 (correcto 14,43). El comparativo 2024 repite el patrón: margen 108,7109% frente a 93,8202%, devoluciones dobles $229.614.537,88. Esas cifras se emiten al prompt bajo 'AUTORIDAD: estos KPIs son VINCULANTES. NO los recalcules. Cita los valores LITERALMENTE' (orchestrator.ts:699) y el Strategy Director, medido con LLM real, imprimió obediente 'Margen Neto 106,1%'. El mismo número llega al Excel, al grid del PDF y al HTML.

**Corrección:**

`totalDevoluciones` debe leer el signo, no el valor absoluto, y decidir según la convención ya detectada por `sign-convention.ts`: si las hojas 4175 llegan negativas (crédito-normalizado, es decir ya restadas dentro de la clase 4), `ingresosNetos = |totalRevenue|` sin resta adicional, y el ingreso BRUTO es |totalRevenue| + Σ|4175| = $2.756.031.737,69; si llegan positivas (débito, fuera del neto), conservar la resta actual. Añadir además una aserción incondicional en `computeDerivedKpis`: |margenNeto| > 100 con ingresos > 0 es imposible salvo por ingresos no operacionales excluidos del denominador — devolver null (ND) con motivo, igual que ya se hace con diasInventario/diasProveedores.

**Normativa:** NIIF 15 §47 (ingresos netos de devoluciones, descuentos y rebajas) y PUC Decreto 2649/1993 grupo 4175 — la norma que el comentario del código cita es correcta; el defecto es de implementación, no de criterio normativo. No requirió verificación de tarifa.

#### P0 · H2 — El mismo PDF imprime dos márgenes netos distintos: 106,1% en la página 4 y 91,7% en la página 10

**Dónde:** `src/lib/pillars/valor.ts:37 frente a src/lib/preprocessing/trial-balance.ts:2131 (controlTotals.margenNeto)`  
**Verificado ejecutando:** sí

**Escenario medido:**

Balance real, 2025, un solo PDF Élite generado por el FAST PATH de producción (src/app/api/financial-report/export/route.ts:238, que es el que usa el navegador). Medido ejecutando composeEditorialReport con los mismos pillars que arma la ruta: KPIGridPage (pág. 4, compose.ts:704) imprime 'Margen Neto 106,1%' leyendo controlTotals.margenNeto = 106,0584%. OrbitalPillarsPage (pág. 10, compose.ts:935 pickHeadlineKpi sobre kpis[0]) imprime 'Margen Neto Real 91,7%' leyendo pillars.valor = (utilidadNeta 2.228.496.789,73 − reclassImpact 2.184.714,88) / ingresos 2.429.109.531,57 = 91,6514%. Dispersión 14,4070 puntos porcentuales en el mismo documento. Un tercer número, 91,7413%, es el que obtiene el contador dividiendo las dos cifras que el propio PDF imprime (Utilidad Neta $2.228.496.789,73 / Ingresos $2.429.109.531,57). Ninguno de los tres coincide con los otros dos y no existe check que compare páginas.

**Corrección:**

Una sola fuente. `computeValorPillar` debe consumir `controlTotals.margenNeto` en vez de recalcular, del mismo modo que ya hace con el ROE (que sí coincide: 117,6180% en ambos caminos, medido). Si el ajuste por reclasificaciones R1 aporta valor analítico, publicarlo como KPI con OTRO nombre y su propia definición visible, nunca como 'Margen Neto Real' compitiendo con 'Margen Neto'. Añadir un test de coherencia intra-documento sobre el IR de composeEditorialReport: todo par (etiqueta, periodo) que aparezca en dos páginas debe llevar el mismo valor.

#### P0 · H3 — Los tres validadores del Flujo de Caja Big Four no corren en producción: la proyección entera es LIBRE

**Dónde:** `src/lib/agents/financial/validators/report-validator.ts:450-457 (invocados) contra src/lib/agents/financial/orchestrator.ts:1916 (único call-site) y src/components/workspace/PipelineWorkspace.tsx:600`  
**Verificado ejecutando:** sí

**Escenario medido:**

Cadena de llamadas verificada por grep exhaustivo: `detectInflatedCash`, `detectMissingWorkingCapital` y `detectMissingControlKPIs` no tienen ningún importador fuera de `report-validator.ts`; los invoca sólo `validateConsolidatedReport` (:180); a ésta la importa sólo `orchestrator.ts:28` y la llama sólo en `orchestrateFinancialReport` (:1916); y `orchestrateFinancialReport` sólo lo llaman `/api/financial-report` (legacy) y el SLOW PATH de `/api/financial-report/export`. El navegador (PipelineWorkspace) llama a `/niif`, `/strategy`, `/governance` y `/html` y ensambla el Markdown con `buildClientConsolidatedReport`, cuyo propio comentario en la línea 597 dice: 'este cliente NO ejecuta validateConsolidatedReport'. Para descargar, PipelineWorkspace:1167 y :1218 postean `{ report, rawData }` a `/export`, que entra por el passthrough Mode 2 (export/route.ts:64) o por el FAST PATH de pdf-elite (:238) — ninguno reorquesta. Consecuencia concreta medida sobre la corrida real: la proyección declaró un saldo de caja de $7.753.778.428,71 al Año+3 (escenario base) y días de autonomía de 4932/2212/2700, y ninguna línea de código contrastó una sola de esas cifras con nada.

**Corrección:**

Mover los tres detectores fuera de `validateConsolidatedReport` y llamarlos dentro de `runStrategyPhase` (orchestrator.ts:1704), que es el único punto que atraviesan tanto el camino legacy como el partido — el mismo patrón con que se cableó `auditReportEmittable` en `prepareFinancialContext`. Ejecutarlos sobre el JSON (`StrategyReportJson`), no sobre Markdown re-parseado: `projectedCashFlow.initialCashBalanceCop` vs `controlTotals.cents.efectivoCuenta11` es una comparación de enteros exacta y no necesita regex. Emitir el resultado como salvedad en el cuerpo del informe, no como evento SSE `warning` — la auditoría integral ya verificó que esos mueren en el navegador. ARREGLAR H4 ANTES DE CONECTAR.

#### P1 · H4 — detectInflatedCash está roto: si se conecta hoy, falla duro TODO informe correcto

**Dónde:** `src/lib/agents/financial/validators/report-validator.ts:512-513 (labelPattern) y :530-531 (extractor numérico)`  
**Verificado ejecutando:** sí

**Escenario medido:**

Ejecutado sobre el Markdown que produjo el Strategy Director real, con controlTotals.efectivoCuenta11 = $2.413.677.888,64. Devolvió: 'Caja inflada (Big Four): Strategy Director reporta Saldo Inicial Caja $4,20 pero el balance dice $2.413.677.888,64 (PUC 11). Diferencia $2.413.677.884,44 (100.0% del valor esperado)'. Es FALSO. El informe es correcto: la línea 61 del Markdown dice '- Saldo Inicial Caja: $2.413.677.888,64', idéntica al ancla al centavo. El validador falla porque su regex /saldo\s+inicial(?:\s+(?:de\s+)?caja)?/i engancha primero el ENCABEZADO de la línea 60, '### 4.2 Saldo Inicial Depurado (PUC 11)', que el adapter emite en strategy-director.ts:243; el extractor numérico toma entonces el '4.2' del número de sección y parseCopAmount lo lee como $4,20; el bucle hace break y nunca llega a la línea de dato. Los guardas de exclusión no ayudan: buscan /puc\s*1[2-4]/ y el encabezado dice 'PUC 11'. Como el detector es HARD FAIL (errors.push en :451), conectarlo tal cual convertiría todo informe correcto en no emitible.

**Corrección:**

No parsear Markdown. Comparar `BigInt(json.projectedCashFlow.initialCashBalanceCop)` contra `controlTotals.cents.efectivoCuenta11` con tolerancia 0 — el dato existe en centavos exactos en ambos lados y el rodeo por texto sólo añade modos de fallo. Si por compatibilidad hay que conservar la variante textual, exigir que la línea empiece por viñeta o pipe y contenga ':' antes del número, y descartar líneas que empiecen por '#'.

#### P1 · H5 — 'Días de Autonomía': tres valores distintos para el mismo indicador en el mismo entregable

**Dónde:** `src/lib/pillars/escudo-cards.ts:209-213 y :316-324, contra src/lib/pillars/escudo.ts:47, contra src/lib/agents/financial/contracts/strategy-report.ts:200-206`  
**Verificado ejecutando:** sí

**Escenario medido:**

Balance real, 2025, un solo informe. Medido: (a) `escudoCards.autonomia.value` = 5.712,7265 → el grid del PDF (compose.ts:738 findCardValue, que indexa el objeto escudoCards por clave) imprime '5713 días'; (b) `escudo.kpis[key='dias_autonomia'].value` = 4.391,5078 → OrbitalPillarsPage (compose.ts:935 pickHeadlineKpi toma kpis[0]) imprime '4392 días'; (c) el Strategy Director, con LLM real, emitió days_of_autonomy = 4932 días para el Año+1, que es lo que sale en el Markdown y en el HTML. Diferencia máxima 1.321 días (30%) entre dos números impresos en páginas 4 y 10 del MISMO PDF. Ambas páginas se renderizan siempre: EditorialReportDoc.tsx:105 monta KPIGridPage y :131 OrbitalPillarsPage cuando hay pillars, y el FAST PATH de /export siempre agrega pillars (export/route.ts:258-268).

**Corrección:**

`computeEscudoPillar` y `buildEscudoCards` deben compartir una única función de autonomía; hoy `escudo-cards.ts:213` divide entre `avgMonthlyEgresos × 30` con un ajuste posterior por proyectos futuros (:302-307) que `escudo.ts` no aplica. Elegir una definición, exportarla y que ambos la importen. Y el KPI de control del Strategy Director debe citar ese valor como ancla en vez de autorarlo.

#### P1 · H6 — EBITDA: dos cifras en el mismo informe, y una tercera base operativa en los ratios

**Dónde:** `src/lib/pillars/valor-cards.ts:138 (ebitda = utilidadOperacional + depreciaciones + amortizaciones) contra el dashboard LLM (strategy-director.ts:132-159) contra src/lib/preprocessing/trial-balance.ts:1484 (ebit)`  
**Verificado ejecutando:** sí

**Escenario medido:**

Balance real, 2025. Medido: el grid del PDF imprime 'EBITDA $2.242.618.823,10' (valorCards.ebitda); el Strategy Director, con LLM real, emitió en el dashboard ejecutivo 'EBITDA $2.244.636.798,15'; y `controlTotals.ebit`, que es el numerador del Margen Operativo publicado (91,2%), vale $1.916.725.454,27. Las dos primeras difieren en $2.017.975,05. La tercera difiere de la segunda en exactamente $327.911.343,88 — las devoluciones del H1 — lo que confirma que el modelo calculó el resultado operativo sobre ingresos brutos mientras el ratio lo calcula sobre los netos doblemente restados. El informe presenta así un EBITDA de $2.244M junto a un margen operativo del 91,2% que corresponde a un EBIT de $1.917M: el lector no puede reconciliar 91,2% con ninguna pareja de cifras impresas.

**Corrección:**

Publicar EBITDA como campo del contrato (`StrategyReportSchema`) anclado a un `controlTotals.ebitda` determinista, derivado del mismo EBIT que alimenta `margenOperativo`, y que `valor-cards.ts` lo consuma en vez de recomponerlo. Resolver H1 primero: mientras el EBIT arrastre la doble resta, cualquier unificación cementa la cifra equivocada.

#### P1 · H7 — El punto de equilibrio deja $16,1M de la base de costos fuera de la partición fijo/variable, sin que nada lo detecte

**Dónde:** `src/lib/agents/financial/contracts/strategy-report.ts:158-165 (BreakEvenAnalysisSchema)`  
**Verificado ejecutando:** sí

**Escenario medido:**

Corrida con LLM real sobre el balance real. El modelo emitió fixedCostsCop $166.541.334,10 y variableCostsCop $17.931.399,32, que suman $184.472.733,42. La base de costos real del periodo es clase 5 ($188.112.741,84) + clase 7 ($12.500.000,00) = $200.612.741,84. Faltan $16.140.008,42 — y no es azar: el propio modelo los usó en la proyección como línea '(-) Gastos financieros y otros egresos recurrentes' por exactamente $16.140.008,42, o sea que sí particionó toda la base de costos para el flujo pero excluyó ese tercio del cálculo del punto de equilibrio. Efecto: PE declarado $167.779.864,18 y margen de seguridad 93,1%. Incluyendo los gastos financieros como fijos —que es lo habitual— el PE sube a ≈$184.039.000. La aritmética CF/(1−CV/I) el modelo la hace bien (recalculada: $167.779.865,23, diferencia $1,05), así que ningún check de aritmética interna lo atraparía: el error está en qué entra en cada bucket. No existe validador de break-even en el repo.

**Corrección:**

Añadir al contrato una identidad verificable por código: fixedCostsCop + variableCostsCop debe igualar `controlTotals.gastos` (clase 5+6+7) con tolerancia $0, o el schema debe exigir un tercer campo `excludedCostsCop` con justificación. Validarla en `runStrategyPhase` junto con los detectores de H3. Es una comprobación de enteros, no requiere juicio contable — el juicio (qué es fijo y qué variable) sigue siendo del modelo, pero el reparto tiene que ser exhaustivo.

#### P1 · H8 — La proyección acumula $7.754M de caja sin pagar nunca el impuesto de renta del año base

**Dónde:** `src/lib/agents/financial/prompts/strategy-director.prompt.ts:120 (provisión de renta = Utilidad Operativa Proyectada × 35%, pago en el periodo siguiente)`  
**Verificado ejecutando:** sí

**Escenario medido:**

Corrida con LLM real, balance real, escenario base. El dashboard declara 'Utilidad antes de impuestos $2.228.496.789,73' y '(-) Impuesto de renta causado $0' (el balance no trae provisión en el grupo 54). La proyección paga en Año+1 el saldo de PUC 24 ($105.537.824,41) y causa la provisión del Año+1 ($804.389.109,34) para pagarla en Año+2 — regla del prompt correctamente aplicada. Pero el impuesto sobre la utilidad de 2025, ≈$780.000.000 al 35% (Art. 240 E.T.), NO aparece en ninguna columna: no está causado en el balance ni programado como salida de caja. Resultado publicado: Saldo Final de Caja Año+3 = $7.753.778.428,71 (base) y $9.446.312.453,59 (agresivo). Verifiqué la aritmética del escenario base Año+1 línea por línea y cuadra al centavo ($2.241.339.825,50), así que el defecto no es de cálculo: es un pasivo fiscal ausente que la proyección da por inexistente. Honestidad: el modelo SÍ emitió una alerta técnica roja 'Impuesto de renta no causado' y puso confidence='low' — el aviso existe en prosa, la caja proyectada no lo refleja.

**Corrección:**

Cuando `controlTotals.impuestoCausado` sea 0 y la utilidad antes de impuestos sea material, el flujo proyectado debe incluir una línea obligatoria de pago del impuesto del año base estimado al 35%, o bloquear la proyección igual que hace el gate de liquidez. Es la misma clase de regla que ya existe para AC<PC (prompt :225) y debe ser código, no instrucción: hoy depende de que el modelo se acuerde.

**Normativa:** Tarifa general del 35% verificada como VIGENTE para el año gravable 2026: Art. 240 E.T., modificado por el Art. 10 de la Ley 2277 de 2022. Tasa Mínima de Tributación (Tasa de Tributación Depurada) del 15%, par. 6 del Art. 240 E.T. Fuentes consultadas: actualicese.com/tarifa-general-del-impuesto-de-renta-2026-para-personas-juridicas/ y estatuto.co/240 (esta última devolvió HTTP 403 a la lectura directa; me apoyé en el resultado de búsqueda). El prompt omite las sobretasas del mismo Art. 240 —financieras +5 pp (40%) para 2023-2027 y generación hidroeléctrica +3 pp (38%) para 2023-2026—: inocuo para esta empresa de comercio, latente si el cliente es entidad financiera.

#### P2 · H9 — detectMissingControlKPIs exige una etiqueta que el productor nunca emite: falso positivo permanente

**Dónde:** `src/lib/agents/financial/validators/report-validator.ts:631-634 contra src/lib/agents/financial/agents/strategy-director.ts:276`  
**Verificado ejecutando:** sí

**Escenario medido:**

Ejecutado sobre el Markdown de la corrida real, devolvió: 'KPIs de Control de Caja ausentes (Big Four 4.8): faltan Tasa de Retorno sobre Flujo Acumulado'. Es falso: el informe SÍ trae el KPI, en la línea 139, como '| Retorno sobre Flujo Acumulado | 92,9% | 156,3% | 221,2% |'. El validador busca /tasa\s+de\s+retorno\s+sobre\s+(?:el\s+)?flujo\s+acumulado/i y el `labelMap` del adapter imprime 'Retorno sobre Flujo Acumulado', sin el prefijo 'Tasa de'. Como el detector tampoco corre en producción (H3), hoy no molesta a nadie; pero al conectarlo emitiría un warning en el 100% de los informes. Es exactamente el patrón que la memoria del proyecto llama 'cableado prompt↔renderer': la regla cita un campo vinculante y nadie verificó el renderer.

**Corrección:**

Alinear las dos puntas y sacarlas de la duplicación: exportar el `labelMap` desde `strategy-director.ts` y que el validador derive sus patrones de esa constante, en vez de repetir literales. Alternativamente validar sobre `json.projectedCashFlow.controlKpis` por el enum `name`, que es estable, en lugar de buscar etiquetas en prosa.

#### P2 · H10 — Tres bases de ingresos distintas dentro del mismo informe del Strategy Director

**Dónde:** `src/lib/agents/financial/contracts/strategy-report.ts:161 (breakEven.revenueCop) contra src/lib/preprocessing/trial-balance.ts:1473 (ingresosNetos, denominador de los márgenes)`  
**Verificado ejecutando:** sí

**Escenario medido:**

Corrida con LLM real, balance real, un solo informe. Medido: el punto de equilibrio usa revenueCop = $2.429.109.531,57; los márgenes (neto y operativo) usan $2.101.198.187,69; el dashboard ejecutivo imprime AMBAS como filas separadas, etiquetadas 'Ingresos brutos Clase 4 $2.429.109.531,57' e 'Ingresos netos de devoluciones $2.101.198.187,69'. Y las dos etiquetas son incorrectas por H1: la bruta real es $2.756.031.737,69 y la neta real es $2.429.109.531,57. O sea que el informe llama 'bruto' a lo que es neto y 'neto' a una cifra que no corresponde a nada. La proyección de caja usa además la primera como cobro íntegro del periodo, lo que supone además que las devoluciones no consumen caja.

**Corrección:**

Exponer ambas magnitudes una sola vez en `controlTotals` con nombres inequívocos (`ingresosBrutos` = Σ|clase 4 sin 4175|, `ingresosNetos` = ingresosBrutos − Σ|4175|), corregidas según H1, y que el schema del Strategy Director referencie explícitamente cuál usa cada sección. Hoy el prompt no dice qué base usar en el break-even y el modelo elige.

#### P2 · H11 — La hoja 'KPIs' del Excel mezcla cifras pre-curator con ratios post-curator: los ratios no se reproducen desde las filas impresas

**Dónde:** `src/lib/export/excel-export.ts:1072-1077 (usa primary.summary) contra :1088-1095 (usa controlTotals)`  
**Verificado ejecutando:** sí

**Escenario medido:**

Balance real, 2025. Generé el .xlsx y lo leí de vuelta. La hoja 'KPIs' imprime Total Activo $4.183.794.126,28 y Total Pasivo $1.960.354.134,74, que son los valores PRE-curator: las anclas post-curator son $4.185.978.841,16 y $1.962.538.849,62. La diferencia, $2.184.714,88 en ambos, es exactamente la reclasificación R1 que el curator movió a cuentas virtuales 2810ZZ-*. En la misma hoja, la fila 'Endeudamiento' imprime 46,8836% (controlTotals, post-curator), pero quien divida las dos filas de dinero impresas obtiene 46,8557%. Lo mismo con Margen Neto: la hoja imprime 106,0584% mientras Utilidad Neta / Total Ingresos de las filas de arriba da 91,7413%. Nota metodológica: verifiqué el encabezado de la hoja ('KPI | 2024 | 2025 | Variacion | Variacion %') y DESCARTÉ una sospecha inicial de inversión de periodos — las columnas están correctamente etiquetadas.

**Corrección:**

`computeKPIs` debe tomar las cifras de dinero de `controlTotals` (post-curator), igual que ya toma los ratios, en vez de `PeriodView.summary`. Es el mismo defecto de duplicación sin sincronizar que FASE 0 documentó para `snapshot.validation`, que sigue publicando en el bloque vinculante la ecuación patrimonial pre-R8 ('Activo $4.183.794.126,28 != Pasivo $1.960.354.134,74 + Patrimonio $-42.720,00') aunque el balance cuadre post-curator.

### Lo que este auditor NO pudo medir

- Varianza del Strategy Director entre corridas. Sólo hice UNA corrida con LLM real (169s, gpt-5.6-sol, 31.712 tokens de entrada). El resultado '10/13 KPIs anclados' es n=1: no puedo afirmar que el modelo obedezca siempre, sólo que obedeció esta vez. Dado que FASE 0 midió que el NIIF Analyst variaba entre 0,10% y 99,9% de brecha en los renglones sobre el mismo balance, asumir estabilidad aquí sería justo el error que esta auditoría existe para evitar. Harían falta 3 corridas mínimo.
- Deriva del Editor Jefe HTML sobre los ratios. NO corrí el Editor Jefe con LLM real. Que los ratios del HTML no tengan validación lo INFERÍ POR LECTURA: checkColumnArithmetic (html-editor-validator.ts:644) sólo suma celdas con '$' y su propio comentario (:604-606) declara que excluye ratios y porcentajes; reconcileBindingFigures (:834) recolecta cifras vinculantes sólo del niifReport. Cuántas de las ~20 cifras de ratios del HTML se desvían en la práctica, no lo sé.
- El margen neto de la vista Áncora del workspace (derive-ancora-view.ts:157) lo leí, no lo ejecuté. Es una cuarta fórmula (utilidadNeta/ingresos, sin ajuste por reclasificaciones) que daría 91,74%, pero no monté los insumos que necesita para confirmarlo con números propios.
- No verifiqué si src/lib/pillars/single-source-validator.ts y sync-validator.ts cubren la divergencia margen-neto entre pilares y controlTotals. Existen y podrían tener algo que decir sobre H2; no los abrí ni comprobé si corren.
- La fuente normativa primaria estatuto.co/240 devolvió HTTP 403 y no pude leer el articulado directamente. Las tarifas (35% Art. 240 mod. Art. 10 Ley 2277/2022, TMT 15% par. 6, UVT 2026 $52.374 por Res. DIAN 000238 de 15-dic-2025 con base en IPC 5,17% certificado por el DANE) las confirmé por búsqueda con fuentes secundarias coincidentes (actualicese, INCP). No abrí el texto de la resolución DIAN ni el normograma en el navegador.
- Prevalencia de la doble resta de la 4175 (H1). La medí en el único balance de cliente real del repo. Ninguno de los 6 fixtures patológicos ni el fixture élite tiene cuentas 4175 con saldo, así que el corpus no la expone: corrí los 8 balances y en 7 la brecha ingresos−ingresosNetos es exactamente $0,00. Con qué frecuencia aparece en la población real de clientes, no lo sé — pero basta un balance con devoluciones para publicar un margen imposible.
- No medí el camino /api/financial-report legacy ni el SLOW PATH de /export con LLM real. Ahí SÍ corre validateConsolidatedReport, así que ese camino tendría los detectores Big Four activos — incluido el falso positivo duro de H4. Deduje el comportamiento por lectura del grafo de llamadas; no lo ejecuté extremo a extremo.
- No verifiqué si el gasto financiero que alimenta la Cobertura de Intereses (135,73 veces) es correcto: trial-balance.ts:1492-1498 usa el grupo 53 entero como aproximación cuando no hay detalle 5305xx, y no comprobé cuál de las dos ramas tomó el balance real.


---

## Cálculo del impuesto de renta y TMT (Tasa Mínima de Tributación, par. 6 Art. 240 E.T.)

**Veredicto:** `sin-garantia`

### Resumen del auditor

Medí, no leí. El resultado es categórico: en la superficie de renta NO existe una sola cifra ANCLADA. Hay cifras DETERMINISTAS (el preprocesador extrae el impuesto causado del grupo PUC 54 y la UAI en BigInt/centavos, y el Âncora deriva un impuesto referencial al 35%) y hay cifras LIBRES (todo lo que autora el LLM: la línea de impuesto del P&G, la TET, la TTD, la conciliación fiscal completa, el anticipo del Art. 807). Entre unas y otras no hay puente. Tres pruebas ejecutadas lo demuestran. PRIMERA: el orquestador SÍ calcula las anclas fiscales y SÍ se las pasa al validador (orchestrator.ts:1592-1595 mete utilidadAntesImpuestos e impuestoCausado en bindingPrimaryTotalsCents), pero el validador corre anchorCheck sobre 4 de los 6 campos que recibe (niif-json-validator.ts:170-173) y descarta justo esos dos; el reconciliador determinista tampoco los toca (5 bindings primarios, ninguno fiscal). SEGUNDA: los dos validadores que sí sabrían auditar renta —validateSurvivalReport (19 checks, incluida la reconciliación de la TET) y validateFiscalResponse (aritmética de la conciliación, tarifa, tope Art. 258)— NO tienen ni un solo importador en producción; sus orquestadores, que están cableados a /api/escudo-survival y /api/escudo/fiscal, no los llaman. Es el patrón que la auditoría previa ya había nombrado: validadores enteros sin call-site. Ejecuté validateSurvivalReport a mano contra su propio fixture: con la UAI declarada 100 veces menor y 10 veces mayor, C1.1 pasa en los tres casos, y con TTD del 0,5% o del 900% la respuesta literal fue "checks que miran la TTD/TMT: NINGUNO". TERCERA: el balance del único cliente real del repo cierra con utilidad de $2.228.496.789,73 e impuesto de renta de $0,00 (cero cuentas 54xx, medido), y atraviesa todos los gates: findings.missingTaxCausation=false porque V11 solo dispara en el caso inverso. El único detector determinista que sí se activa (alertaA5) produce una línea de prompt y −10 puntos de score, no un bloqueo, y los $779.973.876,41 de impuesto teórico nunca llegan al informe como cifra. Sobre la TMT concretamente: el gate V10 exige "que se calcule SIEMPRE", pero es un regex de presencia sobre cuatro tokens — medido, un informe que dice "No fue posible calcular la TMT" PASA, y uno que escribe la liquidación correcta "TTD = ID/UD = 0% ... IA = (UD x 15%) - ID = $334.274.518,46" BLOQUEA, porque ninguno de los cuatro patrones reconoce "TTD" ni "IA". El único cálculo determinista de la TMT que existe (ccv-calculator.ts) redondea la tasa a décimas de punto antes de aplicarla: con F09=14,94% sobre la UD real del cliente entrega $2.228.496,79 donde la norma da $1.337.098,07, y con F09=14,96% entrega $0,00 donde la norma da $891.398,72. En normativa: verifiqué contra fuente oficial y la tarifa general del 35% (Art. 240, mod. Art. 10 Ley 2277/2022) es correcta HOY — la reforma radicada el 20-jul-2026 no fue aprobada, y el Decreto 1474/2025 que llevaba al 50% a las financieras fue declarado inexequible por la Sentencia C-079 de 2026 (el comentario del código ya lo dice, y está al día). La UVT 2026 de $52.374 es correcta (Res. DIAN 000238 del 15-dic-2025). La fórmula del par. 6 está transcrita íntegra y correcta en el catálogo normativo, con lista de exclusiones y todo — pero ningún calculador la consume. Lo que sí está mal en normativa: F03 acredita ReteIVA y ReteICA contra el impuesto de renta ($5.459.423,96 indebidos sobre el cliente real), el validador de conciliación capa el descuento del Art. 254 con el tope del Art. 258 que no lo cobija ($32.500.000 de sobre-liquidación en el escenario medido, y con severidad de error rechaza el informe correcto), el catálogo de tarifas válidas [35,40,38] rechaza como error el 15% de hoteles y editoriales, el 20% de zona franca y el 45% del carbón, y la sobretasa de hidrocarburos y carbón (umbral 50.000 UVT) no existe en ninguna parte del código. Aparte, el motor determinista de provisión de renta —que sí postea asientos reales vía /api/accounting/adjustments/provisions— calcula la base ignorando las devoluciones en ventas y la clase 7, y restando el propio gasto de impuesto: medido, provisiona $185.500.000 donde corresponden $105.000.000.

### Inventario cifra por cifra

| Cifra | Estado | Productor | Validador |
|---|---|---|---|
| impuestoCausado del periodo (Σ grupo PUC 54) | **DETERMINISTA** | `src/lib/preprocessing/trial-balance.ts:1417` | NINGUNO cruza el valor emitido por el LLM. Se pasa a niif-json-validator.ts:119 y se descarta: anchorCheck solo corre sobre 4 campos (líneas 170-173). No está en los bindings de reconcile-anchors.ts:163-205. |
| utilidadAntesImpuestos (UAI) | **DETERMINISTA** | `src/lib/preprocessing/trial-balance.ts:1423` | Se calcula, se pasa (orchestrator.ts:1592) y NO se cruza. Mismo hueco que impuestoCausado. |
| Línea de impuesto de renta impresa en el Estado de Resultados | **LIBRE** | `la autora el LLM en runNiifAnalyst; el contrato niif-report.ts no la ancla a ningún token [MoneyCop]` | E14 cruza activo/pasivo/patrimonio/netIncome. E5 solo compara órdenes de magnitud con tolerancia $1.000. NADIE cruza la línea de impuesto. |
| TET (tasa efectiva) y sus insumos uai / impuestoProyectado | **LIBRE** | `src/lib/agents/financial/escudo-survival/agents/tet-calculator.ts:40 (callFinancialAgent, TetReportSchema)` | survival-validators.ts:117 C1.1 existe pero NO CORRE: validateSurvivalReport no tiene importadores en producción (solo __fixtures__/run-validation.ts). Y aunque corriera, solo verifica tet == impuestoProyectado/uai — coherencia interna del propio LLM. |
| TTD (Tasa de Tributación Depurada, par. 6 Art. 240 E.T.) del informe | **LIBRE** | `tet-calculator.prompt.ts:58 — el prompt le dice al modelo 'data.ttd aproximada (TTD ~ TET si no hay ajustes del paragrafo 6)'` | NINGUNO, medido: con ttd=0,005 y ttd=9,0 la batería completa devolvió 'checks que miran la TTD/TMT: NINGUNO'. |
| Impuesto adicional de la TMT — IA = (UD × 15%) − ID | **DETERMINISTA** | `src/lib/agents/financial/escudo-survival/fiscal-agent/tools/ccv-calculator.ts:45` | No requiere validador (es BigInt), pero la TASA se redondea a décimas de punto antes de aplicarse. |
| F02 — impuesto referencial 35% Art. 240 | **DETERMINISTA** | `DOS implementaciones no sincronizadas: src/lib/agents/financial/ancora/build-ancora.ts:178 (Number) y src/lib/agents/financial/escudo-survival/fiscal-anchor/calculator.ts:71 (BigInt)` | ninguno; son fuentes, no salidas |
| F03 — retenciones y anticipos imputables al impuesto de renta | **DETERMINISTA** | `fiscal-anchor/extractor.ts:82 y build-ancora.ts:182-184 — Σ(1355)+Σ(1805)` | ninguno |
| F04 — saldo neto a pagar de renta (F02 − F03) | **DETERMINISTA** | `fiscal-anchor/calculator.ts:73 y build-ancora.ts:187` | ninguno |
| saldoAFavorImpuesto | **DETERMINISTA** | `src/lib/preprocessing/trial-balance.ts:1443` | ninguno |
| Conciliación fiscal completa: uaiContable, rentaLiquidaGravable, tarifaPct, impuestoBruto, totalDescuentos, impuestoNeto, retencionesYAnticipos, saldoFinal | **LIBRE** | `src/lib/agents/financial/escudo-survival/fiscal-agent/schemas.ts:93-108 — los 8 campos son MoneyCop libres que autora el LLM` | conciliacion.validator.ts existe y valida las identidades L1.3/L1.4/L1.5, pero validateFiscalResponse (validators/index.ts:113) NO tiene importadores en producción. Además su tipo de entrada (validators/types.ts:67-83) no comparte ni un nombre de campo con el schema del productor. |
| Tarifa aplicada en la conciliación (tarifaPct) | **LIBRE** | `schemas.ts:100 — z.number() sin enum` | M2.L2.4 en conciliacion.validator.ts:251 acepta solo [35,40,38] y no corre en producción. |
| anticipoRenta2026Cop / anticipoRentaSiguienteCop (Art. 807 E.T.) | **LIBRE** | `src/lib/agents/financial/contracts/audit-report.ts:754 y :780 — MoneyCop nullable autorado por el fiscal-reviewer` | ninguno. grep 'reconcile\|anchors\|buildReportAnchors' en src/lib/agents/financial/audit/ devuelve vacío. |
| Provisión de renta contable (asiento Dr.5405/Cr.2404) | **DETERMINISTA** | `src/lib/accounting/adjustments/provisions/income-tax.ts:46 y la rama duplicada en provisions/calculator.ts:146-163` | ninguno. Ruta de producción: POST /api/accounting/adjustments/provisions con post:true → createEntry. |
| Renta del régimen ordinario en el comparador RST vs Ordinario | **DETERMINISTA** | `src/lib/tax/taxCalculator.ts:338-341` | ninguno |
| UVT 2026 = $52.374 | **DETERMINISTA** | `src/lib/accounting/tax-engine/constants.ts:11 y src/lib/tax/taxCalculator.ts:29` | n/a — constante |
| Tarifa general PJ = 35% | **DETERMINISTA** | `income-tax.ts:75, fiscal-anchor/calculator.ts:23, conciliacion-builder.ts:27, conciliacion.validator.ts:41, colombia-2026-context.ts, tet-calculator.prompt.ts:32` | n/a — constante |
| Sobretasas Art. 240: financiera +5pp/120.000 UVT, hidroeléctricas +3pp/30.000 UVT | **LIBRE** | `tet-calculator.prompt.ts:33 — viven solo como texto de prompt` | ninguno |
| Fórmula normativa completa del par. 6 (UD, ID, IA, exclusiones) | **DETERMINISTA** | `src/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario.ts:580` | n/a — es texto de catálogo |
| Tope 25% de descuentos (Art. 258 E.T.) | **LIBRE** | `conciliacion.validator.ts:50 y :165` | el propio validador, que no corre |

Reparto: **12** deterministas · **0** ancladas · **8** libres.

### Hallazgos

#### P0 · RENTA-01 — El gasto por impuesto de renta y la UAI son las dos únicas anclas deterministas que el validador recibe y descarta

**Dónde:** `src/lib/agents/financial/validators/niif-json-validator.ts:151-174 (y orchestrator.ts:1585-1596)`  
**Verificado ejecutando:** sí

**Escenario medido:**

Balance real del cliente (grupo-empresarial-2tres-sas.xlsx). El preprocesador emite, en BigInt de centavos: utilidadAntesImpuestos = $2.228.496.789,73, impuestoCausado = $0,00, utilidadNeta = $2.228.496.789,73. El orquestador (orchestrator.ts:1592-1595) construye bindingPrimaryTotalsCents con SEIS campos, incluidos utilidadAntesImpuestos e impuestoCausado, y se los pasa a validateNiifReportJson. El validador ejecuta anchorCheck sobre CUATRO: TotalAssets, TotalLiabilities, TotalEquity y NetIncome (líneas 170-173). Los dos fiscales no se leen nunca (grep -c de cada nombre en el archivo = 1, la sola declaración del tipo). El reconciliador tampoco: reconcile-anchors.ts:163-205 declara 5 bindings primarios (activo, pasivo, patrimonio, utilidadNeta, efectivoCuenta11) + 4 comparativos = los 9 que la medición de cierre reportó como 9/9. Consecuencia concreta: el analista puede emitir 'Utilidad antes de impuestos $3.008.470.666,14 / Impuesto de renta $(779.973.876,41) / Utilidad neta $2.228.496.789,73' y el informe sale limpio — E14 pasa porque netIncome copia su ancla, E1 pasa porque el balance cuadra consigo mismo, E4 valida el ECP y E5 solo compara órdenes de magnitud con tolerancia de $1.000. El cliente firma un estado de resultados con un impuesto de $780M que no existe en sus libros; el caso inverso (declarar $0 cuando los libros traen impuesto causado) es igual de invisible.

**Corrección:**

Añadir dos anchorCheck en niif-json-validator.ts (los datos ya llegan): anchorCheck('UtilidadAntesImpuestos', json.incomeStatement.<campo UAI>, bpt.utilidadAntesImpuestos) y anchorCheck('ImpuestoCausado', <línea de impuesto>, bpt.impuestoCausado). Requiere que el contrato niif-report.ts exponga ambos como campos de primer nivel del incomeStatement — hoy la línea de impuesto vive dentro del array de renglones y no tiene identidad. Y añadir los dos bindings correspondientes en reconcile-anchors.ts: impuestoCausado SÍ es sobrescribible (el preprocesador lo tiene exacto y no cuelga de ninguna cascada); utilidadAntesImpuestos también, porque es ingresos − (gastos − 54) por construcción.

**Normativa:** Art. 240 E.T. (tarifa general 35%, mod. Art. 10 Ley 2277/2022) y NIIF for SMEs §29.27 / NIC 12 (presentación del gasto por impuestos). Fuentes consultadas: actualicese.com/tarifa-general-del-impuesto-de-renta-2026-para-personas-juridicas/ y estatuto.co/240 vía leyes.co — 35% vigente para AG 2026; la reforma radicada el 20-jul-2026 no fue aprobada.

#### P0 · RENTA-02 — Los dos validadores que auditan renta no tienen call-site en producción: la TET, la TTD y la conciliación fiscal salen sin verificar nada

**Dónde:** `src/lib/agents/financial/escudo-survival/validators/survival-validators.ts:1132 y src/lib/agents/financial/escudo-survival/fiscal-agent/validators/index.ts:113`  
**Verificado ejecutando:** sí

**Escenario medido:**

grep de todos los importadores de validateSurvivalReport en src/ y scripts/ devuelve exactamente dos sitios: su propia definición y src/lib/agents/financial/escudo-survival/__fixtures__/run-validation.ts (script de regresión). El orquestador que sí corre en producción (escudo-survival/orchestrator.ts, cableado a POST /api/escudo-survival) no lo importa: grep 'validateSurvivalReport|validation|errors' sobre ese archivo devuelve vacío. Idéntico para validateFiscalResponse: sus únicos importadores son fiscal-agent/__tests__/integration.test.ts; fiscal-agent/orchestrator.ts (cableado a POST /api/escudo/fiscal) no lo importa. Ejecuté validateSurvivalReport a mano contra su fixture balance-pyme-elite-clean.json, cuya UAI real es $85.000.000 ($600.000.000 de ingresos − $515.000.000 de gastos): con uai=$1.070.000 (100x menor, impuesto $220.000, tet 20,56%) → C1.1 passed=true; con uai=$1.070.000.000 (10x mayor, impuesto $220.000.000, tet 20,56%) → C1.1 passed=true. El inventario completo de los 19 checks lo confirma: ninguno cruza report.tet.data.uai contra preprocessed.primary.controlTotals. Con ttd=0,005 (0,5%, muy por debajo del piso del par. 6) y con ttd=9,0 (900%), la salida literal fue 'checks que miran la TTD/TMT: NINGUNO'. Y aun así nada de esto corre: la TET y la TTD que el usuario ve en TetCard.tsx:34 y :59 no las verifica ni el validador muerto.

**Corrección:**

Cablear validateSurvivalReport en escudo-survival/orchestrator.ts y validateFiscalResponse en fiscal-agent/orchestrator.ts antes de devolver el reporte, degradando a 'REPORTE CON SALVEDADES' cuando haya errores (mismo patrón que ya se aplicó al NIIF). Y añadir en C1.1 el cruce que falta: report.tet.data.uai debe igualar extractSurvivalAnchors(preprocessed).utilidadAntesImpuestos al centavo, y report.tet.data.impuestoProyectado debe igualar uai × tarifa. Añadir un check nuevo de TTD: si ttd < 0,15 y UD > 0, exigir que el markdown declare IA = (UD × 15%) − ID; si ttd > 1,0, error. Añadir un test de arquitectura que falle cuando un validador exportado no tenga importador fuera de __tests__ — la auditoría integral ya encontró este mismo patrón y volvió a aparecer.

**Normativa:** Par. 6 Art. 240 E.T. (TTD = ID/UD, piso 15%, IA = (UD × 15%) − ID), añadido por el Art. 10 de la Ley 2277/2022, declarado exequible por la Sentencia C-219 de 2024. Fórmula verificada contra leyes.co (Art. 240) y coincide literalmente con la transcripción del propio repo en normative/catalog/estatuto-tributario.ts:580.

#### P0 · RENTA-03 — Empresa con utilidad de $2.228M e impuesto de renta cero atraviesa todos los gates: el único detector que dispara no bloquea ni imprime la cifra

**Dónde:** `src/lib/pillars/audit-report-emittable.ts:309 (V11) y src/lib/agents/financial/ancora/build-ancora.ts:244 (alertaA5)`  
**Verificado ejecutando:** sí

**Escenario medido:**

Preprocesé el balance real del cliente. Medido: cuentas 54xx = 0 (NINGUNA), impuestoCausado = $0,00, UAI = $2.228.496.789,73, utilidad neta = $2.228.496.789,73. Impuesto teórico al 35% del Art. 240 = $779.973.876,41. Y el gate: findings.missingTaxCausation = false, porque V11 solo dispara cuando el grupo 54 es > 0 Y el grupo 24 es ≈ 0 — el caso contrario, que es este (grupo 54 inexistente sobre una utilidad material), no lo mira nadie. V13 solo comprueba el signo del impuesto. En el periodo comparativo 2024 ocurre lo mismo: UAI $1.572.721.472,96, impuesto $0,00, brecha $550.452.515,54. Sí existe un detector determinista que acierta: build-ancora.ts:244 pone alertaA5='activa' cuando F02 > 0 y no hay clase 54, y lo verifiqué ejecutando (alertaA5: 'activa' sobre este balance, con F02 = 77997387641 centavos = $779.973.876,41). Pero su destino es render-ancora.ts:91, que lo convierte en la línea de prompt 'CHECK A5 (brecha impuesto contable vs teórico): activa', y derive-ancora-view.ts:195, que le resta 10 puntos a un score. No bloquea la emisión, no aparece como cifra en el informe, y no impide que el informe se firme.

**Corrección:**

Añadir un blocker nuevo al gate (V16): si utilidadAntesImpuestos > un umbral de materialidad y impuestoCausado == 0n, bloquear con el mensaje que ya redacta A5 y la cifra F02 exacta. Es el complemento de V11, no su sustituto. Y llevar F02 al informe como cifra vinculante (nota fiscal: 'impuesto de renta teórico Art. 240 sobre la utilidad contable, no liquidado en libros'), porque hoy el cliente lee 'utilidad $2.228M / impuesto $0' sin ningún contrapunto.

**Normativa:** Art. 240 E.T. (35%) + Art. 807 E.T. (anticipo del 75% del impuesto neto). La ausencia de causación no extingue la obligación: NIC 12 / NIIF for SMEs §29 exigen reconocer el impuesto corriente del periodo. Tarifa verificada contra actualicese.com y estatuto.co.

#### P1 · RENTA-04 — El gate V10 aprueba un informe que declara no haber calculado la TMT y bloquea uno que la liquida correctamente

**Dónde:** `src/lib/pillars/audit-report-emittable.ts:423-435`  
**Verificado ejecutando:** sí

**Escenario medido:**

reportIncluyeTMTCalculada es un regex de presencia sobre cuatro patrones: /\bTMT\b/i, /tasa\s+m[ií]nima/i, /par[aá]grafo\s+6\s+(del\s+)?art(\.|[ií]culo)\s+240/i, /tributaci[oó]n\s+m[ií]nima/i. Ejecutado sobre cinco textos: 'No fue posible calcular la TMT con la informacion disponible.' → PASA V10. 'Ver anexo TMT.' → PASA V10. 'Nota: la tasa minima de tributacion se analizara en la proxima revision.' → PASA V10. 'TTD = ID/UD = 0/2.228.496.789 = 0%. IA = (UD x 15%) - ID = $334.274.518,46.' → BLOQUEA, porque usa la sigla normativa TTD y no la coloquial TMT, y escribe 'Art. 240' sin el prefijo 'parágrafo 6 del'. El gate corre de verdad en producción: orchestrator.ts:1983 llama auditReportEmittable sobre report.consolidatedReport sin skipReportTextChecks, y un blocker marca emittability.kind='no-emitible' y emite un evento SSE 'warning' que, según la auditoría integral, el cliente no registra.

**Corrección:**

Sustituir la detección por presencia por una verificación de cálculo: exigir que el informe contenga la razón TTD junto a un valor porcentual Y, cuando esa TTD sea inferior al 15%, un valor monetario de impuesto adicional. Mejor aún: dejar de preguntarle al texto y anclar la TMT a una cifra — el ccv-calculator ya la sabe calcular en BigInt. Como mínimo inmediato, añadir /\bTTD\b/i y /\bIA\b\s*=/ a la lista de indicadores para no bloquear al informe correcto, y añadir /no\s+(fue\s+)?posible\s+calcular.{0,30}(TMT|TTD|tasa\s+m[ií]nima)/i como patrón que INVALIDA la presencia.

**Normativa:** Par. 6 Art. 240 E.T. La nomenclatura oficial de la norma es TTD (Tasa de Tributación Depurada) e IA (impuesto a adicionar); 'TMT' es coloquial. El gate está construido sobre el término coloquial y penaliza el normativo.

#### P1 · RENTA-05 — El cálculo determinista de la TMT redondea la tasa a décimas de punto y luego la aplica sobre miles de millones

**Dónde:** `src/lib/agents/financial/escudo-survival/fiscal-agent/tools/ccv-calculator.ts:45-60`  
**Verificado ejecutando:** sí

**Escenario medido:**

calcularImpuestoAdicionalCents hace brechaDecimas = BigInt(Math.round((15 − f09Pct) × 10)) y luego uai × brechaDecimas / 1000, es decir, cuantiza la tasa del ajuste a 0,1 puntos porcentuales. Ejecutado sobre la UD real del cliente ($2.228.496.789,73 = 222849678973 centavos): F09=14,94% → el código entrega IA = $2.228.496,79 cuando (UD × 15%) − ID = $1.337.098,07 (error +$891.398,72, +66,7%). F09=14,95% → código $2.228.496,79 vs correcto $1.114.248,39 (error +$1.114.248,40, exactamente el doble). F09=14,96% → código $0,00 vs correcto $891.398,72: la alerta no se emite en absoluto cuando la brecha es inferior a 0,05 pp. En los extremos coincide (F09=0 → $334.274.518,46, exacto; F09=15 → $0). El error es máximo justo en la franja donde la TMT importa: rozando el umbral.

**Corrección:**

Sustituir la cuantización por aritmética exacta sobre las magnitudes, no sobre la tasa: IA = (UD × 15 / 100) − ID, con UD e ID en BigInt de centavos. El ID ya existe (controlTotals.cents.impuestoCausado) y la UD ya se aproxima por UAI, así que no hace falta pasar por F09 en absoluto — F09 solo debería servir para presentar, no para liquidar. Elimina de paso la dependencia de la precisión de F09, que además difiere entre las dos implementaciones del bloque fiscal (1 decimal en fiscal-anchor/calculator.ts:62, 2 en build-ancora.ts:217).

**Normativa:** Par. 6 Art. 240 E.T.: 'IA = (UD × 15%) − ID'. La norma define el ajuste sobre magnitudes, no sobre la diferencia de tasas. Fórmula verificada contra leyes.co/…/240.htm y coincide con normative/catalog/estatuto-tributario.ts:580.

#### P1 · RENTA-06 — F03 acredita retención de IVA y retención de ICA contra el impuesto de renta

**Dónde:** `src/lib/agents/financial/escudo-survival/fiscal-anchor/extractor.ts:82 y src/lib/agents/financial/ancora/build-ancora.ts:182-184`  
**Verificado ejecutando:** sí

**Escenario medido:**

Ambas implementaciones calculan F03 = Σ(cuentas 1355) + Σ(cuentas 1805) por prefijo, sin distinguir el tributo. Desglosé las cuentas 1355 reales del cliente: 135515* (Retención en la fuente a título de renta, imputable por el Art. 373 E.T.) = $26.186.844,06; 135517* (Impuesto a las ventas retenido) = $4.857.142,54; 135518*/135510* (ReteICA y anticipo de ICA) = $602.281,42; 1805* (Servicios 6%) = $3.839.538,00. El código emite F03 = $35.485.806,02; lo normativamente imputable a renta es $30.026.382,06. Sobrestimación del anticipo: $5.459.423,96 (18,2% por encima de lo correcto). El efecto se propaga: F04 (saldo neto a pagar de renta) = $744.488.070,39 cuando debería ser $749.947.494,35, y ese mismo F03 alimenta buildConciliacionSkeleton (conciliacion-builder.ts:63,72), que se lo entrega al LLM en el prompt como 'Retenciones y anticipos (= F03)' con la instrucción explícita de NO modificarlo, y como 'Saldo final BASE'. El error viaja al borrador de conciliación fiscal del cliente.

**Corrección:**

Filtrar por subcuenta, no por grupo: F03 debe sumar únicamente 135505 (anticipo de renta), 135515 (retención en la fuente a título de renta), 135520 (sobrantes en liquidación privada de renta) y la porción de 1805 que sea retención de renta — excluyendo 135510, 135517 y 135518. Emitir las otras dos bases por separado (anticipoIvaCents, anticipoIcaCents) para que la conciliación de IVA y la de ICA tengan de dónde leerlas. Corregir en las DOS implementaciones o, mejor, colapsarlas en una sola (ver RENTA-10).

**Normativa:** Art. 373 E.T. (los valores retenidos a título de renta se imputan al impuesto de renta). Art. 484-1 E.T. (el IVA retenido se descuenta en la declaración de IVA del periodo o en los dos siguientes) — verificado en estatuto.co/484-1 y contadia.com. La retención de ICA se imputa a la declaración municipal de ICA (Ley 14 de 1983). Ninguno de los dos es imputable al impuesto de renta.

#### P1 · RENTA-07 — El motor determinista de provisión de renta calcula mal la base y esa ruta postea asientos contables reales

**Dónde:** `src/lib/accounting/adjustments/provisions/income-tax.ts:46-72 y la rama income_tax duplicada en provisions/calculator.ts:146-163`  
**Verificado ejecutando:** sí

**Escenario medido:**

Entrada de un comerciante: 413505 ventas $1.000.000.000 crédito, 417505 devoluciones en ventas $200.000.000 débito, 613505 costo de ventas $400.000.000 débito, 710505 costo de producción $100.000.000 débito, 540505 impuesto de renta causado $70.000.000 débito. Utilidad antes de impuestos correcta = (1.000 − 200) − (400 + 100) = $300.000.000 → provisión al 35% = $105.000.000. Ejecutado: computePretaxIncome devuelve $530.000.000 y computeIncomeTaxProvision entrega $185.500.000. Y la ruta de PRODUCCIÓN da lo mismo: calculateProvisions con config {provisionType:'income_tax', rate:'0.350000'} devuelve baseAmountCop = 530000000.00 y provisionAmountCop = 185500000.00, skipped=[]. Sobre-provisión de $80.500.000 (+76,7%). Tres defectos que se suman: (a) las cuentas de clase 4 con saldo neto débito se recortan a cero en vez de restarse — 'ingresos += credit >= debit ? credit - debit : ZERO' — así que las devoluciones del 4175 desaparecen (+$200M); (b) la clase 7 (costos de producción) no se lee: solo hay ramas para los prefijos 4, 5 y 6 (+$100M); (c) computePretaxIncome resta el propio grupo 54 de una base que por definición es ANTES de impuestos (−$70M). El endpoint POST /api/accounting/adjustments/provisions con post:true llama createEntry y postea el asiento; la bandera UTOPIA_ENABLE_AUTO_ADJUSTMENTS está en 'true' en .env.local. Nótese que trial-balance.ts:1423 ya resuelve bien el mismo problema (suma de vuelta el grupo 54): son tres implementaciones del mismo concepto con tres resultados distintos.

**Corrección:**

Borrar las dos implementaciones duplicadas y hacer que provisions/calculator.ts derive la base de la misma función que usa el preprocesador (utilidadAntesImpuestos = ingresos netos − gastos sin grupo 54 − costos clase 6 − costos clase 7), con signo algebraico real en lugar del recorte a cero, y sin restar el grupo 54. Añadir la rama de clase 7. Añadir un test de propiedad: la base que calcula el módulo de provisiones debe coincidir al centavo con controlTotals.cents.utilidadAntesImpuestos sobre el mismo balance.

**Normativa:** Art. 240 E.T. (tarifa 35%, correcta). NIIF 15 §47 y PUC 4175: los ingresos se presentan netos de devoluciones. PUC Decreto 2650/1993: clase 7 = costos de producción, integra el costo del periodo. NIC 12 / NIIF for SMEs §29: la base del impuesto corriente es la utilidad ANTES de impuestos.

#### P1 · RENTA-08 — El validador de conciliación somete el descuento del Art. 254 al tope del Art. 258, que no lo cobija, y rechaza el informe correcto

**Dónde:** `src/lib/agents/financial/escudo-survival/fiscal-agent/validators/conciliacion.validator.ts:85,164-166 (campo descuentos254_256_257Cents)`  
**Verificado ejecutando:** sí

**Escenario medido:**

Sociedad con renta líquida $1.000.000.000, tarifa 35% → impuesto bruto $350.000.000, y un descuento del Art. 254 E.T. de $120.000.000 por impuestos pagados en el exterior bajo un CDI, sin descuentos de los Arts. 255/256/257. Liquidación correcta: impuesto neto = 350 − 120 = $230.000.000, porque el tope del 25% del Art. 258 alcanza únicamente a los Arts. 255, 256 y 257. Ejecutado: el informe CORRECTO ($230.000.000) hace FALLAR el check M2.L1.5 con severidad 'error' y el mensaje 'Impuesto neto reportado $230.000.000,00 ≠ esperado $262.500.000,00 (… otros $120.000.000,00 tope $87.500.000,00; diff $32.500.000,00)'. El informe INCORRECTO ($262.500.000) PASA. El validador convierte una sobre-liquidación de $32.500.000 en el resultado exigido. Atenuante: hoy no corre en producción (RENTA-02) — pero es la especificación que los tests fijan, así que al cablearlo el defecto se activa.

**Corrección:**

Separar el campo en dos: descuento254Cents (Art. 254, sin tope del 258; su límite propio es el impuesto que en Colombia correspondería a esa misma renta de fuente extranjera) y descuentos255_256_257Cents (sujetos al 25% del Art. 258). L1.5 pasa a ser impuestoNeto = max(0, bruto − desc258_1 − desc254 − min(desc255_256_257, 25% del bruto)). Añadir además el límite del Art. 259 (los descuentos no pueden exceder el impuesto básico de renta).

**Normativa:** Art. 258 E.T. — 'Limitaciones a los descuentos tributarios de que tratan los artículos 255, 256 y 257': el tope conjunto del 25% del impuesto sobre la renta a cargo alcanza solo a esos tres, con carry-forward de 4 años (255 y 256) y 1 año (257). El Art. 254 (descuento por impuestos pagados en el exterior) NO está en la enumeración. Verificado en estatuto.co/258, actualicese.com/estatutotributario/258-2/ y contadia.com.

#### P2 · RENTA-09 — El catálogo de tarifas válidas rechaza como error el 15% de hoteles y editoriales, el 20% de zona franca y las sobretasas de carbón e hidrocarburos

**Dónde:** `src/lib/agents/financial/escudo-survival/fiscal-agent/validators/conciliacion.validator.ts:47 (TARIFAS_VALIDAS = [35, 40, 38]) y tools/conciliacion-builder.ts:27 (TARIFA_GENERAL_PCT = 35)`  
**Verificado ejecutando:** sí

**Escenario medido:**

Ejecuté validateConciliacion sobre cuatro contribuyentes con renta líquida $1.000.000.000 y su tarifa correcta: hotel al 15% (impuesto bruto $150.000.000) → RECHAZA con severidad error; usuario industrial de zona franca al 20% ($200.000.000) → RECHAZA; extractora de carbón al 45% por la sobretasa de +10 pp ($450.000.000) → RECHAZA; general al 35% → PASA. Además el esqueleto determinista fija 35% sin excepción: para ese hotel entrega al LLM 'Impuesto bruto BASE (UAI × tarifa) = $350.000.000' cuando la cifra normativa es $150.000.000, una sobrestimación de $200.000.000 presentada como número precomputado que el prompt le pide no modificar. La sobretasa de hidrocarburos y carbón (Art. 240 par. 3, umbral 50.000 UVT de renta gravable, +0/5/10/15 pp para petróleo CIIU 0610 según percentiles del Brent y +0/5/10 pp para carbón CIIU 0510-0520 según percentiles del API2) no aparece en ninguna constante, prompt ni validador del repo — busqué 'sobretasa' en todo src/.

**Corrección:**

Convertir TARIFAS_VALIDAS en una tabla por régimen (general 35; financiero/seguros/bolsas 40 con umbral 120.000 UVT; hidroeléctricas 38 con umbral 30.000 UVT y exención de centrales ≤ 1.000 KW; hidrocarburos 35/40/45/50 y carbón 35/40/45 con umbral 50.000 UVT; hoteles y parques temáticos de ecoturismo/agroturismo 15 por 10 años; editoriales 15; zona franca 20 y 15 para Cúcuta) y hacer que el esqueleto reciba la tarifa del régimen del contribuyente en vez de hardcodear 35. Mientras tanto, degradar M2.L2.4 de 'error' a 'warning' para tarifas fuera de catálogo: hoy bloquea liquidaciones correctas.

**Normativa:** Art. 240 E.T. (15% servicios hoteleros y parques temáticos de ecoturismo/agroturismo por 10 años; 15% empresas editoriales cuyo objeto exclusivo sea la edición de libros; par. 2 financieras +5 pp con umbral 120.000 UVT, 2023-2027; par. 3 hidrocarburos y carbón con umbral 50.000 UVT; par. 4 hidroeléctricas +3 pp con umbral 30.000 UVT, 2023-2026). Art. 240-1 E.T. (20% usuario industrial de zona franca; 15% zonas francas de Cúcuta creadas 2017-2019 con más de 80 ha y más de 40 usuarios). Verificado en estatuto.co/240-1, leyes.co (Art. 240) y actualicese.com. Confirmado además que el Decreto 1474/2025, que llevaba a las financieras al 50% para 2026, fue declarado INEXEQUIBLE por la Sentencia C-079 de 2026 — el comentario del propio validador (línea 259) lo dice y está correcto y al día.

#### P2 · RENTA-10 — Dos implementaciones no sincronizadas del bloque fiscal F01..F10: una liquida un impuesto de renta NEGATIVO sobre una pérdida

**Dónde:** `src/lib/agents/financial/ancora/build-ancora.ts:154-222 frente a src/lib/agents/financial/escudo-survival/fiscal-anchor/calculator.ts:65-94`  
**Verificado ejecutando:** sí

**Escenario medido:**

Ejecuté ambas sobre el fixture patológico perdida-y-patrimonio-negativo.csv (UAI = −$460.000.000). build-ancora.ts:178 hace 'const f02 = uai * 0.35' en aritmética de Number, sin piso: devuelve F02 = −$161.000.000,00 y F04 = F02 − F03 = −$161.000.000,00. Y renderNiifAncoraBlock lo pinta en el prompt del modelo literalmente así: 'F02 (Impuesto referencial 35% Art.240 ET) = -$161.000.000,00' y 'F04 (Saldo neto a pagar = F02 − F03) = -$161.000.000,00'. Un F04 negativo se lee como saldo a favor: el bloque le está diciendo al modelo que una empresa con pérdida de $460M tiene $161M a su favor. fiscal-anchor/calculator.ts:41-49 hace lo correcto sobre la misma entrada: pctOfCents devuelve ZERO cuando el importe es ≤ 0. Difieren además en la precisión de F09 (2 decimales vía toFixed(2) frente a 1 decimal vía ratioPct1Decimal) y en el gate hasClase54, que la primera aplica y la segunda no. Una pérdida fiscal no genera impuesto negativo ni devolución: genera compensación en los 12 periodos siguientes.

**Corrección:**

Borrar buildCcvFiscal de build-ancora.ts y hacer que consuma deriveFiscalAnchorMetrics, que ya está en BigInt y ya trata bien el caso de pérdida. Si por dependencias no se puede colapsar de inmediato, como mínimo poner el piso en F02 (uai > 0 ? uai * 0.35 : 0) y añadir un test de equivalencia que corra ambas sobre los seis fixtures patológicos y exija igualdad al centavo en F01..F10.

**Normativa:** Art. 147 E.T. — las pérdidas fiscales se compensan con las rentas líquidas ordinarias de los 12 periodos gravables siguientes; no generan impuesto negativo ni saldo a favor. Art. 188 E.T.: la renta presuntiva es 0% desde el año gravable 2021, así que tampoco hay base mínima que aplicar (no verifiqué esta última contra fuente oficial en esta sesión).

#### P2 · RENTA-11 — El check C3.5 marca como tarifa derogada cualquier porcentaje entre 20% y 30%, incluidos los que el propio prompt ordena escribir

**Dónde:** `src/lib/agents/financial/escudo-survival/validators/survival-validators.ts:773`  
**Verificado ejecutando:** sí

**Escenario medido:**

El regex es /\b(3[12349]|2[0-9]|3[0-2])\s*%/g y su hallazgo produce severidad 'error'. Ejecutado sobre ocho frases: 'Descuento del 30% por inversion en CT&I (Art. 256 E.T.)' → ERROR (30%). 'Descuento del 25% por donaciones a ESAL (Art. 257 E.T.)' → ERROR (25%). 'Limite conjunto de descuentos: 25% del impuesto a cargo (Art. 258 E.T.)' → ERROR (25%). 'Nivel de alerta: amarillo (TET entre 20% y 30%)' → ERROR (20%, 30%). 'TET = 25% sobre la utilidad antes de impuestos' → ERROR (25%). Las cuatro primeras son textos que el system prompt del propio agente le manda emitir: tet-calculator.prompt.ts:38 ('descuento 30% por inversion en CT&I'), :39 ('descuento 25% por donaciones'), :36 ('maximo 25% del impuesto a cargo') y :44 ('amarillo 20-30%'). El validador y el prompt se contradicen. Atenuante: no corre en producción (RENTA-02); al cablearlo, el check fallará casi siempre.

**Corrección:**

Anclar el regex al contexto de tarifa en vez de a cualquier porcentaje: exigir proximidad léxica a 'tarifa', 'Art. 240' o 'impuesto de renta' (por ejemplo /tarifa[^.]{0,40}\b(3[1234]|39)\s*%/i), y restringir la lista de prohibidas a las que de verdad fueron derogadas (33% y 32% del régimen anterior a la Ley 2277/2022), sin barrer el rango 20-30% donde viven los descuentos de los Arts. 255/256/257 y las bandas de alerta de la propia TET.

**Normativa:** Arts. 255, 256, 257 y 258 E.T. — descuentos del 25%, 30% y 25% respectivamente, con tope conjunto del 25% del impuesto a cargo. Todos vigentes en 2026. Verificado contra estatuto.co/258 y actualicese.com.

#### P2 · RENTA-12 — El validador de conciliación no comparte un solo nombre de campo con el schema que produce el agente: cablearlo no bastaría

**Dónde:** `src/lib/agents/financial/escudo-survival/fiscal-agent/schemas.ts:93-108 frente a validators/types.ts:67-83`  
**Verificado ejecutando:** sí

**Escenario medido:**

El productor emite conciliacionModuleSchema.data con {uaiContable, lineas, rentaLiquidaGravable, tarifaPct, impuestoBruto, totalDescuentos, impuestoNeto, retencionesYAnticipos, saldoFinal, disclaimer}. El consumidor Modulo2Conciliacion espera {uaiCents, adicionesCents, deduccionesCents, rentaLiquidaCents, impuestoBrutoCents, descuento258_1Cents, descuentos254_256_257Cents, impuestoNetoCents, tarifa, detallesAdiciones, detallesDeducciones, closingNote, rentasExentasCents}. Intersección de nombres: cero. Además el productor consolida los descuentos en un único totalDescuentos, mientras el validador necesita separados el 258-1 y el bloque 254/256/257 para poder aplicar el tope — con el schema actual la regla L1.5 es inejecutable. Y el productor no emite rentasExentasCents ni closingNote, de los que dependen L2.3 y L3.1. El mismo desfase existe en el catálogo de factores del risk score: validators/types.ts:90-94 documenta factor1_tetVsSector/factor2_rentaPresuntiva/factor3_proporcionDeducciones/factor4_consistenciaIVA/factor5_historicoSanciones y el calculador real (tools/risk-score-calculator.ts) produce tet_baja/margen_alto/costo_bajo/crecimiento_inusual/saldo_favor_sin_solicitar.

**Corrección:**

Hacer del tipo del validador el contrato único: derivar Modulo2Conciliacion con z.infer del schema, o reescribir conciliacionModuleSchema para que emita exactamente los campos que el validador consume (separando descuento258_1 de descuentos254_256_257, y añadiendo rentasExentas y closingNote). Añadir un test de tipos que falle si el schema deja de ser asignable al tipo del validador.

#### P3 · RENTA-13 — El anticipo del Art. 807 lo autora el LLM, sin validador, y con la base mal nombrada en el prompt

**Dónde:** `src/lib/agents/financial/contracts/audit-report.ts:754 y :780; src/lib/agents/financial/audit/prompts/fiscal-reviewer.prompt.ts:99`  
**Verificado ejecutando:** no

**Escenario medido:**

anticipoRentaSiguienteCop y anticipoRenta2026Cop son MoneyCop nullable que emite el fiscal-reviewer. grep de 'reconcile|anchors|buildReportAnchors' sobre todo src/lib/agents/financial/audit/ devuelve vacío: no hay reconciliador ni cruce contra el preprocesador en esa rama. El prompt instruye 'anticipoRenta2026Cop calculado segun baseAnticipo (Art. 807 E.T. — 75% del impuesto causado para el ano siguiente…)'. La norma manda 75% del impuesto NETO de renta (o del promedio de los dos últimos años, a opción del contribuyente), menos las retenciones y autorretenciones practicadas, y con rampa del 25% el primer año y 50% el segundo para quienes declaran por primera vez. 'Impuesto causado' es el gasto contable, que no coincide con el impuesto neto (difiere en descuentos tributarios y en toda la conciliación fiscal). Sobre el cliente real, además, el impuesto causado es $0, así que el prompt le pide al modelo calcular el 75% de cero mientras el impuesto teórico es $779.973.876,41 — la salida más probable es un anticipo de $0 que ninguna regla contradice.

**Corrección:**

Calcular el anticipo en código a partir del impuesto neto que ya produce la conciliación, con la rampa por antigüedad del contribuyente y la resta de retenciones, y pasarlo al prompt como cifra vinculante [MoneyCop] en lugar de pedirle al modelo que lo derive. Corregir el texto del prompt: la base es el impuesto neto de renta, no el causado.

**Normativa:** Art. 807 E.T. — 'Cálculo y aplicación del anticipo': 75% del impuesto neto de renta (o del promedio de los dos últimos años a opción del contribuyente), menos las retenciones practicadas; 25% el primer año y 50% el segundo para quienes declaran por primera vez. Verificado en estatuto.co/807, actualicese.com/estatutotributario/807-2/ y gerencie.com.

#### P3 · RENTA-14 — El comparador RST vs Ordinario liquida el régimen ordinario con la tabla de personas naturales y pinta la cifra aunque se declare no comparable

**Dónde:** `src/lib/tax/taxCalculator.ts:338-341 y src/components/workspace/pyme/MisPagosView.tsx:337`  
**Verificado ejecutando:** sí

**Escenario medido:**

computeOrdinario liquida 'renta = (utilidadUVT − 1090) × UVT × 0,19', un único tramo marginal del Art. 241 (tabla de personas naturales). Ejecutado: ventas $1.000.000.000 con margen del 35% → utilidad $350.000.000 → renta $55.653.344,60. Para una persona jurídica —que también puede optar por el SIMPLE— la cifra del Art. 240 es $122.500.000: subestima en $66.846.655,40 (55%). Incluso tratándose de una persona natural, la tabla completa del Art. 241 sobre 6.682 UVT da alrededor de $85.893.360, porque el 19% es solo el primer tramo gravado y la tabla sube hasta el 39%. compare(1.000M, 'servicios') devuelve rst=$120.000.000, ordinario=$55.653.344,60, recommended=null, comparable=false — pero MisPagosView.tsx:337 renderiza fmtM(ordinario) sin condicionar a comparable; comparable solo gobierna el texto de la recomendación (línea 343). El usuario ve una cifra de impuesto ordinario a menos de la mitad de la real. El archivo se autodeclara ilustrativo en su cabecera; lo reporto porque el número llega a la pantalla.

**Corrección:**

Bifurcar por tipo de contribuyente: persona jurídica → Art. 240 al 35% sobre la utilidad; persona natural → tabla completa del Art. 241 por tramos acumulados, no un tramo único. Y en la UI, ocultar o marcar visiblemente la cifra de 'ordinario' cuando comparable===false, con la misma disciplina con que ya se oculta la recomendación.

**Normativa:** Art. 240 E.T. (35% personas jurídicas) y Art. 241 E.T. (tabla marginal progresiva de personas naturales, 0% a 39%, con el primer tramo exento hasta 1.090 UVT). Nota: las constantes del Régimen Simple del mismo archivo (tope 100.000 UVT del Art. 905, umbral 3.500 UVT de responsabilidad de IVA del Art. 437 par. 3, tarifas del Art. 908 revividas por la Sentencia C-540/2023) están correctamente documentadas y no las cuestiono; el defecto está en el lado ordinario.

### Lo que este auditor NO pudo medir

- NO corrí el pipeline con LLM real sobre esta superficie. Lo decidí a propósito: los defectos que encontré son de código y de cableado —anclas que se calculan y se descartan, validadores sin call-site, fórmulas mal aplicadas—, y ninguno depende de la obediencia del modelo. La consecuencia honesta es que NO tengo una medición de cuánto se desvía el LLM al autorar la línea de impuesto del P&G, la TET, la TTD ni la conciliación fiscal. Tengo la prueba de que nadie la contrasta, no la magnitud de la desviación. Es la medición que falta y la haría con un harness del tipo de scripts/fase0-anchor-drift.ts, cruzando la línea de impuesto emitida contra controlTotals.cents.impuestoCausado.
- No verifiqué contra fuente oficial: la renta presuntiva al 0% desde el año gravable 2021 (Art. 188 E.T. modificado por la Ley 2010/2019) —el prompt del tax-auditor lo afirma y me consta de memoria, pero no lo confirmé—, las tarifas de ZOMAC y ZESE, ni la redacción vigente de los Arts. 255, 256 y 257 (solo verifiqué el Art. 258, que es el que los limita).
- No sé si UTOPIA_ENABLE_AUTO_ADJUSTMENTS está activo en PRODUCCIÓN. Solo leí .env.local, donde vale "true". De eso depende que el defecto de la provisión (RENTA-07) esté posteando asientos hoy o solo pueda hacerlo.
- No medí /api/tax-planning ni /api/tax-reconciliation extremo a extremo. Verifiqué por lectura que tax-planning/orchestrator.ts no importa ningún validador ni reconciliador (grep de 'validate|reconcil' sobre el archivo devuelve vacío) y que sus agentes son callFinancialAgent puros, así que sus cifras —ahorroEstimado, impuesto diferido NIC 12— entran en la categoría LIBRE por la misma vía. No construí escenarios numéricos para ellas.
- El corpus patológico no ejercita esta superficie: cuatro de sus seis fixtures (cifras-mayores-2e53, cuentas-sin-clasificar, descuadrado-en-origen y los dos de signos) preprocesan con ingresos, gastos y UAI en cero, así que sobre ellos ninguna cifra fiscal es observable. Solo perdida-y-patrimonio-negativo, signos-algebraicos y sin-comparativo dieron lectura. Un fixture con impuesto causado material, con retenciones separadas por tributo y con tarifa especial (hotel o zona franca) es lo que hace falta para blindar esta superficie con tests.
- No revisé el historial de git para saber si validateSurvivalReport y validateFiscalResponse llegaron a estar cableados y se desconectaron, o si nunca lo estuvieron. La distinción importa para saber si hay una regresión que un test habría atrapado.

