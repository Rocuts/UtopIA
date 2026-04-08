# PLAN: UtopIA — Plataforma AI para Contadores

> Tu firma contable potenciada por Inteligencia Artificial

---

## 4 Casos de Uso Core

### 1. Defensa ante Requerimientos DIAN
- Revisión documental automatizada
- Diagnóstico de riesgo fiscal (IVA, renta, retenciones, facturación electrónica)
- Borrador de respuesta técnica con citas a doctrina y normativa
- Organización de soporte probatorio
- Estrategia de defensa administrativa

### 2. Devolución de Saldos a Favor
- Expediente técnico automatizado
- Validación de soportes y consistencia
- Análisis de viabilidad del trámite
- Acompañamiento documental ante la administración
- Conexión tributario-tesorería-flujo de caja

### 3. Preparación Empresarial (Inversión, Crédito, Venta)
- Due diligence contable y tributaria
- Modelación financiera y escenarios
- Detección de inconsistencias contables
- Narrativa financiera para inversionistas/bancos
- Indicadores clave y estructura tributaria óptima

### 4. Inteligencia Financiera para Decisiones
- Análisis de rentabilidad por cliente/producto/línea
- Estructura de costos y márgenes
- Proyecciones de flujo de caja
- Presupuestos y escenarios what-if
- Impacto tributario de decisiones de crecimiento

---

## Progreso de Reestructuración

