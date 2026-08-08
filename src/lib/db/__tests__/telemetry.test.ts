// telemetry.test.ts — Regresión del helper de persistencia.
//
// Antes: `persistAgentTelemetry` exigía un `workspaceId` que ningún caller le
// pasaba (de hecho no tenía callers) y devolvía `void`, así que era imposible
// saber si escribió. Ahora resuelve el tenant desde el contexto del pipeline y
// NUNCA lanza: la telemetría no puede tumbar un reporte financiero.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const valuesMock = vi.hoisted(() =>
  vi.fn(async (_row: Record<string, unknown>) => undefined),
);

vi.mock('../client', () => ({
  getDb: () => ({ insert: () => ({ values: valuesMock }) }),
}));

import {
  persistAgentTelemetry,
  runWithTelemetryContext,
  __resetTelemetryLogDedupeForTests,
} from '../telemetry';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';

const baseRow = {
  agentName: 'niif-analyst-pass1',
  modelId: 'gpt-5.6-sol',
  inputTokens: 1_000_000,
  outputTokens: 0,
  elapsedMs: 1234,
  finishReason: 'stop',
  fallbackUsed: false,
};

beforeEach(() => {
  valuesMock.mockClear();
  valuesMock.mockImplementation(async () => undefined);
  __resetTelemetryLogDedupeForTests();
  process.env.DATABASE_URL = 'postgres://fake/fake';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  vi.restoreAllMocks();
});

describe('persistAgentTelemetry', () => {
  it('toma el workspaceId del contexto que abre el route handler', async () => {
    const ok = await runWithTelemetryContext({ workspaceId: WORKSPACE }, () =>
      persistAgentTelemetry(baseRow),
    );

    expect(ok).toBe(true);
    expect(valuesMock).toHaveBeenCalledTimes(1);
    const row = valuesMock.mock.calls[0]![0];
    expect(row.workspaceId).toBe(WORKSPACE);
    expect(row.agentName).toBe('niif-analyst-pass1');
    // 1M tokens de input de gpt-5.6-sol = $5 = 5_000_000 micros. Antes de
    // agregar el modelo a la tabla de pricing esto era 0.
    expect(row.costUsdMicros).toBe(5_000_000);
  });

  it('el workspaceId explícito gana sobre el contexto', async () => {
    const otro = '22222222-2222-4222-8222-222222222222';
    await runWithTelemetryContext({ workspaceId: WORKSPACE }, () =>
      persistAgentTelemetry({ ...baseRow, workspaceId: otro }),
    );
    const row = valuesMock.mock.calls[0]![0];
    expect(row.workspaceId).toBe(otro);
  });

  it('sin workspace no inserta (la columna es NOT NULL) y no lanza', async () => {
    const ok = await persistAgentTelemetry(baseRow);
    expect(ok).toBe(false);
    expect(valuesMock).not.toHaveBeenCalled();
  });

  it('un modelo sin tarifa se guarda con costo NULL, no con 0', async () => {
    await runWithTelemetryContext({ workspaceId: WORKSPACE }, () =>
      persistAgentTelemetry({ ...baseRow, modelId: 'modelo-desconocido' }),
    );
    const row = valuesMock.mock.calls[0]![0];
    expect(row.costUsdMicros).toBeNull();
  });

  it('si la DB falla devuelve false y NO propaga (el pipeline sigue)', async () => {
    valuesMock.mockImplementationOnce(async () => {
      throw new Error('connection terminated');
    });
    const ok = await runWithTelemetryContext({ workspaceId: WORKSPACE }, () =>
      persistAgentTelemetry(baseRow),
    );
    expect(ok).toBe(false);
  });

  it('el contexto sobrevive a los await del pipeline (AsyncLocalStorage)', async () => {
    await runWithTelemetryContext({ workspaceId: WORKSPACE, reportId: null }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return persistAgentTelemetry(baseRow);
    });
    const row = valuesMock.mock.calls[0]![0];
    expect(row.workspaceId).toBe(WORKSPACE);
  });
});
