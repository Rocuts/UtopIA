// IW4 (integración ola 2) — dependencias cruzadas de ratios-kpis-04/05/10/15 y
// auditoria-calidad-19 sobre los pilares:
//   - "Ingresos" = Σ clase 4 (bruto + devoluciones 4175 del mismo signo + 42)
//     seguía como denominador del Margen Neto Real, del Ratio Operativo, del
//     margen bruto de Verdad y de los audits que leen los validadores.
//   - sync-validator reconstruía el EBITDA como UN + saldo del pasivo 24 +
//     5160 + 5165 y la reserva/provisión fiscal con UN × 35 %: cualquier
//     tablero correcto salía "desincronizado".
//   - single-source-validator reconstruía la utilidad neta desde
//     rentaTeorica / 0,35 y utilidadProyectadaAnual / (1 + CAGR): con pérdida
//     ambos daban 0 y el bus de datos parecía roto.
//   - Un escaneo forense PARCIAL se leía como score de integridad.
//   - El puente P&G del Centro de Mando metía el grupo 42 dentro de "Ingresos".
import { describe, expect, it } from 'vitest';

import { makePnlSnapshot } from './_fixtures';
import { aggregatePillars } from '../service';
import { computeValorPillar } from '../valor';
import { computeValorExecutiveCards } from '../valor-cards';
import { computeFuturoExecutiveCards } from '../futuro-cards';
import { computeEscudoExecutiveCards } from '../escudo-cards';
import { computeVerdadExecutiveCards } from '../verdad-cards';
import { computeVerdadPillar } from '../verdad';
import { buildPnlBridge } from '../pnl-bridge';
import { validateDashboardIntegrity } from '../sync-validator';
import { validateCrossPillarCoherence } from '../single-source-validator';
import type { PeriodSnapshot } from '@/lib/preprocessing/trial-balance';
import type { ForensicSummary } from '../types';

// makePnlSnapshot: Σ clase 4 = 2.280M (4175 con el mismo signo que las ventas),
// ingresos netos = 2.120M, ingresos operacionales netos (41 − 4175) = 1.920M,
// clase 5 = 575M, clase 6 = 1.100M, clase 7 = 100M, UN = 345M.
const SNAP = makePnlSnapshot();

function withUtilidad(snapshot: PeriodSnapshot, utilidadNeta: number): PeriodSnapshot {
  return {
    ...snapshot,
    controlTotals: { ...snapshot.controlTotals, utilidadNeta },
    summary: { ...snapshot.summary, netIncome: utilidadNeta },
  };
}

describe('ratios-kpis-04 — ningún denominador de los pilares es la Σ de la clase 4', () => {
  it('Margen Neto Real = UN / ingresos netos (misma base que controlTotals.margenNeto)', () => {
    const valor = computeValorPillar({ snapshot: SNAP });
    const m = valor.kpis.find((k) => k.key === 'margen_neto_real')!;
    expect(m.value).toBeCloseTo(345 / 2_120, 10);
  });

  it('Ratio Operativo = (clase 5 + clase 6) / ingresos netos', () => {
    const cards = computeValorExecutiveCards({ snapshot: SNAP });
    expect(cards.ratio.value).toBeCloseTo((575 + 1_100) / 2_120, 10);
    expect(cards.audit.totalIngresos).toBe(2_120_000_000);
    expect(cards.ratio.formulaEs).not.toMatch(/Ingresos Clase 4/);
  });

  it('el audit de Futuro expone los ingresos netos que usa el CAGR', () => {
    const cards = computeFuturoExecutiveCards({ snapshot: SNAP });
    expect(cards.audit.ingresosActuales).toBe(2_120_000_000);
  });

  it('margen bruto de Verdad = (41 − 4175 − clases 6 y 7) / (41 − 4175)', () => {
    const cards = computeVerdadExecutiveCards({ snapshot: SNAP });
    expect(cards.audit.margenBruto).toBeCloseTo((1_920 - 1_200) / 1_920, 10);
  });

  it('sin grupo 41 identificable el margen bruto es N/D (no Σ clase 4)', () => {
    const sin41: PeriodSnapshot = {
      ...SNAP,
      classes: SNAP.classes.map((c) =>
        c.code === 4
          ? { ...c, accounts: c.accounts.filter((a) => a.code.startsWith('42')) }
          : c,
      ),
    };
    const cards = computeVerdadExecutiveCards({ snapshot: sin41 });
    expect(cards.audit.margenBruto).toBeNull();
    expect(cards.audit.posibleOmisionCostos).toBe(false);
  });

  it('el puente P&G parte de los ingresos operacionales, separa el 42 y cierra en la UN', () => {
    const bridge = buildPnlBridge(SNAP)!;
    expect(bridge).not.toBeNull();
    expect(bridge.ingresos).toBe(1_920_000_000);
    expect(bridge.otrosIngresos).toBe(200_000_000);
    const cierre =
      bridge.ingresos +
      (bridge.otrosIngresos ?? 0) -
      bridge.costos -
      bridge.gastosOperacionales -
      bridge.gastosFinancieros -
      bridge.impuestos;
    expect(cierre).toBe(bridge.utilidadNeta);
    expect(bridge.utilidadNeta).toBe(345_000_000);
  });
});