### FASE 1: Branding & Contenido — COMPLETADA
- [x] **Header.tsx** — Logo/nombre → UtopIA, navegación contable
- [x] **Hero.tsx** — Headline, subtítulo, CTAs orientados a contadores
- [x] **Services.tsx** — 4 servicios (Defensa DIAN, Devoluciones, Due Diligence, Inteligencia Financiera)
- [x] **Methodology.tsx** — Diagnóstico → Análisis AI → Estrategia → Entregable
- [x] **Metrics.tsx** — +500 casos, $2.4B ahorro, 98.7% precisión, <24h respuesta
- [x] **Trust.tsx** — Estatuto Tributario, DIAN, NIIF/NIC
- [x] **FAQ.tsx** — 5 FAQs para contadores colombianos
- [x] **CTA.tsx** — "¿Listo para transformar tu práctica contable?"
- [x] **Footer.tsx** — Disclaimer contable/tributario
- [x] **dictionaries.ts** — Diccionario es/en completo reescrito
- [x] **globals.css** — Deep Blue (#1e3a5f) + Gold (#d4a017) + fondo cálido

### FASE 2: Chat & AI Backend — COMPLETADA
- [x] **/api/chat/route.ts** — System prompt experto en tributaria colombiana + 4 contextos por caso de uso
- [x] **/api/chat/route.ts** — Tools: `search_tax_docs` + `search_web` (dominios colombianos)
- [x] **/api/realtime/route.ts** — Voice prompt para contexto contable
- [x] **/api/upload/route.ts** — Soporte PDF (pdf-parse) + Excel (xlsx)
- [x] **ChatWidget.tsx** — Selector de caso de uso (Defensa DIAN, Devolución, Due Diligence, Inteligencia Financiera)
- [x] **pii-filter.ts** — NIT, cédula, teléfono colombiano (+57)

### FASE 3: RAG & Knowledge Base — COMPLETADA
- [x] Eliminados `/src/data/legal_docs/` y `/src/data/vector_store/` (datos USA)
- [x] Creados 5 documentos semilla en `/src/data/tax_docs/`:
  - `estatuto_tributario_resumen_2026.md` — Renta, IVA, retenciones, UVT 2026
  - `procedimiento_dian_2026.md` — Requerimientos, sanciones, recursos
  - `niif_colombia_2026.md` — Grupos 1/2/3, CTCP, estados financieros
  - `facturacion_electronica_2026.md` — Resoluciones, nómina electrónica
  - `analisis_financiero_guia.md` — Ratios, flujo de caja, due diligence
- [x] **ingest.ts** — Pipeline actualizado para `tax_docs/`
- [x] **vectorstore.ts** — Mensajes y etiquetas contables
- [x] **web-search.ts** — 13 dominios colombianos (dian.gov.co, actualicese.com, etc.)

### FASE 4: Design System Premium — COMPLETADA
- [x] **Button.tsx** — Gold primary, deep blue secondary
- [x] **Badge.tsx** — Gold glow y accent
- [x] **GlassPanel.tsx** — Tonos cálidos, borde dorado sutil
- [x] **HeroScene.tsx** — Partículas y luces doradas (Three.js)
- [x] **InteractiveOrb.tsx** — Orb dorado premium

### FASE 5: Documentación — COMPLETADA
- [x] **README.md** — Reescrito completamente en español
- [x] **package.json** — name: "utopia", descripción actualizada
- [x] Dependencias: pdf-parse, xlsx agregadas

### Build: EXITOSO
```
✓ Compiled successfully
✓ 9 pages generated (1 static + 5 API routes)
✓ 0 errores TypeScript
```

---

## PRÓXIMOS PASOS

### PASO 1: Indexar Vector Store (Inmediato)
```bash
npm run db:ingest
```
- Indexa los 5 documentos semilla en HNSWLib
- Genera embeddings con OpenAI text-embedding-3-small
- Crea `/src/data/vector_store/` con el índice persistido
- **Sin esto, el RAG no tiene datos para consultar**

### PASO 2: Probar la Aplicación (Inmediato)
```bash
npm run dev
```
- Verificar que la UI muestra el branding UtopIA correcto
- Probar el chat con preguntas como:
  - "Me llegó un requerimiento especial de la DIAN por inconsistencias en IVA"
  - "Quiero pedir devolución de saldo a favor de mi empresa exportadora"
  - "Necesito preparar mi empresa para buscar inversión"
  - "¿Cuáles clientes me son más rentables?"
- Probar el selector de caso de uso
- Probar el modo de voz
- Verificar que las búsquedas web consultan dominios colombianos

### PASO 3: Agregar Documentación Real (Cuando esté lista)
El usuario proporcionará documentos fuente de mayor profundidad. Ubicar en `/src/data/tax_docs/`:
- [ ] Estatuto Tributario completo o secciones clave expandidas
- [ ] Conceptos y oficios DIAN (doctrina oficial)
- [ ] Resoluciones DIAN vigentes
- [ ] Guías CTCP sobre NIIF
- [ ] Jurisprudencia del Consejo de Estado en temas tributarios
- [ ] Calendarios tributarios 2026
- [ ] Formularios DIAN (110, 300, 350, etc.) con instrucciones

Después de agregar documentos:
```bash
npm run db:ingest   # Re-indexar con la documentación nueva
```

### PASO 4: Mejoras de UI/UX Avanzadas (Futuro)
- [ ] Dashboard de casos activos (lista de consultas por cliente)
- [ ] Timeline/progreso visual para cada caso de defensa
- [ ] Visualización de riesgo fiscal (gauge/semáforo: BAJO → CRÍTICO)
- [ ] Preview de documentos subidos (PDF viewer inline)
- [ ] Panel lateral con normativa relevante al caso activo
- [ ] Exportar respuestas como PDF (borrador de respuesta a DIAN)
- [ ] Historial de conversaciones persistente (base de datos)

### PASO 5: Autenticación y Multi-tenencia (Producción)
- [ ] Autenticación de usuarios (Clerk o Auth.js)
- [ ] Aislamiento de datos por firma contable (vector store por tenant)
- [ ] Rate limiting por usuario/firma
- [ ] Audit logging de consultas y respuestas
- [ ] Roles: Contador, Gerente, Admin

### PASO 6: Funcionalidades Avanzadas de AI (Producción)
- [ ] Agentes especializados por caso de uso (no solo prompts diferentes, sino flujos distintos)
- [ ] Análisis automático de documentos subidos (extraer cifras de estados financieros)
- [ ] Generación de borradores de respuesta a DIAN en formato oficial
- [ ] Cálculo automático de sanciones, intereses y plazos
- [ ] Comparación automática de declaraciones (cruce de información)
- [ ] Alertas de vencimiento de plazos tributarios

### PASO 7: Deployment (Producción)
- [ ] Deploy en Vercel
- [ ] Variables de entorno en Vercel (OPENAI_API_KEY, TAVILY_API_KEY)
- [ ] Migrar vector store a solución cloud (Pinecone, Weaviate, o Supabase pgvector)
- [ ] Base de datos para historial (Neon Postgres via Vercel Marketplace)
- [ ] Dominio personalizado (utopia-ai.co o similar)
- [ ] SSL, CORS, headers de seguridad

---

## Stack Técnico Actual

| Componente | Tecnología |
|---|---|
| Framework | Next.js 16.1.6 (App Router) |
| UI | React 19, Tailwind CSS 4, Motion |
| 3D | Three.js, React Three Fiber |
| LLM | OpenAI gpt-4o-mini (chat), gpt-4o-realtime (voz) |
| Embeddings | OpenAI text-embedding-3-small (1536 dims) |
| Vector Store | HNSWLib (local, persistido en disco) |
| RAG | LangChain + tool-calling loop (max 5 rondas) |
| Web Search | Tavily API (13 dominios colombianos) |
| Uploads | PDF (pdf-parse), Excel (xlsx), txt, md, csv, json, xml |
| Voz | WebRTC + OpenAI Realtime API |
| i18n | Bilingual es/en via LanguageContext |
| PII | Regex filter (NIT, cédula, teléfono CO, email) |

## Fuentes Web de Confianza

| Dominio | Contenido |
|---|---|
| dian.gov.co | Normativa, conceptos, resoluciones DIAN |
| secretariasenado.gov.co | Estatuto Tributario, leyes |
| funcionpublica.gov.co | Decretos reglamentarios |
| minhacienda.gov.co | Política fiscal, decretos |
| superfinanciera.gov.co | Regulación financiera |
| ctcp.gov.co | Estándares NIIF, orientaciones |
| jcc.gov.co | Regulación profesión contable |
| supersociedades.gov.co | Reportes empresariales |
| actualicese.com | Análisis tributario práctico |
| gerencie.com | Guías contables y tributarias |
| ambitojuridico.com | Jurisprudencia y doctrina |
| consultorcontable.com | Consultas contables |
| accounter.co | Herramientas contables |

---

## Estructura del Proyecto

```
src/
├── app/
│   ├── layout.tsx              # Root layout (LanguageProvider)
│   ├── page.tsx                # Landing page (9 secciones)
│   ├── globals.css             # Design system (blue + gold)
│   └── api/
│       ├── chat/route.ts       # Chat principal (tool-calling, RAG)
│       ├── realtime/route.ts   # WebRTC token para voz
│       ├── upload/route.ts     # Ingesta de docs (PDF, Excel, etc.)
│       ├── rag/route.ts        # Query directo al vector store
│       └── web-search/route.ts # Búsqueda web Tavily
├── components/
│   ├── layout/                 # Header, Footer, SmoothScroll
│   ├── sections/               # Hero, ChatWidget, Services, etc.
│   ├── canvas/                 # HeroScene (Three.js)
│   └── ui/                     # Button, Badge, Card, GlassPanel, Orb
├── context/
│   └── LanguageContext.tsx      # Idioma global (es/en)
├── hooks/
│   └── useRealtimeAPI.ts       # WebRTC + voz
├── lib/
│   ├── rag/                    # ingest.ts, vectorstore.ts
│   ├── search/                 # web-search.ts (Tavily)
│   ├── security/               # pii-filter.ts
│   └── utils.ts
├── data/
│   └── tax_docs/               # Documentos fuente (normativa CO)
│       ├── estatuto_tributario_resumen_2026.md
│       ├── procedimiento_dian_2026.md
│       ├── niif_colombia_2026.md
│       ├── facturacion_electronica_2026.md
│       └── analisis_financiero_guia.md
└── lib/i18n/
    └── dictionaries.ts         # Diccionario bilingual completo
```
