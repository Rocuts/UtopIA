// ---------------------------------------------------------------------------
// Pillars Service — tipos públicos
// ---------------------------------------------------------------------------
// Agregador de KPIs ricos por los 4 Pilares (Escudo / Valor / Verdad / Futuro)
// con Health Score 0-100. Coexiste con `src/lib/kpis/pillar-view.ts` (queries
// SQL raw que alimentan el AreaCard grid del ExecutiveDashboard) — este módulo
// va un nivel arriba: 3 KPIs por pilar + alerts + score consolidado.
//
// Inputs principales:
//   - PeriodSnapshot del periodo actual (curator ya inyectado).
//   - Opcionales: comparative snapshot, ForensicScanResult, banking conciliation,
//                 history multi-período para proyecciones.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot } from '@/lib/preprocessing/trial-balance';
import type { CuratorResult, PresumedCostWarning } from '@/lib/preprocessing/curator-rules/types';

// ─── Status & severity ─────────────────────────────────────────────────────

export type PillarStatus = 'healthy' | 'watch' | 'warning' | 'critical';
export type PillarSeverity = 'success' | 'warning' | 'danger' | 'neutral';
export type PillarId = 'escudo' | 'valor' | 'verdad' | 'futuro';

// ─── KPI ────────────────────────────────────────────────────────────────────

export type KpiUnit = 'cop' | 'pct' | 'days' | 'months' | 'ratio' | 'count' | 'score';

export interface PillarKpi {
  /** Identificador estable para drill-down y tests. */
  key: string;
  /** Etiqueta es. */
  labelEs: string;
  /** Etiqueta en. */
  labelEn: string;
  /** Valor crudo del KPI. `null` cuando no se puede calcular. */
  value: number | null;
  /** Unidad para formateo en UI. */
  unit: KpiUnit;
  /** Target o umbral healthy de referencia (opcional). */
  target?: number;
  /** Score parcial 0-100 que aporta este KPI al pilar. `null` = sin dato
   *  (no aporta al health score). */
  score: number | null;
  status: PillarStatus;
  severity: PillarSeverity;
  /** Descripción corta, accionable. */
  descriptionEs: string;
  descriptionEn: string;
}

// ─── Alertas dentro de un pilar ────────────────────────────────────────────

export interface PillarAlert {
  /** Código corto (e.g. 'SHIELD-LIQ-LOW'). */
  code: string;
  severity: PillarSeverity;
  titleEs: string;
  titleEn: string;
  messageEs: string;
  messageEn: string;
}

// ─── Métrica consolidada por pilar ─────────────────────────────────────────

export interface PillarMetrics {
  pillarId: PillarId;
  /** 0-100. */
  healthScore: number;
  status: PillarStatus;
  /** 3 KPIs maestros del pilar. */
  kpis: PillarKpi[];
  /** Alertas activas (pueden ser 0 si todo está sano). */
  alerts: PillarAlert[];
  /** Errores capturados durante el cómputo (no rompen el pilar). */
  errors?: Record<string, string>;
  /** KPIs con valor sobre el total: el health score sólo promedia los medidos
   *  (ratios-kpis-25). Un pilar con available < total está incompleto. */
  kpiCoverage?: { available: number; total: number };
  generatedAt: string;
  /** Advertencia R7 (Curator) sobre costo de ventas posiblemente subestimado. */
  presumedCostWarning?: PresumedCostWarning;
  /** 4 tarjetas ejecutivas (sólo pilar Valor): EBITDA / Margen / Ratio / FCF. */
  valorCards?: ValorExecutiveCards;
  /** 4 tarjetas ejecutivas (sólo pilar Escudo): Autonomía / Cobertura / Reserva Fiscal / Brecha. */
  escudoCards?: EscudoExecutiveCards;
  /** 4 tarjetas ejecutivas (sólo pilar Verdad): Ecuación Maestra / Consistencia / Anomalías / Salud. */
  verdadCards?: VerdadExecutiveCards;
  /** 4 tarjetas ejecutivas (sólo pilar Futuro): CAGR / Punto Quiebre / Prov. Tributaria / Capacidad Inv. */
  futuroCards?: FuturoExecutiveCards;
}

