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

*Versión 2.1 — Correcciones basadas en análisis del output real del 13-may-2026*
