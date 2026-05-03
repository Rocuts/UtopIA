---
slug: facturacion_electronica_2026
title: "Facturación Electrónica en Colombia — Guía Práctica 2026"
docType: guide
entity: DIAN
year: 2026
normCode: "Resolución DIAN 000227/2025"
status: vigente
lastVerified: 2026-05-02
tags: [facturacion-electronica, dian, cufe, ubl, xml]
---

# Facturación Electrónica en Colombia — Guía Práctica 2026

## Introducción

La facturación electrónica es el sistema de emisión de facturas en formato digital (XML) validado previamente por la DIAN. Colombia ha implementado progresivamente este sistema, siendo hoy obligatorio para la mayoría de contribuyentes responsables del IVA y del Impuesto Nacional al Consumo (INC). El marco normativo principal está contenido en la Resolución Única DIAN 000227 de 2025 y sus modificaciones.

---

## 1. Marco Legal

### Normas Principales

- **Ley 1943 de 2018** y **Ley 2010 de 2019**: establecieron la factura electrónica como sistema de facturación obligatorio.
- **Decreto 358 de 2020**: reglamentó la facturación electrónica y el documento soporte en operaciones con no obligados a facturar.
- **Resolución 000165 de 2023**: reguló en detalle el sistema de facturación electrónica.
- **Resolución 000202 de 2025**: modificaciones importantes al sistema.
- **Resolución 000227 de 2025**: compilación única vigente desde octubre de 2025 que integra toda la regulación del sistema de facturación electrónica.

### Sujetos Obligados

Están obligados a facturar electrónicamente:

- Personas naturales y jurídicas responsables del IVA.
- Responsables del Impuesto Nacional al Consumo (INC).
- Comerciantes, importadores y prestadores de servicios.
- Entidades sin ánimo de lucro cuando realicen actividades gravadas.

**No están obligados:**
- Personas naturales no responsables de IVA (ingresos brutos inferiores a 3.500 UVT = $183.309.000 en 2026, entre otros requisitos del Art. 437 del E.T.).
- Entidades del régimen simple de tributación que no sean responsables de IVA.
- Bancos, entidades financieras y aseguradoras (para ciertos documentos específicos).

---

## 2. Tipos de Documentos Electrónicos

### 2.1 Factura Electrónica de Venta

Documento principal que soporta la venta de bienes o prestación de servicios. Debe contener:

- NIT y razón social del emisor y receptor.
- Número consecutivo autorizado por la DIAN.
- Fecha y hora de generación y validación.
- Descripción de bienes o servicios.
- Valor unitario y total.
- Discriminación del IVA, INC u otros impuestos.
- Código Único de Factura Electrónica (**CUFE**).
- Firma electrónica del emisor.
- Código QR para verificación.

**Desde mayo de 2025**: las facturas electrónicas deben emitirse exclusivamente en pesos colombianos (COP).

**Desde abril de 2025**: se simplificó la información del comprador, requiriéndose únicamente el tipo y número de identificación.

### 2.2 Nota Crédito Electrónica

Documento que anula parcial o totalmente una factura electrónica previamente validada. Se utiliza para:

- Devoluciones de mercancías.
- Descuentos posteriores a la emisión de la factura.
- Corrección de errores en factura (valor, cantidad, descripción).

Debe referenciar la factura electrónica original mediante su CUFE.

### 2.3 Nota Débito Electrónica

Documento que incrementa el valor de una factura electrónica previamente validada. Se utiliza para:

- Cobro de intereses de mora.
- Ajustes por incremento en precios o cantidades.

### 2.4 Documento Soporte en Adquisiciones

Se emite cuando se adquieren bienes o servicios de personas **no obligadas a facturar**. Es obligatorio para soportar costos y deducciones en renta y descontar IVA cuando aplique.

- Debe contener los datos del vendedor o prestador del servicio.
- Se transmite electrónicamente para validación de la DIAN.
- Genera un Código Único de Documento Soporte (**CUDS**).

### 2.5 Nómina Electrónica

Documento electrónico que soporta los costos y deducciones derivados de pagos laborales. Obligatorio desde 2022 para todos los empleadores.

