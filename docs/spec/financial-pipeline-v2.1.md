# CORRECCIONES AL PROMPT TÉCNICO — v2.1
## Basado en análisis del informe generado por 1+1 el 13-may-2026
## Agrega estas secciones al PROMPT TÉCNICO v2.0

> Northstar Wave 6. Auditora externa identificó 9 correcciones tras revisar un informe real generado por el pipeline. Cada corrección lleva ejemplo correcto/incorrecto y mapeo a archivos del codebase.

---

## CORRECCIÓN 1 — FORMATO DE ESTADOS FINANCIEROS (Error crítico)

### Regla obligatoria de presentación en tabla

Los estados financieros DEBEN presentarse SIEMPRE en formato de tabla Markdown con
columnas claramente separadas y alineadas. NUNCA como texto corrido con separador "|".

```
❌ INCORRECTO (formato que generó el error):
  11 — Efectivo : $2.413.677.888,64 | $1.563.485.554,01

✅ CORRECTO (formato tabla Markdown):
| Rubro                            |         2025         |         2024         |
|----------------------------------|---------------------:|---------------------:|
| Efectivo y equivalentes          | $2.413.677.888,64    | $1.563.485.554,01    |
| Inventarios                      | $1.670.215.769,29    | $1.150.059.923,99    |
| **TOTAL ACTIVO**                 | **$4.196.558.242,90**| **$2.820.294.796,28**|
```

Reglas adicionales de tabla:
- La columna de rubros va alineada a la izquierda (`:---`)
- Las columnas de cifras van alineadas a la derecha (`---:`)
- Los totales y subtotales van en **negrita**
- La primera fila después del encabezado siempre es la categoría (ej: **ACTIVO**)
- Los rubros con indentación usan 2 espacios antes del nombre: `  Efectivo y equivalentes`

---

## CORRECCIÓN 2 — FLUJO DE EFECTIVO: ASIENTO 3605 NO ES CASH (Error crítico)

### Regla: El cierre contable a 3605 NO existe en el EFE

El traslado de la utilidad a la cuenta 3605 (asiento de cierre) es un movimiento
PURAMENTE CONTABLE. No representa flujo de efectivo bajo ninguna circunstancia.

```
REGLA ABSOLUTA:
El asiento de cierre/traslado a 3605 NO aparece en ninguna actividad
del Estado de Flujos de Efectivo (ni operación, ni inversión, ni financiación).

❌ INCORRECTO — Lo que generó el error:
  ACTIVIDADES DE FINANCIACIÓN:
  Distribución/cancelación resultado acumulado 2024: $1.572.721.472,96
  → Esto INFLA el flujo de operación y crea una salida ficticia de financiación

✅ CORRECTO — Flujo de Efectivo sin el asiento 3605:
  ACTIVIDADES DE OPERACIÓN:
  Resultado neto del ejercicio:                    $2.228.496.789,73
  Ajuste por impuesto corriente activo:             ($2.916.666,00)
  Variación deudores comerciales:                   ($2.998.600,69)
  Variación inventarios:                          ($520.155.845,30)
  Variación proveedores y otros pasivos:           $293.766.657,89
  FLUJO NETO DE OPERACIÓN:                        ≈ $995.769.354,31

  ACTIVIDADES DE INVERSIÓN: $0
  ACTIVIDADES DE FINANCIACIÓN: $0

  Aumento neto en efectivo:                        $850.192.334,63
  Efectivo inicial:                              $1.563.485.554,01
  Efectivo final (= Cta.11):                     $2.413.677.888,64  ✓
```

### Nota sobre variación de proveedores en el EFE:
Calcular la variación REAL de proveedores y otros pasivos operativos como:
  Pasivo total 2025 ($1.968.104.173,17) - Pasivo total 2024 ($1.247.616.043,32)
  = Aumento de $720.488.129,85 → pero con signo POSITIVO en EFE método indirecto
  (aumento de pasivo = fuente de efectivo)

Sin embargo, verificar que el EFE cuadre:
  Flujo operación + Flujo inversión + Flujo financiación = Efectivo final - Efectivo inicial
  = $2.413.677.888,64 - $1.563.485.554,01 = $850.192.334,63

Si el EFE no cuadra, revisar los ajustes de capital de trabajo hasta que cuadre.
NUNCA incluir el asiento 3605 para "hacer cuadrar" el EFE.

---

## CORRECCIÓN 3 — ROE: FÓRMULA CONSISTENTE (Error moderado)

### Usar SIEMPRE patrimonio promedio como denominador del ROE

```
❌ INCORRECTO (dos fórmulas distintas en el mismo informe):
  KPIs:    ROE = Utilidad / Patrimonio CIERRE = 100%
  DuPont:  ROE = Utilidad / Patrimonio PROMEDIO = 117,3%

✅ CORRECTO (una sola fórmula en todo el informe):
  ROE = Utilidad neta / ((Patrimonio inicio + Patrimonio fin) / 2) × 100
  ROE = $2.228.496.789,73 / (($1.572.678.752,96 + $2.228.454.069,73) / 2) × 100
  ROE = $2.228.496.789,73 / $1.900.566.411,35 × 100 = 117,3%

  Esta misma fórmula aplica en:
  - Tabla de KPIs
  - Análisis DuPont
  - Dashboard ejecutivo
  - Proyecciones
```

---

## CORRECCIÓN 4 — IMPUESTO DE RENTA CUANDO NO HAY CLASE 54 (Error moderado)

### Si no existe gasto de renta (Clase 54), deducir la Cta.1805

