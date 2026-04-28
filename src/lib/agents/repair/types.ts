/**
 * Repair Chat — Phase 1 + Phase 2 contract.
 *
 * Shared types between:
 *   - backend  (src/lib/agents/repair/* + src/app/api/repair-chat/route.ts)
 *   - UI       (src/components/workspace/repair/*)
 *   - host     (src/components/workspace/PipelineWorkspace.tsx)
 *
 * Phase 1 scope: read-only diagnostic chat with two tools
 *   1. read_account(code)   — lookup PUC account in preprocessed balance
 *   2. mark_provisional()   — signal user intent to bypass validator with reason
 *
 * Phase 2 scope: collaborative repair with three additional tools
 *   3. propose_adjustment    — agent proposes a change, computes preview, does NOT apply
 *   4. apply_adjustment      — client-gated; emits action event, UI confirms, client mutates state
 *   5. recheck_validation    — runs preprocessor validation against current state (CSV + adjustments)
 *
 * State model: client-managed, replay on each server request. The client
 * keeps the canonical `adjustments[]` array and sends it inside every
 * RepairChatRequest. Server applies them deterministically via the pure
 * `applyAdjustments` util before running tools.
 */

export type RepairLanguage = 'es' | 'en';

// ─── Request from UI to /api/repair-chat ────────────────────────────────────

export interface RepairContext {
  /** Raw error string surfaced by the pipeline validator. */
  errorMessage: string;
  /** Original trial balance CSV, if available. Server re-preprocesses on each request. */
  rawCsv: string | null;
  language: RepairLanguage;
  companyName?: string;
  period?: string;
  /** Stable id for this repair session, used for telemetry / future persistence. */
  conversationId: string;
  /**
   * Phase 3 hardening: provisional flag that the host has confirmed for this
   * session. The hook reads it and the autosave persists it so a reload
   * preserves the user's intent. The hook does NOT mutate this — the host is
   * still the source of truth (the pipeline override flow lives there).
   */
  provisional?: ProvisionalFlag | null;
}

export interface RepairMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RepairChatRequest {
  messages: RepairMessage[];
  context: RepairContext;
  /**
   * Phase 2: client-managed adjustment ledger. Replayed on every request so
   * server reconstructs the working state without persistence. Phase 1 clients
   * may omit or send `[]` — fully backwards compatible.
   */
  adjustments?: Adjustment[];
}

// ─── SSE events from /api/repair-chat to UI ─────────────────────────────────
//
// Wire format follows the existing repo convention:
//   event: <name>\n
//   data: <json>\n\n
//
// Event names and their payloads:

export interface RepairTokenEvent {
  delta: string;
}

export interface RepairToolCallEvent {
  id: string;
  name: RepairToolName;
  args: Record<string, unknown>;
}

export interface RepairToolResultEvent {
  id: string;
  name: RepairToolName;
  result: unknown;
}

/**
 * Side-channel action: agent has decided (via tool call) that the user wants
 * to mark the report as provisional. UI must call onMarkProvisional(reason)
 * which re-triggers the pipeline with the override flag.
 */
export type RepairActionEvent =
  | { type: 'mark_provisional'; reason: string }
  | {
      /** Phase 2: agent called `apply_adjustment`. UI must show inline
       *  confirmation; only after user confirms is the adjustment status
       *  flipped to 'applied' in the client ledger. */
      type: 'confirm_adjustment';
      adjustmentId: string;
    };

export interface RepairDoneEvent {
  reason?: 'finish' | 'aborted' | 'max_rounds';
}

export interface RepairErrorEvent {
  error: string;
  detail?: string;
}

/**
 * Phase 3 hardening (P1 fix): a tool call failed before reaching the executor
 * — typically because the AI SDK rejected the model's args via the zod schema
 * (e.g. the model passed `amount: "1000"` as a string instead of a number).
 * Without surfacing these the failure is invisible to the UI: the user just
 * sees the agent stall or skip the action silently.
 *
 * Distinct from `RepairToolResultEvent`'s `{error: ...}` shape, which is the
 * runtime error path (executor ran and returned an error). This event covers
 * the *pre-execution* validation path.
 *
 * UI consumes it as a non-blocking toast; the audit log can use it to detect
 * model regressions ("agent keeps passing strings to numeric fields").
 */
export interface RepairToolErrorEvent {
  /** Tool call id from the SDK if available; synthetic uuid otherwise. */
  id: string;
  /** Tool name as the model attempted to call it. May be unknown. */
  name: string;
  /** Discriminator for the failure mode. */
  kind: 'schema_invalid' | 'unknown_tool' | 'execution_failed';
  /** Human-readable message safe to display in a toast. */
  message: string;
  /** Original args the model attempted to pass, if known. Optional — only useful for debugging. */
  args?: unknown;
}

// ─── Tool inputs and outputs ────────────────────────────────────────────────

export type RepairToolName =
  | 'read_account'
  | 'mark_provisional'
  // Phase 2 mutation tools
  | 'propose_adjustment'
  | 'apply_adjustment'
  | 'recheck_validation';

export interface ReadAccountInput {
  /** PUC code, e.g. "11", "1105", "11050501". Class digit is first. */
  code: string;
  /**
   * Multiperiodo: periodo del snapshot a inspeccionar. Si se omite, usa
   * `primary.period` y, si existe `comparative`, devuelve tambien sus
   * saldos en `comparative` para que el doctor pueda contrastar 2024 vs 2025.
   */
  period?: string;
}

