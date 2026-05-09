// ---------------------------------------------------------------------------
// Tipos del pipeline "Modo Supervivencia Elite" del area Escudo
// ---------------------------------------------------------------------------
// Contrato compartido por orchestrator, agentes, validator (rama paralela) y
// UI. NO renombrar campos sin coordinar las 3 ramas.
// ---------------------------------------------------------------------------

import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

export type Language = 'es' | 'en';

// ---------------------------------------------------------------------------
// Constantes normativas (UVT 2026 + parametros del paquete tributario CO)
// ---------------------------------------------------------------------------
// Centralizadas aqui para que prompts, agentes y validators citen exactamente
// los mismos valores. Cambiar UVT requiere actualizacion explicita.
// ---------------------------------------------------------------------------
export const UVT_2026 = 52374;
export const TOPE_INDIVIDUAL_UVT = 100; // Art. 771-5 §2 — pago efectivo a un mismo NIT
export const TOPE_GENERAL_UVT = 40000; // Art. 771-5 §1 — tope efectivo agregado
export const TET_ALERTA_AMARILLA = 0.25;
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
    tet: number;
    ttd: number;
    nivelAlerta: AlertLevel;
    impuestoProyectado: number;
    uai: number;
    sugerenciasOptimizacion: OptimizationSuggestion[];
  };
}

// ---------------------------------------------------------------------------
// 2. Retention Shield
// ---------------------------------------------------------------------------

export interface RetentionShieldResult extends AgentResultBase {
  data: {
    retencionesAcumuladas: number;
    impuestoProyectado: number;
    saldoAFavorProyectado: number;
    acciones: RetentionAction[];
  };
}

// ---------------------------------------------------------------------------
// 3. Anti-DIAN Auditor
// ---------------------------------------------------------------------------

export interface AntiDianResult extends AgentResultBase {
  data: {
    pagosEfectivoTotal: number;
    pagosNoDeduciblesIndividuales: CashPaymentViolation[];
    excesoNoDeducibleGeneral: number;
    crucesExogenaSospechosos: ExogenaCross[];
    mayorImpuestoEstimado: number;
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
    norma: 'Art. 242 E.T.' | 'Art. 36-3 E.T.';
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
   * Lo adjunta el validator (rama paralela). Se tipa como `unknown` aqui para
   * evitar acoplar este modulo al shape de `SurvivalValidationResult` mientras
   * la rama del validator esta en flight; cuando se mergee, basta con
   * reemplazar `unknown` por el tipo importado sin romper consumidores.
   */
  validation?: unknown;
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
