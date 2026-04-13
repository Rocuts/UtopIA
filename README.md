# UtopIA — Plataforma AI para Contadores

> Tu firma contable potenciada por Inteligencia Artificial

## ¿Qué es UtopIA?

UtopIA es una plataforma de asesoría contable, tributaria y financiera potenciada por inteligencia artificial, diseñada específicamente para el mercado colombiano. Combina la precisión de modelos de lenguaje avanzados con una base de conocimiento especializada en normativa tributaria, doctrina DIAN y estándares NIIF.

La plataforma utiliza RAG (Retrieval-Augmented Generation) sobre documentos normativos curados, búsqueda web en tiempo real y herramientas de análisis para ofrecer respuestas contextuales, precisas y con citación de fuentes.

## Casos de Uso

### 1. Defensa ante Requerimientos DIAN

Cuando un contribuyente recibe un requerimiento ordinario, requerimiento especial o liquidación oficial, UtopIA analiza el acto administrativo, identifica los artículos del Estatuto Tributario aplicables, calcula plazos de respuesta y sugiere argumentos de defensa con base en la doctrina DIAN y jurisprudencia del Consejo de Estado. Incluye cálculo automático de sanciones y sus reducciones.

### 2. Devolución de Saldos a Favor

UtopIA guía al contribuyente paso a paso en el proceso de solicitud de devolución (Arts. 850–865 E.T.): verificación de requisitos, preparación de documentos soporte, cálculo de plazos, y seguimiento del trámite ante la DIAN. Identifica riesgos de verificación y auditoría asociados a la solicitud.

### 3. Preparación para Inversión, Crédito o Venta

Para procesos de due diligence financiero, UtopIA genera análisis de indicadores financieros (liquidez, rentabilidad, endeudamiento, actividad), identifica contingencias tributarias y laborales, y prepara un diagnóstico integral de la situación financiera de la empresa con base en estados financieros bajo NIIF.

### 4. Inteligencia Financiera para Decisiones

UtopIA realiza análisis de flujo de caja, punto de equilibrio, valoración por DCF y múltiplos, y simulaciones de escenarios tributarios para apoyar la toma de decisiones estratégicas. Calcula el impacto fiscal de operaciones como fusiones, escisiones, dividendos y enajenación de activos.

## Stack Técnico

| Capa | Tecnología |
|------|------------|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| LLM | OpenAI `gpt-4o-mini` (chat + agentes), `gpt-4o` (OCR vía Vision API), `gpt-4o-realtime-preview` (voz), `text-embedding-3-small` (embeddings) |
| Orquestación | Sistema multi-agente propio (Orchestrator-Workers con Cost Tiers) |
| RAG | LangChain (splitter, embeddings, document loaders), HNSWLib-node (vector store) |
| Búsqueda Web | Tavily API con filtrado por dominio (dian.gov.co, estatuto.co, actualicese.com, etc.) |
| Voz | OpenAI Realtime API sobre WebRTC |
| UI | Tailwind CSS 4, Motion, React Three Fiber + drei + postprocessing |
| i18n | Contexto personalizado (es/en) con persistencia en localStorage |

---

## Arquitectura Multi-Agente

UtopIA implementa un sistema de orquestación multi-agente basado en el patrón **Orchestrator-Workers** con **Cost Tiers inteligentes**. Este diseño está basado en las best practices 2026 de OpenAI (Agents SDK), Anthropic (Orchestrator-Workers pattern) y Google (Compositional Function Calling).

### ¿Por qué multi-agente?

El usuario promedio no sabe de prompt engineering. Escribe cosas como *"tengo un problema con la DIAN"* y espera una respuesta de nivel profesional. El sistema multi-agente resuelve esto automáticamente:

1. **Mejora la pregunta** sin que el usuario lo note
2. **Enruta al experto correcto** según el dominio
3. **Combina expertos** cuando la consulta cruza dominios

