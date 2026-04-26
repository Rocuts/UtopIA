/**
 * Repair Chat — Phase 1 contract.
 *
 * Shared types between:
 *   - backend  (src/lib/agents/repair/* + src/app/api/repair-chat/route.ts)
 *   - UI       (src/components/workspace/repair/*)
 *   - host     (src/components/workspace/PipelineWorkspace.tsx)
 *
 * Phase 1 scope: read-only diagnostic chat with two tools
 *   1. read_account(code)   — lookup PUC account in preprocessed balance
 *   2. mark_provisional()   — signal user intent to bypass validator with reason
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
}

export interface RepairMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RepairChatRequest {
  messages: RepairMessage[];
  context: RepairContext;
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
export interface RepairActionEvent {
  type: 'mark_provisional';
  reason: string;
}

export interface RepairDoneEvent {
  reason?: 'finish' | 'aborted' | 'max_rounds';
}

export interface RepairErrorEvent {
  error: string;
  detail?: string;
}

// ─── Tool inputs and outputs ────────────────────────────────────────────────

export type RepairToolName = 'read_account' | 'mark_provisional';

export interface ReadAccountInput {
  /** PUC code, e.g. "11", "1105", "11050501". Class digit is first. */
  code: string;
}

export interface ReadAccountOutput {
  found: boolean;
  account?: {
    code: string;
    name: string;
    balance: number;
    previousBalance: number | null;
    isLeaf: boolean;
    level: number;
    classCode: string;
    classTotal: number;
    children?: Array<{
      code: string;
      name: string;
      balance: number;
      previousBalance: number | null;
      isLeaf: boolean;
    }>;
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
