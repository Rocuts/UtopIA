/**
 * Integration tests for POST /api/financial-report/niif (Wave 3.F1)
 *
 * Mocks:
 *   - @/lib/agents/financial/orchestrator — runNiifPhase (Stage 1 + Stage 0)
 *   - @/lib/preprocessing/trial-balance  — parseTrialBalanceCSV + preprocessTrialBalance
 *
 * No OpenAI key required. No network calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before dynamic import of route
// ---------------------------------------------------------------------------

// Minimal NiifAnalysisResult fixture
const MOCK_NIIF_RESULT = {
  balanceSheet: '## Balance\nActivo: $1.000.000',
  incomeStatement: '## P&L\nIngresos Clase 4: $500.000',
  cashFlowStatement: '## EFE\nFlujo operativo: $150.000',
  equityChangesStatement: '## ECP\nSaldo final: $600.000',
  technicalNotes: 'Notas técnicas. Art. 647 E.T. diferencia de criterio aplicable.',
  fullContent: '## Reporte NIIF\nActivo = Pasivo + Patrimonio.',
};

const MOCK_CONTEXT = {
  bindingTotalsBlock: '## TOTALES VINCULANTES\nActivo: $1.000.000\nPasivo: $400.000\nPatrimonio: $600.000',
  ppForAgents: undefined,
  effectiveCompany: {
    name: 'Empresa Test SAS',
    nit: '900123456-1',
    fiscalPeriod: '2025',
    fiscalAuditor: null,
    accountant: null,
  },
  effectiveRawData: 'csv data',
  preprocessed: undefined,
  eliteForNiif: {
    comparativosImpracticables: undefined,
    actividadInferida: undefined,
    reclasificacionesNoCompensacion: undefined,
    saldoAFavorImpuestoCents: undefined,
  },
  eliteForStrategy: { comparativosImpracticables: undefined, actividadInferida: undefined },
  eliteForGovernance: { comparativosImpracticables: undefined, actividadInferida: undefined },
  adjustmentsApplicationDetail: null,
  appliedAdjustments: [],
};

const mockRunNiifPhase = vi.fn().mockResolvedValue({
  niif: MOCK_NIIF_RESULT,
  context: MOCK_CONTEXT,
});

vi.mock('@/lib/agents/financial/orchestrator', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/agents/financial/orchestrator')>();
  return {
    ...original,
    runNiifPhase: (...args: unknown[]) => mockRunNiifPhase(...args),
    BalanceValidationError: original.BalanceValidationError,
  };
});

// Mock preprocessing so CSV parsing never fails in tests
vi.mock('@/lib/preprocessing/trial-balance', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/preprocessing/trial-balance')>();
  return {
    ...original,
    parseTrialBalanceCSV: vi.fn().mockReturnValue([]),
    preprocessTrialBalance: vi.fn().mockReturnValue(undefined),
  };
});

// Mock repair types (no side effects needed)
vi.mock('@/lib/agents/repair/types', () => ({}));

// Mock gateway-errors to return a deterministic friendly error
vi.mock('@/lib/agents/utils/gateway-errors', () => ({
  toFriendlyError: vi.fn().mockReturnValue({
    message: 'Error de prueba en el pipeline NIIF.',
    code: 'pipeline_validation_failed',
  }),
}));

// ---------------------------------------------------------------------------
// Import handler AFTER mocks
// ---------------------------------------------------------------------------

const { POST } = await import('../niif/route.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_COMPANY = {
  name: 'Empresa Test SAS',
  nit: '900123456-1',
  fiscalPeriod: '2025',
};

function makeStreamingRequest(body: unknown): Request {
  return new Request('http://localhost/api/financial-report/niif', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-stream': 'true',
    },
    body: JSON.stringify(body),
  });
}

function makeNonStreamingRequest(body: unknown): Request {
  return new Request('http://localhost/api/financial-report/niif', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function collectSSE(res: Response): Promise<string[]> {
  const text = await res.text();
  return text.split('\n\n').filter(Boolean);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/financial-report/niif', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunNiifPhase.mockResolvedValue({
      niif: MOCK_NIIF_RESULT,
      context: MOCK_CONTEXT,
    });
  });

  // ── 1. Happy path — streaming ────────────────────────────────────────────

  it('happy path: returns 200 SSE stream with niif_phase and done events', async () => {
    const req = makeStreamingRequest({
      rawData: 'cuenta,debito,credito\n1105,1000000,0',
      company: VALID_COMPANY,
      language: 'es',
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const text = await res.text();
    expect(text).toContain('event: niif_phase');
    expect(text).toContain('event: done');

    // niif_phase payload must carry niif + context
    const niifChunk = text.split('\n\n').find((c) => c.includes('event: niif_phase'));
    expect(niifChunk).toBeDefined();
    const dataLine = niifChunk!.split('\n').find((l) => l.startsWith('data:'));
    expect(dataLine).toBeDefined();
    const payload = JSON.parse(dataLine!.replace(/^data:/, '').trim()) as {
      niif: { fullContent: string };
      context: { bindingTotals: string; company: { name: string } };
    };
    expect(payload.niif.fullContent).toContain('Activo = Pasivo + Patrimonio');
    expect(payload.context.bindingTotals).toContain('TOTALES VINCULANTES');
    expect(payload.context.company.name).toBe('Empresa Test SAS');
  });

  // ── 2. Body inválido — falta rawData ────────────────────────────────────

  it('returns 400 when rawData is missing', async () => {
    const req = makeStreamingRequest({
      // rawData deliberadamente omitido
      company: VALID_COMPANY,
      language: 'es',
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json() as { error: string; details: string[] };
    expect(body.error).toMatch(/invalid request format/i);
    expect(body.details.some((d) => d.includes('rawData'))).toBe(true);
  });

  it('returns 400 when company is missing', async () => {
    const req = makeStreamingRequest({
      rawData: 'csv data',
      language: 'es',
      // company omitido
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; details: string[] };
    expect(body.error).toMatch(/invalid request format/i);
  });

  // ── 3. runNiifPhase lanza — SSE emite error sin crash ───────────────────

  it('emits SSE error event when runNiifPhase throws a generic error', async () => {
    mockRunNiifPhase.mockRejectedValueOnce(new Error('OpenAI rate limit'));

    const req = makeStreamingRequest({
      rawData: 'csv data',
      company: VALID_COMPANY,
      language: 'es',
    });

    const res = await POST(req);

    // Status 200 — stream abrió; el error viene dentro del stream
    expect(res.status).toBe(200);

    const text = await res.text();
    expect(text).toContain('event: error');
    // No debe contener done (el pipeline abortó)
    expect(text).not.toContain('event: done');

    const errorChunk = text.split('\n\n').find((c) => c.includes('event: error'));
    expect(errorChunk).toBeDefined();
    const dataLine = errorChunk!.split('\n').find((l) => l.startsWith('data:'));
    const errorPayload = JSON.parse(dataLine!.replace(/^data:/, '').trim()) as {
      error: string;
      detail: string;
    };
    expect(errorPayload.error).toBeTruthy();
    expect(errorPayload.detail).toBeTruthy();
  });

  it('emits SSE error event with BALANCE_VALIDATION_FAILED code when BalanceValidationError thrown', async () => {
    const { BalanceValidationError } = await import('@/lib/agents/financial/orchestrator');
    mockRunNiifPhase.mockRejectedValueOnce(
      new BalanceValidationError(
        ['Activo no cuadra con Pasivo + Patrimonio'],
        ['1105 Caja', '1110 Bancos'],
      ),
    );

    const req = makeStreamingRequest({
      rawData: 'csv data',
      company: VALID_COMPANY,
      language: 'es',
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const text = await res.text();
    expect(text).toContain('event: error');

    const errorChunk = text.split('\n\n').find((c) => c.includes('event: error'));
    const dataLine = errorChunk!.split('\n').find((l) => l.startsWith('data:'));
    const errorPayload = JSON.parse(dataLine!.replace(/^data:/, '').trim()) as {
      code: string;
      reasons: string[];
    };
    expect(errorPayload.code).toBe('BALANCE_VALIDATION_FAILED');
    expect(errorPayload.reasons).toContain('Activo no cuadra con Pasivo + Patrimonio');
  });

  // ── 4. Progress events propagados al stream ──────────────────────────────

  it('propagates onProgress events to the SSE stream', async () => {
    mockRunNiifPhase.mockImplementationOnce(
      async (
        _req: unknown,
        opts: { onProgress?: (e: { type: string; stage?: number; detail?: string }) => void },
      ) => {
        opts.onProgress?.({ type: 'stage_start', stage: 1, detail: 'Iniciando NIIF' });
        opts.onProgress?.({ type: 'stage_progress', stage: 1, detail: 'Procesando Clase 1' });
        opts.onProgress?.({ type: 'stage_complete', stage: 1, detail: 'NIIF completo' });
        return { niif: MOCK_NIIF_RESULT, context: MOCK_CONTEXT };
      },
    );

    const req = makeStreamingRequest({
      rawData: 'csv data',
      company: VALID_COMPANY,
      language: 'es',
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const chunks = await collectSSE(res);
    const progressChunks = chunks.filter((c) => c.includes('event: progress'));
    // 3 onProgress calls → 3 progress events
    expect(progressChunks.length).toBe(3);
  });

  // ── 5. Non-streaming happy path ──────────────────────────────────────────

  it('non-streaming mode returns JSON with niif and context', async () => {
    const req = makeNonStreamingRequest({
      rawData: 'csv data',
      company: VALID_COMPANY,
      language: 'es',
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json() as {
      niif: { fullContent: string };
      context: { bindingTotals: string };
    };
    expect(body.niif.fullContent).toContain('Activo = Pasivo + Patrimonio');
    expect(body.context.bindingTotals).toContain('TOTALES VINCULANTES');
  });
});
