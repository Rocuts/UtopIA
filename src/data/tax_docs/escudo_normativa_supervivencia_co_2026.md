---
title: "Pack normativo Modo Supervivencia Élite — Colombia 2026"
type: pack_normativo
entity: utopia
number: "supervivencia-elite"
year: "2026"
source: "docs/ESCUDO_NORMATIVA_TRIBUTARIA_CO_2026.md"
---

# Pack normativo — Modo Supervivencia Élite Colombia 2026

> Fuente RAG ingestable. Espejo del documento `docs/ESCUDO_NORMATIVA_TRIBUTARIA_CO_2026.md` con frontmatter compatible con la ingesta de UtopIA. Sirve para que el chat orchestrator y los pipelines puedan recuperar las normas vía `search_docs` cuando el contribuyente pregunte por bancarización, dividendos, descuentos CT&I, sanción por improcedencia, etc.

## Estado vigente del Estatuto Tributario

- Última reforma: Ley 2277 de 2022 ("Reforma Tributaria para la Igualdad y la Justicia Social"), vigente desde 1 de enero de 2023.
- Última actualización publicada: 30 de abril de 2026 (Diario Oficial No. 53.470 - 23 de abril de 2026).
- No existe reforma tributaria 2026 vigente que sustituya 2277/2022.

## UVT 2026

- Valor oficial: $52.374 COP.
- Fundamento: Resolución DIAN 000238 de 15-12-2025; Art. 868 E.T.
- Variación vs UVT 2025 ($49.799): +5.17% (DANE IPC ingresos medios oct 2024 - oct 2025).
- Vigencia: 1 enero 2026 - 31 diciembre 2026.

## Art. 240 E.T. — Tarifa general personas jurídicas

- Tarifa general 2026: 35%.
- Hidroeléctricas (parágrafo 4 Art. 240): 35% + 3 puntos porcentuales = 38% durante los años gravables 2023-2026, sólo si la renta gravable del año es igual o superior a 30.000 UVT.
- Instituciones financieras, aseguradoras, reaseguradoras y proveedores de infraestructura del mercado de valores (parágrafo 2 Art. 240): 35% + 5 pp = 40% durante 2023-2027, sólo si la renta gravable del año es igual o superior a 120.000 UVT. El umbral es de RENTA GRAVABLE, no de activos.

## Art. 240 parágrafo 6 — Tasa Mínima de Tributación (TTD)

- Regla: TTD = Impuesto Depurado / Utilidad Depurada ≥ 15%.
- Si TTD < 15%, el contribuyente debe adicionar al impuesto de renta: (UD × 15%) − ID.
- Para grupos consolidados: cálculo a nivel grupal con distribución proporcional entre miembros con TTD individual < 15%.
- Las rentas exentas de Economía Naranja SÍ integran el cálculo de Utilidad Depurada (DIAN concepto unificado 202-006038).

## Tasa efectiva contable (TET contable) — no es la TTD

- Fórmula: TET contable = impuesto de renta causado en libros (grupo 54) / Utilidad Antes de Impuestos (UAI). Es una razón contable, no una liquidación.
- No usar «UAI × 35% / UAI»: esa razón siempre da la tarifa nominal y no informa nada.
- La TET contable NO sustituye la TTD del parágrafo 6 del Art. 240 E.T.: la TTD exige impuesto depurado (ID) y utilidad depurada (UD). Sin ID/UD verificados la TTD y el impuesto adicional son «no determinables» (N/D).

## Art. 771-5 E.T. — Bancarización

### Tope individual (Parágrafo 2)

- El tope de 100 UVT se mide por PAGO INDIVIDUAL (cada transacción), no acumulado por beneficiario en el año (Consejo de Estado, Sección Cuarta, sentencia 26676 de 19-jul-2023, citada como jurisprudencia concordante del Art. 771-5 en el texto compilado del E.T.).
- Tope individual 2026: 100 UVT × $52.374 = $5.237.400 COP. Para el año gravable 2025 se usa la UVT 2025 ($49.799): $4.979.900.

### Tope general (Parágrafo 1, texto Ley 1819 de 2016) — a partir del año 2021

Los pagos en efectivo tienen reconocimiento fiscal, independientemente del número de pagos, hasta el menor valor entre:

1. a) El 40% de lo pagado, que en todo caso no podrá superar 40.000 UVT (en 2026: $2.094.960.000 COP), y
2. b) El 35% de los costos y deducciones totales.

