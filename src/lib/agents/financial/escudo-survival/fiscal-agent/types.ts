// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 4 (Agente Fiscal) — Tipos compartidos
// ---------------------------------------------------------------------------
//
// Contrato TypeScript del Agente Fiscal de El Escudo. Lo consumen:
//   - tools/**            (cálculos determinísticos sin LLM).
//   - agents (prompts/**) (system prompts inyectados a callFiscalAgent).
//   - runtime.ts          (callFiscalAgent — wrapper temático de callFinancialAgent).
//   - orchestrator.ts     (multi-step orchestration de los 6 módulos + Mod. 8).
//   - validators/         (rama paralela — los hace el otro agente).
//   - UI                  (rama paralela — los hace el otro agente).
//
// Convenciones:
//   - Cifras monetarias internas: MoneyCop (string en centavos, BigInt-safe).
//     Helpers en `src/lib/agents/financial/contracts/money.ts`.
//   - Cifras presentables al usuario: formato es-CO `$1.234.567,89` mediante
//     `formatCopFromCents`.
//   - NUNCA usar `§` en texto visible. Usar "parágrafo".
//   - NUNCA usar "centavos" en texto visible (es convención interna).
// ---------------------------------------------------------------------------

import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { FiscalAnchorBlock } from '../fiscal-anchor/types';
import type { CompanyContext, Language } from '../types';

// ---------------------------------------------------------------------------
// Re-exports semánticos para no acoplar a la ruta interna
// ---------------------------------------------------------------------------

export type { CompanyContext, Language };

// ---------------------------------------------------------------------------
// Modo del pipeline — controla qué módulos ejecuta el orchestrator
// ---------------------------------------------------------------------------
//
//   quick         : Módulos 1 (CCV) + 3 (RiskScore). Reporte ejecutivo corto.
//   full          : Módulos 1 + 2 + 3 + 4 + (6 condicional). Análisis completo.
//   supervivencia : Módulos 1 + 3 + 8. Activa Modo Supervivencia Élite cuando
//                   Score DIAN > 60 o cuando el caller fuerza crisis.
//   defensa_dian  : Módulos 1 + 3 + 5. Para responder requerimientos.
//   devolucion    : Módulos 1 + 6. Para solicitar devolución saldo a favor.
// ---------------------------------------------------------------------------

export type FiscalAgentMode =
  | 'quick'
  | 'full'
  | 'supervivencia'
  | 'defensa_dian'
  | 'devolucion';

// ---------------------------------------------------------------------------
// Tipos de requerimientos DIAN (Módulo 5)
// ---------------------------------------------------------------------------

export type DianRequirementKind =
  | 'requerimiento_ordinario' // Art. 752 E.T. — 15 días hábiles
  | 'emplazamiento_corregir' // Art. 685 E.T. — 1 mes
  | 'emplazamiento_no_declarar' // Art. 715 E.T.
  | 'pliego_cargos' // Art. 707 E.T. — 3 meses
  | 'liquidacion_oficial_revision' // Art. 702 E.T. (recurrible Art. 720 — 2 meses)
  | 'desconocido';

// ---------------------------------------------------------------------------
// Input principal del agente
// ---------------------------------------------------------------------------

export interface FiscalAgentInput {
  /** Balance preprocesado (fuente única de cifras). */
  preprocessed: PreprocessedBalance;
  /** Bloque Âncora Capa 1 (F01-F10 + calendario + alertas). REUSAR — no recomputar. */
  fiscalAnchor: FiscalAnchorBlock;
  /** Contexto de empresa. */
  company: CompanyContext;
  /** Idioma. */
  language: Language;
  /** Modo del pipeline. */
  mode: FiscalAgentMode;
  /** Instrucciones libres del usuario (opcional). */
  instructions?: string;
  /**
   * Módulo 5 — Texto del requerimiento DIAN cuando `mode='defensa_dian'`.
   * El builder identifica el tipo (Art. 752 / 685 / 715 / 702) por keywords +
   * el agente refina.
   */
  dianRequirementText?: string;
  /**
   * Módulo 5 — Tipo de requerimiento si el caller ya lo conoce.
   */
  dianRequirementKind?: DianRequirementKind;
}

// ---------------------------------------------------------------------------
// Módulo 1 — CCV Fiscal F01-F10
// ---------------------------------------------------------------------------
//
// El cálculo determinístico vive en `fiscal-anchor/`. Esta capa AÑADE el
// análisis cualitativo (alerta tasa mínima, eficiencia, recomendaciones) que
// requiere razonamiento.
// ---------------------------------------------------------------------------

export interface CcvAlertaTasaMinima {
  /** null means legal applicability cannot be established from this anchor. */
  aplica: boolean | null;
  /** F09 actual (%). */
  f09Actual: number;
  /** Diferencia con el umbral 15%. */
  brechaPp: number | null;
  /** Impuesto adicional estimado (MoneyCop) si aplica. */
  impuestoAdicionalEstimado: string | null;
  /** Cita normativa (siempre "Art. 240 par. 6 E.T." vía Ley 2277/2022). */
  norma: string;
}

