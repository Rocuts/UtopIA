// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 4 (Agente Fiscal) — Validators · Tipos compartidos
// ---------------------------------------------------------------------------
//
// Contrato MÍNIMO de la respuesta del Agente Fiscal usado por los validators
// de Módulos 2-7. El contrato canónico vive en `fiscal-agent/schemas.ts` (lo
// construye el agente backend). Aquí declaramos solo lo necesario para validar
// — los validators NO dependen del schema completo del agente, lo cual permite
// que evolucione sin romper esta capa.
//
// Cero LLM. Cero red. Cero filesystem.
// ---------------------------------------------------------------------------

import type { CheckResult } from '../../validators/survival-validators';

// ---------------------------------------------------------------------------
// Identificadores de Módulo (referencia: spec Capa 4 Mayo 2026)
// ---------------------------------------------------------------------------
//
//   M1 → Bloque Âncora F01-F10 (cubierto por fiscal-anchor-validators.ts)
//   M2 → Conciliación contable-fiscal
//   M3 → Risk Score DIAN (0-100)
//   M4 → Planeación tributaria proactiva (lo cubre el orchestrator survival)
//   M5 → Defensa DIAN (carta de respuesta a requerimientos)
//   M6 → Devoluciones y saldos a favor
//   M7 → Formato y entrega (UX + tono + cierre)
//   M8 → Modo Supervivencia (lo cubre el orchestrator survival)
//
// El campo `modulos` de la response declara cuáles emite el agente en una
// invocación dada. El orchestrador (`validateFiscalResponse`) sólo corre el
// validator de cada módulo presente.
// ---------------------------------------------------------------------------

export const FISCAL_MODULE_IDS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8'] as const;
export type FiscalModuleId = (typeof FISCAL_MODULE_IDS)[number];

// ---------------------------------------------------------------------------
// Modo de respuesta — afecta validaciones de formato (Módulo 7)
// ---------------------------------------------------------------------------

export type FiscalResponseMode = 'quick' | 'full';

// ---------------------------------------------------------------------------
// Módulo 2 — Conciliación contable-fiscal
// ---------------------------------------------------------------------------
//
// Todas las cifras en centavos (string), MoneyCop convention.
//
//   uaiCents          — Utilidad Antes de Impuestos (UAI) base contable.
//   adicionesCents    — Suma adiciones fiscales (gastos no deducibles).
//   deduccionesCents  — Suma deducciones fiscales (rentas exentas, etc.).
//   rentaLiquidaCents — UAI + adiciones − deducciones (debe cuadrar exacto).
//   impuestoBrutoCents — rentaLiquida × tarifa Art. 240.
//   descuentos254_256_257Cents — TOTAL de descuentos distintos del 258-1.
//   descuento254Cents — parte del total anterior que corresponde al Art. 254
//     (impuestos pagados en el exterior). NO entra en el tope del Art. 258.
//   descuento258_1Cents — descuento IVA bienes capital (sin tope conjunto).
//   impuestoNetoCents — impuestoBruto − descuentos totales aplicables.
//   tarifa            — porcentaje aplicado (35 para Art. 240, 40 financiera).
//   detallesAdiciones / detallesDeducciones — desglose para auditar suma.
// ---------------------------------------------------------------------------

export interface ConciliacionDetalle {
  readonly concepto: string;
  readonly montoCents: string;
  readonly norma: string;
}

export interface Modulo2Conciliacion {
  readonly uaiCents: string;
  readonly adicionesCents: string;
  readonly deduccionesCents: string;
  readonly rentaLiquidaCents: string;
  readonly impuestoBrutoCents: string;
  readonly descuento258_1Cents: string;
  readonly descuentos254_256_257Cents: string;
  /**
   * Porción del campo anterior atribuible al Art. 254 E.T. (descuento por
   * impuestos pagados en el exterior). El tope del 25% del Art. 258 cobija
   * ÚNICAMENTE los Arts. 255, 256 y 257 — el 254 tiene su propio límite
   * (el impuesto colombiano generado por esas rentas, Art. 254 lit. e y par. 1)
   * y por eso no puede topearse con el 25%.
   *
   * Ausente ⇒ el validador no adivina el reparto: valida un rango en lugar de
   * exigir una cifra concreta (ver M2.L1.5).
   */
  readonly descuento254Cents?: string;
  readonly impuestoNetoCents: string;
  readonly tarifa: number;
  readonly detallesAdiciones: readonly ConciliacionDetalle[];
  readonly detallesDeducciones: readonly ConciliacionDetalle[];
  /** Texto narrativo que acompaña la conciliación (sirve para chequear cierre Art. 647). */
  readonly closingNote: string;
  /** ¿La empresa tiene rentas exentas declaradas? — soft flag para chequeo L2. */
  readonly rentasExentasCents: string;
}

