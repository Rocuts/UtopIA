/**
 * Integration tests for POST /api/financial-report/strategy (Wave 3.F1)
 *
 * Mocks:
 *   - @/lib/agents/financial/orchestrator — runStrategyPhase
 *
 * No OpenAI key required. No network calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before dynamic import of route
// ---------------------------------------------------------------------------

const MOCK_STRATEGY_RESULT = {
  kpiDashboard: '## KPIs\nRazón Corriente: 2.5\nMargen Neto: 18%\nROA: 12%\nEndeudamiento: 40%',
  breakEvenAnalysis: '## Punto de Equilibrio\nVentas mínimas: $200.000.000',
  projectedCashFlow: '## Flujo Proyectado\n+$50.000.000 trimestral',
  strategicRecommendations: '## Recomendaciones\n1. Reducir endeudamiento\n2. Diversificar ingresos Clase 4',
  fullContent: '## Análisis Estratégico\nLos ingresos provienen exclusivamente de Clase 4.',
};

const mockRunStrategyPhase = vi.fn().mockResolvedValue(MOCK_STRATEGY_RESULT);

vi.mock('@/lib/agents/financial/orchestrator', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/agents/financial/orchestrator')>();
  return {
    ...original,
    runStrategyPhase: (...args: unknown[]) => mockRunStrategyPhase(...args),
  };
});

// Mock gateway-errors
vi.mock('@/lib/agents/utils/gateway-errors', () => ({
  toFriendlyError: vi.fn().mockReturnValue({
    message: 'Error de prueba en el pipeline de Estrategia.',
    code: 'pipeline_validation_failed',
  }),
}));

// ---------------------------------------------------------------------------
// Import handler AFTER mocks
// ---------------------------------------------------------------------------

const { POST } = await import('../strategy/route.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_COMPANY = {
  name: 'Empresa Test SAS',
  nit: '900123456-1',
  fiscalPeriod: '2025',
};

// Minimal NiifAnalysisResult — strategyPhaseRequestSchema solo requiere fullContent
const VALID_NIIF_RESULT = {
  fullContent: '## Reporte NIIF\nActivo = Pasivo + Patrimonio. Clase 4 ingresos: $500.000.',
  balanceSheet: '## Balance',
  incomeStatement: '## P&L',
  cashFlowStatement: '## EFE',
  equityChangesStatement: '## ECP',
  technicalNotes: 'Notas. Art. 647 E.T.',
};

const VALID_BINDING_TOTALS =
  '## TOTALES VINCULANTES\nActivo: $1.000.000\nPasivo: $400.000\nPatrimonio: $600.000';

function makeStreamingRequest(body: unknown): Request {
  return new Request('http://localhost/api/financial-report/strategy', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-stream': 'true',
    },
    body: JSON.stringify(body),
  });
}

function makeNonStreamingRequest(body: unknown): Request {
  return new Request('http://localhost/api/financial-report/strategy', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(): Record<string, unknown> {
  return {
    niifResult: VALID_NIIF_RESULT,
    bindingTotals: VALID_BINDING_TOTALS,
    company: VALID_COMPANY,
    language: 'es',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/financial-report/strategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunStrategyPhase.mockResolvedValue(MOCK_STRATEGY_RESULT);
  });

  // ── 1. Happy path — streaming ────────────────────────────────────────────

  it('happy path: returns 200 SSE stream with strategy_phase and done events', async () => {
    const req = makeStreamingRequest(validBody());

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const text = await res.text();
    expect(text).toContain('event: strategy_phase');
    expect(text).toContain('event: done');

    // strategy_phase payload must contain the StrategicAnalysisResult
    const strategyChunk = text.split('\n\n').find((c) => c.includes('event: strategy_phase'));
    expect(strategyChunk).toBeDefined();
    const dataLine = strategyChunk!.split('\n').find((l) => l.startsWith('data:'));
    expect(dataLine).toBeDefined();
    const payload = JSON.parse(dataLine!.replace(/^data:/, '').trim()) as {
      strategy: { fullContent: string; kpiDashboard: string };
    };
    expect(payload.strategy.fullContent).toContain('Clase 4');
    expect(payload.strategy.kpiDashboard).toContain('Razón Corriente');
  });

  it('done event carries stage=strategy', async () => {
    const req = makeStreamingRequest(validBody());
    const res = await POST(req);
    const text = await res.text();

    const doneChunk = text.split('\n\n').find((c) => c.includes('event: done'));
    expect(doneChunk).toBeDefined();
    const dataLine = doneChunk!.split('\n').find((l) => l.startsWith('data:'));
    const donePayload = JSON.parse(dataLine!.replace(/^data:/, '').trim()) as {
      stage: string;
    };
    expect(donePayload.stage).toBe('strategy');
  });

  // ── 2. Body inválido — falta niifResult ─────────────────────────────────

  it('returns 400 when niifResult is missing', async () => {
    const body = { ...validBody() };
    delete body['niifResult'];

    const req = makeStreamingRequest(body);
    const res = await POST(req);

    expect(res.status).toBe(400);
    const resBody = await res.json() as { error: string; details: string[] };
    expect(resBody.error).toMatch(/invalid request format/i);
    expect(resBody.details.some((d) => d.includes('niifResult'))).toBe(true);
  });

  it('returns 400 when niifResult.fullContent is empty string', async () => {
    const req = makeStreamingRequest({
      ...validBody(),
      niifResult: { fullContent: '' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when bindingTotals is missing', async () => {
    const body = { ...validBody() };
    delete body['bindingTotals'];

    const req = makeStreamingRequest(body);
    const res = await POST(req);

    expect(res.status).toBe(400);
    const resBody = await res.json() as { error: string };
    expect(resBody.error).toMatch(/invalid request format/i);
  });

  // ── 3. runStrategyPhase lanza — SSE emite error sin crash ───────────────

  it('emits SSE error event when runStrategyPhase throws', async () => {
    mockRunStrategyPhase.mockRejectedValueOnce(new Error('OpenAI quota exhausted'));

    const req = makeStreamingRequest(validBody());
    const res = await POST(req);

    expect(res.status).toBe(200); // stream abrió
    const text = await res.text();

    expect(text).toContain('event: error');
    expect(text).not.toContain('event: done');

    const errorChunk = text.split('\n\n').find((c) => c.includes('event: error'));
    const dataLine = errorChunk!.split('\n').find((l) => l.startsWith('data:'));
    const errorPayload = JSON.parse(dataLine!.replace(/^data:/, '').trim()) as {
      error: string;
      detail: string;
    };
    expect(errorPayload.error).toMatch(/estrategia/i);
    expect(errorPayload.detail).toBeTruthy();
  });

  // ── 4. Progress events propagados ───────────────────────────────────────

  it('propagates onProgress stage_start and stage_complete to SSE stream', async () => {
    mockRunStrategyPhase.mockImplementationOnce(
      async (
        _input: unknown,
        opts: { onProgress?: (e: { type: string; stage?: number }) => void },
      ) => {
        opts?.onProgress?.({ type: 'stage_start', stage: 2 });
        opts?.onProgress?.({ type: 'stage_progress', stage: 2 });
        opts?.onProgress?.({ type: 'stage_complete', stage: 2 });
        return MOCK_STRATEGY_RESULT;
      },
    );

    const req = makeStreamingRequest(validBody());
    const res = await POST(req);
    const text = await res.text();

    const progressEvents = text.split('\n\n').filter((c) => c.includes('event: progress'));
    expect(progressEvents.length).toBe(3);
  });

  // ── 5. Non-streaming happy path ──────────────────────────────────────────

  it('non-streaming mode returns JSON with strategy field', async () => {
    const req = makeNonStreamingRequest(validBody());
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json() as { strategy: { fullContent: string } };
    expect(body.strategy.fullContent).toContain('Clase 4');
  });
});
