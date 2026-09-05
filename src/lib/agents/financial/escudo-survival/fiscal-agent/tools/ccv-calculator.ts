// ---------------------------------------------------------------------------
// Capa 4 — Módulo 1 — Tool: CCV Calculator
// ---------------------------------------------------------------------------
//
// Calculadora determinística que extiende `fiscal-anchor/` con la alerta de
// tasa mínima (Art. 240 par. 6 E.T. / Ley 2277/2022 Art. 10) y el grado de
// eficiencia fiscal. NO duplica el cálculo de F01-F10 — los lee del bloque
// Âncora Capa 1.
//
// Cero LLM, cero red, cero filesystem. Solo TS + BigInt.
// ---------------------------------------------------------------------------

import type { FiscalAnchorBlock } from '../../fiscal-anchor/types';
import type { CcvAlertaTasaMinima } from '../types';

const ZERO = BigInt(0);
const CIEN = BigInt(100);

export const TTD_UNAVAILABLE_REASON = 'TTD no determinable: faltan impuesto depurado (ID), utilidad depurada (UD) y verificación del ámbito del Art. 240 par. 6 E.T. F09 es una razón contable, no la TTD.';

/** The accounting anchor has neither ID nor UD. Never substitute UAI for UD.
 * Source: DIAN Concepto 4228 de 2026, paragraph 4.
 */
export function buildAlertaTasaMinima(anchor: FiscalAnchorBlock): CcvAlertaTasaMinima {
  return {
    aplica: null,
    f09Actual: anchor.f09,
    brechaPp: null,
    impuestoAdicionalEstimado: null,
    norma: 'Art. 240 par. 6 E.T. (Ley 2277/2022 Art. 10)',
  };
}

/**
 * Clasifica eficiencia fiscal a partir de F10 (% retenciones / impuesto ref.).
 *
 *   F10 ≥ 80%  → alta   (retenciones cubren bien la posición)
 *   50% ≤ F10 < 80%  → media
 *   F10 < 50%  → baja
 *
 * Sin base referencial positiva o porcentaje válido no hay clasificación: null.
 */
export function clasificarEficienciaFiscal(
  anchor: FiscalAnchorBlock,
): 'alta' | 'media' | 'baja' | null {
  const f02 = BigInt(anchor.f02);
  if (f02 <= ZERO || !Number.isFinite(anchor.f10) || anchor.f10 < 0) return null;
  const f10 = anchor.f10;
  if (f10 >= 80) return 'alta';
  if (f10 >= 50) return 'media';
  return 'baja';
}

/**
 * Resultado determinístico de la pre-computación del CCV antes de pasarlo al
 * LLM. El LLM solo añade narrativa cualitativa y recomendaciones; los números
 * son intocables.
 */
export interface CcvPrecomputedData {
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
  eficienciaFiscal: 'alta' | 'media' | 'baja' | null;
}

/**
 * Wrapper: lee el Âncora y emite el snapshot estructurado del Módulo 1.
 */
export function precomputeCcv(anchor: FiscalAnchorBlock): CcvPrecomputedData {
  return {
    f01: anchor.f01,
    f02: anchor.f02,
    f03: anchor.f03,
    f04: anchor.f04,
    f05: anchor.f05,
    f06: anchor.f06,
    f07: anchor.f07,
    f08: anchor.f08,
    f09Pct: anchor.f09,
    f10Pct: anchor.f10,
    alertaTasaMinima: buildAlertaTasaMinima(anchor),
    eficienciaFiscal: clasificarEficienciaFiscal(anchor),
  };
}

// ---------------------------------------------------------------------------
// Centavos → unidades enteras (number) — helper para pasarlo al LLM cuando
// éste razona en pesos enteros. NUNCA usar para cálculo crítico.
// ---------------------------------------------------------------------------
export function centsToPesosNumber(moneyCop: string): number {
  const cents = BigInt(moneyCop);
  return Number(cents / CIEN);
}
