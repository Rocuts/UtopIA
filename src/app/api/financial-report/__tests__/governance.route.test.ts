/**
 * Integration tests for POST /api/financial-report/governance (Wave 3.F1)
 *
 * Mocks:
 *   - @/lib/agents/financial/orchestrator — runGovernancePhase
 *
 * No OpenAI key required. No network calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before dynamic import of route
// ---------------------------------------------------------------------------

const MOCK_GOVERNANCE_RESULT = {
  financialNotes: [
    '## Nota 1 — Políticas Contables\nBase de preparación: NIIF para PYMES Grupo 2.',
    '## Nota 15 — Partes Vinculadas\nNIC 24 — no existen operaciones con vinculados.',
    '## Nota 16 — Autorización para la Publicación\nNIC 10 §17 — autorizada el 31/12/2025.',
  ].join('\n'),
  shareholderMinutes:
    '## Acta de Asamblea\nArt. 424 C.Co. Convocatoria. Orden del día: aprobación gestión Art. 187 §3 Ley 222/1995.',
  fullContent:
    '## Gobierno Corporativo\nNotas + Acta. Diferencia de criterio Art. 647 E.T. preserva argumentación.',
};

const mockRunGovernancePhase = vi.fn().mockResolvedValue(MOCK_GOVERNANCE_RESULT);

vi.mock('@/lib/agents/financial/orchestrator', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/agents/financial/orchestrator')>();
  return {
    ...original,
    runGovernancePhase: (...args: unknown[]) => mockRunGovernancePhase(...args),
  };
});

// Mock gateway-errors
vi.mock('@/lib/agents/utils/gateway-errors', () => ({
  toFriendlyError: vi.fn().mockReturnValue({
    message: 'Error de prueba en el pipeline de Gobierno Corporativo.',
    code: 'pipeline_validation_failed',
  }),
}));

// ---------------------------------------------------------------------------
// Import handler AFTER mocks
// ---------------------------------------------------------------------------

const { POST } = await import('../governance/route.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_COMPANY = {
  name: 'Empresa Test SAS',
  nit: '900123456-1',
  fiscalPeriod: '2025',
};

// governancePhaseRequestSchema requiere fullContent en niifResult y strategyResult
const VALID_NIIF_RESULT = {
  fullContent: '## Reporte NIIF\nActivo = Pasivo + Patrimonio. Clase 4 ingresos: $500.000.',
  balanceSheet: '## Balance',
  incomeStatement: '## P&L',
  cashFlowStatement: '## EFE',
  equityChangesStatement: '## ECP',
  technicalNotes: 'Notas. Art. 647 E.T. diferencia de criterio.',
};

const VALID_STRATEGY_RESULT = {
  fullContent: '## Análisis Estratégico\nLos ingresos provienen exclusivamente de Clase 4. KPIs ancla.',
  kpiDashboard: '## KPIs\nRazón Corriente: 2.5',
  breakEvenAnalysis: '## Punto de Equilibrio',
  projectedCashFlow: '## Flujo Proyectado',
  strategicRecommendations: '## Recomendaciones\n1. Reducir deuda',
};

const VALID_BINDING_TOTALS =
  '## TOTALES VINCULANTES\nActivo: $1.000.000\nPasivo: $400.000\nPatrimonio: $600.000';

function makeStreamingRequest(body: unknown): Request {
  return new Request('http://localhost/api/financial-report/governance', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-stream': 'true',
    },
    body: JSON.stringify(body),
  });
}

function makeNonStreamingRequest(body: unknown): Request {
  return new Request('http://localhost/api/financial-report/governance', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(): Record<string, unknown> {
  return {
    niifResult: VALID_NIIF_RESULT,
    strategyResult: VALID_STRATEGY_RESULT,
    bindingTotals: VALID_BINDING_TOTALS,
    company: VALID_COMPANY,
    language: 'es',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/financial-report/governance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunGovernancePhase.mockResolvedValue(MOCK_GOVERNANCE_RESULT);
  });

  // ── 1. Happy path — streaming ────────────────────────────────────────────

  it('happy path: returns 200 SSE stream with governance_phase and done events', async () => {
    const req = makeStreamingRequest(validBody());

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const text = await res.text();
    expect(text).toContain('event: governance_phase');
    expect(text).toContain('event: done');

    // governance_phase payload must carry the GovernanceResult
    const govChunk = text.split('\n\n').find((c) => c.includes('event: governance_phase'));
    expect(govChunk).toBeDefined();
    const dataLine = govChunk!.split('\n').find((l) => l.startsWith('data:'));
    expect(dataLine).toBeDefined();
    const payload = JSON.parse(dataLine!.replace(/^data:/, '').trim()) as {
      governance: { fullContent: string; financialNotes: string };
    };
    expect(payload.governance.fullContent).toContain('Art. 647 E.T.');
    expect(payload.governance.financialNotes).toContain('NIC 24');
  });

  it('done event carries stage=governance', async () => {
    const req = makeStreamingRequest(validBody());
    const res = await POST(req);
    const text = await res.text();

    const doneChunk = text.split('\n\n').find((c) => c.includes('event: done'));
    expect(doneChunk).toBeDefined();
    const dataLine = doneChunk!.split('\n').find((l) => l.startsWith('data:'));
    const donePayload = JSON.parse(dataLine!.replace(/^data:/, '').trim()) as {
      stage: string;
    };
    expect(donePayload.stage).toBe('governance');
  });

  // ── 2. Body inválido — falta strategyResult ──────────────────────────────

  it('returns 400 when strategyResult is missing', async () => {
    const body = { ...validBody() };
    delete body['strategyResult'];

    const req = makeStreamingRequest(body);
    const res = await POST(req);

    expect(res.status).toBe(400);
    const resBody = await res.json() as { error: string; details: string[] };
    expect(resBody.error).toMatch(/invalid request format/i);
    expect(resBody.details.some((d) => d.includes('strategyResult'))).toBe(true);
  });

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

  it('returns 400 when strategyResult.fullContent is empty', async () => {
    const req = makeStreamingRequest({
      ...validBody(),
      strategyResult: { fullContent: '' },
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

  // ── 3. runGovernancePhase lanza — SSE emite error sin crash ─────────────

  it('emits SSE error event when runGovernancePhase throws', async () => {
    mockRunGovernancePhase.mockRejectedValueOnce(new Error('OpenAI model not found'));

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
    expect(errorPayload.error).toMatch(/gobierno corporativo/i);
    expect(errorPayload.detail).toBeTruthy();
  });

  // ── 4. Progress events propagados ───────────────────────────────────────

  it('propagates onProgress events to the SSE stream', async () => {
    mockRunGovernancePhase.mockImplementationOnce(
      async (
        _input: unknown,
        opts: { onProgress?: (e: { type: string; stage?: number }) => void },
      ) => {
        opts?.onProgress?.({ type: 'stage_start', stage: 3 });
        opts?.onProgress?.({ type: 'stage_progress', stage: 3 });
        opts?.onProgress?.({ type: 'stage_complete', stage: 3 });
        return MOCK_GOVERNANCE_RESULT;
      },
    );

    const req = makeStreamingRequest(validBody());
    const res = await POST(req);
    const text = await res.text();

    const progressEvents = text.split('\n\n').filter((c) => c.includes('event: progress'));
    expect(progressEvents.length).toBe(3);
  });

  // ── 5. Non-streaming happy path ──────────────────────────────────────────

  it('non-streaming mode returns JSON with governance field', async () => {
    const req = makeNonStreamingRequest(validBody());
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json() as { governance: { fullContent: string } };
    expect(body.governance.fullContent).toContain('Art. 647 E.T.');
  });
});
