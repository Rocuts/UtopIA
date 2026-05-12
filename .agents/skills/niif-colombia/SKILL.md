---
name: niif-estados-financieros
description: >
  Usa esta skill para generar, estructurar o completar estados financieros bajo NIIF desde cero o
  a partir de datos parciales del usuario. Actívala cuando el usuario diga: "necesito preparar los
  estados financieros", "ayúdame a armar el balance", "crea un estado de resultados", "necesito el
  flujo de efectivo", "completa las notas", "genera el estado de cambios en el patrimonio",
  "dame una plantilla de estados financieros NIIF", "prepara los EEFF de mi empresa", o cuando
  el usuario comparta un listado de cuentas, un balance de comprobación o datos contables y pida
  convertirlos en estados financieros formales. También úsala para generar ejemplos ilustrativos
  de estados financieros NIIF para empresas de cualquier sector o tamaño.
---

# Skill: Generación de Estados Financieros bajo NIIF

## Proceso de trabajo

Cuando el usuario pida generar estados financieros:

1. **Determina el alcance**: ¿Qué estados necesita? ¿Individuales o consolidados?
2. **Determina el grupo NIIF**: Grupo 1 (NIIF plenas), Grupo 2 (NIIF PYMES), Grupo 3
3. **Recopila los datos**: Balance de comprobación, cuentas contables, o información descriptiva
4. **Genera los estados** siguiendo las estructuras definidas abajo
5. **Incluye notas mínimas** si el usuario lo requiere

---

## Estructuras Estándar de Estados Financieros

### Estado de Situación Financiera (Balance General)

```
EMPRESA XYZ S.A.S.
Estado de Situación Financiera
Al 31 de diciembre de 20XX
(Cifras en millones de pesos colombianos)

ACTIVOS
  Activos corrientes
    Efectivo y equivalentes de efectivo          $XXX
    Cuentas por cobrar comerciales, neto         $XXX
    Otras cuentas por cobrar                     $XXX
    Inventarios                                  $XXX
    Activos por impuestos corrientes             $XXX
    Otros activos corrientes                     $XXX
  Total activos corrientes                       $XXX

  Activos no corrientes
    Propiedad, planta y equipo, neto             $XXX
    Activos por derecho de uso (NIIF 16)         $XXX
    Activos intangibles, neto                    $XXX
    Plusvalía (Goodwill)                         $XXX
    Activos por impuesto diferido                $XXX
    Inversiones en asociadas                     $XXX
    Otros activos no corrientes                  $XXX
  Total activos no corrientes                    $XXX

TOTAL ACTIVOS                                    $XXX

PASIVOS Y PATRIMONIO
  Pasivos corrientes
    Cuentas por pagar comerciales                $XXX
    Obligaciones financieras corto plazo         $XXX
    Pasivos por arrendamiento corriente          $XXX
    Pasivos por impuestos corrientes             $XXX
    Otras cuentas por pagar                      $XXX
    Provisiones corrientes                       $XXX
  Total pasivos corrientes                       $XXX

  Pasivos no corrientes
    Obligaciones financieras largo plazo         $XXX
    Pasivos por arrendamiento no corriente       $XXX
    Pasivo por impuesto diferido                 $XXX
    Provisiones no corrientes                    $XXX
    Beneficios a empleados largo plazo           $XXX
  Total pasivos no corrientes                    $XXX

TOTAL PASIVOS                                    $XXX

  Patrimonio
    Capital suscrito y pagado                    $XXX
    Prima en colocación de acciones              $XXX
    Reserva legal                                $XXX
    Otras reservas                               $XXX
    Superávit por revaluación (ORI acumulado)    $XXX
    Resultados del ejercicio                     $XXX
    Resultados acumulados                        $XXX
  Total patrimonio                               $XXX

TOTAL PASIVOS Y PATRIMONIO                       $XXX
```

---

### Estado de Resultados Integrales

