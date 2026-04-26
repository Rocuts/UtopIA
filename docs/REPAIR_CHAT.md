# Doctor de Datos — Repair Chat

Sistema colaborativo IA + usuario para reparar errores del Financial Pipeline
sin abandonar el flujo. Cuando un validador rompe el pipeline, el usuario y
el agente dialogan inline en el card de error hasta que el reporte cuadre o
el usuario decida emitirlo como borrador.

---

## ¿Por qué existe?

UtopIA tiene 9 pipelines financieros con validadores estrictos (ecuación
patrimonial, completitud NIIF, coherencia tributaria, etc.). Antes de esto,
si el validador fallaba, el pipeline lanzaba un `Error` y el usuario veía
una pared roja sin camino claro:

> "Validación fallida: Ecuación contable interna descuadrada en el reporte:
> Total Activo $4.234.960.974,66 != Total Pasivo $1.968.104.173,17 + Total
> Patrimonio $42.720,00 (diferencia $2.266.814.081,49, 53.53% del activo).
> El reporte es internamente inconsistente."

El proceso se quedaba muerto. Para usuarios sin formación contable, la
mensaje era ininteligible. Para los que sí la tenían, no había forma de
intervenir desde la UI — había que volver a Excel, corregir, y resubir.

El Doctor convierte ese muro en conversación: explica qué falló en lenguaje
natural, propone arreglos concretos con preview, y los aplica solo con
confirmación del usuario.

---

## Estado por fases

| Fase | Scope | Estado |
|---|---|---|
| **Phase 1** | Chat read-only diagnóstico. Tools: `read_account`, `mark_provisional`. Override del validador con watermark "BORRADOR" + razón en el reporte. | ✅ Entregado, en main |
| **Phase 2** | Chat colaborativo de reparación. Tools nuevas: `propose_adjustment`, `apply_adjustment`, `recheck_validation`. Util pura `applyAdjustments` aplicada también al re-run del pipeline. | ✅ Entregado, en main |
| **Phase 3 (parte 1)** | Persistencia DB del ledger (Postgres Neon via Drizzle, hidratación + autosave). Diff visual antes/después con tabs Antes/Cambios/Después y highlighting de cuentas tocadas. | ✅ Entregado, en main |
| **Phase 3.1** (deferred) | Refactor multi-pipeline en `PipelineWorkspace` + extender `adjustmentLedger` a `tax-reconciliation` (el único pipeline hermano que también consume CSV de TB). | ⏳ Diferido para después de validar Phase 3 con usuarios |
| **Phase 4** (separate sprint) | Write-back al ERP (Siigo/Helisa/WO). Requiere: (a) métodos de creación en los connectors (hoy son read-only), (b) helper de cifrado real para `erp_credentials`, (c) idempotencia y rollback de partidas posteadas, (d) testing por ERP. **No tractable en una sesión orquestada — proyecto separado de 1-2 sprints.** | ❌ Fuera de scope Phase 3 |

---

## Arquitectura

### Vista de alto nivel

