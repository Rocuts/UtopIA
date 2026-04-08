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
| LLM | OpenAI `gpt-4o-mini` (chat), `gpt-4o-realtime-preview` (voz), `text-embedding-3-small` (embeddings) |
| RAG | LangChain (splitter, embeddings, document loaders), HNSWLib-node (vector store) |
| Búsqueda Web | Tavily API con filtrado por dominio (dian.gov.co, estatuto.co, actualicese.com, etc.) |
| Voz | OpenAI Realtime API sobre WebRTC |
| UI | Tailwind CSS 4, Motion, React Three Fiber + drei + postprocessing |
| i18n | Contexto personalizado (es/en) con persistencia en localStorage |

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                     Cliente (React)                          │
│  ┌───────────┐  ┌────────────┐  ┌────────────────────────┐ │
│  │ Chat Texto │  │ Subida Doc │  │ Voz (WebRTC + Orb 3D) │ │
│  └─────┬─────┘  └─────┬──────┘  └───────────┬────────────┘ │
└────────┼───────────────┼─────────────────────┼──────────────┘
         │               │                     │
         ▼               ▼                     ▼
┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐
│ POST /chat  │  │ POST /upload │  │ GET /realtime         │
│             │  │              │  │ (token efímero)       │
│ Redacción   │  │ Extrae texto │  └───────────┬───────────┘
│ PII + Tool  │  │ Chunk+embed  │              │
│ calling     │  │ → vectorstore│              ▼
└──┬──────┬───┘  └──────────────┘  ┌───────────────────────┐
   │      │                        │ OpenAI Realtime API   │
   ▼      ▼                        │ (WebRTC bidireccional)│
┌──────┐ ┌──────────┐              └───────────────────────┘
│ RAG  │ │ Búsqueda │
│(HNSW)│ │ Web      │
└──────┘ └──────────┘
```

### Flujo de datos

1. **Chat**: El mensaje llega a `/api/chat`, se redactan patrones PII, se envía a `gpt-4o-mini` con herramientas (`search_tax_docs`, `search_web`). El modelo decide qué herramientas invocar en un loop de hasta 5 rondas. La respuesta incluye citaciones de fuentes.

2. **Ingesta de documentos**: Los archivos markdown se dividen en chunks (~1000 caracteres, 250 overlap), se prepend con contexto documental para mejorar la relevancia de búsqueda, se embeben con `text-embedding-3-small` y se almacenan en HNSWLib.

3. **Voz**: El cliente obtiene un token efímero, establece conexión WebRTC con la API Realtime de OpenAI. Las tool calls se ejecutan client-side contra `/api/rag` y `/api/web-search`.

## Instalación y Configuración

```bash
# Clonar el repositorio
git clone https://github.com/your-user/UtopIA.git
cd UtopIA

# Instalar dependencias
npm install

# Configurar variables de entorno
# Crear .env.local con:
#   OPENAI_API_KEY=sk-...
#   TAVILY_API_KEY=tvly-...

# Construir el vector store desde los documentos tributarios
npm run db:ingest

# Iniciar servidor de desarrollo
npm run dev
```

La aplicación corre en `http://localhost:3000`. El modo de voz requiere permisos de micrófono y una clave OpenAI con acceso a la Realtime API.

## Estructura del Proyecto

```
src/
├── app/api/
│   ├── chat/route.ts         # Endpoint de chat con tool-calling loop
│   ├── realtime/route.ts     # Token efímero para voz WebRTC
│   ├── upload/route.ts       # Ingesta de documentos del usuario
│   ├── rag/route.ts          # Consulta directa al vector store
│   └── web-search/route.ts   # Búsqueda web Tavily
├── lib/
│   ├── rag/
│   │   ├── ingest.ts         # Pipeline de ingesta batch
│   │   └── vectorstore.ts    # Loader HNSWLib + similarity search
│   ├── search/web-search.ts  # Cliente Tavily con filtrado de dominios
│   └── security/pii-filter.ts
├── hooks/
│   └── useRealtimeAPI.ts     # Orquestación WebRTC + data channel
├── components/sections/
│   └── ChatWidget.tsx        # UI principal de chat/voz
└── data/
    ├── tax_docs/             # Documentos tributarios fuente (5 .md)
    │   ├── estatuto_tributario_resumen_2026.md
    │   ├── procedimiento_dian_2026.md
    │   ├── niif_colombia_2026.md
    │   ├── facturacion_electronica_2026.md
    │   └── analisis_financiero_guia.md
    └── vector_store/         # Índice HNSWLib persistido
```

## Fuentes de Datos

La base de conocimiento de UtopIA incluye:

- **Estatuto Tributario**: resumen ejecutivo con tarifas, deducciones, procedimiento y sanciones vigentes para 2026 (UVT $52.374).
- **Procedimiento DIAN**: guía detallada de requerimientos, liquidaciones oficiales, régimen sancionatorio y recursos de defensa.
- **NIIF Colombia**: clasificación por grupos (1, 2, 3), estándares clave, políticas contables y presentación de estados financieros.
- **Facturación Electrónica**: marco legal, tipos de documentos, requisitos técnicos y errores comunes.
- **Análisis Financiero**: indicadores, flujo de caja, punto de equilibrio y due diligence.

Los documentos son ingresados al vector store mediante el comando `npm run db:ingest`. Los usuarios pueden subir documentos adicionales en tiempo de ejecución a través de `/api/upload`.

## API Endpoints

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/chat` | POST | Chat con IA — recibe mensaje, ejecuta RAG y/o búsqueda web, retorna respuesta con citaciones |
| `/api/upload` | POST | Sube documento (.txt, .md, .csv, .json, .html, .xml), lo procesa e incorpora al vector store |
| `/api/rag` | POST | Consulta directa al vector store — retorna los k chunks más relevantes |
| `/api/web-search` | POST | Búsqueda web filtrada por dominios de confianza (DIAN, Actualícese, Gerencie, etc.) |
| `/api/realtime` | GET | Genera token efímero para sesión de voz WebRTC con OpenAI Realtime API |

## Contribución

1. Fork del repositorio.
2. Crear rama feature: `git checkout -b feature/mi-mejora`.
3. Commits con mensajes descriptivos en español.
4. Push a la rama: `git push origin feature/mi-mejora`.
5. Crear Pull Request describiendo los cambios.

### Agregar documentos a la base de conocimiento

1. Crear archivo `.md` en `src/data/tax_docs/`.
2. Usar formato con headers claros (`##`, `###`) y citar artículos específicos del E.T. donde aplique.
3. Ejecutar `npm run db:ingest` para reconstruir el vector store.

## Disclaimer

UtopIA es una herramienta de apoyo para profesionales contables y tributarios. **No reemplaza el criterio profesional del contador público** ni constituye asesoría tributaria vinculante. Las respuestas generadas por la IA pueden contener imprecisiones y deben ser verificadas contra la normativa vigente antes de ser utilizadas en actuaciones ante la DIAN u otras autoridades. El usuario es responsable de validar toda información antes de aplicarla a casos reales.

La información normativa tiene como base el Estatuto Tributario, la doctrina DIAN y los estándares NIIF vigentes a 2026. Las normas tributarias cambian frecuentemente — consulte siempre las fuentes oficiales actualizadas.
