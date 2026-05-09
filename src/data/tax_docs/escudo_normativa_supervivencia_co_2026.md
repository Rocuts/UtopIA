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
- Hidroeléctricas: 35% + 3 puntos porcentuales = 38% (sobretasa vigente 2023-2026).
- Entidades financieras (activos > 120.000 UVT): 35% + 5 pp = 40% (vigente 2023-2027).
- Compañías de seguros, reaseguradoras, bolsas de valores: 35% + 5 pp = 40% (vigente 2023-2027).

## Art. 240 parágrafo 6 — Tasa Mínima de Tributación (TTD)

- Regla: TTD = Impuesto Depurado / Utilidad Depurada ≥ 15%.
- Si TTD < 15%, el contribuyente debe adicionar al impuesto de renta: (UD × 15%) − ID.
- Para grupos consolidados: cálculo a nivel grupal con distribución proporcional entre miembros con TTD individual < 15%.
- Las rentas exentas de Economía Naranja SÍ integran el cálculo de Utilidad Depurada (DIAN concepto unificado 202-006038).

## Tasa Efectiva de Tributación (TET)

- Fórmula: TET = Impuesto de Renta Proyectado / Utilidad Antes de Impuestos (UAI).
- Benchmark Colombia (MinHacienda 2024): TET media empresarial ≈ 25.5%.
- Disparador UtopIA: TET > 30% activa módulo de optimización; TET > 35% revisa partidas no deducibles (Art. 771-5, intereses moratorios).

## Art. 771-5 E.T. — Bancarización

### Tope individual (Parágrafo 2)

- Pagos individuales en efectivo a un mismo beneficiario en el año que superen 100 UVT NO son deducibles ni sus IVA descontables.
- Tope individual 2026: 100 UVT × $52.374 = $5.237.400 COP.

### Tope general (Parágrafo 1) — vigente desde 2024 (4° año en adelante)

A partir del año gravable 2024, se reconoce fiscalmente el menor entre:

1. 40% de lo pagado en efectivo en total.
2. 40.000 UVT (en 2026: $2.094.960.000 COP).
3. 35% de los costos y deducciones totales.

Lo que exceda esos topes es no deducible.

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
- Tope conjunto Arts. 255 + 256 + 257: no puede superar el 30% del impuesto del periodo.

## Art. 257 E.T. — Donaciones a ESAL régimen tributario especial

- Descuento del 25% del valor donado.
- Tope conjunto con Arts. 255 y 256: 30% del impuesto.

## Art. 235-2 numeral 1 — Economía Naranja

- Renta exenta por 5 años para empresas de industrias creativas que cumplan requisitos.
- Vigencia para nuevos beneficiarios: cerrada desde 2022 (ventana original 2018-2021).
- Empresas ya inscritas mantienen beneficio hasta cumplir los 5 años.
- Las rentas exentas SÍ integran el cálculo de la TTD (parágrafo 6 Art. 240).

## Art. 242 E.T. — Impuesto a los dividendos personas naturales residentes

- Utilidad ya gravada en la sociedad: +10% adicional sobre el dividendo al socio persona natural.
- Utilidad NO gravada en la sociedad: 35% + 10% sobre el remanente neto.
- Dividendos a sociedades nacionales (Art. 242-1): 10% de retención (puede ser trasladable).
- Dividendos a no residentes (Art. 245): 20% general.

## Art. 36-3 E.T. + Decreto 1625/2016 Art. 1.2.1.12.1 — Capitalización de utilidades

- Capitalización de utilidades vía emisión de acciones a los socios = INCRGNO (ingreso no constitutivo de renta ni ganancia ocasional) para el accionista.
- Mecanismo: la utilidad pasa de "Utilidades por distribuir" a "Capital social" sin gravar al socio.
- Restricción: el accionista no recibe caja inmediata; recibe valor patrimonial.
- Alternativa al pago de dividendos del Art. 242 cuando el socio puede esperar liquidez.

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
- Diferencia con la reserva legal del Art. 452 C.Co. (10% de utilidad hasta 50% del capital suscrito, obligatoria por ley societaria, no por norma tributaria).

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
- 3605 Reserva legal: validación Art. 452 C.Co.
- 3610 Reserva ocasional: visualización capitalización.

## Fuentes oficiales

- Estatuto Tributario actualizado: Secretaría del Senado (secretariasenado.gov.co/senado/basedoc/estatuto_tributario.html).
- Ley 2277 de 2022: Función Pública (funcionpublica.gov.co/eva/gestornormativo/norma.php?i=199883).
- Resolución DIAN 000238 de 15-12-2025 (UVT 2026).
- Resoluciones DIAN 000227 de septiembre 2025 y 000233 de octubre 2025 (información exógena).
- DIAN Concepto 211 de 2025 (ICA deducible Art. 115).
- DIAN Concepto Unificado 202-006038 (TTD parágrafo 6 Art. 240).
- Estatuto.co (referencia rápida por artículo): estatuto.co/240, /242, /256, /257, /670, /771-5, /36-3.

## Cláusulas anti-hallucination para agentes

- Citar siempre el artículo + año del Estatuto Tributario o del decreto reglamentario.
- Para 2026 usar UVT 2026 = $52.374. Para 2025 usar UVT 2025 = $49.799. Declarar explícitamente cuál se está usando.
- Si una situación específica no encaja exactamente con un artículo, explicar y pedir más datos antes de subsumirla.
- Si la norma requerida no aparece en este pack, responder: "Esta norma no está en mi pack de referencia 2026; se requiere verificación con la fuente oficial antes de actuar".