```
┌──────────────────────────────────────────────────────────────┐
│ PipelineWorkspace.tsx  (host, mantiene state del pipeline)   │
│                                                               │
│  ┌── Card de error ────────────────────────────────────────┐ │
│  │                                                          │ │
│  │  [Mensaje de validación fallida]                         │ │
│  │                                                          │ │
│  │  [Hablar con El Doctor] [Continuar de todas formas]     │ │
│  │                                                          │ │
│  │  ┌── RepairChat (inline, expandible) ─────────────────┐ │ │
│  │  │  • Transcript (mensajes + tool calls visibles)    │ │ │
│  │  │  • Cards de adjustments (proposed/applied/rejected)│ │ │
│  │  │  • Validation strip (totales actualizados)        │ │ │
│  │  │  • CTA "Regenerar reporte" cuando ok=true         │ │ │
│  │  │  • Composer con textarea auto-grow                │ │ │
│  │  └────────────────────────────────────────────────────┘ │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                             │
                             │  POST /api/repair-chat (SSE)
                             │  body: {messages, context, adjustments[]}
                             ▼
┌──────────────────────────────────────────────────────────────┐
│ /api/repair-chat/route.ts                                     │
│   • zod schema validation                                     │
│   • redactPII en mensajes de usuario                          │
│   • abre ReadableStream → runRepairAgent                      │
└──────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│ runRepairAgent  (src/lib/agents/repair/agent.ts)              │
│   1. parseTrialBalanceCSV + preprocessTrialBalance(rawCsv)    │
│   2. buildRepairSystemPrompt(ctx, preprocessed, adjustments)  │
│   3. Loop (hasta 8 rondas):                                   │
│      • streamText con repairTools                             │
│      • Si toolCalls: emit SSE tool_call → executeRepairTool   │
│        → emit SSE tool_result                                 │
│      • Si action (mark_provisional / confirm_adjustment):     │
│        emit SSE action                                        │
│   4. emit SSE done                                            │
└──────────────────────────────────────────────────────────────┘
                             │
                             ▼ (cuando user confirma "Regenerar")
┌──────────────────────────────────────────────────────────────┐
│ POST /api/financial-report                                    │
│   body: {...phase1Body, adjustmentLedger: {adjustments}}      │
│   → orchestrator.ts aplica adjustments POST-preprocesamiento  │
│   → genera Stage 1 (NIIF) → 2 (Estrategia) → 3 (Gobierno)     │
│   → reporte final con sección "## Ajustes contables aplicados"│
└──────────────────────────────────────────────────────────────┘
```

### Modelo de estado

**Cliente** (canónico):
- `useRepairChat` mantiene el `adjustments[]` ledger client-side
- Cada turno re-envía el ledger completo al servidor (replay model)
- Server es **stateless** — no persiste nada entre requests

**Por qué replay y no DB**: simplicidad. El usuario rara vez necesita
recuperar una sesión de repair perdida (el pipeline original sigue
disponible, puede reabrir el chat en cualquier momento). Phase 3
considera moverlo a Postgres si el feedback lo amerita.

---

## File map

### Backend (`src/lib/agents/repair/`)

| Archivo | Responsabilidad |
|---|---|
| [`types.ts`](../src/lib/agents/repair/types.ts) | Contrato compartido. **Single source of truth** para todos los tipos del Doctor. |
| [`prompt.ts`](../src/lib/agents/repair/prompt.ts) | `buildRepairSystemPrompt(ctx, preprocessed, adjustments)`. Inyecta resumen denso del balance, lista de adjustments, instrucciones de tools. Bilingüe ES/EN. |
| [`tools.ts`](../src/lib/agents/repair/tools.ts) | Define `repairTools` (AI SDK v6 `tool({})`) y `executeRepairTool(name, args, ctx)`. 5 tools: `read_account`, `mark_provisional`, `propose_adjustment`, `apply_adjustment`, `recheck_validation`. |
| [`adjustments.ts`](../src/lib/agents/repair/adjustments.ts) | **Util pura** `applyAdjustments(balance, adjs[])` y `revalidate(balance)`. Single source of truth para mutar `PreprocessedBalance`. Usado tanto por las tools como por el orchestrator. |
| [`agent.ts`](../src/lib/agents/repair/agent.ts) | `runRepairAgent(req, controller, signal)`. Loop manual (max 8 rondas), streamText, emite SSE token/tool_call/tool_result/action/done/error. |

### Backend ruta + integración pipeline