Lo que exceda ese límite no es deducible. «Lo pagado» es un flujo de pagos del año: el SALDO de la cuenta 1105 (Caja) al cierre no mide los pagos en efectivo; sin el detalle de pagos del año (auxiliar de caja o pagos por transacción) el exceso es no determinable. Doctrina concordante: Oficio DIAN 19439 de 2018.

### Riesgos

- Pérdida de la deducción ⇒ mayor impuesto.
- Si la DIAN detecta el patrón en información exógena: posible sanción Art. 647 (sanción por inexactitud = 100% del mayor valor del impuesto).

## Art. 115 E.T. — Deducción de impuestos pagados (post Ley 2277/2022)

- Es deducible el 100% de los impuestos, tasas y contribuciones efectivamente pagados durante el año o período gravable, con relación de causalidad con la actividad económica, excepto el impuesto sobre la renta y complementarios.
- Cambio crítico: antes de Ley 2277/2022 el ICA era descuento del 50%; ahora es deducción del 100% (reduce base gravable; afectación neta ≈ 35% del ICA = la tarifa de renta).
- Requisitos acumulativos: causalidad con actividad productora de renta + pago efectivo antes de la presentación de la declaración inicial.

## Art. 256 E.T. — Descuento por inversiones en CT&I

- Descuento del 30% del valor invertido en proyectos calificados por el Consejo Nacional de Beneficios Tributarios en CT&I (Minciencias).
- MIPYMES: crédito fiscal alternativo del 50% (Art. 256-1).
- Tope conjunto Arts. 255 + 256 + 257 (Art. 258 E.T.): no puede superar el 25% del impuesto sobre la renta a cargo del año gravable. El exceso del 256 puede tomarse en los 4 periodos siguientes.

## Art. 257 E.T. — Donaciones a ESAL régimen tributario especial

- Descuento del 25% del valor donado.
- Tope conjunto con Arts. 255 y 256: 25% del impuesto a cargo (Art. 258 E.T.). El exceso originado en el 257 puede tomarse en el periodo gravable siguiente.

## Art. 235-2 numeral 1 — Economía Naranja

- Renta exenta por 5 años para empresas de industrias creativas que cumplan requisitos.
- Vigencia para nuevos beneficiarios: cerrada desde 2022 (ventana original 2018-2021).
- Empresas ya inscritas mantienen beneficio hasta cumplir los 5 años.
- Las rentas exentas SÍ integran el cálculo de la TTD (parágrafo 6 Art. 240).

## Art. 242 E.T. — Dividendos de personas naturales residentes (texto Ley 2277 de 2022, art. 3)

- Dividendos provenientes de utilidades NO gravadas en la sociedad (INCRNGO, num. 3 Art. 49): integran la base gravable del impuesto sobre la renta del socio y están sujetos a la tarifa del Art. 241 E.T. (tabla marginal de personas naturales).
- Dividendos provenientes de utilidades GRAVADAS en la sociedad (parágrafo 2 Art. 49): primero la tarifa del Art. 240 E.T. (35%) según el periodo en que se paguen o abonen; sobre el saldo, una vez disminuido ese impuesto, aplica el régimen del inciso anterior (Art. 241).
- Retención en la fuente (parágrafo Art. 242): 0% hasta 1.090 UVT; 15% sobre el exceso de 1.090 UVT de los dividendos decretados en calidad de exigibles. Es un anticipo que el socio imputa en su declaración, no la tarifa final.
- Descuento Art. 254-1 E.T. (Ley 2277 de 2022, art. 5): 19% sobre la renta líquida cedular de dividendos que exceda 1.090 UVT.
- Dividendos a sociedades nacionales (Art. 242-1, inciso mod. Ley 2277 art. 12): retención del 10% trasladable e imputable al beneficiario final persona natural residente o inversionista del exterior.
- Dividendos a no residentes (Art. 245): 20% general.
- El régimen anterior de la Ley 2010 de 2019 (tarifa especial del 10% sobre el exceso de 300 UVT) NO rige desde el año gravable 2023.

## Art. 36-3 E.T. — DEROGADO (capitalización de utilidades)

- El Art. 36-3 E.T. fue derogado a partir del 1 de enero de 2023 por el artículo 96 de la Ley 2277 de 2022.
- Aun antes de su derogatoria cubría la capitalización de la cuenta de revalorización del patrimonio y, sólo para sociedades con acciones en bolsa, la de ciertas utilidades; nunca fue una exención general para capitalizar utilidades de una SAS o Ltda.
- DIAN, Concepto 2769 de 19-feb-2026 (num. 16): «derogado expresamente el artículo 36-3 del E.T. por el artículo 96 de la Ley 2277 de 2022, desapareció el fundamento legal que otorgaba el tratamiento como INRGO [...]. Por tanto, dicha operación debe someterse al régimen general aplicable a la distribución de utilidades».
- Consecuencia: capitalizar utilidades (dividendo en acciones o cuotas) se trata como distribución gravada conforme a los Arts. 48-49, 242, 242-1 y 245 E.T. No existe un escenario de capitalización con impuesto del socio igual a $0 fundado en el Art. 36-3.

