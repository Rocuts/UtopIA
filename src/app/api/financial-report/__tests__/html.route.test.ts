/**
 * Integration tests for POST /api/financial-report/html (Wave 4.F9)
 *
 * Mocks:
 *   - @/lib/agents/financial/agents/html-editor — runHtmlEditor
 *   - @/lib/agents/financial/contracts/html-editor — HtmlEditorInputSchema
 *     (para que el body fixture no necesite los JSON reports completos)
 *
 * No OpenAI key required. No network calls.
 *
 * Pattern: idéntico a niif/strategy/governance route tests (Wave 3.F1).
 * Diferencia: el html endpoint recibe HtmlEditorInput (3 report JSONs +
 * company + metadata + language), así que mockeamos también el schema para
 * test de happy path / error path sin construir fixtures profundos.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChecklistFailure } from '@/lib/agents/financial/agents/html-editor-validator';
import { makeCoherentNiifReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { coherentGovernanceJson, coherentStrategyJson } from '@/lib/reports/__tests__/coherent-parts';

// ---------------------------------------------------------------------------
// Mocks — declarados ANTES del dynamic import del route
// ---------------------------------------------------------------------------

const HASH = 'a'.repeat(64);

const MOCK_METADATA = {
  reportMode: 'LINEA_BASE' as const,
  entityNit: '900123456-1',
  entityName: 'Empresa Test SAS',
  entityCity: 'Cali',
  entityType: 'SAS',
  entityLaw: 'Ley 1258/2008',
  entityGroup: 'Grupo 2',
  periodStart: '2025-01-01',
  periodEnd: '2025-12-31',
  periodYear: '2025',
  generatedAt: '2026-05-13T10:00:00Z',
  extractedAt: '2026-05-12T08:00:00Z',
  issuedAtHuman: '13 de mayo de 2026',
  modelId: 'gpt-5.4-mini',
  agentVersion: '1+1 v10.1' as const,
  globalConfidence: { highPct: 80, mediumPct: 15, lowPct: 5 },
  alertsCounts: { high: 0, medium: 1, low: 2 },
  auxiliariesProcessed: 120,
  coverageByClass: [
    {
      classCode: '1' as const,
      auxiliariesCount: 30,
      totalSaldoCop: '100000000',
      percentOfFolio: '45.2',
    },
  ],
  sectorCIIU: '4711',
  reportHashSha256: HASH,
};

const MOCK_HTML_OUTPUT = {
  html: `<!DOCTYPE html><html lang="es"><head><title>Test</title></head><body>
    <!-- REPORT_MODE: LINEA_BASE -->
    <!-- ENTITY: 900123456-1 -->
    <!-- AGENT_VERSION: 1+1 v10.1 -->
    <h1>Reporte Financiero 2025</h1>
    <p>Hash: ${HASH}</p>
    <section><h2>Cómo se construyó este informe</h2></section>
    <section><h2>Limitaciones de Información</h2></section>
  </body></html>`,
  metadata: MOCK_METADATA,
  checklistFailures: [] as ChecklistFailure[],
};

// Mock del agente HTML — intercepta antes de la llamada al LLM
const mockRunHtmlEditor = vi.fn().mockResolvedValue(MOCK_HTML_OUTPUT);

vi.mock('@/lib/agents/financial/agents/html-editor', () => ({
  runHtmlEditor: (...args: unknown[]) => mockRunHtmlEditor(...args),
}));

// Mock del schema de input — permite que el body fixture mínimo pase
// la validación Zod sin construir los 3 JSONs de report completos.
// El contrato real se valida en html-editor-validator.test.ts con fixtures DOM.
vi.mock('@/lib/agents/financial/contracts/html-editor', () => ({
  HtmlEditorInputSchema: {
    safeParse: (body: unknown) => {
      if (
        body !== null &&
        typeof body === 'object' &&
        'niifReport' in (body as object) &&
        'metadata' in (body as object)
      ) {
        return { success: true, data: body };
      }
      return {
        success: false,
        error: {
          message: 'niifReport: Required',
          issues: [
            { path: ['niifReport'], message: 'Required' },
          ],
        },
      };
    },
  },
}));

// Mock gateway-errors — devuelve error determinístico
vi.mock('@/lib/agents/utils/gateway-errors', () => ({
  toFriendlyError: vi.fn().mockReturnValue({
    message: 'Error de prueba en el Editor Jefe HTML.',
    code: 'pipeline_validation_failed',
  }),
}));

// ---------------------------------------------------------------------------
// Import handler DESPUÉS de los mocks (patrón canónico)
// ---------------------------------------------------------------------------

const { POST } = await import('../html/route.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Body que pasa la validación mockeada del schema. Desde la re-auditoría final
 * (procedencia-R2-03) /html sin referencia aplica el MISMO gate que /export
 * sin referencia: las tres Partes deben traer JSON del contrato (el real lo
 * exige; un `{}` dejaba la Parte II/III sellada) y la empresa del encabezado
 * debe ser la de los estados (identidad).
 */
