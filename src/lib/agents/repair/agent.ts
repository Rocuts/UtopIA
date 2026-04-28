// ---------------------------------------------------------------------------
// Repair Chat — Agent runner
// ---------------------------------------------------------------------------
// Loop conversacional para "El Doctor de Datos":
//   1. Reconstruye el `PreprocessedBalance` desde `rawCsv` (si lo hay).
//   2. Llama a `streamText` con `MODELS.CHAT`, las dos tools de repair y los
//      mensajes de la conversacion.
//   3. Hace streaming token-a-token via SSE (`event: token`).
//   4. Si el modelo pide tools, las despacha (max 3 rondas), emite
//      `event: tool_call` + `event: tool_result`, y reentra al loop.
//   5. Si una tool result corresponde a `mark_provisional`, emite
//      `event: action` con el reason ANTES del done.
//   6. Cierra con `event: done` o `event: error`.
//
// Restricciones:
//   - AI SDK v6: nunca pasamos `apiKey` ni el prefijo `openai/...`.
//   - Las tools del registry NO traen `execute`: el dispatch lo hace el loop
//     manual via `executeRepairTool`.
// ---------------------------------------------------------------------------

import {
  InvalidToolInputError,
  NoSuchToolError,
  streamText,
  type ModelMessage,
  type ToolResultPart,
} from 'ai';
import { MODELS } from '@/lib/config/models';
import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import { buildRepairSystemPrompt } from './prompt';
import { executeRepairTool, repairTools } from './tools';
import type {
  Adjustment,
  RepairChatRequest,
  RepairToolErrorEvent,
  RepairToolName,
} from './types';

// Phase 2 sube de 3 → 8: el flujo "propose → apply → recheck → propose otro
// → apply → recheck" necesita más rondas que el chat read-only de Phase 1.
const MAX_ROUNDS = 8;
const MAX_OUTPUT_TOKENS = 1500;

/**
 * Runner principal. Recibe el `controller` del `ReadableStream` para emitir SSE
 * directamente, y un `abortSignal` desde la request del cliente.
 */
