# Auditoría de cálculos contables, fiscales y derivados — 2026-08-08

Responde una pregunta concreta del dueño del producto: *"en términos de cálculos matemáticos
contables, fiscales y demás, ¿cómo quedamos? ¿ya los cálculos sí dan los números reales?"*

## Método

| Fase | Agentes | Resultado |
|---|---|---|
| Auditoría | 8 agentes Opus, effort máximo, uno por superficie de cálculo | 91 hallazgos, cada uno con escenario numérico |
| Verificación adversarial | 18 escépticos, uno por hallazgo P0, con la consigna de *refutar* | 9 CONFIRMADO · 9 PARCIAL · **0 refutados** |
| Síntesis | 1 arquitecto sobre lo confirmado | este documento |

Regla de método que se impuso a todos: **medir ejecutando, no leer**. Cada agente escribió scripts
temporales, los corrió contra los fixtures reales —incluido el único balance de cliente del repo— y
varios corrieron el pipeline completo con LLM real. Toda constante fiscal se verificó contra fuente
oficial vigente (normograma DIAN, funcionpublica.gov.co), no de memoria.

Los escépticos no sólo confirmaron: **ampliaron cuatro hallazgos** (salieron peor de lo reportado) y
**refutaron tres correcciones propuestas** que, aplicadas tal cual, habrían roto producción. Eso
último vale tanto como los hallazgos.

- Inventario cifra por cifra y los 91 hallazgos completos: [ANEXO](AUDITORIA_CALCULOS_2026-08_ANEXO.md)
- Qué hace falta para cerrar esto: [INSUMOS REQUERIDOS](INSUMOS_REQUERIDOS_2026-08.md)
- Contexto de la sesión que precede a esta auditoría: [SESION_EXACTITUD](SESION_EXACTITUD_2026-08.md)

---

## Respuesta directa

**No. Todavía no dan los números reales.**

Hay exactamente **una** cosa que sí quedó garantizada y hay que decirlo con precisión, porque el certificado de la sesión anterior es más estrecho de lo que se lee:

> `FINAL run 1/2 | anclas desviadas: 0/9 | warnings: 0 | errores: 0`

Eso es **cierto** — y sólo cubre **9 cifras** (activo, pasivo, patrimonio, utilidad neta y efectivo de cierre del primario; activo, pasivo, patrimonio y utilidad neta del comparativo) más las salvedades E1..E15. Lo verifiqué leyendo `.fase0-final2/REPORT.md` y `results.json`.

El problema es que **ese mismo artefacto certificado contiene**:

- un Estado de Flujos de Efectivo cuya sección de operación lista 8 renglones que suman **$834.754.377,59** bajo un subtotal impreso de **$2.421.190.071,93** (hueco de $1.586.435.694,34, el 65,5%), y una sección de financiación con **cero renglones** bajo ($1.570.997.737,30);
- una columna comparativa del Balance con **"n/c" en las 11 líneas de detalle** mientras el total 2024 declara $2.798.204.117,50;
- un margen neto de **106,1%** — una utilidad mayor que los ingresos, aritméticamente imposible.

Y las tres cosas salen con `reconciliation.clean = true`, sin sello de salvedades y con la descarga habilitada.

La conclusión honesta: **el sistema hoy garantiza 9 cifras y certifica como limpio todo lo demás sin haberlo mirado.**

---

## Lo que verifiqué yo mismo, ejecutando

Corrí el preprocesador sobre el único balance de cliente real (`grupo-empresarial-2tres-sas.xlsx`, 206 filas) y confirmé al centavo lo que reportaron tres auditores por separado:

| | 2025 | 2024 |
|---|---|---|
| `ingresos` (Σ clase 4) | $2.429.109.531,57 | $1.676.315.150,47 |
| `totalDevoluciones` (Σ\|4175\|) | $327.911.343,88 | $229.614.537,88 |
| `ingresosNetos` (publicado) | **$2.101.198.187,69** | **$1.446.700.612,59** |
| `margenNeto` publicado | **106,0584 %** | **108,7109 %** |
| margen neto correcto | 91,7413 % | 93,8202 % |
| `ebit` determinista | $1.916.725.454,27 | $1.350.689.517,33 |
| EBIT impreso en el P&G | $2.244.636.798,15 | — |