```
ÁRBOL DE DECISIÓN para impuesto de renta en P&L:

¿Existe Clase 54 en el balance de prueba?
  → SÍ: usar ese valor como (-) Impuesto de renta en P&L
  → NO: ¿Existe Cta.1805 (anticipos/retenciones) en el activo?
         → SÍ: usar ese valor como (-) Impuesto estimado + nota aclaratoria
         → NO: calcular provisión teórica al 35% × Utilidad operativa + nota aclaratoria

FORMATO EN P&L CUANDO SE USA CTA.1805:
  Utilidad antes de impuestos:          $2.228.496.789,73
  (-) Impuesto de renta (Cta.1805 —
      retenciones anticipadas; sin
      Clase 54 en el período):           ($3.839.538,00)   ← nota obligatoria
  Utilidad neta del ejercicio:          $2.224.657.251,73

NOTA OBLIGATORIA en el Estado de Resultados cuando se aplica esta regla:
  "El gasto de impuesto de renta del período corresponde a retenciones y anticipos
   registrados en Cta.1805. No se identificó gasto de impuesto Clase 54 en el
   balance de prueba. La provisión del impuesto corriente al 35% (Art.240 ET)
   requiere conciliación fiscal formal antes del cierre definitivo."
```

---

## CORRECCIÓN 5 — ESTADO DE CAMBIOS EN EL PATRIMONIO: MONTO DEL TRASLADO (Error moderado)

### Usar el saldo de 3605 (de balance), no la utilidad de P&L

```
El ECP debe usar el saldo REAL de la cuenta 3605 del balance,
NO la utilidad del Estado de Resultados (pueden diferir por el tratamiento de 3710).

Cálculo correcto para el ECP:
  Saldo 3605 2024 = Patrimonio total 2024 - Saldo Cta.3710 2024
                  = $1.572.678.752,96 - $42.720,00
                  = $1.572.636.032,96   ← este es el monto a usar en el ECP

  (La utilidad del P&L 2024 es $1.572.721.472,96 — diferente por la naturaleza
   débito/crédito de la Cta.3710 convergencia NIIF)

Formato correcto del ECP:
| Movimiento                          | Capital (3710) | Utilid. Acum. (3605)    | Total Patrim.      |
|-------------------------------------|---------------:|------------------------:|-------------------:|
| Saldo inicial 2024                  | $42.720,00     | $0,00                   | $42.720,00         |
| Traslado utilidad 2024 → 3605 [AJ]  | —              | $1.572.636.032,96       | $1.572.636.032,96  |
| Saldo final 2024                    | $42.720,00     | $1.572.636.032,96       | $1.572.678.752,96  |
| Traslado utilidad 2025 → 3605 [AJ]  | —              | $655.775.316,77         | $655.775.316,77    |
| **Saldo final 2025**                | **$42.720,00** | **$2.228.411.349,73**   | **$2.228.454.069,73** |
```

---

## CORRECCIÓN 6 — NUMERACIÓN SECUENCIAL DE NOTAS (Error moderado)

### Las notas NIIF no pueden tener saltos en la numeración

```
REGLA: Las notas deben numerarse secuencialmente: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11...
       Si una nota no aplica para esta empresa, simplemente no se incluye.
       NUNCA saltar números (ej: pasar de Nota 6 a Nota 8).

ESTRUCTURA MÍNIMA DE NOTAS RECOMENDADA:
  Nota 1:  Entidad y actividad económica
  Nota 2:  Políticas contables significativas
  Nota 3:  Ajuste cuenta 3605 (si se aplicó)
  Nota 4:  Efectivo y equivalentes
  Nota 5:  Deudores comerciales y cartera
  Nota 6:  Inventarios
  Nota 7:  Propiedad, planta y equipo
  Nota 8:  Cuentas por pagar y proveedores
  Nota 9:  Impuestos, gravámenes y tasas
  Nota 10: Patrimonio
  Nota 11: Ingresos operacionales
  Nota 12: Contingencias y hechos posteriores
  (Notas adicionales según aplique: partes vinculadas, arrendamientos, etc.)
```

---

## CORRECCIÓN 7 — NOTAS INTERNAS: NO INCLUIR EN OUTPUT FINAL (Error de presentación)

### Las secciones internas del preparador NUNCA van en el informe al cliente

```
REGLA ABSOLUTA DE OUTPUT:
El informe final entregado al usuario NO debe contener NINGUNA de estas secciones:

❌ ELIMINAR COMPLETAMENTE del output:
  - "Notas internas del preparador"
  - Cualquier sección marcada como "(NO incluir en EEFF firmables)"
  - Advertencias internas de valoración
  - Metadata del sistema de procesamiento interno

✅ Si el sistema necesita documentar limitaciones, incluirlas en:
  - La sección "Limitaciones y Disclaimers" (al final, una sola vez)
  - Las notas NIIF correspondientes (brevemente)
```

---

## CORRECCIÓN 8 — METADATOS INTERNOS: NUNCA EN EL INFORME (Error de presentación)

### Eliminar referencias técnicas internas del output final

```
REGLA: Los siguientes elementos son METADATA INTERNA del sistema.
       NUNCA deben aparecer en el informe final entregado al cliente:

❌ NUNCA incluir en el output:
  - "Pass-1", "Pass-2", "Pass-3" (nombres de etapas internas)
  - "anchors", "curatorFlags", "netIncomePrimary" (variables internas)
  - Cifras expresadas en CENTAVOS (ej: "222849678973 centavos")
    → Usar siempre formato peso colombiano: $2.228.496.789,73
  - Referencias a "totalAssetsPrimary", "ecpClosingTotal" y similares

✅ CORRECTO: Toda cifra se expresa en pesos colombianos con formato $X.XXX.XXX,XX
✅ CORRECTO: Las referencias son a cuentas PUC y rubros NIIF, no a variables internas
```

---

## CORRECCIÓN 9 — NOTAS ART.647 ET: CONSOLIDAR EN UNA SOLA (Error de presentación)

### No repetir la defensa tributaria en cada sección

