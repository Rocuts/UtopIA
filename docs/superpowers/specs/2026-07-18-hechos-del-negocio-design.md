# Hechos del negocio — Memoria de contexto empresarial

- **Fecha:** 2026-07-18
- **Estado:** Diseño aprobado (secciones 1–6). Pendiente de escribir plan de implementación.
- **Autor:** Johan Rocuts + Claude (brainstorming)
- **Alcance del piloto:** narrativos end-to-end + un solo `kind` estructurado (`donation` / Art. 257 E.T.) end-to-end.

---

## Problema y objetivo

Hoy UtopIA no recuerda hechos duraderos del negocio del usuario entre conversaciones. Si Don Carlos dice "estamos donando $50M a la fundación X este año", ese hecho se pierde al cerrar el chat y **no llega a los reportes** (NIIF, Planeación Tributaria). El objetivo es una **memoria de contexto empresarial** que:

1. Capture hechos duraderos del negocio de forma conversacional, con **cero falsos positivos** (nada se persiste sin confirmación humana explícita).
2. Alimente los reportes por dos caminos: **prosa** (narrativos) y **números** (estructurados), respetando el Protocolo Élite (los números salen de cálculo determinista, nunca de que la LLM "decida").
3. Sea **auditable ante la DIAN**: soft-delete, versionado, y reconstrucción de qué regla normativa se aplicó y cuándo.
4. Se mantenga **alineada con la normativa** vigente vía actualización manual barata, en un solo lugar, con imposibilidad de deriva silenciosa.

### Best practices 2026 adoptadas