También verifiqué en el código:
- `trial-balance.ts:1461-1473` — el reduce toma **valor absoluto por cuenta** y luego `ingresosNetos = |totalRevenue| − totalDevoluciones`.
- `niif-json-validator.ts:170-173` — hay exactamente **4 llamadas a `anchorCheck`**. El impuesto causado y la UAI se calculan, se pasan y **no se leen**.
- `deterministic-breakdown.ts` — `CLASS_BY_SECTION` mapea **sólo** `assets:1, liabilities:2, equity:3`. El P&G y el EFE no lo toca nadie.
- `reconcile-anchors.ts:503` — `amountComparative: null` **hardcodeado**.
- `PipelineWorkspace.tsx` — el botón de **Excel** lleva `disabled={... || reportHasQualifications}`; el botón de **PDF** lleva `disabled={isExportingPdf || !report}`. **El PDF se descarga aunque el informe esté sellado CON SALVEDADES.**
- El desglose comparativo determinista **ya existe y cuadra**: `buildDeterministicBreakdown(pp.comparative, ...)` devuelve 5/4/2 renglones que suman $2.798.204.117,50 / $1.232.263.178,39 / $1.565.940.939,11 — exactamente las anclas. Nadie se lo pasa.

---

## El escrutinio adversarial: el conteo

18 hallazgos P0 pasaron por escépticos. **Ninguno resultó falso.**

| Resultado | Cantidad | Cuáles |
|---|---|---|
| **CONFIRMADO como P0** | **10** | PYG-01, PYG-02, EFE-01, EFE-03, RENTA-01, ESC-02, H1, H2*, GOV-01, COMP-1 |
| Degradado a P1 | 6 | PYG-03, EFE-02, RENTA-02, RENTA-03, H3, GOV-02 |
| Degradado a P2 | 2 | ESC-01, ESC-03 |
| REFUTADO | **0** | — |

\* H2 se mantiene P0 pero **cambia de dueño**: el escéptico demostró que la cifra desviada no es la que el auditor señalaba. Detalle abajo, porque es una trampa.

Los escépticos además **ampliaron** cuatro hallazgos (EFE-01, EFE-03, PYG-02, GOV-01 salieron peor de lo reportado) y **refutaron tres correcciones propuestas** que, aplicadas tal cual, habrían roto producción. Eso vale tanto como los hallazgos.

---

## El defecto raíz: una línea de código explica cinco P0

`src/lib/preprocessing/trial-balance.ts:1461-1473` — **doble resta de las devoluciones 4175.**

Las tres cuentas 4175 del balance real llegan **negativas dentro de la clase 4** (Σ firmada −$326.922.206,12), así que `Σ clase 4 = $2.429.109.531,57` **ya es el ingreso neto**. El código le vuelve a restar `Σ|4175| = $327.911.343,88`.

Consecuencias medidas y confirmadas por tres escépticos independientes:

1. **El informe publica un margen neto del 106,06%** — utilidad mayor que ingresos. El modelo lo imprimió obediente porque el bloque le dice *"AUTORIDAD: estos KPIs son VINCULANTES. NO los recalcules. Cita los valores LITERALMENTE"*. Y lo citó: la corrida de cierre trae un `anomalyFlag` de severidad `high` con el texto *"Margen neto reportado de 106,1% en 2025"*.
2. **Dos EBIT contradictorios en el mismo entregable**: $2.244.636.798,15 impreso en el P&G contra $1.916.725.454,27 embebido en el Margen Operativo "vinculante" y en los gauges del PDF Élite. Brecha $327.911.343,88 (14,6%).
3. **El Áncora que ven las 4 áreas del workspace** publica A07 $2.101.198.187,69, A08 $1.446.700.612,59, A09 $1.916.725.454,27, X01 $2.088.698.187,69 — todas por debajo del P&G del mismo informe. La valoración `evEbit` sale ~17,1% subestimada.
4. **En un balance sano** (sintético, libros cerrados, `emittable=true`, cero blockers): margen neto **235,00%** frente al 29,38% real.
5. **En convención natural el error contamina el ANCLA DURA**: ventas $1.000M + devoluciones $100M positivas → `utilidadNeta` $450.000.000 cuando la verdad es $250.000.000, y E14 la certifica exacta.

