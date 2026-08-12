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
 * Escala de la brecha: diezmilésimas de punto porcentual.
 *
 * Antes se cuantizaba a DÉCIMAS de punto (`× 10`). Con eso una brecha real de
 * 0,06 pp se redondeaba a 0,1 pp —60% de sobreestimación— y una de 0,04 pp
 * se redondeaba a 0 pp, borrando el impuesto por completo. La escala tiene que
 * ser más fina que el dato de entrada, no igual: F09 llega con 1 decimal, así
 * que con 4 decimales de escala el redondeo nunca lo toca.
 */
const BRECHA_ESCALA = 10_000;

/** Divisor para pasar de (centavos × diezmilésimas de pp) a centavos: 100 × 10.000. */
const BRECHA_DIVISOR = BigInt(1_000_000);

/**
 * Brecha en puntos porcentuales con respecto al umbral 15%.
 * Positivo cuando F09 está debajo del umbral (problema).
 *
 * Se conserva la misma precisión que usa el cálculo del dinero para que el
 * texto («brecha de X pp») y la cifra no se contradigan.
 */
function brechaPpVsUmbral(f09Actual: number): number {
  return Math.round((TTD_UMBRAL_PCT - f09Actual) * BRECHA_ESCALA) / BRECHA_ESCALA;
}

/**
 * Calcula el impuesto adicional estimado por TTD baja.
 *
 * Fórmula (Art. 240 par. 6 E.T., adicionado por el Art. 10 de la Ley 2277/2022,
 * declarado EXEQUIBLE en Sentencia C-219 de 2024): si TTD < 15%,
 * IA = (UD × 15%) − ID, que es lo mismo que (15% − TTD) × UD.
 *
 * Aritmética entera en centavos: uai × brecha(diezmilésimas de pp) / 1.000.000,
 * con redondeo half-up al centavo. Ninguna división en punto flotante.
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
  // brecha en diezmilésimas de pp (BigInt-safe): (15,0000 − f09) × 10.000
  const brecha = BigInt(Math.round((TTD_UMBRAL_PCT - f09Pct) * BRECHA_ESCALA));
  if (brecha <= ZERO) return ZERO;
  const numerator = uaiCents * brecha;
  const quotient = numerator / BRECHA_DIVISOR;
  const remainder = numerator % BRECHA_DIVISOR;
  return remainder * BigInt(2) >= BRECHA_DIVISOR ? quotient + BigInt(1) : quotient;
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
