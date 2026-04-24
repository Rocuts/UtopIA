<p align="center">
  <img src="public/logo-modern.png" alt="1+1" width="80" style="border-radius: 16px" />
</p>

<h1 align="center">1+1</h1>

<p align="center">
  <strong>Directorio Ejecutivo Digital — impulsado por IA para empresas colombianas</strong>
</p>

<p align="center">
  <code>11 pipelines multi-agente</code> · <code>18+ agentes especializados</code> · <code>17 API endpoints</code> · <code>11 tipos de caso</code>
</p>

<p align="center">
  Next.js 16 · React 19 · TypeScript · OpenAI · LangChain · Tailwind CSS 4 · Motion
</p>

---

## Que es 1+1

**1+1** es el Directorio Ejecutivo Digital colombiano: una plataforma de inteligencia contable, tributaria, financiera y de aseguramiento que transforma datos contables en bruto en reportes de nivel corporativo. Combina orquestacion multi-agente, RAG sobre normativa colombiana curada, busqueda web en tiempo real y un pipeline de 8 nodos (3 agentes + 4 auditores + meta-auditor) para producir estados financieros NIIF, analisis estrategico, gobierno corporativo, auditoria y calificacion de calidad — todo en un solo flujo automatizado.

La plataforma no es un chatbot con una caja de texto. Es un **centro de comando estrategico elite** estructurado en cuatro areas de alto impacto — Escudo (tributario/legal), Valor (financiero/valoracion), Verdad (aseguramiento) y Futuro (proyeccion economica) — con flujos de intake estructurados, visualizacion de pipeline en tiempo real y un panel de inteligencia contextual que actua como co-piloto permanente.

---

## Arquitectura de la Plataforma

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          FRONTEND · 3 PANELES                          │
│                                                                         │
│  ┌──────────┐  ┌──────────────────────────────────┐  ┌──────────────┐  │
│  │NAVIGATOR │  │           MAIN WORKSPACE          │  │ INTELLIGENCE │  │
│  │          │  │                                    │  │    PANEL     │  │
│  │ 5+1 Case │  │  Welcome · Chat · Pipeline · Docs │  │              │  │
│  │  Types   │  │                                    │  │  7 Estados   │  │
│  │          │  │  Intake Modal (5 formularios)      │  │  Contextuales│  │
│  │ Case     │  │  Pipeline Monitor (8 nodos)        │  │              │  │
│  │ List     │  │  Document Viewer (nav + export)    │  │  Risk · Cite │  │
│  │          │  │                                    │  │  Audit · QA  │  │
│  └──────────┘  └──────────────────────────────────┘  └──────────────┘  │
│       240px              Flexible                         340px         │
│                                                                         │
│  StatusBar ─────────────────────────────────────────────────────────── │
│  CommandPalette (Cmd+K) ─────────────────────────────────────────────  │
│  Toast Notifications ────────────────────────────────────────────────  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                              SSE Streaming
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                           BACKEND · 5 PIPELINES                        │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  PIPELINE 1 · Chat Multi-Agente (Orchestrator-Workers)         │   │
│  │  Classifier (T1/T2/T3) → Enhancer → Specialists → Synthesizer │   │
│  │  2 agentes: Tributario (6 tools) + Contable (4 tools)          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  PIPELINE 2 · Reporte NIIF Elite (Secuencial, gpt-5.4-mini)   │   │
│  │  Analista NIIF → Director Estrategia → Gobierno Corporativo    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  PIPELINE 3 · Auditoria (4 en paralelo, Promise.allSettled)    │   │
│  │  [NIIF] [Tributario] [Legal] [Revisoria Fiscal]                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  PIPELINE 4 · Meta-Auditor de Calidad (12 dimensiones)         │   │
│  │  IASB · IFRS 18 · ISO 25012 · ISO 42001 · CTCP                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  PIPELINE 5 · Preprocesamiento + Excel (Deterministico)        │   │
│  │  PUC Parser → Ecuacion Patrimonial → ExcelJS (5 tabs)          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  RAG (HNSWLib) · Tavily Web Search · PII Redaction · Zod Validation   │
│  WebRTC Voice · OCR (GPT-4o Vision) · i18n (es/en)                    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Casos de Uso

### 1. Defensa DIAN

Intake estructurado de 4 pasos: tipo de acto administrativo, impuestos involucrados, monto en disputa, documentos soporte. El sistema analiza con base en el Estatuto Tributario, calcula sanciones (Arts. 641/644/647/634), evalua riesgo (0-100) y genera borradores de respuesta en formato oficial DIAN.