**Tres trampas** que hay que conocer antes de tocarlo:

- La corrección propuesta por el auditor del P&G (ramificar por convención detectada) **empeora este archivo**: daría `ingresosNetos = $3.082.953.943,81`. El discriminante correcto es el **signo de Σ4175 dentro de la clase 4**, no la convención.
- El `abs` por cuenta invierte la 41750503 (saldo crédito +$494.568,88) → **$989.137,76 de error adicional**.
- **Dos tests fosilizan el error**: `wave2-f4.test.ts:141-166` y `spec-v2-integration.test.ts:134` afirman `ingresosNetos = bruto`. Arreglarlo los pone rojos, y eso es correcto.

---

## Las nueve superficies, ordenadas por riesgo real

Criterio de la nota:
> **10** = toda cifra es determinista o está anclada por un validador que corre en producción y bloquea, medido con LLM real. **8-9** = las cifras materiales anclan y bloquean; lo libre es etiqueta o narrativa. **6-7** = los números salen bien hoy (medido), pero la garantía es conductual, no estructural. **4-5** = hay cifras materiales sin ningún contraste; ninguna medida mal. **2-3** = hay al menos una cifra materialmente MAL que llega al cliente. **1** = cifras mal llegan al cliente Y el sistema las certifica como limpias.

### 1 · Flujo de Efectivo (EFE) — **1/10**
*Riesgo: estado financiero firmado con un flujo inventado.*

El código construye un EFE determinista, lo imprime como "AUTORIDAD ... VINCULANTE", y **lo descarta**. El que ve el cliente lo autora el LLM. No hay un solo cruce entre los dos.

- **(a) MAL y entregado**: R2 fabrica *"Dividendos estimados −$1.570.997.737,30"* — el 64,9% del flujo operativo — a partir de las cuentas **virtuales** `3605VC`/`3710VC` que el propio curator R8 inyecta. En el balance no existe 2360 ni 3305. El escéptico **corrió el LLM real** y la cifra aparece verbatim en la **Nota 6 del informe entregado**, con cita normativa de respaldo, mientras la tabla de financiación sale vacía: contradicción interna, 0 errores, 0 warnings. Es 2,09× la facturación real del año. Viola NIC 7 ¶43.
- **(a) MAL y entregado**: en el artefacto certificado, los renglones no suman sus subtotales (hueco $1.586.435.694,34).
- **(b) sin comprobar**: `cashOpening`, los tres subtotales de sección, y todos los renglones salvo el primero.
- Sigue vivo en el prompt: *"revisar magnitudes/signos ... hasta que el EFE cuadre"* sobre cifras deterministas.

### 2 · Renta y fiscal — **2/10**
*Riesgo: sanción DIAN (Art. 647, 100% del mayor impuesto; Art. 670, 20% de la devolución improcedente).*

- **(a) MAL**: `F03` suma ReteIVA y ReteICA como crédito de renta → **$5.459.423,96** acreditados indebidamente (Art. 373 vs 484-1 E.T.). El motor de provisión que **postea asientos reales** provisiona **$185.500.000 donde corresponden $105.000.000** (ignora devoluciones, ignora clase 7, resta el propio grupo 54). La TMT cuantiza la tasa a décimas de punto: con F09=14,94% entrega **$2.228.496,79** donde la norma da $1.337.098,07; con 14,96% entrega **$0,00** donde da $891.398,72. El validador de conciliación aplica el tope del Art. 258 al Art. 254 → **rechaza el informe correcto** ($230.000.000) y exige el incorrecto ($262.500.000).
- **(b) sin comprobar**: **la línea de impuesto del P&G**. Las anclas `impuestoCausado` y `utilidadAntesImpuestos` se calculan en centavos exactos, se pasan al validador, y `anchorCheck` sólo se invoca 4 veces. Medido: impuesto inventado de **$700.000.000** → 0 errores; de **−$700.000.000** (impuesto como ingreso) → 0 errores. Sobre `patologicos/signos-algebraicos.csv`, que el gate deja pasar (`emittable=true`, cero blockers), **borrar un impuesto real de $63.000.000 pasa limpio y descargable**.
- **(c) bien pero sin garantía**: la tarifa del 35% (Art. 240 E.T., mod. Art. 10 Ley 2277/2022) es **correcta hoy** — verificada contra normograma DIAN; la reforma se hundió el 09-dic-2025 y la radicada el 20-jul-2026 no es ley; el Decreto 1474/2025 fue declarado inexequible (C-079/2026). La UVT 2026 = **$52.374** (Res. DIAN 000238 del 15-dic-2025) es correcta. La TMT del 15% sigue vigente (C-219/2024, Concepto DIAN 4228/2026).
- Atenuante medido: los paneles que muestran TET/TTD autoradas por el LLM están **huérfanos** desde `cd6e202d` — hoy ningún cliente las ve. Los endpoints siguen desplegados y `requireAuthSession()` es no-op.

