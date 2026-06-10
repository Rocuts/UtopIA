import { bigintReplacer } from '@/lib/preprocessing/json-safe';

// ---------------------------------------------------------------------------
// Emisor SSE seguro para los route handlers del pipeline financiero.
//
// Dos fallos de producción que este helper cierra:
//   1. `JSON.stringify` desnudo lanza con BigInt (controlTotals.cents) y el
//      evento muere DENTRO del stream — el replacer serializa bigint→string.
//   2. Si el cliente desconecta a mitad de fase, `controller.enqueue` lanza
//      sobre un controller cancelado y el `controller.close()` del `finally`
//      vuelve a lanzar → unhandled rejection dentro de `start()`. El flag
//      `closed` + try/catch absorben ambos casos.
// ---------------------------------------------------------------------------

export interface SafeSse {
  send: (event: string, data: unknown) => void;
  close: () => void;
}

export function createSafeSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
): SafeSse {
  const encoder = new TextEncoder();
  let closed = false;
  return {
    send(event: string, data: unknown) {
      if (closed) return;
      try {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data, bigintReplacer)}\n\n`),
        );
      } catch {
        // Cliente desconectado (controller cancelado) — dejar de emitir.
        closed = true;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        controller.close();
      } catch {
        // Ya cerrado/cancelado por el consumidor.
      }
    },
  };
}
