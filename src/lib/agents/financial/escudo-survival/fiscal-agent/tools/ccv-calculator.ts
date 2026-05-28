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

import { serializeMoneyCop } from '@/lib/agents/financial/contracts/money';
import type { FiscalAnchorBlock } from '../../fiscal-anchor/types';
import type { CcvAlertaTasaMinima } from '../types';

const ZERO = BigInt(0);
const CIEN = BigInt(100);

/**
 * Umbral de la TTD (Tasa de Tributación Depurada — Art. 240 par. 6 E.T.).
 * Ley 2277/2022 Art. 10 — vigente desde año gravable 2023.
 */
const TTD_UMBRAL_PCT = 15;

/**
 * Brecha en puntos porcentuales con respecto al umbral 15%.
 * Positivo cuando F09 está debajo del umbral (problema).
 */
function brechaPpVsUmbral(f09Actual: number): number {
  // round 1 decimal to mirror f09 precision
  return Math.round((TTD_UMBRAL_PCT - f09Actual) * 10) / 10;
}

/**
 * Calcula el impuesto adicional estimado por TTD baja.
 *
 * Fórmula (Art. 240 par. 6 E.T.): impuestoAdicional = (15% − F09) × UAI.
 * Si F09 ≥ 15% → 0n.
 *
 * NOTA: la TTD real usa Utilidad Depurada (UD), no UAI bruta. Para el
 * Módulo 1 usamos UAI como proxy conservador — el cálculo refinado vive
 * en el Módulo 8 (Supervivencia) cuando se justifica el reasoning extra.
 */
function calcularImpuestoAdicionalCents(
  uaiCents: bigint,
  f09Pct: number,
): bigint {
  if (uaiCents <= ZERO) return ZERO;
  if (f09Pct >= TTD_UMBRAL_PCT) return ZERO;
  // brecha en décimas de pp (BigInt-safe): (150 − f09 × 10)
  const brechaDecimas = BigInt(Math.round((TTD_UMBRAL_PCT - f09Pct) * 10));
  if (brechaDecimas <= ZERO) return ZERO;
  // impuestoAdicional = uai × brechaDecimas / 1000
  const numerator = uaiCents * brechaDecimas;
  const MIL = BigInt(1000);
  const quotient = numerator / MIL;
  const remainder = numerator % MIL;
  return remainder * BigInt(2) >= MIL ? quotient + BigInt(1) : quotient;
}

/**
 * Construye la alerta de tasa mínima a partir del bloque Âncora.
 */
export function buildAlertaTasaMinima(
  anchor: FiscalAnchorBlock,
): CcvAlertaTasaMinima {
  const f09 = anchor.f09;
  const uaiCents = BigInt(anchor.f01);
  const impuestoAdicional = calcularImpuestoAdicionalCents(uaiCents, f09);
  const aplica = f09 < TTD_UMBRAL_PCT && uaiCents > ZERO;
  return {
    aplica,
    f09Actual: f09,
    brechaPp: aplica ? brechaPpVsUmbral(f09) : 0,
    impuestoAdicionalEstimado: serializeMoneyCop(impuestoAdicional),
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
 * Si F02 = 0 (utilidad antes impuestos no positiva), no aplica clasificación —
 * devolvemos 'media' como placeholder neutro.
 */
export function clasificarEficienciaFiscal(
  anchor: FiscalAnchorBlock,
): 'alta' | 'media' | 'baja' {
  const f02 = BigInt(anchor.f02);
  if (f02 <= ZERO) return 'media';
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
  eficienciaFiscal: 'alta' | 'media' | 'baja';
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

// Para tests/diagnóstico: exporta el cálculo del impuesto adicional puro.
export const __internals = {
  calcularImpuestoAdicionalCents,
  brechaPpVsUmbral,
  TTD_UMBRAL_PCT,
};

// ---------------------------------------------------------------------------
// Centavos → unidades enteras (number) — helper para pasarlo al LLM cuando
// éste razona en pesos enteros. NUNCA usar para cálculo crítico.
// ---------------------------------------------------------------------------
export function centsToPesosNumber(moneyCop: string): number {
  const cents = BigInt(moneyCop);
  return Number(cents / CIEN);
}