### 3 · Acta de gobierno corporativo — **2/10**
*Riesgo: documento que se firma, se inscribe en Cámara de Comercio y reparte dinero.*

- **(b) sin comprobar, y es TODA la aritmética**: reserva legal, capitalización y cada renglón de destinación los autora el LLM. Medido: reserva del 10% calculada sobre el **patrimonio** en vez de la utilidad ($222.343.999,15 vs $222.849.678,97) y capitalización deslizada de 40% a 4% (**$89.139.871,58 vs $891.398.715,89 — error de $802.258.844,31**) → `validateConsolidatedReport` ok:true, `auditReportEmittable` emittable:true, cero blockers, **descarga habilitada** (el acta no puede mover `reconciliation.clean`).
- El único cruce que existe, `applyCheck4ActaVsPL`, **ni siquiera está exportado del módulo**: su call-site vive en `orchestrateFinancialReport`, marcado `@deprecated`, que el navegador no usa.
- **(a) MAL en el texto que se firma**: el acta afirma que la capitalización de **$891.398.715,89** queda exenta por el **Art. 36-3 E.T.** — ese beneficio aplica sólo a sociedades que cotizan en bolsa; la del fixture es una SAS cerrada. El reparto por defecto deja **$891.398.715,89** de dividendo cuando el mínimo del **Art. 155 C.Co.** es **$1.114.227.034,86** (déficit $222.828.318,97), lo que exige el voto del 78% — que el mismo prompt **prohíbe declarar**. Y cita **Art. 40** de la Ley 1258/2008 (arbitraje societario) donde corresponde el 45; **Art. 5** (contenido del documento de constitución) donde corresponde el 29; y "Art. 187 **Ley 222/1995**" cuatro veces, cuando el 187 es del Código de Comercio.
- El interruptor que decide todo el régimen, `estatutosRequierenReservaLegal`, **no tiene ningún productor en el repositorio**: siempre `undefined`.

### 4 · Columna comparativa del Balance — **2/10**
*Riesgo: incumplimiento directo de NIIF para las PYMES §3.14.*

**Es una regresión introducida por el fix del 2026-08-08.** `completeBreakdownFromSnapshot` reemplaza la sección entera con `amountComparative: null`. En **2/2** corridas de cierre el PDF sale con `n/c` en todas las líneas de detalle bajo un TOTAL ACTIVOS 2024 de $2.798.204.117,50 que ningún renglón sostiene. `clean=true`, sin sello, descargable.

**Arreglo trivial y ya verificado por mí**: la proyección comparativa determinista existe y cuadra al centavo. Sólo falta pasarle el snapshot comparativo.

### 5 · Estado de Resultados (P&G) — **3/10**

- **(b) sin comprobar**: Utilidad Bruta y EBIT, **en los dos periodos**. Medido: `+$500.000.000` en `grossProfitPrimary` → 0 errores, 0 warnings, `clean=true`, descarga habilitada — y la cifra falsa se promueve a **binding figure** del HTML, donde `reconcileBindingFigures` **exige** que se reproduzca literalmente. El sistema certifica fidelidad a un número que nadie verificó. El cruce para el comparativo existe (E9) pero `buildComparativeAnchorsForValidator` nunca puebla esas claves: **código muerto**.
- **(b)**: los renglones del P&G no tienen invariante. `lines = []` → 0 errores; ingresos ×3 → 0 errores.
- **(c) bien pero sin garantía**: en 7/7 corridas reales la cascada y los renglones salieron **exactos al centavo**. El modelo hace bien la aritmética; el sistema no lo comprueba. Por eso PYG-03 bajó a P1: control ausente, cero fallos observados.
- **E8 está vivo y sin llamador**: pasando `totalExpensesClass5Cents` detecta una duplicación de $16.122.033,37 del Grupo 53; el call-site de producción no lo pasa.

