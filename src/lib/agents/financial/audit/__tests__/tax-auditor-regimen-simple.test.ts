// ---------------------------------------------------------------------------
// Re-auditoría 2026-09-24 (NT-02): runTaxAuditor lleva el régimen del intake
// (company.regimenTributario) al prompt y a los overrides deterministas.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

const calls: Array<{ system: string }> = [];
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async (opts: { system: string }) => {
    calls.push({ system: opts.system });
    return {
      json: {
        complianceScore: 80, executiveSummary: 's', findings: [], conclusion: 'c', totalFiscalExposureCop: null,
        rentaAnalysis: {
          tarifaGeneralPct: 35, utilidadAntesImpuestosCop: '100000000000', provisionTeoricaCop: '1',
          impuestoRegistradoCop: '0', brechaCop: '1', evaluacion: 'observacion', accion: 'a', reference: 'Art. 240 E.T.',
        },
        retencionesAnalysis: { saldo1355Cop: '0', saldo1805Cop: null, saldo24Cop: '0', posicionFiscalNetaCop: '0', evaluacion: 'e', reference: 'Art. 850 E.T.' },
        ivaIcaAnalysis: { pasivoIvaNetoCop: '0', regimenIva: 'responsable', icaComment: 'i', reference: 'r' },
        tmtAnalysis: { tasaMinimaExigidaPct: 15, tasaEfectivaPct: null, status: 'no_aplica', reference: 'Arts. 903-916 E.T.' },
        riesgosTributarios: [], calendario2026: [],
        auditOpinion: { type: 'con_observaciones', text: 't', exposicionTotalCop: null }, requiredActions: [],
      },
      meta: {},
    };
  }),
}));

import { runTaxAuditor } from '../agents/tax-auditor';
import type { CompanyInfo } from '../../types';

const company = (regimenTributario: CompanyInfo['regimenTributario']): CompanyInfo => ({
  name: 'Tienda SIMPLE SAS', nit: '900123456', fiscalPeriod: '2025', entityType: 'SAS', regimenTributario,
});

describe('runTaxAuditor — régimen del intake (NT-02)', () => {
  it('SIMPLE: el prompt lo declara y el dictamen deja la TTD en «no aplica» sin cascada al 35%', async () => {
    const r = await runTaxAuditor('reporte', company('simple'), 'es');
    expect(calls.at(-1)!.system).toMatch(/Regimen de renta \(intake\): SIMPLE/);
    expect(r.fullContent).toMatch(/Estado: — NO APLICA/);
    expect(r.fullContent).not.toContain('$350.000.000,00');
  });

  it('sin régimen: TTD N/D por falta de ID/UD y cascada de referencia NIC 12', async () => {
    const r = await runTaxAuditor('reporte', company(null), 'es');
    expect(r.fullContent).toMatch(/Estado: — NO DETERMINABLE/);
    expect(r.fullContent).toContain('$350.000.000,00');
  });
});
