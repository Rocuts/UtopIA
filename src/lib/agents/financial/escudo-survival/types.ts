// ---------------------------------------------------------------------------
// Tipos del pipeline "Modo Supervivencia Elite" del area Escudo
// ---------------------------------------------------------------------------
// Contrato compartido por orchestrator, agentes, validator (rama paralela) y
// UI. NO renombrar campos sin coordinar las 3 ramas.
// ---------------------------------------------------------------------------

import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { FiscalAnchorBlock } from '@/lib/agents/financial/escudo-survival/fiscal-anchor/types';

export type Language = 'es' | 'en';

// ---------------------------------------------------------------------------
// Constantes normativas (UVT 2026 + parametros del paquete tributario CO)
// ---------------------------------------------------------------------------
// Centralizadas aqui para que prompts, agentes y validators citen exactamente
// los mismos valores. Cambiar UVT requiere actualizacion explicita.
// ---------------------------------------------------------------------------
export const UVT_2026 = 52374;
// Art. 771-5 par. 2 — tope por PAGO individual en efectivo (cada transacción),
// no acumulado por beneficiario (C.E. Secc. 4ª, sentencia 26676 de 19-jul-2023).
export const TOPE_INDIVIDUAL_UVT = 100;
export const TOPE_GENERAL_UVT = 40000; // Art. 771-5 §1 — tope efectivo agregado
// Umbrales de alerta TET — alineados con tet-calculator.prompt.ts:
// verde < 20%; amarillo 20-30%; rojo > 30%.
export const TET_ALERTA_AMARILLA = 0.2;
export const TET_ALERTA_ROJA = 0.3;

// ---------------------------------------------------------------------------
// Inputs comunes
// ---------------------------------------------------------------------------

export interface CompanyContext {
  name?: string;
  nit?: string;
  sector?: string;
  ciiu?: string;
}

export interface SurvivalAgentInput {
  preprocessed: PreprocessedBalance;
  company: CompanyContext;
  language: Language;
  instructions?: string;
}

// ---------------------------------------------------------------------------
// Tipos auxiliares (compartidos entre agentes)
// ---------------------------------------------------------------------------

export type AlertLevel = 'verde' | 'amarillo' | 'rojo';

export interface OptimizationSuggestion {
  norma: string;
  ahorroEstimado: number;
  requisitos: string[];
  factibilidad: 'alta' | 'media' | 'baja';
}

export interface RetentionAction {
  tipo: 'certif_no_retencion' | 'autorretenedor' | 'compensacion' | 'devolucion';
  norma: string;
  dificultad: 'baja' | 'media' | 'alta';
  riesgo: string;
}

export interface CashPaymentViolation {
  beneficiarioNit?: string;
  beneficiarioNombre?: string;
  monto: number;
  excesoUvt: number;
  norma: 'Art. 771-5 §2 E.T.';
}

export interface ExogenaCross {
  cuenta: string;
  terceroNit?: string;
  diferenciaEstimada: number;
  norma: string;
}

export interface DividendScenario {
  ahorroSocio: number;
  impuestoSocio: number;
  netoSocio: number;
  fortPatrimonio?: number;
}

// ---------------------------------------------------------------------------
// Resultado base que todo agente cumple
// ---------------------------------------------------------------------------