### 2. Devoluciones de Saldos a Favor

Formulario guiado para IVA, renta o retencion en la fuente (Arts. 850-865 E.T.). Incluye verificacion de requisitos, preparacion de expediente tecnico, analisis de riesgo de verificacion y seguimiento del tramite.

### 3. Due Diligence Financiero

Diagnostico integral para credito, inversion, venta o fusion. Analisis de indicadores NIIF (liquidez, rentabilidad, endeudamiento), identificacion de contingencias tributarias y laborales, y reporte estructurado por grupo NIIF (1, 2, 3).

### 4. Inteligencia Financiera

Seleccion multiple de analisis: flujo de caja, punto de equilibrio, valoracion DCF, estructura de costos, indicadores de rentabilidad, simulacion tributaria, escenarios de fusion. Cada analisis genera outputs especificos con formulas, graficos y recomendaciones.

### 5. Reporte NIIF Elite — El Producto Estrella

El unico sistema en Colombia que combina **8 nodos de procesamiento** en un solo pipeline automatizado:

```
FASE 1 · Generacion Secuencial (gpt-5.4-mini, 400K contexto)
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Agente 1    │ ──→ │  Agente 2    │ ──→ │  Agente 3    │
│  Analista    │     │  Director de │     │  Gobierno    │
│  NIIF        │     │  Estrategia  │     │  Corporativo │
└──────────────┘     └──────────────┘     └──────────────┘

FASE 2 · Auditoria en Paralelo (Promise.allSettled)
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│   NIIF   │ │Tributario│ │  Legal   │ │Revisoria │
│ Contable │ │          │ │Societario│ │  Fiscal  │
└──────────┘ └──────────┘ └──────────┘ └──────────┘

FASE 3 · Meta-Auditoria de Calidad
┌──────────────────────────────────────────────────┐
│  IASB · IFRS 18 · ISO 25012 · ISO 42001 · CTCP  │
│  12 Dimensiones → Grade A+ a F                   │
└──────────────────────────────────────────────────┘
```

**Output del pipeline completo:**

| Entregable | Fuente |
|------------|--------|
| 4 Estados Financieros NIIF (Balance, P&G, Flujo Efectivo, Cambios Patrimonio) | Agente 1 |
| Dashboard Estrategico (4 KPIs: Razon Corriente, Margen Neto, ROA, Endeudamiento) | Agente 2 |
| Flujo de Caja Proyectado (3 trimestres, conservador) | Agente 2 |
| Punto de Equilibrio Operativo y Financiero | Agente 2 |
| 13 Notas a los Estados Financieros (NIC 1 par. 112-138) | Agente 3 |
| Acta de Asamblea General Ordinaria (Ley 1258/2008, lista para firma) | Agente 3 |
| Informe de Auditoria con hallazgos por severidad | 4 Auditores |
| Opinion Formal tipo NIA 700 (favorable / con salvedades / desfavorable) | Revisor Fiscal |
| Calificacion de Calidad A+ a F (12 dimensiones) | Meta-Auditor |
| Excel Profesional (.xlsx, 5 pestanas con formato corporativo) | ExcelJS |

---

## Nuevos Modulos Profesionales (2026)

### 6. Planeacion Tributaria — Tributarista Senior

Pipeline secuencial de 3 agentes que analiza la carga fiscal actual y genera estrategias de optimizacion legales:

| Agente | Funcion | Normativa |
|--------|---------|-----------|
| **Optimizador Tributario** | Analisis de estructura fiscal, estrategias de ahorro | Art. 240 ET (35%), SIMPLE (903-916), ZF (240-1, 20%), ZOMAC, Economia Naranja |
| **Analista Impacto NIIF** | Efectos contables de cada estrategia | NIC 12 (diferido), NIC 37 (provisiones), NIIF 10 (consolidacion) |
| **Validador Cumplimiento** | Riesgo regulatorio y anti-abuso | Art. 869 ET (GAAR), Art. 118-1 (subcapitalizacion), Art. 631-5 (beneficiario real) |

Cubre: SIMPLE vs ordinario, zonas francas, ZOMAC, dividendos (Art. 242), holdings CHC, descuentos I+D+i (Art. 256, 30%), inversiones ambientales (Art. 255, 25%), tasa minima 15% (Pilar 2 OCDE).

### 7. Precios de Transferencia — Tributarista Senior

Pipeline secuencial de 3 agentes para documentacion comprobatoria DIAN:

