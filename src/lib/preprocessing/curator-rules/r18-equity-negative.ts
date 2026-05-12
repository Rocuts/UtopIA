// ---------------------------------------------------------------------------
// R18 — Patrimonio negativo (alerta de continuidad de negocio, Parte 5 spec v2.0)
// ---------------------------------------------------------------------------
// El patrimonio negativo (post-R8 Cierre Virtual) indica que el pasivo supera
// al activo — situación crítica que activa obligaciones legales:
//
//   - NIC 1 §25-26: el management debe evaluar going concern. Si hay
//     incertidumbre material, REVELAR.
//   - NIA 570: el auditor debe modificar el dictamen (énfasis o salvedad)
//     cuando hay duda significativa sobre going concern.
//   - C.Co. Art. 459: causal de disolución por pérdidas si Patrimonio Neto
//     < 50% del Capital Suscrito. El representante legal DEBE convocar
//     asamblea para resolver.
//
// La regla NO muta saldos — sólo emite finding CRÍTICO. R18 corre DESPUÉS de
// R8 (Cierre Virtual) para evaluar el patrimonio post-cierre virtual, no el
// patrimonio crudo del CSV. La utilidad transitoria ya está absorbida.
//
// NO falla cuando patrimonio = 0 (pequeñas empresas legalmente constituidas
// con capital social mínimo pueden tener saldo trivial). Sólo dispara cuando
// patrimonio < 0 con tolerancia centavos.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot } from '../trial-balance';
import type { CuratorFinding } from './types';

/** Tolerancia para considerar patrimonio "negativo" (no redondeo). */
const EQUITY_NEGATIVE_TOL = 100_000; // $100K COP

export interface R18Result {
  findings: CuratorFinding[];
  /** True si el patrimonio post-curator es materialmente negativo. */
  patrimonioNegativo: boolean;
}

export function runR18(snapshot: PeriodSnapshot): R18Result {
  const findings: CuratorFinding[] = [];
  const patrimonio = snapshot.controlTotals.patrimonio;

  // Permitir tolerancia: patrimonio entre -$100K y 0 NO dispara (redondeo o
  // empresas en arranque sin capital significativo).
  if (patrimonio >= -EQUITY_NEGATIVE_TOL) {
    return { findings, patrimonioNegativo: false };
  }

  // Detectar capital suscrito para evaluar Art. 459 C.Co. (50% pérdida).
  const capitalSuscrito = snapshot.equityBreakdown.capitalSuscritoPagado ?? 0;
  const triggers459 =
    capitalSuscrito > 0 && Math.abs(patrimonio) > capitalSuscrito * 0.5;

  const description459 = triggers459
    ? ` Adicionalmente, |Patrimonio| ($${formatCOP(Math.abs(patrimonio))}) ` +
      `supera el 50% del Capital Suscrito ($${formatCOP(capitalSuscrito)}) — ` +
      `se configura CAUSAL DE DISOLUCIÓN por pérdidas (Art. 459 C.Co.); el ` +
      `representante legal DEBE convocar asamblea extraordinaria.`
    : '';

  findings.push({
    code: 'CUR-R18',
    severity: 'critico',
    title: 'PATRIMONIO NEGATIVO — alerta de continuidad de negocio',
    description:
      `El patrimonio neto post-curator es $${formatCOP(patrimonio)} (negativo). ` +
      `Esta situación activa las obligaciones de revelación de going concern ` +
      `(NIC 1 §25-26) y, para el revisor fiscal, la consideración del párrafo ` +
      `de énfasis o salvedad por incertidumbre material (NIA 570).${description459}`,
    normReference:
      'NIC 1 §25-26 (going concern) + NIA 570 (auditor responsibilities) + C.Co. Art. 459 (causal disolución por pérdidas) + Ley 222/1995',
    recommendation: triggers459
      ? 'Convocar asamblea extraordinaria de socios para resolver: (a) aumento de ' +
        'capital, (b) reorganización empresarial (Ley 1116/2006), o (c) liquidación ' +
        'voluntaria. Revelar going concern en notas del próximo dictamen.'
      : 'Documentar plan de recuperación patrimonial (aumento de capital, capitalización ' +
        'de pasivos, etc.) y revelar la incertidumbre material en las notas de los EEFF.',
    impact:
      'Sin acciones correctivas, la entidad enfrenta (i) modificación obligatoria ' +
      'del dictamen del revisor fiscal, (ii) potencial responsabilidad personal ' +
      'del representante legal por no convocar la asamblea (Art. 200 C.Co.), y ' +
      '(iii) restricciones para contratar con el Estado (Ley 80/1993 + Decreto 1082/2015).',
    period: snapshot.period,
  });

  return { findings, patrimonioNegativo: true };
}

function formatCOP(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return amount < 0 ? `-${formatted}` : formatted;
}
