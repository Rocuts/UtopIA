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

/** Filas que devuelve el `select` sobre `reports` (validación de propiedad). */
const selectResult = vi.hoisted(() => ({ rows: [] as { id: string }[] }));

vi.mock('../client', () => ({
  getDb: () => ({
    insert: () => ({ values: valuesMock }),
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => selectResult.rows }) }),
    }),
  }),
}));

import {
  persistAgentTelemetry,
  runWithTelemetryContext,
  getOrphanTelemetryRows,
  resolveOwnedReportId,
  asTelemetryUuid,
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
  selectResult.rows = [];
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

  // ── Degradación: la medición sin tenant NO se descarta ───────────────────
  //
  // Antes la fila se tiraba a la basura con un log deduplicado: a partir de la
  // segunda ocurrencia del mismo agente no quedaba ni rastro. Perder la
  // medición es peor que medirla sin tenant.

  it('sin workspace registra la medición como huérfana en vez de descartarla', async () => {
    await persistAgentTelemetry(baseRow);

    const huerfanas = getOrphanTelemetryRows();
    expect(huerfanas).toHaveLength(1);
    expect(huerfanas[0]!.reason).toBe('sin-workspace');
    expect(huerfanas[0]!.row.agentName).toBe('niif-analyst-pass1');
    expect(huerfanas[0]!.row.elapsedMs).toBe(1234);
  });

  it('cada medición huérfana deja su propia línea de log (el dedupe no las come)', async () => {
    const warn = vi.spyOn(console, 'warn');
    await persistAgentTelemetry(baseRow);
    await persistAgentTelemetry(baseRow);
    await persistAgentTelemetry(baseRow);

    // 3 mediciones perdidas => 3 registros y 3 líneas `orphan`; el consejo de
    // remediación para humanos sí se emite una sola vez por agente.
    expect(getOrphanTelemetryRows()).toHaveLength(3);
    const orphanLogs = warn.mock.calls.filter((c) =>
      String(c[0]).startsWith('[agent-telemetry:orphan]'),
    );
    expect(orphanLogs).toHaveLength(3);
    // La línea es JSON reconstruible desde el drain de logs.
    const payload = JSON.parse(String(orphanLogs[0]![0]).replace('[agent-telemetry:orphan] ', ''));
    expect(payload.agentName).toBe('niif-analyst-pass1');
    expect(payload.reason).toBe('sin-workspace');
  });

  it('un workspaceId que no es uuid no llega al INSERT: se marca huérfana', async () => {
    // Sin este filtro Postgres abortaría con `invalid input syntax for type
    // uuid` y la medición se perdería con un error opaco.
    const ok = await persistAgentTelemetry({ ...baseRow, workspaceId: 'no-es-un-uuid' });

    expect(ok).toBe(false);
    expect(valuesMock).not.toHaveBeenCalled();
    expect(getOrphanTelemetryRows()[0]!.reason).toBe('workspace-no-uuid');
  });

  // ── reportId: la telemetría deja de ser huérfana del reporte ─────────────

  it('el reportId del contexto viaja a la fila', async () => {
    const reportId = '55555555-5555-4555-8555-555555555555';
    await runWithTelemetryContext({ workspaceId: WORKSPACE, reportId }, () =>
      persistAgentTelemetry(baseRow),
    );
    expect(valuesMock.mock.calls[0]![0].reportId).toBe(reportId);
  });

  it('resolveOwnedReportId solo acepta un reporte del mismo workspace', async () => {
    const reportId = '55555555-5555-4555-8555-555555555555';

    // No pertenece (o no existe): devolver el id haría que el INSERT muriera
    // por violación de FK y se perdieran TODAS las mediciones de la corrida.
    selectResult.rows = [];
    expect(await resolveOwnedReportId(reportId, WORKSPACE)).toBeNull();

    selectResult.rows = [{ id: reportId }];
    expect(await resolveOwnedReportId(reportId, WORKSPACE)).toBe(reportId);

    // Basura del cliente: ni siquiera se consulta la DB.
    expect(await resolveOwnedReportId('DROP TABLE reports', WORKSPACE)).toBeNull();
    expect(await resolveOwnedReportId(reportId, null)).toBeNull();
  });

  it('asTelemetryUuid filtra cualquier cosa que no sea un uuid', () => {
    expect(asTelemetryUuid(WORKSPACE)).toBe(WORKSPACE);
    expect(asTelemetryUuid('')).toBeNull();
    expect(asTelemetryUuid(undefined)).toBeNull();
    expect(asTelemetryUuid('11111111-1111-4111-8111')).toBeNull();
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