```
❌ INCORRECTO (lo que hizo el modelo — repitió 6 veces casi idéntico):
  R1 — Nota Maestra Defensa Art.647 ET...
  R5 — Nota Maestra Defensa Art.647 ET...
  R6 — Nota Maestra Defensa Art.647 ET...
  R7 — Nota Maestra Defensa Art.647 ET...
  Regla R3.b — Nota Maestra Defensa Art.647 ET...
  Regla R4 — Nota Maestra Defensa Art.647 ET...

✅ CORRECTO: Una sola nota consolidada al final del informe:

  "NOTA GENERAL — Diferencias de criterio contable (Art.647 E.T.)
   Los ajustes de presentación, reclasificaciones y criterios de aplicación
   del marco técnico NIIF incluidos en este informe corresponden a diferencias
   de criterio contable. Conforme al Art.647 E.T. y el Concepto DIAN
   100208221-1352 de 2018, estas diferencias no constituyen inexactitud
   sancionable cuando los hechos económicos están plenamente documentados.
   Referencia: NIIF for SMEs §2.52; NIC 1 §32; Decreto 2420/2015."

MÁXIMO: Esta nota aparece UNA SOLA VEZ en todo el informe.
```

---

## TABLA RESUMEN DE CORRECCIONES

| # | Error | Tipo | Corrección en 1 línea |
|---|-------|------|----------------------|
| 1 | Cifras inline en lugar de tabla | Crítico | Usar tablas Markdown con columnas alineadas |
| 2 | Asiento 3605 en actividades de financiación del EFE | Crítico | El cierre 3605 es non-cash; NUNCA en el EFE |
| 3 | ROE con dos fórmulas distintas | Crítico | Usar siempre patrimonio promedio como denominador |
| 4 | Utilidad neta = utilidad antes impuestos | Moderado | Deducir Cta.1805 cuando no hay Clase 54 |
| 5 | ECP con monto incorrecto del traslado | Moderado | Usar saldo real de Cta.3605 (= Patrimonio - 3710) |
| 6 | Saltos en numeración de notas (falta 7 y 10) | Moderado | Numeración secuencial sin saltos |
| 7 | Notas internas del preparador en el output | Presentación | Eliminar completamente del informe final |
| 8 | Metadatos internos (Pass-1, centavos) en notas | Presentación | Solo cifras en COP formato estándar |
| 9 | Defensa Art.647 ET repetida 6 veces | Presentación | Consolidar en UNA nota general al final |

---

# PARTE IV: AUDITORÍA ESPECIALIZADA
## 4 Agentes auditores que revisan el informe desde perspectivas distintas

Después de generar las Partes I, II y III, ejecuta los 4 dictámenes siguientes.
Cada auditor revisa el informe con criterios específicos de su disciplina.
Cada dictamen tiene estructura fija: Alcance → Hallazgos → Opinión → Acciones.

---

## DICTAMEN 1 — AUDITOR NIIF

**Rol:** Especialista en NIIF para PYMES (Decreto 2420/2015, Grupo 2)
**Misión:** Evaluar si los estados financieros fueron preparados conforme al marco técnico NIIF aplicable.

### Estructura obligatoria del dictamen

```
═══════════════════════════════════════════════════════════════════
DICTAMEN DEL AUDITOR NIIF
Empresa: [Nombre] · NIT: [NIT] · Período: [Año]
Preparado por: Agente Auditor NIIF — 1+1 Financial Orchestrator
═══════════════════════════════════════════════════════════════════

1. ALCANCE
Revisé los estados financieros de [Empresa] por el período terminado el
[fecha], incluyendo el Estado de Situación Financiera, Estado de Resultados
Integral, Estado de Flujos de Efectivo, Estado de Cambios en el Patrimonio
y las notas correspondientes, preparados bajo NIIF para PYMES (Decreto
2420/2015, Grupo 2).

2. HALLAZGOS POR SECCIÓN NIIF
[Para cada hallazgo usar este formato:]
  [SECCIÓN NIIF] — [Estado: ✅ CONFORME / ⚠ OBSERVACIÓN / ❌ INCUMPLIMIENTO]
  Hallazgo: [descripción técnica]
  Referencia: [Sección X NIIF PYMES / NIC X / párrafo]
  Acción requerida: [qué debe corregir el contador o la empresa]

LISTA MÍNIMA DE VERIFICACIÓN (evaluar TODOS):
  □ Sección 3 — Presentación de EEFF: formato, comparativos, materialidad
  □ Sección 4 — Estado de Situación Financiera: clasificación corriente/no corriente
  □ Sección 5 — Estado de Resultados: presentación de ingresos, costos, gastos
  □ Sección 6 — Estado de Cambios en el Patrimonio: traslados, reservas
  □ Sección 7 — Estado de Flujos de Efectivo: método indirecto, clasificación
  □ Sección 8 — Notas: políticas, juicios, estimaciones significativas
  □ Sección 11 — Instrumentos financieros: cartera, inversiones, proveedores
  □ Sección 13 — Inventarios: costo, VNR, deterioro, corte
  □ Sección 17 — PPE: modelo de costo, depreciación, deterioro
  □ Sección 23 — Ingresos: reconocimiento, devoluciones, corte de ingresos
  □ Sección 28 — Beneficios empleados: cesantías, primas, vacaciones, SS
  □ Sección 29 — Impuesto a las ganancias: corriente, diferido, conciliación
  □ Sección 32 — Hechos posteriores: evaluación hasta fecha de autorización

3. RESUMEN DE HALLAZGOS
  Conformes:        [N] criterios
  Observaciones:    [N] criterios (requieren acción antes del cierre)
  Incumplimientos:  [N] criterios (deben corregirse antes de firmar)

4. OPINIÓN DEL AUDITOR NIIF
  [Seleccionar UNA según hallazgos:]

  ✅ OPINIÓN SIN SALVEDADES
  Los estados financieros presentan razonablemente, en todos los aspectos
  importantes, la situación financiera de [Empresa] al [fecha], conforme
  a NIIF para PYMES (Decreto 2420/2015).

  ⚠ OPINIÓN CON SALVEDADES
  Excepto por los efectos de los asuntos descritos en los hallazgos
  [números], los estados financieros presentan razonablemente...

  ❌ OPINIÓN ADVERSA / ABSTENCIÓN
  [Solo si hay incumplimientos materiales no resueltos]
  Debido a la significatividad de [asunto], los estados financieros
  NO presentan razonablemente... / Me abstengo de emitir opinión porque...

5. ACCIONES REQUERIDAS ANTES DE FIRMAR
  [Lista priorizada con horizonte: Inmediato / Corto plazo / Mediano plazo]
  Referencia normativa: NIIF for SMEs · Decreto 2420/2015
═══════════════════════════════════════════════════════════════════
```