| Agente | Funcion | Normativa |
|--------|---------|-----------|
| **Analista TP** | Caracterizacion de transacciones, analisis funcional (FAR), seleccion de metodo | Arts. 260-1 a 260-11 ET, 6 metodos (PC/PR/CN/PU/MC/MTU) |
| **Analisis de Comparables** | Benchmarking, rango intercuartil, ajustes | OCDE Guidelines 2022, Art. 260-4 ET (mediana), bases de datos |
| **Documentacion DIAN** | Informe Local, Master File, Formato 1125 | Art. 260-5 ET, Decreto 2120/2017, BEPS Accion 13 |

Umbrales 2026: patrimonio bruto >= 100,000 UVT ($5,237M) O ingresos brutos >= 61,000 UVT ($3,195M). Sanciones hasta 25,000 UVT ($1,309M).

### 8. Valoracion Empresarial — Analista Financiero Senior

Pipeline hibrido (paralelo + sintesis) de 3 agentes:

```
[Modelador DCF]    ──┐
                     ├──→ [Sintetizador de Valoracion]
[Comparables Mdo.] ──┘
```

| Agente | Funcion | Normativa |
|--------|---------|-----------|
| **Modelador DCF** | FCF proyectado, WACC colombiano, valor terminal Gordon | TES 10Y, EMBI, CAPM, Art. 90 ET, NIC 36 |
| **Comparables de Mercado** | EV/EBITDA, P/E, P/BV, ajustes colombianos | NIIF 13 (jerarquia 3 niveles), SuperSociedades |
| **Sintetizador** | Opinion consolidada, ponderacion, rango (bajo/medio/alto) | NIIF 13 (highest and best use), Art. 90 ET |

WACC = (E/V) x Ke + (D/V) x Kd x (1-35%). Ajustes: descuento por tamano (15-30%), iliquidez (20-35%), prima de control (20-40%).

### 9. Dictamen de Revisoria Fiscal — Contador Senior

Pipeline hibrido de 4 agentes (3 paralelos + 1 secuencial):

```
[Empresa en Marcha]    ──┐
[Errores Materiales]   ──┼──→ [Redactor de Dictamen]
[Cumplimiento Legal]   ──┘
```

| Agente | Funcion | Normativa |
|--------|---------|-----------|
| **Evaluador Empresa en Marcha** | NIA 570, indicadores de riesgo, Ley 1116/2006 | Art. 457 C.Co., NIC 1 par. 25-26, NIC 10 |
| **Revisor Errores Materiales** | Materialidad (5% utilidad / 1% activos), misstatements | NIA 315, 320, 330, 450, 500, NIC 8, NIC 37 |
| **Verificador Cumplimiento** | 10 funciones estatutarias, SAGRILAFT, independencia | Art. 207-209 C.Co., Ley 43/1990, Ley 222/1995 |
| **Redactor de Dictamen** | Opinion formal colombiana lista para firma | NIA 700-706, Ley 43/1990 Art. 10, tarjeta profesional |

Opiniones: Favorable (limpia) · Con Salvedades · Desfavorable · Abstencion. Incluye carta de gerencia con recomendaciones.

### 10. Conciliacion Fiscal — Contador + Tributarista

Pipeline secuencial de 2 agentes:

| Agente | Funcion | Normativa |
|--------|---------|-----------|
| **Identificador de Diferencias** | Analisis NIIF vs fiscal por 5 categorias, clasificacion temporal/permanente | Art. 772-1 ET, Formato 2516, Decreto 2235/2017, Art. 21-1 ET |
| **Calculador Impuesto Diferido** | DTA/DTL por diferencia, worksheet, tasa efectiva, journal entries | NIC 12 (par. 15-88), tarifa 35% (Art. 240 ET) |

5 categorias: ingresos (NIIF 15 vs Art. 28 ET), costos/deducciones (NIC 16/38 vs Art. 137 ET), activos (NIIF 13 vs Art. 69 ET), pasivos (NIIF 9 vs fiscal), patrimonio (ORI, superavit). Transmision Formato 2516 obligatoria si ingresos >= 45,000 UVT ($2,357M).

### 11. Estudio de Factibilidad — Economista Senior

Pipeline secuencial de 3 agentes:

| Agente | Funcion | Parametros |
|--------|---------|-----------|
| **Analista de Mercado** | TAM/SAM/SOM, 5 Fuerzas de Porter, demanda, barreras | DANE CIIU Rev. 4, MIPYME (Ley 590/2000), Ley 2069/2020 |
| **Modelador Financiero** | Pro-forma 5-10 anos, VPN, TIR, WACC, punto equilibrio | TES 10Y, EMBI, IBR, Art. 240 ET, ZOMAC/ZF/Naranja |
| **Evaluador de Riesgo** | Matriz 5x5, VPN ajustado, Monte Carlo, go/no-go | Riesgo politico, cambiario (TRM), legal (ANLA), ESG |

