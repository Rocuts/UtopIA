// ---------------------------------------------------------------------------
// Regresion — ChatSidebar perdia eventos SSE partidos entre chunks TCP
// ---------------------------------------------------------------------------
//
// Hallazgo: chatsidebar-pierde-eventos-sse. El parser inline del sidebar
// declaraba `let currentEvent = ''` DENTRO del bucle `reader.read()`: cuando la
// linea `event: content` caia al final de un chunk y su `data:` llegaba en el
// siguiente, el delta se procesaba con currentEvent === '' y se descartaba en
// silencio (al usuario le faltaban cifras o filas de tabla en medio de la
// respuesta). Si lo perdido era el `result`, se caia al fallback de texto
// streameado o directamente a "No pude completar la consulta" para un request
// que si habia respondido.
//
// El fix elimina el parser duplicado y usa `consumeSSE`, que mantiene el estado
// entre chunks. Aqui se verifica (a) que el parser compartido efectivamente
// sobrevive al corte, y (b) que el sidebar ya no lleva su propia copia.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { consumeSSE } from '@/lib/sse/consume';

/** Construye un Response SSE entregando exactamente los chunks indicados. */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}

describe('parser SSE compartido', () => {
  it('no pierde el delta cuando `event:` y `data:` llegan en lecturas distintas', async () => {
    // Corte exactamente entre la linea de evento y la de datos.
    const response = sseResponse([
      'event: content\n',
      'data: {"delta":"$1.234.567"}\n\n',
      'event: result\ndata: {"content":"final"}\n\n',
    ]);

    const deltas: string[] = [];
    let result: unknown = null;
    await consumeSSE(response, new AbortController().signal, {
      content: (p) => deltas.push((p as { delta: string }).delta),
      result: (p) => { result = p; },
    });

    expect(deltas).toEqual(['$1.234.567']);
    expect(result).toEqual({ content: 'final' });
  });

  it('tolera un corte a mitad del JSON de `data:`', async () => {
    const response = sseResponse([
      'event: content\ndata: {"delta":"fila ',
      'de tabla"}\n\n',
    ]);

    const deltas: string[] = [];
    await consumeSSE(response, new AbortController().signal, {
      content: (p) => deltas.push((p as { delta: string }).delta),
    });

    expect(deltas).toEqual(['fila de tabla']);
  });
});

describe('componentes de chat — sin parser SSE duplicado', () => {
  const root = join(process.cwd(), 'src', 'components', 'workspace');
  const sidebar = readFileSync(join(root, 'ChatSidebar.tsx'), 'utf8');
  const workspace = readFileSync(join(root, 'ChatWorkspace.tsx'), 'utf8');

  it('ChatSidebar usa consumeSSE y ya no reinicia currentEvent por chunk', () => {
    expect(sidebar).toContain("import { consumeSSE } from '@/lib/sse/consume'");
    expect(sidebar).not.toMatch(/let currentEvent/);
    expect(sidebar).not.toMatch(/response\.body\.getReader\(\)/);
  });

  it('ambos chats derivan el cierre del stream del mismo helper honesto', () => {
    expect(sidebar).toContain('resolveFinalAnswer');
    expect(workspace).toContain('resolveFinalAnswer');
  });

  it('ChatWorkspace deriva las etiquetas del pipeline del resolvedor de agentes', () => {
    expect(workspace).toContain('resolveAgentPresentation');
    // El ternario viejo comparaba contra claves de dominio que el servidor
    // nunca envia y caia siempre en 'Ag. Estrategia'.
    expect(workspace).not.toMatch(/a === 'tax' \? 'Ag\. Tributario'/);
  });

  it('ChatWorkspace ya no fuerza source: "Estatuto Tributario" en el panel de citas', () => {
    expect(workspace).not.toMatch(/source:\s*'Estatuto Tributario'/);
  });
});
