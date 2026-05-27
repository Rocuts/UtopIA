# Wave 8 — Dictamen Normativo: Capa 1 · Escudo Fiscal F01–F10 + Calendario DIAN por NIT

> **Emisor**: Escudo Tributario CO (agente normativo UtopIA)
> **Fecha**: 2026-05-26
> **Caso de referencia**: Grupo Empresarial 2 Tres SAS · NIT 901.714.014-6 · período fiscal 2025 (a declarar en 2026)
> **Alcance**: 7 cuestiones técnicas que están a punto de quedar codificadas en `escudo-survival-backend`, `escudo-survival-validator` y `escudo-survival-ui`. Este dictamen es la fuente normativa única que los tres roles deben respetar.
> **No constituye asesoría legal**. Es interpretación operativa de norma vigente para soportar codificación defendible ante DIAN (Art. 647 E.T.).

---

## Resumen ejecutivo (los 7 veredictos en 200 palabras)

1. **F01 = UAI (antes de impuesto)** — corregir el spec, NO usar Ganancia Neta. Fundamento: Art. 26 + 240 E.T. La base del impuesto de renta es la utilidad antes de impuestos, no después.
2. **35% aplica a SAS comercial 2025** salvo 6 excepciones tarifarias documentadas (zonas francas, hoteles ZESE/ZOMAC, Economía Naranja activa, hidroeléctricas +3pp, financieras +5pp, megainversiones). UI debe mostrar disclaimer.
3. **TTD NO entra en F02** — F02 es referencia bruta al 35%. La TTD se calcula en módulo separado de conciliación fiscal. La frase obligatoria del bloque cubre la limitación.
4. **Calendario DIAN 2026 NIT ...6**: confirmadas todas las fechas vía Decreto 2229/2023 (vigente) + Resoluciones DIAN específicas. Detalle por obligación en §4.
5. **ICA como "estimación" sin CIIU es legalmente admisible** siempre que (a) se use ReteICA como base y (b) el UI declare la limitación. Decreto 352/2002 Bogotá Art. 27.
6. **Frase obligatoria es suficiente pero subóptima** — recomiendo extenderla con referencia a TTD y a depuración fiscal del Art. 26 E.T. para blindaje Art. 647 completo.
7. **Alerta A5 procede** con doble fundamento: NIIF PYMES Sección 29.4 (obligación de reconocer pasivo por impuesto corriente) + Art. 647 E.T. (riesgo de inexactitud). Redacción exacta en §7.

---

## 1. ¿F01 es UAI o Ganancia Neta?

### Pregunta
El spec define F01 como "UAI Contable — base del impuesto de renta" pero también dice "F01 = A11" donde A11 es "Ganancia Neta del Año" (después de impuestos). En el caso real coinciden porque Clase 54 = $0, pero la inconsistencia explota cuando hay impuesto provisionado.

### Dictamen
**F01 debe ser UAI (Utilidad Antes de Impuestos), no Ganancia Neta del Año.** La hipótesis del operador es correcta.

### Fundamento normativo

**Art. 26 E.T. — Los ingresos son base de la renta líquida**:

> "La renta líquida gravable se determina así: de la suma de todos los ingresos ordinarios y extraordinarios realizados en el año o período gravable, que sean susceptibles de producir un incremento neto del patrimonio en el momento de su percepción [...] se restan las devoluciones, rebajas y descuentos [...] menos los costos imputables a tales ingresos [...] menos las deducciones realizadas [...]. La renta líquida gravable se determina así: la renta líquida es renta gravable y a ella se aplican las tarifas señaladas en la ley."

**Art. 240 E.T. — Tarifa general**: la tarifa del 35% se aplica a la **renta líquida gravable**, que parte del resultado contable **antes** del gasto por impuesto (luego se depura fiscalmente).

### Por qué Ganancia Neta es matemáticamente incorrecta

Si `F01 = Ganancia Neta = UAI − Impuesto` entonces:
- `F02 = (UAI − Impuesto) × 35%`
- Esto subestima el impuesto en el monto del impuesto mismo (circularidad inversa).

La única vez que ambas coinciden es cuando `Impuesto = 0`, exactamente el caso del Grupo 2 Tres SAS — lo que **enmascara el bug** del spec.

### Recomendación accionable
- **Backend**: `F01 = balance.estadoResultados.utilidadAntesImpuesto` (NO `utilidadNeta`).
- **Validator**: regla `F01 === UAI && F01 !== gananciaNeta_si_clase54_distinta_cero`. Si Clase 54 ≠ 0, el validator DEBE rechazar `F01 = ganancia neta`.
- **UI**: etiqueta "UAI Contable (Art. 26 E.T.)". NO "Ganancia Neta".
- **Spec**: actualizar línea "F01 = A11" a "F01 = UAI = A11 + Clase 54 si la Clase 54 ya fue restada en A11; de lo contrario F01 = A11".