// ─── Tarjetas ejecutivas (Pilar Valor) ─────────────────────────────────────

export type ExecutiveCardColor = 'blue' | 'orange' | 'purple' | 'green';
export type ExecutiveCardKey =
  // Pilar Valor
  | 'ebitda' | 'waoo' | 'ratio' | 'fcf'
  // Pilar Escudo
  | 'autonomia' | 'cobertura_pasivos' | 'reserva_fiscal' | 'brecha_escudo'
  // Pilar Verdad
  | 'ecuacion_maestra' | 'consistencia' | 'anomalias' | 'salud_contable'
  // Pilar Futuro
  | 'cagr' | 'punto_quiebre' | 'provision_tributaria' | 'capacidad_inversion';

export interface ExecutiveCard {
  key: ExecutiveCardKey;
  labelEs: string;
  labelEn: string;
  /** Valor numérico crudo. `null` cuando no es calculable
   *  (ej. FCF sin periodo comparativo). */
  value: number | null;
  /** Unidad para formateo en UI:
   *  - cop: pesos colombianos abreviados ($1,2B / $1,2M).
   *  - pct: porcentaje (multiplica por 100, sufijo %).
   *  - ratio: número crudo (toFixed(2)).
   *  - count: entero sin decimales (errores, anomalías).
   *  - score: 0-100 sufijo /100.
   *  - months: meses (entero, sufijo "meses"/"months"). */
  unit: 'cop' | 'pct' | 'ratio' | 'count' | 'score' | 'months';
  color: ExecutiveCardColor;
  status: PillarStatus;
  /** Variación vs periodo anterior, mismo unit. `null` si no hay comparativo. */
  deltaVsComparative: number | null;
  descriptionEs: string;
  descriptionEn: string;
  /** Pasos del cálculo (texto humano para tooltip + auditor). */
  formulaEs: string;
  formulaEn: string;
}

export interface ValorExecutiveCardsAudit {
  /** Utilidad neta del periodo (espejo de controlTotals.utilidadNeta).
   *  Expuesto explícitamente para que `single-source-validator` compare
   *  directamente sin re-derivar desde utilidadOperacional (FIX audit B1). */
  utilidadNeta: number;
  /** Utilidad operacional (EBIT) de `computeEbitda`: 41 − 4175 − clases 6/7 −
   *  grupos 51/52. `null` sin desglose del grupo 41. */
  utilidadOperacional: number | null;
  /** Depreciaciones del periodo (5160 + 5260 + 7360). */
  depreciaciones: number;
  /** Amortizaciones del periodo (5165 + 5265 + 7365). */
  amortizaciones: number;
  /** Total Clase 5 (Gastos Operacionales). */
  totalGastos: number;
  /** Total Clase 6 (Costos de Ventas). */
  totalCostos: number;
  /** Ingresos netos del periodo (clase 4 − devoluciones 4175; base de la
   *  utilidad neta y denominador del Ratio Operativo). No es la Σ bruta de la
   *  clase 4 (ratios-kpis-04). */
  totalIngresos: number;
  /** Var. PPE (Clase 15) — proxy de CapEx, del EFE indirecto NIC 7. */
  capex: number | null;
  /** Flujo operativo (operating.total del EFE). */
  operatingCashFlow: number | null;
}

export interface ValorExecutiveCards {
  ebitda: ExecutiveCard;
  /** Margen EBITDA (a.k.a. WAOO en el contrato visual). */
  waoo: ExecutiveCard;
  /** Ratio de eficiencia (Gastos+Costos)/Ingresos. */
  ratio: ExecutiveCard;
  /** Free Cash Flow = Operating − CapEx. */
  fcf: ExecutiveCard;
  audit: ValorExecutiveCardsAudit;
  generatedAt: string;
}