| Archivo | Cambio |
|---|---|
| [`/api/repair-chat/route.ts`](../src/app/api/repair-chat/route.ts) | Endpoint SSE. zod validation + redactPII. Llama `runRepairAgent`. |
| [`/api/financial-report/route.ts`](../src/app/api/financial-report/route.ts) | Acepta `adjustmentLedger` opcional en el body. Propaga al orchestrator en JSON y SSE. |
| [`financial/orchestrator.ts`](../src/lib/agents/financial/orchestrator.ts) | Acepta `OrchestrateFinancialOptions.adjustmentLedger` y `.provisional`. Aplica adjustments post-preprocesamiento via `applyAdjustments`. Watermark provisional + sección "Ajustes contables aplicados" se prepend/append automáticamente. |

### UI (`src/components/workspace/repair/`)

| Archivo | Responsabilidad |
|---|---|
| [`RepairChat.tsx`](../src/components/workspace/repair/RepairChat.tsx) | Componente principal inline (no modal). Header + transcript + adjustments + validation strip + CTA regen + composer. |
| [`useRepairChat.ts`](../src/components/workspace/repair/useRepairChat.ts) | Hook de orquestación: SSE consumer, ledger client-side, callbacks `confirmAdjustment` / `rejectAdjustment` / `consumeProvisional` / `consumeAdjustmentConfirmation`. |
| [`AdjustmentCard.tsx`](../src/components/workspace/repair/AdjustmentCard.tsx) | Card visual por adjustment, status-aware (proposed amber, applied green, rejected gray). |
| [`ValidationStatusStrip.tsx`](../src/components/workspace/repair/ValidationStatusStrip.tsx) | Strip pegajoso con totales actualizados y banner ok/falla. Aparece después de cada `recheck_validation`. |

### Host

| Archivo | Cambio |
|---|---|
| [`PipelineWorkspace.tsx`](../src/components/workspace/PipelineWorkspace.tsx) | Inyecta los dos botones en el card de error. Mantiene `showRepair`, `repairConvId`, `repairSeed`. Callbacks `handleMarkProvisional` y `handleRegenerateWithAdjustments` mutan `pipelineInput` con flag/ledger → effect re-corre pipeline. |

---

## Contrato de tipos (resumen)

Ver [`src/lib/agents/repair/types.ts`](../src/lib/agents/repair/types.ts)
para la definición canónica. Highlights:

```typescript
// Request del UI al server
interface RepairChatRequest {
  messages: RepairMessage[];
  context: RepairContext;       // errorMessage, rawCsv, language, etc.
  adjustments?: Adjustment[];   // ledger replicado client-side
}

// Eventos SSE del server al UI
type RepairTokenEvent       = { delta: string };
type RepairToolCallEvent    = { id, name, args };
type RepairToolResultEvent  = { id, name, result };
type RepairActionEvent      =
  | { type: 'mark_provisional'; reason }
  | { type: 'confirm_adjustment'; adjustmentId };
type RepairDoneEvent        = { reason?: 'finish' | 'aborted' | 'max_rounds' };
type RepairErrorEvent       = { error; detail? };

// Adjustment ledger
interface Adjustment {
  id: string;
  accountCode: string;
  accountName: string;
  amount: number;               // signed delta en COP
  rationale: string;
  status: 'proposed' | 'applied' | 'rejected';
  proposedAt: string;
  appliedAt?: string;
  rejectedAt?: string;
}

// Flags de override que viajan con el pipeline regeneration
interface ProvisionalFlag    { active: boolean; reason: string }
interface AdjustmentLedger   { adjustments: Adjustment[] }
```

---

## Flujos canónicos

### Flow 1: Diagnóstico simple

1. Pipeline falla → card rojo con `error` string.
2. Usuario click "Hablar con El Doctor" → toggle `showRepair=true` → mount `<RepairChat>`.
3. RepairChat hace POST a `/api/repair-chat` cuando el usuario manda el primer mensaje.
4. Agente llama `read_account('1120')` para inspeccionar saldos.
5. Agente responde explicando la causa raíz.
6. Usuario decide qué hacer: cerrar el chat, marcar provisional, o aplicar ajustes (Phase 2).

### Flow 2: Override → borrador