### 6 · El Escudo / Score de Riesgo DIAN — **3/10**

- **(a) MAL y mostrado**: `factorTet` otorga **30 de 100 puntos** por *"tasa efectiva nula sobre utilidad"* cuando F09=0 — sin distinguir tres casos distintos. Sobre el fixture propio del repo `perdida-y-patrimonio-negativo.csv` (UAI **−$460.000.000**, pasa el gate) publica 30/100 "medio" con esa frase, para una empresa que no tiene utilidad. Sobre un balance sin P&G, lo mismo. Dos empresas idénticas salvo la provisión: **33/100 "medio" → 3/100 "bajo"**. Sobre el cliente real: **70/100 "muy_alto"**, de los cuales 30 son eso — y `score > 60` enciende Modo Supervivencia.
- El sistema **ya sabe** distinguir el caso: `alerts.ts` emite `A5_SIN_PROVISION` con severidad `error` exactamente en esa condición. Esa información no llega al factor.
- **Descargado por los escépticos**: la divergencia F05 8,72× (ESC-01) es real pero **nadie lee ese campo** → P2. Y los validadores muertos (ESC-03) no producen daño hoy porque los paneles están huérfanos → P2, pero con la advertencia de que suben a P0 el día que alguien los remonte.

### 7 · Ratios, KPIs y proyecciones — **3/10**
*Riesgo: presentacional, no sancionatorio — pero es lo que el dueño mira primero.*

- **(a) MAL**: el mismo PDF imprime **106,1%** (pág. 4) y **91,7%** (pág. 10) de margen neto — 14,41 puntos de dispersión. Tres valores de "Días de Autonomía" (5713 / 4392 / 4932). Dos EBITDA ($2.242.618.823,10 vs $2.244.636.798,15) junto a un margen operativo que corresponde a un tercero.
- **Trampa importante**: la corrección que proponía el auditor (hacer que `valor.ts` consuma `controlTotals.margenNeto`) es **activamente dañina** — reemplazaría el 91,7% correcto por el 106,1% erróneo y dejaría el PDF uniformemente equivocado. El escéptico lo demostró: el 99,38% de la divergencia viene del denominador con doble resta, no del ajuste de `valor.ts`.
- **(b) sin comprobar**: la proyección Big Four entera. Los tres validadores existen y **ninguno corre**. Y uno de ellos, `detectInflatedCash`, está **roto**: lee `"4.2"` del encabezado `### 4.2 Saldo Inicial Depurado` y emite hard-fail idéntico en el informe correcto y en el inflado. Conectarlo tal cual **tumbaría el 100% de los informes** (clasifica tier C → el camino legacy lanza excepción hoy).

### 8 · Estado de Cambios en el Patrimonio (ECP) — **4/10**
*El mejor de los ocho auditados. Único con veredicto "parcialmente garantizado".*

- De ~40 celdas, **una** está anclada de verdad (`closing_balance.total` contra el patrimonio, tolerancia $0, E4 corre en producción).
- **(b)**: nadie comprueba que el `total` de una fila sea la suma de sus 7 columnas. Medido: +$1.000.000.000 en capital social sin tocar el TOTAL → 0 errores; la tabla entregada imprime una fila cuyas celdas suman $3.223.439.991,54 bajo un total de $2.223.439.991,54.
- **Ningún veredicto del ECP sella ni bloquea.** Una brecha de $0,01 en el desglose del Balance bloquea el Excel; la misma brecha en el ECP no.
- **(c)**: en **8/8** corridas reales el ECP salió correcto en ambos ejes. El modelo incluso acertó **ignorando el prompt**, que le ordena usar una fuente (`equityBreakdown`) que diverge $5.014.078,19 del ancla.
- El Excel entregable **no contiene el ECP ni el EFE**: el cliente recibe 2 de los 4 estados financieros.