### Flujo Completo

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Usuario escribe mensaje                       │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  PII Extractor      │  Extrae contexto NIT antes
                    │  + PII Redactor     │  de redactar datos sensibles
                    └──────────┬──────────┘
                               │
                               ▼
                ┌──────────────────────────────┐
                │        CLASSIFIER            │
                │                              │
                │  Regex pre-filter (T1 obvios) │
                │  + GPT-4o-mini (T2/T3)       │
                │                              │
                │  Determina:                  │
                │  • Tier: T1 / T2 / T3        │
                │  • Dominios: tax, accounting │
                │  • Intent + confidence       │
                └──────┬───────┬───────┬───────┘
                       │       │       │
              ┌────────┘       │       └────────┐
              ▼                ▼                 ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │     T1       │  │     T2       │  │     T3       │
    │  Respuesta   │  │  Un solo     │  │  Múltiples   │
    │  directa     │  │  especialista│  │  especialistas│
    │  (1 LLM call)│  │              │  │  en paralelo │
    └──────────────┘  └──────┬───────┘  └──────┬───────┘
                             │                 │
                             ▼                 ▼
                    ┌──────────────────────────────┐
                    │      PROMPT ENHANCER          │
                    │                              │
                    │  Transforma:                 │
                    │  "tengo un problema con la   │
                    │   DIAN"                      │
                    │         ▼                    │
                    │  "Analizar la situación del  │
                    │   contribuyente frente a un  │
                    │   proceso DIAN. Identificar: │
                    │   tipo de requerimiento      │
                    │   (Arts. 684-719 E.T.),      │
                    │   plazos vigentes, nivel de  │
                    │   riesgo y estrategia de     │
                    │   defensa recomendada."      │
                    │                              │
                    │  Para T3: genera sub-queries │
                    │  específicos por dominio     │
                    └──────────┬───────────────────┘
                               │
                  ┌────────────┴────────────┐
                  ▼                         ▼
     ┌────────────────────┐   ┌────────────────────────┐
     │   AGENTE TRIBUTARIO│   │   AGENTE CONTABLE      │
     │                    │   │                        │
     │   6 herramientas:  │   │   4 herramientas:      │
     │   • search_docs    │   │   • search_docs        │
     │   • search_web     │   │   • search_web         │
     │   • calculate_     │   │   • analyze_document   │
     │     sanction       │   │   • assess_risk        │
     │   • draft_dian_    │   │                        │
     │     response       │   │   Dominio:             │
     │   • assess_risk    │   │   NIIF/IFRS, NIC, CTCP │
     │   • get_tax_       │   │   estados financieros, │
     │     calendar       │   │   ratios, due diligence│
     │                    │   │   proyecciones         │
     │   Dominio:         │   │                        │
     │   E.T., DIAN,      │   └───────────┬────────────┘
     │   sanciones,       │               │
     │   devoluciones,    │               │
     │   facturación      │               │
     └────────┬───────────┘               │
              │                           │
              └─────────┬─────────────────┘
                        │
                        ▼  (solo T3)
              ┌──────────────────────┐
              │    SYNTHESIZER       │
              │                     │
              │  Combina respuestas  │
              │  de ambos agentes:   │
              │  • Elimina           │
              │    redundancia       │
              │  • Destaca conexiones│
              │    tributario-       │
              │    contables         │
              │  • Unifica           │
              │    recomendaciones   │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   Respuesta final    │
              │   al usuario         │
              │   (SSE streaming     │
              │    con indicadores)  │
              └──────────────────────┘
