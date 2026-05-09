# UtopIA Multi-Agent Playbook 2026

> Manual de operación del equipo multi-agente que opera sobre el codebase UtopIA. Este documento sintetiza la documentación oficial de Anthropic (mayo 2026), los patrones de coordinación del blog Claude, y las decisiones de UtopIA, en un único brief que cualquier subagente que se despliegue debe poder citar de memoria.

## 1. Por qué este playbook existe

UtopIA es un producto financiero-tributario donde un error contable se traduce en sanciones reales (Art. 647 E.T. = 100% del mayor valor del impuesto). No podemos darnos el lujo de subagentes que improvisan, duplican trabajo o pierden contexto. Este documento codifica las reglas que el equipo sigue, sin excepción, cuando construye o audita algo no trivial.

## 2. Modelos mentales

### 2.1 Orchestrator-Subagent (patrón por defecto)

Un agente líder (típicamente Opus 4.7) descompone la tarea, despacha sub-tareas acotadas a subagentes especializados (Sonnet 4.6 / Opus 4.7), y sintetiza los resultados. Es nuestro patrón por defecto en UtopIA porque la mayoría de las tareas son descomponibles en archivos disjuntos.

**Cuándo usarlo**: descomposición clara, baja interdependencia entre subtareas, output medible. Ejemplos: un nuevo pipeline financiero (orquestador, agentes, prompts, validators, UI son archivos disjuntos), una refactor de prompts en >10 archivos.

**Cuándo NO usarlo**: cuando los subagentes necesitan compartir hallazgos intermedios constantemente, o cuando la tarea es de un solo archivo.

### 2.2 Generator-Verifier (patrón de calidad)

Un agente genera, otro verifica contra criterios explícitos. Ciclos hasta convergencia. Lo usamos en UtopIA en la cadena `agente → validator → tests/fixtures`. **Regla**: el verificador NUNCA puede recibir la instrucción genérica "verifica si está bien" — sólo "verifica que cumpla con [lista cerrada de criterios computables]". El blog Claude lo dice explícito:

> "A verifier told only to check whether output is good, with no further criteria, will rubber-stamp the generator's output."

### 2.3 Agent Teams (cuando los compañeros deben hablar entre sí)

Modo experimental de Claude Code (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). Un líder coordina y los teammates comparten una task list y mailbox. Cada teammate es una sesión Claude Code completa con su propio context window. Lo usamos para **investigación con hipótesis competidoras** y **review de PRs con dimensiones independientes** (seguridad / performance / coverage). NO lo usamos para ejecución sobre archivos compartidos.

### 2.4 Shared State y Message Bus

No usamos shared-state (riesgo de loops reactivos sin convergencia) ni message-bus (debugging imposible) en UtopIA hasta que tengamos infraestructura observable suficiente.

## 3. Los 8 principios de Anthropic Engineering

Extraídos verbatim del blog Anthropic *How we built our multi-agent research system* (2025) y validados en UtopIA:

1. **Piensa como tu agente** — Antes de delegar, simula mentalmente paso a paso lo que el subagente verá y hará. Si tú no puedes ejecutar el prompt, el agente tampoco.

2. **Enseña al orquestador a delegar** — Cada subagente debe recibir: **(a) objetivo**, **(b) formato de output**, **(c) guía de herramientas y fuentes**, **(d) límites claros de la tarea**. Sin estos cuatro elementos, los subagentes duplican trabajo o dejan huecos.

3. **Escala el esfuerzo a la complejidad** — Reglas internas:
   - Tarea trivial (búsqueda de hecho): 1 agente, 3-10 tool calls.
   - Tarea de comparación: 2-4 subagentes, 10-15 calls cada uno.
   - Tarea compleja: 10+ subagentes con responsabilidades divididas.
   - **Sweet spot UtopIA: 3-5 teammates con 5-6 tasks cada uno.**

4. **El diseño de las herramientas es crítico** — Un subagente con descripciones de herramientas malas falla silenciosamente. Anthropic logró un **40% de reducción en tiempo de completación** sólo reescribiendo descripciones de tools.

5. **Claude se auto-mejora** — *"Claude 4 models can be excellent prompt engineers. When given a prompt and a failure mode, they are able to diagnose why the agent is failing and suggest improvements."* Cuando un subagente falla, dale el prompt + el modo de fallo y pídele que diagnostique. Suele acertar.