SMMLV 2026: $1,423,500 COP. Incentivos modelados: ZOMAC (tarifa progresiva 0%→100%), Zonas Francas (20%), Economia Naranja (exencion 7 anos), Art. 256 (descuento I+D 30%).

---

## Stack Tecnico

| Capa | Tecnologia |
|------|------------|
| **Framework** | Next.js 16 (App Router, Turbopack), React 19, TypeScript strict |
| **LLM** | OpenAI `gpt-4o-mini` (chat), `gpt-5.4-mini` (pipeline, 400K ctx), `gpt-4o` (OCR), `gpt-4o-realtime-preview` (voz) |
| **Orquestacion** | Multi-agente propio: Orchestrator-Workers + Pipeline Secuencial + Auditoria Paralela + Meta-Auditor |
| **Preprocesamiento** | Validador aritmetico determinista (PUC colombiano, clases 1-7, ecuacion patrimonial) |
| **Exportacion** | ExcelJS (`.xlsx` profesional, 5 tabs), jsPDF (conversaciones) |
| **RAG** | LangChain + HNSWLib-node (vector store), `text-embedding-3-small` |
| **Busqueda Web** | Tavily API con filtrado por dominio (dian.gov.co, actualicese.com, etc.) |
| **Voz** | OpenAI Realtime API sobre WebRTC |
| **UI** | Tailwind CSS 4, Motion (Framer Motion v12), Lenis (smooth scroll, root mode), Lucide React, React Three Fiber |
| **Design System** | 12 componentes primitivos propios, token system, barrel export |
| **i18n** | Contexto personalizado (es/en) con persistencia localStorage |
| **Seguridad** | PII redaction, CSP headers, Zod schemas, rate limiting, magic bytes validation |

---

## Frontend — Centro de Comando Profesional

### Design System (`src/design-system/`)

Sistema de diseno autocontenido con tokens y 12 componentes primitivos:

| Componente | Proposito |
|------------|-----------|
| `DSBadge` | Variantes: risk (critico/alto/medio/bajo), tier (T1/T2/T3), grade (A+ a F), status |
| `RiskMeter` | Barra horizontal animada 0-100 con color por severidad |
| `ScoreGauge` | Arco circular SVG con grade central y score, animacion al montar |
| `AgentPipelineViz` | Grafo de nodos con flechas, T2 lineal, T3 con bifurcacion paralela |
| `FileUploadZone` | Drag & drop con estados idle/dragover/uploading/success/error |
| `StepWizard` | Barra de progreso + navegacion de pasos + validacion |
| `CitationBadge` | Pill de referencia normativa con tooltip y drawer |
| `FindingCard` | Hallazgo de auditoria con barra de severidad, expandible |
| `StreamingText` | Cursor parpadeante durante streaming SSE |
| `ProgressRing` | Progreso circular SVG animado |
| `Toast` | Provider + hook, 4 variantes, auto-dismiss, stack vertical |
| `DataTable` | Tabla sortable con formatter COP colombiano |

Todos los componentes respetan `prefers-reduced-motion` y soportan dark mode via CSS variables.

### Workspace — 4 Modos

**WELCOME** — Pantalla de bienvenida con 5 cards de entrada. NIIF Elite con gradiente dorado prominente.

**CHAT** — Para Defensa DIAN, Devoluciones, Due Diligence e Inteligencia Financiera:
- Case header sticky con tipo, ID, datos clave
- Agent Pipeline Visualizer (SSE-driven): muestra Classifier → Enhancer → Agents → Synthesizer en tiempo real
- Rich response cards con CitationBadge inline, RiskMeter, Sanction Calculator, DIAN Draft
- Colapsa a summary bar al completar

**PIPELINE** — Para NIIF Elite:
- Monitor en tiempo real de 3 fases (agentes, auditores, meta-auditor)
- ProgressRing con porcentaje global
- Streaming preview del reporte mientras se genera
- Al completar: Document Viewer con navegacion lateral por secciones

**RESULT** — Visor de documento profesional:
- Navegacion lateral con scroll suave a secciones
- Action bar sticky: Excel .xlsx, PDF, Markdown, Nuevo Reporte
- Tipografia profesional, tablas HTML con formato COP

