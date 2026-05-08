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

import type {
  PillarsResult,
  PillarMetrics,
  ExecutiveCard,
  ValorExecutiveCards,
  EscudoExecutiveCards,
  VerdadExecutiveCards,
  FuturoExecutiveCards,
} from '@/lib/pillars/types';
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

// ---------------------------------------------------------------------------
// buildCard — helper minimal para mock ExecutiveCards
// ---------------------------------------------------------------------------

function buildCard(
  fields: Omit<ExecutiveCard, 'deltaVsComparative' | 'descriptionEs' | 'descriptionEn' | 'formulaEs' | 'formulaEn'> & Partial<Pick<ExecutiveCard, 'deltaVsComparative' | 'descriptionEs' | 'descriptionEn' | 'formulaEs' | 'formulaEn'>>,
): ExecutiveCard {
  return {
    deltaVsComparative: null,
    descriptionEs: '',
    descriptionEn: '',
    formulaEs: '',
    formulaEn: '',
    ...fields,
  };
}

// ---------------------------------------------------------------------------
// Mock executive cards (modo demo)
// ---------------------------------------------------------------------------

const MOCK_VALOR_EXECUTIVE_CARDS: ValorExecutiveCards = {
  ebitda: buildCard({ key: 'ebitda', labelEs: 'EBITDA', labelEn: 'EBITDA', value: 2_228_000_000, unit: 'cop', color: 'blue', status: 'healthy', deltaVsComparative: 128_000_000 }),
  waoo: buildCard({ key: 'waoo', labelEs: 'Margen EBITDA', labelEn: 'EBITDA Margin', value: 0.186, unit: 'pct', color: 'orange', status: 'healthy', deltaVsComparative: 0.012 }),
  ratio: buildCard({ key: 'ratio', labelEs: 'Ratio Eficiencia', labelEn: 'Efficiency Ratio', value: 0.81, unit: 'ratio', color: 'purple', status: 'watch', deltaVsComparative: -0.02 }),
  fcf: buildCard({ key: 'fcf', labelEs: 'Flujo Libre de Caja', labelEn: 'Free Cash Flow', value: 850_000_000, unit: 'cop', color: 'green', status: 'healthy', deltaVsComparative: 50_000_000 }),
  audit: {
    utilidadNeta: 1_550_000_000,
    utilidadOperacional: 2_100_000_000,
    depreciaciones: 128_000_000,
    amortizaciones: 0,
    totalGastos: 2_800_000_000,
    totalCostos: 6_500_000_000,
    totalIngresos: 12_000_000_000,
    capex: 300_000_000,
    operatingCashFlow: 1_150_000_000,
  },
  generatedAt: NOW,
};

const MOCK_ESCUDO_EXECUTIVE_CARDS: EscudoExecutiveCards = {
  autonomia: buildCard({ key: 'autonomia', labelEs: 'Días de Autonomía', labelEn: 'Days of Runway', value: 95, unit: 'count', color: 'blue', status: 'healthy', deltaVsComparative: 5 }),
  cobertura_pasivos: buildCard({ key: 'cobertura_pasivos', labelEs: 'Cobertura de Pasivos', labelEn: 'Liabilities Coverage', value: 1.85, unit: 'ratio', color: 'orange', status: 'healthy', deltaVsComparative: 0.05 }),
  reserva_fiscal: buildCard({ key: 'reserva_fiscal', labelEs: 'Reserva Fiscal', labelEn: 'Fiscal Reserve', value: 30_000_000, unit: 'cop', color: 'purple', status: 'healthy', deltaVsComparative: null }),
  brecha_escudo: buildCard({ key: 'brecha_escudo', labelEs: 'Brecha Escudo', labelEn: 'Shield Gap', value: 200_000_000, unit: 'cop', color: 'green', status: 'watch', deltaVsComparative: -20_000_000 }),
  audit: {
    efectivoCuenta11: 1_600_000_000,
    inversionesTemporales12: 200_000_000,
    totalEgresosPeriodo: 9_650_000_000,
    promedioEgresosMensuales: 804_166_667,
    activoCorriente: 4_700_000_000,
    pasivoCorriente: 2_540_540_540,
    provisionCuenta24: 572_500_000,
    rentaTeorica: 542_500_000,
    proveedoresCuenta2205: 1_400_000_000,
    tasaRenta: 0.35,
    periodosUsados: 1,
  },
  generatedAt: NOW,
};