6. **Empieza ancho, luego angosto** — Los subagentes tienden a hacer queries demasiado específicas que no devuelven nada. Instrúyelos a empezar con queries amplias y progresivamente focalizar.

7. **Guía el thinking** — Extended thinking es el scratchpad del agente. Interleaved thinking le permite evaluar cada tool call antes de decidir el siguiente. UtopIA habilita `effort: high` o `xhigh` cuando la decisión es normativa.

8. **Parallel tool calling** — Hasta 90% de reducción en tiempo cuando un subagente puede llamar 3+ tools simultáneamente. UtopIA lo aprovecha en los validators (Promise.allSettled).

## 4. Patrones de coordinación (5 oficiales del blog Claude)

| Patrón | Cuándo usar | Cuándo evitar | Estado UtopIA |
|---|---|---|---|
| Generator-Verifier | Output crítico con criterios medibles | Criterios vagos, riesgo de loops | ✅ activo |
| Orchestrator-Subagent | Descomposición clara, baja interdependencia | Subagentes deben compartir intermedios | ✅ default |
| Agent Teams | Investigación paralela larga, debate | Tareas secuenciales, edits del mismo archivo | ⚠️ casos selectos |
| Message Bus | Pipelines event-driven con ecosistema en crecimiento | Debugging difícil, fallos silenciosos | ❌ no usar todavía |
| Shared State | Investigación colaborativa con descubrimientos compartidos | Loops sin convergencia, escrituras concurrentes | ❌ no usar |

> **Recomendación oficial Anthropic**: empieza con orchestrator-subagent y evoluciona según limitaciones observadas.

## 5. Subagentes vs Agent Teams (decisión rápida)

|                  | Subagentes                                  | Agent Teams                                        |
|------------------|---------------------------------------------|----------------------------------------------------|
| Contexto         | Propio, retorna sólo el resumen al padre    | Propio, totalmente independiente                   |
| Comunicación     | Sólo reportan al main agent                 | Teammates se mensajean directamente                |
| Coordinación     | El main agent maneja todo                   | Task list compartida + auto-coordinación           |
| Mejor para       | Tareas focalizadas donde sólo importa el resultado | Trabajo complejo que requiere discusión y colaboración |
| Costo en tokens  | Menor (resumen al padre)                    | Mayor: cada teammate es una instancia Claude completa |

**Regla UtopIA**: subagentes para todo lo que sea ejecución acotada. Agent Teams sólo cuando dos roles necesitan **debatir** (ej. NIIF Auditor vs Tax Auditor enfrentando hallazgos contradictorios).

## 6. Spec completo de YAML frontmatter (subagentes)

Tomado de la doc oficial https://code.claude.com/docs/en/sub-agents (mayo 2026):

| Campo | Requerido | Uso UtopIA |
|---|---|---|
| `name` | Sí | identificador kebab-case |
| `description` | Sí | cuándo Claude debe delegar — **escribir clarísimo** |
| `tools` | No | allowlist; vacía = hereda todo |
| `disallowedTools` | No | denylist |
| `model` | No | `sonnet` / `opus` / `haiku` / `claude-opus-4-7` / `inherit` |
| `permissionMode` | No | `default` / `acceptEdits` / `auto` / `dontAsk` / `bypassPermissions` / `plan` |
| `maxTurns` | No | tope de turnos antes de parar |
| `skills` | No | preload de skills al iniciar |
| `mcpServers` | No | servidores MCP scopeados al subagente |
| `hooks` | No | lifecycle hooks (PreToolUse / PostToolUse / Stop) |
| `memory` | No | `user` / `project` / `local` — persistencia cross-session |
| `background` | No | `true` para correr siempre como background task |
| `effort` | No | `low` / `medium` / `high` / `xhigh` / `max` |
| `isolation` | No | `worktree` para git worktree aislado |
| `color` | No | `red` / `blue` / `green` / `yellow` / `purple` / `orange` / `pink` / `cyan` |
| `initialPrompt` | No | auto-submitted como primer turn cuando corre como main session |

### Reglas críticas UtopIA

- **`isolation: worktree` es obligatorio** para todo subagente que escribe código. Sin esto, dos subagentes pueden colisionar en el mismo archivo. Tras terminar, si el subagente no hizo cambios, el worktree se limpia solo.
- **`disallowedTools` antes que `tools`** cuando heredamos casi todo y queremos quitar dos cosas. Ej: agente read-only ⇒ `disallowedTools: Write, Edit`.
- **Memory `project`** para cualquier subagente que aprende patrones del codebase (recuerdos compartibles vía git).
- **Memory `user`** para subagentes que el operador humano usa cross-proyecto (rara vez en UtopIA).
- **`@-mention`** garantiza que el subagente se dispare; `natural language` deja la decisión a Claude.

