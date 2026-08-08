// runtime-telemetry.test.ts — Regresión del cableado de telemetría y del
// auto-fallback de `callFinancialAgent`.
//
// Dos bugs corregidos:
//  1. La telemetría estaba 100% desconectada: `persistAgentTelemetry` no tenía
//     callers y `onTelemetry` no lo pasaba ningún agente, así que
//     `agent_telemetry` quedaba vacía y las alertas de docs/TELEMETRY.md se
//     evaluaban sobre cero filas.
//  2. Un output vacío degradaba DIRECTO a `reasoningEffort='low'` — sin
//     reintentar al effort pedido y sin avisar a nadie. Un dictamen `high` se
//     entregaba con razonamiento mínimo y el cliente lo firmaba ante la DIAN.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import type { LanguageModel } from 'ai';

const generateTextMock = vi.hoisted(() => vi.fn());
const persistMock = vi.hoisted(() =>
  vi.fn(async (_row: Record<string, unknown>) => true),
);

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateText: generateTextMock };
});

vi.mock('@/lib/db/telemetry', () => ({
  persistAgentTelemetry: persistMock,
  getTelemetryContext: () => undefined,
  runWithTelemetryContext: <T>(_ctx: unknown, fn: () => T) => fn(),
}));

import { callFinancialAgent } from '../runtime';

const schema = z.object({ ok: z.string() });

/** Pase exitoso: output válido contra el schema. */
function okPass() {
  return {
    finishReason: 'stop',
    text: '{"ok":"si"}',
    experimental_output: { ok: 'si' },
    usage: { inputTokens: 1000, outputTokens: 500, reasoningTokens: 400, cachedInputTokens: 200 },
  };
}

/** Pase vacío: el reasoning agotó el budget (o el JSON no parseó). */
function emptyPass(finishReason = 'stop') {
  return {
    finishReason,
    text: '',
    experimental_output: null,
    usage: { inputTokens: 1000, outputTokens: 0, reasoningTokens: 9000 },
  };
}

/** `reasoningEffort` con el que se hizo la llamada N (0-indexed). */
function effortOfCall(n: number): string {
  return generateTextMock.mock.calls[n][0].providerOptions.openai.reasoningEffort;
}

const model = { modelId: 'gpt-5.6-sol' } as unknown as LanguageModel;

const baseOpts = {
  agentName: 'test-agent',
  model,
  schema,
  system: 'sys',
  userContent: 'user',
  maxOutputTokens: 1000,
};

beforeEach(() => {
  generateTextMock.mockReset();
  persistMock.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('persistencia de telemetría', () => {
  it('cada llamada escribe una fila SIN que el caller pase nada', async () => {
    generateTextMock.mockResolvedValue(okPass());

    await callFinancialAgent({ ...baseOpts, reasoningEffort: 'medium' });
    // La escritura es fire-and-forget: cedemos el turno del event loop.
    await new Promise((r) => setTimeout(r, 0));

    expect(persistMock).toHaveBeenCalledTimes(1);
    const row = persistMock.mock.calls[0]![0];
    expect(row.agentName).toBe('test-agent');
    // Sin el modelId el costo no se puede calcular → dashboard en $0.
    expect(row.modelId).toBe('gpt-5.6-sol');
    expect(row.inputTokens).toBe(1000);
    expect(row.outputTokens).toBe(500);
    expect(row.cachedInputTokens).toBe(200);
    expect(row.finishReason).toBe('stop');
    expect(row.fallbackUsed).toBe(false);
  });

  it('un fallo de la DB no rompe el pipeline', async () => {
    generateTextMock.mockResolvedValue(okPass());
    persistMock.mockRejectedValueOnce(new Error('DB caída'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { json } = await callFinancialAgent({ ...baseOpts });
    await new Promise((r) => setTimeout(r, 0));
    expect(json).toEqual({ ok: 'si' });
  });

  it('meta expone el modelId usado', async () => {
    generateTextMock.mockResolvedValue(okPass());
    const { meta } = await callFinancialAgent({ ...baseOpts });
    expect(meta.modelId).toBe('gpt-5.6-sol');
  });
});

describe('auto-fallback: reintentar antes de degradar', () => {
  it('un output vacío se reintenta al MISMO effort (no se degrada de una)', async () => {
    generateTextMock.mockResolvedValueOnce(emptyPass('stop')).mockResolvedValueOnce(okPass());

    const onDegraded = vi.fn();
    const { meta } = await callFinancialAgent({
      ...baseOpts,
      reasoningEffort: 'high',
      onDegraded,
    });

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(effortOfCall(0)).toBe('high');
    expect(effortOfCall(1)).toBe('high'); // antes: 'low'
    expect(meta.retriedSameEffort).toBe(true);
    expect(meta.fallbackUsed).toBe(false);
    expect(meta.degraded).toBe(false);
    expect(onDegraded).not.toHaveBeenCalled();
  });

  it('si el reintento tampoco produce output, degrada a low Y AVISA', async () => {
    generateTextMock
      .mockResolvedValueOnce(emptyPass('stop'))
      .mockResolvedValueOnce(emptyPass('stop'))
      .mockResolvedValueOnce(okPass());

    const onDegraded = vi.fn();
    const { meta } = await callFinancialAgent({
      ...baseOpts,
      reasoningEffort: 'high',
      onDegraded,
    });

    expect(generateTextMock).toHaveBeenCalledTimes(3);
    expect(effortOfCall(2)).toBe('low');
    expect(meta.fallbackUsed).toBe(true);
    expect(meta.degraded).toBe(true);
    expect(meta.firstPassFinishReason).toBe('stop');
    expect(meta.firstPassReasoningTokens).toBe(9000);

    // El aviso es la parte que faltaba: el cliente firma este reporte.
    expect(onDegraded).toHaveBeenCalledTimes(1);
    const info = onDegraded.mock.calls[0][0] as { requestedEffort: string; message: string };
    expect(info.requestedEffort).toBe('high');
    expect(info.message).toMatch(/razonamiento reducido/i);

    await new Promise((r) => setTimeout(r, 0));
    const row = persistMock.mock.calls[0]![0];
    expect(row.fallbackUsed).toBe(true);
  });

  it('finishReason=length degrada DIRECTO: repetir al mismo effort volvería a chocar', async () => {
    // Decisión de latencia/costo: un pase de 60-180s que ya agotó el budget no
    // se repite al mismo effort. Pero el aviso de degradación sí se emite.
    generateTextMock.mockResolvedValueOnce(emptyPass('length')).mockResolvedValueOnce(okPass());
    const onDegraded = vi.fn();

    const { meta } = await callFinancialAgent({
      ...baseOpts,
      reasoningEffort: 'medium',
      onDegraded,
    });

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(effortOfCall(1)).toBe('low');
    expect(meta.retriedSameEffort).toBe(false);
    expect(meta.degraded).toBe(true);
    expect(onDegraded).toHaveBeenCalledTimes(1);
  });

  it('la degradación queda registrada aunque onDegraded lance', async () => {
    generateTextMock
      .mockResolvedValueOnce(emptyPass('stop'))
      .mockResolvedValueOnce(emptyPass('stop'))
      .mockResolvedValueOnce(okPass());
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { meta } = await callFinancialAgent({
      ...baseOpts,
      reasoningEffort: 'medium',
      onDegraded: () => {
        throw new Error('la UI explotó');
      },
    });
    expect(meta.fallbackUsed).toBe(true);
  });
});
