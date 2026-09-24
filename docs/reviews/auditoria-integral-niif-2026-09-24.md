# Auditoría integral multiagente — exactitud de cifras y alineación normativa (2026-09-24)

Base auditada: `main` @ `dea0329` (PR #14 fusionada). Rama de correcciones: `claude/auditoria-proyecto-niif-sdr3ia`
(verificación final sobre `776ca97` + esta documentación).
Foco pedido: el módulo NIIF (balance de prueba → estados → informe → exportaciones), además de métricas, cálculos
tributarios, laborales, valoración, reportes y la normativa colombiana aplicable.

> **Respuesta corta.** En `dea0329` las cifras **no** eran correctas en varias rutas que llegan al cliente, empezando
> por la principal: el informe NIIF lanzado desde la interfaz corría **sin el motor determinista** (sin totales
> vinculantes, sin anclas y sin el gate 422). Esta sesión corrige los defectos confirmados, con pruebas de regresión
> que fallan contra el código anterior. El resultado es un pipeline NIIF cuyas cifras se derivan y verifican en código
> al centavo, y que **bloquea o marca N/D** cuando no puede sostener una cifra. No es una certificación de cumplimiento
> integral: ver *Límites* y *Pendientes*.

## Método

| Fase | Qué se hizo | Resultado |
|---|---|---|
| 1. Auditoría por dimensión | 13 agentes independientes: preprocesador NIIF, contrato/validadores NIIF, flujo del pipeline, razones y KPI, calculadoras tributarias, módulos tributarios, valoración, reportes/exportaciones, ingesta ERP/archivos, contabilidad y nómina, normativa en prompts, auditoría/calidad, y un **recálculo independiente** (script propio sobre los fixtures crudos, sin reutilizar funciones del repo). Cada hallazgo con archivo:línea, reproducción y fuente normativa. | 332 hallazgos (24 críticos, 89 altos) y 210 comprobaciones que resultaron correctas |
| 2. Verificación adversarial | 12 verificadores distintos de los auditores intentaron **refutar** cada hallazgo crítico/alto/medio: alcanzabilidad real, mitigaciones en otra capa, re-derivación de cifras, duplicados | 228 confirmados, 42 duplicados, 1 refutado; severidades ajustadas por alcance real |
| 3. Corrección | 13 paquetes con propiedad exclusiva de archivos, en worktrees aislados; prueba de regresión en rojo → cambio mínimo → verde | ver tabla siguiente y el [anexo](auditoria-integral-niif-2026-09-24-anexo.md) |
| 4. Integración | Fusión, resolución de conflictos y de regresiones entre paquetes (3 defectos reales de integración corregidos: Bridge de Cuadratura, `equation_delta` del API v1, Doctor de Datos sin re-ejecutar R8) y dos olas más para 109 + 40 dependencias cruzadas | ver *Verificación ejecutada* |
| 5. Re-auditoría | 3 agentes nuevos (recálculo independiente, extremo a extremo adversarial, normativa y métricas) sobre el código corregido; sus 40 hallazgos residuales se corrigieron en una cuarta ola y un cierre, salvo lo listado en *Pendientes* | ver sección siguiente |

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

Los hallazgos altos y medios (51 y 139 confirmados) están en el [anexo](auditoria-integral-niif-2026-09-24-anexo.md) con su estado
(de 269 hallazgos confirmados, incluidos los de la re-auditoría: 259 corregidos y 10 corregidos en parte, ninguno crítico); los más relevantes para
el módulo NIIF: grupo PUC 42 dentro de la utilidad bruta y el EBIT; EFE del LLM sin cruce con el EFE determinista;
EFE determinista que trataba apropiaciones y capitalizaciones como flujos y dividendos pagados como partidas no
monetarias; tolerancias no exactas del ECP; R8 absorbiendo cualquier residual; `parseNumber` que leía `1234.567` como
miles; ROE +451 % con patrimonio negativo; Estrategia sin validación determinista; exportación mezclando fuentes;
auditoría y sello de calidad no condicionados a la integridad aritmética.

## Decisiones normativas y de presentación aplicadas

Las especificaciones prevalecen salvo error demostrado; los cambios de criterio quedan como enmiendas fechadas en
`docs/spec/financial-pipeline-v2.1.md`.

- **Grupo PUC 42/53 debajo de la utilidad operacional** (Decreto 2650/1993: ingresos y gastos no operacionales).
  Utilidad bruta = (41 − 4175) − (6 + 7); EBIT = UB − 51 − 52; UAI = EBIT + 42 − 53. Sustituye la lectura de la spec v2.
- **Impuesto de renta sin grupo 54** (antigua corrección 4): no se reconoce con la cuenta 1805 ni con 35 % × UAI;
  queda sin reconocer con nota (NIC 12 / Sección 29). En el PUC oficial la 1805 es "Bienes de arte y cultura".
- **TTD** (Art. 240 par. 6 E.T.) = ID/UD; sin bases verificadas → N/D en todas las superficies (auditoría, Escudo,
  planeación). UAI y utilidad contable no son bases fiscales.
- **Derogatorias**: Art. 36-3 E.T. (Ley 2277/2022 art. 96); Arts. 457 num. 2, 458 y 459 C.Co. (Ley 2069/2020 art. 4,
  sustituidos por la regla de negocio en marcha). Reserva legal obligatoria en S.A. y Ltda.; en SAS sólo por estatutos.
- **SAGRILAFT**: umbral de 40.000 SMMLV (CE 100-000016/2020) mientras no se confirme el texto de la CE de 2026.
- **ZOMAC**: tarifas por año gravable y tamaño (Ley 1819/2016 Art. 237). **Retención en la fuente**: bases 2 UVT
  servicios / 10 UVT compras desde el 1-jul-2026 (Decreto 0572/2025 tras la revocatoria de su suspensión).
- **Cierre contable**: el traslado a 3605/3610 es del cierre anual (periodo 13), no de cada mes.

## Lo que la auditoría verificó como correcto

Entre las 210 comprobaciones superadas: ecuación patrimonial, cascada del ERI e identidades del EFE/ECP exactas al
centavo en el validador; recálculo independiente de 425 cifras de los fixtures (401 coincidían al centavo y las 24
diferencias tenían causa identificada, hoy corregida); permutar filas no cambia ningún total; UVT 2025/2026, SMMLV y
auxilio de transporte 2026, prestaciones y aportes, Ley 2466/2025 (recargos y jornada), dígito de verificación del NIT,
sanciones Arts. 639-648 en la función de cálculo, intereses Art. 635, festivos 2026, Benford y chi², Monte Carlo
reproducible con semilla, Excel con los cuatro estados coherentes con el JSON.

## Límites de esta auditoría

- **Normativa**: el entorno bloquea la lectura directa de normograma DIAN, Secretaría del Senado y Función Pública;
  la verificación usó búsquedas web (cupo de 200 agotado durante la fase 1) y los textos normativos del repositorio
  (`src/data/tax_docs`). Varias cifras 2026 (tasa de usura de septiembre, CE SAGRILAFT 2026, NIIF 18 en Colombia)
  quedaron sin confirmación primaria y el código no las fija.
- **LLM**: las salidas de los modelos se simularon; no se midió con corridas reales cuánto aprovecha el modelo los
  huecos restantes. Las cifras que dependen del LLM sin ancla determinista se marcan como no verificables.
- **ERP y base de datos**: sin credenciales reales. Las pruebas de libro mayor usaron un Postgres 16 local efímero con
  las migraciones del repo; los contratos reales de las APIs ERP no se verificaron.
- **Visual**: no hubo revisión visual del PDF/Excel generados; se verificaron sus datos.
- Coherencia aritmética no acredita procedencia ni cumplimiento fiscal de cada contribuyente.

## Re-auditoría independiente sobre el código corregido

Tres agentes distintos de los que corrigieron intentaron, en modo adversarial, que una cifra incorrecta llegara al cliente:

- **Recálculo independiente por la ruta real** (`/api/upload` → UI → `/niif`, LLM simulado): 738 de 750 cifras coinciden
  al centavo con un recálculo propio en Python sobre el XLSX real y 11 CSV; las 12 restantes son de balances
  descuadrados que la ruta bloquea con 422. Permutar filas, filas TOTAL, comas en nombres, ruido IEEE, formatos CO/US,
  BOM/TSV, saldo inicial/final y descuadres de $0,01, $1 y $150M dan cifras idénticas o 422 con motivo. De 415 pruebas
  de reproducción originales, 242 dejaron de reproducir el defecto; las que aún reproducen son de severidad baja o
  pendientes declarados.
- **Extremo a extremo con el LLM manipulado**: resistieron todos los totales anclados; encontró que el LLM aún podía
  colar cifras a nivel de renglón (ESF/ERI/EFE/ECP), notas y prosa, más tres regresiones de integración. Se corrigieron
  en una cuarta ola: anclaje renglón a renglón (E21–E25), totales impresos siempre desde campos anclados, notas
  rotuladas como narrativa IA no auditada, control de cifras en prosa del HTML y de la Parte II, y las regresiones de
  `/consolidate` y `/html`. Pares de mutaciones compensadas de ±1 centavo que pasaban el gate: 18 de 9.720 en la
  re-auditoría; 0 de 6.480 tras la corrección; el informe honesto sigue limpio y exportable con paridad exacta JSON/Markdown/Excel/PDF.
- **Normativa y métricas**: decisiones aplicadas de forma consistente y, con un balance anual común, EBITDA, liquidez,
  endeudamiento, cobertura, márgenes y ROE idénticos en preprocesador, pilares, tarjetas, PDF, binding del LLM y Excel.
  Los 16 residuos encontrados (dos bases de anualización, Excel con resumen previo al curador, alerta A5 con 35 % × UAI,
  seis copias de la regla de crédito de renta, corpus RAG desactualizado, entre otros) se corrigieron en la cuarta ola
  y el cierre.

## Pendientes

Trabajo que esta sesión no cierra, en orden de impacto:

1. **Procedencia servidor de informes**: la exportación re-valida aritmética y fuente contra el balance recibido, pero
   no demuestra que corresponda a una versión persistida y autorizada de la empresa (tarea del handoff anterior).
2. **Narrativa del LLM**: las notas y la prosa de Gobierno/Estrategia se rotulan como narrativa IA no auditada y el HTML
   bloquea contradicciones con anclas conocidas, pero no todas las cifras en prosa se cruzan (p. ej. montos citados en
   el acta fuera de la aritmética determinista, KPIs de la Parte II sin ancla que se imprimen rotulados).
3. **Contrato NIIF**: comparativos del EFE y del ECP aún no forman parte del contrato (el export declara "comparativo no
   presentado"); rótulos de cuentas de más de dos dígitos no se normalizan (sus importes sí se anclan).
4. **Decisiones de negocio**: clasificación corriente/no corriente por vencimientos (hoy por grupo PUC, revelada como
   supuesto); confirmación de unidad "en miles/millones" desde la UI (hoy se bloquea); criterio de meses para etiquetas
   de sólo año en cortes parciales; exoneración Art. 114-1 (hoy configurable por empresa, sin supuesto).
5. **ERP**: los conectores que sólo entregan movimientos del periodo se marcan `movements_only` y no se usan como
   balance; faltan saldos acumulados reales por conector y el cableado ERP → balance persistido → informe.
6. **Normas por confirmar con fuente primaria** (no accesibles desde este entorno): CE de Supersociedades 2026 sobre
   SAGRILAFT (umbral en UVB), tasa de usura de septiembre de 2026, plazos de ingresos y patrimonio, estado de adopción
   de NIIF 18, vigencia del impuesto transitorio del Decreto 173/2026. El código no fija esas cifras.
7. **Nómina**: contratistas vs. independientes, presunción de costos UGPP y tramos del Fondo de Solidaridad Pensional
   (hoy N/D).
8. **Módulos tributarios sin pantalla** (API vivas): validadores M3/M5/M6 del Agente Fiscal requieren rediseño de
   contrato; ajuste de precios de transferencia en COP sin base determinista (rotulado como estimación del modelo);
   tope conjunto del Art. 258 no verificable por escenario; calendario 2026 sin plazos de ingresos y patrimonio ni fecha
   exacta por dos dígitos (se listan como no cubiertos).
9. **Hallazgos bajos** no procesados o parciales (forense: franjas horarias y festivos; abreviaturas de gráficos; MT940;
   redondeo de umbrales del motor tributario), listados en la evidencia de trabajo.

## Operación antes de desplegar

- `npm run db:migrate` (migraciones 0022 y 0023: vista del libro mayor con reversos y cierre; alineación del PUC sembrado).
- `npm run db:ingest` para reindexar el corpus RAG corregido.
- Avisar a consumidores del API v1: contrato `tb-2026-09-24` (`status` sobre la cuadratura del archivo de origen,
  campos nuevos, `rows` normalizado como `csv`).
- Revisión visual de un PDF y un Excel reales antes del lanzamiento.

## Verificación ejecutada

Sobre el código final (HEAD de la rama antes de este informe, `776ca97`), sin servicios reales:

| Comprobación | `dea0329` (antes) | Final |
|---|---|---|
| `npx vitest run` | 200 archivos, 2.355 pruebas, 3 omitidas | 397 archivos, 4.027 pruebas, 20 omitidas, 0 fallos |
| `npx tsc --noEmit` | 0 errores | 0 errores |
| `npm run lint` | 0 errores, 187 avisos | 0 errores, 160 avisos |
| `npm run lint:strict-mode` | correcto | correcto (36 archivos) |
| `npm run build` (credenciales ficticias) | no ejecutado en esta sesión (correcto en la revisión del 2026-09-05) | correcto |
| Recálculo independiente por la ruta real | — | 738/750 cifras al centavo; 12 en balances descuadrados bloqueados con 422 |
| Mutaciones compensadas ±1 centavo que pasan el gate | 18 de 9.720 (re-auditoría, antes de la cuarta ola) | 0 de 6.480 |

Las 20 pruebas omitidas incluyen las de libro mayor contra Postgres, que se ejecutan con `UTOPIA_TEST_DATABASE_URL`; se
corrieron durante la sesión contra un Postgres 16 local efímero con las migraciones del repositorio (en serie, por un
error de serialización 40001 al paralelizar archivos que también afecta a las pruebas previas). Cada corrección se
acompañó de una prueba de regresión que falla contra el código anterior; las pruebas existentes que codificaban el
comportamiento defectuoso se actualizaron con la razón en el commit correspondiente.
