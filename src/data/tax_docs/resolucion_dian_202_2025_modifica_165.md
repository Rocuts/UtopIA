---
slug: resolucion_dian_202_2025_modifica_165
title: "Resolución DIAN 000202 de 2025 — Modifica Resolución 165/2023 (Factura Electrónica + Servicio Consulta Adquiriente)"
docType: dian_resolution
entity: DIAN
year: 2025
normCode: "Resolución DIAN 000202 de 2025"
normUrl: https://www.dian.gov.co/normatividad/Normatividad/Resoluci%C3%B3n%20000202%20de%2031-03-2025.pdf
status: vigente_compilada_en_227
effectiveFrom: 2025-04-01
effectiveUntil: null
lastVerified: 2026-05-02
tags: [dian, factura-electronica, fev, dee, transmision-mismo-dia, consulta-adquiriente, 2025]
keyValues:
  fecha_expedicion: "2025-03-31"
  fecha_publicacion: "2025-04-01"
  norma_modificada: "Res 165/2023"
  norma_compiladora: "Res 227/2025"
  uvt_2026: 52374
fetch_failed: true
---

# Resolución DIAN 000202 de 31-mar-2025 — Modificaciones a la Resolución 000165 de 2023 sobre Sistema de Facturación Electrónica

> **Nota de extracción**: el PDF oficial es procesable únicamente como datos binarios codificados (CCITT Fax). Esta síntesis se elabora a partir de fuentes secundarias confiables (DIAN comunicado de prensa, Litax, Sovos, MS Legal, Gosocket, Prospectiva en Tecnología, Alegra, Alcaldía de Bogotá normograma).

## 1. Identificación de la norma

| Campo | Valor |
|-------|-------|
| Número | Resolución DIAN 000202 de 2025 |
| Fecha de expedición | 31 de marzo de 2025 |
| Fecha de publicación | 1 de abril de 2025 |
| Entidad | Dirección de Impuestos y Aduanas Nacionales (DIAN) |
| Norma modificada | Resolución 000165 de 2023 |
| Norma compiladora posterior | Resolución 000227 de 2025 (consolidación) |
| Fundamento | Arts. 615, 616-1 y 631 ET; Decreto 358 de 2020 |

## 2. Objetivos de la modificación

La DIAN expidió la Res 000202 con cuatro propósitos centrales:

1. **Optimizar la trazabilidad tributaria** del sistema de Factura Electrónica de Venta (FEV).
2. **Reforzar el control sobre la facturación electrónica** en operaciones B2C.
3. **Proteger la información personal** de los adquirientes (consumidores).
4. **Habilitar el Servicio de Consulta del Adquiriente** mediante un canal en línea.

## 3. Cambios principales

### 3.1 Confirmación del plazo de transmisión "mismo día"

Se ratifica la regla incorporada por la Res 165/2023: **la factura electrónica de venta debe transmitirse a la DIAN el mismo día de su generación** (en tiempo real, no más allá del día calendario en que se emite). Esta regla reemplaza al antiguo plazo de 10 días que regía bajo la Res 042/2020.

### 3.2 Servicio de Consulta del Adquiriente

Se crea un canal en el portal de la DIAN donde cualquier ciudadano (con autenticación por cédula y clave) puede consultar las facturas electrónicas que se han transmitido a su nombre. Este servicio permite:

- Verificar **operaciones de consumo** registradas a nombre del consumidor.
- Detectar **suplantación de identidad** o uso indebido del NIT/cédula.
- Validar el **valor del IVA** descontable potencial.

**Disponibilidad**: a partir de la **segunda semana de abril de 2025**.

### 3.3 Restricciones sobre datos personales

La Resolución 202/2025 establece límites a la captura de datos del adquiriente. Solo pueden requerirse aquellos datos **estrictamente necesarios** para la operación tributaria:

- **Operaciones B2C de consumo masivo**: el facturador NO puede exigir cédula, dirección, teléfono ni correo electrónico si el adquiriente no los suministra voluntariamente.
- Los datos no esenciales **no pueden ser capturados** ni transmitidos.
- Cuando el comprador no se identifica, la factura debe ir a nombre de **"Consumidor Final"** con tipificación 222222222222.
- **Sanción**: pérdida de la condición de proveedor habilitado por incumplimiento sistemático.

### 3.4 Documento Equivalente Electrónico (DEE)

Se ratifican y precisan las reglas para los DEE, en particular para el sistema POS:

- Operaciones inferiores a 5 UVT (≈ $261.870 en 2026) pueden continuar emitiendo DEE-POS.
- Operaciones superiores deben emitir FEV (con datos completos).
- El cliente puede solicitar que se emita FEV en lugar de DEE-POS aunque la operación sea menor a 5 UVT.

### 3.5 Validaciones técnicas adicionales

- Se incorporan reglas de validación adicionales para evitar duplicidad de CUFE.
- Validación de coherencia entre fecha y hora de emisión.
- Verificación de identidad del proveedor tecnológico autorizado.

## 4. Plazos de implementación

| Cambio | Fecha de aplicación |
|--------|---------------------|
| Vigencia general de la Res 202/2025 | 1 de abril de 2025 |
| Servicio Consulta Adquiriente activo | Segunda semana de abril 2025 |
| Restricciones sobre datos personales | 1 de abril de 2025 |
| Validaciones técnicas adicionales | 1 de abril de 2025 |

## 5. Impacto operativo

### 5.1 Para facturadores

- **Actualizar el procedimiento de captura** del adquiriente: solo solicitar datos opcionalmente.
- **Mantener el plazo de transmisión "mismo día"**: si hay incidente técnico, ya existe régimen de contingencia (48 h tras restablecimiento).
- **Adoptar la opción "Consumidor Final"** cuando el cliente no se identifica voluntariamente.

