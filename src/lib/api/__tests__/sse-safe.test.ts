// ---------------------------------------------------------------------------
// Regresión producción — emisor SSE seguro (createSafeSse).
//
// Cierra dos fallos: (1) JSON.stringify lanzaba con BigInt (controlTotals.cents)
// matando el evento dentro del stream; (2) si el cliente desconectaba,
// enqueue/close lanzaban sobre el controller cancelado → unhandled rejection.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

import { createSafeSse } from '../sse-safe';

function fakeController() {
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  return {
    chunks,
    enqueue: vi.fn((u8: Uint8Array) => chunks.push(decoder.decode(u8))),
    close: vi.fn(),
  };
}

describe('createSafeSse', () => {
  it('serializa BigInt como string en vez de lanzar', () => {
    const ctrl = fakeController();
    const sse = createSafeSse(ctrl as unknown as ReadableStreamDefaultController<Uint8Array>);
    expect(() => sse.send('niif_phase', { cents: { activo: BigInt('150000000000') } })).not.toThrow();
    expect(ctrl.chunks.join('')).toContain('"activo":"150000000000"');
    expect(ctrl.chunks.join('')).toContain('event: niif_phase');
  });

  it('deja de emitir tras una desconexión (enqueue lanza)', () => {
    const ctrl = fakeController();
    ctrl.enqueue.mockImplementationOnce(() => { throw new Error('controller cancelled'); });
    const sse = createSafeSse(ctrl as unknown as ReadableStreamDefaultController<Uint8Array>);
    expect(() => sse.send('progress', { x: 1 })).not.toThrow(); // primer enqueue lanza, se absorbe
    sse.send('progress', { x: 2 }); // ya está closed → no intenta enqueue
    expect(ctrl.enqueue).toHaveBeenCalledTimes(1);
  });

  it('close() es idempotente y no lanza sobre un controller ya cerrado', () => {
    const ctrl = fakeController();
    ctrl.close.mockImplementationOnce(() => { throw new Error('already closed'); });
    const sse = createSafeSse(ctrl as unknown as ReadableStreamDefaultController<Uint8Array>);
    expect(() => { sse.close(); sse.close(); }).not.toThrow();
    expect(ctrl.close).toHaveBeenCalledTimes(1);
  });

  it('no emite nada después de close()', () => {
    const ctrl = fakeController();
    const sse = createSafeSse(ctrl as unknown as ReadableStreamDefaultController<Uint8Array>);
    sse.close();
    sse.send('progress', { x: 1 });
    expect(ctrl.enqueue).not.toHaveBeenCalled();
  });
});