describe('sync-validator — mismas funciones que las tarjetas (ratios-kpis-05/10/15)', () => {
  it('un tablero calculado por los pilares no reporta desincronización', () => {
    const pillars = aggregatePillars({ snapshot: SNAP });
    const report = validateDashboardIntegrity(pillars, SNAP);
    const codes = report.findings.map((f) => f.code);
    expect(codes).not.toContain('EBITDA_DRIFT');
    expect(codes).not.toContain('WAOO_DRIFT');
    expect(codes).not.toContain('RATIO_DRIFT');
    expect(codes).not.toContain('COBERTURA_DRIFT');
    expect(codes).not.toContain('AUTONOMIA_DRIFT');
    expect(codes).not.toContain('MARGEN_NIIF_DRIFT');
  });

  it('el EBITDA esperado es computeEbitda (EBIT operacional + D&A), no UN + pasivo 24', () => {
    const pillars = aggregatePillars({ snapshot: SNAP });
    const cards = pillars.valor.valorCards!;
    const tampered = {
      ...pillars,
      valor: {
        ...pillars.valor,
        valorCards: { ...cards, ebitda: { ...cards.ebitda, value: 500_000_000 } },
      },
    };
    const f = validateDashboardIntegrity(tampered, SNAP).findings.find(
      (x) => x.code === 'EBITDA_DRIFT',
    )!;
    expect(f).toBeDefined();
    expect(f.expected).toBe(340_000_000);
  });

  it('no publica expectativas fiscales heurísticas (UN × 35 %)', () => {
    const pillars = aggregatePillars({ snapshot: SNAP });
    const escudo = pillars.escudo.escudoCards!;
    const futuro = pillars.futuro.futuroCards!;
    // Aunque una tarjeta fiscal mostrara la cifra heurística, el validador ya
    // no la "confirma" ni la exige: la métrica es N/D por política.
    const tampered = {
      ...pillars,
      escudo: {
        ...pillars.escudo,
        escudoCards: {
          ...escudo,
          reserva_fiscal: { ...escudo.reserva_fiscal, value: 135_000_000 - 345_000_000 * 0.35 },
        },
      },
      futuro: {
        ...pillars.futuro,
        futuroCards: {
          ...futuro,
          provision_tributaria: { ...futuro.provision_tributaria, value: 1 },
        },
      },
    };
    const codes = validateDashboardIntegrity(tampered, SNAP).findings.map((f) => f.code);
    expect(codes).not.toContain('PROVISION_TRIBUTARIA_DRIFT');
    expect(codes).not.toContain('RESERVA_FISCAL_DRIFT');
    expect(codes).not.toContain('CAPACIDAD_INVERSION_DRIFT');
  });
});

describe('single-source-validator — utilidad neta leída, no reconstruida (ratios-kpis-10)', () => {
  it('con pérdida los pilares siguen leyendo la misma utilidad neta', () => {
    const perdida = withUtilidad(SNAP, -120_000_000);
    const pillars = aggregatePillars({ snapshot: perdida });
    const report = validateCrossPillarCoherence(pillars, perdida);
    expect(report.findings.map((f) => f.code)).not.toContain('UTILIDAD_NETA_INCOHERENT');
  });

  it('una utilidad distinta en un audit sí se detecta', () => {
    const pillars = aggregatePillars({ snapshot: SNAP });
    const escudo = pillars.escudo.escudoCards!;
    const tampered = {
      ...pillars,
      escudo: {
        ...pillars.escudo,
        escudoCards: { ...escudo, audit: { ...escudo.audit, utilidadNeta: 100_000_000 } },
      },
    };
    const report = validateCrossPillarCoherence(tampered, SNAP);
    expect(report.findings.map((f) => f.code)).toContain('UTILIDAD_NETA_INCOHERENT');
  });

  it('los audits de Escudo y Futuro ya no publican diagnósticos con UN × 35 %', () => {
    const escudo = computeEscudoExecutiveCards({ snapshot: SNAP });
    const futuro = computeFuturoExecutiveCards({ snapshot: SNAP });
    expect(escudo.audit.utilidadNeta).toBe(345_000_000);
    expect(futuro.audit.utilidadNeta).toBe(345_000_000);
    expect(escudo.audit.rentaTeorica).toBeUndefined();
    expect(futuro.audit.utilidadProyectadaAnual).toBeUndefined();
  });

  it('los ingresos inter-pilar se comparan sobre la misma base (ingresos netos)', () => {
    const pillars = aggregatePillars({ snapshot: SNAP });
    const report = validateCrossPillarCoherence(pillars, SNAP);
    expect(report.findings.map((f) => f.code)).not.toContain('INGRESOS_INCOHERENT');
  });
});

describe('auditoria-calidad-19 — un escaneo forense parcial no es un score de integridad', () => {
  const parcial: ForensicSummary = {
    score: 100,
    totalAnomalies: 0,
    bySeverity: { low: 0, medium: 0, high: 0 },
    coverage: 'parcial',
  };

  it('tarjetas de Verdad: forensicScore = null con cobertura parcial', () => {
    const cards = computeVerdadExecutiveCards({ snapshot: SNAP, forensic: parcial });
    expect(cards.audit.forensicScore).toBeNull();
    const completa = computeVerdadExecutiveCards({
      snapshot: SNAP,
      forensic: { ...parcial, score: 88, coverage: 'completa' },
    });
    expect(completa.audit.forensicScore).toBe(88);
  });

  it('pilar Verdad: el 100 de un escaneo parcial no se publica como "Score de Integridad"', () => {
    const verdad = computeVerdadPillar({ snapshot: SNAP, forensic: parcial });
    const k = verdad.kpis.find((x) => x.key === 'score_integridad')!;
    expect(k.value).toBeNull(); // sin Curator en el fixture ⇒ N/D
    expect(k.descriptionEs).not.toMatch(/Limpieza forense/);
    expect(k.descriptionEs).toMatch(/parcial/);
  });
});