### 5.2 Para proveedores tecnológicos

- Ajustar **interfaces de captura** en POS y software contable para no requerir datos personales obligatoriamente en B2C.
- Validar que la **transmisión sea inmediata** y no se acumule en lotes.

### 5.3 Para consumidores

- Pueden **consultar libremente** sus facturas en el portal DIAN.
- Tienen derecho a **negarse a entregar datos** cuando la operación es B2C de consumo masivo.
- Pueden **denunciar** capturas indebidas de información personal ante la DIAN y/o la SIC (Superintendencia de Industria y Comercio).

## 6. Sanciones por incumplimiento

### 6.1 Por no transmitir el mismo día (Art. 651 ET, adaptado)

- 1 UVT por cada día calendario de retraso.
- 2026: 1 UVT × $52.374 = $52.374 por día.
- Tope: 15.000 UVT = $785.610.000.

### 6.2 Por no expedir factura (Art. 652-1 ET)

- 1% del valor de la operación.
- Tope: 950 UVT = $49.755.300 (con UVT 2026).
- Reducción al 50% si se subsana antes del emplazamiento.

### 6.3 Por capturar datos personales sin consentimiento

- Régimen sancionatorio de la Ley 1581 de 2012 (protección de datos).
- Multas SIC: hasta 2.000 SMMLV.
- Régimen DIAN para incumplimiento sistemático: pérdida de habilitación.

## 7. Articulado relevante (síntesis)

**Artículo 1°**: Modifica el Art. 11 de la Res 165/2023 — confirma transmisión "mismo día".

**Artículo 2°**: Modifica el Art. 31 de la Res 165/2023 — establece restricciones en datos del adquiriente.

**Artículo 3°**: Adiciona Art. 32-1 a la Res 165/2023 — crea el Servicio de Consulta del Adquiriente.

**Artículo 4°**: Modifica el Art. 41 de la Res 165/2023 — ajusta validaciones técnicas.

**Artículo 5°**: Vigencia.

## 8. Estado actual (2026)

A partir de la entrada en vigencia de la **Resolución Única DIAN 000227 de 2025** (25-sep-2025), las disposiciones de la Res 202/2025 quedaron **incorporadas en el cuerpo de la Res 227/2025**, conforme al modelo compilatorio. La Res 202/2025 sigue siendo la fuente de origen, pero la consulta operativa debe hacerse sobre la Res 227/2025.

## 9. Recomendaciones a contadores y empresas

1. **Actualizar políticas de privacidad** para reflejar la opción "Consumidor Final".
2. **Capacitar a personal de caja** y POS sobre la nueva regla de no exigir datos personales innecesarios.
3. **Validar con el proveedor tecnológico** que la transmisión es realmente del "mismo día" (no batch nocturno).
4. **Implementar protocolos de respuesta a incidentes** tecnológicos (contingencia 48 h).
5. **Revisar mensualmente** las consultas de adquirientes vs. el libro de ventas para detectar discrepancias.

## 10. Diferencias prácticas con la Res 165/2023 original

| Aspecto | Res 165/2023 original | Res 202/2025 |
|---------|----------------------|--------------|
| Plazo de transmisión | Mismo día | Mismo día (ratificado) |
| Captura datos adquiriente | Permisiva | Restrictiva (mínimo necesario) |
| Servicio consulta consumidor | No existía | Creado y activo |
| Validaciones técnicas | Versión inicial | Reforzadas |
| Sanción por incumplimiento captura datos | No expresa | Régimen Ley 1581 + DIAN |
| Tipificación "Consumidor Final" | Implícita | Explícita |

## Fuente

- **DIAN** — *Comunicado de Prensa No. 026 de 2025 — Resolución 000202*. Consultado: 2026-05-02. https://www.dian.gov.co/Prensa/Paginas/NG-Comunicado-de-Prensa-026-2025.aspx
- **DIAN** — *PDF Resolución 000202 de 31-03-2025*. https://www.dian.gov.co/normatividad/Normatividad/Resoluci%C3%B3n%20000202%20de%2031-03-2025.pdf
- **Litax** — *DIAN expidió Resolución 000202 que modifica Resolución sobre facturación electrónica*. https://litax.co/2025/04/11/dian-expidio-resolucion-000202-que-modifica-resolucion-sobre-facturacion-electronica/
- **Sovos** — *Resolución 000202 de 2025: menos fricción para facturar, más simplicidad*. https://sovos.com/es/blog/iva/resolucion-000202-facturacion-mas-simple-colombia/
- **MS Legal** — *DIAN ajusta la factura electrónica: menos datos, más claridad*. https://mslegal.com.co/dian-ajusta-la-factura-electronica/
- **Gosocket** — *Cambios DIAN: Factura Electrónica y consulta de adquirientes*. https://gosocket.net/centro-de-recursos/cambios-dian-factura-electronica-y-consulta-de-adquirientes/
- **Prospectiva en Tecnología** — *Colombia: Cambios clave en la Factura Electrónica de Venta y Documento Equivalente Electrónico*. https://www.prospectiva.com.mx/?p=17760
- **Alegra** — *Plazos para emitir facturas electrónicas en Colombia 2026*. https://blog.alegra.com/colombia/plazos-para-emitir-facturas-electronicas/
- **Alcaldía de Bogotá Normograma** — *Resolución 202 de 2025 DIAN*. https://www.alcaldiabogota.gov.co/sisjur/normas/Norma1.jsp?i=179461
- **DIAN Normativa Factura Electrónica**. https://www.dian.gov.co/impuestos/factura-electronica/documentacion/Paginas/normativa.aspx