// ─── Tarjetas ejecutivas (Pilar Escudo) ────────────────────────────────────

export interface EscudoExecutiveCardsAudit {
  /** Suma cuentas Clase 1 grupo 11 (Disponible / efectivo y equivalentes). */
  efectivoCuenta11: number;
  /** Suma cuentas Clase 1 grupo 12 (Inversiones temporales). */
  inversionesTemporales12: number;
  /** Total Clase 5+6+7 — gastos + costos del periodo. */
  totalEgresosPeriodo: number;
  /** Promedio mensual de egresos (totalEgresosPeriodo / 12 si anual,
   *  o promedio de los últimos N meses si multi-período). */
  promedioEgresosMensuales: number;
  /** Activo corriente de controlTotals (misma base que computeDerivedKpis). */
  activoCorriente: number;
  /** Pasivo corriente de controlTotals. */
  pasivoCorriente: number;
  /** Inventarios PUC 14 (se restan en la prueba ácida). */
  inventarios14?: number;
  /** Provisión registrada en cuenta 24 (Impuestos por Pagar). */
  provisionCuenta24: number;
  /** Utilidad neta del periodo que leyó el pilar (controlTotals.utilidadNeta).
   *  single-source-validator la compara directamente (ratios-kpis-10). */
  utilidadNeta?: number;
  /** @deprecated Retirado (ratios-kpis-10): era utilidadNeta × 35 %, una
   *  métrica fiscal heurística. Ya no se produce; se conserva opcional sólo
   *  por compatibilidad de lectura. */
  rentaTeorica?: number;
  /** Saldo de cuenta 2205 (Proveedores) — proxy de exigible 30 días. */
  proveedoresCuenta2205: number;
  /** @deprecated Retirado (ratios-kpis-10); ya no se produce. */
  tasaRenta?: number;
  /** Cantidad de períodos usados para promedio (1 = anual, 3 = trimestre). */
  periodosUsados: number;
  /** Suma COP de eventos CapEx en los próximos 6 meses (monthOffset ≤ 6).
   *  Presente sólo cuando el input incluye capexEvents. */
  proyectosFuturoCop?: number;
  /** Cantidad de eventos CapEx con monthOffset ≤ 6. */
  cantidadEventosProximos?: number;
}

export interface EscudoExecutiveCards {
  /** Días de Autonomía Financiera = (caja + inversiones12) / promEgresosMes. */
  autonomia: ExecutiveCard;
  /** Prueba ácida = (Activo corriente − Inventarios 14) / Pasivo corriente. */
  cobertura_pasivos: ExecutiveCard;
  /** Reserva Fiscal: N/D sin base fiscal verificada (ratios-kpis-10). */
  reserva_fiscal: ExecutiveCard;
  /** Brecha Escudo = Caja(11) − Proveedores(2205) en COP (negativo = riesgo). */
  brecha_escudo: ExecutiveCard;
  audit: EscudoExecutiveCardsAudit;
  generatedAt: string;
}

// ─── Tarjetas ejecutivas (Pilar Verdad) ────────────────────────────────────