## 7. Reglas de delegación efectiva

### 7.1 Lo que un brief de subagente DEBE incluir

Esta es la plantilla mínima. Si falta una sección, no envíes al subagente:

```
ROL: <una frase identificando al especialista>
OBJETIVO: <qué se debe lograr — verbo concreto + entregable>
CONTEXTO: <lo que ya sabes / lo que ya descartaste>
INPUTS: <archivos, datos, especificaciones>
HERRAMIENTAS RECOMENDADAS: <cuáles usar y cómo>
LÍMITES: <qué NO hacer, qué NO tocar>
FORMATO DE OUTPUT: <estructura exacta del retorno>
CRITERIOS DE ÉXITO: <qué se verifica al recibir el resultado>
PRESUPUESTO: <tiempo, tokens, max_turns>
```

### 7.2 Anti-patrones a EVITAR (failure modes documentados)

| Modo de fallo | Causa | Antídoto |
|---|---|---|
| Decomposición vaga ("investiga X") | Falta de objetivo + límites | Brief con plantilla §7.1 |
| Trabajo duplicado | Subagentes leyeron task igual | Reglas explícitas de división |
| Context bloat 200k+ tokens | Conversación larga sin compaction | External memory (escribir plan a archivo); `auto-compact` |
| Spawn excesivo | Sin presupuesto de esfuerzo | Reglas escalables (§3 punto 3) |
| Búsqueda infinita | Sin criterio de parada | Evaluation framework + pivote |
| Distracción inter-agente | Demasiados updates | Subagentes escriben a filesystem, lead lee al final |
| Bias de fuentes | Agentes aceptan content farms | Heurística "preferir PDFs académicos / fuentes primarias" |
| Tool descriptions malas | Inconsistencia de calidad | Tool-testing agent reescribe descripciones (40% mejora) |
| Tool execution secuencial | Diseño síncrono | Parallel tool calling (Promise.allSettled) |
| Error cascades | Sin checkpoints | Durable execution + resume from checkpoint |

## 8. Métrica oficial: por qué multi-agente

- **Anthropic Multi-Agent Research System** (2025): Lead Opus 4 + subagentes Sonnet 4 superó a single Opus 4 en **+90.2%** en su eval interna de research.
- **Reducción de tiempo**: hasta **90%** en queries complejas con parallel execution.
- **Costo en tokens**: subagentes simples ≈ **4x** chat normal; multi-agente ≈ **15x** chat normal. **Conclusión**: usa multi-agente sólo cuando el valor de la tarea justifica el costo.
- **Tres factores explican 95% de varianza** en eval BrowseComp: tokens (80%), tool calls, y elección de modelo. Subir a Sonnet 4 vale más que duplicar el budget de Sonnet 3.7.

## 9. Reglas operativas UtopIA

### 9.1 Cuántos teammates spawnar

- **Mínimo**: 3 teammates si la tarea es paralelizable.
- **Por defecto**: 4-5 teammates.
- **Máximo**: 6-7. Más allá, los retornos son decrecientes y la coordinación se vuelve overhead.
- Usamos **Opus** para roles que requieren razonamiento normativo (tax-law-specialist, validator-elite-protocol). **Sonnet** para roles mecánicos (code-writer, ui-builder).

### 9.2 Worktrees obligatorios

Cuando 2+ subagentes escriben código:

```yaml
isolation: worktree
```

Cada uno trabaja en una copia del repo en `.git/worktrees/`. El líder mergea ramas al final. Si un subagente no hace cambios, el worktree se borra automáticamente. **Cero overhead, cero colisiones.**

### 9.3 Pre-cargar contexto vía `skills`

Cuando un subagente necesita saber algo del proyecto sin descubrirlo:

```yaml
skills:
  - escudo-normativa-tributaria-co
  - elite-protocol-validators
```

El contenido completo del skill se inyecta en el prompt del subagente al inicio. **Ejemplo**: el agente `escudo-survival-backend` arranca con la normativa tributaria CO 2026 ya cargada — no tiene que buscar Art. 771-5 ET en internet ni grep el codebase.

### 9.4 Manejo de memoria persistente