1. Usuario click "Continuar de todas formas" → setea `repairSeed = "Quiero generar el reporte como borrador..."`.
2. RepairChat auto-envía ese mensaje al montar (vía `initialUserMessage`).
3. Agente reconoce intención, confirma con el usuario, y llama `mark_provisional({reason})`.
4. SSE `event: action {type: 'mark_provisional', reason}`.
5. UI muestra panel ámbar con "Confirmar y generar borrador" / "Cancelar".
6. Click "Confirmar" → `onMarkProvisional(reason)` → host mutates `pipelineInput.provisional = {active, reason}`.
7. `lastProcessedInputRef.current` invalidado por cambio de identidad → `useEffect` re-corre pipeline.
8. Orchestrator detecta `provisional.active`, ejecuta validador pero no throw, prepend watermark "BORRADOR — VALIDACIÓN PENDIENTE" al reporte.

### Flow 3: Reparación colaborativa (Phase 2)

1. Usuario pide al Doctor que diagnostique el descuadre.
2. Agente: "Tu activo es $X, pasivo+patrimonio es $Y. Faltan $Z. No veo cuentas de la clase 11. ¿Tu empresa tiene saldo en bancos al cierre?"
3. Usuario: "Sí, en Bancolombia tengo $2.266.000.000 al 31/12".
4. Agente llama `propose_adjustment({accountCode: '1110', amount: 2266000000, rationale: '...'})`.
5. SSE `tool_result` con preview: oldBalance, newBalance, newControlTotals con `ecuacionOk: true`.
6. Cliente agrega `Adjustment{status: 'proposed'}` al ledger.
7. Agente confirma con el usuario y llama `apply_adjustment({id})`.
8. SSE `event: action {type: 'confirm_adjustment', adjustmentId}`.
9. UI muestra panel ámbar "Confirma para aplicar ajuste {id}".
10. Click "Aplicar" → `confirmAdjustment(id)` → status flip a `'applied'` con `appliedAt`.
11. Agente llama `recheck_validation()` → server aplica `applied` adjustments via `applyAdjustments`, re-valida, devuelve `ok: true`.
12. UI muestra `ValidationStatusStrip` verde + banner CTA "Regenerar reporte completo con estos ajustes".
13. Click CTA → `onRegenerateWithAdjustments(applied[])` → host mutates `pipelineInput.adjustmentLedger`.
14. Pipeline re-corre con ledger; orchestrator aplica adjustments post-preprocesamiento; reporte final con sección "## Ajustes contables aplicados".

---

## Ganchos para Phase 3

### Hook 1: `applyAdjustments` se reusa en write-back ERP

La util pura ya separa **dato derivado** de **fuente**:

```typescript
applyAdjustments(originalBalance, adjustments[]): { balance, affected[] }
```

`affected[]` lista cada cuenta tocada con `{accountCode, oldBalance, newBalance, isNewAccount}`. Phase 3 puede recorrer este array y llamar al SDK del ERP para empujar cada cambio. Recomendación: nuevo tool `write_back_erp(adjustmentId)` que use el connector existente (`src/components/workspace/ERPConnector.tsx` ya tiene UI; falta el SDK por ERP).

### Hook 2: Soporte para los otros 8 pipelines

Hoy solo `/api/financial-report` acepta `adjustmentLedger`. El patrón es idéntico para los hermanos. Por cada pipeline:

1. Extender `OrchestrateXxxOptions` con `adjustmentLedger?: AdjustmentLedger`.
2. Aplicar `applyAdjustments` post-preprocesamiento (si el pipeline preprocesa balance).
3. Aceptar `adjustmentLedger` en el body schema del route.

`PipelineWorkspace.tsx` ya tiene el wire-up al `phase1Body` — replicar para los routes hermanos solo requiere cambiar la URL.

### Hook 3: Diff visual