export interface VerdadExecutiveCardsAudit {
  /** Activo − Pasivo − Patrimonio (en COP, signo preservado). */
  equationGap: number;
  /** Cuentas de activo con saldo contrario a su naturaleza (activo con saldo
   *  crédito, o correctora — 1592, 1399… — con saldo débito). */
  saldosContrariosActivo: number;
  /** Cuentas de pasivo con saldo débito (magnitud negativa). */
  saldosContrariosPasivo: number;
  /** Cuentas de patrimonio con saldo contrario (crédito negativo, o pérdidas /
   *  capital por suscribir con saldo crédito). */
  saldosContrariosPatrimonio: number;
  /** Total de cuentas analizadas en la integridad de saldos. */
  totalCuentasAnalizadas: number;
  /** Reclasificaciones aplicadas por R1 (Curator). */
  reclasificacionesR1: number;
  /** Total de discrepancias del preprocessing. */
  discrepanciasPreprocessing: number;
  /** Findings 'critico' del Curator. */
  findingsCriticos: number;
  /** Findings 'alto' del Curator. */
  findingsAltos: number;
  /** Cuentas con variación absoluta >500% vs comparativo. */
  anomaliasVariacion: number;
  /** Margen bruto observado (Ingresos − Costos) / Ingresos. */
  margenBruto: number | null;
  /** Bandera margen bruto >95% (proxy de costos no registrados). */
  posibleOmisionCostos: boolean;
  /** Score forensic externo (si disponible). */
  forensicScore: number | null;
  /** % terceros con NIT válido (0-1). null = sin dato ⇒ el índice de
   *  consistencia excluye el componente. */
  integridadTerceros: number | null;
}

export interface VerdadExecutiveCards {
  /** Ecuación Maestra = activo − pasivo − patrimonio (COP, 0 = sincronizado). */
  ecuacion_maestra: ExecutiveCard;
  /** Índice de Consistencia 0-100 (saldos signo + cuadratura + terceros). */
  consistencia: ExecutiveCard;
  /** # de Anomalías de Clasificación detectadas (count). */
  anomalias: ExecutiveCard;
  /** # de Errores de Salud Contable acumulados (count, lower-better). */
  salud_contable: ExecutiveCard;
  audit: VerdadExecutiveCardsAudit;
  generatedAt: string;
}

// ─── Tarjetas ejecutivas (Pilar Futuro) ────────────────────────────────────

export interface FuturoExecutiveCardsAudit {
  /** Tasa CAGR de ingresos. Null si no hay periodo comparativo. */
  cagrIngresos: number | null;
  /** # períodos usados para el CAGR (2 si hay current+comparative; null si no). */
  periodosCagr: number | null;
  /** Ingresos netos del periodo actual (misma base que el CAGR). */
  ingresosActuales: number;
  /** Ingresos del periodo anterior (null si no hay comparative). */
  ingresosAnteriores: number | null;
  /** Mes donde el escenario conservador (factor 0.85) cruza 0 en caja proyectada
   *  a 36 meses. `null` si nunca cruza dentro del horizonte. */
  mesesAlQuiebreConservador: number | null;
  /** Mes donde el escenario base (factor 1.0) cruza 0. */
  mesesAlQuiebreBase: number | null;
  /** Utilidad neta del periodo que leyó el pilar (controlTotals.utilidadNeta).
   *  single-source-validator la compara directamente (ratios-kpis-10). */
  utilidadNeta?: number;
  /** @deprecated Retirado (ratios-kpis-10): era max(0, UN) × (1 + CAGR ?? 5 %),
   *  insumo de una provisión fiscal heurística. Ya no se produce. */
  utilidadProyectadaAnual?: number;
  /** Provisión tributaria proyectada: null sin base fiscal verificada. */
  provisionTributariaFutura: number | null;
  /** Capacidad de inversión (shared-metrics.capacidadInversion): null sin base
   *  fiscal verificada. */
  capacidadInversion: number | null;
  /** Reserva 60 días de gastos en COP. */
  reserva60Dias: number;
  /** Caja proyectada al final del horizonte (escenario base). */
  cajaProyectada36mBase: number;
  /** @deprecated Retirado (ratios-kpis-10); ya no se produce. */
  tasaRenta?: number;
}

