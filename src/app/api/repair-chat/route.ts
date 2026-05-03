// ---------------------------------------------------------------------------
// POST /api/repair-chat — SSE endpoint para "El Doctor de Datos"
// ---------------------------------------------------------------------------
// Recibe el contexto del fallo de validacion + historial conversacional y
// devuelve un stream SSE con eventos: token, tool_call, tool_result, action,
// done, error. El runner vive en `src/lib/agents/repair/agent.ts`.
//
// AbortController: si el cliente cierra la conexion antes de tiempo, el
// `request.signal` se propaga al `streamText` y el loop sale limpio.
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runRepairAgent } from '@/lib/agents/repair/agent';
import type { RepairChatRequest } from '@/lib/agents/repair/types';
import { redactPII } from '@/lib/security/pii-filter';
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Validation schema (inline — no se reusa con otras rutas)
// ---------------------------------------------------------------------------

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(10_000),
});

// ---------------------------------------------------------------------------
// Adjustment ledger (Phase 2). El cliente envia el array completo en cada
// request (replay). El servidor es stateless; no persiste nada.
// ---------------------------------------------------------------------------
const adjustmentSchema = z.object({
  id: z.string().min(1).max(100),
  accountCode: z.string().min(1).max(10),
  accountName: z.string().min(1).max(200),
  amount: z.number().refine(
    (n) => Number.isFinite(n),
    'amount debe ser finito',
  ),
  rationale: z.string().min(1).max(2_000),
  status: z.enum(['proposed', 'applied', 'rejected']),
  proposedAt: z.string().min(1).max(40),
  appliedAt: z.string().min(1).max(40).optional(),
  rejectedAt: z.string().min(1).max(40).optional(),
});

const requestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(50),
  context: z.object({
    errorMessage: z.string().min(1).max(20_000),
    rawCsv: z.string().max(500_000).nullable(),
    language: z.enum(['es', 'en']),
    companyName: z.string().max(200).optional(),
    period: z.string().max(20).optional(),
    conversationId: z.string().min(1).max(100),
  }),
  adjustments: z.array(adjustmentSchema).max(50).optional().default([]),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const details = parsed.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`,
    );
    return NextResponse.json(
      { error: 'Invalid request format.', details },
      { status: 400 },
    );
  }

  // Redactar PII (NIT, cedulas, emails, telefonos, tarjetas) en los mensajes
  // del usuario ANTES de pasarlos al LLM. La rawCsv y el errorMessage pasan
  // sin redactar — analogos al `documentContext` del chat principal — porque
  // las tools necesitan operar sobre los codigos PUC reales y los totales.
  const validated: RepairChatRequest = {
    ...parsed.data,
    messages: parsed.data.messages.map((m) =>
      m.role === 'user' ? { ...m, content: redactPII(m.content) } : m,
    ),
  };
  const abortController = new AbortController();
  // Propagar el abort del cliente (cierre de SSE) al streamText.
  if (req.signal) {
    if (req.signal.aborted) abortController.abort();
    else req.signal.addEventListener('abort', () => abortController.abort());
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await runRepairAgent(validated, controller, abortController.signal);
      } finally {
        try {
          controller.close();
        } catch {
          // ya cerrado
        }
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
