// runtime-telemetry-context.test.ts — el contexto de tenant sobrevive el
// camino REAL: `runWithTelemetryContext` -> ReadableStream.start ->
// `callFinancialAgent` -> `await import('@/lib/db/telemetry')` -> INSERT.
//
// POR QUE UN ARCHIVO APARTE
// `runtime-telemetry.test.ts` mockea `@/lib/db/telemetry` entero, y
// `src/app/api/financial-report/__tests__/telemetry-context.route.test.ts`
// mockea el orchestrator. Entre ambos quedaba SIN cubrir justo el tramo donde
// vivia el bug: el salto de `callFinancialAgent` a la persistencia, que ocurre
// en una IIFE async, tras un `await import()` dinamico y bajo `waitUntil`.
// "El AsyncLocalStorage deberia atravesar eso" es exactamente la suposicion que
// nos costo una tabla `agent_telemetry` vacia; aqui se comprueba ejecutandolo.
//
// Aqui NO se mockea `@/lib/db/telemetry`: corre el modulo real contra un `getDb`
// falso, con la cookie inutilizable (como dentro del stream SSE en produccion).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';
import type { LanguageModel } from 'ai';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';

const generateTextMock = vi.hoisted(() => vi.fn());
const inserted = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateText: generateTextMock };
});

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        inserted.push(row);
      },
    }),
  }),
}));

// Espeja produccion dentro del callback del stream: ya no hay scope de request.
vi.mock('@/lib/db/workspace', () => ({
  getCurrentWorkspaceId: async () => {
    throw new Error('`cookies` was called outside a request scope.');
  },
}));

import { callFinancialAgent } from '../runtime';
import {
  runWithTelemetryContext,
  getOrphanTelemetryRows,
  __resetTelemetryLogDedupeForTests,
} from '@/lib/db/telemetry';

const schema = z.object({ ok: z.string() });
const model = { modelId: 'gpt-5.6-sol' } as unknown as LanguageModel;

const baseOpts = {
  agentName: 'niif-analyst-pass1',
  model,
  schema,
  system: 'sys',
  userContent: 'user',
  maxOutputTokens: 1000,
};

/**
 * Reproduce la forma real del endpoint: el contexto envuelve la CONSTRUCCION de
 * la ReadableStream, y el agente corre dentro de `start`. Devuelve cuando el
 * stream se drena.
 */
async function correrDentroDelStreamSse(ctxWorkspaceId: string | null): Promise<void> {
  const stream = runWithTelemetryContext(
    { workspaceId: ctxWorkspaceId },
    () =>
      new ReadableStream({
        async start(controller) {
          await callFinancialAgent({ ...baseOpts, reasoningEffort: 'medium' });
          controller.close();
        },
      }),
  );
  await new Response(stream).text();
  // La persistencia es fire-and-forget: cedemos el turno del event loop.
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  generateTextMock.mockReset();
  generateTextMock.mockResolvedValue({
    finishReason: 'stop',
    text: '{"ok":"si"}',
    experimental_output: { ok: 'si' },
    usage: { inputTokens: 1000, outputTokens: 500, reasoningTokens: 400, cachedInputTokens: 200 },
  });
  inserted.length = 0;
  __resetTelemetryLogDedupeForTests();
  process.env.DATABASE_URL = 'postgres://fake/fake';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  vi.restoreAllMocks();
});

describe('contexto de telemetria a traves del runtime real', () => {
  it('el workspaceId del contexto llega al INSERT aunque la cookie ya no sea legible', async () => {
    await correrDentroDelStreamSse(WORKSPACE);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.workspaceId).toBe(WORKSPACE);
    expect(inserted[0]!.agentName).toBe('niif-analyst-pass1');
    expect(inserted[0]!.inputTokens).toBe(1000);
    expect(getOrphanTelemetryRows()).toHaveLength(0);
  });

  it('un workspaceId no-uuid en el contexto no llega al INSERT: queda huerfano', async () => {
    // Modo de fallo real: `getCurrentWorkspaceId()` devuelve la cookie
    // `utopia_workspace_id` TAL CUAL en el camino anonimo, asi que un valor
    // corrupto o forjado podia terminar en el contexto. Sin el filtro de
    // formato, Postgres aborta con `invalid input syntax for type uuid` y la
    // medicion se pierde con un error opaco en vez de quedar registrada.
    await correrDentroDelStreamSse('no-es-un-uuid');

    expect(inserted).toHaveLength(0);
    const huerfanas = getOrphanTelemetryRows();
    expect(huerfanas).toHaveLength(1);
    expect(huerfanas[0]!.reason).toBe('workspace-no-uuid');
    expect(huerfanas[0]!.row.agentName).toBe('niif-analyst-pass1');
  });
});