### 9 · Balance del periodo primario *(referencia, no auditado esta ola)* — **8/10**
Es la única superficie con garantía demostrada: 5 anclas + E15 + desglose determinista + sello + bloqueo, medido 2/2 con LLM real. **El techo de lo que el sistema puede hacer hoy — y demuestra que la arquitectura correcta ya existe y funciona.**

---

## Nota global: **3 / 10**

Justificación explícita: de nueve superficies, **una** tiene garantía estructural demostrada. De las ocho auditadas, **siete** salieron `sin-garantía` y una `parcialmente-garantizada`. Hay al menos **seis cifras materialmente incorrectas que llegan hoy al cliente** (margen neto 106%, EBIT duplicado, dividendos fabricados de $1.571M, columna comparativa en `n/c`, score de riesgo con 30 puntos falsos, ingreso del Áncora 13,5% bajo), y todas salen **certificadas como limpias**.

No es un 1 porque el trabajo estructural que se hizo es correcto y reutilizable: la convención de signos, las anclas en BigInt, el reconciliador, el desglose determinista y el sello/bloqueo **funcionan**. El problema no es que la arquitectura esté mal — es que **sólo está aplicada al Balance primario**, y el resto del informe se apoya en que el modelo se porte bien.

---

## Lo que NADIE pudo medir (es información, no un hueco a tapar)

1. **El HTML del Editor Jefe** — la superficie que más lee el cliente. **Ningún auditor la corrió con LLM.** Lo que sí se sabe por lectura: `reconcileBindingFigures` garantiza **fidelidad** al JSON del NIIF, no corrección; `checkColumnArithmetic` excluye explícitamente ratios y porcentajes; y del ECP sólo una de ~40 celdas es vinculante — las otras 39 las reteclea el modelo sin reconciliación.
2. **La frecuencia de deriva del modelo fuera de las 9 anclas.** Nunca se ha medido en el EFE, el ECP, el acta, la TET, la conciliación fiscal ni la proyección. Todo lo que se afirma sobre esas superficies es *"el sistema acepta esto sin decir nada"*, no *"el modelo lo hace mal con frecuencia X"*.
3. **Sólo existe UN balance de cliente real en el repo.** Todo lo medido con LLM es sobre ese archivo, que además es el único con cuentas 4175, es una comercializadora con `costoVentas6 = 0` (casi no ejercita la Utilidad Bruta) y tiene los libros sin cerrar. Un cliente con P&L complejo, con COGS real, o con Clase 54 material, es **territorio sin medir**.
4. **Parte IV (4 dictámenes especializados) y Parte V (meta-auditoría 12 dims + sello de calidad)**: nadie los auditó. Se sabe que el auditor legal **recalcula el 10% de reserva por su cuenta** sin cruzarlo contra el acta, y que el check D7 de la meta-auditoría es un LLM juzgando a otro LLM.
5. **`tax-planning` y `tax-reconciliation`** extremo a extremo: sin validador ni reconciliador, sus cifras son LIBRES por la misma vía, pero nadie construyó escenarios numéricos.
6. **Round-trip de caché de `preprocessed-balance.ts`**: si el snapshot cacheado pierde `controlTotals.cents` (BigInt no sobrevive JSON), las anclas caen a `number` y podrían generar salvedades falsas de 1 centavo contra una tolerancia de $0.
7. **Cuántos workspaces en producción están hoy en el estado que dispara el Áncora divergente.** No se consultó la base.
8. **Normativa no verificada esta ronda**: porcentajes del Art. 651 E.T., sobretasas del Art. 240 por CIIU (hidrocarburos y carbón, umbral 50.000 UVT — **no existen en ninguna parte del código**), tarifas de ReteIVA y de dividendos del Art. 242, y las seis fechas del calendario de ICA Bogotá.

---

## Lo que hay que arreglar, en orden