export interface ReadAccountOutput {
  found: boolean;
  /** Periodo del snapshot consultado (refleja el `period` resuelto). */
  period?: string;
  account?: {
    code: string;
    name: string;
    balance: number;
    isLeaf: boolean;
    level: number;
    classCode: string;
    classTotal: number;
    children?: Array<{
      code: string;
      name: string;
      balance: number;
      isLeaf: boolean;
    }>;
  };
  /**
   * Multiperiodo: si `period` no se especifico Y existe un comparativo,
   * devolvemos tambien los saldos del comparativo (mismo codigo, distinto
   * snapshot). Permite al agente comparar saldos en una sola tool call.
   */
  comparative?: {
    period: string;
    balance: number;
    classTotal: number;
    found: boolean;
  };
  hint?: string;
}

export interface MarkProvisionalInput {
  /** User-stated reason that will appear in the report watermark. */
  reason: string;
}

export interface MarkProvisionalOutput {
  acknowledged: true;
  watermark: string;
}

// ─── Phase 2: Adjustment ledger ─────────────────────────────────────────────

export type AdjustmentStatus = 'proposed' | 'applied' | 'rejected';

export interface Adjustment {
  /** Stable id (uuid v4 or short random); generated by the agent on propose. */
  id: string;
  /** PUC code. Class digit is first; can be any level (server resolves to leaf). */
  accountCode: string;
  /** Display name. Used as-is when creating a new account. */
  accountName: string;
  /** Signed delta in COP. Positive increases the balance, negative decreases. */
  amount: number;
  /** Why the agent proposed this. Surfaces in the UI card and the audit log. */
  rationale: string;
  status: AdjustmentStatus;
  /** ISO-8601 timestamp when the agent proposed it. */
  proposedAt: string;
  /** ISO-8601 timestamp when the user confirmed. Only set if status === 'applied'. */
  appliedAt?: string;
  /** ISO-8601 timestamp when the user rejected. Only set if status === 'rejected'. */
  rejectedAt?: string;
  /**
   * Multiperiodo (refactor T1+T5): periodo al que aplica el ajuste. Si se omite,
   * el doctor lo aplica al `primary.period` por defecto. Permite anclar ajustes
   * de patrimonio o saldos iniciales al `comparative.period` cuando aplique
   * (ej. mover utilidad acumulada de 2024 a 2025).
   *
   * Convencion: matchea exactamente `PeriodSnapshot.period`. Cualquier valor
   * fuera de `preprocessed.periods[*].period` se rechaza por el aplicador.
   */
  period?: string;
}

// ─── Phase 2 tool I/O ───────────────────────────────────────────────────────

export interface ProposeAdjustmentInput {
  accountCode: string;
  /** Optional. If omitted, server falls back to existing PUC name or "Cuenta <code>". */
  accountName?: string;
  amount: number;
  rationale: string;
  /**
   * Multiperiodo: periodo del snapshot al que aplica el ajuste. Si se omite,
   * default = `primary.period`. Util para anclar ajustes patrimoniales al
   * `comparative` (ej. corregir saldo inicial 2024 que arrastra a 2025).
   */
  period?: string;
}

export interface ProposeAdjustmentOutput {
  id: string;
  preview: {
    affectedAccount: {
      code: string;
      name: string;
      oldBalance: number;
      newBalance: number;
      isNewAccount: boolean;
    };
    /** Totals as they would be IF this proposal (plus any already-applied adjustments) were applied. */
    newControlTotals: {
      activo: number;
      pasivo: number;
      patrimonio: number;
      ingresos: number;
      gastos: number;
      utilidadNeta: number;
      ecuacionDiff: number;
      ecuacionPct: number;
      ecuacionOk: boolean;
    };
  };
}

export interface ApplyAdjustmentInput {
  /** id returned by a previous propose_adjustment call. */
  id: string;
}

export interface ApplyAdjustmentOutput {
  status: 'pending_user_confirmation';
  id: string;
}

export interface RecheckValidationInput {
  /**
   * Multiperiodo: periodo del snapshot a re-validar. Si se omite, usa
   * `primary.period`. La tool acepta opcional para mantener compat con
   * llamadas previas al refactor T1.
   */
  period?: string;
}

export interface RecheckValidationOutput {
  ok: boolean;
  /** Periodo del snapshot validado. */
  period: string;
  errors: string[];
  warnings: string[];
  controlTotals: {
    activo: number;
    pasivo: number;
    patrimonio: number;
    ingresos: number;
    gastos: number;
    utilidadNeta: number;
    ecuacionDiff: number;
    ecuacionPct: number;
  };
  appliedAdjustmentsCount: number;
}

// ─── Pipeline override flag ─────────────────────────────────────────────────

/**
 * Embedded in the financial-report request body when the user has chosen to
 * mark a report as provisional via the repair chat.
 *
 * When active, the orchestrator:
 *   - still runs the validator (for warnings)
 *   - does NOT throw on hard-fail
 *   - emits "warning" SSE events instead of "error"
 *   - prepends a provenance watermark to the consolidated report
 */
export interface ProvisionalFlag {
  active: boolean;
  reason: string;
}

// ─── Phase 2: pipeline regeneration with adjustments ────────────────────────

/**
 * Embedded in the financial-report request body when the user has chosen to
 * regenerate the report with adjustments confirmed via the repair chat.
 *
 * Only adjustments with `status === 'applied'` are honored. The orchestrator
 * applies them post-preprocessing via the same pure `applyAdjustments` util
 * the chat tools use, so behavior is identical between the chat preview and
 * the final report.
 */
export interface AdjustmentLedger {
  adjustments: Adjustment[];
}
