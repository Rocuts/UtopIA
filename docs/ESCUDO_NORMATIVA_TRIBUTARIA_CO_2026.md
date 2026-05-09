# Escudo — Normativa Tributaria Colombia 2026

> Pack normativo de referencia para el módulo **Modo Supervivencia Élite** de UtopIA. Cada artículo del Estatuto Tributario, decreto y resolución que un agente o validator de la pipeline `escudo-survival` debe conocer está aquí, con: (a) la regla, (b) la fórmula computable, (c) la cita oficial, (d) el caso de uso UtopIA, (e) el riesgo si se omite. **Cero hallucination tolerado** — si una situación no está cubierta aquí, el agente debe pedir más contexto antes de responder, no inventar.

## 0. Estado vigente del Estatuto Tributario

- **Última reforma**: Ley 2277 de 2022 ("Reforma Tributaria para la Igualdad y la Justicia Social"), vigente desde 1 de enero de 2023.
- **Última actualización publicada**: 30 de abril de 2026 (Diario Oficial No. 53.470 - 23 de abril de 2026).
- **Fuente oficial citable**: Secretaría del Senado en `secretariasenado.gov.co/senado/basedoc/estatuto_tributario.html`.
- **No existe reforma tributaria 2026 vigente** que sustituya 2277/2022. Cualquier afirmación de que "la reforma de 2026 dice X" es alucinación — pedir confirmación.

## 1. UVT 2026 — la unidad universal del cálculo

| Concepto | Valor 2026 | Fuente |
|---|---|---|
| **UVT 2026** | **$52.374 COP** | Resolución DIAN 000238 de 15-12-2025 |
| Variación vs UVT 2025 | +5.17% (UVT 2025 = $49.799) | DANE IPC ingresos medios oct 2024 - oct 2025 |
| Vigencia | 1 enero 2026 - 31 diciembre 2026 | — |
| Fundamento | Art. 868 E.T. | — |

**Regla operativa**: cualquier umbral expresado en UVT en este pack se multiplica por **52,374** para obtener el valor 2026 en COP. Ningún agente puede usar UVT de años anteriores sin marcarlo explícitamente como dato histórico.

## 2. Art. 240 E.T. — Tarifa general personas jurídicas

### 2.1 Tarifa nominal

| Tipo de contribuyente | Tarifa 2026 | Período de vigencia |
|---|---|---|
| Personas jurídicas (general) | **35%** | Vigente sin sunset |
| Generación de energía hidroeléctrica | 35% + 3 pp = **38%** | 2023-2026 (sobretasa) |
| Entidades financieras (activos > 120.000 UVT) | 35% + 5 pp = **40%** | 2023-2027 (sobretasa) |
| Compañías de seguros | 35% + 5 pp = **40%** | 2023-2027 |
| Reaseguradoras | 35% + 5 pp = **40%** | 2023-2027 |
| Bolsas de valores | 35% + 5 pp = **40%** | 2023-2027 |

**Validación obligatoria**: la pipeline debe identificar el sector del contribuyente (NIT + actividad CIIU) antes de aplicar tarifa. Aplicar 35% a una hidroeléctrica subestima el impuesto en 3 pp.

### 2.2 Tasa Mínima de Tributación (TTD) — parágrafo 6 del Art. 240

**Regla**: la TTD = ID / UD ≥ **15%**.

```
ID = Impuesto Depurado (líneas específicas del formulario 110)
UD = Utilidad Depurada (utilidad financiera con depuraciones del parágrafo 6)
```

Si TTD < 15%, el contribuyente debe **adicionar** al impuesto de renta:

```
Impuesto Adicional = (UD × 15%) − ID
```

Para grupos consolidados: se calcula a nivel grupal y se distribuye proporcionalmente entre miembros con TTD individual < 15%.

**Caso UtopIA**: el módulo de TET debe calcular la TTD junto a la TET y avisar si la empresa entra en zona de depuración. La DIAN ha aclarado (incp 2026) que las **rentas exentas de Economía Naranja sí entran en el cálculo de la TTD**.

