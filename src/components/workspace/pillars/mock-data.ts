// ---------------------------------------------------------------------------
// Mock data para los micro-dashboards de Vista Dueño v2.
// ---------------------------------------------------------------------------
// Cuando el workspace todavía no ha subido un TB (preprocessed=null), estos
// helpers permiten renderizar la estructura visual con datos plausibles —
// el dashboard nunca aparece "vacío", siempre comunica el formato.
//
// Para datos reales, los componentes consumen las props directas y este
// módulo no se invoca.
// ---------------------------------------------------------------------------

import type { PillarsResult, PillarMetrics } from '@/lib/pillars/types';
import type { ValorBarSeries } from '@/lib/pillars/valor-bars';
import type { EscudoBarSeries } from '@/lib/pillars/escudo-bars';
import type { VerdadBarSeries } from '@/lib/pillars/verdad-bars';
import type { FuturoBarSeries } from '@/lib/pillars/futuro-bars';
import type {
  PnLWaterfallData,
  DuPontSegment,
  CashInflectionPoint,
  RunwayMonth,
} from '@/components/charts';

const NOW = new Date().toISOString();

function mkKpi(
  key: string,
  labelEs: string,
  labelEn: string,
  value: number | null,
  unit: 'cop' | 'pct' | 'days' | 'months' | 'ratio' | 'count' | 'score',
  score: number,
) {
  const status: PillarMetrics['status'] =
    score >= 90 ? 'healthy' : score >= 60 ? 'watch' : score >= 30 ? 'warning' : 'critical';
  const severity = status === 'healthy' ? 'success' : status === 'critical' ? 'danger' : 'warning';
  return { key, labelEs, labelEn, value, unit, score, status, severity, descriptionEs: '', descriptionEn: '' } as const;
}

export const MOCK_PILLARS: PillarsResult = {
  escudo: {
    pillarId: 'escudo',
    healthScore: 72,
    status: 'watch',
    kpis: [
      mkKpi('dias_autonomia', 'Días de Autonomía', 'Days of Runway', 65, 'days', 75),
      mkKpi('solvencia_real', 'Solvencia Real', 'Real Solvency', 1.4, 'ratio', 75),
      mkKpi('cobertura_fiscal', 'Cobertura de Riesgo Fiscal', 'Tax Risk Coverage', 0.65, 'ratio', 75),
    ],
    alerts: [],
    generatedAt: NOW,
  },
  valor: {
    pillarId: 'valor',
    healthScore: 88,
    status: 'watch',
    kpis: [
      mkKpi('margen_neto_real', 'Margen Neto Real', 'Real Net Margin', 0.18, 'pct', 95),
      mkKpi('roe_dinamico', 'ROE Dinámico', 'Dynamic ROE', 0.22, 'pct', 95),
      mkKpi('eva', 'EVA', 'EVA', 1_200_000_000, 'cop', 75),
    ],
    alerts: [],
    generatedAt: NOW,
  },
  verdad: {
    pillarId: 'verdad',
    healthScore: 91,
    status: 'healthy',
    kpis: [
      mkKpi('score_integridad', 'Score de Integridad', 'Integrity Score', 92, 'score', 95),
      mkKpi('brecha_cuadratura', 'Brecha de Cuadratura', 'Equation Gap', 0.0001, 'pct', 95),
      mkKpi('indice_conciliacion', 'Índice de Conciliación', 'Reconciliation Index', 0.87, 'pct', 95),
    ],
    alerts: [],
    generatedAt: NOW,
  },
  futuro: {
    pillarId: 'futuro',
    healthScore: 78,
    status: 'watch',
    kpis: [
      mkKpi('runway_caja', 'Runway de Caja', 'Cash Runway', 28, 'months', 95),
      mkKpi('capex_capacity', 'Capacidad de Inversión', 'Investment Capacity', 850_000_000, 'cop', 75),
      mkKpi('punto_inflexion', 'Punto de Inflexión', 'Inflection Point', null, 'months', 95),
    ],
    alerts: [],
    generatedAt: NOW,
  },
  overallScore: 82,
  overallStatus: 'watch',
  generatedAt: NOW,
};

export const MOCK_PNL_WATERFALL: PnLWaterfallData = {
  ingresos: 12_000_000_000,
  costos: 6_500_000_000,
  gastosOperacionales: 2_800_000_000,
  gastosFinancieros: 350_000_000,
  impuestos: 800_000_000,
  utilidadNeta: 1_550_000_000,
};