```

### Cost Tiers — Inteligencia en el gasto

No todas las preguntas necesitan el pipeline completo. El Classifier determina automáticamente cuánto procesamiento requiere cada mensaje:

| Tier | Cuándo se activa | LLM Calls | Latencia | Ejemplo |
|------|------------------|-----------|----------|---------|
| **T1** | Saludos, agradecimientos, confirmaciones, meta-preguntas | 1 | ~1s | *"Hola"*, *"Gracias"*, *"¿Qué servicios ofreces?"* |
| **T2** | Consulta clara de un solo dominio (tributario O contable) | 2-3 | ~3-5s | *"¿Cómo calculo la sanción por extemporaneidad?"* |
| **T3** | Consulta que cruza dominios tributario Y contable | 4-5 | ~5-8s | *"Tengo un requerimiento DIAN, ¿cómo afecta mis estados financieros?"* |

**T1 es más barato que el sistema anterior** (sin system prompt de 462 líneas). **T2 tiene costo similar.** **T3 cuesta ~40% más pero produce respuestas significativamente superiores** al combinar dos expertos especializados.

El Classifier incluye un **regex pre-filter** que detecta saludos y confirmaciones obvias (`"hola"`, `"gracias"`, `"ok"`) **sin hacer ningún LLM call** — costo cero para mensajes triviales.

### El Prompt Enhancer — El arma secreta

Este es el componente que más valor agrega. Los usuarios no saben prompt engineering, pero el Prompt Enhancer transforma sus preguntas vagas en consultas de nivel profesional:

| Lo que escribe el usuario | Lo que recibe el agente especialista |
|---------------------------|--------------------------------------|
| *"tengo un problema con la DIAN"* | *"Analizar la situación tributaria del contribuyente frente a un proceso con la DIAN. Identificar: tipo de requerimiento o acto administrativo (Arts. 684-719 E.T.), plazos de respuesta vigentes, nivel de riesgo, y estrategia de defensa."* |
| *"cuánto me toca pagar de multa?"* | *"Calcular la sanción tributaria aplicable al contribuyente (persona jurídica, NIT último dígito 7). Determinar: tipo de sanción (extemporaneidad Art. 641, corrección Art. 644, inexactitud Art. 647), monto en COP con base en UVT 2026 ($52.374), y opciones de reducción."* |
| *"necesito revisar mis finanzas para un crédito"* | *"Preparar análisis de due diligence financiero para solicitud de crédito bancario. Incluir: indicadores de liquidez, endeudamiento y rentabilidad; revisión de estados financieros bajo NIIF; identificación de contingencias tributarias; y cumplimiento con certificados de paz y salvo."* |

**Regla crítica**: El Enhancer NUNCA cambia la intención del usuario. Solo agrega especificidad, contexto legal y estructura.

Para consultas **T3** (multi-dominio), el Enhancer también genera **sub-queries** separados por dominio:

```json
{
  "enhanced": "Analizar las implicaciones de un requerimiento DIAN sobre los estados financieros...",
  "subQueries": [
    {
      "domain": "tax",
      "query": "Analizar requerimiento DIAN Art. 684, sanciones aplicables, estrategia de defensa"
    },
    {
      "domain": "accounting",
      "query": "Reconocimiento NIIF de contingencia fiscal (NIC 37), impacto en estados financieros"
    }
  ]
}
```

Cada sub-query va al agente especialista correspondiente, y el **Synthesizer** combina las respuestas en una narrativa coherente.

### Agentes Especialistas

#### Agente Tributario (`tax-agent.ts`)

Experto en derecho tributario colombiano con acceso a 6 herramientas:

| Herramienta | Función |
|-------------|---------|
| `search_docs` | Búsqueda RAG en la base de conocimiento normativa local |
| `search_web` | Búsqueda en fuentes web de confianza (dian.gov.co, actualicese.com, etc.) |
| `calculate_sanction` | Cálculo de sanciones: extemporaneidad (Art. 641), corrección (Art. 644), inexactitud (Art. 647), intereses moratorios (Art. 634) |
| `draft_dian_response` | Generación de borradores de respuesta a requerimientos DIAN en formato oficial |
| `assess_risk` | Evaluación de riesgo tributario (bajo/medio/alto/crítico, score 0-100) |
| `get_tax_calendar` | Calendario tributario personalizado por último dígito del NIT |

**Reglas anti-alucinación**: Solo cita artículos que aparecen VERBATIM en los resultados de búsqueda. Nunca inventa números de artículos, porcentajes ni valores UVT.

#### Agente Contable (`accounting-agent.ts`)

Experto en estándares contables y análisis financiero con acceso a 4 herramientas:

| Herramienta | Función |
|-------------|---------|
| `search_docs` | Búsqueda RAG en NIIF, NIC y normativa CTCP |
| `search_web` | Búsqueda en fuentes web (ctcp.gov.co, actualicese.com, etc.) |
| `analyze_document` | Análisis de documentos financieros subidos por el usuario |
| `assess_risk` | Evaluación de riesgo contable y financiero |

**Especialidades**: NIIF/IFRS (Grupo 1), NIIF para PYMES (Grupo 2), indicadores financieros, flujo de caja, due diligence, presupuestos y proyecciones.

### SSE Streaming — Indicadores de Progreso en Tiempo Real

El usuario no ve una pantalla en blanco mientras los agentes trabajan. El sistema usa **Server-Sent Events (SSE)** para mostrar progreso:

```
"Clasificando su consulta..."        → Classifier determinando tier
"Mejorando su pregunta..."           → Prompt Enhancer trabajando
"Consultando agentes especializados..." → Agentes ejecutando herramientas
"Investigando..."                    → Agente usando search_docs/search_web
"Sintetizando respuesta..."          → Synthesizer combinando outputs (T3)
```

### Feature Flag — Rollout Seguro

El sistema multi-agente se activa con una variable de entorno:

```bash
UTOPIA_AGENT_MODE=orchestrated  # Nuevo sistema multi-agente
UTOPIA_AGENT_MODE=legacy        # Sistema monolítico anterior (default)
```

Esto permite activar/desactivar el nuevo sistema desde Vercel sin redeploy, y hacer rollback instantáneo si algo falla.

---

## Arquitectura de Archivos

```
src/
├── app/api/
│   ├── chat/route.ts             # Entry point — feature flag → orchestrated/legacy
│   ├── realtime/route.ts         # Token efímero para voz WebRTC
│   ├── upload/route.ts           # Ingesta de documentos (PDF, DOCX, XLSX, imágenes OCR)
│   ├── rag/route.ts              # Consulta directa al vector store
│   ├── web-search/route.ts       # Búsqueda web Tavily
│   └── tools/
│       ├── sanction/route.ts     # Calculadora de sanciones (API directa)
│       └── calendar/route.ts     # Calendario tributario (API directa)
│
├── lib/
│   ├── agents/                   # ★ SISTEMA MULTI-AGENTE
│   │   ├── types.ts              # Tipos compartidos (QueryClassification, EnhancedQuery, etc.)
│   │   ├── classifier.ts         # Clasificador T1/T2/T3 (regex + LLM)
│   │   ├── prompt-enhancer.ts    # Agente de prompt engineering
│   │   ├── orchestrator.ts       # Coordinador central del flujo
│   │   ├── synthesizer.ts        # Sintetizador multi-agente (solo T3)
│   │   ├── specialists/
│   │   │   ├── base-agent.ts     # Clase base con tool-calling loop reutilizable
│   │   │   ├── tax-agent.ts      # Agente especialista tributario
│   │   │   └── accounting-agent.ts # Agente especialista contable
│   │   ├── tools/
│   │   │   └── registry.ts       # Registro centralizado de herramientas
│   │   └── prompts/
│   │       ├── classifier.prompt.ts
│   │       ├── enhancer.prompt.ts
│   │       ├── tax-agent.prompt.ts
│   │       ├── accounting-agent.prompt.ts
│   │       └── synthesizer.prompt.ts
│   │
│   ├── tools/                    # Implementaciones de herramientas
│   │   ├── sanction-calculator.ts    # Cálculo de sanciones (Arts. 641/644/647/634)
│   │   ├── document-analyzer.ts      # Análisis de documentos con GPT-4o-mini
│   │   ├── dian-response-generator.ts # Borradores de respuesta DIAN
│   │   ├── risk-assessor.ts          # Evaluación de riesgo (0-100)
│   │   └── tax-calendar.ts           # Calendario tributario + búsqueda web
│   │
│   ├── rag/
│   │   ├── ingest.ts             # Pipeline de ingesta batch
│   │   └── vectorstore.ts        # HNSWLib singleton + similarity search
│   ├── search/web-search.ts      # Cliente Tavily con filtrado de dominios
│   ├── security/pii-filter.ts    # Redacción PII (NIT, CC, emails, teléfonos)
│   ├── storage/conversation-history.ts # Persistencia localStorage
│   └── validation/schemas.ts     # Validación Zod de requests
│
├── hooks/
│   └── useRealtimeAPI.ts         # Orquestación WebRTC + data channel
│
├── components/workspace/
│   ├── ChatThread.tsx            # Chat UI principal (SSE streaming)
│   ├── AnalysisPanel.tsx         # Panel de análisis (riesgo, documentos)
│   ├── Sidebar.tsx               # Historial de conversaciones
│   ├── StatusBar.tsx             # Barra de estado
│   └── types.ts                  # Tipos del workspace
│
├── context/
│   ├── WorkspaceContext.tsx       # Estado global del workspace
│   └── LanguageContext.tsx        # Internacionalización
│
└── data/
    ├── tax_docs/                 # ~25 documentos tributarios colombianos (markdown)
    ├── calendars/                # Calendarios tributarios estructurados
    │   ├── nacional-2026.ts
    │   ├── municipal-2026.ts
    │   └── types.ts
    └── vector_store/             # Índice HNSWLib persistido