El reporte original (sin adjustments) y el reporte regenerado son ambos Markdown. Un componente `<ReportDiff before={originalMd} after={regenMd} />` puede renderizar diff usando `diff-match-patch` o similar. El `affected[]` array de `applyAdjustments` puede subrayar las cuentas tocadas.

### Hook 4: Persistencia DB del ledger

Hoy el ledger vive en `useRepairChat` y se pierde si cierras el tab. Phase 3 puede agregar tabla `repair_sessions(id, workspace_id, created_at, error_msg, adjustments_jsonb, provisional_jsonb)` con migración Drizzle. El hook se hidrata desde DB al montar y persiste en cada cambio. Ver patrón en `src/lib/db/schema.ts`.

### Hook 5: Telemetría / audit log

Eventos críticos para auditoría futura: `provisional_marked`, `adjustment_proposed`, `adjustment_applied`, `adjustment_rejected`, `pipeline_regenerated_with_adjustments`. Sugerencia: tabla `repair_events` o reusar la infra de `reports` con `event_type` discriminator.

---

## Consideraciones no funcionales

### Costos LLM

- Modelo: `MODELS.CHAT` (default `gpt-4o-mini`).
- Max output tokens por ronda: 1500.
- Max rondas por turno: 8 (Phase 2).
- Estimado por turno: ~52K tokens, ~$0.05-0.10 USD.
- El system prompt carga el resumen denso del balance (~5K tokens) cada turno — no hay prompt caching todavía. Phase 3 con migración a SDK Anthropic + `cache_control` puede bajar el costo 50-70%.

### Seguridad

- ✅ PII filter (`redactPII`) aplicado a mensajes de usuario en route.
- ✅ rawCsv y errorMessage **no** se redactan (analogo al documentContext del chat principal — el preprocessor necesita los códigos PUC reales).
- ✅ zod schema valida estructura del request (anti-injection).
- ✅ Rate limiting global de `/api/*` aplica via `src/middleware.ts`.
- ✅ AbortController propagado: si el cliente cierra SSE, el `streamText` aborta limpio.
- ⚠️ No hay observability instrumentation todavía (P1).

### Edge cases manejados

- `rawCsv === null` → todas las tools devuelven hint "no hay balance preprocesado".
- `accountCode` no numérico → tool devuelve error con hint.
- `propose_adjustment` con cuenta no existente → `applyAdjustments` la crea como hoja en la clase derivada del primer dígito (1=Activo, 2=Pasivo, 3=Patrimonio, etc.).
- `apply_adjustment` con id no existente → tool devuelve error string al modelo, que reintenta.
- Múltiples ajustes a la misma cuenta → `applyAdjustments` los acumula secuencialmente.
- `provisional` + `adjustmentLedger` simultáneos → `handleRegenerateWithAdjustments` limpia provisional explícitamente (los datos sí se repararon, no hay razón para watermark).

### Limitaciones conocidas

- Solo soporta `/api/financial-report`. Otros pipelines pendientes (Phase 3).
- Validador post-LLM puede fallar después de regenerar con ajustes si el LLM aluciona los totales (no respeta el balance ajustado). El system prompt del orchestrator puede reforzarse con "los totales DEBEN ser ${ct.activo}, ${ct.pasivo}, ${ct.patrimonio}".
- Diff visual no existe — el usuario solo ve el reporte final.
- No hay write-back al ERP — los ajustes existen solo en el reporte generado, no en el sistema fuente.

---

## Cómo probarlo manualmente

1. Subir un balance que descuadre la ecuación patrimonial (ej. uno donde falte cargar la clase 11 — Disponible).
2. Esperar que el pipeline reviente con "Validación fallida".
3. Click "Hablar con El Doctor" en el card de error.
4. Pedirle: "explícame qué falló y cómo arreglarlo".
5. Verificar que llame `read_account` y proponga ajustes coherentes.
6. Confirmar un ajuste → ver panel ámbar → "Aplicar".
7. Pedir "vuelve a validar" → ver `ValidationStatusStrip` aparecer.
8. Si la ecuación cuadra, debe aparecer CTA verde de regeneración.
9. Click CTA → pipeline corre de nuevo → reporte final con sección de ajustes.

