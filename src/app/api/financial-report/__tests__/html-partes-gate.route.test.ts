/**
 * /api/financial-report/html — veredictos de las Partes II y III (e2e-niif-16).
 *
 * Re-auditoría 2026-09-24: con un acta cuya utilidad neta era +$40.000.000
 * frente a una pérdida de −$40.000.000, /export respondía 422 pero /html
 * devolvía 200 con `emittable: true`: sólo la UI impedía la descarga. El route
 * recalcula ahora el acta contra el preprocesado de la petición (la misma
 * aritmética que alimentó el prompt del Especialista de Gobierno) y respeta los
 * veredictos `clean: false` que reenvía el cliente.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  informeHonesto,
  preprocesarPerdidaComparativo,
} from '@/lib/agents/financial/__fixtures__/perdida-comparativo-w4a';
import { buildActaExpectedArithmetic } from '@/lib/agents/financial/prompts/governance-specialist.prompt';
import { toJsonSafe } from '@/lib/preprocessing/json-safe';

const mockRunHtmlEditor = vi.fn();
vi.mock('@/lib/agents/financial/agents/html-editor', () => ({
  runHtmlEditor: (...args: unknown[]) => mockRunHtmlEditor(...args),
}));
// El contrato real de los tres JSON se valida en sus propias pruebas; aquí sólo
// interesa el gate del route.
vi.mock('@/lib/agents/financial/contracts/html-editor', () => ({
  HtmlEditorInputSchema: {
    safeParse: (body: unknown) => ({ success: true, data: body }),
  },
}));
vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: async () => ({ ok: true }) }));
vi.mock('@/lib/db/workspace', () => ({ getCurrentWorkspaceId: async () => null }));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: async () => '' }));
vi.mock('@/lib/db/telemetry', async (orig) => {
  const actual = await orig<typeof import('@/lib/db/telemetry')>();
  return { ...actual, resolveOwnedReportId: async () => null };
});

const { POST } = await import('../html/route.js');

const pp = preprocesarPerdidaComparativo();
const COMPANY = {
  name: 'Demo Perdidas SAS', nit: '900123456-8', entityType: 'SAS', sector: null, niifGroup: 2,
  fiscalPeriod: '2025', comparativePeriod: '2024', city: null, signatories: null,
};

function acta(netIncomeCop: string) {
  const exp = buildActaExpectedArithmetic({ name: COMPANY.name, nit: COMPANY.nit, fiscalPeriod: '2025', entityType: 'SAS' }, pp)!;
  return {
    shareholderMinutes: {
      resultDistribution: {
        netIncomeCop,
        applies: exp.distributionApplies,
        lines: [],
        neutralProposalText: 'La asamblea decide sobre el cubrimiento de la pérdida.',
      },
      capitalizationProposal: {
        applies: exp.capitalizationApplies,
        retainedEarningsBaseCop: exp.capitalizationBaseCop,
        capitalizationAmountCop: exp.capitalizationAmountCop,
        legalReference: 'Ley 1258/2008',
        body: 'No se propone capitalización.',
      },
    },
  };
}

function body(governanceReport: unknown, extra: Record<string, unknown> = {}) {
  return {
    niifReport: informeHonesto(pp),
    strategyReport: {},
    governanceReport,
    company: COMPANY,
    metadata: { entityNit: '900123456', periodEnd: '2025-12-31' },
    language: 'es',
    preprocessed: toJsonSafe(pp),
    ...extra,
  };
}

const post = (b: unknown) =>
  POST(new Request('http://localhost/api/financial-report/html', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(b),
  }));

describe('/html — gate de las Partes II y III (e2e-niif-16)', () => {
  beforeEach(() => {
    mockRunHtmlEditor.mockReset();
    mockRunHtmlEditor.mockResolvedValue({ html: '<html></html>', metadata: {}, checklistFailures: [], emittable: true });
  });

  it('acta con la utilidad neta del P&G: pasa el gate y corre el Editor Jefe', async () => {
    const res = await post(body(acta('-4000000000')));
    expect(res.status).toBe(200);
    expect(mockRunHtmlEditor).toHaveBeenCalledTimes(1);
  });

  it('acta con utilidad neta +$40M frente a una pérdida de −$40M → 422 sin pagar el Editor Jefe', async () => {
    const res = await post(body(acta('4000000000')));
    expect(res.status).toBe(422);
    const payload = (await res.json()) as { details: string[] };
    expect(payload.details.join('\n')).toMatch(/acta de asamblea \(Parte III\)/);
    expect(payload.details.join('\n')).toMatch(/Utilidad Neta del acta/);
    expect(mockRunHtmlEditor).not.toHaveBeenCalled();
  });

  it('los veredictos clean:false que reenvía el cliente bloquean', async () => {
    const r1 = await post(body(acta('-4000000000'), { actaQualifications: { clean: false, motivos: ['x'] } }));
    expect(r1.status).toBe(422);
    const r2 = await post(body(acta('-4000000000'), { strategyQualifications: { clean: false } }));
    expect(r2.status).toBe(422);
    expect(((await r2.json()) as { details: string[] }).details).toContain(
      'El análisis estratégico (Parte II) contiene cifras sin respaldo en el balance.',
    );
  });

  it('sin preprocesado, un acta que reparte o capitaliza con monto no se emite', async () => {
    const gov = acta('-4000000000');
    gov.shareholderMinutes.capitalizationProposal.applies = true;
    gov.shareholderMinutes.capitalizationProposal.capitalizationAmountCop = '100000000';
    const res = await post(body(gov, { preprocessed: undefined }));
    expect(res.status).toBe(422);
  });
});
