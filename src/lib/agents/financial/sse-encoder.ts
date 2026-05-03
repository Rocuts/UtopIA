// ---------------------------------------------------------------------------
// SSE Encoder — helper genérico para todas las API routes que streamean
// eventos del BasePipeline o de sus orchestrators.
// ---------------------------------------------------------------------------
// Centraliza:
//  * el formato `data: <json>\n\n` (spec EventSource)
//  * los headers anti-buffering correctos para Vercel (`X-Accel-Buffering: no`)
//  * los TextEncoder reusables
//
// El encoder NO sabe de tipos de eventos del dominio: cada orchestrator emite
// su propio shape (`FinancialProgressEvent`, `AuditProgressEvent`, etc.) y
// los serializa via `encode<T>()`. Esto deja la capa de transporte agnostica
// y permite cambiar el wire-format (e.g. a chunked JSON) sin tocar dominio.
// ---------------------------------------------------------------------------

import type { PipelineEvent } from './base-pipeline';

const TEXT_ENCODER = new TextEncoder();

/**
 * Encoder con su propio scope. Usalo desde una API route una sola vez por
 * request y reusa la misma instancia para todos los `encode()`.
 */
export interface SseEncoder {
  /** Codifica un evento del dominio (any) al formato SSE `data: ...\n\n`. */
  encode<T>(event: T): Uint8Array;
  /** Codifica un evento BasePipeline directamente — lo usa BasePipeline interno. */
  encodePipelineEvent(event: PipelineEvent): Uint8Array;
  /** Comentario keep-alive para flushear buffers de proxies. */
  ping(): Uint8Array;
  /** Headers SSE recomendados para Next.js + Vercel + NGINX. */
  headers(): HeadersInit;
}

export function createSseEncoder(): SseEncoder {
  return {
    encode<T>(event: T): Uint8Array {
      return TEXT_ENCODER.encode(`data: ${JSON.stringify(event)}\n\n`);
    },
    encodePipelineEvent(event: PipelineEvent): Uint8Array {
      return TEXT_ENCODER.encode(`data: ${JSON.stringify(event)}\n\n`);
    },
    ping(): Uint8Array {
      // Comentario SSE — el cliente lo ignora pero fuerza flush.
      return TEXT_ENCODER.encode(`: ping\n\n`);
    },
    headers(): HeadersInit {
      return {
        'Content-Type': 'text/event-stream',
        // No-cache para que ningun proxy buferee la respuesta entera.
        'Cache-Control': 'no-cache, no-store, no-transform',
        Connection: 'keep-alive',
        // Vercel/NGINX: desactiva buffering para streaming en tiempo real.
        'X-Accel-Buffering': 'no',
      };
    },
  };
}
