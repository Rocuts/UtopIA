// ---------------------------------------------------------------------------
// I5-2 — identidad de las Partes II y III contra la Parte I
// ---------------------------------------------------------------------------
// El encabezado del dashboard (Parte II) y del acta (Parte III) imprimen
// `json.company` (nombre, NIT, periodo) de SU propio JSON. `identityBlockers`
// (gate de exportación) sólo cruzaba `report.company` con el JSON NIIF: una
// Parte II/III de otra empresa u otro periodo —pegada de otro informe o
// reescrita en el cliente— salía con el encabezado ajeno y "procedencia
// verificada". El servidor (part-verdicts) cruza ahora la identidad de cada
// Parte con la de los estados financieros y sella la Parte que no coincide.
// Sin falsos positivos: NIT con o sin DV y con puntos, nombre con tildes,
// mayúsculas, puntos o espacios distintos.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { financialExportBlockers } from '@/lib/export/financial-export-validation';
import { preprocessUploadedTrialBalanceText } from '@/lib/preprocessing/raw-data';
import type { GovernanceReportJson } from '@/lib/agents/financial/contracts/governance-report';
import type { StrategyReportJson } from '@/lib/agents/financial/contracts/strategy-report';
import type { FinancialReport } from '@/lib/agents/financial/types';
import { partIdentityMotivos, withServerPartVerdicts } from '../part-verdicts';
import { withServerRenderedParts } from '../part-markdown';
import { PROVENANCE_COMPANY, PROVENANCE_CSV } from './provenance-fixture';
import { withCoherentParts } from './coherent-parts';

const read = preprocessUploadedTrialBalanceText(PROVENANCE_CSV);
if (read.kind !== 'ok') throw new Error('fixture sin balance');
const pp = read.preprocessed;
const company = { ...PROVENANCE_COMPANY, niifGroup: 2 as const };

function report(): FinancialReport {
  return withCoherentParts({ ...makeExportableReport(), company }, pp, { impracticable: true });
}

const strategyJson = (r: FinancialReport) => r.strategicAnalysis.json as StrategyReportJson;
const governanceJson = (r: FinancialReport) => r.governance.json as GovernanceReportJson;

describe('partIdentityMotivos — normalización sin falsos positivos', () => {
  const ref = { name: 'Construcciones Andinas S.A.S.', nit: '900.123.456-8', fiscalPeriod: '2025' };

  it('NIT con/sin DV y con puntos, nombre con tildes, mayúsculas, puntos y espacios: coincide', () => {
    for (const other of [
      { name: 'CONSTRUCCIONES ANDINAS SAS', nit: '900123456', fiscalPeriod: '2025' },
      { name: 'construcciones  andinas s.a.s', nit: '9001234568', fiscalPeriod: ' 2025 ' },
      { name: 'Construcciónes Andinas S A S', nit: '900.123.456-8', fiscalPeriod: '2025' },
    ]) {
      expect(partIdentityMotivos('II', other, ref, 'es')).toEqual([]);
    }
  });

  it('otra empresa, otro NIT u otro periodo: un motivo por campo', () => {
    const m = partIdentityMotivos('III', { name: 'Otra Empresa SAS', nit: '800765432-1', fiscalPeriod: '2024' }, ref, 'es');
    expect(m).toHaveLength(3);
    expect(m.join('\n')).toMatch(/Identidad: la Parte III declara la empresa "Otra Empresa SAS"/);
    expect(m.join('\n')).toMatch(/NIT de la Parte III \(800765432-1\)/);
    expect(m.join('\n')).toMatch(/periodo de la Parte III \(2024\)/);
    // Un DV distinto no es "el mismo NIT con DV".
    expect(partIdentityMotivos('II', { ...ref, nit: '900123457' }, ref, 'es')).toHaveLength(1);
    expect(partIdentityMotivos('II', { ...ref, name: 'Otra' }, ref, 'en')[0]).toMatch(/^Identity: Part II names the company "Otra"/);
  });
});

describe('withServerPartVerdicts — identidad de las Partes II/III', () => {
  it('fixture honesto: sin motivos de identidad, Partes limpias', () => {
    const out = withServerPartVerdicts(report(), pp, 'es');
    expect(out.strategicAnalysis.strategyQualifications?.clean).toBe(true);
    expect(out.governance.actaQualifications?.clean).toBe(true);
    expect(financialExportBlockers(out, pp)).toEqual([]);
  });

  it('Parte II de otra empresa: sellada, con el sello impreso en el dashboard, y no exportable', () => {
    const r = report();
    strategyJson(r).company = { ...strategyJson(r).company, name: 'Otra Empresa SAS', nit: '800765432-1' };
    const out = withServerRenderedParts(r, pp, 'es');
    expect(out.strategicAnalysis.strategyQualifications?.clean).toBe(false);
    expect(out.strategicAnalysis.strategyQualifications?.motivos.join('\n')).toMatch(/Identidad: la Parte II declara la empresa "Otra Empresa SAS"/);
    expect(out.strategicAnalysis.kpiDashboard).toMatch(/Identidad: la Parte II/);
    expect(out.governance.actaQualifications?.clean).toBe(true);
    expect(financialExportBlockers(out, pp).length).toBeGreaterThan(0);
  });

  it('acta de otro periodo: Parte III sellada con el motivo impreso', () => {
    const r = report();
    governanceJson(r).company = { ...governanceJson(r).company, fiscalPeriod: '2024' };
    const out = withServerRenderedParts(r, pp, 'es');
    expect(out.governance.actaQualifications?.clean).toBe(false);
    expect(out.governance.actaQualifications?.motivos.join('\n')).toMatch(/periodo de la Parte III \(2024\)/);
    expect(out.governance.shareholderMinutes).toMatch(/Identidad: el periodo de la Parte III \(2024\)/);
    expect(out.niifAnalysis.reconciliation?.clean).toBe(false);
  });

  it('en inglés el motivo sale en inglés', () => {
    const r = report();
    governanceJson(r).company = { ...governanceJson(r).company, nit: '800765432-1' };
    const out = withServerPartVerdicts(r, pp, 'en');
    expect(out.governance.actaQualifications?.motivos.join('\n')).toMatch(/Identity: Part III tax ID \(800765432-1\)/);
  });
});