export interface FuturoExecutiveCards {
  /** CAGR de ingresos (proyección lineal, % anual). */
  cagr: ExecutiveCard;
  /** Mes hasta el punto de quiebre de caja (escenario conservador, lower-NOT-better visualmente). */
  punto_quiebre: ExecutiveCard;
  /** Provisión tributaria proyectada para el próximo año (COP). */
  provision_tributaria: ExecutiveCard;
  /** Capacidad de inversión: caja libre tras provisionar renta y reserva 60d (COP). */
  capacidad_inversion: ExecutiveCard;
  audit: FuturoExecutiveCardsAudit;
  generatedAt: string;
}

// ─── Resultado consolidado de los 4 pilares ────────────────────────────────

export interface PillarsResult {
  escudo: PillarMetrics;
  valor: PillarMetrics;
  verdad: PillarMetrics;
  futuro: PillarMetrics;
  /** Promedio simple de los 4 health scores. */
  overallScore: number;
  /** Status agregado del overallScore. */
  overallStatus: PillarStatus;
  generatedAt: string;
}

// ─── Inputs auxiliares ─────────────────────────────────────────────────────

/** Mínimo subset de ForensicScanResult que el pilar Verdad necesita. */
export interface ForensicSummary {
  score: number;
  totalAnomalies: number;
  bySeverity: { low: number; medium: number; high: number };
  /** Cobertura del escaneo (ForensicScanResult.coverage). 'parcial' = alguna
   *  regla no se pudo evaluar: el score NO es un score de integridad
   *  (auditoria-calidad-19). Ausente = resumen legado sin el dato. */
  coverage?: 'completa' | 'parcial';
}

/** Mínimo subset del estado de conciliación bancaria. */
export interface ConciliationSummary {
  /** Total de movimientos (facturas/pagos) considerados. */
  totalEntries: number;
  /** Cuántos están conciliados (cruzados con banco). */
  reconciledEntries: number;
}

export interface PillarsAggregateInput {
  /** Snapshot del periodo actual. Curator ya debe estar inyectado. */
  snapshot: PeriodSnapshot;
  /** Snapshot del periodo anterior, si está disponible. */
  comparative?: PeriodSnapshot | null;
  /** Forensic summary, si la última ejecución forense terminó. */
  forensic?: ForensicSummary | null;
  /** Estado de conciliación bancaria, si WS3 corrió. */
  conciliation?: ConciliationSummary | null;
  /** Curator result explícito (si el snapshot ya lo tiene como `curator`,
   *  este campo no es necesario — es para inyección manual en tests). */
  curator?: CuratorResult | null;
  /** Costo de oportunidad para EVA. Default 0.12 (TES Colombia + risk premium). */
  costoOportunidad?: number;
  /** Variables macroeconómicas oficiales con procedencia por campo. Ningún
   *  pilar las consume hoy; si se usan, un campo null es N/D (sin defaults). */
  macro?: MacroFactors | null;
  /** Eventos CapEx personalizados del usuario (compras, inversiones, deudas
   *  proyectadas). Afectan tanto FUTURO (caja proyectada) como ESCUDO
   *  (días de autonomía si suceden en los próximos 6 meses). */
  capexEvents?: CapexEventInput[] | null;
  /** Resultado de Monte Carlo precomputado (si se ejecutó upstream). */
  monteCarlo?: MonteCarloResult | null;
}

// ─── Macroeconomía oficial (BanRep/DANE) ───────────────────────────────────

/** Fuente oficial de un indicador macro. */
export type MacroSource = 'superfinanciera' | 'banrep' | 'dane';

/**
 * Indicador macro con procedencia (auditoría valoracion-04). `value: null` ⇒
 * sin dato verificado (`reason`); nunca se rellena con una constante.
 */
export interface MacroIndicator {
  /** Decimal para tasas (0,0624 = 6,24 %); COP por USD para la TRM. */
  value: number | null;
  source: MacroSource | null;
  /** Fecha de vigencia / periodo del dato (YYYY-MM-DD o YYYY-MM). */
  asOf: string | null;
  /** Fecha ISO en que se consultó la fuente. */
  fetchedAt: string | null;
  /** true = último valor bueno de una consulta anterior (la actual falló). */
  stale: boolean;
  /** Motivo cuando `value` es null (o por qué es stale). */
  reason: string | null;
}