**1. La doble resta de la 4175** — `trial-balance.ts:1461-1473`
Un solo defecto aritmético que produce el margen neto imposible, los dos EBIT contradictorios, el Áncora 13,5% bajo, la valoración 17,1% subestimada y, en convención natural, un error de 2× devoluciones sobre el ancla dura. Discriminante correcto: **el signo de Σ4175 dentro de la clase 4**, nunca la convención detectada, nunca `abs` por cuenta. Añadir dos fixtures con 4175 (uno natural, uno algebraico) y corregir los dos tests que fosilizan el error. **Nada más debe tocarse antes que esto**, porque anclar `grossProfit`/`ebit` hoy cementaría la cifra equivocada.

**2. La columna comparativa del Balance** — `reconcile-anchors.ts:503`
Pasar el snapshot comparativo a `completeBreakdownFromSnapshot`. La proyección ya existe y cuadra: $2.798.204.117,50 / $1.232.263.178,39 / $1.565.940.939,11. Es el arreglo con mejor relación esfuerzo/impacto de toda la lista.

**3. El EFE**
(a) Excluir del `deltaUtilAcum` las cuentas con sufijo `VC` **y** condicionar `dividendosEstimados` a evidencia real (2360/2365/3305) — excluir las virtuales por sí solo empeora el número a −$2.228.496.789,73. (b) Invariante `Σ(lines) == netFlow` por sección, elevado al canal que sella. (c) Extender `deterministic-breakdown` al EFE. (d) Borrar del prompt la instrucción de mover capital de trabajo "hasta que cuadre".

**4. Las dos anclas fiscales que se calculan y se tiran** — `niif-json-validator.ts:170-173`
Añadir `anchorCheck('UtilidadAntesImpuestos', ...)` y el cruce de la línea de impuesto contra `bpt.impuestoCausado`, y elevar UAI e impuesto a campos de primera clase del `IncomeStatementSchema`. Resolver de paso la bifurcación de **$779.973.876,41** del prompt (línea 203 dice "$0"; línea 913 dice "UAI × 35%").

**5. El acta societaria**
Calcular reserva legal, capitalización y cada renglón en centavos BigInt (`pctFloorMoneyCop` ya existe y ningún consumidor del acta lo usa), entregarlos como tokens `[MoneyCop: N]` y extender el reconciliador. Añadir el techo del Art. 452. Corregir las cinco citas normativas erróneas. Capturar `estatutosRequierenReservaLegal` en el intake como tri-estado.

**6. `factorTet` del Score DIAN**
Tres ramas, no una: UAI ≤ 0 → no aplicable; sin grupo 54 en el balance → aviso separado, cero puntos de riesgo; sólo con 54 poblado aplicar la escala. Y no publicar score cuando F01 = $0.

**7. Utilidad Bruta y EBIT como anclas** *(después del punto 1)*
Cuatro cifras libres, no dos. Añadirlas a `AnchorKey`, cruzarlas en E14 con tolerancia $0 y poblarlas en `buildComparativeAnchorsForValidator`, que hoy deja muerto un cruce que ya está escrito.

**8. Cablear lo que existe y no corre** — pero **arreglando primero lo roto**
`totalExpensesClass5Cents` (E8), `cashAccountPuc11Cents` (E3), `validateSurvivalReport`, `validateFiscalResponse`. **No conectar `detectInflatedCash` sin arreglarlo antes**: hoy lee "4.2" de un encabezado y tumbaría el 100% de los informes. **No conectar V9 sin el look-behind de negación**: bloquearía toda SAS conforme. Y añadir el test de arquitectura que falle cuando un validador exportado no tenga importador fuera de `__tests__` — el patrón ya se repitió cuatro veces.

**9. El botón de PDF** — `PipelineWorkspace.tsx:1430`
Falta `reportHasQualifications`. Hoy un informe sellado CON SALVEDADES se descarga igual en PDF. Es una línea.

**10. Sincronizar lo duplicado**
`buildCcvFiscal` vs `buildFiscalAnchor`, `escudo.ts` vs `escudo-cards.ts`, `valor.ts` vs `controlTotals`, las tres implementaciones de la base del impuesto, las dos del 10% de reserva. Es el patrón que la auditoría integral ya había nombrado como causa raíz y que sigue produciendo P0s.

---

**El resumen de una línea:** los números del **Balance primario** sí dan. Los del **EFE, la columna comparativa, el impuesto de renta, el acta y los márgenes** no dan — y lo más peligroso no es que estén mal, es que el sistema los firma como correctos.