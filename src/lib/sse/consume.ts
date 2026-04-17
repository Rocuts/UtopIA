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
 * Abre una conexion SSE con retry ante errores de red transitorios
 * (`TypeError: Failed to fetch`, p.ej. `ERR_NETWORK_CHANGED`). Solo reintenta
 * la apertura del stream — una vez que `fetch` resuelve, la responsabilidad
 * de propagar cortes mid-stream es de `consumeSSE`. HTTP no-ok NO se reintenta
 * (los 4xx/5xx son deterministas). Respeta `AbortSignal` durante el backoff.
 *
 * Devuelve el `Response` con el body abierto listo para pasar a `consumeSSE`.
 */
export async function fetchSSEWithRetry(
  url: string,
  init: RequestInit,
  opts: { retries?: number; backoffMs?: number[] } = {},
): Promise<Response> {
  const retries = opts.retries ?? 2;
  const backoff = opts.backoffMs ?? [1000, 3000];
  const signal = init.signal ?? undefined;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await fetch(url, init);
    } catch (err) {
      const e = err as Error;
      if (e.name === 'AbortError') throw err;
      const isNetwork = err instanceof TypeError;
      if (!isNetwork || attempt === retries) throw err;
      lastErr = err;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, backoff[attempt] ?? 3000);
        const onAbort = () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
  }
  throw lastErr;
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
            let parsed: unknown;
            let parsedOk = false;
            try {
              parsed = JSON.parse(currentData);
              parsedOk = true;
            } catch {
              // Data malformada — descartar sin romper el stream.
            }
            // Why: handler throws (p.ej. el `error` handler de PipelineWorkspace
            // re-lanza el detalle real del backend) DEBEN propagar. Antes el
            // try/catch tragaba el throw y el stream terminaba silencioso,
            // produciendo "endpoint no devolvió un resultado" en vez del error
            // verdadero.
            if (parsedOk) {
              const handler = handlers[currentEvent];
              handler?.(parsed);
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