export interface CcvModuleResult {
  /** Markdown narrativo (formato: 10 secciones F01-F10 + alertas + cierre). */
  markdown: string;
  /** Snapshot estructurado de F01-F10 (MoneyCop + porcentajes). */
  data: {
    f01: string;
    f02: string;
    f03: string;
    f04: string;
    f05: string;
    f06: string;
    f07: string;
    f08: string;
    f09Pct: number;
    f10Pct: number;
    alertaTasaMinima: CcvAlertaTasaMinima;
    eficienciaFiscal: 'alta' | 'media' | 'baja';
  };
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Módulo 2 — Conciliación Fiscal Borrador
// ---------------------------------------------------------------------------

export interface ConciliacionLinea {
  /** Etiqueta legible. Ej: "Gastos no deducibles Art. 107". */
  concepto: string;
  /** Monto MoneyCop (positivo suma, negativo resta). */
  monto: string;
  /** Norma soporte. */
  norma: string;
  /** Tipo de ajuste. */
  tipo: 'adicion' | 'deduccion' | 'renta_exenta' | 'incrgno' | 'descuento' | 'retencion' | 'anticipo';
}

export interface ConciliacionModuleResult {
  markdown: string;
  data: {
    /** UAI contable (F01). */
    uaiContable: string;
    /** Líneas de conciliación (adiciones, deducciones, etc.). */
    lineas: ConciliacionLinea[];
    /** Renta líquida gravable estimada. */
    rentaLiquidaGravable: string;
    /** Tarifa aplicable (%) — generalmente 35. */
    tarifaPct: number;
    /** Impuesto bruto = renta líquida × tarifa. */
    impuestoBruto: string;
    /** Suma de descuentos (Arts. 254/256/257/258-1). */
    totalDescuentos: string;
    /** Impuesto neto = bruto − descuentos. */
    impuestoNeto: string;
    /** Retenciones y anticipos (F03 del CCV). */
    retencionesYAnticipos: string;
    /** Saldo a pagar (positivo) o a favor (negativo). */
    saldoFinal: string;
    /** Disclaimer borrador + parágrafo Art. 647. */
    disclaimer: string;
  };
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Módulo 3 — Score Riesgo DIAN (0-100)
// ---------------------------------------------------------------------------

export type RiskNivel = 'bajo' | 'medio' | 'alto' | 'muy_alto' | 'critico';

export interface RiskFactorBreakdown {
  factor:
    | 'tet_baja'
    | 'margen_alto'
    | 'costo_bajo'
    | 'crecimiento_inusual'
    | 'saldo_favor_sin_solicitar'
    | 'cobertura_retenciones_baja'
    // Utilidad positiva sin provisión de renta causada. Separado de `tet_baja`
    // a propósito: son dos hechos distintos y mezclarlos hacía que una empresa
    // EN PÉRDIDA recibiera 30 puntos por "tasa efectiva nula sobre utilidad".
    | 'sin_provision_renta';
  descripcion: string;
  puntos: number;
  detalle: string;
}

export interface RiskScoreModuleResult {
  markdown: string;
  data: {
    score: number; // 0-100
    nivel: RiskNivel;
    factores: RiskFactorBreakdown[];
    interpretacion: string;
    recomendaciones: string[];
  };
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Módulo 4 — Planeación Tributaria (3 escenarios)
// ---------------------------------------------------------------------------

export type EscenarioRiesgo = 'baja' | 'media' | 'alta';

export interface PlaneacionEscenario {
  /** Nombre. */
  nombre: 'conservador' | 'base' | 'agresivo';
  /** Impuesto base (F02 referencia 35%). */
  impuestoBase: string;
  /** Impuesto estimado en el escenario. */
  impuestoEscenario: string;
  /** Ahorro estimado vs base. */
  ahorroEstimado: string;
  /** % de ahorro sobre base. */
  ahorroPct: number;
  /** Artículos aplicables. */
  articulosAplicables: string[];
  /** Documentación requerida. */
  documentacionRequerida: string[];
  /** Riesgo. */
  riesgo: EscenarioRiesgo;
  /** Justificación corta. */
  justificacion: string;
}

export interface PlaneacionModuleResult {
  markdown: string;
  data: {
    escenarios: {
      conservador: PlaneacionEscenario;
      base: PlaneacionEscenario;
      agresivo: PlaneacionEscenario;
    };
    recomendacion: 'conservador' | 'base' | 'agresivo';
    razonRecomendacion: string;
  };
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Módulo 5 — Defensa DIAN
// ---------------------------------------------------------------------------

export interface DefensaDianModuleResult {
  markdown: string;
  data: {
    tipoRequerimiento: DianRequirementKind;
    plazoRespuesta: string;
    normaPlazo: string;
    /** Antecedentes — síntesis del requerimiento. */
    antecedentes: string;
    /** Posición jurídica del contribuyente. */
    posicionJuridica: string;
    /** Citas normativas invocadas. */
    citasNormativas: string[];
    /** Soportes documentales requeridos. */
    soportesDocumentales: string[];
    /** Defensa Art. 647 E.T. (diferencia de criterio) si aplica. */
    defensaArt647: string | null;
    /** Reducciones disponibles (Arts. 709, 713, 640). */
    reduccionesDisponibles: string[];
    /** Carta completa lista para revisión del contador. */
    cartaCompleta: string;
  };
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Módulo 6 — Devoluciones Saldos a Favor
// ---------------------------------------------------------------------------

export interface DevolucionesModuleResult {
  markdown: string;
  data: {
    saldoAFavor: string;
    viabilidad: 'alta' | 'media' | 'baja' | 'no_aplica';
    plazoDian: string;
    plazoConGarantia: string;
    documentosRequeridos: string[];
    pasosProcedimentales: string[];
    riesgosIdentificados: string[];
    /** Norma vinculante: Art. 850 (derecho), Art. 854 (plazo solicitud), Art. 855 (plazo DIAN). */
    normaRef: string;
  };
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Módulo 8 — Modo Supervivencia Élite
// ---------------------------------------------------------------------------

export interface SupervivenciaAccionInmediata {
  prioridad: number;
  accion: string;
  norma: string;
  fechaLimite: string | null;
  impactoEstimado: string;
}

export interface SupervivenciaModuleResult {
  markdown: string;
  data: {
    activo: boolean;
    razonActivacion: string;
    riesgoDetectado: string;
    accionesInmediatas: SupervivenciaAccionInmediata[];
    exposicionFiscalEstimada: string;
    exposicionMitigada: string;
    /** Submódulos breves (reusa lógica/normas existente). */
    tet: { tetActual: number; brecha15Pct: number | null; impuestoAdicional: string | null };
    escudoRetenciones: { f03: string; ratioF10: number; recomendacion: string };
    antiDian: { resumen: string; norma: string };
    reservaContingencia: { sugerida: string; pctUtilidad: number };
    dividendos: { recomendacion: 'capitalizar' | 'distribuir' | 'hibrido'; norma: string };
  };
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Sintetizador (dictamen ejecutivo)
// ---------------------------------------------------------------------------

export interface FiscalSynthesisRecommendation {
  orden: number;
  titulo: string;
  norma: string;
  impactoEstimado: string;
  prioridad: 'alta' | 'media' | 'baja';
}

export interface FiscalSynthesisResult {
  markdown: string;
  topRecommendations: FiscalSynthesisRecommendation[];
  /** Cierre obligatorio (firma El Escudo + validación profesional). */
  cierre: string;
}

// ---------------------------------------------------------------------------
// Reporte final del Agente Fiscal
// ---------------------------------------------------------------------------

export interface FiscalAgentReport {
  ccv: CcvModuleResult;
  conciliacion: ConciliacionModuleResult | null;
  riskScore: RiskScoreModuleResult;
  planeacion: PlaneacionModuleResult | null;
  defensaDian: DefensaDianModuleResult | null;
  devoluciones: DevolucionesModuleResult | null;
  supervivencia: SupervivenciaModuleResult | null;
  synthesis: FiscalSynthesisResult;
  metadata: {
    mode: FiscalAgentMode;
    uvt: number;
    periodo: string;
    nit: string | null;
    generatedAt: string;
    partial: boolean;
    durationMs: number;
    /** ¿Cuáles módulos corrieron? */
    modulesRun: string[];
    /** ¿Cuáles módulos fallaron? */
    modulesFailed: string[];
  };
}

// ---------------------------------------------------------------------------
// Eventos de progreso (SSE)
// ---------------------------------------------------------------------------

export type FiscalAgentStage =
  | 'preprocessing'
  | 'ccv'
  | 'risk_score'
  | 'conciliacion'
  | 'planeacion'
  | 'defensa_dian'
  | 'devoluciones'
  | 'supervivencia'
  | 'synthesis'
  | 'validation';

export interface FiscalAgentProgressEvent {
  stage: FiscalAgentStage;
  status: 'started' | 'completed' | 'failed' | 'skipped';
  message?: string;
}

export interface FiscalAgentOrchestratorInput {
  /** Texto crudo del balance (CSV/Excel canonicalizado). */
  rawData: string;
  /** Override del preprocesado (si el caller lo trae cacheado). */
  preprocessed?: PreprocessedBalance;
  /** Override del Bloque Âncora (si el caller lo trae cacheado). */
  fiscalAnchor?: FiscalAnchorBlock;
  company?: CompanyContext;
  language?: Language;
  mode?: FiscalAgentMode;
  instructions?: string;
  dianRequirementText?: string;
  dianRequirementKind?: DianRequirementKind;
}

export interface FiscalAgentOrchestratorCallbacks {
  onProgress?: (event: FiscalAgentProgressEvent) => void;
}