### Sistema de Intake (5 formularios estructurados)

Cada tipo de caso tiene un formulario guiado con StepWizard:

| Caso | Pasos | Highlights |
|------|-------|-----------|
| **Defensa DIAN** | 4 | 6 radio cards para tipo de acto, multi-select de impuestos, calculo de fecha limite |
| **Devoluciones** | 4 | 3 cards con referencia legal (Arts. 850-865 E.T.), campo condicional de radicado |
| **Due Diligence** | 4 | NIT auto-format (XXX.XXX.XXX-X), selector de grupo NIIF con descripcion |
| **Inteligencia Fin.** | 3 | Toggle cards multi-select con preview de outputs esperados |
| **NIIF Elite** | 5 | Company metadata, grupo NIIF (3 cards stacked), balance de prueba con validacion patrimonial, 10 toggle cards de output, pipeline preview |

Cada formulario incluye:
- `useIntakePersistence` hook con auto-guardado (500ms debounce)
- `IntakePreview` como paso final con visualizacion del pipeline que se ejecutara
- Aviso de redaccion PII antes de envio al LLM

### Panel de Inteligencia (7 estados contextuales)

El panel derecho nunca esta vacio. Se adapta automaticamente:

| Estado | Que muestra |
|--------|-------------|
| Sin caso activo | Referencias clave colombianas, guia de inicio |
| Case type seleccionado | Articulos relevantes por tipo (E.T., NIC, NIIF) |
| Durante intake | "Lo que analizaremos" — preview de outputs en tiempo real |
| Chat en progreso | Tier badge, pipeline compacto, accion actual, timer |
| Chat completo | RiskMeter, CitationBadges, documentos, acciones |
| Pipeline NIIF corriendo | Stage dots animados, auditor dots, ProgressRing |
| Pipeline NIIF completo | ScoreGauge, 12 dimensiones, hallazgos por dominio, export |

### Case Navigator (Sidebar)

- Brand header con 1+1 wordmark
- "Nueva Consulta" button (dorado)
- 5+1 case type selector con shortcut keys (D, R, U, I, N)
- NIIF Elite con gradiente dorado permanente + badge "ELITE"
- Lista de casos agrupada: Hoy / Esta Semana / Anteriores
- Risk dot por caso (verde/amarillo/naranja/rojo)
- Colapsa a icon rail de 48px

---

## Backend — Orquestacion Multi-Agente

### Pipeline 1: Chat (Orchestrator-Workers)

```
Usuario → PII Redactor → Classifier (T1/T2/T3) → Prompt Enhancer
                                                         │
                                            ┌────────────┴────────────┐
                                            ▼                         ▼
                                   Agente Tributario         Agente Contable
                                   (6 herramientas)          (4 herramientas)
                                            │                         │
                                            └────────────┬────────────┘
                                                         ▼ (solo T3)
                                                    Synthesizer
                                                         │
                                                         ▼
                                                   SSE Streaming
```

**Cost Tiers:**

| Tier | Cuando | LLM Calls | Latencia |
|------|--------|-----------|----------|
| **T1** | Saludos, meta-preguntas | 1 | ~1s |
| **T2** | Consulta de un dominio | 2-3 | ~3-5s |
| **T3** | Consulta multi-dominio | 4-5 | ~5-8s |

**Herramientas disponibles:**

| Herramienta | Funcion | Agentes |
|-------------|---------|---------|
| `search_docs` | RAG sobre base normativa local | Tributario, Contable |
| `search_web` | Busqueda Tavily en fuentes confiables | Tributario, Contable |
| `calculate_sanction` | Sanciones Arts. 641/644/647/634 | Tributario |
| `draft_dian_response` | Borradores de respuesta DIAN | Tributario |
| `assess_risk` | Evaluacion de riesgo 0-100 | Tributario, Contable |
| `get_tax_calendar` | Calendario por ultimo digito NIT | Tributario |
| `analyze_document` | Analisis de documentos subidos | Contable |

### Pipeline 2: Reporte NIIF (Secuencial)

3 agentes con `gpt-5.4-mini` (400K contexto). Cada agente recibe la salida del anterior:

| Agente | Entrada | Salida |
|--------|---------|--------|
| **Analista NIIF** | Datos brutos + PUC mapping | 4 EEFF + notas tecnicas |
| **Director Estrategia** | 4 EEFF | KPIs + breakeven + cash flow + recomendaciones |
| **Gobierno Corporativo** | Todo lo anterior | 13 notas NIC 1 + acta de asamblea |

### Pipeline 3: Auditoria (4 en paralelo)