---

## DICTAMEN 2 — AUDITOR TRIBUTARIO

**Rol:** Especialista en impuesto de renta, IVA, retenciones y obligaciones fiscales colombianas
**Misión:** Evaluar la consistencia entre la contabilidad y las obligaciones tributarias, identificar riesgos y cuantificar exposiciones fiscales.

### Estructura obligatoria del dictamen

```
═══════════════════════════════════════════════════════════════════
DICTAMEN DEL AUDITOR TRIBUTARIO
Empresa: [Nombre] · NIT: [NIT] · Período: [Año]
Preparado por: Agente Auditor Tributario — 1+1 Financial Orchestrator
═══════════════════════════════════════════════════════════════════

1. ALCANCE
Revisé los aspectos tributarios del período [Año] con base en los estados
financieros y el balance de prueba suministrado, aplicando el Estatuto
Tributario (E.T.), Ley 2277 de 2022 y disposiciones concordantes.

2. ANÁLISIS DE IMPUESTO DE RENTA (Art. 240 E.T.)
  Tarifa general aplicable:          35% (Ley 2277/2022)
  Utilidad contable antes impuestos: $[valor]
  Provisión teórica 35%:             $[utilidad × 35%]
  Impuesto registrado en libros:     $[valor Cta.1805 o Clase 54]
  Brecha contable-fiscal:            $[diferencia]

  Evaluación:
  [✅ / ⚠ / ❌] El impuesto registrado [es / no es] coherente con la tarifa.
  Acción: [descripción de la conciliación requerida]
  Referencia: Art. 240 E.T.; Ley 2277 de 2022; NIIF PYMES Sec. 29

3. ANÁLISIS DE RETENCIONES Y ANTICIPOS
  Saldo Cta. 1355 (anticipos renta):    $[valor]
  Saldo Cta. 1805 (retenciones):        $[valor]
  Saldo Cta. 24 (pasivo tributario):    $[valor]
  Posición fiscal neta estimada:        $[activo - pasivo]

  Evaluación: [descripción y riesgo]
  Referencia: Art. 850 E.T.; Decreto 2460/2013

4. ANÁLISIS IVA E ICA
  Pasivo IVA neto registrado:           $[valor PUC 2408/2367]
  Régimen IVA inferido:                 [Responsable/No responsable]
  ICA: evaluar si el municipio de domicilio genera obligación
  Referencia: Art. 420 y ss. E.T.; Ley 14/1983

5. ANÁLISIS TASA MÍNIMA DE TRIBUTACIÓN (Ley 2277/2022)
  Tasa mínima efectiva exigida: 15% sobre utilidad depurada
  Verificación:
    Impuesto registrado / Utilidad contable = [tasa efectiva]%
    [✅ ≥ 15% / ⚠ < 15% — revisar depuraciones fiscales antes de declarar]
  Referencia: Art. 240-1 E.T.; Ley 2277 de 2022

6. RIESGOS TRIBUTARIOS IDENTIFICADOS
  [Para cada riesgo:]
  Riesgo [N]: [descripción]
  Probabilidad: [Alta / Media / Baja]
  Exposición estimada: $[valor] o N/D si no cuantificable
  Referencia: [artículo ET / norma]

7. CALENDARIO DE OBLIGACIONES TRIBUTARIAS 2026
  [Basado en último dígito NIT]
  Renta persona jurídica 2025:   [fecha límite presentación y pago]
  IVA bimestral/cuatrimestral:  [próximos vencimientos]
  ICA municipal:                 [fecha según municipio domicilio]
  Retenciones mensuales:         [próximo vencimiento]
  GMF (4×1000):                 [aplica/no aplica]
  Referencia: Resolución DIAN calendario tributario vigente

8. OPINIÓN DEL AUDITOR TRIBUTARIO
  [Seleccionar UNA:]
  ✅ SIN HALLAZGOS RELEVANTES
  ⚠ CON OBSERVACIONES (cuantificar exposición total: $[suma riesgos])
  ❌ CON HALLAZGOS CRÍTICOS (riesgo de sanción Art. 647 E.T. o similar)

9. ACCIONES REQUERIDAS
  [Lista con prioridad y artículo de referencia]
═══════════════════════════════════════════════════════════════════
```

---

## DICTAMEN 3 — AUDITOR LEGAL

**Rol:** Especialista en derecho societario colombiano, gobierno corporativo y obligaciones legales
**Misión:** Evaluar el cumplimiento de las obligaciones societarias de la SAS, la validez de los documentos corporativos y los riesgos legales identificados.

### Estructura obligatoria del dictamen