```
EMPRESA XYZ S.A.S.
Estado de Resultados Integrales
Por el año terminado el 31 de diciembre de 20XX
(Cifras en millones de pesos colombianos)

Ingresos de actividades ordinarias              $XXX
Costo de ventas                                ($XXX)
UTILIDAD BRUTA                                  $XXX

Gastos de ventas y distribución                ($XXX)
Gastos de administración                       ($XXX)
Otros ingresos operacionales                    $XXX
Otros gastos operacionales                     ($XXX)
UTILIDAD OPERATIVA (EBIT)                       $XXX

Ingresos financieros                            $XXX
Gastos financieros                             ($XXX)
Diferencia en cambio, neta                      $XXX
UTILIDAD ANTES DE IMPUESTOS                     $XXX

Impuesto a las ganancias corriente             ($XXX)
Impuesto a las ganancias diferido              ($XXX)
UTILIDAD NETA DEL PERÍODO                       $XXX

Otro resultado integral (ORI):
  Superávit por revaluación de activos          $XXX
  Remedición de planes de beneficio definido    $XXX
  Efectos de conversión de moneda extranjera    $XXX
TOTAL OTRO RESULTADO INTEGRAL                   $XXX

RESULTADO INTEGRAL TOTAL DEL PERÍODO            $XXX
```

---

### Estado de Cambios en el Patrimonio

```
EMPRESA XYZ S.A.S.
Estado de Cambios en el Patrimonio
Por el año terminado el 31 de diciembre de 20XX
(Cifras en millones de pesos colombianos)

                         Capital  Prima  Reservas  ORI  Utilidades  TOTAL
                                                       Acumuladas
Saldo al 1 enero 20X0   $XXX    $XXX    $XXX    $XXX    $XXX      $XXX
Resultado del período      -       -       -       -     $XXX      $XXX
Otro resultado integral    -       -       -    $XXX       -       $XXX
Apropiación a reservas     -       -    $XXX     -      ($XXX)      -
Distribución dividendos    -       -       -       -    ($XXX)    ($XXX)
Saldo al 31 dic 20X0    $XXX    $XXX    $XXX    $XXX    $XXX      $XXX
```

---

### Estado de Flujos de Efectivo (Método Indirecto)

```
EMPRESA XYZ S.A.S.
Estado de Flujos de Efectivo
Por el año terminado el 31 de diciembre de 20XX
(Cifras en millones de pesos colombianos)

ACTIVIDADES DE OPERACIÓN
  Utilidad neta del período                      $XXX
  Ajustes para conciliar:
    Depreciación y amortización                  $XXX
    Pérdida (ganancia) por deterioro             $XXX
    Gasto de intereses                           $XXX
    Impuesto corriente                           $XXX
    Impuesto diferido                            $XXX
  Cambios en capital de trabajo:
    (Aumento) disminución en cuentas por cobrar ($XXX)
    (Aumento) disminución en inventarios        ($XXX)
    Aumento (disminución) en cuentas por pagar  $XXX
    Otras variaciones de capital de trabajo      $XXX
  Intereses pagados                             ($XXX)
  Impuestos pagados                             ($XXX)
EFECTIVO NETO DE OPERACIÓN                       $XXX

ACTIVIDADES DE INVERSIÓN
  Adquisición de propiedad, planta y equipo    ($XXX)
  Adquisición de activos intangibles           ($XXX)
  Ingresos por venta de activos                 $XXX
  Inversiones en otras entidades               ($XXX)
EFECTIVO NETO DE INVERSIÓN                     ($XXX)

ACTIVIDADES DE FINANCIAMIENTO
  Préstamos recibidos                           $XXX
  Pago de obligaciones financieras            ($XXX)
  Pago de pasivos por arrendamiento (NIIF 16) ($XXX)
  Dividendos pagados                          ($XXX)
  Aportes de capital                           $XXX
EFECTIVO NETO DE FINANCIAMIENTO               ($XXX)

AUMENTO (DISMINUCIÓN) NETO EN EFECTIVO         $XXX
Efectivo al inicio del período                 $XXX
EFECTIVO AL FINAL DEL PERÍODO                  $XXX
```

---

## Tips para generación correcta

- **Moneda**: Siempre indicar la moneda funcional y de presentación
- **Comparativos**: Siempre incluir columna del año anterior (NIC 1)
- **Redondeo**: Indicar la unidad (pesos, miles, millones)
- **Cabecera**: Incluir nombre de la entidad, nombre del estado, fecha o período
- **Firma**: En Colombia, requiere firma del Contador y del Representante Legal
- **Cifras negativas**: En estados financieros NIIF se presentan entre paréntesis: ($XXX)

## Sectores especiales

Para empresas de sectores regulados, consultar marcos adicionales:
- **Entidades financieras**: Circular Básica Contable y Financiera de la Superfinanciera
- **Empresas de servicios públicos**: Resoluciones SSPD (Superservicios)
- **Entidades sin ánimo de lucro**: Resoluciones 533 y 414 del CGN
- **Sector público**: NICSP (Normas Internacionales de Contabilidad del Sector Público)