const COHERENT_NIIF = makeCoherentNiifReport();
const COHERENT_COMPANY = {
  name: COHERENT_NIIF.company.name,
  nit: COHERENT_NIIF.company.nit,
  fiscalPeriod: COHERENT_NIIF.company.fiscalPeriod,
  entityType: 'SAS',
};
const VALID_BODY = {
  // JSON NIIF estructuralmente válido y coherente: el route aplica el gate
  // aritmético servidor (misma regla que Excel/PDF) antes del Editor Jefe.
  niifReport: COHERENT_NIIF,
  strategyReport: coherentStrategyJson(COHERENT_NIIF),
  governanceReport: coherentGovernanceJson(COHERENT_NIIF, COHERENT_COMPANY),
  company: COHERENT_COMPANY,
  metadata: MOCK_METADATA,
  language: 'es',
};

function makeStreamingRequest(body: unknown): Request {
  return new Request('http://localhost/api/financial-report/html', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-stream': 'true',
    },
    body: JSON.stringify(body),
  });
}

function makeNonStreamingRequest(body: unknown): Request {
  return new Request('http://localhost/api/financial-report/html', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function collectSSEText(res: Response): Promise<string> {
  return res.text();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/financial-report/html', () => {
  beforeEach(() => {
    mockRunHtmlEditor.mockReset();
    mockRunHtmlEditor.mockResolvedValue(MOCK_HTML_OUTPUT);
  });

  // ── 1. Happy path — SSE streaming ─────────────────────────────────────────

  it('happy path: body válido + x-stream → 200 SSE con html_phase + done', async () => {
    const req = makeStreamingRequest(VALID_BODY);
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const text = await collectSSEText(res);
    expect(text).toContain('event: html_phase');
    expect(text).toContain('event: done');

    // Verifica payload de html_phase
    const htmlChunk = text.split('\n\n').find((c) => c.includes('event: html_phase'));
    expect(htmlChunk).toBeDefined();
    const dataLine = htmlChunk!.split('\n').find((l) => l.startsWith('data:'));
    expect(dataLine).toBeDefined();
    const payload = JSON.parse(dataLine!.replace(/^data:/, '').trim()) as {
      html: string;
      metadata: { entityNit: string };
      checklistFailures: unknown[];
    };
    expect(payload.html).toContain('<!DOCTYPE html>');
    expect(payload.metadata.entityNit).toBe('900123456-1');
    expect(payload.checklistFailures).toHaveLength(0);
  });

  // ── 2. Body inválido — sin niifReport → 400 ───────────────────────────────

  it('body inválido (sin niifReport) → 400', async () => {
    const req = makeStreamingRequest({
      // niifReport deliberadamente omitido
      company: VALID_BODY.company,
      metadata: MOCK_METADATA,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json() as { error: string; details: string[] };
    expect(body.error).toMatch(/invalid request format/i);
    expect(body.details.some((d) => d.includes('niifReport'))).toBe(true);
  });

  // ── 3. Agente lanza error genérico → SSE emite event: error ───────────────

  it('agente lanza error genérico → SSE con event: error (status 200)', async () => {
    mockRunHtmlEditor.mockRejectedValueOnce(new Error('Editor HTML falló — budget agotado'));

    const req = makeStreamingRequest(VALID_BODY);
    const res = await POST(req);

    // Status 200 — el stream abrió; el error viaja dentro del SSE
    expect(res.status).toBe(200);

    const text = await collectSSEText(res);
    expect(text).toContain('event: error');
    expect(text).not.toContain('event: done');

    const errorChunk = text.split('\n\n').find((c) => c.includes('event: error'));
    expect(errorChunk).toBeDefined();
    const dataLine = errorChunk!.split('\n').find((l) => l.startsWith('data:'));
    const errorPayload = JSON.parse(dataLine!.replace(/^data:/, '').trim()) as {
      error: string;
      detail: string;
      code: string;
    };
    expect(errorPayload.error).toBeTruthy();
    expect(errorPayload.detail).toBeTruthy();
    expect(errorPayload.code).toBe('pipeline_validation_failed');
  });

  // ── 4. Non-streaming → JSON directo con html + metadata + checklistFailures

  it('non-streaming: body válido sin x-stream → 200 JSON con html + metadata', async () => {
    const req = makeNonStreamingRequest(VALID_BODY);
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const json = await res.json() as {
      html: string;
      metadata: { entityNit: string };
      checklistFailures: unknown[];
    };
    expect(json.html).toBeDefined();
    expect(json.html).toContain('<!DOCTYPE html>');
    expect(json.metadata).toBeDefined();
    expect(json.metadata.entityNit).toBe('900123456-1');
    expect(Array.isArray(json.checklistFailures)).toBe(true);
  });

  // ── 5. checklistFailures con severity=block se propagan al cliente ─────────

  it('checklistFailures severity=block se propagan al cliente (non-streaming)', async () => {
    const failures: ChecklistFailure[] = [
      {
        rule: '§1.6 · Check 17 — vocabulario prohibido',
        detail: 'Palabra prohibida detectada: "Élite"',
        severity: 'block',
      },
      {
        rule: '§5 · Check 15 — hash SHA-256 en bloque transparencia',
        detail: `Hash SHA-256 "${HASH}" no encontrado en HTML output`,
        severity: 'block',
      },
    ];
    mockRunHtmlEditor.mockResolvedValueOnce({
      ...MOCK_HTML_OUTPUT,
      checklistFailures: failures,
    });

    const req = makeNonStreamingRequest(VALID_BODY);
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json() as { checklistFailures: ChecklistFailure[] };
    expect(json.checklistFailures).toHaveLength(2);
    expect(json.checklistFailures[0].severity).toBe('block');
    expect(json.checklistFailures[1].severity).toBe('block');
    expect(json.checklistFailures[0].rule).toContain('vocabulario prohibido');
  });

  // ── 6. SSE done event incluye stage: 'html' ────────────────────────────────

  it('evento done incluye stage: "html" en el payload', async () => {
    const req = makeStreamingRequest(VALID_BODY);
    const res = await POST(req);

    const text = await collectSSEText(res);
    const doneChunk = text.split('\n\n').find((c) => c.includes('event: done'));
    expect(doneChunk).toBeDefined();
    const dataLine = doneChunk!.split('\n').find((l) => l.startsWith('data:'));
    const payload = JSON.parse(dataLine!.replace(/^data:/, '').trim()) as { stage: string };
    expect(payload.stage).toBe('html');
  });

  // ── 7. runHtmlEditor recibe los datos correctos del body ───────────────────

  it('runHtmlEditor se invoca con el data parseado (spy call)', async () => {
    const req = makeNonStreamingRequest(VALID_BODY);
    await POST(req);

    expect(mockRunHtmlEditor).toHaveBeenCalledOnce();
    const [calledWith] = mockRunHtmlEditor.mock.calls[0] as [{ metadata: { entityNit: string } }];
    expect(calledWith.metadata.entityNit).toBe('900123456-1');
  });
});

// ---------------------------------------------------------------------------
// pipeline-flujo-10 — gate aritmético servidor (misma regla que Excel/PDF)
// ---------------------------------------------------------------------------

/** Parte II mínima válida según StrategyReportSchema. */
function strategyReportWith(totalActivoCents: string) {
  const rec = {
    title: 'Revisar cartera', diagnosis: 'Cartera alta.', action: 'Cobrar.', expectedImpact: 'Liquidez.',
    priority: 'medium' as const, horizon: 'short_term' as const, normReference: null,
  };
  return {
    company: {
      name: 'Empresa Prueba SAS', nit: '900123456', entityType: null, sector: null, niifGroup: 2,
      fiscalPeriod: '2025', comparativePeriod: null, city: null, signatories: null,
    },
    reportMode: 'LINEA_BASE',
    confidence: null,
    executiveDashboard: {
      rows: [{ label: 'Total Activo', primary: totalActivoCents, comparative: null, variation: null, variationPct: null, commentary: 'Cierre.' }],
      executiveCommentary: 'Primer cierre.',
    },
    technicalAlerts: [],
    kpis: [{
      category: 'liquidity', name: 'Capital de trabajo', formula: 'AC − PC', resultPrimary: '1', resultComparative: null,
      unit: 'cop', benchmarkBand: { description: '> 0', lowerBound: '0', upperBound: null }, diagnosis: 'ok',
      yoyVariation: null, confidence: null, anomalyFlag: null, presentationMode: null, baselineLabel: null, sparklinePoints: null,
    }],
    dupontAnalysis: null,
    trends: null,
    breakEven: {
      fixedCostsCop: '1', variableCostsCop: '1', revenueCop: '1', breakEvenPointCop: '1', marginOfSafetyPct: '1',
      classificationNote: 'nota',
    },
    projectedCashFlow: {
      liquidityGate: { triggered: false, currentAssetsCop: '2', currentLiabilitiesCop: '1', gapCop: '1', message: null },
      initialCashBalanceCop: '1', dsoDays: '30', inflationIndexPct: '5', scenarios: [], solvencyNarrative: 'ok',
      controlKpis: [], assumptionsNote: 'supuestos',
    },
    recommendations: [rec, rec, rec],
    presumedCostWarning: null,
    preparerNotes: [],
  };
}

describe('POST /api/financial-report/html — gate aritmético servidor', () => {
  beforeEach(() => {
    mockRunHtmlEditor.mockReset();
    mockRunHtmlEditor.mockResolvedValue(MOCK_HTML_OUTPUT);
  });

  it('JSON NIIF que NO cuadra (A ≠ P + Pt) → 422 y no se paga el Editor Jefe', async () => {
    const niif = makeCoherentNiifReport();
    niif.balanceSheet.equity = [{ ...niif.balanceSheet.equity[0], amountPrimary: '500000' }];
    niif.balanceSheet.totalEquityPrimary = '500000';
    for (const req of [makeNonStreamingRequest, makeStreamingRequest]) {
      const res = await POST(req({ ...VALID_BODY, niifReport: niif }));
      expect(res.status).toBe(422);
      const body = (await res.json()) as { details: string[] };
      expect(body.details.length).toBeGreaterThan(0);
    }
    expect(mockRunHtmlEditor).not.toHaveBeenCalled();
  });

  it('Parte II con Total Activo distinto del Balance NIIF → 422', async () => {
    const res = await POST(
      makeNonStreamingRequest({ ...VALID_BODY, strategyReport: strategyReportWith('10000000') }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { details: string[] };
    expect(body.details.join(' ')).toMatch(/Parte II — Dashboard — Total Activo/);
  });

  it('Parte II coherente con el Balance NIIF → 200', async () => {
    const res = await POST(
      makeNonStreamingRequest({ ...VALID_BODY, strategyReport: strategyReportWith('1000000') }),
    );
    expect(res.status).toBe(200);
  });

  it('preprocesado malformado → 400', async () => {
    const res = await POST(makeNonStreamingRequest({ ...VALID_BODY, preprocessed: { periods: [] } }));
    expect(res.status).toBe(400);
  });

  // pipeline-flujo-10 — /html usa el MISMO gate que /export
  // (`niifArithmeticBlockers`); antes replicaba localmente sólo una parte.
  it('renglón del ERI fuera de las clases 4–7 → 422 (igual que Excel/PDF)', async () => {
    const niif = makeCoherentNiifReport();
    niif.incomeStatement.lines.push({
      ...niif.incomeStatement.lines[0], account: '8105', label: 'Ingreso extraordinario', amountPrimary: '500000000',
    });
    const res = await POST(makeNonStreamingRequest({ ...VALID_BODY, niifReport: niif }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { details: string[] };
    expect(body.details.join(' ')).toMatch(/8105/);
    expect(mockRunHtmlEditor).not.toHaveBeenCalled();
  });

  it('ORI del ERI distinto de la variación del ECP (E6) → 422 (igual que Excel/PDF)', async () => {
    const niif = makeCoherentNiifReport();
    niif.incomeStatement.oriPrimary = '50000';
    const res = await POST(makeNonStreamingRequest({ ...VALID_BODY, niifReport: niif }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { details: string[] };
    expect(body.details.some((d) => d.startsWith('E6.'))).toBe(true);
  });
});