const MOCK_VERDAD_EXECUTIVE_CARDS: VerdadExecutiveCards = {
  ecuacion_maestra: buildCard({ key: 'ecuacion_maestra', labelEs: 'Ecuación Maestra', labelEn: 'Master Equation', value: 0, unit: 'cop', color: 'blue', status: 'healthy', deltaVsComparative: null }),
  consistencia: buildCard({ key: 'consistencia', labelEs: 'Índice de Consistencia', labelEn: 'Consistency Index', value: 92, unit: 'score', color: 'orange', status: 'healthy', deltaVsComparative: 2 }),
  anomalias: buildCard({ key: 'anomalias', labelEs: 'Anomalías de Clasificación', labelEn: 'Classification Anomalies', value: 1, unit: 'count', color: 'purple', status: 'watch', deltaVsComparative: -1 }),
  salud_contable: buildCard({ key: 'salud_contable', labelEs: 'Salud Contable', labelEn: 'Accounting Health', value: 2, unit: 'count', color: 'green', status: 'watch', deltaVsComparative: -1 }),
  audit: {
    equationGap: 0,
    saldosNegativosActivo: 0,
    saldosPositivosPasivo: 0,
    totalCuentasAnalizadas: 48,
    reclasificacionesR1: 1,
    discrepanciasPreprocessing: 0,
    findingsCriticos: 0,
    findingsAltos: 1,
    anomaliasVariacion: 1,
    margenBruto: 0.46,
    posibleOmisionCostos: false,
    forensicScore: 94,
    integridadTerceros: null,
  },
  generatedAt: NOW,
};

const MOCK_FUTURO_EXECUTIVE_CARDS: FuturoExecutiveCards = {
  cagr: buildCard({ key: 'cagr', labelEs: 'Crecimiento de Ingresos (CAGR)', labelEn: 'Revenue Growth (CAGR)', value: 0.12, unit: 'pct', color: 'blue', status: 'healthy', deltaVsComparative: null }),
  punto_quiebre: buildCard({ key: 'punto_quiebre', labelEs: 'Punto de Quiebre de Caja', labelEn: 'Cash Break-Even Point', value: null, unit: 'months', color: 'orange', status: 'healthy', deltaVsComparative: null }),
  provision_tributaria: buildCard({ key: 'provision_tributaria', labelEs: 'Provisión Tributaria Futura', labelEn: 'Future Tax Provision', value: 115_000_000, unit: 'cop', color: 'purple', status: 'healthy', deltaVsComparative: 10_000_000 }),
  capacidad_inversion: buildCard({ key: 'capacidad_inversion', labelEs: 'Capacidad de Inversión', labelEn: 'Investment Capacity', value: 300_000_000, unit: 'cop', color: 'green', status: 'watch', deltaVsComparative: null }),
  audit: {
    cagrIngresos: 0.12,
    periodosCagr: 2,
    ingresosActuales: 12_000_000_000,
    ingresosAnteriores: 10_714_285_714,
    mesesAlQuiebreConservador: null,
    mesesAlQuiebreBase: null,
    utilidadProyectadaAnual: 1_736_000_000,
    provisionTributariaFutura: 115_000_000,
    capacidadInversion: 300_000_000,
    reserva60Dias: 1_185_000_000,
    cajaProyectada36mBase: 4_480_000_000,
    tasaRenta: 0.35,
  },
  generatedAt: NOW,
};

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
    escudoCards: MOCK_ESCUDO_EXECUTIVE_CARDS,
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
    valorCards: MOCK_VALOR_EXECUTIVE_CARDS,
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
    verdadCards: MOCK_VERDAD_EXECUTIVE_CARDS,
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
    futuroCards: MOCK_FUTURO_EXECUTIVE_CARDS,
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
      capexAplicado: 0,
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