Validar también el camino "Continuar de todas formas":

1. Click ese botón → chat se abre con seed prellenado.
2. El agente confirma intención y llama `mark_provisional`.
3. Confirmar → reporte sale con watermark "BORRADOR — VALIDACIÓN PENDIENTE".

---

## Versionado

- **2026-04-26 — Phase 1 + Phase 2 GA en main**: chat colaborativo completo en `/api/financial-report` con override y reparación de ajustes.
- **2026-04-26 — Phase 3 parte 1 GA en main**: persistencia DB del ledger + diff visual antes/después. Migración 0002 aplicada manualmente en Neon producción (commit `e8b9907`).
- **2026-04-26 — Hotfix OCR PDF (`e8b9907`)**: fixed "no tengo acceso" cuando `pipelineInput.rawData` es texto OCR de PDF/imagen (no CSV). Nueva función `buildRawTextFallback` en `prompt.ts` inyecta el texto crudo truncado a 15K chars cuando `parseTrialBalanceCSV` retorna 0 filas. El agente ahora razona sobre raw text + totales del error message.
- **2026-04-26 — Post-deploy audit fixes (`b9fa6a9`)**: dos P1 detectados en auditoría con Opus 4.7. (1) `executeReadAccount` ahora alinea su hint con el prompt fallback (antes contradecía). (2) `useRepairChat` ahora reemplaza el ledger client-side incluso cuando el server devuelve `adjustments: []` (antes mantenía state ephemeral, desincronizándose).

## Auditoría post-deploy (2026-04-26)

Auditoría con Opus 4.7 sobre todo el sistema Phases 1-3. Hallazgos:

### Falsos positivos descartados
- **Drizzle `setWhere` supuestamente inválido** — verificado en `node_modules/drizzle-orm/pg-core/query-builders/insert.d.ts:66`, sí es opción soportada. La protección cross-workspace funciona como diseñada.
- **LCS uint32 overflow** — V8 crashea por OOM antes de overflow real. No es problema práctico.

### P1 arreglados (commit `b9fa6a9`)
- Tool ↔ prompt incoherentes cuando no hay preprocessed.
- Hidratación silenciosa cuando server devolvía sesión con `[]`.

### P1 diferidos (vigilar, no bloquean producción)
- **CSV partial-parse silencioso** (`agent.ts:67-68`): si el parser retornase pocas filas con códigos válidos pero balance vacío, las tools podrían reportar datos parciales como autoritativos. Mitigación sugerida: detectar `controlTotals.activo === 0 && pasivo === 0 && patrimonio === 0` y caer al fallback de raw text.
- **Multi-tab autosave race** (`persistence.ts:201-203`): si el usuario abre el mismo `conversationId` en dos tabs (no ocurre con `crypto.randomUUID()` por tab, pero sí si llega del DB hidratado), DELETE+INSERT concurrentes pueden corromper el ledger. Mitigación sugerida: serializar con `SELECT FOR UPDATE` o cambiar a driver `neon` con WS para transacciones interactivas.
- **Zod-rejected tool calls invisibles** (`tools.ts:88-91`): si el LLM pasa `amount: "1000"` (string) en vez de número, Zod throw → `streamText` lo maneja silenciosamente. Mitigación: surface schema-failed tool calls como evento UI.
- **Autosave errors silenciados** (`useRepairChat.ts:245`): persistence falla → console.error sin feedback al usuario. Mitigación: toast no-bloqueante.
- **Hardcoded `provisional: null` en autosave** (`useRepairChat.ts:221`): si el host marca provisional, DB nunca lo ve, recargas pierden la intención.
- **`numeric(20,2)` precision >$9,007 trillones** (`persistence.ts:92`): saldos colombianos prácticos no exceden 16 dígitos significativos, pero un valor extremo silencioso redondea. Mitigación: usar string para amount o validar overflow.