export const MOCK_DUPONT_SEGMENTS: DuPontSegment[] = [
  { name: 'Línea Premium', roe: 0.28, rotacionActivos: 1.6, ventas: 5_400_000_000 },
  { name: 'Línea Estándar', roe: 0.18, rotacionActivos: 2.1, ventas: 4_200_000_000 },
  { name: 'Servicios', roe: 0.12, rotacionActivos: 0.9, ventas: 1_600_000_000 },
  { name: 'Distribución', roe: 0.08, rotacionActivos: 0.4, ventas: 800_000_000 },
];

export const MOCK_INFLECTION_SERIES: CashInflectionPoint[] = (() => {
  const out: CashInflectionPoint[] = [];
  let cashBase = 1_500_000_000;
  let cashCons = 1_500_000_000;
  let cashAgr = 1_500_000_000;
  for (let i = 0; i <= 12; i++) {
    out.push({
      date: monthLabel(i),
      base: cashBase,
      conservador: cashCons,
      agresivo: cashAgr,
      salidasFiscales: 200_000_000,
    });
    cashBase += 100_000_000;
    cashCons -= 50_000_000;
    cashAgr += 250_000_000;
  }
  return out;
})();

export const MOCK_RUNWAY: RunwayMonth[] = (() => {
  const out: RunwayMonth[] = [];
  let base = 1_500_000_000;
  let cons = 1_500_000_000;
  let agr = 1_500_000_000;
  for (let i = 0; i < 36; i++) {
    out.push({ month: monthLabel(i), base, conservador: cons, agresivo: agr });
    base += 80_000_000;
    cons -= 40_000_000;
    agr += 200_000_000;
  }
  return out;
})();

export const MOCK_VALOR_TREND: ValorBarSeries[] = [
  { label: '2023', ebitda: 1_800_000_000, fcf: null,          ingresos: 10_500_000_000, period: '2023', isInterpolated: false },
  { label: '2024', ebitda: 2_100_000_000, fcf: 850_000_000,   ingresos: 11_200_000_000, period: '2024', isInterpolated: false },
  { label: '2025', ebitda: 2_450_000_000, fcf: 1_100_000_000, ingresos: 12_000_000_000, period: '2025', isInterpolated: false },
  { label: '2026', ebitda: 2_800_000_000, fcf: 1_400_000_000, ingresos: 13_500_000_000, period: '2026', isInterpolated: false },
];

export const MOCK_ESCUDO_TREND: EscudoBarSeries[] = [
  { label: '2023', period: '2023', efectivo:   800_000_000, activoCorriente: 3_200_000_000, pasivoCorriente: 2_100_000_000, solvencia: 1.52, isInterpolated: false },
  { label: '2024', period: '2024', efectivo: 1_050_000_000, activoCorriente: 3_800_000_000, pasivoCorriente: 2_400_000_000, solvencia: 1.58, isInterpolated: false },
  { label: '2025', period: '2025', efectivo: 1_300_000_000, activoCorriente: 4_200_000_000, pasivoCorriente: 2_600_000_000, solvencia: 1.62, isInterpolated: false },
  { label: '2026', period: '2026', efectivo: 1_600_000_000, activoCorriente: 4_700_000_000, pasivoCorriente: 2_900_000_000, solvencia: 1.62, isInterpolated: false },
];

export const MOCK_VERDAD_TREND: VerdadBarSeries[] = [
  { label: '2023', period: '2023', errores: 8,  descalces: 1, anomalias: 3, isInterpolated: false },
  { label: '2024', period: '2024', errores: 5,  descalces: 0, anomalias: 2, isInterpolated: false },
  { label: '2025', period: '2025', errores: 3,  descalces: 0, anomalias: 1, isInterpolated: false },
  { label: '2026', period: '2026', errores: 1,  descalces: 0, anomalias: 0, isInterpolated: false },
];

export const MOCK_FUTURO_TREND: FuturoBarSeries[] = (() => {
  const out: FuturoBarSeries[] = [];
  // Caja inicial: $2.000M — base decrece levemente, conservadora cruza 0 en
  // mes 8, agresiva sube sostenidamente.
  let base = 2_000_000_000;
  let cons = 2_000_000_000;
  let agr = 2_000_000_000;
  const INGRESO_MES = 1_000_000_000;
  const EGRESO_MES = 1_050_000_000; // egresos ligeramente mayores → base decrece
  for (let m = 1; m <= 12; m++) {
    base = base + INGRESO_MES * 1.0 - EGRESO_MES;
    cons = cons + INGRESO_MES * 0.85 - EGRESO_MES;
    agr = agr + INGRESO_MES * 1.1 - EGRESO_MES;
    out.push({
      label: `M+${m}`,
      monthIndex: m,
      cajaBase: Math.round(base),
      cajaConservadora: Math.round(cons),
      cajaAgresiva: Math.round(agr),
    });
  }
  return out;
})();

function monthLabel(offset: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return d.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
}
