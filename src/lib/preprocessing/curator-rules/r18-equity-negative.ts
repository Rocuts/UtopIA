// ---------------------------------------------------------------------------
// R18 — Patrimonio negativo (alerta de negocio en marcha, Parte 5 spec v2.0)
// ---------------------------------------------------------------------------
// El patrimonio negativo (post-R8 Cierre Virtual) indica que el pasivo supera
// al activo. Obligaciones que activa:
//
//   - NIC 1 §25-26 / NIIF para las PYMES §3.8-3.9: la administración evalúa
//     la hipótesis de negocio en marcha y revela las incertidumbres
//     materiales.
//   - NIA 570: el auditor evalúa el efecto en su dictamen.
//   - Ley 2069 de 2020, art. 4: el no cumplimiento de la hipótesis de negocio
//     en marcha al cierre del ejercicio es causal de disolución; cuando se
//     pueda verificar razonablemente, los administradores se abstienen de
//     nuevas operaciones distintas del giro ordinario y convocan de inmediato
//     al máximo órgano social. También deben convocarlo cuando los estados
//     financieros permitan establecer deterioros patrimoniales y riesgos de
//     insolvencia. Indicadores: Decreto 1378 de 2021 (concordancia citada en
//     la Ley 2069).
//
// Auditoría 2026-09 (niif-preproceso-14): la regla afirmaba que se configuraba
// la "causal de disolución por pérdidas (Art. 459 C.Co.)". El parágrafo 2 del
// art. 4 de la Ley 2069 de 2020 DEROGÓ los arts. 457 num. 2, 458 y 459 C.Co.
// (texto en `src/data/tax_docs/ley_2069_2020.md`), y el parágrafo 1 remite toda
// mención a la causal por pérdidas a la nueva causal de negocio en marcha.
// Además la condición derogada era patrimonio < 50 % del capital suscrito, no
// |patrimonio negativo| > 50 %. R18 ya no calcula ninguna causal automática:
// alerta y pide la evaluación de la administración.
//
// La regla NO muta saldos — sólo emite finding CRÍTICO. Corre DESPUÉS de R8
// para evaluar el patrimonio post-cierre virtual.
//
// NO falla cuando patrimonio = 0 (pequeñas empresas legalmente constituidas
// con capital social mínimo pueden tener saldo trivial). Sólo dispara cuando
// patrimonio < 0 con tolerancia.
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

  findings.push({
    code: 'CUR-R18',
    severity: 'critico',
    title: 'PATRIMONIO NEGATIVO — posible incumplimiento de la hipótesis de negocio en marcha',
    description:
      `El patrimonio neto post-curator es $${formatCOP(patrimonio)} (negativo): los pasivos ` +
      `superan a los activos. Es un indicio de posible incumplimiento de la hipótesis de ` +
      `negocio en marcha que la administración debe evaluar y revelar (NIC 1 §25-26; NIIF ` +
      `para las PYMES §3.8-3.9). Si al cierre del ejercicio se verifica razonablemente ese ` +
      `incumplimiento, se configura la causal de disolución del art. 4 de la Ley 2069 de ` +
      `2020; el sistema no lo determina automáticamente.`,
    normReference:
      'NIC 1 §25-26 / NIIF para las PYMES §3.8-3.9 (negocio en marcha) + NIA 570 + ' +
      'Ley 2069 de 2020 art. 4 (Decreto 1378 de 2021, indicadores)',
    recommendation:
      'Documentar la evaluación de negocio en marcha de la administración (proyecciones, ' +
      'plan de recuperación patrimonial: capitalización, capitalización de pasivos, ' +
      'reorganización) y revelar la incertidumbre material en notas. Si la evaluación ' +
      'confirma el incumplimiento, los administradores deben abstenerse de nuevas ' +
      'operaciones distintas del giro ordinario y convocar de inmediato al máximo órgano ' +
      'social (Ley 2069 de 2020, art. 4).',
    impact:
      'Sin la evaluación y revelación, el revisor fiscal debe considerar el efecto en su ' +
      'dictamen (NIA 570) y los administradores pueden responder solidariamente por los ' +
      'perjuicios de no convocar al máximo órgano social (Ley 2069 de 2020, art. 4).',
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