```yaml
memory: project   # → .claude/agent-memory/<agent-name>/MEMORY.md
```

Para agentes que **aprenden patrones del codebase con el tiempo**: convenciones de naming, errores recurrentes que detectaron, atajos contables, edge cases del PUC. El agente lee `MEMORY.md` al iniciar (primeras 200 líneas / 25KB) y puede actualizarlo al terminar.

**Regla UtopIA**: usar `project` para conocimiento compartible vía git (default), `local` cuando contiene PII, `user` sólo si el operador lo necesita cross-repo.

### 9.5 Hooks de calidad

```yaml
hooks:
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "npx tsc --noEmit"
```

Hooks UtopIA mínimos en cualquier subagente que escriba código:
- `PostToolUse: Edit|Write` ⇒ `npx tsc --noEmit` (no merger nada que rompa tipos).
- `Stop` ⇒ `npm run lint` (warning si quedan errores ESLint).
- Opcional: `PreToolUse: Bash` ⇒ guardia que rechaza `git push --force`, `rm -rf`, etc.

## 10. Cuándo NO multi-agente

Anthropic lo dice explícito:

> "Multi-agent systems work for tasks where the value of the task is high enough to pay for the increased performance."

**Casos donde un solo Claude (sin subagentes) gana**:
- Bug fix de una línea.
- Refactor en un solo archivo.
- Tareas con muchas inter-dependencias secuenciales.
- Tareas de codificación pequeñas con poco texto verboso.
- Cuando todos los agentes necesitarían el mismo contexto idéntico.

**Casos donde multi-agente brilla**:
- Pipelines financieros con ≥3 agentes disjuntos (auditoría, optimización, validation).
- Investigación jurídica con hipótesis competidoras (Agent Teams).
- Refactors mecánicos en >20 archivos disjuntos.
- Generación de fixtures + tests + validators en paralelo.

## 11. Checklist antes de delegar

- [ ] ¿La tarea es genuinamente paralelizable? (archivos disjuntos)
- [ ] ¿Cada subagente tiene los 4 elementos del brief (objetivo / formato / guía / límites)?
- [ ] ¿Asigné `isolation: worktree` si escribirán?
- [ ] ¿Pre-cargué los skills relevantes?
- [ ] ¿Definí presupuesto de turnos / tokens?
- [ ] ¿Tengo plan de merge / sintetizar al final?
- [ ] ¿El total de tokens proyectado justifica el costo (~15x chat normal)?

Si alguna casilla queda sin marcar, **no delegues todavía**. Refina el plan o trabaja sin subagentes.

## 12. Fuentes oficiales (citar siempre)

- [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) — el blog que originó nuestro patrón orchestrator-subagent.
- [Anthropic — Building effective agents](https://www.anthropic.com/research/building-effective-agents) — principios generales de diseño.
- [Anthropic — Building agents with the Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk) — context isolation.
- [Claude Code — Sub-agents (oficial)](https://code.claude.com/docs/en/sub-agents) — spec completo de YAML frontmatter.
- [Claude Code — Agent Teams (oficial)](https://code.claude.com/docs/en/agent-teams) — modo experimental de teammates.
- [Claude — Multi-agent coordination patterns](https://claude.com/blog/multi-agent-coordination-patterns) — los 5 patrones canónicos.
- [Anthropic — Agent SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview) — patrones de producción.

## 13. Glosario UtopIA

- **Lead** / **Orchestrator**: el agente que descompone, despacha y sintetiza. Suele ser la sesión humana operada por Johan.
- **Subagent**: agente especializado que recibe una tarea, ejecuta en su propio context window, y retorna sólo el resumen.
- **Teammate**: agente Claude Code completo en un Agent Team — comparte task list con sus pares.
- **Worktree**: copia git aislada en `.git/worktrees/<name>/`, una rama paralela donde el subagente trabaja sin colisionar.
- **Skill**: contenido inyectable en el system prompt del subagente. UtopIA tiene skills custom para normativa tributaria, Elite Protocol, etc.
- **Elite Protocol**: convención UtopIA de validators de tres capas (Aritmética → Lógica de Negocio → Defensa Tributaria) con stress-tests obligatorios (auxiliares vs resumen, coherencia caja vs utilidad, Art. 647 E.T.).

---

**Última actualización**: 2026-05-08. Mantenedor: el agente líder de la sesión. Cualquier cambio a este documento debe ir acompañado de un commit en `main` con prefijo `docs(playbook):`.