```
═══════════════════════════════════════════════════════════════════
DICTAMEN DEL AUDITOR LEGAL
Empresa: [Nombre] · NIT: [NIT] · Tipo: SAS · Período: [Año]
Preparado por: Agente Auditor Legal — 1+1 Financial Orchestrator
═══════════════════════════════════════════════════════════════════

1. ALCANCE
Revisé los aspectos societarios y legales de [Empresa], SAS, con NIT
[NIT], correspondientes al período [Año], aplicando la Ley 1258 de 2008,
el Código de Comercio y la Ley 222 de 1995.

2. VERIFICACIÓN DE OBLIGACIONES SOCIETARIAS
Evaluar cada ítem con [✅ CUMPLIDO / ⚠ PARCIAL / ❌ INCUMPLIDO / — N/D]:

  [✅/⚠/❌] Convocatoria Asamblea (Art. 424 C.Co.): modalidad y antelación
  [✅/⚠/❌] Quórum verificado (estatutos sociales)
  [✅/⚠/❌] Orden del día presentado y aprobado
  [✅/⚠/❌] EEFF presentados y aprobados (Ley 222/1995 Art. 187 num. 3)
  [✅/⚠/❌] Informe de gestión Representante Legal (Arts. 46-47 Ley 222/1995)
  [✅/⚠/❌] Destinación de utilidades decidida (C.Co. Art. 451-455)
  [✅/⚠/❌] Reserva legal: SAS solo si estatutos la exigen
              (Ley 1258/2008 Art. 45; Supersociedades Of. 220-115333/2009)
  [✅/⚠/❌] Libro de actas actualizado (C.Co. Art. 28)
  [✅/⚠/❌] Libro de accionistas actualizado (C.Co. Art. 422)
  [✅/⚠/❌] Matrícula mercantil renovada (C.Co. Art. 33)
  [✅/⚠/❌] Revisor Fiscal identificado con T.P. vigente (si aplica)
  [✅/⚠/❌] Representante Legal registrado en Cámara de Comercio
  [✅/⚠/❌] Beneficiario Final reportado a UIAF (Ley 2195/2022)
  [✅/⚠/❌] RUT actualizado con actividad CIIU correcta

3. ANÁLISIS DE PATRIMONIO Y DISTRIBUCIÓN DE UTILIDADES
  Utilidad neta del período:           $[valor]
  Reserva legal obligatoria:           [SÍ / NO — según estatutos]
  Si SÍ: monto reserva (10%):          $[valor]
  Utilidad disponible para distribución: $[valor - reserva]
  Tipo de dividendo posible:           [ordinario / preferencial]
  Impuesto a dividendos:               [aplica Art. 242 E.T. si > 0%]

4. ANÁLISIS DE CAPITALIZACIÓN DE UTILIDADES
  Si la Asamblea propone capitalizar utilidades:
  Base legal: Ley 1258/2008 Art. 5 (reforma estatutaria SAS)
  Documento requerido: documento privado inscrito en Cámara de Comercio
  Beneficio fiscal: Art. 36-3 E.T. — exento impuesto a dividendos
  Procedimiento: [pasos para formalizar]

5. RIESGOS LEGALES IDENTIFICADOS
  [Para cada riesgo:]
  Riesgo [N]: [descripción]
  Norma aplicable: [ley/artículo]
  Consecuencia potencial: [multa / sanción Supersociedades / nulidad acto]
  Probabilidad: [Alta / Media / Baja]

6. OPINIÓN DEL AUDITOR LEGAL
  ✅ SIN OBSERVACIONES RELEVANTES
  ⚠ CON OBSERVACIONES SUBSANABLES (listar con plazo)
  ❌ CON HALLAZGOS QUE REQUIEREN ACCIÓN INMEDIATA

7. ACCIONES REQUERIDAS
  [Lista priorizada con referencia normativa y plazo]
═══════════════════════════════════════════════════════════════════
```

---

## DICTAMEN 4 — AUDITOR FISCAL

**Rol:** Especialista en obligaciones ante la DIAN, municipios (ICA) y otras entidades de control fiscal
**Misión:** Evaluar el cumplimiento de declaraciones, pagos, obligaciones de información y riesgos de fiscalización.

### Estructura obligatoria del dictamen

```
═══════════════════════════════════════════════════════════════════
DICTAMEN DEL AUDITOR FISCAL
Empresa: [Nombre] · NIT: [NIT] · Período: [Año]
Preparado por: Agente Auditor Fiscal — 1+1 Financial Orchestrator
═══════════════════════════════════════════════════════════════════

1. ALCANCE
Revisé el cumplimiento de las obligaciones formales y sustanciales ante
la DIAN y entidades territoriales para el período [Año] y las
obligaciones pendientes para [Año+1].

2. ESTADO DE OBLIGACIONES FORMALES
  [Para cada obligación:]
  Obligación: [nombre]
  Periodicidad: [mensual/bimestral/anual]
  Vencimiento próximo: [fecha según calendario DIAN NIT]
  Estado inferido: [✅ Al día / ⚠ Verificar / ❌ Posible mora]
  Referencia: [artículo E.T. / resolución DIAN]

  OBLIGACIONES A VERIFICAR:
  □ Declaración renta y complementarios (Art. 240 E.T.)
  □ Retenciones en la fuente mensuales (Art. 375 E.T.)
  □ IVA bimestral o cuatrimestral (Art. 600 E.T.)
  □ ICA municipal (si domicilio determina obligación)
  □ Industria y comercio Bogotá (si aplica: Decreto 807/1993)
  □ Información exógena (Art. 631 E.T.) — medios magnéticos DIAN
  □ GMF — Gravamen movimientos financieros (Art. 871 E.T.)
  □ Autorretenciones CREE/renta si aplica (Decreto 2201/2016)
  □ Nómina electrónica / factura electrónica (Res. DIAN 000165/2023)
  □ Reporte SAGRILAFT / SIPLAFT (si aplica: Circular Básica Jurídica)

3. ANÁLISIS DE SALDOS FISCALES CRÍTICOS
  Retenciones practicadas a terceros (Cta.2365+):  $[valor]
  Retenciones que nos practicaron (Cta.1355):       $[valor]
  IVA por pagar neto (Cta.2408 - Cta.2367):        $[valor]
  Anticipo renta siguiente período (Art. 807 E.T.): $[calcular: 75% × impuesto año]
  Sanción potencial por mora (Art. 641 E.T.):       $[si hay saldos vencidos]

4. RIESGO DE FISCALIZACIÓN (Indicadores DIAN)
  Evaluar los siguientes indicadores de riesgo que activan auditorías DIAN:

  [✅ BAJO / ⚠ MEDIO / ❌ ALTO] Margen neto > 70% del sector CIIU
  [✅ BAJO / ⚠ MEDIO / ❌ ALTO] Costo de ventas < 1% de ingresos
  [✅ BAJO / ⚠ MEDIO / ❌ ALTO] Brecha impuesto contable vs tasa nominal
  [✅ BAJO / ⚠ MEDIO / ❌ ALTO] Variación ingresos > 40% interanual
  [✅ BAJO / ⚠ MEDIO / ❌ ALTO] Proveedores > 90% del pasivo total
  [✅ BAJO / ⚠ MEDIO / ❌ ALTO] Efectivo > 50% del activo total

  Nivel de riesgo global de fiscalización: [BAJO / MEDIO / ALTO]
  Recomendación: [acción preventiva según nivel]

5. CÁLCULO DE OBLIGACIONES FISCALES 2026
  Anticipo renta 2026 (75% del impuesto causado 2025):
    Impuesto causado 2025 estimado: $[valor]
    Anticipo a pagar 2026:          $[valor × 75%]
    Referencia: Art. 807 E.T.

  ICA estimado 2026:
    Base: ingresos brutos por actividad
    Tarifa municipal [ciudad domicilio]: [X por mil]
    ICA estimado: $[cálculo]

6. OPINIÓN DEL AUDITOR FISCAL
  ✅ RIESGO FISCAL BAJO — cumplimiento adecuado identificado
  ⚠ RIESGO FISCAL MEDIO — observaciones que deben atenderse
  ❌ RIESGO FISCAL ALTO — exposición significativa ante DIAN

7. ACCIONES REQUERIDAS
  [Lista priorizada con artículo, fecha límite y consecuencia del incumplimiento]
═══════════════════════════════════════════════════════════════════
```

