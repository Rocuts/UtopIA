---
slug: ley_2277_2022_reforma_tributaria
title: "Ley 2277 de 2022 — Reforma Tributaria (síntesis para 1+1)"
docType: tax_law_summary
entity: Congreso de Colombia
year: 2022
normCode: "Ley 2277 de 2022"
normUrl: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=199883
status: vigente
effectiveFrom: 2023-01-01
lastVerified: 2026-05-02
tags: [reforma_tributaria, ley, renta, juridica, dividendos, simple, ganancias_ocasionales]
relatedNorms: ["ET Art. 240", "ET Art. 242", "ET Art. 256", "ET Arts. 903-916"]
fetch_failed: false
---

# Ley 2277 de 2022 — Reforma Tributaria (síntesis para 1+1)

> **Aviso**: este archivo es la **síntesis estructurada** de los cambios vigentes en 2026, organizada para acelerar consultas del agente y citas DIAN-defendibles. El texto literal completo está en `ley_2277_2022.md` (240 KB).

## Resumen ejecutivo

La Ley 2277 de 2022, conocida como la **Reforma Tributaria del Gobierno Petro**, fue sancionada el 13 de diciembre de 2022 y tiene plena vigencia en el ejercicio fiscal 2026. Modificó múltiples artículos del Estatuto Tributario (ET) con foco en aumentar el recaudo, gravar más a personas naturales de altos ingresos y endurecer las normas anti-elusión. Es la última reforma tributaria estructural vigente — la propuesta de reforma 2025 no logró aprobación en el Congreso y fue archivada.

## Cambios estructurales vigentes en 2026

### 1. Tarifa renta personas jurídicas — Art. 240 ET
- **Tarifa general**: 35% (subió de 33% en 2022).
- **Sobretasa sector financiero**: 5pp adicionales hasta 2027 (40% efectivo).
- **Sobretasa sector hidrocarburos y carbón**: variable según precio internacional (5-15pp).
- **Decreto 1474/2025** añade sobretasa adicional 50% al sector financiero (validando con Corte Constitucional).

### 2. Tributación a dividendos — Art. 242 ET
- **Personas naturales residentes**:
  - Hasta 1.090 UVT ($57.087.660 en 2026): 0%
  - Más de 1.090 UVT: tarifa marginal de 0% a 39% (tarifa progresiva).
- **No residentes**: 20% (sobre dividendos provenientes de utilidades gravadas).
- **Inversión en CHC** (Compañía Holding Colombiana, Art. 894): exención de dividendos del exterior bajo régimen CHC.

### 3. Régimen SIMPLE — Arts. 903-916 ET
- Mantiene 6 grupos por actividad (tiendas/comercio, servicios profesionales, otros).
- Tope ingresos: 100.000 UVT anuales (≈ $5.237 millones COP en 2026).
- Excluye: actividades financieras, factoring, energía, hidrocarburos, importadores.
- Quien factura electrónicamente y supera el tope debe migrar a régimen ordinario.

### 4. Impuesto al patrimonio — Arts. 292-3, 295-3, 296-3
- Sujeto: personas naturales con patrimonio líquido ≥ 72.000 UVT (≈ $3.770M COP en 2026).
- Tarifas progresivas: 0,5% — 1% — 1,5%.
- **Decreto 1474/2025** lo extendió a partir de 40.000 UVT con tarifa 0,5% (en revisión Corte).

### 5. Ganancias ocasionales — Art. 313 ET
- Aumento de tarifa: 15% (subió de 10% en herencias, donaciones, loterías).
- Exenciones: 13.000 UVT del valor del inmueble heredado (vivienda); 3.500 UVT en otros bienes.

### 6. Limitaciones a beneficios tributarios
- **Renta exenta de salarios** (Art. 206 num. 10): tope 790 UVT al mes (≈ $41M en 2026).
- **Renta exenta intereses vivienda** (Art. 119): tope 1.200 UVT.
- **Limitación general de costos y deducciones** (Art. 336): para PN residentes, no podrán exceder del 40% de los ingresos no constitutivos de renta menos la exención del 25%.

### 7. Norma anti-elusión y contraseña entre partes vinculadas
- **Cláusula anti-abuso** (Art. 869, 869-1): facultades DIAN ampliadas para recalificar operaciones.
- **Comisión por acceso a paraísos fiscales** (Art. 408 par 4): retención 33% sobre pagos.

### 8. Carbono e impuestos verdes
- **Impuesto al carbono**: ampliado a más combustibles fósiles, tarifa creciente 2023-2027.
- **Impuesto a plásticos de un solo uso**: 0,00005 UVT por gramo, vigente 2023-2025 (ya no aplica).

## Cambios en facturación electrónica e inspección
- **Régimen sancionatorio** (Arts. 651, 652-1): incremento de sanciones por no facturar o no transmitir.
- **Información exógena reforzada**: ampliación de obligados.

## Aplicación práctica para clientes 1+1

| Cliente | Aplicación clave Ley 2277/2022 |
|---------|--------------------------------|
| PYME comerciante régimen SIMPLE | Validar que no supere 100.000 UVT. Sin cambios significativos en SIMPLE. |
| PYME ordinaria con utilidades | Tarifa 35% renta — ya no 33%. |
| Persona natural alta renta | Tabla dividendos progresiva 0-39%. Limitación 40% costos. |
| Holding (CHC) | Mantiene beneficios Art. 894 con requisitos endurecidos. |
| Sector financiero | Tarifa efectiva 40% + sobretasa Dec. 1474 → ~50%. |

## Validación contra reformas posteriores

- **Reforma Tributaria 2025**: presentada por el Gobierno, **NO APROBADA** en el Congreso, archivada en agosto 2025. Por tanto, Ley 2277/2022 sigue siendo la última estructural.
- **Decreto 1474/2025**: medidas de emergencia económica que se SUMAN a la Ley 2277, no la reemplazan. En revisión por Corte Constitucional.

## Notas para 1+1

1. El motor de reglas fiscales debe usar `tarifa_renta = 35%` para sociedades nacionales.
2. Para clientes en sector financiero, aplicar `sobretasa = 5%` (Ley 2277) + `sobretasa_emergencia = 5pp` (Decreto 1474/2025) si la Corte ratifica.
3. La calculadora de dividendos para personas naturales debe implementar la tabla progresiva del Art. 242, no la tarifa fija anterior del 10%.
4. Para detección de abuso tributario (Art. 869), el agente legal debe poder citar la norma con el redactor exacto: "Constituye abuso o conducta abusiva en materia tributaria el uso o la implementación..."

## Fuente

- **URL canónica**: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=199883
- **Texto literal**: ver `ley_2277_2022.md` en este mismo directorio (240 KB)
- **Análisis cruzado** (verificación):
  - Holland & Knight — Reforma Tributaria 2022
  - Universidad Externado — Análisis Ley 2277
  - DIAN — ABC de la Reforma Tributaria
- **Fecha de consulta**: 2026-05-02