export interface AgentResultBase {
  markdown: string;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// 1. TET Calculator
// ---------------------------------------------------------------------------

export interface TetCalculatorResult extends AgentResultBase {
  data: {
    /** Tasa efectiva CONTABLE = impuesto causado (clase 54) / UAI. null si UAI ≤ 0. */
    tet: number | null;
    /** TTD (Art. 240 par. 6) = ID/UD — null sin ID/UD verificados. */
    ttd: number | null;
    /** null cuando la TET no es medible (N/D). */
    nivelAlerta: AlertLevel | null;
    /** Impuesto de renta causado en libros (clase 54). */
    impuestoProyectado: number | null;
    uai: number;
    sugerenciasOptimizacion: OptimizationSuggestion[];
  };
}

// ---------------------------------------------------------------------------
// 2. Retention Shield
// ---------------------------------------------------------------------------

export interface RetentionShieldResult extends AgentResultBase {
  data: {
    /** Crédito imputable a renta (lista blanca de fiscal-anchor/credito-renta.ts). */
    retencionesAcumuladas: number;
    /** Impuesto de renta causado en libros (clase 54). */
    impuestoProyectado: number | null;
    /** null: sin declaración no hay saldo a favor determinable (F04 es estimación contable). */
    saldoAFavorProyectado: number | null;
    acciones: RetentionAction[];
  };
}

// ---------------------------------------------------------------------------
// 3. Anti-DIAN Auditor
// ---------------------------------------------------------------------------

export interface AntiDianResult extends AgentResultBase {
  data: {
    /** null: el balance no trae el flujo de pagos en efectivo del año. */
    pagosEfectivoTotal: number | null;
    pagosNoDeduciblesIndividuales: CashPaymentViolation[];
    excesoNoDeducibleGeneral: number | null;
    crucesExogenaSospechosos: ExogenaCross[];
    mayorImpuestoEstimado: number | null;
  };
}

// ---------------------------------------------------------------------------
// 4. Contingency Reserve
// ---------------------------------------------------------------------------

export interface ContingencyReserveResult extends AgentResultBase {
  data: {
    utilidadNeta: number;
    reservaSugerida: number;
    pctUtilidad: number;
    cuentaSugerida: string;
    reservaLegalActual?: number;
    gapReservaLegal?: number;
  };
}

// ---------------------------------------------------------------------------
// 5. Dividend Optimizer
// ---------------------------------------------------------------------------

export interface DividendOptimizerResult extends AgentResultBase {
  data: {
    utilidadDistribuible: number;
    escenarios: {
      distribuirTotal: DividendScenario;
      capitalizarTotal: DividendScenario;
      hibrido50_50: DividendScenario;
    };
    recomendacion: string;
    norma: 'Art. 242 E.T.' | 'Art. 242-1 E.T.';
  };
}

// ---------------------------------------------------------------------------
// Sintetizador
// ---------------------------------------------------------------------------

export interface SynthesisRecommendation {
  orden: number;
  titulo: string;
  impacto: number;
  norma: string;
}

export interface SynthesisResult {
  markdown: string;
  topRecommendations: SynthesisRecommendation[];
}

// ---------------------------------------------------------------------------
// Reporte final
// ---------------------------------------------------------------------------

export interface EscudoSurvivalReport {
  tet: TetCalculatorResult;
  retentionShield: RetentionShieldResult;
  antiDian: AntiDianResult;
  contingencyReserve: ContingencyReserveResult;
  dividendOptimizer: DividendOptimizerResult;
  synthesis: SynthesisResult;
  /**
   * Bloque Âncora Fiscal — Capa 1. Lo calcula el agente fiscal-anchor
   * (rama paralela). Opcional hasta que el merge unifique las ramas.
   */
  fiscalAnchor?: FiscalAnchorBlock;
  /**
   * Resultado de `validateSurvivalReport` (3 capas deterministas). Lo adjunta
   * el orquestador antes de entregar el reporte (auditoría 2026-09,
   * tributario-modulos-03). Tipado estructural mínimo para no crear un ciclo
   * de imports con validators/survival-validators.ts.
   */
  validation?: {
    ok: boolean;
    errors: string[];
    warnings: string[];
  };
  metadata: {
    uvt: number;
    period: string;
    generatedAt: string;
    partial: boolean;
    durationMs: number;
  };
}

// ---------------------------------------------------------------------------
// Eventos de progreso (SSE)
// ---------------------------------------------------------------------------

export type EscudoSurvivalProgressStage =
  | 'preprocessing'
  | 'fiscal_anchor'
  | 'tet'
  | 'retention'
  | 'antiDian'
  | 'reserve'
  | 'dividend'
  | 'synthesis'
  | 'validation';

export interface EscudoSurvivalProgressEvent {
  stage: EscudoSurvivalProgressStage;
  status: 'started' | 'completed' | 'failed';
  message?: string;
}

// ---------------------------------------------------------------------------
// Orchestrator I/O
// ---------------------------------------------------------------------------

export interface OrchestrateEscudoSurvivalInput {
  rawData: string;
  company?: CompanyContext;
  language?: Language;
  instructions?: string;
}

export interface OrchestrateEscudoSurvivalCallbacks {
  onProgress?: (event: EscudoSurvivalProgressEvent) => void;
}