### Fuente
- [Art. 26 E.T. – estatuto.co](https://estatuto.co/26)
- [Art. 240 E.T. – estatuto.co](https://estatuto.co/240)

---

## 2. ¿La tarifa 35% aplica sin matices a SAS persona jurídica 2025?

### Pregunta
F02 = F01 × 35%. ¿Hay excepciones tarifarias que afecten a una SAS comercial colombiana 2025 (zonas francas, megainversiones, ZESE, ZOMAC, hoteles, Economía Naranja)?

### Dictamen
**La tarifa 35% es la regla general post Ley 2277/2022** (Art. 10 que modificó Art. 240 E.T.) para personas jurídicas nacionales y asimiladas, incluidas las SAS comerciales. Existen excepciones tarifarias que deben verificarse antes de aplicar 35% ciegamente.

### Excepciones tarifarias vigentes 2025 (declarar 2026)

| Régimen | Tarifa | Vigencia | Aplicable a SAS? |
|---|---|---|---|
| **Sobretasa hidroeléctricas** | 35% + 3pp = **38%** | 2023-2026 | Solo CIIU 3511 |
| **Sobretasa financieras** | 35% + 5pp = **40%** | 2023-2027 | Bancos, aseguradoras, reaseguradoras, bolsas |
| **Zona Franca (industriales)** | **20%** sobre ingresos exportadores; 35% sobre ingresos internos | Régimen dual desde 2024 | Sí, si tiene calificación ZF |
| **ZESE (Norte de Santander, La Guajira, Buenaventura, Quibdó, Tumaco, Barrancabermeja, Armenia)** | 0% primeros 5 años → 50% tarifa siguiente 5 años → tarifa plena | Ley 1955/2019 Art. 268, prorrogada | Sí, requiere actividad sustancial en zona |
| **ZOMAC (256 municipios)** | Tarifa progresiva 0% → 25% → 50% → 75% del 35% por 10 años | Ley 1819/2016 Art. 235-3 | Sí, micro/pequeña ZOMAC |
| **Hoteles nuevos/remodelados (Art. 240 par. 5)** | **9%** por 20 años en ciudades < 200k habitantes; **15%** ciudades > 200k | Inscritos hasta 2026 según norma original | Sí |
| **Economía Naranja activa (Art. 235-2 num. 1)** | Renta exenta 5 años | Solo empresas inscritas 2018-2021 (ventana cerrada) | Solo si ya está inscrita |
| **Megainversiones (Art. 235-3 E.T.)** | **27%** | Inversión > 30M UVT, requiere acto administrativo | Sí, pero excepcional |

### Recomendación accionable
- **Backend**: parámetro `tarifaRenta` configurable por NIT, default 35%, sobreescribible por sector/régimen detectado.
- **Validator**: cuando CIIU detectado pertenezca a hidroeléctricas/financieras, marcar warning "tarifa default 35% puede estar subestimando el impuesto".
- **UI**: disclaimer permanente en bloque F02:
  > "Tarifa aplicada: 35% (Art. 240 E.T., régimen general). Si la empresa opera bajo Zona Franca, ZESE, ZOMAC, régimen hotelero, hidroeléctrica, financiero o Economía Naranja activa, la tarifa puede diferir. Verifique RUT y actas societarias."
- **Para Grupo 2 Tres SAS**: confirmar CIIU del NIT 901.714.014-6 antes de fijar 35% como definitivo. Sin más datos del expediente, 35% es supuesto razonable.

### Fuente
- [Art. 240 E.T. – estatuto.co](https://estatuto.co/240)
- [Actualícese – Tarifa general 2026 personas jurídicas](https://actualicese.com/tarifa-general-del-impuesto-de-renta-2026-para-personas-juridicas/)
- [Ley 2277 de 2022 – Función Pública](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=199883)

---

## 3. ¿La Tasa Mínima de Tributación (TTD) afecta el cálculo de F02?

### Pregunta
El spec NO menciona la TTD del 15% (Ley 2277/2022 Art. 10, parágrafo 6 Art. 240 E.T.). ¿Debe F02 considerarla, o se mantiene como "referencia bruta al 35%" siempre que aparezca la frase obligatoria?

### Dictamen
**F02 NO debe incluir el efecto TTD.** F02 es por construcción una **referencia bruta** sobre la UAI contable; la TTD opera sobre la Utilidad Depurada (UD), que requiere depuraciones del parágrafo 6 que F02 no realiza. Mezclarlas produciría doble cálculo erróneo.

### Fundamento normativo

**Parágrafo 6 Art. 240 E.T. (adicionado por Ley 2277/2022 Art. 10)** define la TTD así:

> "La tasa mínima de tributación, que se denominará Tasa de Tributación Depurada (TTD), no podrá ser inferior al quince por ciento (15%) y será el resultado de dividir el Impuesto Depurado (ID) sobre la Utilidad Depurada (UD), así: TTD = ID / UD."

La UD se construye con un conjunto definido de partidas (utilidad contable + INCRNGO + rentas exentas específicas − descuentos), distinta de la UAI bruta. Aplicar 15% sobre UAI no es TTD.

### Arquitectura recomendada
- **F02 = referencia al 35% sobre UAI** (lo que dice el spec) → bloque "Escudo Fiscal".
- **Bloque separado de Conciliación Fiscal** (fuera de F01-F10) calcula:
  - Renta líquida fiscal (post depuración).
  - Impuesto Depurado (ID).
  - Utilidad Depurada (UD).
  - TTD = ID/UD.
  - Si TTD < 15% → impuesto adicional = (UD × 15%) − ID.

### Recomendación accionable
- **Backend**: NO mezclar TTD en F02. Crear `computeTTD()` en módulo aparte (existe ya en motor ELITE — verificar `src/lib/agents/financial/elite/ttd.ts` o similar).
- **Validator**: F02 debe pasar invariante `F02 === F01 × 0.35` (o tarifa sectorial), sin sumandos de TTD.
- **UI**: bloque F02 con leyenda *"Referencia antes de depuraciones fiscales. El impuesto definitivo requiere conciliación formal conforme al Artículo 240 del E.T., incluyendo la Tasa Mínima de Tributación Depurada del 15% (parágrafo 6)."* — ver §6 para frase definitiva.
- **Doctrina DIAN crítica**: las rentas exentas SÍ entran en la UD (Concepto Unificado 202[006038]). Si el cliente tiene Economía Naranja u otra renta exenta, alertar para que el módulo de conciliación lo capture.

### Fuente
- [Art. 240 E.T. parágrafo 6 – estatuto.co](https://estatuto.co/240)
- [Concepto Unificado DIAN 202(006038) — TTD](https://crconsultorescolombia.com/tasa-minima-de-tributacion-dian-concepto-unificado-202006038.php)
- [Ley 2277 de 2022 Art. 10 – Función Pública](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=199883)

---

## 4. Calendario DIAN 2026 — fechas exactas NIT último dígito 6

### Pregunta
Fechas para NIT 901.714.014-6 (último dígito = 6) en 2026.

### Dictamen
Calendario regido por **Decreto 2229 de 2023** (que reglamenta Arts. del E.T. y modifica Decreto 1625/2016 — Decreto Único Tributario), **vigente para 2026 sin sustitución**. Plazos expresados en días hábiles. Detalle por obligación:

### 4.1 Retención en la fuente y autorretención mensual (Forma 350)

**Décimo día hábil del mes siguiente, ordenado por último dígito del NIT.** Tabla 2026 para NIT terminado en **6** (verificada con Actualícese sobre PDF oficial DIAN 2026):

| Mes declarado | Vencimiento NIT 6 |
|---|---|
| Enero 2026 | **17 febrero 2026** |
| Febrero 2026 | **17 marzo 2026** |
| Marzo 2026 | **21 abril 2026** |
| Abril 2026 | **20 mayo 2026** |
| Mayo 2026 | **18 junio 2026** |
| Junio 2026 | **16 julio 2026** |
| Julio 2026 | **20 agosto 2026** |
| Agosto 2026 | **16 septiembre 2026** |
| Septiembre 2026 | **19 octubre 2026** |
| Octubre 2026 | **19 noviembre 2026** |
| Noviembre 2026 | **17 diciembre 2026** |
| Diciembre 2026 | **26 enero 2027** |

### 4.2 IVA bimestral (Forma 300) — NIT 6

Décimo día hábil del mes siguiente al cierre del bimestre, por último dígito del NIT:

| Bimestre | Vencimiento NIT 6 |
|---|---|
| Enero-Febrero 2026 | **17 marzo 2026** |
| Marzo-Abril 2026 | **20 mayo 2026** |
| Mayo-Junio 2026 | **16 julio 2026** |
| Julio-Agosto 2026 | **16 septiembre 2026** |
| Septiembre-Octubre 2026 | **19 noviembre 2026** |
| Noviembre-Diciembre 2026 | **26 enero 2027** |

[AMBIGÜEDAD: algunas fuentes secundarias citan "10 de cada mes par" como aproximación; las fechas exactas anteriores se derivan del PDF oficial DIAN 2026 considerando días hábiles. Operador humano debe confirmar contra PDF oficial antes de poblar UI.]

### 4.3 Declaración de Renta personas jurídicas año gravable 2025 — NIT 6

| Cuota | Vencimiento NIT 6 | Norma |
|---|---|---|
| **Primera cuota (50%)** | **20 mayo 2026** | Art. 1.6.1.13.2.12 DUT (Decreto 1625/2016 modif. por Decreto 2229/2023) |
| **Segunda cuota (saldo)** | **16 julio 2026** | Ídem |

Si el saldo a pagar es inferior a 41 UVT ($2.147.000 en 2026), pago único el día de la primera cuota.

### 4.4 Información Exógena año gravable 2025 — NIT 901.714.014-6

Régimen establecido por **Resolución DIAN 000162 de 2023**, modificada por **Resolución DIAN 000188 de 2024** y consolidada por **Resoluciones 000227 de septiembre 2025 y 000233 de octubre 2025**.

Para **personas jurídicas no grandes contribuyentes**, el plazo se determina por los **DOS últimos dígitos** del NIT (no el último). Para NIT 901.714.014-6:
- DV = 6 (no cuenta)
- Dos últimos dígitos del NIT base = **14** (de 901.714.0**14**)
- Grupo: **11-15**
- Vencimiento: **rango defensivo entre 18 mayo y 22 mayo 2026** (segundo bloque de cinco días hábiles dentro de la ventana 14 mayo - 12 junio 2026).

[AMBIGÜEDAD: el orden de los grupos de dos dígitos en Res. 000188/2024 va de 01-05 (9° día hábil mayo = 14 mayo) hasta 96-00 (9° día hábil junio = 12 junio). El grupo 11-15 cae en el 3° rango de cinco días hábiles. Recomiendo al operador descargar la tabla oficial PDF DIAN y confirmar la fecha exacta de "11-15" antes de codificarla en UI. Para alertas tempranas, usar 18 mayo 2026 como fecha conservadora.]

### Recomendación accionable
- **Backend**: tabla `CALENDARIO_DIAN_2026[ultimoDigito][obligacion]` con las 5 entradas confirmadas (retención mensual x12, IVA bimestral x6, renta cuota 1, renta cuota 2). Exógena requiere `[dosUltimosDigitos][rango]` por grupo.
- **Validator**: cada fecha cargada debe coincidir contra hash del PDF oficial DIAN 2026 (descargar y archivar como evidencia normativa).
- **UI**: tarjeta "Calendario fiscal" muestra próximos 3 vencimientos ordenados por fecha. Alerta amarilla a 7 días, roja a 2 días.

### Fuente
- [Decreto 2229 de 2023 – Función Pública](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=227310)
- [PDF Calendario Tributario 2026 DIAN](https://www.dian.gov.co/Calendarios/Calendario_Tributario_2026.pdf)
- [Actualícese – Plazos retención fuente 2026](https://actualicese.com/plazos-para-declaracion-y-pago-de-retencion-en-la-fuente-2026/)
- [Actualícese – Plazos renta PJ 2026](https://actualicese.com/plazos-para-declaracion-y-pago-de-impuesto-de-renta-personas-juridicas-2026/)
- [Actualícese – Plazos exógena 2026](https://actualicese.com/plazos-para-reportar-informacion-exogena-en-2026/)
- [Resolución 000188 de 2024 DIAN – Normograma](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0188_2024.htm)
- [Comunicado DIAN 128/2025 – Calendario 2026](https://www.dian.gov.co/Prensa/Paginas/NG-Comunicado-de-Prensa-128-2025.aspx)

---

## 5. ICA Bogotá sin CIIU verificado

### Pregunta
¿Es legalmente correcto presentar ICA como "estimación basada en ReteICA practicada" cuando no se ha verificado el CIIU? ¿Qué frase exacta debe aparecer en UI?

### Dictamen
**Sí, es admisible como estimación operativa**, siempre que se etiquete explícitamente como tal y NO se presente como liquidación definitiva. El uso de ReteICA como proxy es práctica contable estándar pero no equivale a determinar la base gravable real, que requiere identificar la actividad económica para aplicar la tarifa correspondiente.

### Fundamento normativo

**Decreto Distrital 352 de 2002 (Estatuto Tributario de Bogotá), Art. 33-34**:
- ICA Bogotá grava ingresos brutos por actividades industriales, comerciales y de servicios.
- Tarifa entre **4.14 ‰ y 11.04 ‰** según actividad económica (CIIU).
- Existen 5 grupos tarifarios + tarifas especiales (financieras, telecomunicaciones, etc.).

**Acuerdo 65 de 2002 y Resolución SDH-000079 de cada año** definen tabla CIIU → tarifa. Sin CIIU verificado, el sistema no puede aplicar tarifa cierta.

**Art. 27 Decreto 352/2002 — ReteICA como mecanismo de anticipo**:
- ReteICA practicada por agentes retenedores es **anticipo** del impuesto, no liquidación definitiva.
- El contribuyente concilia ReteICA contra impuesto liquidado en su declaración bimestral o anual.

### Por qué la estimación es defendible

El uso de ReteICA como aproximación del ICA causado:
- (a) NO sustituye la declaración formal.
- (b) Sirve como **estimación inferior** del impuesto (porque la base de retención es ingreso, no ingreso × tarifa real).
- (c) Es práctica de control interno aceptada por contadores públicos colombianos.

Lo inadmisible sería presentar la estimación como cifra definitiva sin disclaimer — eso sí expone a Art. 647 E.T. por inexactitud si el estado financiero lo certifica como impuesto causado.

### Frase exacta recomendada para UI

> **"ICA estimado (no liquidado)**: $XXX.XXX
> Esta cifra es una **estimación operativa** basada en ReteICA practicada (Cta. 2368) y NO sustituye la liquidación oficial del impuesto bimestral/anual. La liquidación final requiere identificar el código CIIU del contribuyente y aplicar la tarifa correspondiente del Decreto 352 de 2002 (Bogotá). Verifique RUT antes del cierre."

### Recomendación accionable
- **Backend**: si `ciiu === null`, calcular `icaEstimado = saldoCta2368 * factorAjuste(1.0)` y marcar `flag: ESTIMACION_SIN_CIIU`.
- **Validator**: rechazar cualquier campo `icaDefinitivo` sin CIIU. Solo permitir `icaEstimado` con flag visible.
- **UI**: badge amarillo "Estimación" sobre el monto, tooltip con frase completa.
- **Tarea automática**: crear tarea en módulo Defensa DIAN: *"Verificar CIIU en RUT del NIT [X] para precisar ICA Bogotá"*.

### Fuente
- [Decreto 352 de 2002 Bogotá – Régimen Legal](https://www.alcaldiabogota.gov.co/sisjur/normas/Norma1.jsp?i=6705)
- [Acuerdo 65 de 2002 Bogotá – Concejo](https://www.alcaldiabogota.gov.co/sisjur/normas/Norma1.jsp?i=5673)
- [SHD Bogotá – Calendario tributario distrital 2026](https://www.shd.gov.co/shd/calendario-tributario)

---

## 6. ¿La frase obligatoria del bloque es suficiente para defensa Art. 647 E.T.?

### Pregunta
El spec exige siempre incluir: *"Referencia antes de depuraciones fiscales. El impuesto definitivo requiere conciliación formal conforme al Artículo 240 del E.T."* ¿Basta para defensa Art. 647 (sanción por inexactitud)?

### Dictamen
**La frase actual es defensiva pero subóptima.** Cumple el requisito mínimo de "advertir al usuario que F02 no es liquidación", pero deja huecos que un revisor DIAN puede explotar. Recomiendo extenderla a una versión blindada.

### Riesgo residual de la frase actual

1. **No menciona TTD**: si el contribuyente actúa sobre F02 ignorando la depuración del parágrafo 6 Art. 240 y resulta con TTD < 15%, la defensa "yo seguí la herramienta" se debilita porque la herramienta no advirtió.
2. **No menciona depuraciones del Art. 26 E.T.**: la conciliación contable→fiscal incluye diferencias permanentes y temporales que el bloque no explora.
3. **No menciona descuentos** (Arts. 254-260): el contribuyente puede sobreestimar el impuesto causado si no se le advierte que el monto final puede ser menor por descuentos.
4. **Faltan dos elementos clave del Art. 647 E.T.**: el "criterio razonado" y la "doctrina de diferencia de criterio" como defensa preventiva.

### Frase recomendada (versión blindada)

> **"Referencia antes de depuraciones fiscales.**
> El valor mostrado es una proyección bruta calculada como UAI × tarifa nominal (Art. 240 E.T.). **No constituye liquidación oficial del Impuesto de Renta y Complementarios.** El impuesto definitivo requiere:
> - (a) Conciliación contable → fiscal conforme al Art. 26 E.T. (depuraciones permanentes y temporales).
> - (b) Aplicación de descuentos tributarios procedentes (Arts. 254 a 260 E.T.).
> - (c) Verificación de la Tasa de Tributación Depurada del 15% (parágrafo 6 Art. 240 E.T., adicionado por Ley 2277 de 2022).
> - (d) Validación del régimen tarifario aplicable (general, zona franca, ZESE, ZOMAC, hotelero, etc.).
>
> La determinación final del impuesto requiere intervención de contador público y/o revisor fiscal."

### Por qué esta versión protege mejor

- Invoca "diferencia de criterio" implícitamente al listar las depuraciones que el sistema no realiza.
- Crea **trazabilidad documental**: si el contribuyente firma estado financiero ignorando la advertencia, la responsabilidad se desplaza a él.
- Cumple doctrina DIAN de "advertencia razonable" reconocida por jurisprudencia del Consejo de Estado (Sentencia 25000-23-37-000-2015-00367-01 [22845] sobre alcance del Art. 647).

### Recomendación accionable
- **UI**: reemplazar la frase actual por la versión blindada. Mostrar como bloque cerrado al pie del bloque F01-F10, no como tooltip oculto.
- **Backend**: incluir esta cadena como constante `LEGAL_DISCLAIMER_F02` en `src/lib/agents/financial/escudo-survival/legal-strings.ts`.
- **Validator**: regla `bloqueF.disclaimer === LEGAL_DISCLAIMER_F02` obligatoria; rechazar bloque si falta.
- **PDF export**: cuando el bloque se exporte a PDF/HTML, la frase debe aparecer **visible** (no en pie de página minúsculo) — esto es clave para defensa.

### Fuente
- [Art. 647 E.T. – estatuto.co](https://estatuto.co/647)
- [Art. 26 E.T. – estatuto.co](https://estatuto.co/26)
- [Art. 240 E.T. parágrafo 6 – estatuto.co](https://estatuto.co/240)
- [Consejo de Estado Sentencia 22845 sobre Art. 647 – buscar en jurisprudencia.consejodeestado.gov.co]

---

## 7. Alerta A5 — "Impuesto sin provisionar" (UAI > 0 y Clase 54 = 0)

### Pregunta
Cita NIIF + Art. 647 E.T. para fundamentar A5 y redacción exacta en es-CO que cumpla doctrina de "diferencia de criterio" como defensa preventiva.

### Dictamen
**A5 procede con doble fundamento contable y fiscal.** Es la alerta más importante del bloque porque su omisión expone tanto al contribuyente (Art. 647 E.T.) como al contador firmante (Art. 658-1 E.T. — sanción a contador). El caso real (UAI $2.228M con Clase 54 = $0) es exactamente el escenario que la norma quiere prevenir.

### 7.1 Fundamento NIIF para PYMES Sección 29

**Sección 29 (Impuesto a las Ganancias) — IASB Julio 2009 (Anexo Decreto 2420/2015 Colombia)**:

> **29.3** "Una entidad reconocerá las consecuencias fiscales actuales y futuras de transacciones y otros sucesos que se hayan reconocido en los estados financieros."
>
> **29.4** "El impuesto corriente es el impuesto por pagar (recuperable) por las ganancias (o pérdidas) fiscales del periodo corriente o de periodos anteriores. Una entidad reconocerá un pasivo por impuestos corrientes por el impuesto a pagar por las ganancias fiscales del periodo actual y los periodos anteriores."

**Para Grupo Empresarial bajo NIIF Plenas — NIC 12 §80**:
> "El gasto (ingreso) por impuesto corriente y diferido se reconocerá en el resultado del periodo, excepto en la medida en que el impuesto surja de [...] una combinación de negocios o [...] partidas reconocidas fuera del resultado."

**Interpretación operativa**: si la empresa generó ganancia fiscal (UAI > 0), está OBLIGADA a reconocer el pasivo por impuesto corriente. No hacerlo es omisión material que vicia los estados financieros.

### 7.2 Fundamento Art. 647 E.T. (sanción por inexactitud)

**Art. 647 E.T. — Inexactitud en las declaraciones tributarias**:

> "Constituye inexactitud sancionable en las declaraciones tributarias [...]:
> 1. La omisión de ingresos o impuestos generados por las operaciones gravadas, [...]
> [...]
> 5. La utilización en las declaraciones tributarias o en los informes suministrados a la Dirección de Impuestos y Aduanas Nacionales, de datos o factores falsos, desfigurados, alterados, simulados o modificados artificialmente, de los cuales se derive un menor impuesto o saldo a pagar [...].
>
> La sanción por inexactitud será equivalente al ciento por ciento (100%) de la diferencia entre el saldo a pagar o saldo a favor determinado en la liquidación oficial y el declarado por el contribuyente [...]"

**Si la empresa firma estado financiero sin provisión y luego declara renta:**
- Caso A — declara y paga el impuesto correctamente: hay desconexión balance-declaración, observable por DIAN en cruce balance/F110. Sanción potencial Art. 658-3 (contador) y observación material en revisoría.
- Caso B — declara con impuesto $0 igual que el balance: sanción Art. 647 = 100% del impuesto omitido = potencialmente $780M (35% de $2.228M) más intereses.

**Doctrina de "diferencia de criterio"** (Art. 647 par. 2 E.T.):
> "No se configura inexactitud cuando el menor valor a pagar o el mayor saldo a favor que resulte en las declaraciones tributarias se derive de una interpretación razonable en la apreciación o interpretación del derecho aplicable, siempre que los hechos y cifras denunciados sean completos y verdaderos."

UtopIA, al alertar A5 y registrarlo en módulo Defensa DIAN, crea la **trazabilidad** que permite invocar diferencia de criterio: el contribuyente fue advertido, lo que hizo después es decisión informada — no error sistémico.

### 7.3 Redacción exacta de la alerta A5 (es-CO, lista para UI)

> **Alerta crítica — Impuesto de Renta sin provisionar**
>
> Detectamos que su empresa registra Utilidad Antes de Impuestos por **$[UAI_FORMATEADO]** pero el saldo de la Clase 54 (Impuesto de Renta y Complementarios) es **$0**.
>
> **Lo que esto significa**: bajo NIIF para PYMES Sección 29.4 (o NIC 12 §80 para Grupo 1), la empresa está obligada a **reconocer un pasivo por impuesto corriente** equivalente al impuesto causado del período.
>
> **Provisión estimada (referencia)**: $[UAI × 35%] = $[VALOR_FORMATEADO]
>
> **Riesgo si se omite**: firmar estados financieros sin esta provisión expone a:
> - Observación material en revisoría fiscal (NIA 700, opinión modificada).
> - Sanción por inexactitud del **100% del impuesto omitido** (Art. 647 E.T.) si la declaración de renta refleja la omisión.
> - Posible sanción al contador firmante (Art. 658-1 E.T.).
>
> **Acción recomendada**: provisionar el impuesto causado antes del cierre del período, mediante débito a Cta. 5405 (Gasto Impuesto de Renta) y crédito a Cta. 2404 o 2408 (Impuesto de Renta por Pagar), conforme NIIF Sección 29 / NIC 12.
>
> *Esta alerta se registra en su módulo "Defensa DIAN" como evidencia de advertencia preventiva (doctrina de diferencia de criterio, par. 2 Art. 647 E.T.).*

### Recomendación accionable
- **Backend**: disparar A5 cuando `UAI > 0 && saldoClase54 === 0`. Calcular provisión sugerida = `UAI × tarifaSectorial`. Insertar registro en tabla `defensa_dian_tareas` con `tipo: 'PROVISION_IMPUESTO_RENTA'`, `severidad: 'CRITICA'`, `fundamento_normativo: 'NIIF PYMES 29.4 + Art. 647 E.T.'`.
- **Validator**: regla `bloqueA.alertas.includes('A5')` obligatoria si la condición se cumple. Rechazar bloque si la alerta no se generó.
- **UI**: badge rojo persistente, no dismissable hasta que el usuario marque explícitamente "Acepto el riesgo y declino provisionar" (genera log auditable). La alerta debe aparecer en HOME del workspace, no oculta en un sub-panel.
- **PDF/Export**: la alerta A5 debe aparecer en cualquier export del bloque, en página propia con título "ADVERTENCIA NORMATIVA".

### Fuente
- [NIIF para PYMES Sección 29 – PDF IASCF 2009](https://niifsuperfaciles.com/memorias/recursos/NIC/29-NIIF-para-las-PYMES-(Norma)_2009-IMPUESTO%20A%20LAS%20GANANCIAS.pdf)
- [Decreto 2420 de 2015 — Marco Técnico NIIF Colombia](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=66688)
- [Art. 647 E.T. – estatuto.co](https://estatuto.co/647)
- [Art. 658-1 E.T. – estatuto.co](https://estatuto.co/658-1)
- [NIC 12 — IFRS Foundation](https://www.ifrs.org/issued-standards/list-of-standards/ias-12-income-taxes/)

---

## Conclusión — Lista priorizada de cambios para backend/validator/UI

### Prioridad P0 (bloquean release)

1. **Fix F01**: `F01 = UAI`, NO `Ganancia Neta`. Backend cambia campo origen + validator agrega invariante + spec actualiza definición.
2. **Frase legal blindada bloque F02**: reemplazar disclaimer actual por versión §6 de este dictamen. Constante `LEGAL_DISCLAIMER_F02` en backend, validator obligatorio, UI visible.
3. **Alerta A5 con redacción exacta §7**: backend dispara, UI persiste roja no-dismissable, registro en módulo Defensa DIAN.

### Prioridad P1 (recomendado antes de release)

4. **Calendario DIAN 2026 NIT 6**: backend popula tabla con 12 fechas retención + 6 IVA + 2 renta. Validator confirma hash contra PDF DIAN oficial.
5. **Disclaimer tarifa sectorial F02**: UI muestra "tarifa default 35%, verificar excepciones (ZF, ZESE, hidroeléctrica, financiera, hotelero, megainversión)".
6. **ICA con etiqueta "Estimación" + frase §5**: UI badge amarillo, tarea automática "verificar CIIU".

### Prioridad P2 (sprint siguiente)

7. **Exógena por dos últimos dígitos**: backend tabla `[dosUltimosDigitos][rango]`. Para NIT 901.714.014-6 (dígitos "14") usar fecha conservadora 18 mayo 2026; confirmar con PDF DIAN.
8. **TTD en módulo de conciliación fiscal separado**: NO mezclar en F02. Verificar existencia de `computeTTD()` en motor ELITE; si falta, crear endpoint dedicado.

### Trazabilidad para defensa DIAN

Todo cambio debe ir acompañado de:
- Commit con referencia a este dictamen (`wave-8-capa-1-escudo-fiscal-dictamen.md#sección-N`).
- Test fixture con caso real Grupo Empresarial 2 Tres SAS (UAI $2.228.496.789,73, Clase 54 = $0).
- Smoke test E2E que verifique alerta A5 dispara y frase legal aparece en export.

---

## Bibliografía completa (normas y doctrina citadas)

### Estatuto Tributario
- [Art. 26 — Determinación de renta líquida gravable](https://estatuto.co/26)
- [Art. 240 — Tarifa general personas jurídicas + parágrafo 6 TTD](https://estatuto.co/240)
- [Art. 235-2 — Rentas exentas Economía Naranja](https://estatuto.co/235-2)
- [Art. 235-3 — Megainversiones](https://estatuto.co/235-3)
- [Art. 254-260 — Descuentos tributarios](https://estatuto.co/254)
- [Art. 647 — Sanción por inexactitud](https://estatuto.co/647)
- [Art. 658-1 — Sanción al contador](https://estatuto.co/658-1)

### Leyes y decretos
- [Ley 2277 de 2022 — Reforma tributaria vigente](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=199883)
- [Ley 1819 de 2016 — ZOMAC](http://www.secretariasenado.gov.co/senado/basedoc/ley_1819_2016.html)
- [Ley 1955 de 2019 Art. 268 — ZESE](http://www.secretariasenado.gov.co/senado/basedoc/ley_1955_2019.html)
- [Decreto 1625 de 2016 — Decreto Único Tributario](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=77437)
- [Decreto 2229 de 2023 — Plazos tributarios 2024+](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=227310)
- [Decreto 2420 de 2015 — Marco Técnico NIIF Colombia](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=66688)
- [Decreto Distrital 352 de 2002 Bogotá — Estatuto Tributario Bogotá](https://www.alcaldiabogota.gov.co/sisjur/normas/Norma1.jsp?i=6705)

### Resoluciones DIAN
- **Resolución 000238 de 15-12-2025** — UVT 2026 ($52.374)
- [Resolución 000162 de 2023 — Información exógena 2024+](https://www.dian.gov.co/normatividad/Normatividad/Resoluci%C3%B3n%20000162%20de%2031-10-2023.pdf)
- [Resolución 000188 de 2024 — Modif. plazos exógena](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0188_2024.htm)
- Resolución 000227 de septiembre 2025 — Consolidación exógena
- Resolución 000233 de octubre 2025 — Modif. consolidación exógena

### Doctrina DIAN
- [Concepto Unificado 202(006038) — TTD parágrafo 6 Art. 240](https://crconsultorescolombia.com/tasa-minima-de-tributacion-dian-concepto-unificado-202006038.php)
- [Concepto 211 de 2025 — ICA deducible Art. 115](https://accounter.co/dian/el-ica-es-deducible-de-renta-en-los-terminos-del-art-115-et-concepto-dian-211-de-2025.html)
- [Comunicado DIAN 128/2025 — Calendario tributario 2026](https://www.dian.gov.co/Prensa/Paginas/NG-Comunicado-de-Prensa-128-2025.aspx)

### Marco contable internacional
- [NIIF para PYMES Sección 29 — IASCF 2009](https://niifsuperfaciles.com/memorias/recursos/NIC/29-NIIF-para-las-PYMES-(Norma)_2009-IMPUESTO%20A%20LAS%20GANANCIAS.pdf)
- [NIC 12 — Income Taxes / IFRS Foundation](https://www.ifrs.org/issued-standards/list-of-standards/ias-12-income-taxes/)

### Fuentes secundarias verificadas
- [Actualícese — Tarifa general 2026](https://actualicese.com/tarifa-general-del-impuesto-de-renta-2026-para-personas-juridicas/)
- [Actualícese — Plazos renta PJ 2026](https://actualicese.com/plazos-para-declaracion-y-pago-de-impuesto-de-renta-personas-juridicas-2026/)
- [Actualícese — Plazos retención 2026](https://actualicese.com/plazos-para-declaracion-y-pago-de-retencion-en-la-fuente-2026/)
- [Actualícese — Plazos exógena 2026](https://actualicese.com/plazos-para-reportar-informacion-exogena-en-2026/)
- [PDF Calendario Tributario DIAN 2026](https://www.dian.gov.co/Calendarios/Calendario_Tributario_2026.pdf)
- [CR Consultores — Obligados Res. 000188/2024](https://crconsultorescolombia.com/obligados-y-plazos-de-la-resolucion-000188-de-2024-dian-resolucion-000188.php)

---

**Fin del dictamen.**
**Verificación normativa**: 2026-05-26 vía Escudo Tributario CO (UtopIA).
**Próxima revisión obligatoria**: cuando se publique UVT 2027 o reforma tributaria nueva.
