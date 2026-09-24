// pipeline-flujo-21 — la UI envía el override "Continuar de todas formas" a
// /consolidate (antes sólo lo recibía /niif, donde no tiene efecto en el camino
// partido: el consolidado salía como definitivo).
import { describe, expect, it } from 'vitest';

import { buildConsolidationRequestBody } from '../PipelineWorkspace';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import type { CompanyInfo } from '@/lib/agents/financial/types';

const r = makeExportableReport();
const company = { name: 'Empresa Prueba SAS', nit: '900123456', fiscalPeriod: '2025' } as CompanyInfo;
const base = {
  rawData: 'csv',
  company,
  language: 'es' as const,
  niifResult: r.niifAnalysis,
  strategyResult: r.strategicAnalysis,
  governanceResult: r.governance,
};

describe('buildConsolidationRequestBody — override provisional', () => {
  it('con el override activo el cuerpo lleva `provisional` (mismo contrato que /niif)', () => {
    const provisional = { active: true, reason: 'Borrador para revisión interna' };
    expect(buildConsolidationRequestBody({ ...base, provisional }).provisional).toEqual(provisional);
  });

  it('sin override, o inactivo, no se envía', () => {
    expect('provisional' in buildConsolidationRequestBody(base)).toBe(false);
    expect('provisional' in buildConsolidationRequestBody({ ...base, provisional: { active: false, reason: 'x' } })).toBe(false);
  });
});