**Contenido:**
- Identificación del empleador y trabajador.
- Valor del salario, horas extras, comisiones y otros pagos.
- Deducciones (aportes a seguridad social, retención en la fuente, libranzas).
- Valor neto pagado.

**Frecuencia de transmisión:** mensual, dentro de los primeros 10 días del mes siguiente al pago.

**Notas de ajuste:** cuando se requiera modificar una nómina electrónica previamente transmitida, se emite una nota de ajuste de nómina electrónica.

---

## 3. Requisitos Técnicos

### Formato y Transmisión

- **Formato**: XML firmado electrónicamente conforme al estándar UBL 2.1.
- **Validación previa**: la factura debe ser transmitida a la DIAN para validación **antes** de su entrega al adquirente.
- **Tiempo de validación**: la DIAN valida en tiempo real (segundos). Si no responde en el plazo establecido, se activa el modo de contingencia.
- **Representación gráfica**: se debe generar una representación gráfica (PDF) de la factura para entrega al cliente, junto con el archivo XML.

### Firma Electrónica

- Se requiere certificado de firma digital emitido por una entidad certificadora autorizada en Colombia.
- La firma garantiza la integridad y autenticidad del documento.

### Habilitación ante la DIAN

1. Registrar el software de facturación en el portal de la DIAN (catalogo-vpfe.dian.gov.co).
2. Obtener la autorización de numeración de facturación.
3. Realizar pruebas en el ambiente de habilitación (sandbox).
4. Una vez aprobadas las pruebas, pasar al ambiente de producción.

### Proveedores Tecnológicos

Los contribuyentes pueden:
- Desarrollar su propio software de facturación.
- Contratar un proveedor tecnológico autorizado por la DIAN.
- Utilizar la solución gratuita de la DIAN (con limitaciones funcionales).

---

## 4. Errores Comunes y Soluciones

| Error | Causa | Solución |
|---|---|---|
| Rechazo por CUFE duplicado | Factura con mismo número enviada dos veces | Verificar consecutivo antes de retransmitir |
| Rechazo por NIT inválido | NIT del receptor incorrecto o no registrado en RUT | Verificar datos del cliente en RUES o portal DIAN |
| Error en firma electrónica | Certificado vencido o mal configurado | Renovar certificado digital |
| Rechazo por formato XML | Campos obligatorios faltantes o mal formateados | Validar XML contra esquema XSD antes de enviar |
| Timeout en validación | Indisponibilidad del servicio DIAN | Activar modo contingencia y retransmitir después |
| Error en resolución de numeración | Rango de numeración agotado o vencido | Solicitar nueva resolución en portal DIAN |

---

## 5. Contingencia

Cuando el servicio de validación de la DIAN no está disponible:

1. Se genera la factura en formato electrónico con nota de contingencia.
2. Se asigna un consecutivo del rango autorizado.
3. Se entrega al adquirente con la nota de que está pendiente de validación.
4. Una vez restablecido el servicio, se transmiten todas las facturas pendientes dentro de las **48 horas** siguientes.

---

## 6. Sanciones por Incumplimiento

- **No facturar electrónicamente**: clausura del establecimiento por 3 días (Art. 657 E.T.) y sanción pecuniaria del 1% del valor de las operaciones no facturadas.
- **Facturar sin requisitos**: sanción del 1% del valor de las operaciones facturadas sin el lleno de los requisitos, sin exceder 950 UVT ($49.755.300 en 2026) por factura.
- **No transmitir nómina electrónica**: desconocimiento de costos y deducciones laborales en la declaración de renta.

---

## 7. Proyecto de Resolución 2026

La DIAN publicó en 2026 un proyecto de resolución para regularizar a contribuyentes que incumplieron con la facturación electrónica, ofreciendo un período de transición para ponerse al día sin sanciones completas, siempre que se subsane el incumplimiento dentro del plazo establecido.

---

*Documento de referencia para la base de conocimiento de 1+1. Para la normativa actualizada, consultar dian.gov.co y la Resolución Única 000227 de 2025.*