export interface MacroFactors {
  /** IPC anual Colombia (DANE). */
  ipc: MacroIndicator;
  /** TRM USD/COP (Superintendencia Financiera). */
  trm: MacroIndicator;
  /** Tasa de intervención de política monetaria (BanRep). */
  tasaBanRep: MacroIndicator;
  /** Fecha ISO de la consulta/lectura del servicio (no es la vigencia). */
  fechaActualizacion: string;
  /** La procedencia es por campo (ver cada MacroIndicator). */
  fuente: 'por-campo';
}

// ─── Monte Carlo ───────────────────────────────────────────────────────────

/** Input mínimo de un evento CapEx para alimentar pilares.
 *  Idéntico a `CapexEvent` de futuro-bars.ts pero re-declarado aquí para
 *  evitar dependencia circular pillars↔futuro-bars. */
export interface CapexEventInput {
  id: string;
  name: string;
  monthOffset: number;
  amountCop: number;
}

export interface MonteCarloOptions {
  /** Número de simulaciones. Default 9600. */
  iterations?: number;
  /** Horizonte en meses. Default 12. */
  horizonMonths?: number;
  /** Volatilidad mensual (sigma) sobre los ingresos. Default 0.15. */
  ingresoSigma?: number;
  /** Seed para reproducibilidad determinística. Default 42. */
  seed?: number;
}

export interface MonteCarloDistribution {
  /** Percentil 10 (peor 10% de escenarios). */
  p10: number;
  /** Percentil 50 (mediana). */
  p50: number;
  /** Percentil 90 (mejor 10%). */
  p90: number;
  /** Promedio. */
  mean: number;
  /** Desviación estándar de la distribución. */
  stdev: number;
}

/** Intervalo del histograma empírico (valores simulados). */
export interface MonteCarloHistogramBin {
  from: number;
  to: number;
  count: number;
}

/** Supuestos del escenario simulado (se muestran en la UI). */
export interface MonteCarloAssumptions {
  distribucion: 'normal-iid-mensual';
  /** Única variable estocástica. */
  variable: 'ingresos';
  /** σ relativa al ingreso mensual base. */
  ingresoSigmaMensual: number;
  horizonteMeses: number;
  iteraciones: number;
  semilla: number;
  /** Meses cubiertos por el snapshot usados para la base mensual. */
  mesesBase: number;
  exclusionesEs: string;
  exclusionesEn: string;
}

export interface MonteCarloResult {
  /** N de simulaciones efectivamente corridas. */
  iterations: number;
  /** Caja final al mes M+12 (distribución). */
  cajaFinal: MonteCarloDistribution;
  /** Utilidad acumulada 12m (distribución). */
  utilidadAcumulada: MonteCarloDistribution;
  /** Utilidad simulada 12m / PPE neto (grupo 15 de la clase 1). null sin PPE. */
  roiProbabilistico: MonteCarloDistribution | null;
  /** Histograma empírico de los ROI simulados. null sin PPE. */
  roiHistograma: MonteCarloHistogramBin[] | null;
  /** Probabilidad [0,1] de que la caja cruce 0 antes del mes 12. */
  probabilidadQuiebre12m: number;
  /** Mes esperado de quiebre (mediana de los meses donde caja<0; null si <50%). */
  mesQuiebreMediano: number | null;
  /** PPE neto (cuentas 15xx de la clase 1) usado para el ROI. null sin PPE. */
  inversionPPE: number | null;
  /** Seed usada (para reproducibilidad). */
  seed: number;
  /** Supuestos del escenario (distribución, σ, horizonte, N, semilla). */
  supuestos: MonteCarloAssumptions;
  generatedAt: string;
}