### P2 / no-bloqueantes
- `cachedIndex` singleton serverless (concurrencia rebuilds, sin issue de correctitud).
- Watermark provisional + adjustmentLedger simultáneos (caso raro, comportamiento actual aceptable).

## Plan para la próxima sesión

Ordenado por valor entregado / tiempo:

### 1. Endurecer los P1 diferidos (1 sesión, ~3 horas)
- Surface schema-failed tool calls al UI (toast pequeño).
- Toast de error en autosave (non-blocking).
- Detectar parse parcial sospechoso en `agent.ts` y caer al raw-text fallback.
- Persistir `provisional` en autosave (eliminar el TODO).
- Validar overflow de `numeric(20,2)` en `persistence.ts:92`.

**Por qué primero**: bajo costo, alto impacto en confianza del sistema. Cierra los flecos de la auditoría.

### 2. Phase 3.1 — multi-pipeline + tax-reconciliation (1-2 sesiones)
- Refactor `PipelineWorkspace.tsx` para soportar `pipelineKind: 'financial-report' | 'tax-reconciliation'`.
- Extender `tax-reconciliation/orchestrator.ts` para preprocesar el TB (hoy no lo hace) y aceptar `adjustmentLedger`.
- Schema zod del route hermano duplica el de financial-report.
- Coordinación: WS4 (refactor host) primero, WS3 (extension del orchestrator) segundo.

**Por qué segundo**: el otro pipeline que consume CSV de TB; replica un patrón ya validado.

### 3. Telemetría / audit log (1 sesión)
- Tabla `repair_events(id, workspace_id, event_type, payload jsonb, created_at)` con tipos: `provisional_marked`, `adjustment_proposed`, `adjustment_applied`, `adjustment_rejected`, `pipeline_regenerated`.
- Hook server-side desde route + orchestrator.
- Dashboard simple para revisor fiscal en `/workspace/audit/repair-log` (opcional).

**Por qué importante**: trazabilidad para revisor fiscal cuando un reporte fue editado vía Doctor.

### 4. Migración a SDK Anthropic + prompt caching (1 sesión)
- Hoy cada turno carga el balance summary completo (~5K tokens) sin caché. Costo ~$0.05-0.10 USD/turno.
- Migrando a SDK Anthropic con `cache_control` baja el costo 50-70% en turnos de seguimiento.
- Trade-off: cambia el provider del orchestrator existente. Requiere coordinación con el resto del sistema (que también usa OpenAI directo).

**Por qué después**: el sistema funciona bien sin esto; es optimización pura.

### 5. Phase 4 — Write-back al ERP (proyecto separado, 1-2 sprints)
**No tractable en una sesión orquestada.** Requiere:
- Métodos POST en cada provider (`siigo.ts`, `helisa.ts`, `world-office.ts`, etc.). Hoy todos son read-only.
- Helper AES-256-GCM real para `erp_credentials` (la columna existe, el código no cifra).
- Idempotencia keys por ERP, manejo de partidas dobles balanceadas, rollback de partidas posteadas.
- Suite de tests por ERP con sandbox/dev environment.
- Acceso a credenciales sandbox de cada ERP — bloqueante operacionalmente.

**Por qué tan pesado**: cada ERP tiene su propio schema, autenticación, y manejo de errores. No es código que se pueda escribir especulativamente — necesita testing real.

## Cómo retomar la próxima sesión

1. Lee este doc (`docs/REPAIR_CHAT.md`) primero — todo el contexto está aquí.
2. Decide cuál de los 5 ítems del plan querés atacar.
3. Si es 1 (endurecer P1s) o 2 (Phase 3.1), puedes orquestar agentes Opus 4.7 con el patrón ya probado: contrato de tipos en `types.ts` → 2-3 agentes en paralelo sobre archivos disjuntos → integrar y verificar.
4. Si es 3 (telemetría) o 4 (caching), un solo agente alcanza.
5. Si es 5 (write-back ERP), no lo arranques solo: necesita planeación con acceso a credenciales sandbox.

