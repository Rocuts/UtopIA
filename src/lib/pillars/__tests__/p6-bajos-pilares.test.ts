// Fase 2 / P6 — hallazgos bajos de pilares:
//   auditoria-calidad-29  tolerancias de la ecuación patrimonial distintas entre
//                         sync-validator ($1.000 / 0,01 % del activo) y el gate
//                         de emisión (0 centavos); info rompía inSync.
//   auditoria-calidad-31  V10 exigía la TTD también al Régimen Simple.
//   ratios-kpis-29        IPC por defecto de la proyección rotulado como dato
//                         (meta BanRep / IPC Colombia) sin serlo.
import { describe, expect, it } from 'vitest';

import { makePnlSnapshot } from './_fixtures';
import { aggregatePillars } from '../service';
import { validateDashboardIntegrity } from '../sync-validator';
import { validateCrossPillarCoherence } from '../single-source-validator';
import {
  auditReportEmittable,
  type AuditCompanyContext,
} from '../audit-report-emittable';
import { describeIpcAssumption, IPC_DEFAULT } from '../futuro-bars';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { PeriodSnapshot } from '@/lib/preprocessing/trial-balance';

const SNAP = makePnlSnapshot();

describe('auditoria-calidad-29 — ecuación patrimonial al centavo en sync-validator', () => {
  it('un descuadre de $999.999 en activos de $10.000M ya no queda "inSync"', () => {
    const big: PeriodSnapshot = {
      ...SNAP,
      controlTotals: {
        ...SNAP.controlTotals,
        activo: 10_000_000_000,
        pasivo: 4_000_000_000,
        patrimonio: 6_000_000_000 - 999_999,
      },
      summary: { ...SNAP.summary, totalEquity: 6_000_000_000 - 999_999 },
    };
    const report = validateDashboardIntegrity(aggregatePillars({ snapshot: SNAP }), big);
    const eq = report.findings.find((f) => f.code === 'EQUATION_DRIFT');
    expect(eq).toBeDefined();
    expect(eq!.severity).toBe('critical');
    expect(report.inSync).toBe(false);
  });

  it('usa controlTotals.cents como V1: un centavo de diferencia es descuadre', () => {
    const cents = {
      activo: BigInt(130_000_000_001),
      pasivo: BigInt(46_500_000_000),
      patrimonio: BigInt(83_500_000_000),
    };
    const snap = {
      ...SNAP,
      controlTotals: {
        ...SNAP.controlTotals,
        cents: { ...(SNAP.controlTotals.cents ?? {}), ...cents },
      },
    } as PeriodSnapshot;
    const report = validateDashboardIntegrity(aggregatePillars({ snapshot: SNAP }), snap);
    const eq = report.findings.find((f) => f.code === 'EQUATION_DRIFT');
    expect(eq?.drift).toBeCloseTo(0.01, 10);
  });

  it('patrimonio controlTotals vs summary se compara al centavo (V4), no con $1.000', () => {
    const snap: PeriodSnapshot = {
      ...SNAP,
      summary: { ...SNAP.summary, totalEquity: SNAP.summary.totalEquity + 500 },
    };
    const pillars = aggregatePillars({ snapshot: SNAP });
    const sync = validateDashboardIntegrity(pillars, snap);
    expect(sync.findings.map((f) => f.code)).toContain('EQUITY_COHERENCE_DRIFT');
    const coherence = validateCrossPillarCoherence(pillars, snap);
    expect(coherence.findings.map((f) => f.code)).toContain('PATRIMONIO_DESYNC');
  });

  it('un balance cuadrado no produce hallazgos de ecuación', () => {
    const report = validateDashboardIntegrity(aggregatePillars({ snapshot: SNAP }), SNAP);
    const codes = report.findings.map((f) => f.code);
    expect(codes).not.toContain('EQUATION_DRIFT');
    expect(codes).not.toContain('EQUITY_COHERENCE_DRIFT');
  });

  it('hallazgos sólo informativos no desincronizan el tablero', () => {
    const pillars = aggregatePillars({ snapshot: SNAP });
    const baseline = validateDashboardIntegrity(pillars, SNAP);
    expect(baseline.findings.filter((f) => f.severity !== 'info')).toEqual([]);
    const tampered = {
      ...pillars,
      valor: {
        ...pillars.valor,
        kpis: pillars.valor.kpis.map((k) =>
          k.key === 'margen_neto_real' ? { ...k, value: (k.value ?? 0) + 0.01 } : k,
        ),
      },
    };
    const report = validateDashboardIntegrity(tampered, SNAP);
    expect(report.findings.map((f) => f.severity)).toEqual(['info']);
    expect(report.severity).toBe('info');
    expect(report.inSync).toBe(true);
  });
});

describe('auditoria-calidad-31 — V10 (TTD) sólo para contribuyentes del Art. 240', () => {
  const company: AuditCompanyContext = {
    razonSocialFromFile: 'Empresa Simple SAS',
    nitFromFile: '901714014-6',
    nit: '901714014-6',
    niifGroup: 2,
    tipoSocietario: 'SAS',
  };
  const report = { consolidatedReport: '# Informe stub' } as unknown as FinancialReport;

  it('Régimen Simple (Art. 903 E.T. sustituye la renta): V10 no se exige', () => {
    const r = auditReportEmittable(report, SNAP, { ...company, regimenTributario: 'simple' });
    expect(r.blockers.map((b) => b.code)).not.toContain('V10');
  });

  it('régimen ordinario o no informado: V10 se sigue exigiendo', () => {
    for (const regimenTributario of ['ordinario', undefined] as const) {
      const r = auditReportEmittable(report, SNAP, { ...company, regimenTributario });
      expect(r.blockers.map((b) => b.code)).toContain('V10');
    }
  });
});

describe('ratios-kpis-29 — el IPC por defecto es un supuesto de escenario rotulado', () => {
  it('sin valor del usuario el rótulo dice "supuesto de escenario" y niega ser dato DANE / meta BanRep', () => {
    const a = describeIpcAssumption();
    expect(a.rate).toBe(IPC_DEFAULT);
    expect(a.origen).toBe('supuesto_escenario');
    expect(a.labelEs).toContain('4,5 %');
    expect(a.labelEs).toMatch(/supuesto de escenario/);
    expect(a.labelEs).toMatch(/no es un dato del DANE ni la meta del Banco de la República/);
    expect(a.labelEn).toMatch(/scenario assumption/);
  });

  it('con valor del usuario se rotula como tal', () => {
    const a = describeIpcAssumption({ ipcRate: 0.051 });
    expect(a.origen).toBe('usuario');
    expect(a.rate).toBe(0.051);
    expect(a.labelEs).toContain('5,1 %');
  });

  it('un valor no finito cae al supuesto rotulado, no a NaN', () => {
    expect(describeIpcAssumption({ ipcRate: Number.NaN }).origen).toBe('supuesto_escenario');
  });
});
