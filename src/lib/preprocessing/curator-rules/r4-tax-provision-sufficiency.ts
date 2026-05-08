// ---------------------------------------------------------------------------
// R4 — Validación renta teórica (Art. 240 E.T., 35%)
// ---------------------------------------------------------------------------
// La tasa nominal de renta para sociedades en Colombia es 35% (Art. 240 E.T.,
// vigente 2026). Si la provisión registrada en cuenta 24xx (Impuestos por
// pagar) está por debajo del 30% de la utilidad neta, hay un riesgo material
// de pasivo fiscal oculto: la empresa va a tener que pagar la diferencia en
// el siguiente vencimiento de renta y eso golpea la caja.
//
// La regla NO sustituye un cálculo de renta teórica completo (que requiere
// reconciliación contable-fiscal, deducibilidades, etc.) — es una alerta
// rápida basada en aritmética simple sobre los control totals.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot } from '../trial-balance';

import {
  RENTA_NOMINAL_RATE,
  RENTA_PROVISION_FLOOR,
  type CuratorFinding,
  type TaxProvisionRisk,
} from './types';

export interface R4Result {
  taxProvisionRisk?: TaxProvisionRisk;
  findings: CuratorFinding[];
}

export function runR4(snapshot: PeriodSnapshot): R4Result {
  const utilidadNeta = snapshot.controlTotals.utilidadNeta;
  const actualProvisionCop = snapshot.controlTotals.impuestosCuenta24;

  // Sin utilidad positiva, no aplica el riesgo.
  if (utilidadNeta <= 0) return { findings: [] };

  const expectedProvisionCop = utilidadNeta * RENTA_NOMINAL_RATE;
  const ratio = expectedProvisionCop > 0 ? actualProvisionCop / expectedProvisionCop : 1;

  // Si la provisión cubre ≥ 30% de lo esperado, no disparamos.
  if (ratio >= RENTA_PROVISION_FLOOR) return { findings: [] };

  const gapCop = expectedProvisionCop - actualProvisionCop;
  const cashImpactCop = gapCop;

  const risk: TaxProvisionRisk = {
    utilidadNeta,
    actualProvisionCop,
    expectedProvisionCop,
    gapCop,
    cashImpactCop,
    ratio,
    severidad: 'critico',
  };

  const finding: CuratorFinding = {
    code: 'CUR-R4',
    severity: 'critico',
    title: 'Riesgo de Pasivo Fiscal Oculto (Art. 240 E.T.)',
    description:
      `La utilidad neta del periodo es $${formatCOP(utilidadNeta)} pero la provisión de impuestos ` +
      `(cuenta 24xx) es solo $${formatCOP(actualProvisionCop)} — apenas ` +
      `${(ratio * 100).toFixed(1)}% de la renta teórica esperada al 35% ` +
      `($${formatCOP(expectedProvisionCop)}). Brecha: $${formatCOP(gapCop)}.`,
    normReference: 'Art. 240 E.T. — Tasa nominal del impuesto de renta para sociedades (35%)',
    recommendation:
      `Provisionar $${formatCOP(gapCop)} adicionales en cuenta 24xx para alinear la contabilidad ` +
      `con la renta teórica del periodo. Si la diferencia tiene sustento fiscal (deducciones especiales, ` +
      `descuentos del Art. 256/255 E.T., zona franca, ZOMAC), documentarlo en notas a los estados financieros.`,
    impact:
      `Sin este ajuste, la empresa enfrentará una salida de caja inesperada de aproximadamente ` +
      `$${formatCOP(cashImpactCop)} en el próximo vencimiento de declaración de renta. ` +
      `Eso reduciría la autonomía financiera y podría comprometer obligaciones operacionales.`,
    period: snapshot.period,
  };

  return { taxProvisionRisk: risk, findings: [finding] };
}

function formatCOP(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return amount < 0 ? `-${formatted}` : formatted;
}
