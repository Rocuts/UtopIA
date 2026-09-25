# Auditoría integral multiagente — exactitud de cifras y alineación normativa (2026-09-24)

Base auditada: `main` @ `dea0329` (PR #14 fusionada). Rama de correcciones: `claude/auditoria-proyecto-niif-sdr3ia`.
Fase 1: verificación final sobre `776ca97` (base de la fase 2: `e631415`). Fase 2 (cierre de pendientes y
re-auditoría final, también del 2026-09-24): código final verificado en `4bbbd377` (contrato del API v1 `tb-2026-09-24.4` sobre `54802609`); después sólo documentación.
Foco pedido: el módulo NIIF (balance de prueba → estados → informe → exportaciones), además de métricas, cálculos
tributarios, laborales, valoración, reportes y la normativa colombiana aplicable.

> **Respuesta corta.** En `dea0329` las cifras **no** eran correctas en varias rutas que llegan al cliente, empezando
> por la principal: el informe NIIF lanzado desde la interfaz corría **sin el motor determinista** (sin totales
> vinculantes, sin anclas y sin el gate 422). La fase 1 corrigió los defectos confirmados, con pruebas de regresión
> que fallan contra el código anterior. La fase 2 cerró la procedencia servidor de los informes (versión persistida
> por workspace, con huellas y sello), los comparativos del EFE y del ECP, el cruce de la prosa del modelo con las
> anclas y la confirmación de unidad, vencimientos y fecha de corte en la ingesta. Una re-auditoría final con seis
> auditores nuevos reprodujo 55 hallazgos; la ronda final corrigió 54 y dejó uno como residual documentado. El
> resultado es un pipeline NIIF cuyas cifras se derivan y verifican en código al centavo, y que **bloquea o marca
> N/D** cuando no puede sostener una cifra. No es una certificación de cumplimiento integral: ver *Límites* y
> *Pendientes*.

## Método

| Fase | Qué se hizo | Resultado |
|---|---|---|
| 1. Auditoría por dimensión | 13 agentes independientes: preprocesador NIIF, contrato/validadores NIIF, flujo del pipeline, razones y KPI, calculadoras tributarias, módulos tributarios, valoración, reportes/exportaciones, ingesta ERP/archivos, contabilidad y nómina, normativa en prompts, auditoría/calidad, y un **recálculo independiente** (script propio sobre los fixtures crudos, sin reutilizar funciones del repo). Cada hallazgo con archivo:línea, reproducción y fuente normativa. | 332 hallazgos (24 críticos, 89 altos) y 210 comprobaciones que resultaron correctas |
| 2. Verificación adversarial | 12 verificadores distintos de los auditores intentaron **refutar** cada hallazgo crítico/alto/medio: alcanzabilidad real, mitigaciones en otra capa, re-derivación de cifras, duplicados | 228 confirmados, 42 duplicados, 1 refutado; severidades ajustadas por alcance real |
| 3. Corrección | 13 paquetes con propiedad exclusiva de archivos, en worktrees aislados; prueba de regresión en rojo → cambio mínimo → verde | ver tabla siguiente y el [anexo](auditoria-integral-niif-2026-09-24-anexo.md) |
| 4. Integración | Fusión, resolución de conflictos y de regresiones entre paquetes (3 defectos reales de integración corregidos: Bridge de Cuadratura, `equation_delta` del API v1, Doctor de Datos sin re-ejecutar R8) y dos olas más para 109 + 40 dependencias cruzadas | ver *Verificación ejecutada* |
| 5. Re-auditoría | 3 agentes nuevos (recálculo independiente, extremo a extremo adversarial, normativa y métricas) sobre el código corregido; sus 40 hallazgos residuales se corrigieron en una cuarta ola y un cierre | ver *Re-auditoría independiente de la fase 1* |
| 6. Fase 2 | 6 paquetes (P1–P6) para los pendientes de la fase 1 y 5 integraciones (I1–I5) para sus dependencias cruzadas, cada uno con implementador y revisor adversarial distintos; re-auditoría final con 6 auditores nuevos sobre la rama con toda la fase 2; ronda final de 6 paquetes con revisión | ver *Fase 2* |

## Hallazgos críticos confirmados y su corrección

| Área | Defecto en `dea0329` | Corrección |
|---|---|---|
| Entrada NIIF (UI) | `/api/upload` anteponía el informe de validación al texto; la UI lo enviaba como `rawData` sin `preprocessed`; `/niif` parseaba 0 filas y el informe salía sin totales vinculantes ni gate 422 | `rawData` limpio separado de `extractedText`; el servidor re-deriva el preprocesado con un helper compartido y descarta el prefijo; texto tabular ilegible → 422; balance descuadrado → 422 igual por UI que por envío directo |
| XLSX | Celdas unidas con `join(',')` sin comillas: "Retención 2,5%" corría columnas; en el balance real del repo el activo 2025 salía en $4.185.978.841,16 en vez de $4.196.558.242,90 y R8 tapaba la diferencia | Escape RFC 4180; enteros tal cual y decimales a centavos; con la conversión correcta el balance cuadra al centavo sin ajuste |
| XLSX multiperiodo | `forcePeriod` por hoja colapsaba columnas de varios años (2024 etiquetado 2025) | El año del encabezado manda; meses distintos → `YYYY-MM`; conflictos explícitos |
| Columnas de saldo | "Saldo Inicial … Saldo Final": el inicial se publicaba como cifra del periodo (upload) o se descartaba el final (API v1) | Clasificación apertura/cierre; el periodo es siempre el saldo final |
| API v1 | `status: balanced` y `equation_delta: 0` calculados después del tapón de R8, aun con $150M de descuadre | Cuadratura del archivo de origen; contrato `tb-2026-09-24` con montos de reclasificación expuestos |
| Âncora | Sin preprocesado emitía cifras "0" sentinela que el dashboard mostraba como $0 y Score NIIF 80/100 | Âncora `null` sin preprocesado; vistas defensivas para Âncoras persistidos |
| Acta de asamblea | Una pérdida neta se imprimía como "Utilidad Neta del Ejercicio" positiva y llegaba al PDF | Signo preservado ("Pérdida neta del ejercicio: ($X)") en acta y dictámenes |
| PDF Élite | Totales en valor absoluto: pérdida, EBIT negativo y patrimonio negativo salían positivos | Signo y rótulos PÉRDIDA consistentes con Excel/HTML |
| Dashboard / áreas | Valor, Verdad, Futuro y Escudo mostraban cifras literales del mockup sobre datos reales; "Valor de salida · DCF" no era DCF; DuPont inventado; "Tasa efectiva" mostraba la cobertura de retenciones | Datos reales o N/D con motivo; maquetas con rótulo "Módulo en preparación"; valor de salida sin rótulo DCF y N/D sin deuda neta |
| Periodos mensuales | La clave de periodo era el año: el mes anterior sobrescribía al actual y el balance usaba sólo movimientos del mes | Clave `YYYY-MM` y saldos acumulados |
| EBITDA | Cuatro fórmulas distintas; la tarjeta/PDF omitía 5405 y 5260 | Una sola función determinista (utilidad operacional + D&A PUC) |
| Libro mayor | Un reverso dejaba efecto neto −original | Original y reverso netean a cero en todas las lecturas |
| Escudo (F03) | "Retenciones de renta" sumaba 135510 (ICA), 135530, 1805 (bienes de arte) → saldos a favor ficticios con acción de devolución | Lista blanca de crédito de renta por código y nombre; F04 rotulado como estimación contable sin acción de devolución |
| Conectores ERP | Aislamiento insuficiente de sesiones entre empresas | Sesión por conexión y credencial en todos los conectores, con pruebas de dos empresas en paralelo |

Los hallazgos altos y medios (51 y 139 confirmados) están en el [anexo](auditoria-integral-niif-2026-09-24-anexo.md) con su estado.
De los 269 hallazgos confirmados en la fase 1 (incluidos los de su re-auditoría), tras la fase 2 hay 264 corregidos y
5 corregidos en parte, ninguno crítico; el anexo añade los 55 hallazgos de la re-auditoría final. Los más relevantes
para el módulo NIIF: grupo PUC 42 dentro de la utilidad bruta y el EBIT; EFE del LLM sin cruce con el EFE determinista;
EFE determinista que trataba apropiaciones y capitalizaciones como flujos y dividendos pagados como partidas no
monetarias; tolerancias no exactas del ECP; R8 absorbiendo cualquier residual; `parseNumber` que leía `1234.567` como
miles; ROE +451 % con patrimonio negativo; Estrategia sin validación determinista; exportación mezclando fuentes;
auditoría y sello de calidad no condicionados a la integridad aritmética.

## Decisiones normativas y de presentación aplicadas

Las especificaciones prevalecen salvo error demostrado; los cambios de criterio quedan como enmiendas fechadas en
`docs/spec/financial-pipeline-v2.1.md` (enmiendas 1–11 de la fase 1, 12–14 de la fase 2).

- **Grupo PUC 42/53 debajo de la utilidad operacional** (Decreto 2650/1993: ingresos y gastos no operacionales).
  Utilidad bruta = (41 − 4175) − (6 + 7); EBIT = UB − 51 − 52; UAI = EBIT + 42 − 53. Sustituye la lectura de la spec v2.
- **Impuesto de renta sin grupo 54** (antigua corrección 4): no se reconoce con la cuenta 1805 ni con 35 % × UAI;
  queda sin reconocer con nota (NIC 12 / Sección 29). En el PUC oficial la 1805 es "Bienes de arte y cultura".
- **TTD** (Art. 240 par. 6 E.T.) = ID/UD; sin bases verificadas → N/D en todas las superficies (auditoría, Escudo,
  planeación). UAI y utilidad contable no son bases fiscales. Con el Régimen Simple declarado en el intake la TTD no
  aplica (Art. 903 E.T.) y el gate no exige V10; sin dato del régimen se sigue exigiendo.
- **Derogatorias**: Art. 36-3 E.T. (Ley 2277/2022 art. 96); Arts. 457 num. 2, 458 y 459 C.Co. (Ley 2069/2020 art. 4,
  sustituidos por la regla de negocio en marcha). Reserva legal obligatoria en S.A. y Ltda.; en SAS sólo por estatutos.
- **SAGRILAFT**: umbral de 40.000 SMMLV (CE 100-000016/2020) mientras no se confirme el texto de la CE de 2026.
- **ZOMAC**: tarifas por año gravable y tamaño (Ley 1819/2016 Art. 237). **Retención en la fuente**: bases 2 UVT
  servicios / 10 UVT compras desde el 1-jul-2026 (Decreto 0572/2025 tras la revocatoria de su suspensión).
- **Tarifa general de renta**: 35 % desde el año gravable 2022 (Ley 2155/2021 art. 7), mantenida por la Ley 2277/2022
  art. 10; el corpus RAG y los prompts que decían "desde 2023" se corrigieron.
- **Intereses moratorios** (Art. 635 E.T.): usura certificada del mes de liquidación − 2 puntos, con su fuente; sin
  tasa registrada para el mes, N/D (nunca la de otro mes).
- **Cierre contable**: el traslado a 3605/3610 es del cierre anual (periodo 13), no de cada mes.
- **Comparativos del EFE y del ECP** (NIIF para las PYMES 3.14, enmienda 12): con el corte anterior al comparativo los
  calcula el código; sin él, una nota del código dice qué corte falta y lo pide (no se declara impracticabilidad).
- **ORI del periodo = Δ grupo 38** (Secciones 5 y 6, 6.3(c); enmienda 12), igual en el ERI, el ECP y E6/E6b.
- **Corriente / no corriente** (enmienda 14): por grupo PUC como supuesto revelado, con excepciones de vencimiento que
  el usuario declara por cuenta; la virtual de R1 es pasivo del grupo 28 en el plazo de su cuenta de origen.
- **Un código PUC por renglón** en el ESF y el ERI (E21, enmienda 14) y **revaluación fuera de operación** en el EFE
  (NIC 7 ¶43, enmienda 14).
- **Parte V — Transparencia** = 0,9 × D9 + 0,1 × D6 (enmienda 13).
- **Presentación**: devoluciones 4175 en línea separada como criterio de UtopIA, sin cita a NIIF 15 §47; cifras
  abreviadas en millones ("$2.429 M"), nunca "B" ni "billones" para miles de millones (spec v10.1 corregida).

## Lo que la auditoría verificó como correcto

Entre las 210 comprobaciones superadas en la fase 1: ecuación patrimonial, cascada del ERI e identidades del EFE/ECP
exactas al centavo en el validador; recálculo independiente de 425 cifras de los fixtures (401 coincidían al centavo y
las 24 diferencias tenían causa identificada, hoy corregida); permutar filas no cambia ningún total; UVT 2025/2026,
SMMLV y auxilio de transporte 2026, prestaciones y aportes, Ley 2466/2025 (recargos y jornada), dígito de verificación
del NIT, sanciones Arts. 639-648 en la función de cálculo, intereses Art. 635, festivos 2026, Benford y chi², Monte
Carlo reproducible con semilla, Excel con los cuatro estados coherentes con el JSON. Las comprobaciones de la
re-auditoría final están en *Fase 2*.

## Límites de esta auditoría

- **Normativa**: el entorno bloquea la lectura directa de normograma DIAN, Secretaría del Senado y Función Pública.
  La fase 1 usó búsquedas web (cupo de 200 agotado) y los textos del repositorio (`src/data/tax_docs`); la fase 2 sólo
  el corpus del repositorio. Las normas sin fuente primaria quedan en *Pendientes* y el código no fija sus cifras.
- **LLM**: las salidas de los modelos se simularon en las dos fases; no se midió con corridas reales cuánto aprovecha
  el modelo los huecos restantes ni la tasa de sellos de los validadores de prosa, E21 y E27 sobre salidas reales. Los
  validadores de prosa son heurísticos y se probaron con un corpus sintético (89 frases honestas y 58 falsas).
- **ERP y base de datos**: sin credenciales reales. Las pruebas de libro mayor y de la versión persistida usaron un
  Postgres 16 local efímero con las migraciones del repo; la re-auditoría final probó el aislamiento con la resolución
  real del workspace por cookie, pero con el almacén de cookies simulado (no una sesión BetterAuth real). Los contratos
  reales de las APIs ERP no se verificaron.
- **Visual**: no hubo revisión visual humana del PDF/Excel generados; se verificaron sus datos y, en la fase 2, la
  paginación y el índice del PDF sobre el texto renderizado.
- Coherencia aritmética no acredita procedencia ni cumplimiento fiscal de cada contribuyente.

## Re-auditoría independiente de la fase 1

Tres agentes distintos de los que corrigieron intentaron, en modo adversarial, que una cifra incorrecta llegara al cliente:

- **Recálculo independiente por la ruta real** (`/api/upload` → UI → `/niif`, LLM simulado): 738 de 750 cifras coinciden
  al centavo con un recálculo propio en Python sobre el XLSX real y 11 CSV; las 12 restantes son de balances
  descuadrados que la ruta bloquea con 422. Permutar filas, filas TOTAL, comas en nombres, ruido IEEE, formatos CO/US,
  BOM/TSV, saldo inicial/final y descuadres de $0,01, $1 y $150M dan cifras idénticas o 422 con motivo. De 415 pruebas
  de reproducción originales, 242 dejaron de reproducir el defecto; las que aún reproducían eran de severidad baja o
  pendientes declarados.
- **Extremo a extremo con el LLM manipulado**: resistieron todos los totales anclados; encontró que el LLM aún podía
  colar cifras a nivel de renglón (ESF/ERI/EFE/ECP), notas y prosa, más tres regresiones de integración. Se corrigieron
  en una cuarta ola: anclaje renglón a renglón (E21–E25), totales impresos siempre desde campos anclados, notas
  rotuladas como narrativa IA no auditada, control de cifras en prosa del HTML y de la Parte II, y las regresiones de
  `/consolidate` y `/html`. Pares de mutaciones compensadas de ±1 centavo que pasaban el gate: 18 de 9.720 en la
  re-auditoría; 0 de 6.480 tras la corrección; el informe honesto seguía limpio y exportable con paridad exacta
  JSON/Markdown/Excel/PDF.
- **Normativa y métricas**: decisiones aplicadas de forma consistente y, con un balance anual común, EBITDA, liquidez,
  endeudamiento, cobertura, márgenes y ROE idénticos en preprocesador, pilares, tarjetas, PDF, binding del LLM y Excel.
  Los 16 residuos encontrados (dos bases de anualización, Excel con resumen previo al curador, alerta A5 con 35 % × UAI,
  seis copias de la regla de crédito de renta, corpus RAG desactualizado, entre otros) se corrigieron en la cuarta ola
  y el cierre.

## Fase 2 — cierre de pendientes y re-auditoría final

Base: `e631415` (fase 1 integrada; 397 archivos / 4.027 pruebas en verde). Cada paquete trabajó en un worktree aislado
con propiedad exclusiva de archivos: reproducción en la suite real con una prueba que falla → cambio mínimo → verde; un
revisor distinto intentó romper cada entrega y corrigió lo que encontró. Las dependencias cruzadas de cada paquete se
cerraron en las integraciones siguientes.

### Paquetes (pendientes de la fase 1)

| Paquete | Qué se hizo | Hallazgos | Merge |
|---|---|---|---|
| P1 — procedencia servidor (pendiente #1) | `/consolidate` persiste la versión final como fila `reports` (`kind = 'financial_report'`) del workspace de la sesión, nunca del cuerpo, con huellas SHA-256 del informe, del balance preprocesado y del `rawData`, contrato de reglas y del preprocesador. `/export`, `/html` y `/api/escudo/fiscal-anchor` cargan esa versión por `reportRef` e ignoran las cifras del cuerpo (referencia mal formada 400; ajena o inexistente, el mismo 404; otra huella o fila alterada 409). Sello "procedencia verificada / no verificada" dentro del artefacto y en cabeceras. El preprocesado del cliente se re-deriva y se rechaza si difiere; el veredicto del acta lo fija el servidor. Sin migración (tabla `reports`, `data` jsonb). | niif-preproceso-33, niif-contrato-21, tributario-modulos-24, reportes-export-23, pipeline-flujo-19 | `95312e22` |
| P2 — comparativos del EFE y del ECP (pendiente #3) | Con tres cortes el código calcula el EFE y el ECP del periodo comparativo (el modelo no los redacta); el validador cruza la columna comparativa (EFE: E2, E3, E11, E18, E23; ECP: E17, E7, E4, E20c, E19 entre periodos, E24) y E26 exige los `curatorFlags` deterministas; con dos cortes, nota del código. Markdown, Excel y PDF en el mismo orden (actual \| comparativo). Mutación de ±1 centavo sobre más de 150 campos MoneyCop del informe de tres cortes, todos detectados. | niif-contrato-18 (nota de enmienda en la spec), -19, -20, -22, -23; reportes-export-20, -21 (cerrado en I2/I4); ratios-kpis-28 (ya corregido en la base) | `10f1cad4` |
| P3 — narrativa contra anclas (pendiente #2) | Validador `narrative-anchors.ts`: montos citados en notas, acta (desarrollo, quórum, orden del día) y prosa de la Parte II frente a las anclas y la aritmética determinista del acta; sella la Parte con motivo. KPIs de la Parte II sin ancla → N/D con motivo; recomputables (margen bruto, ciclo de conversión, capital de trabajo) sobrescritos. R7 del HTML impide reimprimir la cifra descartada. Traza de tres cifras de punta a punta. | pipeline-flujo-20, -21 (cerrado en I1), -23; prompts-normativa-21; valoracion-21 (prompt; contrato en I2) | `9eb60a82` |
| P4 — ingesta (pendiente #4) | Unidad declarada "en miles/millones": sin confirmación sigue bloqueando; con la confirmación del usuario (`unitMultiplier` en `/api/upload` y `/niif`, `unit` en el API v1, panel del intake) se reexpresa en centavos exactos con nota visible. Excepciones de vencimiento por cuenta (`maturityOverrides` / `maturity_overrides`) reveladas con su monto. Fecha de corte en el título → periodo `AAAA-MM` y KPIs anualizados; sin fecha, nota del supuesto anual. Contrato del API v1 `tb-2026-09-24.3`. | ingesta-22, -26, -30; niif-preproceso-29, -30, -31, -32; recalculo-13, -14 (ya corregidos, con prueba), -15 | `73cded8a` (+ `7e6378a0`) |
| P5 — módulos tributarios (pendiente #8) | Validadores M3/M5/M6 del Agente Fiscal rediseñados sobre lo que el contrato publica y conectados. Ajuste de precios de transferencia en COP N/D con motivo sin base determinista. Tope conjunto del Art. 258 recalculado por escenario con el desglose de descuentos por artículo. Tasa de mora = usura del mes − 2 pp con fuente, o N/D. Año de la UVT en hora de Colombia. Capa 2 con las normas que citan los propios módulos. | tributario-modulos-03, -10, -16 (parciales de la fase 1); tributario-calc-18..23; tributario-modulos-21..23; prompts-normativa-25; valoracion-24..27 | `cebf2917` |
| P6 — bajos transversales (pendiente #9) | Forense: Benford con MAD de Nigrini, números redondos, día en America/Bogota y festivos por año, terceros nuevos. Ecuación al centavo en los validadores de pilares; sello de la Parte V al final; V10 por régimen. Provisiones con tasas exactas y redondeo único; saldo de cierre en centavos; periodos sin solapamiento. Formato es-CO ("mil M", coma decimal, negativos entre paréntesis). Informe mensual Pyme con margen N/D sin ingresos. | auditoria-calidad-24..31; contab-nomina-22..26; ratios-kpis-26, -27, -29; reportes-export-19, -22 | `32ee0971` |

### Integraciones (dependencias cruzadas)

| Integración | Qué se hizo | Merge |
|---|---|---|
| I1 — flujo y menores | Veredictos de prosa de las Partes II y III recalculados en el servidor (sólo endurecen). `/consolidate` y `/export` aceptan las confirmaciones de ingesta de `/niif`. El BORRADOR del override llega al consolidado, a la versión persistida, al PDF y al sello (pipeline-flujo-21). El `period` de los ajustes del Doctor de Datos se respeta y un periodo inexistente es 422. `/strategy`, `/governance`, calidad, auditoría y dictamen re-derivan el preprocesado (422 `PREPROCESSED_MISMATCH`). El régimen tributario llega al gate (auditoria-calidad-31). TOTALES VINCULANTES declaran la unidad confirmada. Menores: margen Pyme N/D, Sentinel T3 N/D, `POST /api/accounting/periods` sin solapamientos, formato con idioma, el Decreto 2235/2017 (concesiones APP) ya no se cita como reglamento del Formato 2516 en el contrato ni en el resumen RAG del Art. 772-1, que cita el Decreto 1998/2017 (prompts-normativa-21), spec v10.1 sin "B" (pipeline-flujo-20), enmienda 13 (auditoria-calidad-30 a). | `6b155e86`, `0281fef2` |
| I2 — NIIF y tributario | ESF determinista partido por plazo (vencimientos declarados y virtuales de R1) coherente con `controlTotals`. PDF con paginación real, índice numerado y sin páginas en blanco (reportes-export-21); conversión exacta pesos → centavos; cascada en es-CO (reportes-export-19). Nota de comparativo no presentado que pide el corte en vez de declarar impracticabilidad (prompts-normativa-23); E6 del periodo comparativo; comparativos del EFE/ECP en el Editor Jefe. Escudo y Doctor de Datos con la regla común de ingesta; contrato DCF con `cashFlowBasis` (valoracion-21); prompts contra el corpus (prompts-normativa-25); KPIs de valoración en es-CO (ratios-kpis-27). | `58580684`, `49968e92` |
| I3 — Markdown e intake | El servidor re-renderiza el Markdown de las Partes I–III desde el JSON validado (el del navegador se descarta) y recalcula los gates de texto; una Parte II/III sin JSON válido se sella; el post-proceso determinista de la Parte II también corre en el servidor. `period` del Doctor de extremo a extremo; régimen de renta en el intake; la reanudación usa el balance y el ledger del checkpoint; remanentes de UI (subtítulo del runway, formato por idioma, polaridad de CapexEventsModal, spec Pyme). | `64998c33`, `98da89dd` (+ `1369b46c`) |
| I4 — NIIF y Escudo | ORI del periodo = Δ grupo 38 en ERI, ECP y E6/E6b (enmienda 12). E27: subtotales corriente/no corriente contra `controlTotals`. Nota de comparativo en el idioma del informe; spec v10.1 sin atribuir la línea 4175 a NIIF 15 §47; rótulos de grupo partido, índice y contraportada del PDF. Escudo: balance bloqueado → 422 con motivos (JSON y SSE) y la misma política de bloqueo que `/niif`; normas del Motor Normativo catalogadas desde el corpus; Art. 36-3 citado como derogado → advertencia; corpus del Art. 240 (35 % desde el AG 2022); texto libre de precios de transferencia sin montos de un ajuste N/D. | `af2363c0`, `131cebcd` (+ `868bf409`) |
| I5 — servidor y NIIF | Partes IV/V auditan el consolidado que produce el servidor (422 `REPORT_PARTS_REQUIRED` sin Partes I–III). Identidad (nombre, NIT, periodo) de las Partes II/III contra los estados. Cifras de las notas de la Parte I cruzadas con las anclas en la fase y en el servidor. `/export` sin referencia pliega todos los bloqueantes del gate recalculado y recalcula `fiscalSnapshot` y Âncora. El sello nombra el contrato de persistencia y el de re-render. La reanudación toma las opciones del checkpoint; el ledger del Doctor se acumula entre sesiones. Pass-1 alineado con R1 (grupo 28); E27 sustituye la sección por la proyección por plazo en vez de sellar; nota determinista del ORI no medible; Motor Normativo sin atribuciones a la Ley 1943/2018 (inexequible); corpus del Decreto 572/2025. | `4581e498`, `d8d7b20c` (+ `7cf6f351`) |

### Re-auditoría final

Seis auditores nuevos, sobre la rama con las fases 1 y 2 fusionadas, intentaron que una cifra incorrecta, una norma mal
citada o un sello de "verificado" indebido llegaran al cliente, y buscaron falsos positivos que bloquearan informes
honestos. Reportaron sólo defectos reproducidos con prueba. Resistió:

- **Recálculo independiente** (Python, centavos enteros) por la ruta real `/api/upload` → cliente → `/niif`: 879 de 900
  cifras coinciden sobre el XLSX real y los 12 CSV (incluido `tres-cortes-comparativo.csv`, 150/150). Las 21 restantes
  son 12 cifras de balances descuadrados que la ruta bloquea con 422 y 9 N/D por diseño en la columna "Saldo inicial
  2024" del XLSX. Las 32 variantes honestas nuevas de la fase 2 (EFE/ECP comparativos, ORI = Δ38 en los dos periodos,
  vencimientos declarados y R1 con la proyección E27, unidad confirmada en CSV/XLSX, fecha de corte, filas y columnas
  permutadas, formato CO, filas TOTAL) dan 3.401/3.401 cifras exactas; descuadres de $0,01 → 422.
- **Extremo a extremo** por la cadena de la UI (`/api/upload` → `/niif` → `/strategy` → `/governance` → `/consolidate`
  → `/export` y `/html`, por referencia y sin ella, es y en), 10 escenarios honestos: las 70 salidas responden 200 con el
  sello que corresponde (el HTML de dos cortes con utilidad salía como borrador: e2e-niif2-04). Del lado del cliente, 814 de 814 mutaciones de 1 centavo (sobre 81, 153 y 173 campos MoneyCop,
  columnas comparativas del EFE/ECP y ORI incluidas) quedan bloqueadas; 0 de 89.238 pares compensados pasan. En la
  salida del LLM, 570 mutaciones: 464 selladas con exportación 422, 70 sustituidas por la cifra determinista y 36
  sellaban un informe que `/niif` ya había corregido (falso positivo e2e-niif2-02, corregido en la ronda final); 0
  escapes. Paridad JSON = Markdown = Excel = PDF en 1.224 comparaciones, 0 diferencias.
- **Procedencia**: una referencia de otro workspace o inexistente recibe el mismo 404 (también contra Postgres 16 real
  con la resolución real del workspace); referencia mal formada 400; otra huella o fila alterada 409; el cuerpo no
  sustituye cifras; el Markdown sólo del cliente o un JSON ausente se descartan o sellan; una versión sin balance no sale
  verificada.
- **Narrativa**: una cifra falsa con la redacción canónica sella la Parte en la fase y en `/consolidate`, y `/export`
  por referencia responde 422; la prosa honesta con comparativo, pérdida, por acción, variaciones y proyecciones no sella.
- **Normativa y tributario**: TTD = ID/UD o N/D; V10 exime al SIMPLE; 35 % desde el AG 2022; Art. 36-3 y Arts. 457-459
  C.Co. derogados; reserva legal por tipo societario; sanción mínima $524.000; tasa de mora del mes o N/D; UVT $52.374;
  retención 2/10 UVT desde el 01-jul-2026; ajuste de precios de transferencia N/D; DCF en base nominal (129 archivos /
  1.361 pruebas de la dimensión en verde).
- **Ingesta, contabilidad y UI**: vencimientos declarados exactos, festivos y día en Bogotá, Benford con MAD (tasa de
  falsos positivos de 4,75 % y 4,7 % en libros honestos simulados, con α = 5 %), Pyme y Sentinel con N/D, formatos
  es-CO/en (134 archivos / 1.313 pruebas).

Los **55 hallazgos reproducidos** (9 altos, 21 medios, 25 bajos; 35 nuevos, 17 regresiones de la fase 2 y 3
preexistentes) se listan en el [anexo](auditoria-integral-niif-2026-09-24-anexo.md#re-auditoría-final-de-la-fase-2-55-hallazgos).
Los principales: E21 anclaba grupos de renglones unidos por un código compartido, de modo que se podían reasignar
importes entre grupos con la suma intacta; con una columna "Saldo inicial" cuyo P&G no se cerró, R12 no detectaba el
P&G acumulado; el validador de prosa sellaba prosa honesta (aritmética del acta, subtotales, desgloses) y no reconocía
la terminología contable habitual; un total del ESF que `/niif` corregía quedaba sellado en la versión persistida;
`/html` sin referencia no aplicaba los endurecimientos de `/export`; el PDF y el HTML verificados no divulgaban los
ajustes del Doctor de Datos; un CSV podía confirmar su propia unidad; con la unidad confirmada, un importe de tres
decimales se leía ×1.000; el tope del Art. 258 se evitaba sin desglose; el Régimen Simple no llegaba al Dictamen
Tributario; resúmenes del corpus RAG contradecían sus fuentes primarias.

### Ronda final

Seis paquetes sobre la base `7cf6f351`, con revisión adversarial de cada uno, y tres commits del integrador para las
dependencias cruzadas que quedaron fuera de su propiedad:

| Paquete | Hallazgos | Qué se hizo | Merge |
|---|---|---|---|
| F-preproceso | recalculo-final2-01, -02, -04, -05; ICU-01..04, ICU-07 | R12 evalúa el P&G acumulado con la columna de saldo inicial del ejercicio; sólo la confirmación de unidad de la solicitud cuenta; con unidad confirmada un importe de tres decimales se lee con el separador decimal del archivo o bloquea como ambiguo; una unidad confirmada fuera del upload sobre un XLSX leído a centavos es 422; R7, el informe de validación y el Doctor usan ingresos canónicos; la fecha de corte del encabezado de la columna fija el periodo; el intake no envía con la unidad anterior mientras se reconfirma | `ea825061` |
| F-tributario | NT-01..NT-12; ICU-05, -06, -08 | Tope del Art. 258 sin desglose (incluidos rangos "Arts. 255-257"); SIMPLE en el Dictamen Tributario (TTD "no aplica", sin impuesto teórico al 35 %); Resoluciones DIAN 000238/2025 y 000193/2024 catalogadas; "Sentencia C-079 de 2026" retirada por no tener fuente en el corpus; resúmenes RAG alineados con sus fuentes; M3/M5/M6 sin falsos positivos; Art. 36-3 presentado como aplicable bloquea; calendario DIAN del Âncora en día civil de Colombia; periodos contables dentro del mes declarado; asunto de Sentinel T3 por disparador; histórico Pyme en es/en | `1f8cd1f4` |
| F-contrato | e2e-niif2-01, recalculo-final2-03 | E21 por renglón: sin renglones puente, códigos repetidos sólo en las porciones de un grupo partido por plazo y con su plazo, sin códigos de clase que absorban grupos; E27 también por bloque de encabezado sin subtotal; en el EFE la revaluación del ORI (Δ38 − Δ19) sale de operación y se descuenta de inversión (enmienda 14) | `b02f975f` |
| F-narrativa | narrativa-01..07, -09..13; procedencia-R2-01 (validador); e2e-niif2-07 | El validador de prosa deja de sellar prosa honesta y cruza la terminología habitual ("utilidad/resultado del ejercicio", "los activos ascienden", "distribuir … la suma de", montos "900 millones de pesos"); corpus de 89 frases honestas y 58 falsas sobre cinco balances y todas las Partes | `74908d7e` |
| F-html | narrativa-08, -14 (en parte), -15, -16; e2e-niif2-03, -04 | R6 del HTML con las exenciones de la prosa de la Parte II; filas de ingresos del dashboard ancladas y variaciones verificadas; la cifra de un KPI publicado N/D sale de toda la prosa de la Parte II; ORI y resultado integral total conciliados con signo; comparativos del EFE/ECP fila por fila | `dfec788e` |
| F-procedencia | e2e-niif2-02, -05, -06; procedencia-R2-01 (artefacto), -02..07 | Una desviación ya sobrescrita por `/niif` no sella; `/html` sin referencia pasa por el gate de `/export` sin referencia; PDF y HTML divulgan los ajustes del Doctor y el sello nombra las dos huellas; firmantes y Revisor Fiscal del acta desde el intake; formato de versión v2 con huella del sobre completo (contrato `informe-niif-2026-09-24.4`); variante BORRADOR del sello; ediciones "Aplicar al reporte" declaradas; idioma del informe persistido; narrativa IA rotulada por Parte en el Excel y alcance del sello | `ed763f90` |
| Integrador | recalculo-final2-05, ICU-05, ICU-07, NT-02; dependencias de F-contrato | `98fe207b` (alerta DEV del Âncora sobre ingresos netos más devoluciones, `createPeriodAction` con el rango del mes, Nota 9 del SIMPLE en Gobierno, montos de tooltips por idioma), `34ddb769` (runway), `54802609` (el Pass-1 pide un código PUC por renglón y el bloque EFE VINCULANTE revela la revaluación), `4bbbd377` (contrato del preprocesador del API v1 `tb-2026-09-24.4`) | — |

Resultado: 54 de los 55 hallazgos corregidos con prueba de regresión; narrativa-14 queda como residual documentado (filas
de dinero del dashboard sin ancla distinta de ingresos). NT-04 está corregido en el repositorio y requiere reingestar
el corpus RAG (ver *Operación*).

### Incidentes de proceso

- **Compilación rota en la integración de I2**: `npm run build` fallaba al recolectar `/api/financial-report/export`
  con "createContext is not a function": las rutas de Next empaquetan React con la condición `react-server`, que no
  expone contexto, y el índice numerado del PDF lo usaba; Vitest corre con el React completo y no lo detectaba. Se
  corrigió en `868bf409` (el recolector del índice viaja en el IR del documento) con una guarda estática
  (`react-server-compat.test.ts`) que falla si un módulo del PDF Élite vuelve a usar contexto o hooks de estado.
- **`git stash` compartido entre worktrees**: `refs/stash` es común a todos los worktrees de un repositorio y un
  `stash push/pop` concurrente cruzó cambios sin commit entre F-narrativa, F-tributario y F-preproceso. Cada paquete
  restauró sus propios cambios desde respaldos; el código de ICU-06 que se perdió se restituyó en `34123c65`; una
  verificación de sólo lectura confirmó que no hubo pérdida final. Regla para trabajo paralelo: no usar `git stash`;
  comprobar el fallo de una prueba con copias de archivos.

## Pendientes

Sólo lo que sigue abierto tras la fase 2, agrupado por naturaleza. Lo cerrado de la lista anterior está en *Fase 2*.

### Residuales de código (documentados)

| # | Pendiente | Motivo | Dueño sugerido |
|---|---|---|---|
| 1 | Filas de dinero del dashboard de la Parte II sin ancla distinta de ingresos ("Capital de trabajo", "Deuda financiera", "Impuesto de renta") imprimen la cifra del modelo rotulada "no verificable"; el punto de equilibrio y las proyecciones siguen rotulados como no verificables (narrativa-14, e2e-niif-14) | `ExecutiveDashboardRowSchema.primary` es MoneyCop sin centinela N/D: publicar N/D exige cambiar el contrato strict-mode y los renderizadores | Contrato de Estrategia + exportaciones |
| 2 | Límites del validador de prosa: no cruza prosa en inglés ni cifras escritas en palabras; una redacción fuera de sus listas no se juzga; frases con palabras de proyección, la cifra A de "pasó de A a B" y una frase en infinitivo sin verbo de saldo (R6) quedan exentas; la palabra "anterior" cerca de una fecha exime la regla de fecha de corte; la tolerancia tras "X % de la utilidad neta" es media unidad del porcentaje; una cifra que coincide con otro periodo o saldo impreso pasa; "EBITDA ajustado" o "total de activos brutos" se comparan con el ancla neta. Al retirar la cifra de un KPI publicado N/D, la cifra igual de otro KPI en la misma frase también se sustituye por N/D. En el HTML: R6 no cubre los conceptos del acta (dividendos, reserva legal, capitalización); R8 revisa las filas comparativas del ECP sólo cuando un bloque o el año del rótulo las marca, compara sin signo las filas del EFE con el signo en el rótulo y valida por pertenencia un ECP a dos columnas por año; una "cifra no rastreable" en celdas de tabla sigue siendo advertencia (decisión de la fase 1, e2e-niif-11) | Heurística de texto: ampliar la cobertura sin caso probado produce sellos sobre informes honestos | Validadores de narrativa |
| 3 | Campos de prosa del JSON sin cruce: fórmula y banda de KPI, títulos de recomendaciones, supuestos de escenarios, `assumptionsNote`, `presumedCostWarning`, títulos de notas y `disclaimers` de la Parte III, `exemptionReason`, checklist, rótulos de la distribución; en la Parte I, rótulos de renglón y el campo norma de las notas técnicas | Varios llevan cifras por diseño (fórmulas, umbrales UVT/SMMLV) | Validadores de narrativa |
| 4 | Rótulos de cuentas de más de dos dígitos no se normalizan (sus importes sí se anclan por renglón en E21). En un ESF sin bloques ni subtotales, un renglón cuyo rótulo declara un plazo ("de largo plazo") no se contrasta con el plazo del libro (los KPI y el gate usan `controlTotals`). La sustitución de E27 agrupa por grupo PUC y pierde el detalle por cuenta del modelo. La nota R1 la redacta el modelo y puede citar el plazo del grupo de origen aunque el usuario haya declarado otro. Los renglones del ERI con código de la clase 3 sólo los revisa el gate de exportación (limpios en `/niif`, 422 al exportar) | Sólo los grupos de dos dígitos tienen rótulo de catálogo; el resto son límites de presentación sin cifras erróneas en las salidas | Contrato NIIF / presentación |
| 5 | EFE/ECP: aportes, distribuciones y apropiación de reservas se netean en una fila (NIIF para las PYMES 6.3(c)(iii) pide cifras brutas); lectura de la revaluación desde saldos: un traslado 38→37 se lee como revaluación, el método que elimina la depreciación acumulada mezcla la revaluación con la depreciación, un movimiento del grupo 19 contra resultados en el mismo periodo que una revaluación en el 15 sólo se separa en parte, con varios grupos de inversión va en renglón aparte; con un solo corte y saldo en el grupo 38 el ORI se presenta en $0 con nota determinista | Un balance de saldos no trae el detalle de movimientos; `oriPrimary` no admite N/D en el contrato | Contrato NIIF + decisión contable sobre insumos |
| 6 | El texto de la Parte IV (`auditReport`) y `report.company` (sector, ciudad) que el cliente reenvía a la Parte V y al dictamen siguen siendo del cliente; los resultados de las Partes IV/V no forman parte de la versión persistida (el PDF omite los que envía el cliente) | No hay JSON que re-renderizar; exige persistir la Parte IV en el servidor | Procedencia |
| 7 | Sin referencia (salidas "procedencia no verificada"), el servidor re-deriva el balance de las filas que envía el propio cliente: detecta incoherencias internas, no demuestra que sean las de la empresa, y parte de los bloqueantes de identidad y de régimen dependen de datos del cliente. Por referencia sólo se recalculan los bloqueantes de texto (V1–V7 y V11–V14 quedan como se persistieron). Las versiones `v1` conservan una huella sólo del informe y no traen rastro estructurado de ajustes; una versión persistida antes de la ronda final que quedó sellada sólo por una desviación que `/niif` ya había corregido sigue sellada hasta consolidar de nuevo. El Editor Jefe no recibe el registro de ajustes del Doctor (el HTML los divulga sólo en el aviso de procedencia que imprime el servidor) y el HTML no declara las ediciones "Aplicar al reporte" descartadas (sí la UI y `/export`) | Diseño de I5-4, compatibilidad con versiones anteriores y contrato del Editor Jefe | Procedencia |
| 8 | Almacén de versiones: sin política de retención ni de volumen por workspace (cada consolidación inserta una fila nueva); una referencia que ya no resuelve da 404 sin camino alternativo | Operación de plataforma no definida | Plataforma |
| 9 | Aislamiento entre tenants probado con la sesión simulada y con Postgres real y la resolución real del workspace, pero con el almacén de cookies simulado | Sin sesión BetterAuth real en el entorno | Seguridad |
| 10 | Informes en inglés: títulos y rótulos de los estados, rótulos de catálogo, subtotales deterministas, filas del ECP, mensajes de las reglas E, motivos del preprocesador y el acta siguen en español | Los catálogos y renderizadores no reciben el idioma | i18n |
| 11 | Doctor de Datos: un ajuste aplicado en una sesión anterior viaja con cada regeneración hasta "Nuevo Reporte" y no se puede rechazar en la UI. Un checkpoint anterior a I3 sin registro de ledger y con un preprocesado que no cabía en sessionStorage se reanuda sin ledger (descargas bloqueadas: regenerar). El botón de periodo rápido muestra un 409 `period_overlap` como "ya existe — listo para registrar" | Decisión de UI pendiente; transición | UI del workspace |
| 12 | Ingesta (heurísticas documentadas): "Reporte generado a 31/07/2025" en el preámbulo se toma como corte de julio; "Hasta: 30/06/2025" y "31 dic 2025" no se detectan (queda el supuesto anual revelado); un CSV separado por ";" con configuración inglesa e importes "848.123" con unidad confirmada se lee como agrupación de miles; un corte parcial con apertura explícita al 1 de enero y el año anterior sin cerrar no se detecta; un balance mensual sin fecha con P&G del año corrido da 422 CUR-R12 (política conservadora); un archivo que traiga la marca interna de celdas XLSX bloquea su propia confirmación de unidad fuera del upload (sin cifras erróneas). | Heurísticas de texto; las alternativas producían bloqueos de archivos honestos | Ingesta / API v1 |
| 13 | Tributario/Escudo: un escenario que baja el impuesto con descuentos sin citar los Arts. 255-257 ni traer desglose publica el ahorro del modelo; Capa 2 bloquea frases honestas que mencionan como derogadas o inexequibles normas de su lista negra (Art. 158-3, Decreto 1474/2025) y menciones negadas del periodo anual de IVA; una derogación de otra norma en la misma frase deja el Art. 36-3 en advertencia y, a la inversa, una frase honesta que junto a la derogación del Art. 36-3 dice que otra norma "sigue siendo aplicable" se bloquea; la regla de M5 sobre reducción de sanciones mira una ventana corta de texto y puede no reconocer una frase larga; con el ajuste de precios de transferencia N/D, una nota que cita umbrales en UVT se sustituye por el motivo (se pierde la nota, no hay cifra errónea); en salidas en inglés, M7 y la Capa 2 exigen el cierre y las citas en español y no se reconoce "Article N E.T." de artículos vigentes; los filtros de montos del modelo en precios de transferencia y planeación son heurísticos; el Dictamen del SIMPLE aún imprime la línea "Tasa minima exigida" (15 %) junto a la TTD que no aplica (cosmético); los umbrales del motor tributario no aplican la aproximación del Art. 868 (10 UVT = $523.740 frente a $524.000; 2 UVT = $104.748 frente a $105.000) | Heurísticas; política de la lista negra por decidir | Tributario / Escudo |

### Sin cambio en la fase 2 (hallazgos en parte de la fase 1)

| # | Pendiente | Motivo | Dueño sugerido |
|---|---|---|---|
| 14 | ERP: Siigo (alliances), Alegra, World Office, SAP B1, Dynamics y Odoo sólo entregan movimientos del periodo y se marcan `movements_only`; faltan saldos acumulados por conector y el cableado ERP → balance persistido → informe (ingesta-14, ingesta-18) | Contratos reales de las APIs no verificables sin credenciales | Integraciones ERP |
| 15 | Nómina: contratista vs. independiente, presunción de costos UGPP y tramos del Fondo de Solidaridad Pensional (hoy N/D) (contab-nomina-20) | Normas sin fuente en el corpus; el modelo de datos sólo distingue "dueño" | Nómina + negocio |
| 16 | Calendario 2026 sin plazos de la declaración de ingresos y patrimonio ni fecha exacta por dos dígitos (se listan como no cubiertos) (tributario-calc-07) | No están en el Decreto 2229/2023 del corpus | Normativa |

### Decisiones de negocio y de especificación

| # | Pendiente | Motivo | Dueño sugerido |
|---|---|---|---|
| 17 | Parte V: D5 (notas), D7 (acta) y D13 (flujo) no alimentan ninguna de las 12 dimensiones v2.1 (auditoria-calidad-30 b) | Cambiarlo exige enmendar la Parte V de la spec | Dueño de la spec v2.1 |
| 18 | Excepciones de vencimiento por defecto a nivel de cuenta (p. ej. anticipos 2805/2810/2815 como corrientes) no adoptadas: hoy dependen de que el usuario las declare | Decisión de negocio sobre supuestos por defecto | Negocio + contrato NIIF |
| 19 | Publicar N/D (en vez de $0 con nota) para el ORI con un solo corte; exoneración del Art. 114-1 (hoy configurable por empresa, sin supuesto por defecto) | Cambio de contrato strict-mode y de superficies; decisión por empresa | Negocio + contrato NIIF |
| 20 | Política de la lista negra de la Capa 2 frente a frases que afirman una derogación o inexequibilidad (ver #13) | Criterio del coordinador normativo | Normativa |

### Normas por confirmar con fuente primaria (el código no fija estas cifras)

| # | Pendiente | Motivo | Dueño sugerido |
|---|---|---|---|
| 21 | CE de Supersociedades 2026 sobre SAGRILAFT (umbral en UVB); plazos de ingresos y patrimonio; estado de adopción de NIIF 18; vigencia del impuesto transitorio del Decreto 173/2026; Ley 43/1990 art. 13 par. 2 (umbrales del Revisor Fiscal siguen con ">", con una prueba que obliga a revisarlos cuando el texto entre al corpus); Decreto 019/2012 y Art. 28 C.Co. (libros registrados); NIC 36 (la redacción de 36.33(b) sigue el hallazgo); Res. UGPP 532/2024 y tramos del FSP | No accesibles desde este entorno ni presentes en `src/data/tax_docs` | Normativa (añadir la fuente al corpus y alinear) |

### Verificación pendiente

| # | Pendiente | Motivo | Dueño sugerido |
|---|---|---|---|
| 22 | Medición con el LLM real y balances reales: tasa de sellos y falsos positivos de los validadores de prosa, E21 y E27 sobre salidas reales | Las dos fases simularon las salidas del modelo | Equipo financiero (próxima tarea del handoff) |
| 23 | Revisión visual humana de un PDF y un Excel reales (paginación, índice, apaisado, anexo de ajustes, sello, BORRADOR); el PDF se renderiza en dos pasadas para numerar el índice (≈ 1 s → 1,8 s en el fixture) | Sólo se verificaron datos y texto renderizado | Producto / QA |
| 24 | Pruebas de las páginas `/workspace/valor` y de macroeconomía (valoracion-27, en parte: P5 sólo añadió pruebas de signo en los renderizadores) | Fuera de la propiedad del paquete P5 | Valoración + QA |

Los hallazgos bajos de la fase 1 que no se procesaron siguen listados en la evidencia de trabajo de la auditoría.

## Operación antes de desplegar

1. **Migraciones**: `npm run db:migrate` aplica 0022 y 0023 (fase 1: vista del libro mayor con reversos y cierre;
   alineación del PUC sembrado). La fase 2 no añadió migraciones: la versión persistida usa la tabla `reports`
   existente (`kind = 'financial_report'`, `data` jsonb). Sin `DATABASE_URL` o sin workspace, las salidas se emiten
   con "procedencia no verificada".
2. **Corpus RAG**: `npm run db:ingest` (con `OPENAI_API_KEY`) para reindexar. Archivos de `src/data/tax_docs`
   corregidos en la fase 2 (`e631415..54802609`): `decreto_572_2025_autorretenciones.md`,
   `estatuto_tributario_resumen_2026.md`, `et_articulo_240_renta_juridica.md`,
   `et_articulo_772_1_conciliacion_contable_fiscal.md`, `ley_2277_2022_reforma_tributaria.md`,
   `procedimiento_dian_2026.md` (además de los de la fase 1).
3. **Clientes del API v1** (contrato `tb-2026-09-24.4`; ver [API_CLIENTES.md](../API_CLIENTES.md)): parámetros
   opcionales `unit` y `maturity_overrides`; campos `unit`, `validation_notes[]` y `classification_note`; un CSV que
   declara "en miles/millones" queda `unbalanced` hasta confirmar la unidad; con la unidad confirmada, un importe
   ambiguo de tres decimales queda `unbalanced` con su motivo (nunca ×1.000); el `period_label` puede ser `AAAA-MM`
   cuando el título (con una columna de sólo año) o el encabezado de la columna de saldo declaran un corte parcial; un
   saldo inicial del ejercicio con resultados sin trasladar al patrimonio queda `unbalanced` con `CUR-R12`. Los
   importes ambiguos, la fecha del encabezado y `CUR-R12` con saldo inicial son de la ronda final y no subieron el
   `preprocessor_version` (Pendientes #12).
4. **Consumidores directos de las rutas internas** (la UI ya está adaptada):
   - `/api/financial-report/consolidate` persiste la versión y devuelve `reportRef = {reportId, reportHash}`; acepta
     `provisional`, `unitMultiplier` y `maturityOverrides`.
   - `/export` y `/html` aceptan `reportRef`: 400 `REPORT_REF_INVALID`, 404 `REPORT_VERSION_NOT_FOUND`, 409
     `REPORT_VERSION_MISMATCH` / `REPORT_VERSION_INTEGRITY`; cabeceras `X-Report-Provenance`, `X-Report-Contract`,
     `X-Report-Rendered-Contract`, `X-Report-Draft`, `X-Report-Edit-Dropped`. Sin referencia, 422 cuando el gate
     recalculado en el servidor bloquea, aunque el cuerpo declare el informe emitible.
   - `/strategy`, `/governance`, `/api/financial-quality`, `/api/financial-audit`, `/api/fiscal-audit-opinion`, el
     respaldo de `/niif` y la ruta legacy: 422 `PREPROCESSED_MISMATCH` si el preprocesado recibido no coincide con el
     re-derivado (el `adjustmentLedger` del Doctor debe viajar con el preprocesado ajustado).
   - `/api/financial-quality`: 422 `REPORT_PARTS_REQUIRED` sin las Partes I–III (auditoría y dictamen ya las exigían
     en su esquema); las tres rutas auditan el consolidado que re-renderiza el servidor.
   - `/niif`: `unitMultiplier` (1, 1.000 o 1.000.000) y `maturityOverrides` (400 si son inválidos; 422 si contradicen
     una directiva del texto o si la unidad se confirma fuera del upload sobre un XLSX leído a centavos); un ajuste
     confirmado con un periodo inexistente es 422.
   - `/api/escudo/fiscal-anchor` exige `reportRef` (422 `report_ref_required`); `/api/escudo/fiscal` y
     `/api/escudo-survival` responden 422 `BALANCE_VALIDATION_FAILED` con motivos (JSON y SSE).
   - `companyInfoSchema.regimenTributario`: `'ordinario' | 'simple' | null`; otro valor → 400.
     `POST /api/accounting/periods`: 400 `invalid_period_range`, 409 `period_overlap`.
   - Contrato del informe `informe-niif-2026-09-24.4` y formato de versión `utopia.financial-report-version.v2`
     (las versiones `v1` se siguen leyendo).
5. **Tasa de usura mensual**: `TASA_USURA_CERTIFICADA` (`src/lib/tools/sanction-calculator.ts`) sólo registra
   2026-08 (Res. Superfinanciera 1139 del 31-jul-2026, 29,66 % E.A.). Desde septiembre de 2026 los intereses
   moratorios sin tasa explícita son N/D hasta registrar la usura de cada mes con su resolución. Responsable: operación
   tributaria, cada mes.
6. **Revisión visual** de un PDF y un Excel reales antes del lanzamiento (pendiente #23).

## Verificación ejecutada

Sin servicios reales (LLM simulado, credenciales ficticias para la compilación):

| Comprobación | `dea0329` (antes) | Fase 1 (`776ca97`) | Final fase 2 (`4bbbd377`) |
|---|---|---|---|
| `npx vitest run` | 200 archivos, 2.355 pruebas, 3 omitidas | 397 archivos, 4.027 pruebas, 20 omitidas, 0 fallos | 535 archivos / 5.404 pruebas pasan; 23 omitidas (20 en los 6 archivos que requieren Postgres y 3 marcadores `describe.skip` preexistentes de `buildFiscalAnchor-grupo2tres.test.ts`); 0 fallos |
| `npx tsc --noEmit` | 0 errores | 0 errores | 0 errores |
| `npm run lint` | 0 errores, 187 avisos | 0 errores, 160 avisos | 0 errores, 158 avisos preexistentes (157 en el código versionado; 1 en `src/app/.well-known/workflow/`, generado por la compilación e ignorado por git) |
| `npm run lint:strict-mode` | correcto | correcto (36 archivos) | correcto |
| `npm run build` (credenciales ficticias) | no ejecutado en esta sesión (correcto en la revisión del 2026-09-05) | correcto | correcto |
| Recálculo independiente por la ruta real | — | 738/750 cifras al centavo; 12 en balances descuadrados bloqueados con 422 | 879/900 (12 bloqueadas con 422 y 9 N/D por diseño en la columna "Saldo inicial"); 32 variantes nuevas: 3.401/3.401 |
| Mutaciones de 1 centavo del lado del cliente | — | — | 814/814 bloqueadas |
| Mutaciones compensadas ±1 centavo que pasan el gate | 18 de 9.720 (re-auditoría, antes de la cuarta ola) | 0 de 6.480 | 0 de 89.238 |
| Mutaciones de la salida del LLM | — | — | 570: 464 selladas, 70 sustituidas por la cifra determinista, 36 del falso positivo e2e-niif2-02 (corregido); 0 escapes |
| Paridad JSON / Markdown / Excel / PDF | — | exacta | 1.224 comparaciones, 0 diferencias |

Las pruebas de base de datos se omiten sin `UTOPIA_TEST_DATABASE_URL`. En la fase 1 se corrieron contra un Postgres 16
local efímero con las migraciones del repositorio; en la fase 2 se corrió así la de la versión persistida
(`financial-report-store.db.test.ts`, 3/3, en P1 y en la re-auditoría) y P6 verificó sus consultas nuevas contra un
Postgres 16 local. Cada corrección se acompañó de una prueba de regresión
que falla contra el código anterior; las pruebas existentes que codificaban el comportamiento defectuoso se
actualizaron con la razón en el commit correspondiente. Las cifras de la re-auditoría final corresponden a la rama con
toda la fase 2 antes de la ronda final; las de vitest, tsc, lint, strict-mode y build, al commit final `4bbbd377` (mismas cifras que en `54802609`).