---

# PARTE V: META-AUDITORÍA DE CALIDAD
## 12 Dimensiones · ISO 25012 · ISO 42001 · IASB · Nota de Calidad Global

La Meta-auditoría evalúa la CALIDAD DEL INFORME MISMO (no de la empresa).
Es el "control de calidad del producto 1+1" antes de entregarlo al cliente.
Se ejecuta DESPUÉS de las Partes I, II, III y IV.

### Estructura obligatoria

```
╔═══════════════════════════════════════════════════════════════════╗
║         META-AUDITORÍA DE CALIDAD — 1+1 Financial Orchestrator    ║
║         Informe: [Empresa] · NIT: [NIT] · Período: [Año]          ║
╚═══════════════════════════════════════════════════════════════════╝

EVALUACIÓN EN 12 DIMENSIONES
Escala: ✅ APROBADO (≥80%) · ⚠ EN REVISIÓN (60-79%) · ❌ REQUIERE CORRECCIÓN (<60%)
Cada dimensión se califica de 0 a 10. Score global = promedio de las 12.

┌────────────────────────────────────────────────────────────────────┐
│ BLOQUE A — ISO 25012: CALIDAD DE DATOS FINANCIEROS                │
│ (Norma internacional de calidad de datos — ISO/IEC 25012:2008)    │
└────────────────────────────────────────────────────────────────────┘

DIM 1 · EXACTITUD (Accuracy)
  Definición: Las cifras del informe coinciden con los auxiliares del balance de prueba.
  Verificación: ¿Todos los totales cuadran? ¿Activo = Pasivo + Patrimonio?
  Puntos detectados: [hallazgos de exactitud]
  Score: [0-10]  Estado: [✅/⚠/❌]

DIM 2 · COMPLETITUD (Completeness)
  Definición: El informe contiene todos los estados, notas y secciones requeridas por NIIF.
  Verificación: ¿Están los 4 estados financieros? ¿Hay mínimo 10 notas? ¿Hay ECP?
  Puntos detectados: [elementos faltantes o incompletos]
  Score: [0-10]  Estado: [✅/⚠/❌]

DIM 3 · CONSISTENCIA (Consistency)
  Definición: La misma cifra no aparece con valores distintos en diferentes secciones.
  Verificación: ¿La utilidad neta en P&L = utilidad en ECP = utilidad en EFE?
                ¿El efectivo final en EFE = Cta.11 en el balance?
                ¿El ROE usa el mismo denominador en KPIs y DuPont?
  Puntos detectados: [inconsistencias encontradas]
  Score: [0-10]  Estado: [✅/⚠/❌]

DIM 4 · ACTUALIDAD (Currentness)
  Definición: Las cifras corresponden al período informado; no se mezclan períodos.
  Verificación: ¿Las cifras 2025 son del período correcto?
                ¿El comparativo 2024 usa el saldo inicial del balance?
  Puntos detectados: [observaciones de período]
  Score: [0-10]  Estado: [✅/⚠/❌]

┌────────────────────────────────────────────────────────────────────┐
│ BLOQUE B — ISO 42001: GESTIÓN DE SISTEMAS DE INTELIGENCIA ARTIFICIAL│
│ (Norma de gestión de IA — ISO/IEC 42001:2023)                     │
└────────────────────────────────────────────────────────────────────┘

DIM 5 · TRAZABILIDAD DEL PROCESO IA (Traceability)
  Definición: El informe documenta el origen de cada cifra y el método de cálculo.
  Verificación: ¿Las notas indican si una cifra viene del balance auxiliar,
                de un cálculo del sistema o de una estimación?
  Puntos detectados: [referencias faltantes a origen de datos]
  Score: [0-10]  Estado: [✅/⚠/❌]

DIM 6 · TRANSPARENCIA DE LIMITACIONES (Transparency)
  Definición: El informe revela claramente qué datos no estaban disponibles
              y qué supuestos tomó el sistema.
  Verificación: ¿Están los disclaimers sobre datos no suministrados?
                ¿Se advirtió sobre el costo de ventas anómalo?
                ¿Se notificó el ajuste automático de la cuenta 3605?
  Puntos detectados: [limitaciones no documentadas]
  Score: [0-10]  Estado: [✅/⚠/❌]

DIM 7 · SESGO Y NEUTRALIDAD (Bias & Fairness)
  Definición: El análisis no favorece artificialmente métricas positivas
              ni oculta alertas relevantes.
  Verificación: ¿Se reportaron las anomalías aunque sean desfavorables?
                ¿Los KPIs con base de costos anómala están marcados como N/C?
                ¿El dictamen del revisor fiscal incluye asuntos negativos si existen?
  Puntos detectados: [posibles sesgos de presentación]
  Score: [0-10]  Estado: [✅/⚠/❌]

DIM 8 · RESPONSABILIDAD HUMANA (Human Oversight)
  Definición: El informe deja claro que requiere validación profesional humana
              antes de ser usado para fines legales, fiscales o de inversión.
  Verificación: ¿Hay nota legal de validación profesional?
                ¿Los dictámenes indican que son preliminares hasta firma del contador?
                ¿El acta de asamblea indica los campos pendientes de datos reales?
  Puntos detectados: [avisos de responsabilidad faltantes]
  Score: [0-10]  Estado: [✅/⚠/❌]

┌────────────────────────────────────────────────────────────────────┐
│ BLOQUE C — IASB: ESTÁNDARES DE CALIDAD DE INFORMES FINANCIEROS    │
│ (Marco conceptual IASB 2018 — Características cualitativas)       │
└────────────────────────────────────────────────────────────────────┘

DIM 9 · RELEVANCIA (Relevance)
  Definición: La información presentada es útil para la toma de decisiones
              de los usuarios del informe (socios, bancos, DIAN).
  Verificación: ¿El dashboard ejecutivo responde las preguntas clave del negocio?
                ¿Las recomendaciones son accionables y priorizadas?
                ¿Las proyecciones usan supuestos realistas documentados?
  Puntos detectados: [información relevante faltante o poco útil]
  Score: [0-10]  Estado: [✅/⚠/❌]

DIM 10 · REPRESENTACIÓN FIEL (Faithful Representation)
  Definición: Los estados financieros representan fielmente los hechos económicos
              sin distorsión, error ni sesgo material.
  Verificación: ¿Las cifras del informe corresponden a la realidad económica?
                ¿Se advirtió cuando las cifras pueden estar distorsionadas?
                ¿El EFE excluye correctamente asientos no-cash?
  Puntos detectados: [distorsiones o representaciones incorrectas]
  Score: [0-10]  Estado: [✅/⚠/❌]

DIM 11 · COMPRENSIBILIDAD (Understandability)
  Definición: Un usuario con conocimientos contables razonables puede
              entender el informe sin ambigüedades.
  Verificación: ¿Las cifras están en formato $X.XXX.XXX,XX (no en centavos)?
                ¿Las notas usan lenguaje claro sin jerga interna del sistema?
                ¿Las tablas están bien alineadas con columnas separadas?
                ¿Los estados financieros usan formato tabla, no texto corrido?
  Puntos detectados: [problemas de comprensibilidad]
  Score: [0-10]  Estado: [✅/⚠/❌]

DIM 12 · COMPARABILIDAD (Comparability)
  Definición: El informe permite comparar períodos y hacer benchmarking.
  Verificación: ¿Todos los estados incluyen el año comparativo 2024?
                ¿Los KPIs muestran variación % interanual?
                ¿Las proyecciones tienen escenario base, conservador y agresivo?
                ¿Los benchmarks sectoriales están referenciados o marcados como N/D?
  Puntos detectados: [limitaciones de comparabilidad]
  Score: [0-10]  Estado: [✅/⚠/❌]

┌────────────────────────────────────────────────────────────────────┐
│ TABLA RESUMEN META-AUDITORÍA                                       │
└────────────────────────────────────────────────────────────────────┘

| Dim | Nombre              | Norma      | Score | Estado |
|-----|---------------------|------------|-------|--------|
| 1   | Exactitud           | ISO 25012  | [X]/10| [✅/⚠/❌] |
| 2   | Completitud         | ISO 25012  | [X]/10| [✅/⚠/❌] |
| 3   | Consistencia        | ISO 25012  | [X]/10| [✅/⚠/❌] |
| 4   | Actualidad          | ISO 25012  | [X]/10| [✅/⚠/❌] |
| 5   | Trazabilidad IA     | ISO 42001  | [X]/10| [✅/⚠/❌] |
| 6   | Transparencia       | ISO 42001  | [X]/10| [✅/⚠/❌] |
| 7   | Sesgo y neutralidad | ISO 42001  | [X]/10| [✅/⚠/❌] |
| 8   | Supervisión humana  | ISO 42001  | [X]/10| [✅/⚠/❌] |
| 9   | Relevancia          | IASB 2018  | [X]/10| [✅/⚠/❌] |
| 10  | Representación fiel | IASB 2018  | [X]/10| [✅/⚠/❌] |
| 11  | Comprensibilidad    | IASB 2018  | [X]/10| [✅/⚠/❌] |
| 12  | Comparabilidad      | IASB 2018  | [X]/10| [✅/⚠/❌] |
|     | **SCORE GLOBAL**    | **Promedio**| **[X]/10** | **[✅/⚠/❌]** |

┌────────────────────────────────────────────────────────────────────┐
│ SELLO DE CALIDAD DEL INFORME                                       │
└────────────────────────────────────────────────────────────────────┘

[Si Score ≥ 8.0]
╔══════════════════════════════════════╗
║  ✅  CALIDAD CERTIFICADA 1+1         ║
║  Score: [X]/10 · [N] aprobadas       ║
║  Listo para revisión del contador    ║
╚══════════════════════════════════════╝

[Si Score 6.0-7.9]
╔══════════════════════════════════════╗
║  ⚠   CALIDAD CON OBSERVACIONES      ║
║  Score: [X]/10 · [N] en revisión    ║
║  Resolver observaciones antes de firmar ║
╚══════════════════════════════════════╝

[Si Score < 6.0]
╔══════════════════════════════════════╗
║  ❌  REQUIERE CORRECCIÓN             ║
║  Score: [X]/10 · [N] con fallas     ║
║  No apto para uso oficial            ║
╚══════════════════════════════════════╝

ACCIONES CORRECTIVAS PRIORIZADAS (Solo las dimensiones con score < 7):
  [DIM X — Nombre]: [acción concreta para mejorar el score]
  Impacto estimado en score: [+X puntos]
```

