// ---------------------------------------------------------------------------
// R1 — Saldos Incoherentes en Activos
// ---------------------------------------------------------------------------
// Detecta cuentas de Clase 1 (Activo) con saldo NEGATIVO al cierre del periodo.
// Un activo con saldo crédito viola el principio NIIF de no-compensación
// (NIC 1, párr. 32) y suele indicar que la cuenta funciona en realidad como
// un pasivo transitorio (ej. sobregiros bancarios, anticipos de clientes
// mal codificados, retenciones acreditadas).
//
// La regla NO muta el balance crudo — emite un objeto `Reclassification[]`
// que el reportador puede renderizar como ajuste sugerido. El monto absoluto
// se reclasifica a una cuenta virtual `2810ZZ` (Otros pasivos transitorios)
// para preservar la ecuación patrimonial sin tocar la entrada original.
// ---------------------------------------------------------------------------

import type { PUCClass, PeriodSnapshot, ValidatedAccount } from '../trial-balance';

import type { CuratorFinding, Reclassification } from './types';

const VIRTUAL_LIABILITY_CODE = '2810ZZ';
const VIRTUAL_LIABILITY_NAME = 'Otros pasivos transitorios (reclasificación curator)';

/** Tolerancia: ignoramos saldos negativos triviales por redondeo. */
const NEGATIVE_TOLERANCE_COP = 100; // $100 COP

export interface R1Result {
  reclassifications: Reclassification[];
  findings: CuratorFinding[];
}

export function runR1(snapshot: PeriodSnapshot): R1Result {
  const out: R1Result = { reclassifications: [], findings: [] };
  const claseActivo = snapshot.classes.find((c: PUCClass) => c.code === 1);
  if (!claseActivo) return out;

  const negativos = claseActivo.accounts.filter(
    (a: ValidatedAccount) => a.balance < -NEGATIVE_TOLERANCE_COP,
  );
  if (negativos.length === 0) return out;

  for (const acc of negativos) {
    const amountAbs = Math.abs(acc.balance);
    out.reclassifications.push({
      accountCode: acc.code,
      accountName: acc.name,
      originalBalanceCop: acc.balance,
      reclassifiedToCode: VIRTUAL_LIABILITY_CODE,
      reclassifiedToName: VIRTUAL_LIABILITY_NAME,
      amountCop: amountAbs,
      justification:
        `Saldo crédito en cuenta de activo viola NIC 1 párr. 32 (no compensación). ` +
        `Reclasificado a ${VIRTUAL_LIABILITY_CODE} para preservar ecuación patrimonial. ` +
        `Investigar origen del saldo (sobregiro, anticipo, retención).`,
    });
  }

  // Un único finding agregado por simplicidad (severidad='alto'), enumerando
  // las cuentas afectadas en `description`.
  const totalReclasificado = out.reclassifications.reduce((s, r) => s + r.amountCop, 0);
  const accountsList = out.reclassifications
    .map((r) => `${r.accountCode} (${r.accountName}) $${formatCOP(r.originalBalanceCop)}`)
    .join('; ');

  out.findings.push({
    code: 'CUR-R1',
    severity: 'alto',
    title: `Saldos incoherentes detectados en ${out.reclassifications.length} cuenta(s) de activo`,
    description:
      `Una o más cuentas de Clase 1 (Activo) presentan saldo crédito (negativo): ${accountsList}. ` +
      `El curator reclasificó automáticamente $${formatCOP(totalReclasificado)} a ${VIRTUAL_LIABILITY_CODE} ` +
      `(${VIRTUAL_LIABILITY_NAME}) sin mutar el balance crudo.`,
    normReference: 'NIC 1, párrafo 32 (no compensación de activos y pasivos)',
    recommendation:
      `Investigar el origen del saldo crédito en cada cuenta y, si corresponde, mover el saldo ` +
      `manualmente a la cuenta de pasivo apropiada (típicamente sobregiros 21xx, anticipos 28xx ` +
      `o retenciones 23xx/24xx).`,
    impact:
      `Los estados financieros oficiales no pueden presentar activos con saldo crédito. ` +
      `Sin este ajuste, la rentabilidad y los ratios financieros quedan distorsionados.`,
    period: snapshot.period,
  });

  return out;
}

function formatCOP(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return amount < 0 ? `-${formatted}` : formatted;
}
