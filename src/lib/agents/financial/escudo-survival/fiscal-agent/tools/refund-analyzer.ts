// ---------------------------------------------------------------------------
// Capa 4 — Módulo 6 — Tool: Refund (Devolución) Analyzer
// ---------------------------------------------------------------------------
//
// Analiza la viabilidad de solicitar la devolución de un saldo a favor de
// renta. Cero LLM, cero red.
//
// Auditoría 2026-09 (tributario-modulos-02): antes tomaba F04 = UAI × 35% −
// F03 como «saldo a favor» y recomendaba devolverlo con viabilidad
// alta/media. F04 es una estimación CONTABLE: no depura la renta líquida
// (Art. 26 E.T.), no resta descuentos ni suma el anticipo del año siguiente
// (Art. 807 E.T.). El saldo a favor que puede devolverse es el LIQUIDADO en la
// declaración (Formulario 110). Sin ese dato el análisis es N/D: no se publica
// cuantía de devolución ni acción de solicitud (riesgo Art. 670 E.T.).
//
// Reglas con saldo declarado:
//   - Derecho a devolución/compensación: Art. 850 E.T.
//   - Término para solicitar: 2 años desde el vencimiento para declarar (Art. 854).
//   - La DIAN resuelve en 50 días hábiles (Art. 855); con garantía de entidad
//     bancaria o compañía de seguros, entrega en 20 días (Art. 860).
//
// Viabilidad heurística (sólo con saldo declarado):
//   alta  : saldo > $50M y retenciones (F03) materiales (F10 > 100%).
//   media : saldo > $10M.
//   baja  : saldo positivo pero ≤ $10M.
// ---------------------------------------------------------------------------

import { serializeMoneyCop } from '@/lib/agents/financial/contracts/money';
import type { FiscalAnchorBlock } from '../../fiscal-anchor/types';

const ZERO = BigInt(0);
const CIEN = BigInt(100);

const MATERIALIDAD_ALTA_COP = 50_000_000;
const MATERIALIDAD_MEDIA_COP = 10_000_000;

export type RefundViabilidad = 'alta' | 'media' | 'baja' | 'no_aplica' | 'no_determinable';

export interface RefundAnalysis {
  /** Saldo a favor DECLARADO (MoneyCop). `null` = no determinable sin declaración. */
  saldoAFavor: string | null;
  /** |F04| cuando F04 < 0: estimación contable, nunca base de devolución. */
  posibleSaldoContable: string | null;
  viabilidad: RefundViabilidad;
  plazoDian: string;
  plazoConGarantia: string;
  documentosBase: string[];
  pasosBase: string[];
  riesgosBase: string[];
  normaRef: string;
}

export const REFUND_NO_DETERMINABLE_MOTIVO =
  'Saldo a favor no determinable: F04 (UAI × 35% − F03) es una estimación contable sin depuración de la renta líquida (Art. 26 E.T.), descuentos ni anticipo del año siguiente (Art. 807 E.T.). La devolución sólo procede sobre el saldo a favor liquidado en la declaración (Formulario 110).';

const PLAZO_DIAN = '50 días hábiles desde la solicitud en debida forma (Art. 855 E.T.).';
const PLAZO_GARANTIA =
  '20 días con garantía a favor de la Nación otorgada por entidad bancaria o compañía de seguros (Art. 860 E.T.).';

function pesosFromCents(cents: bigint): number {
  return Number(cents / CIEN);
}

export interface AnalyzeRefundOptions {
  /** Saldo a favor liquidado en la declaración de renta (Formulario 110), MoneyCop. */
  saldoAFavorDeclaradoCents?: string | null;
}

export function analyzeRefund(
  anchor: FiscalAnchorBlock,
  opts: AnalyzeRefundOptions = {},
): RefundAnalysis {
  const f04 = BigInt(anchor.f04);
  const posibleSaldoContable = f04 < ZERO ? serializeMoneyCop(-f04) : null;
  const declarado =
    opts.saldoAFavorDeclaradoCents != null && /^-?\d+$/.test(opts.saldoAFavorDeclaradoCents)
      ? BigInt(opts.saldoAFavorDeclaradoCents)
      : null;

  if (declarado === null) {
    return {
      saldoAFavor: null,
      posibleSaldoContable,
      viabilidad: 'no_determinable',
      plazoDian: 'No determinable sin la declaración de renta.',
      plazoConGarantia: 'No determinable sin la declaración de renta.',
      documentosBase: ['Declaración de renta del periodo (Formulario 110) con el saldo a favor liquidado'],
      pasosBase: [
        'Verificar en la declaración presentada si existe saldo a favor liquidado antes de evaluar devolución o compensación (Art. 850 E.T.).',
      ],
      riesgosBase: [
        REFUND_NO_DETERMINABLE_MOTIVO,
        'Solicitar devolución sobre una cifra no liquidada expone a la sanción por devolución improcedente (Art. 670 E.T.).',
      ],
      normaRef: 'Arts. 26, 807 y 850 E.T.',
    };
  }

  if (declarado <= ZERO) {
    return {
      saldoAFavor: '0',
      posibleSaldoContable,
      viabilidad: 'no_aplica',
      plazoDian: 'No aplica',
      plazoConGarantia: 'No aplica',
      documentosBase: [],
      pasosBase: [],
      riesgosBase: ['La declaración no liquida saldo a favor.'],
      normaRef: 'Art. 850 E.T.',
    };
  }

  const saldoCop = pesosFromCents(declarado);
  let viabilidad: RefundViabilidad;
  if (saldoCop > MATERIALIDAD_ALTA_COP && anchor.f10 > 100) viabilidad = 'alta';
  else if (saldoCop > MATERIALIDAD_MEDIA_COP) viabilidad = 'media';
  else viabilidad = 'baja';

  return {
    saldoAFavor: serializeMoneyCop(declarado),
    posibleSaldoContable,
    viabilidad,
    plazoDian: PLAZO_DIAN,
    plazoConGarantia: PLAZO_GARANTIA,
    documentosBase: [
      'Solicitud de devolución MUISCA debidamente diligenciada',
      'Certificación firmada por contador público o revisor fiscal',
      'Relación de retenedores con NIT (sustento de las retenciones)',
      'Copia de la declaración de renta del periodo',
      'Estados financieros del periodo certificados',
    ],
    pasosBase: [
      'Verificar que no haya obligaciones tributarias pendientes (compensación previa).',
      'Diligenciar y firmar el Formulario 010 MUISCA por contador / RF.',
      'Adjuntar relación de retenciones con NIT del agente retenedor.',
      'Presentar la solicitud dentro de los 2 años siguientes al vencimiento del plazo para declarar (Art. 854 E.T.).',
      'Si se requiere entrega rápida: constituir garantía de entidad bancaria o compañía de seguros por el monto a devolver (Art. 860 E.T.).',
    ],
    riesgosBase: [
      'Si el saldo proviene de retenciones mal practicadas, la DIAN puede compensar contra otras obligaciones antes de devolver.',
      'Prescripción del derecho a solicitar a los 2 años desde el vencimiento del plazo para declarar (Art. 854 E.T.).',
      'Verificación previa de la DIAN sobre la realidad de las retenciones (Art. 857 E.T.).',
    ],
    normaRef: 'Arts. 850, 854, 855 y 860 E.T.',
  };
}