### Comandos útiles

```bash
# Ver estado de la migración en producción
DATABASE_URL=$(vercel env pull --environment=production /tmp/.env.audit && grep '^DATABASE_URL_UNPOOLED=' /tmp/.env.audit | cut -d= -f2-) \
  node -e 'const {neon}=require("@neondatabase/serverless");const sql=neon(process.env.DATABASE_URL);sql.query("SELECT table_name FROM information_schema.tables WHERE table_schema=$1",["public"]).then(r=>console.log(r.rows.map(x=>x.table_name).join(",")))' \
  && rm /tmp/.env.audit

# Smoke test del repair chat sin LLM
curl -X POST https://utopia.vercel.app/api/repair-chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"hola"}],"context":{"errorMessage":"test","rawCsv":null,"language":"es","conversationId":"test-123"}}'

# tsc + build local
npx tsc --noEmit && npm run build
```

## Estado de archivos por fase

### Phase 3 parte 1 (parche actual)

| Archivo | Tipo | Workstream |
|---|---|---|
| `src/lib/db/schema.ts` | MODIFY | WS1 — agrega `repair_sessions`, `repair_adjustments` |
| `src/lib/agents/repair/persistence.ts` | NEW | WS1 — `loadSession`, `upsertSession` |
| `src/app/api/repair-session/route.ts` | NEW | WS1 — GET/PUT del ledger |
| `src/components/workspace/repair/useRepairChat.ts` | MODIFY | WS1 — hidratación + autosave debounce 500ms |
| `src/lib/diff/markdown-diff.ts` | NEW | WS2 — util LCS pura, sin deps |
| `src/components/workspace/ReportDiff.tsx` | NEW | WS2 — tabs Antes/Cambios/Después |
| `src/components/workspace/PipelineWorkspace.tsx` | MODIFY | WS2 — captura `originalReport` + toggle de diff |

### Phase 3.1 deferred (cuando vuelva el feedback)

| Workstream | Archivos previstos | Notas |
|---|---|---|
| WS3 — Extender `adjustmentLedger` a `tax-reconciliation` | `src/lib/agents/financial/tax-reconciliation/orchestrator.ts`, `src/app/api/tax-reconciliation/route.ts`, `src/lib/validation/schemas.ts` | El orchestrator hoy NO preprocesa TB — hay que agregar `parseTrialBalanceCSV` + `preprocessTrialBalance` antes del Stage 1 |
| WS4 — Refactor multi-pipeline en `PipelineWorkspace` | `src/components/workspace/PipelineWorkspace.tsx`, `src/types/platform.ts` | Variable `pipelineKind` + routing condicional del fetch + repair chat agnóstico al pipeline |

### Fuera de Phase 3 (proyecto separado)

- **Write-back al ERP** — los connectors actuales (`src/lib/erp/providers/*.ts`) son **read-only**. No existe `createJournalEntry` ni equivalente en ningún provider. Tampoco hay helper de cifrado real para `erp_credentials` (la columna existe; el código no cifra). Implementarlo requiere:
  - Métodos POST en cada provider (descubrir endpoints de creación, schemas distintos, manejo de partidas dobles balanceadas)
  - Capa de idempotencia keys (Siigo y Helisa la documentan; WorldOffice no necesariamente)
  - Helper AES-256-GCM real para cifrar credentials antes de pasarlos al connector
  - Suite de tests por ERP con sandbox/dev environment de cada uno
  - Manejo de errores 4xx/5xx específicos, rollback de partidas posteadas, y telemetría
  
  **Alcance estimado: 1-2 sprints dedicados con acceso a ambientes sandbox de cada ERP.**
