# Modulo de Procesamiento Documental para PYMEs sin ERP

## Prompt de Implementacion para Claude Code

```
Actua como Principal Engineer de UtopIA. Tu tarea es disenar e implementar un
nuevo modulo de procesamiento documental DENTRO de la aplicacion existente.

NO es un producto separado. Es un modulo del core de UtopIA que complementa
el sistema de integraciones ERP existente, sirviendo como "ERP virtual" para
PYMEs colombianas que no tienen un sistema contable formal.

## CONTEXTO CRITICO — LEE ANTES DE HACER NADA

### Que es UtopIA
Plataforma AI de inteligencia contable, tributaria y financiera para Colombia.
Next.js 16 (App Router), React 19, TypeScript strict, Tailwind CSS 4, Motion v12.
Backend: multi-agente OpenAI (gpt-5.4-mini 400K ctx para pipelines, gpt-4o-mini
para chat, gpt-4o para OCR Vision). RAG sobre normativa colombiana (HNSWLib).

### Arquitectura existente que DEBES usar
- Path alias: `@/*` → `./src/*`
- Tipos compartidos: `src/types/platform.ts` (CaseType, CompanyMetadata, etc.)
- Upload existente: `src/app/api/upload/route.ts` — ya tiene:
  - OCR via GPT-4o Vision (imagenes + PDFs escaneados)
  - Extraccion de texto (PDF, DOCX, XLSX, CSV)
  - Magic bytes validation
  - `classifyDocument()` — clasificador heuristico zero-LLM
  - `parseTrialBalanceCSV()` + `preprocessTrialBalance()` — validacion PUC
  - Vectorizacion RAG automatica
- ERP connectors: `src/lib/erp/` — tipos normalizados (ERPAccount, ERPTrialBalance,
  ERPJournalEntry, ERPInvoice, ERPContact) que el modulo DEBE reutilizar
- Contexto workspace: `src/context/WorkspaceContext.tsx` — estado global
- Design system: `src/design-system/` — 12 componentes primitivos
- Intake forms: `src/components/workspace/intake/` — patron Upload-Extract-Review
- Patron de agentes: `src/lib/agents/financial/` — sequential/parallel orchestration

### Los 11 modulos que este sistema alimenta
Chat General, Defensa DIAN, Devoluciones, Due Diligence, Inteligencia Financiera,
Reporte NIIF Elite, Planeacion Tributaria, Precios de Transferencia, Valoracion
Empresarial, Dictamen Revisoria Fiscal, Conciliacion Fiscal, Estudio de Factibilidad.

### Quien es el usuario
Contador independiente o dueno de PYME colombiana que:
- NO tiene Siigo, Alegra ni ningun ERP
- Lleva contabilidad en Excel, papel o "en la cabeza"
- Tiene extractos bancarios (PDF de Bancolombia/Davivienda), facturas (DIAN FE),
  recibos de caja, comprobantes de egreso, fotos de recibos con el celular
- Necesita que UtopIA convierta esos documentos en datos contables estructurados
  para poder usar los 11 modulos de la plataforma

## OBJETIVO DEL MODULO

Crear un pipeline de procesamiento documental que convierta documentos fisicos y
digitales desorganizados en datos contables estructurados que alimenten directamente
los 11 pipelines multi-agente existentes de UtopIA.

Es el "ERP virtual" para quien no tiene ERP.

## ALCANCE

### Tipos de documentos a procesar (MVP)
1. Extractos bancarios (PDF — Bancolombia, Davivienda, Banco de Bogota, BBVA, Scotiabank)
2. Facturas electronicas DIAN (XML UBL 2.1 o PDF con CUFE)
3. Facturas fisicas/escaneadas (foto o scan)
4. Recibos de caja menor
5. Comprobantes de egreso
6. Notas debito/credito
7. Certificados de retencion en la fuente
8. Declaraciones tributarias (PDF DIAN)
9. Nomina / desprendibles de pago

### Datos de salida normalizados
El output DEBE usar los tipos existentes de `src/lib/erp/types.ts`:
- `ERPJournalEntry` — asientos contables generados
- `ERPInvoice` — facturas normalizadas
- `ERPContact` — terceros extraidos
- `ERPAccount` — cuentas PUC detectadas
- `ERPTrialBalance` — balance de prueba construido desde los documentos

### Integracion con modulos existentes
Los datos procesados deben ser consumibles por:
- Reporte NIIF Elite (como si viniera de un ERP real)
- Conciliacion Fiscal (diferencias NIIF vs fiscal)
- Dictamen Revisoria Fiscal (opinion sobre los EEFF generados)
- Planeacion Tributaria (con datos reales de facturacion e ingresos)
- Inteligencia Financiera (flujo de caja real desde extractos bancarios)

## REQUERIMIENTOS FUNCIONALES

### Pipeline de procesamiento (4 etapas)

ETAPA 1 — INGESTION
- Carga masiva: multiples archivos en una sesion (drag & drop batch)
- Formatos: PDF, JPG, PNG, HEIC, XLSX, CSV, XML (UBL 2.1)
- Limite: 25MB por archivo, hasta 50 archivos por batch
- Progreso por archivo con barra individual
- Deduplicacion: detectar si un documento ya fue procesado (hash SHA-256)
- Mobile-first: soporte para fotos tomadas directamente con la camara

ETAPA 2 — EXTRACCION (AI)
- OCR: usar el pipeline existente de `extractTextFromImage()` y
  `extractTextFromScannedPDF()` en `src/app/api/upload/route.ts`
- Extraccion de entidades con GPT-4o-mini (nuevo agente):
  - Fecha, numero de documento, NIT emisor, NIT receptor
  - Concepto/descripcion, valor bruto, IVA, retencion, neto
  - Tipo de movimiento (debito/credito)
  - Cuenta bancaria (para extractos)
  - CUFE (para facturas electronicas)
  - Cuenta PUC sugerida (clasificacion contable)
- Score de confianza por campo (0.0 a 1.0)
- Clasificacion del tipo de documento (factura, extracto, recibo, etc.)

ETAPA 3 — NORMALIZACION
- Mapeo a tipos ERPJournalEntry/ERPInvoice/ERPContact existentes
- Asignacion de cuenta PUC basada en:
  - Tipo de documento (factura compra → 2205 Proveedores)
  - Concepto detectado (arriendo → 5120 Arrendamientos)
  - Reglas aprendidas del usuario (si el usuario corrige, memorizar)
- Generacion de contrapartida contable automatica
- Calculo de impuestos: IVA 19%, Rete-IVA, Rete-Fuente por concepto
- Formato COP: separador de miles punto, decimales coma

ETAPA 4 — VALIDACION Y REVISION
- Dashboard de revision: tabla con todos los documentos procesados
- Semaforo por documento: verde (>0.85 confianza), amarillo (0.60-0.85), rojo (<0.60)
- Los rojos requieren revision manual obligatoria antes de continuar
- Edicion inline de campos extraidos
- Aprobacion batch: "aprobar todos los verdes"
- Al aprobar: los datos pasan a estar disponibles para los 11 modulos

### Funcionalidades adicionales
- Asociacion a empresa (CompanyMetadata), periodo fiscal, usuario
- Consolidacion automatica: genera ERPTrialBalance desde los asientos aprobados
- Conciliacion bancaria basica: cruza extracto vs facturas/recibos
- Timeline/historial: ver todos los documentos por empresa y periodo
- Exportar datos procesados como CSV/Excel

## REQUERIMIENTOS NO FUNCIONALES
- Modularidad: nuevo directorio `src/lib/document-processing/`
- Reutilizar: tipos de `src/lib/erp/types.ts`, OCR de upload route, design system
- Sin base de datos: persistencia en localStorage (igual que el resto de la app)
- PII: pasar por `src/lib/security/pii-filter.ts` antes de enviar a LLM
- Trazabilidad: cada documento tiene un ID unico y log de procesamiento
- Extensible: facil agregar nuevos tipos documentales (plantillas de extraccion)

## ARQUITECTURA PROPUESTA

### Estructura de carpetas
```
src/lib/document-processing/
├── types.ts                    # DocumentType, ProcessedDocument, ExtractionResult,
│                               # ConfidenceScore, ProcessingStatus, DocumentBatch
├── pipeline.ts                 # orchestrateDocumentProcessing() — 4 etapas
├── classifier.ts               # classifyDocumentType() — usa GPT-4o-mini
├── extractors/
│   ├── base-extractor.ts       # Interfaz base
│   ├── bank-statement.ts       # Extractos bancarios (Bancolombia, Davivienda, etc.)
│   ├── invoice.ts              # Facturas (electronicas + fisicas)
│   ├── receipt.ts              # Recibos de caja, comprobantes de egreso
│   ├── tax-document.ts         # Certificados retencion, declaraciones DIAN
│   └── payroll.ts              # Nomina / desprendibles
├── normalizer.ts               # Mapeo a ERPJournalEntry/ERPInvoice/ERPContact
├── puc-mapper.ts               # Asignacion automatica de cuentas PUC
├── confidence-scorer.ts        # Calculo de score de confianza por campo
├── deduplicator.ts             # Hash SHA-256 para evitar duplicados
├── consolidator.ts             # Genera ERPTrialBalance desde asientos aprobados
└── storage.ts                  # Persistencia localStorage de documentos procesados

src/app/api/document-processing/
├── upload/route.ts             # POST — recibe batch de archivos
├── status/route.ts             # GET — estado del procesamiento
├── review/route.ts             # POST — aprobar/rechazar/editar documentos
└── consolidate/route.ts        # POST — generar balance de prueba consolidado

src/components/workspace/
├── DocumentProcessing.tsx      # Vista principal del modulo
├── DocumentReviewTable.tsx     # Tabla de revision con semaforo
├── DocumentTimeline.tsx        # Historial por empresa/periodo
└── BankReconciliation.tsx      # Conciliacion bancaria basica
```

### Patron de agentes para extraccion
Seguir el patron de `src/lib/agents/financial/agents/niif-analyst.ts`:
- Modelo: `gpt-4o-mini` para clasificacion y extraccion (rapido, barato)
- Modelo: `gpt-4o` Vision para OCR de documentos escaneados/fotos
- `withRetry` de `src/lib/agents/utils/retry.ts`
- Prompts en `src/lib/document-processing/prompts/`
- Anti-alucinacion: solo extraer datos que EXISTEN en el documento
- Temperature 0.05 para extraccion (precision maxima)

### Integracion con el workspace
- Nuevo CaseType: NO necesario. Este modulo es una HERRAMIENTA que alimenta
  los CaseTypes existentes, no un caso de uso independiente.
- Acceso: desde la pagina de settings (`/workspace/settings`) como nueva tab
  "Documentos" junto a "Integraciones ERP" y "Preferencias"
- O desde un boton "Procesar Documentos" en el WelcomeScreen
- Los datos procesados y aprobados quedan disponibles como si fueran datos
  de un ERP conectado — mismos tipos, misma interfaz

### Flujo de estados del documento
```
UPLOADED → EXTRACTING → EXTRACTED → NORMALIZING → NORMALIZED →
REVIEW_REQUIRED (si confianza < 0.85) → APPROVED / REJECTED →
CONSOLIDATED (cuando se genera el balance)
```

### MVP (Fase 1)
1. Upload batch de PDFs e imagenes
2. OCR + extraccion de facturas y extractos bancarios
3. Tabla de revision con semaforo
4. Aprobacion manual
5. Generacion de ERPTrialBalance desde documentos aprobados
6. Boton "Crear Reporte NIIF con estos datos" que alimenta el pipeline existente

### Fase 2
7. Conciliacion bancaria automatica
8. Memoria de clasificacion PUC (aprende de correcciones del usuario)
9. Procesamiento de nomina y certificados de retencion
10. Dashboard analitico (documentos por tipo, montos, tendencias)

### Fase 3
11. Captura desde camara movil (PWA)
12. Procesamiento en tiempo real (webhook cuando llega email con factura)
13. Exportacion a formatos DIAN (informacion exogena)
14. Integracion con facturacion electronica saliente

## INSTRUCCIONES DE IMPLEMENTACION

1. Lee CLAUDE.md para entender las convenciones del proyecto
2. Lee `src/lib/erp/types.ts` para los tipos que debes reutilizar
3. Lee `src/app/api/upload/route.ts` para el OCR y clasificacion existente
4. Lee `src/lib/agents/financial/agents/niif-analyst.ts` para el patron de agentes
5. Lee `src/lib/preprocessing/trial-balance.ts` para el preprocesador PUC
6. Implementa el MVP (Fase 1) completo con tests de compilacion
7. Cada archivo debe compilar con `npx tsc --noEmit`
8. Build final: `npm run build` debe pasar limpio
9. UVT 2026 = $52,374 COP. Tarifa renta PJ = 35%. IVA general = 19%.
10. Todo en espanol. TypeScript strict. Zero `any`.
```

## NOTAS PARA EL IMPLEMENTADOR

### Por que este modulo es critico
El 85% de las PYMEs colombianas no tienen ERP. Tienen:
- Una carpeta con PDFs de facturas
- Extractos bancarios descargados del portal del banco
- Fotos de recibos en el celular
- Un Excel con "algo" de contabilidad

Este modulo es lo que convierte ese caos en datos estructurados que alimentan
los 11 pipelines de agentes de UtopIA. Sin este modulo, esas PYMEs no pueden
usar la plataforma. Con este modulo, cualquier PYME puede subir sus documentos
y obtener estados financieros NIIF, planeacion tributaria, dictamen de revisoria
fiscal y todo lo demas — sin necesitar un ERP.

### Diferenciador competitivo
Ninguna plataforma colombiana combina:
1. OCR inteligente (GPT-4o Vision)
2. Clasificacion automatica de documentos
3. Asignacion PUC automatica
4. Generacion de asientos contables
5. Consolidacion a balance de prueba
6. Alimentacion directa a pipeline multi-agente de EEFF NIIF
...todo en un solo flujo. Siigo, Alegra y Helisa requieren digitacion manual.
