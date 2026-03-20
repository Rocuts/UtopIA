# Repo Analysis Agent Team

## Objetivo

Definir un equipo de agentes para auditar este repo de forma paralela, con fronteras claras y entregables compatibles entre si. El repo es una app Next.js 16 + React 19 con:

- landing page en App Router
- componentes cliente con motion + 3D
- chat legal con texto, voz en tiempo real, subida de documentos y RAG local
- endpoints API que mezclan OpenAI, Tavily y almacenamiento vectorial en disco

## Contexto rapido del repo

- UI principal: `src/app/page.tsx`
- layout global: `src/app/layout.tsx`
- estilos globales: `src/app/globals.css`
- i18n cliente: `src/context/LanguageContext.tsx`, `src/lib/i18n/dictionaries.ts`
- chat principal: `src/components/sections/ChatWidget.tsx`
- voz realtime: `src/hooks/useRealtimeAPI.ts`, `src/app/api/realtime/route.ts`
- RAG y busqueda: `src/app/api/chat/route.ts`, `src/app/api/rag/route.ts`, `src/app/api/upload/route.ts`, `src/lib/rag/vectorstore.ts`, `src/lib/search/web-search.ts`

## Hallazgos iniciales que deben guiar el analisis

- La home depende de varios componentes `use client`, incluido un chat pesado con Canvas, WebRTC, markdown y upload, todo embebido en la pagina principal.
- `src/components/sections/ChatWidget.tsx` concentra demasiadas responsabilidades: disclaimer, estado del chat, upload, UI de voz, canvas 3D y networking.
- `src/context/LanguageContext.tsx` usa `localStorage` con `setState` en `useEffect`, y `eslint` ya marca este punto como riesgo de render en cascada.
- `src/components/canvas/HeroScene.tsx` y `src/components/ui/InteractiveOrb.tsx` usan `Math.random()` en render/memo; `eslint` lo marca como impureza React.
- `README.md` sigue siendo el boilerplate de create-next-app; no documenta arquitectura, env vars ni flujos de IA.
- No hay tests visibles en el repo y `npm run lint` hoy falla.

## Equipo de agentes

### 1. Lead Analyst / Synthesizer

**Mision**

Unificar la salida de todos los agentes, detectar contradicciones y convertir hallazgos dispersos en una ruta accionable.

**Archivos base**

- `package.json`
- `README.md`
- `src/app/page.tsx`
- `src/app/layout.tsx`

**Preguntas que debe responder**

- Cual es el mapa funcional del producto hoy
- Cuales son los riesgos de mayor impacto para iterar rapido
- Que refactors desbloquean al resto del equipo

**Entregable**

- resumen ejecutivo
- top 5 riesgos
- plan de remediacion en 3 horizontes: inmediato, corto plazo, mediano plazo

### 2. Frontend / UX Auditor

**Mision**

Analizar la experiencia principal de la landing y del chat desde estructura visual, accesibilidad, composicion React, hidratacion y carga de cliente.

**Archivos foco**

- `src/app/page.tsx`
- `src/app/globals.css`
- `src/components/layout/Header.tsx`
- `src/components/layout/Footer.tsx`
- `src/components/layout/SmoothScroll.tsx`
- `src/components/sections/Hero.tsx`
- `src/components/sections/ChatWidget.tsx`
- `src/components/sections/Services.tsx`
- `src/components/sections/FAQ.tsx`
- `src/components/canvas/HeroScene.tsx`
- `src/components/ui/InteractiveOrb.tsx`

**Checklist**

- mapa de la UI y flujo del usuario desde hero hasta chat
- que se renderiza en server vs client
- peso de Canvas / motion / markdown en la home
- riesgos de accesibilidad: botones sin label, estados, contraste, teclado, semantica
- deuda de mantenibilidad por componentes demasiado grandes

**Alertas conocidas**

- `ChatWidget` mezcla demasiadas responsabilidades
- `HeroScene` e `InteractiveOrb` tienen problemas de pureza React marcados por lint
- hay scroll suave global que puede interferir con navegacion y rendimiento

**Entregable**

- mapa de componentes
- lista priorizada de riesgos UX y performance
- propuesta de segmentacion del chat en subcomponentes o boundaries

### 3. AI / API / Security Auditor

**Mision**

Revisar todo el flujo de consulta legal, RAG, voz realtime, subida de documentos y filtros de privacidad.

**Archivos foco**

