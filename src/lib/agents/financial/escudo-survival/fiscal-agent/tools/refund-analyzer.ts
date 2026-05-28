// ---------------------------------------------------------------------------
// Capa 4 — Módulo 6 — Tool: Refund (Devolución) Analyzer
// ---------------------------------------------------------------------------
//
// Analiza viabilidad de devolución de saldos a favor de renta a partir del
// Âncora F01-F10. Cero LLM, cero red.
//
// Reglas:
//   - F04 < 0 → existe saldo a favor (Art. 850 E.T.).
//   - F03 / F02 (ratio F10) sustenta el origen del saldo (retenciones).
//   - El plazo del derecho a solicitar prescribe en 2 años (Art. 854 E.T.).
//   - La DIAN resuelve en 50 días hábiles (20 con garantía) — Art. 855 E.T.
//
// Viabilidad heurística:
//   alta      : saldo > $50M y retenciones (F03) materiales (F10 > 100%).
//   media     : saldo > $10M, retenciones presentes.
//   baja      : saldo positivo pero < $10M (sancion mínima neutraliza valor).
//   no_aplica : F04 ≥ 0.
// ---------------------------------------------------------------------------

import { parseMoneyCop, serializeMoneyCop } from '@/lib/agents/financial/contracts/money';
import type { FiscalAnchorBlock } from '../../fiscal-anchor/types';

const ZERO = BigInt(0);
const CIEN = BigInt(100);

const MATERIALIDAD_ALTA_COP = 50_000_000;
const MATERIALIDAD_MEDIA_COP = 10_000_000;

export type RefundViabilidad = 'alta' | 'media' | 'baja' | 'no_aplica';

export interface RefundAnalysis {
  saldoAFavor: string;
  viabilidad: RefundViabilidad;
  plazoDian: string;
  plazoConGarantia: string;
  documentosBase: string[];
  pasosBase: string[];
  riesgosBase: string[];
  normaRef: string;
}

function pesosFromCents(cents: bigint): number {
  return Number(cents / CIEN);
}

export function analyzeRefund(anchor: FiscalAnchorBlock): RefundAnalysis {
  const f04 = parseMoneyCop(anchor.f04);

  if (f04 >= ZERO) {
    return {
      saldoAFavor: '0',
      viabilidad: 'no_aplica',
      plazoDian: 'No aplica',
      plazoConGarantia: 'No aplica',
      documentosBase: [],
      pasosBase: [],
      riesgosBase: ['No se identifica saldo a favor del periodo según F04 = F02 − F03.'],
      normaRef: 'Art. 850 E.T.',
    };
  }

  const saldoAFavorCents = -f04;
  const saldoCop = pesosFromCents(saldoAFavorCents);

  let viabilidad: RefundViabilidad;
  if (saldoCop > MATERIALIDAD_ALTA_COP && anchor.f10 > 100) {
    viabilidad = 'alta';
  } else if (saldoCop > MATERIALIDAD_MEDIA_COP) {
    viabilidad = 'media';
  } else {
    viabilidad = 'baja';
  }

  return {
    saldoAFavor: serializeMoneyCop(saldoAFavorCents),
    viabilidad,
    plazoDian: '50 días hábiles (Art. 855 E.T.)',
    plazoConGarantia: '20 días hábiles con garantía bancaria personal (Art. 855 E.T.)',
    documentosBase: [
      'Solicitud de devolución MUISCA debidamente diligenciada',
      'Certificación firmada por contador público o revisor fiscal',
      'Relación de retenedores con NIT (sustento del F03)',
      'Copia de la declaración de renta del periodo',
      'Estados financieros del periodo certificados',
    ],
    pasosBase: [
      'Verificar que no haya obligaciones tributarias pendientes (compensación previa).',
      'Diligenciar y firmar Formulario 010 MUISCA por contador / RF.',
      'Adjuntar relación de retenciones con NIT del agente retenedor (soporte F03).',
      'Presentar la solicitud por MUISCA dentro de los 2 años desde el vencimiento de la declaración (Art. 854 E.T.).',
      'Si se requiere giro rápido: constituir garantía bancaria personal por el monto + intereses para activar el plazo de 20 días hábiles.',
    ],
    riesgosBase: [
      'Si el saldo proviene de retenciones mal practicadas, la DIAN puede compensar contra otras obligaciones antes de devolver.',
      'Prescripción del derecho a solicitar a los 2 años desde el vencimiento del plazo de la declaración (Art. 854 E.T.).',
      'Verificación previa de la DIAN sobre la realidad de las retenciones (Art. 857 E.T.).',
    ],
    normaRef:
      'Arts. 850, 854 y 855 E.T. (derecho, plazo de solicitud y plazo de respuesta DIAN respectivamente)',
  };
}