## Art. 670 E.T. — Sanción por improcedencia de devoluciones / saldos a favor

- Contribuyente corrige voluntariamente: 10% del valor improcedente.
- DIAN rechaza o modifica el saldo a favor: 20% del valor improcedente.
- Documentos falsos / fraude: +100% adicional (acumulativo a las anteriores).

## Información Exógena DIAN 2026

- Norma vigente: Resolución Única 000227 de septiembre 2025, modificada por Resolución 000233 de octubre 2025.
- Reporte sobre año gravable 2025 (presentación en 2026).
- Plazos grandes contribuyentes: 28 abril 2026 a 13 mayo 2026.
- Plazos personas jurídicas y naturales: 14 mayo 2026 a 12 junio 2026.
- Cruces que la DIAN realiza:
  1. Pagos a terceros vs deducción declarada.
  2. Cuentas por pagar (clase 22) vs lo que el tercero reportó como cuentas por cobrar.
  3. Retenciones practicadas vs Forma 350 mensual.
  4. IVA descontable vs IVA generado por proveedores.

## Reserva de Contingencia Fiscal (buena práctica UtopIA)

- Fórmula: 10% × Utilidad Neta.
- Propósito: garantizar liquidez para cubrir el impuesto del periodo sin afectar la operación.
- Cuenta sugerida: subcuentas de clase 11 (caja, bancos, inversiones temporales).
- Diferencia con la reserva legal: en S.A. (Art. 452 C.Co.: 10% de la utilidad hasta el 50% del capital suscrito) y Ltda. (Art. 371 C.Co.) es obligatoria por ley societaria, no por norma tributaria; en la SAS no es obligatoria salvo que los estatutos la prevean (Supersociedades, Oficio 220-069664 de 2017).

## Plan Único de Cuentas (PUC) — referencias críticas

- 1105 Caja: detección de pagos en efectivo (Art. 771-5).
- 110505 Caja general: cuenta postable bajo 1105.
- 1110 Bancos: cruce con extractos para conciliación.
- 1355 Anticipos de Impuestos y Contribuciones: escudo de retenciones / saldo a favor.
- 135515 Retención en la fuente (anticipo).
- 135517 Impuesto a las ventas retenido.
- 135518 Industria y comercio retenido.
- 22 (clase) Cuentas por pagar: cruce exógena con terceros.
- 2368 Impuestos por pagar - ICA: validación pago efectivo Art. 115.
- 5215 / 5240 Gasto Impuestos: verificación deducción al 100%.
- 3305 Reservas obligatorias (reserva legal): validación Arts. 452 / 371 C.Co. según el tipo societario.
- 3315 Reservas ocasionales.
- 3605 Utilidad del ejercicio.

## Fuentes oficiales

- Estatuto Tributario actualizado: Secretaría del Senado (secretariasenado.gov.co/senado/basedoc/estatuto_tributario.html).
- Ley 2277 de 2022: Función Pública (funcionpublica.gov.co/eva/gestornormativo/norma.php?i=199883).
- Resolución DIAN 000238 de 15-12-2025 (UVT 2026).
- Resoluciones DIAN 000227 de septiembre 2025 y 000233 de octubre 2025 (información exógena).
- DIAN Concepto 211 de 2025 (ICA deducible Art. 115).
- DIAN Concepto Unificado 202-006038 (TTD parágrafo 6 Art. 240).
- Estatuto.co (referencia rápida por artículo): estatuto.co/240, /242, /256, /257, /670, /771-5.
- DIAN Concepto 2769 de 2026 (derogatoria del Art. 36-3 por Ley 2277 de 2022, art. 96).

## Cláusulas anti-hallucination para agentes

- Citar siempre el artículo + año del Estatuto Tributario o del decreto reglamentario.
- Para 2026 usar UVT 2026 = $52.374. Para 2025 usar UVT 2025 = $49.799. Declarar explícitamente cuál se está usando.
- Si una situación específica no encaja exactamente con un artículo, explicar y pedir más datos antes de subsumirla.
- Si la norma requerida no aparece en este pack, responder: "Esta norma no está en mi pack de referencia 2026; se requiere verificación con la fuente oficial antes de actuar".