- **Patrón extract → update (Mem0):** no se hace ADD ciego; se reconcilia contra la memoria existente (ADD / UPDATE / SUPERSEDE / NOOP). ([Mem0 / frameworks 2026](https://machinelearningmastery.com/the-6-best-ai-agent-memory-frameworks-you-should-try-in-2026/), [comparativa Vectorize](https://vectorize.io/articles/best-ai-agent-memory-systems))
- **Validez temporal (Zep):** los hechos tienen vigencia (`fiscalPeriod`), no son eternos. Aplicado también a las reglas normativas (effective-dating).
- **Human-in-the-loop en dominios críticos:** la confirmación humana antes de persistir es el gate correcto para finanzas/tributario. ([Keymakr 2026](https://keymakr.com/blog/preventing-llm-hallucinations-techniques-best-practices-2026/), [Zylos](https://zylos.ai/research/2026-01-27-llm-hallucination-detection-mitigation))
- **Hechos atómicos + confirmación grounded:** se re-formula el hecho exacto y tipado antes de persistir; el `body` se ancla en las palabras del usuario, sin inferencias adornadas. ([futureagi deep dive](https://futureagi.com/blog/llm-hallucination-deep-dive-2026/))
- **Rules as Code (OpenFisca):** la regla tributaria se codifica versionada; se sincronizan legislación y código simultáneamente; implementación gradual en bajo riesgo primero. ([CIGI — Rules as Code](https://www.cigionline.org/static/documents/T7_TF2_Rapson_et_al.pdf), [Deloitte — Future of Regulation](https://www.deloitte.com/us/en/insights/industry/government-public-sector-services/government-trends/2026/future-of-regulation.html))
- **Audit trail por decisión (BRMS):** registrar qué versión de regla se disparó, con qué inputs y qué resultado, para probar qué regla estaba vigente en cualquier decisión pasada. ([DecisionRules](https://www.decisionrules.io/en/articles/top-10-business-rule-engines/), [European Business Review](https://www.europeanbusinessreview.com/top-business-rules-engines-and-management-systems-for-2026/))

### Principio anti-falsos-positivos (por diseño, no por score)

Reemplazamos el verificador probabilístico por **verificación humana** — más barata y cero-falso-positivo por construcción para un producto tributario:

1. **Sesgo a NOOP:** la tool solo se propone ante afirmaciones reales y duraderas del usuario — nunca ante hipótesis, preguntas o sugerencias del propio asistente. "Ante la duda, NO propongas." Como nada se persiste sin el "sí" del usuario, el falso positivo máximo es una pregunta que se descarta — nunca un dato falso en un reporte.
2. **Confirmación atómica y grounded:** el asistente re-formula el hecho exacto y tipado antes de persistir. Valida la interpretación, no un "sí" vago.
3. **Reconciliación al persistir:** revisa hechos activos del mismo `kind` + `fiscalPeriod` y decide ADD / UPDATE / SUPERSEDE / NOOP — nunca duplica ni deja contradicciones entrando al mismo reporte.

---

## Sección 1 — Modelo de datos y ciclo de vida

### Ciclo de vida

`active` (por defecto) → editable en el panel (crea nueva versión / actualiza) → `revoked` (soft-delete, **nunca borra**: auditabilidad tributaria). Los reportes solo leen `status='active'` cuyo `fiscalPeriod` cubra el período del reporte.

**Decisiones tomadas:**
- Los hechos son **por período fiscal** (una donación aplica a un año). Un hecho sin `fiscalPeriod` se considera vigente para cualquier reporte.
- **Soft-delete** (revoke, no borrado) por trazabilidad ante la DIAN.
- El **`body` narrativo siempre existe**; `structured` es el enriquecimiento opcional por tipo.

### Tabla `workspace_facts`

Nuevo archivo `src/lib/db/schema-facts.ts`, re-exportado desde `src/lib/db/schema.ts` (patrón split existente; FK vía callback `() => workspaces...` para evitar circulares).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `workspaceId` | `uuid` FK → `workspaces` (cascade) | tenancy; resuelto server-side |
| `kind` | `pgEnum fact_kind` | `'narrative' \| 'donation' \| 'leasing' \| 'loss_carryforward'` (piloto: `narrative` + `donation`; extensible) |
| `title` | `text` | resumen legible |
| `body` | `text` | narrativa anclada en palabras del usuario |
| `structured` | `jsonb` **nullable** | tipado por `kind`; `null` para `narrative`. Montos como **strings en centavos** (MoneyCop) |
| `fiscalPeriod` | `varchar` **nullable** | ej. `'2026'`; `null` = vigente para cualquier reporte |
| `status` | `pgEnum fact_status` | `'active' \| 'revoked'`, default `'active'` |
| `supersededById` | `uuid` **nullable** (self-FK) | cadena de versiones |
| `source` | `pgEnum fact_source` | `'chat' \| 'manual'` |
| `createdAt` / `updatedAt` / `revokedAt` | `timestamp` | `revokedAt` nullable |

Índice para reconciliación: `(workspaceId, kind, fiscalPeriod, status)`.

---

## Sección 2 — Captura conversacional (tool-based)

### Tool `registrar_hecho_negocio`

Nuevo archivo `src/lib/tools/registrar-hecho-negocio.ts`. Contrato **Zod strict-mode** (`.nullable()` siempre — nunca `.optional()` / `.nullish()` / `.default()` / `z.record()`, per `docs/spec/zod-strict-mode-2026.md`):

```ts
registrar_hecho_negocio({
  kind: 'narrative' | 'donation' | 'leasing' | 'loss_carryforward',
  title: string,
  body: string,               // anclado en las palabras del usuario
  structured: <jsonb> | null, // tipado por kind; null para narrative
  fiscalPeriod: string | null,
})
```

> **Piloto:** el enum `kind` declara los cuatro tipos (forward-compat), pero solo se implementan handlers para `narrative` y `donation`. La tool no se propone para `leasing` / `loss_carryforward` hasta sus olas.

### Cableado

En el orquestador (`src/lib/agents/orchestrator.ts`) como tool disponible para el loop de tool-calling ya existente, y expuesta a los especialistas relevantes (tax, accounting, strategy). Sin infraestructura nueva. Tenancy: el handler resuelve `workspaceId` **server-side** (cookie), igual que el resto de rutas — nunca del cliente. Auth gate por `requireAuthSession` (`src/lib/auth/require-session.ts`).

### Guardrails en el system prompt (patrón GPT-5.4; `ALWAYS/NEVER/MUST` solo safety rails)

- **NEVER** invocar la tool sin confirmación explícita del usuario en el turno previo.
- **NEVER** proponer registro para hipótesis, preguntas o ideas del propio asistente — solo afirmaciones reales y duraderas del usuario. Ante la duda, NO propongas (sesgo NOOP).
- **MUST** re-formular el hecho exacto y estructurado antes de confirmar (confirmación atómica).

### Flujo

```
1. Usuario: "estamos reestructurando facturas para donar a la fundación X, unos 50 millones este año"
2. Orquestador (detecta hecho duradero) responde + propone en texto:
   "¿Registro esto para tus reportes? →
    Donaciones $50.000.000 · 2026 · descuento Art. 257 ET (límite 25% del impuesto)"
3. Usuario: "sí"  (o "sí pero son 45 millones" → re-confirma con el valor corregido)
4. Orquestador llama registrar_hecho_negocio(...) SOLO ahora
5. El handler ejecuta reconciliación (ADD/UPDATE/SUPERSEDE/NOOP) contra workspace_facts
6. Confirma: "Listo, lo tendré en cuenta en tu próximo reporte. Puedes verlo/editarlo en Contexto de la empresa."
```

### Reconciliación (determinista, dentro del handler — NO en la LLM)

Función `reconcileFact` en `src/lib/db/facts.ts` (fuente única, consumida por tool **y** panel):

- Busca hechos `active` del mismo `kind` + `fiscalPeriod`.
- Sin match → **ADD**.
- Match con datos equivalentes → **NOOP** ("ya lo tenía registrado").
- Match con datos distintos → **SUPERSEDE**: el viejo pasa a `revoked` + `supersededById`, entra el nuevo.

---

## Sección 3 — Navegación contextual (chip sugerido)

Señal: el classifier ya produce `domains` + `intent` + `confidence` por mensaje (`src/lib/agents/classifier.ts`) pero se descartan (no viajan en `OrchestrateResult`). Los rescatamos.

### Cambios

- `OrchestrateResult` gana `suggestedRoute: { label, href, moduleKey } | null` (nullable, strict-mode). **El campo se añade en `orchestrator.ts` durante la Ola 0** (punto de anclaje) para que el equipo del chip no toque ese archivo.
- **Tabla de mapeo determinista** (no LLM), nuevo archivo. Indexa por el **enum real** `domains` del classifier (`'tax' | 'accounting' | 'documents' | 'strategy' | 'litigation'`), con refinamiento opcional por substring de `intent` (string libre):

| `domain` (+ `intent` opcional) | Ruta (verificada existente) | Módulo |
|---|---|---|
| `tax` + intent~`planeación`/`optimización` | `/workspace/escudo/planeacion-tributaria` | Planeación Tributaria |
| `litigation` (o `tax` + intent~`DIAN`/`requerimiento`) | `/workspace/escudo/defensa-dian` | Defensa DIAN |
| `tax` + intent~`transferencia`/`precios` | `/workspace/escudo/precios-transferencia` | Precios Transferencia |
| `strategy` + intent~`valoración`/`due diligence` | `/workspace/valor` | Valor |
| `accounting` + intent~`dictamen`/`revisoría` | `/workspace/verdad` | Verdad |
| `strategy` + intent~`factibilidad`/`escenarios` | `/workspace/futuro` | Futuro |

- `ChatSidebar` (`src/components/workspace/ChatSidebar.tsx`) lee `finalData.suggestedRoute` del evento `result` y, si no es `null`, renderiza un chip discreto bajo la respuesta: **"Ir a Planeación Tributaria →"**. Al click → `router.push(href)`.

**Anti-ruido:** el chip solo aparece con `confidence` alta del classifier y cuando la ruta detectada **no** es la que ya se está viendo. Sin auto-navegación. Un chip por respuesta, máximo.

**Blast radius:** 1 campo en `OrchestrateResult` (Ola 0), 1 tabla de mapeo nueva, 1 lectura + 1 componente chip en `ChatSidebar`. Cero cambios en el pipeline de reportes.

---

## Sección 4 — Hechos → reporte + registro normativo

Regla de oro (Protocolo Élite / CLAUDE.md): **los números salen de cálculo determinista + TOTALES VINCULANTES, nunca de que la LLM "decida" aplicar algo.** Por eso los dos tipos de hecho entran por caminos distintos:

```
workspace_facts (active, fiscalPeriod cubre el reporte)
        │
        ├─ body narrativo ──▶ bloque <hechos_empresa> en el <context> del prompt
        │                      → afecta PROSA (notas NIIF, análisis), NO números
        │
        └─ structured ──▶ capa determinista (preprocessing / motor normativo)
                           → recalcula TOTALES VINCULANTES (ej. descuento Art. 257)
                           → el reporte renderiza el total ya calculado
                           → afecta NÚMEROS, con integridad aritmética preservada
```

### Mecánica

- **Helper `getActiveFacts(workspaceId, fiscalPeriod)`** en `src/lib/db/facts.ts`: lee `workspace_facts` con `status='active'` cuyo período cubra el del reporte.
- **Narrativos → contexto:** se inyectan en un bloque etiquetado `<hechos_empresa>` dentro del `<context>` dinámico del prompt (cache-friendly: contenido dinámico abajo). Contexto de negocio autoritativo para redactar; no mueve totales.
- **Estructurados → cálculo determinista:** un hecho `donation {monto, articulo:257}` alimenta un hook en la capa `src/lib/preprocessing/` (junto a `balance-curator.ts` / `trial-balance.ts`), que recalcula el descuento con sus reglas reales (límite 25% del impuesto, Art. 257 E.T.) y emite el nuevo TOTAL VINCULANTE. La LLM nunca inventa el monto.
- **Confirmación pre-reporte:** antes de generar, el intake muestra "N hechos se incluirán en este reporte" con la lista y un toggle para excluir alguno **solo para esa corrida**. Nunca corre un número a espaldas del usuario.

**Primeros reportes cableados:** pipeline NIIF (`src/app/api/financial-report/{niif,strategy,governance,html}`) para narrativos; Planeación Tributaria (`src/app/api/tax-planning/route.ts`) para el primer estructurado (`donation`).

### Registro normativo versionado (single source of truth)

Los hooks de cálculo estructurado **nunca** llevan literales hardcodeados (`0.25`, `Art. 257`, UVT). Referencian un registro **tipado in-repo** en `src/lib/normativa/rules-registry.ts` (nuevo — determinista, versionado por git, que ES su audit trail de definiciones):

```ts
// src/lib/normativa/rules-registry.ts  (fuente única de verdad)
descuento_donaciones_257: [
  { vigencia: { desde: '2023-01-01', hasta: null },
    articulo: '257 E.T.', limitePctImpuesto: 25, uvt: 52374,
    fuente: 'ET Art. 257 / Concepto DIAN ...', revisadoPara: '2026' },
  // Reforma → se AGREGA una versión nueva con `desde`, se cierra la anterior
  // con `hasta`. NUNCA se edita en su lugar.
]
```

**Cómo mantiene la alineación:**

- **Binding temporal (uni-temporal, effective-dating):** un hecho de `fiscalPeriod: 2026` resuelve la versión vigente en 2026. Cambias la ley una vez y todos los períodos recalculan correcto.
- **Fail-loud, nunca fail-silent:** si un reporte pide un período sin versión de regla vigente, el sistema **se detiene y avisa** ("No hay regla vigente de Art. 257 para 2027 — actualiza el registro normativo") en vez de aplicar la vieja en silencio. Esto impide la deriva.
- **Chequeo de frescura:** cada regla lleva `revisadoPara`; un check (cron/Sentinel existente) puede avisar "estas N reglas fueron revisadas por última vez para 2026; verifica vigencia antes de cerrar 2027".
- **Sync legislación ↔ RAG:** el lado de citas narrativas sigue anclado en el RAG/Motor Normativo (anti-alucinación). El registro es el lado determinista de cálculo. Al actualizar se tocan **ambos** (registro + re-seed RAG) — checklist documentado.

### Auditabilidad bitemporal **sin store bitemporal** (decisión de diseño)

En vez de un store bitemporal (dos ejes de fecha en la tabla de reglas — caro y propenso a bugs de query), conseguimos la auditabilidad bitemporal combinando:

1. **Registro de reglas uni-temporal** (solo eje de *vigencia*: `desde`/`hasta`) — arriba.
2. **Decision records inmutables** — nueva tabla `fact_decision_records` (`src/lib/db/schema-facts.ts`): cada vez que un hecho estructurado produce un TOTAL VINCULANTE, se persiste `{ workspaceId, factId, ruleKey, ruleVersion, inputs (jsonb), resultado (jsonb, MoneyCop strings), computedAt }`. Sin path de update.

El par **regla vigencia-fechada + decision record inmutable** captura el eje de *tiempo de conocimiento* de forma implícita ("el 18-jul-2026, con Art. 257 v2023, calculé este descuento"). Reconstruye qué creía el sistema y con qué regla calculó cualquier número histórico — **mismo blindaje de defensa (Art. 647 E.T.) sin la complejidad de un store bitemporal**. Coherente con "no metemos un BRMS externo pesado".

---

## Sección 5 — Panel "Contexto de la empresa"

Superficie **human-in-the-loop** donde el usuario ve, edita y revoca los hechos — complemento visual de la captura por chat. Comparte **un solo handler de mutaciones** (`src/lib/db/facts.ts`) con la tool, así chat y panel nunca divergen.

**Dónde vive:** panel a nivel *workspace* (los hechos son transversales — alimentan NIIF, Planeación, etc.). Ruta propia **`/workspace/contexto`** (nueva), accesible desde el shell, para deep-linking desde el mensaje de confirmación del chat.

**Qué muestra:**

```
Contexto de la empresa                          [+ Registrar hecho]
Filtros: [kind ▾] [período ▾] [☑ solo activos]

┌─ Donaciones · 2026 · ● activo ────────────────────────────┐
│ $50.000.000 — descuento Art. 257 ET (límite 25%)          │
│ "estamos donando a la fundación X…"      (chat · 18-jul)  │
│ Aparece en: [Reporte NIIF 2026] [Planeación Tributaria]   │
│                                    [Editar]  [Revocar]     │
└───────────────────────────────────────────────────────────┘
▸ Historial de versiones (2)   ← plegado; cadena supersededById
```

**Interacciones:**
- **Editar** → crea **nueva versión** (SUPERSEDE: la vieja pasa a `revoked` + `supersededById`). Nunca edita en sitio → trazabilidad DIAN intacta.
- **Revocar** → soft-delete (`status='revoked'`), con confirmación. Jamás borra.
- **Registrar hecho** → formulario tipado por `kind` (mismo contrato Zod que la tool), para hechos entrados a mano (`source='manual'`).
- **Chips "Aparece en:"** → transparencia de impacto: qué reportes leerán este hecho.
- **Historial de versiones** → plegado por defecto; expande la cadena de supersedes para auditoría.

**i18n:** todas las claves nuevas (chip de navegación incluido) las escribe **un único dueño** en `src/lib/i18n/dictionaries.ts` para evitar colisiones de merge.

**Blast radius:** ruta + componentes lista/detalle/form, reutilización del handler de mutación, claves i18n. Cero cambios en el pipeline de reportes.

---

## Sección 6 — Plan de entrega (multiagente) + testing

**Principio rector:** esto **no** es un refactor mecánico — es una feature con dependencias reales (todos importan del data layer y de los tipos compartidos). Fan-out ciego sobre dependencias no congeladas produce divergencia y clobbering. Por eso: **cimientos primero → fan-out en archivos disjuntos → integración → verificación.** Los equipos son subagentes Opus 4.8, `effort: max`, con **ownership de archivos disjuntos** sobre el árbol de trabajo compartido (la disjunción es lo que evita el clobbering; las mecánicas exactas de dispatch se fijan en el plan de implementación).

### Ola 0 — Cimientos (secuencial, 1 track). Congela las interfaces.
- **DB:** `workspace_facts` + `fact_decision_records` en `src/lib/db/schema-facts.ts` (re-exportado desde `schema.ts`) + migración por **`db:generate` + `db:migrate`** (NUNCA `db:push` — borra infra no declarada).
- **Tipos + Zod contracts** (strict-mode): unión discriminada por `kind`, input de `registrar_hecho_negocio`.
- **Handler único de mutaciones** `src/lib/db/facts.ts`: `getActiveFacts` / `listFacts` / `reconcileFact` (ADD/UPDATE/SUPERSEDE/NOOP) / `revokeFact`.
- **Scaffold** de `src/lib/normativa/rules-registry.ts` + helper de persistencia de decision-records.
- **Puntos de anclaje en `orchestrator.ts`:** campo `suggestedRoute` en `OrchestrateResult` + slot de registro de la tool.

### Ola 1 — 4 equipos paralelos, archivos disjuntos
| Equipo | Alcance | Archivos (dueño exclusivo) |
|---|---|---|
| **A · Captura** | tool + prompt guardrails + registro en el loop | `src/lib/tools/registrar-hecho-negocio.ts` (nuevo), prompt del especialista |
| **B · Navegación** | tabla de mapeo dominio/intent→ruta + chip | mapping nuevo, `ChatSidebar.tsx` |
| **C · Reglas + cálculo** | poblar registry (Art. 257 v2023) + hook determinista `donation`→TOTAL VINCULANTE + decision records + fail-loud | `src/lib/normativa/*`, hook en `src/lib/preprocessing/*` |
| **D · Panel** | ruta `/workspace/contexto` + lista/detalle/form + **dueño único de i18n** | `src/app/workspace/contexto/*`, componentes nuevos, `src/lib/i18n/dictionaries.ts` |

**Colisiones neutralizadas:** `orchestrator.ts` (A+B) → los cambios viven en Ola 0. `dictionaries.ts` (B+D) → Equipo D es dueño único de i18n (B le entrega sus strings).

### Ola 2 — Integración a reportes (depende de C)
Cablear narrativos (bloque `<hechos_empresa>` en el `<context>`) + estructurados a **NIIF** y **Planeación Tributaria** + confirmación pre-reporte.

### Ola 3 — Verificación
`npx tsc --noEmit` · `npm run build` · `npm run lint:strict-mode` · **Vitest**:
- Reconciliación (los 4 caminos ADD/UPDATE/SUPERSEDE/NOOP).
- Resolución de regla por `fiscalPeriod` **+ fail-loud cuando no hay vigencia**.
- `donation` → decision record correcto (inputs/resultado en MoneyCop).
- **Regresión Élite** (validators de tres capas): integridad aritmética (Activo = Pasivo + Patrimonio @ $0) + defensa Art. 647 tras aplicar el descuento — el TOTAL VINCULANTE debe recomputar exacto.

Fixtures determinísticos siguiendo el patrón `src/lib/preprocessing/__fixtures__/`.

---

## Alcance del piloto y olas futuras

**Piloto (esta entrega):** narrativos end-to-end + `donation`/Art. 257 estructurado end-to-end (patrón RaC "gradual, low-risk first").

**Olas futuras (reusan el mismo cableado):** `leasing`, `loss_carryforward` y demás `kind` estructurados; expansión del registro normativo a más artículos; extensión del chip a más dominios.

## Decisiones abiertas / riesgos

- **Placement del panel:** ruta `/workspace/contexto` (elegido) vs slide-over global. Ruta gana por deep-linking. Revisable en implementación.
- **Enlace decision record ↔ reporte:** el `reportId`/run que ancla un decision record se define en Ola 2 (depende de cómo el pipeline identifica cada corrida). No bloquea Ola 0/1.
- **Umbral de `confidence` del chip:** valor exacto a calibrar con datos reales del classifier; empezar conservador (alto) para minimizar ruido.