- `src/app/api/chat/route.ts`
- `src/app/api/realtime/route.ts`
- `src/app/api/rag/route.ts`
- `src/app/api/upload/route.ts`
- `src/app/api/web-search/route.ts`
- `src/lib/rag/vectorstore.ts`
- `src/lib/rag/ingest.ts`
- `src/lib/search/web-search.ts`
- `src/lib/security/pii-filter.ts`
- `src/hooks/useRealtimeAPI.ts`

**Checklist**

- flujo end-to-end de mensajes, tools y respuestas
- manejo de errores y timeouts
- exposicion de secretos y dependencia de env vars
- aislamiento entre datos base del producto y documentos subidos por usuarios
- impacto legal y de privacidad de persistir uploads y embeddings en `src/data`
- consistencia entre prompts de chat y prompts de realtime

**Alertas conocidas**

- el vector store vive dentro de `src/data`, junto con datos base del repo
- uploads del usuario terminan persistidos en disco local del proyecto
- varios `catch (error: any)` y contratos flojos en endpoints
- el cliente realtime llama directamente al endpoint OpenAI realtime via WebRTC tras recibir token efimero

**Entregable**

- diagrama del flujo AI
- riesgos de seguridad, privacidad y confiabilidad
- recomendaciones sobre separacion de almacenamiento, validacion y observabilidad

### 4. Architecture / State / i18n Auditor

**Mision**

Revisar decisiones de arquitectura transversales: estado global, localizacion, configuracion Next, deuda de boundaries y organizacion de carpetas.

**Archivos foco**

- `package.json`
- `tsconfig.json`
- `next.config.ts`
- `src/app/layout.tsx`
- `src/context/LanguageContext.tsx`
- `src/lib/i18n/dictionaries.ts`
- `src/lib/utils.ts`

**Checklist**

- si la separacion actual entre app, componentes, hooks, lib y data escala
- si el i18n cliente actual es suficiente para SEO, routing y SSR
- si hay coupling innecesario entre layout global y features pesadas
- si faltan boundaries por dominio

**Alertas conocidas**

- el idioma vive solo en cliente, sin rutas dedicadas ni soporte SSR
- `layout.tsx` monta `LanguageProvider` y `SmoothScroll` para toda la app
- el diccionario es un objeto unico grande en memoria

**Entregable**

- evaluacion de arquitectura actual
- propuesta de modularizacion por dominio
- recomendacion de evolucion para i18n y providers

### 5. Quality / Release Auditor

**Mision**

Determinar si el repo esta listo para evolucionar con seguridad: lint, build, pruebas, DX, documentacion y readiness operativa.

**Archivos foco**

- `package.json`
- `eslint.config.mjs`
- `README.md`
- todos los archivos marcados por lint

**Checklist**

- correr `npm run lint`
- verificar si existe estrategia de test
- revisar deuda de typing y reglas React nuevas
- identificar huecos de documentacion operacional
- listar variables de entorno requeridas

**Estado actual conocido**

- `npm run lint` falla con errores en API, hooks, i18n y 3D
- no hay pruebas automatizadas visibles
- el README no explica setup real del producto

**Entregable**

- reporte de calidad actual
- lista de bloqueos para CI
- baseline minimo para poder desplegar y mantener

## Protocolo de trabajo

1. Cada agente inspecciona solo su area y reporta evidencias concretas con rutas de archivo.
2. No proponer refactors grandes sin describir el problema observable que resuelven.
3. Clasificar cada hallazgo como `critical`, `high`, `medium` o `low`.
4. Separar hechos observados de inferencias.
5. El Lead Analyst consolida y elimina duplicados.

## Formato de salida recomendado para cada agente

```md
## Scope

- archivos revisados

## Findings

- [severity] hallazgo
- evidencia
- impacto
- cambio recomendado

## Unknowns

- datos faltantes o supuestos

## Next actions

- acciones concretas y ordenadas
```

## Secuencia sugerida

1. Quality / Release Auditor
2. Frontend / UX Auditor
3. AI / API / Security Auditor
4. Architecture / State / i18n Auditor
5. Lead Analyst / Synthesizer

## Comandos utiles

```bash
npm run lint
rg --files src
sed -n '1,220p' src/components/sections/ChatWidget.tsx
sed -n '1,220p' src/app/api/chat/route.ts
sed -n '1,220p' src/context/LanguageContext.tsx
```

## Resultado esperado

Si el equipo trabaja bien, al final deberia quedar claro:

- como esta compuesto el producto hoy
- que partes son cuello de botella tecnico
- que riesgos impiden escalar o desplegar con seguridad
- que refactors conviene hacer primero