| Auditor | Normativa | Peso |
|---------|-----------|------|
| **NIIF/Contable** | NIC 1-41, NIIF 1-17, CTCP, Decretos 2420/2496 | 30% |
| **Tributario** | Estatuto Tributario (840+ arts.), DIAN | 25% |
| **Legal/Societario** | Ley 1258/2008, C.Co., Ley 222/1995 | 20% |
| **Revisoria Fiscal** | NIA 200-706, Ley 43/1990 | 25% |

Severidades: `critico` > `alto` > `medio` > `bajo` > `informativo`

Opinion formal tipo NIA 700: Favorable (90-100) · Con Salvedades (75-89) · Desfavorable (40-74) · Abstencion (0-39)

### Pipeline 4: Meta-Auditor de Calidad

12 dimensiones evaluadas contra marcos internacionales:

| # | Dimension | Marco |
|---|-----------|-------|
| D1 | Completitud del Reporte | ISO 25012 |
| D2 | Exactitud Aritmetica | ISO 25012 |
| D3 | Consistencia Interna | ISO 25012 |
| D4 | Presentacion NIIF | NIC 1 / NIIF 18 |
| D5 | Calidad de Notas | NIC 1 par. 112-138 |
| D6 | Analisis Estrategico | Best Practices |
| D7 | Gobierno Corporativo | Ley 1258/2008 |
| D8 | Trazabilidad | ISO 42001 |
| D9 | Anti-Alucinacion | ISO 42001 |
| D10 | Supervision Humana | ISO 42001 |
| D11 | Formato y Exportabilidad | Best Practices |
| D12 | Preparacion IFRS 18 | NIIF 18 (eff. 2027) |

Grades: **A+** (95-100) · **A** (90-94) · **B** (80-89) · **C** (70-79) · **D** (60-69) · **F** (<60)

### Pipeline 5: Preprocesamiento + Excel

**Preprocesador** (cero LLM): parsea CSV/Excel de ERPs colombianos (Siigo, World Office, Helisa, ContaPyme), filtra auxiliares, suma por clase PUC, valida ecuacion patrimonial (A = P + E), detecta cuentas omitidas.

**Excel Export** (ExcelJS): 5 pestanas con formato corporativo:

| Pestana | Contenido |
|---------|-----------|
| Balance NIIF | Activo/Pasivo/Patrimonio con codigos PUC |
| Estado Resultados | Ingresos/Costos/Gastos → Utilidad Neta |
| KPIs | Dashboard estrategico completo |
| Validacion | Discrepancias, banderas rojo/verde |
| Resumen | Reporte consolidado |

---

## API Endpoints

| Endpoint | Metodo | Descripcion | Duracion |
|----------|--------|-------------|----------|
| `/api/chat` | POST | Chat multi-agente (SSE con `X-Stream: true`) | Default |
| `/api/financial-report` | POST | Pipeline NIIF: 3 agentes secuenciales, SSE | 300s |
| `/api/financial-audit` | POST | 4 auditores en paralelo, SSE | 300s |
| `/api/financial-quality` | POST | Meta-auditor 12 dimensiones | Default |
| `/api/financial-report/export` | POST | Pipeline completo → `.xlsx` descargable | 300s |
| `/api/tax-planning` | POST | Planeacion tributaria: 3 agentes secuenciales, SSE | 300s |
| `/api/transfer-pricing` | POST | Precios de transferencia: 3 agentes secuenciales, SSE | 300s |
| `/api/business-valuation` | POST | Valoracion empresarial: 2 paralelos + sintesis, SSE | 300s |
| `/api/fiscal-audit-opinion` | POST | Dictamen revisoria fiscal: 3 paralelos + drafter, SSE | 300s |
| `/api/tax-reconciliation` | POST | Conciliacion fiscal: 2 agentes secuenciales, SSE | 300s |
| `/api/feasibility-study` | POST | Estudio de factibilidad: 3 agentes secuenciales, SSE | 300s |
| `/api/upload` | POST | Ingesta documentos (PDF, DOCX, XLSX, imagenes OCR) | Default |
| `/api/rag` | POST | Consulta directa al vector store | Default |
| `/api/web-search` | POST | Busqueda Tavily filtrada | Default |
| `/api/realtime` | GET | Token efimero para voz WebRTC | Default |
| `/api/tools/sanction` | POST | Calculadora de sanciones tributarias | Default |
| `/api/tools/calendar` | POST/GET | Calendario tributario por NIT | Default |

### SSE Events