---

## REGLAS DE INTEGRACIÓN AL FLUJO DEL INFORME

```
ORDEN DE EJECUCIÓN OBLIGATORIO:

1. PARTE I   — Estados Financieros NIIF (con ajuste 3605 si aplica)
2. PARTE II  — Análisis Estratégico y Proyecciones
3. PARTE III — Gobierno Corporativo y Notas
4. PARTE IV  — Auditoría Especializada (4 dictámenes, en este orden):
               4a. Dictamen Auditor NIIF
               4b. Dictamen Auditor Tributario
               4c. Dictamen Auditor Legal
               4d. Dictamen Auditor Fiscal
5. PARTE V   — Meta-auditoría de Calidad (evalúa todo lo anterior)

REGLAS DE COMPORTAMIENTO:
- Cada dictamen usa los datos ya calculados en las Partes I-III.
  NO recalcular cifras; referenciarlas.
- Si un dato no estaba disponible en el balance: indicar "— Dato no
  suministrado" y anotar qué documento se necesita para completarlo.
- Los dictámenes NO incluyen lenguaje interno del sistema (Pass-1,
  anchors, centavos, curatorFlags).
- Las opiniones de los 4 auditores pueden ser distintas entre sí.
  Eso es correcto: cada auditor evalúa desde su perspectiva.
- La Meta-auditoría evalúa el informe completo incluyendo los 4 dictámenes.
  Si los dictámenes tienen errores de forma, afectan el score de DIM 11.
- El SELLO DE CALIDAD es el último elemento del informe. Va al final
  de todo, después de la Meta-auditoría.
```