// ---------------------------------------------------------------------------
// Módulo 3 — Risk Score DIAN
// ---------------------------------------------------------------------------
//
// Score 0-100 = suma exacta de 5 factores ponderados:
//   factor1_tetVsSector      [0-30]  — TET < sector → riesgo cruce información.
//   factor2_rentaPresuntiva  [0-25]  — UAI vs renta presuntiva (Art. 188).
//   factor3_proporcionDeducciones [0-20] — % deducciones sobre ingresos.
//   factor4_consistenciaIVA  [0-15]  — IVA generado vs ingresos declarados.
//   factor5_historicoSanciones [0-10] — sanciones previas del NIT.
//
// Si score > 60 → debe activarse Modo Supervivencia (referencia Módulo 8).
// ---------------------------------------------------------------------------

export interface Modulo3RiskScore {
  readonly score: number;
  readonly factor1_tetVsSector: number;
  readonly factor2_rentaPresuntiva: number;
  readonly factor3_proporcionDeducciones: number;
  readonly factor4_consistenciaIVA: number;
  readonly factor5_historicoSanciones: number;
  readonly interpretacion: 'BAJO' | 'MEDIO' | 'ALTO' | 'MUY_ALTO' | 'CRITICO';
  /** True si el output declara explícitamente la activación del Modo Supervivencia. */
  readonly modoSupervivenciaActivo: boolean;
  /** Valor de TET de F09 (porcentaje) — necesario para validar Factor 1. */
  readonly tetActualPct: number;
}

// ---------------------------------------------------------------------------
// Módulo 5 — Defensa DIAN
// ---------------------------------------------------------------------------
//
// Carta-borrador con estructura fija (no se valida contenido jurídico
// específico — sólo presencia de secciones obligatorias y citas correctas).
// ---------------------------------------------------------------------------

export type RequerimientoTipo =
  | 'requerimiento_ordinario_752'
  | 'requerimiento_especial_685'
  | 'pliego_cargos_715'
  | 'liquidacion_oficial_702';

export interface Modulo5DefensaDian {
  readonly tipoRequerimiento: RequerimientoTipo;
  /** Texto completo de la carta. Las regex de validación corren sobre esto. */
  readonly cartaTexto: string;
  /** Si la defensa invoca diferencia de criterio, validador exige Art. 647 par. */
  readonly invocaDiferenciaCriterio: boolean;
  /** ¿La carta menciona alguna reducción de sanción? */
  readonly mencionaReduccion: boolean;
}

// ---------------------------------------------------------------------------
// Módulo 6 — Devoluciones y Saldos a Favor
// ---------------------------------------------------------------------------

export type OrigenSaldoFavor = 'retenciones_fuente' | 'iva' | 'anticipo' | 'pago_exceso';

export interface Modulo6Devoluciones {
  readonly origen: OrigenSaldoFavor;
  /** Saldo a favor en centavos (string, MoneyCop). Coincide con |F04| del Âncora. */
  readonly saldoFavorCents: string;
  /** Cifra de F04 (Bloque Âncora) que se cita en el texto — para chequeo L1. */
  readonly f04CitadoCents: string;
  /** Texto completo del análisis — sobre éste corren regex de citación. */
  readonly textoAnalisis: string;
  /** ¿La response lista los requisitos completos para presentar solicitud? */
  readonly listaRequisitos: readonly string[];
}

// ---------------------------------------------------------------------------
// Módulo 7 — Formato y Entrega
// ---------------------------------------------------------------------------

export interface Modulo7Format {
  /** Texto completo emitido al usuario (markdown o plain). */
  readonly textoSalida: string;
  readonly modo: FiscalResponseMode;
}

// ---------------------------------------------------------------------------
// Response agregada del Agente Fiscal
// ---------------------------------------------------------------------------
//
// Cualquier módulo puede ser null cuando el agente no lo emite en esa pasada
// (ej. una respuesta de defensa DIAN no necesariamente trae Módulo 3 risk
// score). El validator decide por presencia.
// ---------------------------------------------------------------------------

export interface FiscalResponse {
  readonly modulos: readonly FiscalModuleId[];
  readonly modulo2: Modulo2Conciliacion | null;
  readonly modulo3: Modulo3RiskScore | null;
  readonly modulo5: Modulo5DefensaDian | null;
  readonly modulo6: Modulo6Devoluciones | null;
  readonly modulo7: Modulo7Format | null;
  /** Texto crudo unificado del agente — usado por Capa 2 (motor normativo). */
  readonly rawText: string;
}

// ---------------------------------------------------------------------------
// Re-export del tipo de check para consumers
// ---------------------------------------------------------------------------

export type ValidationCheck = CheckResult;