```
// /api/chat
{ type: 'status',   message: string }
{ type: 'tier',     tier: 'T1' | 'T2' | 'T3' }
{ type: 'domains',  domains: string[] }
{ type: 'tool',     name: string, agent: string }
{ type: 'content',  delta: string }
{ type: 'done',     riskLevel?, riskScore?, citations? }

// /api/financial-report
{ type: 'stage_start',    stage: 1|2|3, label: string }
{ type: 'stage_progress', stage: 1|2|3, detail: string }
{ type: 'stage_complete', stage: 1|2|3, label: string }
{ type: 'audit_start',    auditor: string }
{ type: 'audit_complete', auditor: string, findings: number }
{ type: 'quality_score',  grade: string, score: number }
{ type: 'result',         report: FinancialReport }
```

---

## Arquitectura de Archivos

```
src/
├── app/
│   ├── page.tsx                    # Landing page con PipelineShowcase
│   ├── workspace/
│   │   ├── layout.tsx              # Shell: StatusBar + 3 paneles + IntakeModal + Cmd+K
│   │   └── page.tsx                # Router: Welcome | Chat | Pipeline
│   └── api/
│       ├── chat/                   # Chat multi-agente (SSE)
│       ├── financial-report/       # Pipeline NIIF (SSE) + export Excel
│       ├── financial-audit/        # 4 auditores paralelos (SSE)
│       ├── financial-quality/      # Meta-auditor 12 dimensiones
│       ├── upload/                 # Ingesta documentos + OCR
│       ├── rag/                    # Vector store query
│       ├── web-search/             # Tavily
│       ├── realtime/               # WebRTC token
│       └── tools/                  # Sancion + Calendario
│
├── design-system/                  # ★ Sistema de diseno propio
│   ├── tokens.ts                   # Colores, spacing, radius, shadow, font, animation
│   ├── index.ts                    # Barrel export
│   └── components/                 # 12 componentes primitivos
│       ├── Badge.tsx               # Risk/Tier/Grade/Status variants
│       ├── RiskMeter.tsx           # Barra animada 0-100
│       ├── ScoreGauge.tsx          # Arco SVG circular
│       ├── AgentPipelineViz.tsx    # Grafo de nodos T2/T3
│       ├── FileUploadZone.tsx      # Drag & drop con estados
│       ├── StepWizard.tsx          # Wizard de pasos con validacion
│       ├── CitationBadge.tsx       # Pill normativa con tooltip
│       ├── FindingCard.tsx         # Hallazgo expandible
│       ├── StreamingText.tsx       # Cursor streaming
│       ├── ProgressRing.tsx        # Progreso circular
│       ├── Toast.tsx               # Notificaciones
│       └── DataTable.tsx           # Tabla sortable
│
├── types/
│   └── platform.ts                 # ★ 30+ tipos compartidos (Case, Intake, Pipeline, Audit)
│
├── components/
│   ├── workspace/
│   │   ├── Sidebar.tsx             # ★ Case Navigator (5+1 types, grouped list)
│   │   ├── ChatWorkspace.tsx       # ★ Chat con pipeline viz + rich cards
│   │   ├── PipelineWorkspace.tsx   # ★ Monitor NIIF Elite + document viewer
│   │   ├── WelcomeScreen.tsx       # ★ Pantalla de entrada
│   │   ├── AnalysisPanel.tsx       # ★ Intelligence Panel (7 estados)
│   │   ├── WorkspaceLayout.tsx     # ★ 3-panel layout
│   │   ├── ChatThread.tsx          # Chat legacy (preservado)
│   │   ├── CommandPalette.tsx      # Cmd+K
│   │   ├── StatusBar.tsx           # Barra superior
│   │   ├── types.ts                # Tipos workspace legacy
│   │   └── intake/                 # ★ Sistema de intake
│   │       ├── IntakeModal.tsx     # Overlay full-screen
│   │       ├── IntakePreview.tsx   # Pre-flight summary
│   │       ├── DianDefenseIntake.tsx
│   │       ├── TaxRefundIntake.tsx
│   │       ├── DueDiligenceIntake.tsx
│   │       ├── FinancialIntelIntake.tsx
│   │       ├── NiifReportIntake.tsx    # 5 pasos, el mas completo
│   │       └── useIntakePersistence.ts # Auto-save hook
│   ├── sections/                   # Landing page
│   │   ├── PipelineShowcase.tsx    # ★ Visualizacion del pipeline 8 nodos
│   │   ├── Hero.tsx
│   │   ├── Services.tsx
│   │   └── ...
│   └── ui/                         # Componentes UI base
│
├── context/
│   ├── WorkspaceContext.tsx         # ★ Estado global (extended: caseType, mode, pipeline, intake)
│   └── LanguageContext.tsx          # i18n (es/en)
│
├── lib/
│   ├── agents/                     # Orquestacion multi-agente
│   │   ├── orchestrator.ts         # Chat orchestrator (T1/T2/T3)
│   │   ├── classifier.ts          # Cost tier classifier
│   │   ├── prompt-enhancer.ts      # Query enhancement
│   │   ├── synthesizer.ts          # T3 response merger
│   │   ├── specialists/            # Base + Tax + Accounting agents
│   │   ├── tools/registry.ts       # Tool definitions
│   │   ├── prompts/                # System prompts
│   │   └── financial/              # Pipeline NIIF + Auditoria + Quality
│   │       ├── orchestrator.ts     # 3-agent sequential
│   │       ├── agents/             # NIIF, Strategy, Governance
│   │       ├── audit/              # 4 parallel auditors
│   │       └── quality/            # 12-dimension meta-auditor
│   ├── tools/                      # Tool implementations
│   ├── rag/                        # HNSWLib + ingestion
│   ├── preprocessing/              # Trial balance validator
│   ├── export/                     # Excel + PDF export
│   ├── security/                   # PII filter
│   ├── search/                     # Tavily client
│   └── validation/                 # Zod schemas
│
├── hooks/
│   └── useRealtimeAPI.ts           # WebRTC voice
│
└── data/
    ├── tax_docs/                   # ~25 documentos normativos (markdown)
    ├── calendars/                  # Calendarios tributarios
    └── vector_store/               # Indice HNSWLib persistido
```

