// Cross-dep P1: /strategy, /governance, /api/financial-audit y
// /api/financial-quality re-derivan el preprocesado (ya ajustado por /niif)
// desde sus filas; sin el ledger un informe honesto con ajustes recibiría 422.
import { describe, expect, it } from 'vitest';

import { buildQualityRequestBody } from '../PipelineWorkspace';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';

const r = makeExportableReport();
describe('buildQualityRequestBody — ledger del Doctor con el preprocesado', () => {
  const ledger = {
    adjustments: [
      { id: 'a', accountCode: '510505', accountName: 'Sueldos', amount: -500, rationale: 'r', status: 'applied' as const, proposedAt: 'x' },
      { id: 'b', accountCode: '110505', accountName: 'Caja', amount: 1, rationale: 'r', status: 'rejected' as const, proposedAt: 'x' },
    ],
  };
  it('envía sólo los ajustes confirmados cuando hay preprocesado', () => {
    const body = buildQualityRequestBody({ report: r, auditReport: null, language: 'es', preprocessed: { x: 1 }, adjustmentLedger: ledger });
    expect(body.adjustmentLedger).toEqual({ adjustments: [ledger.adjustments[0]] });
  });
  it('sin preprocesado no envía ledger', () => {
    const body = buildQualityRequestBody({ report: r, auditReport: null, language: 'es', preprocessed: null, adjustmentLedger: ledger });
    expect('adjustmentLedger' in body).toBe(false);
  });
});