**Fuentes**: 
- [Art. 240 E.T. – estatuto.co](https://estatuto.co/240)
- [Concepto Unificado DIAN 202(006038) — TTD](https://crconsultorescolombia.com/tasa-minima-de-tributacion-dian-concepto-unificado-202006038.php)

## 3. Tasa Efectiva de Tributación (TET) — la palanca de optimización

### 3.1 Definición

```
TET = Impuesto de Renta Proyectado / Utilidad Antes de Impuestos (UAI)
```

Donde:
- **Impuesto de Renta Proyectado**: estimación basada en utilidad fiscal del periodo, considerando descuentos disponibles (Arts. 254-260 E.T.) y sobretasas aplicables.
- **UAI**: utilidad neta del estado de resultados antes del gasto por impuesto.

### 3.2 Benchmark Colombia

- **TET media empresarial Colombia (MinHacienda 2024)**: **25.5%** — por debajo de la nominal 35% por beneficios tributarios.
- **TET de "alerta UtopIA"**: > **30%** ⇒ disparar módulo de optimización.
- **TET de "altísima alerta UtopIA"**: > **35%** ⇒ revisar posibles errores en partidas no deducibles (Art. 771-5, sanciones, intereses moratorios).

### 3.3 Disparadores de optimización (lo que el módulo recomienda)

| TET | Acción | Mecanismo legal |
|---|---|---|
| > 30% | Sugerir descuentos | Arts. 254 (rentas extranjeras), 255 (medio ambiente), 256 (CT&I), 257 (donaciones ESAL) |
| > 30% | Aprovechar deducción ICA | Art. 115 E.T. |
| > 30% | Evaluar Economía Naranja | Art. 235-2 numeral 1 (renta exenta 5 años industrias creativas) |
| > 35% | Revisar gastos no deducibles | Art. 771-5 (bancarización), Art. 105 (intereses moratorios) |

**Fuentes**:
- [Portafolio – TET Colombia 25.5%](https://www.portafolio.co/economia/impuestos/tasa-efectiva-de-tributacion-de-cuanto-es-para-las-empresas-y-a-cuanto-llegaria-571481)
- [Actualícese – Cálculo de tasa de tributación depurada](https://incp.org.co/publicaciones/infoincp-publicaciones/impuestos/nacionales/2025/01/aprende-a-calcular-la-tasa-de-tributacion-depurada-y-sus-implicaciones-tributarias/)

## 4. Art. 771-5 E.T. — Bancarización (gastos en efectivo no deducibles)

### 4.1 Regla individual (Parágrafo 2)

**Pagos individuales en efectivo a un mismo beneficiario en el año que superen 100 UVT NO son deducibles ni sus IVA descontables.**

```
Tope individual 2026 = 100 UVT × $52.374 = $5.237.400 COP
```

### 4.2 Regla general (Parágrafo 1) — vigente 2024 en adelante

A partir del 4° año de implementación (2024+), se reconoce fiscalmente el **menor entre**:

| Criterio | Valor 2026 |
|---|---|
| 40% de lo pagado en efectivo en total | (variable) |
| 40.000 UVT | $2.094.960.000 COP |
| 35% de los costos y deducciones totales | (variable) |

**Lo que exceda esos topes es no deducible.**

### 4.3 Detección automática (lo que la pipeline hace)

1. **Lectura cuenta 1105 (Caja)**: total de pagos contabilizados como salida de efectivo en el periodo.
2. **Cruce con auxiliares**: identificar pagos por beneficiario.
3. **Cálculo de violaciones**:
   - Pagos a un mismo NIT que superen 100 UVT → marcar como NO DEDUCIBLE individual.
   - Total de pagos en efectivo / costos totales > 35% O > 40.000 UVT → marcar exceso.
4. **Impacto fiscal**: 
   ```
   Mayor impuesto = (Pagos no deducibles) × Tarifa Art. 240
                  = (Pagos no deducibles) × 35%
   ```
5. **Recomendación**: pasar a transferencia / cheque / tarjeta antes del cierre fiscal.

**Riesgo de omitir**: la DIAN puede rechazar la deducción y aplicar Art. 647 (sanción por inexactitud = 100% del mayor valor del impuesto) si detecta el patrón en información exógena.

**Fuentes**:
- [Art. 771-5 E.T. – estatuto.co](https://estatuto.co/771-5)
- [Rivas y Asociados – Límites efectivo 2026](https://rivasyasociados.com.co/limites-pagos-efectivo-2026-individual-general-bancarizacion/)
- [Gerencie – Bancarización pagos no deducibles](https://www.gerencie.com/pagos-en-efectivo-no-seran-deducibles.html)

## 5. Art. 115 E.T. — Deducción de impuestos pagados (ICA al 100%)

### 5.1 Regla actual (post Ley 2277/2022)

> "Es deducible el cien por ciento (100%) de los impuestos, tasas y contribuciones que efectivamente se hayan pagado durante el año o período gravable por parte del contribuyente, que tengan relación de causalidad con su actividad económica, con excepción del impuesto sobre la renta y complementarios."

**Cambio crítico vs régimen anterior**: antes de Ley 2277/2022, el ICA era **descuento del 50%** (reducía directamente el impuesto). Ahora es **deducción del 100%** (reduce la base gravable). La afectación neta es ≈ 35% del ICA (la tarifa de renta).

### 5.2 Requisitos acumulativos

1. **Causalidad**: el tributo se relaciona con la actividad productora de renta.
2. **Pago efectivo**: el tributo fue pagado **antes** de presentar la declaración inicial de renta.

Si falta cualquiera de los dos, **no es deducible**.

### 5.3 Detección automática

- **Cuentas a monitorear**: 5135 (Servicios), 5240 (Impuestos), 5295 (Diversos) en algunos PUCs personalizados.
- **ICA**: cuenta de gasto + cuenta de pasivo 2368 (Impuestos por pagar - ICA).
- **Validación**: confirmar que el pago efectivo se haya hecho antes del 31 de diciembre del año gravable o, máximo, antes de la declaración inicial.

**Fuentes**:
- [Art. 115 E.T. – estatuto.co](https://estatuto.co/115)
- [DIAN Concepto 211 de 2025 — ICA deducible](https://accounter.co/dian/el-ica-es-deducible-de-renta-en-los-terminos-del-art-115-et-concepto-dian-211-de-2025.html)
- [RC Abogados – ICA deducible Art 115](https://rcabogados.com.co/2025/03/27/el-impuesto-de-industria-y-comercio-ica-es-deducible-del-impuesto-sobre-la-renta-actualizacion-normativa-y-requisitos/)

## 6. Arts. 256, 256-1, 257 E.T. — Descuentos por inversiones y donaciones

### 6.1 Art. 256 — Inversión en CT&I

| Concepto | Valor |
|---|---|
| Descuento del impuesto de renta | **30%** del valor invertido |
| Aplicable a | Proyectos calificados por el Consejo Nacional de Beneficios Tributarios en CT&I (Minciencias) |
| MIPYMES — Crédito fiscal alternativo | **50%** (Art. 256-1) |
| Combinado con Arts. 255 + 256 + 257 | **No puede superar el 30% del impuesto** del periodo |

**Caso UtopIA**: si la TET > 30% y la empresa califica como innovadora, sugerir aplicar a Minciencias para futuras inversiones; si ya tiene proyecto calificado, recordar que el descuento aplica al periodo de la inversión.

### 6.2 Art. 257 — Donaciones a ESAL del régimen tributario especial

| Concepto | Valor |
|---|---|
| Descuento del impuesto | **25%** del valor donado |
| Tope conjunto Arts. 255+256+257 | 30% del impuesto |

### 6.3 Economía Naranja (Art. 235-2 numeral 1)

- **Beneficio**: renta exenta por **5 años** para empresas de industrias creativas que cumplan requisitos.
- **Vigencia para nuevos beneficiarios**: cerrada desde 2022 (la ventana fue 2018-2021), pero **empresas que ya estaban inscritas mantienen el beneficio** hasta cumplir los 5 años.
- **Atención TTD**: las rentas exentas de Economía Naranja **sí integran** el cálculo de Utilidad Depurada (DIAN concepto 2026).

**Fuentes**:
- [Art. 256 E.T. – estatuto.co](https://estatuto.co/256)
- [Art. 256-1 E.T. – estatuto.co](https://estatuto.co/256-1)
- [Minciencias – Beneficios Tributarios CTeI](https://minciencias.gov.co/viceministerios/conocimiento/direccion_transferencia/beneficios-tributarios)

## 7. Art. 242 E.T. — Impuesto a los dividendos (personas naturales residentes)

### 7.1 Reglas según origen de la utilidad

| Tipo de utilidad | Tarifa al socio persona natural |
|---|---|
| Utilidad ya gravada en la sociedad (ya pagó 35%) | **+10% adicional** sobre el dividendo |
| Utilidad NO gravada en la sociedad | **35%** + 10% sobre el remanente neto |
| Dividendos a sociedades nacionales (Art. 242-1) | **10%** retención (puede ser trasladable) |
| Dividendos a no residentes (Art. 245) | **20%** general |

### 7.2 Optimización (Modo Supervivencia)

**Alternativa 1 — Capitalización (Art. 36-3 E.T. + Decreto 1625/2016 Art. 1.2.1.12.1)**:
- Capitalizar utilidades vía emisión de acciones a los socios = **INCRGNO** (ingreso no constitutivo de renta ni ganancia ocasional) para el accionista.
- Mecanismo: la utilidad pasa de "Utilidades por distribuir" a "Capital social" sin gravar al socio.
- Restricción: el accionista no recibe caja inmediata; recibe valor patrimonial.

**Alternativa 2 — Reserva ocasional**:
- Constituir reserva de utilidades acumuladas. No genera dividendo gravable. Permite distribución diferida.
- Si después se libera y distribuye, se grava conforme a la tarifa vigente en ese momento.

**Alternativa 3 — Reserva legal obligatoria (Art. 452 C.Co.)**:
- 10% de utilidad neta hasta llegar al 50% del capital suscrito. **No es opcional**.

### 7.3 Lo que el módulo simula

Para una utilidad fiscal X y una repartición Y al socio:
1. Calcular impuesto al socio bajo Art. 242 (escenario "distribuir").
2. Calcular efecto de capitalizar el 100% de Y (escenario "capitalizar" = $0 al socio + fortalecimiento patrimonial).
3. Calcular escenario híbrido (50% capitalizar, 50% distribuir).
4. Mostrar **ahorro tributario inmediato** y **costo de oportunidad** (no liquidez al socio).

**Fuentes**:
- [Art. 242 E.T. – estatuto.co](https://estatuto.co/242)
- [Art. 242-1 E.T. – estatuto.co](https://estatuto.co/242-1)
- [Art. 36-3 E.T. – estatuto.co](https://estatuto.co/36-3)
- [DIAN.com.co – Impuesto dividendos 2026](https://dian.com.co/impuesto-dividendos-colombia-2026/)
- [Forvis Mazars – Capitalización INCRNGO](https://www.forvismazars.com/co/es/acerca-de-nosotros/noticias-publicaciones-y-media/nuestras-publicaciones/actualidad-juridica-y-tributaria/incrngo)

## 8. Art. 670 E.T. — Sanción por improcedencia de devoluciones / saldos a favor

### 8.1 Reglas de sanción

| Escenario | Sanción sobre el valor improcedente |
|---|---|
| Contribuyente corrige voluntariamente | **10%** |
| DIAN rechaza o modifica el saldo a favor | **20%** |
| Documentos falsos / fraude | **+100%** (adicional a las anteriores) |

### 8.2 Caso de uso UtopIA — Escudo de Retenciones

**Disparador**: cuenta **1355** (Anticipos de Impuestos y Contribuciones) acumulada > Impuesto de Renta proyectado del año.

**Lógica**:
```
saldoAFavorProyectado = retencionesAcumuladas - impuestoRentaProyectado
```

Si `saldoAFavorProyectado > 0`, el contribuyente está atrapando flujo de caja. El módulo debe sugerir:

1. **Solicitar certificado de no retención** ante el agente retenedor (si aplica por concepto: rendimientos financieros, honorarios, comisiones).
2. **Solicitar autorretenedor** ante la DIAN (Resolución administrativa, requiere RUT 3+ años, cumplimiento al día) — Forma 350 mensual.
3. **Compensación**: usar el saldo a favor para pagar otro impuesto (IVA, Renta de socios) → Forma 1502.
4. **Devolución**: solicitar a la DIAN la devolución en efectivo. **Riesgo**: si la devolución resulta improcedente, sanción Art. 670 = 10-20-100%.

**Riesgo si se omite**: 
- (a) Capital de trabajo atrapado en cuenta DIAN.
- (b) Si pides devolución y resulta improcedente, sanción del 20% mínimo.

**Fuentes**:
- [Art. 670 E.T. – contadia.com](https://www.contadia.com/estatuto-tributario/articulo-670-sancion-por-improcedencia-de-las-devoluciones-y-o-compensaciones)
- [Gerencie – Sanción por devolución improcedente](https://www.gerencie.com/sancion-por-devolucion-o-compensacion-improcedente.html)
- [Actualícese – Saldos a favor sanciones](https://actualicese.com/devolucion-o-compensacion-de-saldos-a-favor-procede-sancion-por-solicitud-improcedente/)

## 9. Información Exógena DIAN 2026 — auditoría preventiva

### 9.1 Norma vigente

- **Resolución Única 000227 de septiembre de 2025**, modificada por **Resolución 000233 de octubre de 2025**.
- Reporte sobre año gravable **2025** (presentar en 2026).

### 9.2 Plazos 2026

| Tipo de obligado | Inicio | Cierre |
|---|---|---|
| Grandes contribuyentes | 28 abril 2026 | 13 mayo 2026 |
| Personas jurídicas y naturales | 14 mayo 2026 | 12 junio 2026 |

### 9.3 Cruces que la DIAN realiza (UtopIA debe simular)

1. **Pagos a terceros** vs deducción declarada → si difiere por más de tolerancia, alerta.
2. **Cuentas por pagar [Clase 22]** vs lo que el tercero reportó como CxC → diferencia ⇒ posible pasivo no real.
3. **Retenciones practicadas** vs Forma 350 mensual → debe cuadrar.
4. **IVA descontable** vs IVA generado por proveedores → cruce inverso.

### 9.4 Lo que el módulo Anti-DIAN hace

1. Lee saldos clase **22** (Cuentas por pagar) por tercero.
2. Simula el reporte de exógena (Formato 1001, 1002, 1003, 1005, 1007, 1008, 1009, etc.).
3. Detecta inconsistencias *antes* de que la DIAN las detecte:
   - CxP a un tercero por > $10MM sin soporte de factura electrónica.
   - Pagos individuales a un mismo NIT > 100 UVT en efectivo.
   - Diferencia entre IVA generado y descontable que excede tolerancia.
4. Genera reporte de "riesgo de cruce" priorizado por probabilidad de fiscalización.

**Fuentes**:
- [Resolución 000227 DIAN](https://www.dian.gov.co/normatividad/Proyectosnormas/Proyecto%20Resoluci%C3%B3n%20000000%20de%2019-11-2025.pdf)
- [Buk – Información exógena 2026](https://www.buk.co/blog/informaci%C3%B3n-exogena-2026-plazos-y-obligados-en-colombia)
- [Actualícese – Plazos exógena 2026](https://actualicese.com/plazos-para-reportar-informacion-exogena-en-2026/)

## 10. Reserva de Contingencia Legal (10% utilidad neta)

### 10.1 Regla operativa UtopIA (no es norma legal — es buena práctica financiera)

```
ReservaContingencia = 10% × UtilidadNeta
```

**Propósito**: garantizar liquidez para cubrir el impuesto del periodo sin afectar la operación. Es un equivalente de los **provisional payments** anglosajones.

### 10.2 Visualización

En la tarjeta "Reserva Fiscal" del módulo:
- Mostrar el monto sugerido en COP.
- Indicar la cuenta de alta liquidez recomendada (subcuentas de **clase 11** — caja, bancos, inversiones temporales).
- Mostrar el % de la utilidad neta y la fórmula aplicada.

### 10.3 Relación con la reserva legal del Art. 452 C.Co.

**No confundir**:
- **Reserva legal (Art. 452 C.Co.)**: 10% de utilidad neta, hasta 50% del capital suscrito. **Obligatoria**.
- **Reserva de contingencia (UtopIA)**: 10% de utilidad neta como provisión de caja para impuestos. **Recomendación interna**, no obligación.

Ambas pueden ser equivalentes en monto pero tienen propósitos distintos. El módulo debe distinguirlas en la UI.

## 11. Plan Único de Cuentas (PUC) — referencias críticas

### 11.1 Cuentas que el módulo lee

| Código | Nombre | Uso |
|---|---|---|
| **1105** | Caja | Detección de pagos en efectivo (Art. 771-5) |
| 110505 | Caja general | Cuenta postable bajo 1105 |
| **1110** | Bancos | Cruce con extractos para conciliación |
| **1355** | Anticipos de Impuestos y Contribuciones | Escudo de retenciones — saldo a favor |
| 135515 | Retención en la fuente (anticipo) | Subcuenta clave de 1355 |
| 135517 | Impuesto a las ventas retenido | Subcuenta de 1355 |
| 135518 | Industria y comercio retenido | Subcuenta de 1355 (ICA retenido) |
| **22** (clase) | Cuentas por pagar | Cruce exógena con terceros |
| **2368** | Impuestos por pagar - ICA | Validación pago efectivo Art. 115 |
| **5215** / **5240** | Gasto Impuestos | Verificación deducción al 100% |
| **3605** | Reserva legal | Validación Art. 452 C.Co. |
| **3610** | Reserva ocasional | Visualización capitalización |

### 11.2 Reglas de extracción

- Las cuentas mayores (1355, 1105, 22) son **no postables** en el PUC PYME. Los movimientos se reflejan en **subcuentas postables** (1355.15, 110505, 220505, etc.).
- El preprocessor `src/lib/preprocessing/trial-balance.ts` ya organiza el balance en `PUCClass[]` con `accounts[]` recursivo. El módulo debe sumar a través de la jerarquía cuando lee, no buscar en una clave plana.

## 12. Tabla compacta de "qué dispara qué" (cheat sheet operativo)

| Disparador | Umbral | Submódulo | Acción |
|---|---|---|---|
| TET > 30% | (calculado) | Optimización | Sugerir Arts. 255-257, ICA, Economía Naranja |
| TET > 35% | (calculado) | Auditoría | Revisar Art. 771-5, intereses moratorios |
| TTD < 15% | parágrafo 6 Art. 240 | Cumplimiento | Calcular impuesto adicional |
| Saldo 1355 > Impuesto proyectado | (calculado) | Escudo Retenciones | Sugerir certif. no retención / autorretenedor |
| Pago efectivo individual > 100 UVT | $5.237.400 | Anti-DIAN | Marcar gasto NO deducible |
| Total efectivo / costos > 35% | (calculado) | Anti-DIAN | Calcular exceso no deducible |
| Total efectivo > 40.000 UVT | $2.094.960.000 | Anti-DIAN | Calcular exceso no deducible |
| Reserva contingencia | 10% × utilidad neta | Reserva Fiscal | Mostrar caja a preservar |
| Dividendo proyectado | (calculado) | Optimización Dividendos | Simular distribuir vs capitalizar |

## 13. Reglas de protección anti-hallucination

**Cualquier agente que cite normativa tributaria DEBE**:

1. Citar el artículo + año del Estatuto Tributario o el decreto reglamentario explícitamente.
2. NUNCA citar leyes que no aparezcan en este pack sin verificación previa (WebSearch + cite URL oficial).
3. Si una situación específica del cliente no encaja exactamente con un artículo, **explicarlo y pedir más datos**, no inventar la subsunción.
4. Para tarifas y umbrales, usar SIEMPRE UVT 2026 = $52.374.
5. Si el agente detecta que el periodo del balance es 2025 o 2024, debe usar la UVT correspondiente y declararlo explícitamente: *"Para el periodo 2025 utilizo UVT 2025 = $49.799"*.
6. Si la pregunta requiere norma posterior a Ley 2277/2022 que no esté en este pack, responder: *"Esta norma no está en mi pack de referencia 2026; se requiere verificación con la fuente oficial antes de actuar"*.

## 14. Fuentes oficiales (siempre citables)

- **Estatuto Tributario actualizado** — [Secretaría del Senado](http://www.secretariasenado.gov.co/senado/basedoc/estatuto_tributario.html) | [DIAN](https://www.dian.gov.co/impuestos/factura-electronica/documentacion/Paginas/estatuto-tributario.aspx) | [estatuto.co](https://estatuto.co/) (no oficial pero útil para artículos individuales).
- **Ley 2277 de 2022** — [Función Pública](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=199883) | [Secretaría del Senado](http://www.secretariasenado.gov.co/senado/basedoc/ley_2277_2022.html).
- **UVT 2026** — Resolución DIAN 000238 de 15-12-2025 (PDF DIAN).
- **Información Exógena 2026** — Resolución DIAN 000227 de septiembre 2025 + 000233 de octubre 2025.
- **Tarifa general 35% personas jurídicas (Art. 240)** — [Actualícese](https://actualicese.com/tarifa-general-del-impuesto-de-renta-2026-para-personas-juridicas/).
- **TTD parágrafo 6** — [Concepto Unificado DIAN 202(006038)](https://crconsultorescolombia.com/tasa-minima-de-tributacion-dian-concepto-unificado-202006038.php).
- **Bancarización Art. 771-5** — [Rivas y Asociados 2026](https://rivasyasociados.com.co/limites-pagos-efectivo-2026-individual-general-bancarizacion/).
- **ICA deducible Art. 115** — [DIAN Concepto 211 de 2025](https://accounter.co/dian/el-ica-es-deducible-de-renta-en-los-terminos-del-art-115-et-concepto-dian-211-de-2025.html).
- **Descuentos CT&I Art. 256** — [Minciencias](https://minciencias.gov.co/viceministerios/conocimiento/direccion_transferencia/beneficios-tributarios).
- **Dividendos Art. 242** — [DIAN.com.co](https://dian.com.co/impuesto-dividendos-colombia-2026/).
- **Sanción Art. 670** — [Contadia.com](https://www.contadia.com/estatuto-tributario/articulo-670-sancion-por-improcedencia-de-las-devoluciones-y-o-compensaciones).
- **Capitalización INCRNGO Art. 36-3** — [Forvis Mazars](https://www.forvismazars.com/co/es/acerca-de-nosotros/noticias-publicaciones-y-media/nuestras-publicaciones/actualidad-juridica-y-tributaria/incrngo).

---

**Última verificación**: 2026-05-08. Próxima revisión obligatoria: cuando salga la UVT 2027 (~diciembre 2026) o cuando se promulgue una nueva ley tributaria.