---

## Instalacion

```bash
git clone https://github.com/Rocuts/UtopIA.git
cd UtopIA
npm install
```

### Variables de Entorno

Crear `.env.local`:

```bash
OPENAI_API_KEY=sk-...           # Requerido: todos los LLM calls
TAVILY_API_KEY=tvly-...         # Requerido: busqueda web
UTOPIA_AGENT_MODE=orchestrated  # orchestrated (multi-agente) | legacy (monolitico)
```

### Comandos

```bash
npm run dev          # Servidor de desarrollo (localhost:3000)
npm run build        # Build de produccion (Turbopack)
npm run lint         # ESLint
npm run db:ingest    # Ingestar documentos al vector store
```

Validar cambios: `npx tsc --noEmit` + `npm run build`. No hay test framework configurado.

---

## Seguridad

| Capa | Implementacion |
|------|---------------|
| **PII** | Redaccion de NIT, cedula, emails, telefonos, tarjetas antes de cada LLM call |
| **NIT Context** | Extraccion del ultimo digito ANTES de la redaccion para personalizacion |
| **CSP** | Content Security Policy restrictiva a OpenAI + Tavily APIs |
| **Validacion** | Zod schemas estrictos en todos los endpoints |
| **Rate Limiting** | Per-IP, per-endpoint en middleware |
| **Headers** | X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy |
| **File Validation** | Magic bytes para prevenir spoofing de extensiones |
| **CSRF** | Origin checking en middleware |

---

## Contribucion

```bash
git checkout -b feature/mi-mejora
# ... hacer cambios ...
npx tsc --noEmit && npm run build  # Validar
git commit -m "feat: descripcion del cambio"
git push origin feature/mi-mejora
# Crear Pull Request
```

### Agregar un nuevo agente especialista

1. Prompt en `src/lib/agents/prompts/`
2. Agente en `src/lib/agents/specialists/` extendiendo `BaseSpecialist`
3. Herramientas en `src/lib/agents/tools/registry.ts`
4. Registrar en `SPECIALISTS` en `orchestrator.ts`

### Agregar documentos a la base de conocimiento

1. Crear `.md` en `src/data/tax_docs/` con frontmatter YAML
2. Ejecutar `npm run db:ingest`

---

## Disclaimer

1+1 es una herramienta de apoyo para profesionales contables y tributarios. **No reemplaza el criterio profesional del contador publico** ni constituye asesoria tributaria vinculante. Las respuestas generadas por la IA deben ser verificadas contra la normativa vigente antes de ser utilizadas en actuaciones oficiales. La informacion normativa tiene como base el Estatuto Tributario, la doctrina DIAN y los estandares NIIF vigentes a 2026.

---

<p align="center">
  <sub>Built with precision by <strong>Johan Rocuts</strong> · Powered by OpenAI · Made for Colombia</sub>
</p>
