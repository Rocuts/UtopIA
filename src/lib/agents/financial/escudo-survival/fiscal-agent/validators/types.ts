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
import type { DianRequirementKind } from '../types';

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
// Fase 2 de la auditoría 2026-09-24 (pendiente #8): el contrato anterior
// describía otra fórmula (5 factores «TET vs sector», «renta presuntiva»,
// «consistencia IVA»…) que el agente no produce. El Score publicado sale de
// `computeRiskScore` (7 factores con código propio); el validador comprueba
// sus invariantes y, sobre todo, que la prosa del modelo no publique otro
// score ni convierta un score no publicable en «riesgo bajo».
// ---------------------------------------------------------------------------

export type Modulo3Nivel = 'bajo' | 'medio' | 'alto' | 'muy_alto' | 'critico';

export interface Modulo3Factor {
  /** Código del factor tal como lo emite `computeRiskScore`. */
  readonly factor: string;
  readonly puntos: number;
}

export interface Modulo3RiskScore {
  readonly score: number;
  readonly nivel: Modulo3Nivel;
  readonly factores: readonly Modulo3Factor[];
  /** false ⇒ el score no se publica (sin base gravable). */
  readonly publicable: boolean;
  readonly noPublicableMotivo: string | null;
  /** F01 del Bloque Âncora (MoneyCop): publicable ⇔ F01 ≠ 0. */
  readonly f01Cents: string;
  /** Prosa del modelo (markdown + interpretación). */
  readonly narrativa: string;
  readonly recomendaciones: readonly string[];
  /**
   * Estado del Modo Supervivencia (Módulo 8) en esta corrida; `null` cuando
   * el modo del agente no ejecuta el Módulo 8.
   */
  readonly modoSupervivenciaActivo: boolean | null;
}

// ---------------------------------------------------------------------------
// Módulo 5 — Defensa DIAN
// ---------------------------------------------------------------------------
//
// Misma taxonomía que el esqueleto determinista (`dian-letter-builder`): el
// contrato anterior usaba otra («requerimiento_especial_685», pliego de
// cargos a 3 meses) que contradecía los plazos corregidos del builder.
// ---------------------------------------------------------------------------

export type RequerimientoTipo = DianRequirementKind;

export interface Modulo5DefensaDian {
  readonly tipoRequerimiento: RequerimientoTipo;
  /** Plazo publicado en `data.plazoRespuesta`. */
  readonly plazoRespuesta: string;
  /** Norma del plazo publicada en `data.normaPlazo`. */
  readonly normaPlazo: string;
  /** Texto completo de la carta. Las regex de validación corren sobre esto. */
  readonly cartaTexto: string;
  /** Defensa por diferencia de criterio; `null` = no se invoca. */
  readonly defensaArt647: string | null;
}

// ---------------------------------------------------------------------------
// Módulo 6 — Devoluciones y Saldos a Favor (renta)
// ---------------------------------------------------------------------------
//
// El saldo a favor devolvible es el LIQUIDADO en la declaración (Formulario
// 110). F04 = F02 − F03 es una posición de referencia contable: nunca es el
// saldo a favor (Arts. 26, 807 y 850 E.T.). El contrato anterior exigía
// saldo = |F04|, justo lo que el agente dejó de publicar.
// ---------------------------------------------------------------------------

export type Modulo6Viabilidad = 'alta' | 'media' | 'baja' | 'no_aplica' | 'no_determinable';

export interface Modulo6Devoluciones {
  /** Saldo a favor declarado que recibió el agente (MoneyCop); `null` = no provisto. */
  readonly saldoDeclaradoCents: string | null;
  /** Saldo a favor publicado por el módulo (MoneyCop); `null` = N/D. */
  readonly saldoAFavorCents: string | null;
  readonly viabilidad: Modulo6Viabilidad;
  /** F04 del Bloque Âncora (MoneyCop con signo): posición de referencia contable. */
  readonly f04Cents: string;
  /** Prosa del modelo — sobre ésta corren las regex de citación. */
  readonly textoAnalisis: string;
  readonly documentosRequeridos: readonly string[];
  readonly pasosProcedimentales: readonly string[];
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