---

## TABLA DE REFERENCIA RÁPIDA — NORMAS POR AUDITOR

| Auditor | Normas principales | Entidad emisora |
|---------|-------------------|-----------------|
| NIIF | NIIF para PYMES Secciones 3-33; NIC 1, 2, 7, 12 | IASB / Decreto 2420/2015 |
| Tributario | Arts. 240, 242, 375, 600, 807, 850 E.T.; Ley 2277/2022 | DIAN / Congreso |
| Legal | Ley 1258/2008; C.Co. Arts. 187, 422, 424, 451; Ley 222/1995 | Supersociedades / CCB |
| Fiscal | Arts. 631, 641, 647, 871 E.T.; Res. DIAN 000165/2023 | DIAN / Entidades territoriales |
| Meta-auditoría | ISO 25012:2008; ISO 42001:2023; Marco Conceptual IASB 2018 | ISO / IASB |

---

## MAPEO 14 → 12 DIMENSIONES (subvista v2.1 sobre `QualityAssessment` interno)

El esquema interno `QualityAssessment` mantiene 14 dimensiones D1..D14 (contrato del runtime).
La subvista v2.1 expone 12 dimensiones agrupadas en bloques A/B/C, derivadas determinísticamente:

| v2.1 # | Bloque | Nombre v2.1 | Fuente interna (D1..D14) |
|--------|--------|-------------|--------------------------|
| 1 | A · ISO 25012 | Exactitud (Accuracy) | D2 (Exactitud aritmética) |
| 2 | A · ISO 25012 | Completitud (Completeness) | D1 (Completitud) |
| 3 | A · ISO 25012 | Consistencia (Consistency) | D3 (Consistencia interna) |
| 4 | A · ISO 25012 | Actualidad (Currentness) | D14 (Cobertura multiperiodo) |
| 5 | B · ISO 42001 | Trazabilidad IA (Traceability) | D8 (Trazabilidad) |
| 6 | B · ISO 42001 | Transparencia (Transparency) | promedio(D9 Anti-alucinación, D6 Análisis estratégico)* |
| 7 | B · ISO 42001 | Sesgo y neutralidad (Bias & Fairness) | D9 (Anti-alucinación) |
| 8 | B · ISO 42001 | Responsabilidad humana (Human Oversight) | D10 (Supervisión humana) |
| 9 | C · IASB 2018 | Relevancia (Relevance) | D6 (Calidad análisis estratégico) |
| 10 | C · IASB 2018 | Representación fiel (Faithful Representation) | D4 (Presentación NIIF) |
| 11 | C · IASB 2018 | Comprensibilidad (Understandability) | D11 (Formato y exportabilidad) |
| 12 | C · IASB 2018 | Comparabilidad (Comparability) | D14 (Cobertura multiperiodo) + D12 (IFRS 18) |

\* "Transparencia" es D9 dominante con D6 como ponderación secundaria (90/10) porque la transparencia del informe se evalúa principalmente como ausencia de alucinaciones + divulgación de supuestos del análisis.

**Escala de score:** las dimensiones internas D1..D14 puntúan 0-100; la subvista v2.1 las normaliza a 0-10 (`scoreV21 = Math.round(scoreInterno / 10)`).

**Score global v2.1:** promedio aritmético de los 12 scores v2.1 (NO el `overallScore` interno ponderado de 14 dimensiones).

**Estado por umbral:** `✅` si scoreV21 ≥ 8, `⚠` si 6 ≤ scoreV21 < 8, `❌` si < 6.

**Sello de calidad:** se deriva del score global v2.1 con los umbrales 8.0 / 6.0 fijados en la spec; el `grade` interno (A+..F) sigue derivándose del `overallScore` interno por separado y NO afecta el sello.

---

*Versión 2.1 — Correcciones Wave 6 (correcciones auditora externa) + Wave 7 (Parte IV + Parte V)*

