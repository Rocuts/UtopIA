// ---------------------------------------------------------------------------
// Consumer SSE compartido — parser nativo de `text/event-stream`.
// ---------------------------------------------------------------------------
// Extraido de `PipelineWorkspace.tsx` para reusar en `ReportFollowUpChat.tsx`
// y otros componentes del workspace que consumen streams SSE con eventos
// nombrados (progress / content / result / error / done).
//
// Formato SSE esperado:
//   event: <nombre>\n
//   data: <json>\n
//   \n
//
// Handlers no registrados se ignoran silenciosamente. Si `data` no es JSON
// valido, el evento se descarta sin romper el parser. Propaga errores de red
// distintos a AbortError.
// ---------------------------------------------------------------------------

export type SSEHandler = (payload: unknown) => void;

export interface SSEHandlers {
  progress?: SSEHandler;
  content?: SSEHandler;
  result?: SSEHandler;
  error?: SSEHandler;
  done?: SSEHandler;
  /** Cualquier otro evento nombrado no contemplado arriba. */
  [event: string]: SSEHandler | undefined;
}

/**
 * Consume una respuesta SSE hasta que el servidor cierre el stream o
 * `signal` aborte. Al abortar cancela el reader y retorna sin lanzar.
 */
export async function consumeSSE(
  response: Response,
  signal: AbortSignal,
  handlers: SSEHandlers,
): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = 'message';
  let currentData = '';

  try {
    while (true) {
      if (signal.aborted) {
        reader.cancel();
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, '');
        buffer = buffer.slice(newlineIdx + 1);

        if (line === '') {
          // Linea vacia = fin del evento. Emitir si hay data.
          if (currentData) {
            try {
              const parsed = JSON.parse(currentData);
              const handler = handlers[currentEvent];
              handler?.(parsed);
            } catch {
              // Data malformada — descartar sin romper el stream.
            }
          }
          currentEvent = 'message';
          currentData = '';
        } else if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          currentData = line.slice(5).trim();
        }
      }
    }
  } catch (err) {
    if ((err as Error)?.name !== 'AbortError') throw err;
  }
}