export async function runRepairAgent(
  req: RepairChatRequest,
  controller: ReadableStreamDefaultController<Uint8Array>,
  abortSignal: AbortSignal,
): Promise<void> {
  const encoder = new TextEncoder();
  const send = (event: string, data: unknown) => {
    try {
      controller.enqueue(
        encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
      );
    } catch {
      // controller cerrado — el cliente abortó. El loop verá abortSignal.
    }
  };

  // ---------------------------------------------------------------------------
  // 0. Reconstruir preprocessed (best-effort)
  // ---------------------------------------------------------------------------
  let preprocessed: PreprocessedBalance | null = null;
  if (req.context.rawCsv && req.context.rawCsv.trim()) {
    try {
      const rows = parseTrialBalanceCSV(req.context.rawCsv);
      if (rows.length > 0) {
        preprocessed = preprocessTrialBalance(rows);
        // Audit P1 fix: parse parcial sospechoso. Si el preprocesador devolvio
        // filas pero TODOS los totales de control quedaron en cero, casi
        // seguro el CSV venia con separador equivocado, columnas mal mapeadas
        // o saldos vacios. Tratar ese resultado como autoritativo lleva a
        // tools que reportan datos inexistentes. Caemos al raw-text fallback.
        const ct = preprocessed.controlTotals;
        if (ct.activo === 0 && ct.pasivo === 0 && ct.patrimonio === 0) {
          console.warn(
            '[repair-chat] preprocess parcial sospechoso (totales en cero), cayendo a raw-text fallback',
          );
          preprocessed = null;
        }
      }
    } catch (err) {
      console.warn(
        '[repair-chat] preprocess fallo, continuando sin balance:',
        err instanceof Error ? err.message : err,
      );
      preprocessed = null;
    }
  }

  // Phase 2: ledger replicado por el cliente. Vacio si el caller es Phase 1.
  const adjustments: Adjustment[] = Array.isArray(req.adjustments)
    ? req.adjustments
    : [];

  const systemPrompt = buildRepairSystemPrompt(
    req.context,
    preprocessed,
    adjustments,
  );

  // ---------------------------------------------------------------------------
  // Mensajes iniciales: system + historial conversacional
  // ---------------------------------------------------------------------------
  const messages: ModelMessage[] = [
    { role: 'system', content: systemPrompt },
    ...req.messages.slice(-30).map<ModelMessage>((m) => ({
      role: m.role,
      content: m.content,
    })),
  ];

  // ---------------------------------------------------------------------------
  // Loop manual: hasta 3 rondas. Cada ronda es UNA llamada al modelo. Si
  // devuelve toolCalls, ejecutamos y entramos a la siguiente ronda con los
  // resultados. Si devuelve solo texto (ya streameado), terminamos.
  // ---------------------------------------------------------------------------
  let markedProvisionalReason: string | null = null;
  /**
   * Phase 2: ids de ajustes que el agente quiere aplicar via tool. La UI los
   * recibe via `event: action {type: 'confirm_adjustment', adjustmentId}`.
   * Se emiten en orden de aparicion ANTES del `event: done`.
   */
  const pendingApplyAdjustmentIds: string[] = [];
  let doneReason: 'finish' | 'aborted' | 'max_rounds' = 'finish';

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (abortSignal.aborted) {
        doneReason = 'aborted';
        break;
      }

      const result = streamText({
        model: MODELS.CHAT,
        messages,
        tools: repairTools,
        toolChoice: 'auto',
        temperature: 0.2,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        abortSignal,
      });

      // Streaming token-a-token. El AI SDK v6 expone `textStream` (solo deltas
      // de texto del asistente) y `toolCalls` (resuelve al final del step).
      let acc = '';
      for await (const delta of result.textStream) {
        if (abortSignal.aborted) {
          doneReason = 'aborted';
          break;
        }
        if (delta.length === 0) continue;
        acc += delta;
        send('token', { delta });
      }

      if (abortSignal.aborted) {
        doneReason = 'aborted';
        break;
      }

      const toolCalls = await result.toolCalls;

      if (!toolCalls || toolCalls.length === 0) {
        // Texto final — listo.
        doneReason = 'finish';
        break;
      }

      // ---------------------------------------------------------------------
      // Hay toolCalls: empujamos el assistant message con los tool-call parts
      // (incluyendo cualquier texto previo si el modelo razono antes), luego
      // un `role: 'tool'` con los resultados.
      // ---------------------------------------------------------------------
      const assistantParts: Array<
        | { type: 'text'; text: string }
        | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
      > = [];
      if (acc.trim()) {
        assistantParts.push({ type: 'text', text: acc });
      }
      for (const tc of toolCalls) {
        assistantParts.push({
          type: 'tool-call',
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: tc.input,
        });
      }
      messages.push({ role: 'assistant', content: assistantParts });

      const toolResultParts: ToolResultPart[] = [];

      for (const tc of toolCalls) {
        const args = (tc.input as Record<string, unknown> | undefined) ?? {};

        // Audit P1 fix: si el SDK rechazo el toolCall ANTES del executor (zod
        // schema invalido o tool name desconocido), `tc.dynamic === true` y
        // `tc.invalid === true`. Surface al UI como `event: tool_error` para
        // que el usuario vea la falla, y empuja un tool-result `error-text`
        // al historial para que el modelo pueda recuperarse en la siguiente
        // ronda. NO ejecutamos el tool en este caso.
        if (tc.dynamic === true && tc.invalid === true) {
          const errCause = tc.error;
          let kind: RepairToolErrorEvent['kind'] = 'schema_invalid';
          let message = 'Tool input rechazado por el validador.';
          if (NoSuchToolError.isInstance(errCause)) {
            kind = 'unknown_tool';
            message = `Tool desconocido: ${tc.toolName}`;
          } else if (InvalidToolInputError.isInstance(errCause)) {
            kind = 'schema_invalid';
            message = errCause.message;
          } else if (errCause instanceof Error) {
            message = errCause.message;
          }

          const toolErrorEvt: RepairToolErrorEvent = {
            id: tc.toolCallId,
            name: tc.toolName,
            kind,
            message,
            args,
          };
          send('tool_error', toolErrorEvt);

          toolResultParts.push({
            type: 'tool-result',
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            output: { type: 'error-text', value: message },
          });
          continue;
        }

        send('tool_call', {
          id: tc.toolCallId,
          name: tc.toolName,
          args,
        });

        try {
          const toolResult = await executeRepairTool(
            tc.toolName as RepairToolName,
            args,
            {
              preprocessed,
              language: req.context.language,
              adjustments,
            },
          );

          send('tool_result', {
            id: tc.toolCallId,
            name: tc.toolName,
            result: toolResult,
          });

          // Si fue mark_provisional, capturamos el reason para emitir un
          // `event: action` ANTES del done.
          if (tc.toolName === 'mark_provisional') {
            const reasonArg = typeof args.reason === 'string' ? args.reason.trim() : '';
            if (reasonArg.length >= 10) {
              markedProvisionalReason = reasonArg;
            }
          }

          // Phase 2: si fue apply_adjustment con resultado pendiente de
          // confirmacion, encolamos el id para emitir `confirm_adjustment`.
          // (No emitimos en este punto para no intercalar SSE entre el
          // tool_result y el siguiente token del modelo.)
          if (
            tc.toolName === 'apply_adjustment' &&
            isPendingConfirmation(toolResult)
          ) {
            pendingApplyAdjustmentIds.push(toolResult.id);
          }

          // Empujamos el resultado al historial como JSON para que el modelo
          // lo lea en la siguiente ronda.
          toolResultParts.push({
            type: 'tool-result',
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            output: { type: 'json', value: toolResult as never },
          });
        } catch (toolErr) {
          const message =
            toolErr instanceof Error ? toolErr.message : 'tool failed';
          send('tool_result', {
            id: tc.toolCallId,
            name: tc.toolName,
            result: { error: message },
          });
          toolResultParts.push({
            type: 'tool-result',
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            output: { type: 'error-text', value: message },
          });
        }
      }

      messages.push({ role: 'tool', content: toolResultParts });

      if (round === MAX_ROUNDS - 1) {
        // Llegamos al limite con tools pendientes — corte limpio.
        doneReason = 'max_rounds';
      }
    }

    if (markedProvisionalReason) {
      send('action', {
        type: 'mark_provisional',
        reason: markedProvisionalReason,
      });
    }

    // Phase 2: emitimos un `confirm_adjustment` por cada id pendiente. La UI
    // muestra una tarjeta inline y, si el usuario confirma, flipea el status
    // del Adjustment a 'applied' en el ledger del cliente.
    for (const id of pendingApplyAdjustmentIds) {
      send('action', {
        type: 'confirm_adjustment',
        adjustmentId: id,
      });
    }

    send('done', { reason: doneReason });
    return;
  } catch (err) {
    if (abortSignal.aborted) {
      send('done', { reason: 'aborted' });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error('[repair-chat] runner error:', message);
    send('error', {
      error: 'Repair chat failed.',
      detail: message,
    });
  }
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/**
 * Discrimina el output de `apply_adjustment` cuando trae el shape esperado
 * `{ status: 'pending_user_confirmation', id: string }`. Retorna el objeto
 * tipado para que el caller pueda extraer `id` sin un cast adicional.
 */
function isPendingConfirmation(
  result: unknown,
): result is { status: 'pending_user_confirmation'; id: string } {
  if (!result || typeof result !== 'object') return false;
  const r = result as { status?: unknown; id?: unknown };
  return r.status === 'pending_user_confirmation' && typeof r.id === 'string' && r.id.length > 0;
}