```

## Instalación y Configuración

```bash
# Clonar el repositorio
git clone https://github.com/Rocuts/UtopIA.git
cd UtopIA

# Instalar dependencias
npm install

# Configurar variables de entorno
# Crear .env.local con:
#   OPENAI_API_KEY=sk-...
#   TAVILY_API_KEY=tvly-...
#   UTOPIA_AGENT_MODE=orchestrated    # o "legacy" para modo anterior

# Construir el vector store desde los documentos tributarios
npm run db:ingest

# Iniciar servidor de desarrollo
npm run dev
```

La aplicación corre en `http://localhost:3000`. El modo de voz requiere permisos de micrófono y una clave OpenAI con acceso a la Realtime API.

## API Endpoints

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/chat` | POST | Chat con orquestador multi-agente. Soporta SSE streaming (`X-Stream: true`) y JSON |
| `/api/upload` | POST | Sube documentos (PDF, DOCX, XLSX, imágenes con OCR), procesa e incorpora al vector store |
| `/api/rag` | POST | Consulta directa al vector store — retorna los k chunks más relevantes |
| `/api/web-search` | POST | Búsqueda web filtrada por dominios de confianza |
| `/api/realtime` | GET | Genera token efímero para sesión de voz WebRTC con OpenAI Realtime API |
| `/api/tools/sanction` | POST | Cálculo directo de sanciones tributarias |
| `/api/tools/calendar` | POST | Calendario tributario personalizado por NIT |

## Fuentes de Datos

La base de conocimiento de UtopIA incluye:

- **Estatuto Tributario**: resumen ejecutivo con tarifas, deducciones, procedimiento y sanciones vigentes para 2026 (UVT $52.374).
- **Procedimiento DIAN**: guía detallada de requerimientos, liquidaciones oficiales, régimen sancionatorio y recursos de defensa.
- **NIIF Colombia**: clasificación por grupos (1, 2, 3), estándares clave, políticas contables y presentación de estados financieros.
- **Facturación Electrónica**: marco legal, tipos de documentos, requisitos técnicos y errores comunes.
- **Análisis Financiero**: indicadores, flujo de caja, punto de equilibrio y due diligence.
- **Decretos y resoluciones**: ~25 documentos normativos curados (2019-2025).

Los documentos son ingresados al vector store mediante el comando `npm run db:ingest`. Los usuarios pueden subir documentos adicionales en tiempo de ejecución a través de `/api/upload` (PDF, DOCX, XLSX, imágenes con OCR vía GPT-4o Vision).

## Seguridad

- **Redacción PII**: NIT, cédula, emails, teléfonos, tarjetas y cuentas bancarias se redactan antes de enviar al LLM
- **Extracción NIT contextual**: Se extrae el último dígito del NIT para personalización ANTES de la redacción
- **Content Security Policy**: Restricción a APIs de confianza (OpenAI, Tavily)
- **Validación Zod**: Todos los inputs validados con schemas estrictos
- **Headers de seguridad**: X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy
- **Magic bytes**: Validación de tipos de archivo por firma binaria (previene spoofing de extensiones)

## Contribución

1. Fork del repositorio.
2. Crear rama feature: `git checkout -b feature/mi-mejora`.
3. Commits con mensajes descriptivos en español.
4. Push a la rama: `git push origin feature/mi-mejora`.
5. Crear Pull Request describiendo los cambios.

### Agregar documentos a la base de conocimiento

1. Crear archivo `.md` en `src/data/tax_docs/` con frontmatter YAML (type, number, year, entity, title).
2. Usar formato con headers claros (`##`, `###`) y citar artículos específicos del E.T. donde aplique.
3. Ejecutar `npm run db:ingest` para reconstruir el vector store.

### Agregar un nuevo agente especialista

1. Crear archivo de prompt en `src/lib/agents/prompts/nuevo-agent.prompt.ts`.
2. Crear agente en `src/lib/agents/specialists/nuevo-agent.ts` extendiendo `BaseSpecialist`.
3. Registrar herramientas en `src/lib/agents/tools/registry.ts`.
4. Agregar el agente al mapa `SPECIALISTS` en `src/lib/agents/orchestrator.ts`.
5. Actualizar el Classifier para reconocer el nuevo dominio.

## Disclaimer

UtopIA es una herramienta de apoyo para profesionales contables y tributarios. **No reemplaza el criterio profesional del contador público** ni constituye asesoría tributaria vinculante. Las respuestas generadas por la IA pueden contener imprecisiones y deben ser verificadas contra la normativa vigente antes de ser utilizadas en actuaciones ante la DIAN u otras autoridades. El usuario es responsable de validar toda información antes de aplicarla a casos reales.

La información normativa tiene como base el Estatuto Tributario, la doctrina DIAN y los estándares NIIF vigentes a 2026. Las normas tributarias cambian frecuentemente — consulte siempre las fuentes oficiales actualizadas.
