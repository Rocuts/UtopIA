// ---------------------------------------------------------------------------
// R14 — PPE sin depreciación sincronizada (Sección 17 NIIF para PYMES)
// ---------------------------------------------------------------------------
// Detecta entidades con PPE bruto material (cuentas 15xx excepto 1592) que NO
// han registrado:
//   1. Depreciación acumulada en cuenta 1592, ni
//   2. Gasto de depreciación del periodo en cuenta 5160 (Depreciaciones).
//
// Cuando ambos son 0 con PPE bruto > umbral, la entidad está incumpliendo la
// Sección 17 (NIIF para PYMES) o la NIC 16: todo activo de PPE debe
// depreciarse sistemáticamente según su vida útil estimada.
//
// La regla NO muta el snapshot — sólo escribe `snapshot.findings.ppeWithoutDepreciation`
// y emite un finding cualitativo. El renderer usa el flag para mostrar warning
// prominente; el gate NO lo bloquea (es advertencia, no incumplimiento crítico).
// ---------------------------------------------------------------------------

import type { PUCClass, PeriodSnapshot } from '../trial-balance';
import type { CuratorFinding, PpeDepreciationAudit } from './types';

/** Umbral mínimo de PPE bruto para disparar la advertencia. */
const PPE_MATERIALITY_FLOOR = 1_000_000; // $1M COP

/** Tolerancia para considerar 1592 / 5160 ≈ 0. */
const ZERO_TOLERANCE = 1_000; // $1K COP

export interface R14Result {
  audit: PpeDepreciationAudit;
  findings: CuratorFinding[];
}

export function runR14(snapshot: PeriodSnapshot): R14Result {
  const findings: CuratorFinding[] = [];

  const class1 = snapshot.classes.find((c: PUCClass) => c.code === 1);
  const class5 = snapshot.classes.find((c: PUCClass) => c.code === 5);

  // -------------------------------------------------------------------------
  // 1. PPE bruto = clase 1, accounts.code que comienzan con '15' EXCEPTO '1592'.
  //    1592 es la depreciación acumulada (contra-activo).
  // -------------------------------------------------------------------------
  const ppeAccounts = (class1?.accounts ?? []).filter(
    (a) => a.code.startsWith('15') && !a.code.startsWith('1592'),
  );
  const ppeBruto = ppeAccounts.reduce((s, a) => s + a.balance, 0);

  // -------------------------------------------------------------------------
  // 2. Depreciación acumulada (cuenta 1592, contra-activo).
  // -------------------------------------------------------------------------
  const depAccumulada = (class1?.accounts ?? [])
    .filter((a) => a.code.startsWith('1592'))
    .reduce((s, a) => s + Math.abs(a.balance), 0);

  // -------------------------------------------------------------------------
  // 3. Gasto depreciación del periodo (cuenta 5160 dentro de clase 5).
  // -------------------------------------------------------------------------
  const gastoDeprec = (class5?.accounts ?? [])
    .filter((a) => a.code.startsWith('5160'))
    .reduce((s, a) => s + a.balance, 0);

  // -------------------------------------------------------------------------
  // 4. Determinación.
  // -------------------------------------------------------------------------
  const ppeMaterial = ppeBruto > PPE_MATERIALITY_FLOOR;
  const sinDepAcumulada = depAccumulada <= ZERO_TOLERANCE;
  const sinGastoPeriodo = Math.abs(gastoDeprec) <= ZERO_TOLERANCE;
  const ppeWithoutDepreciation = ppeMaterial && sinDepAcumulada && sinGastoPeriodo;

  const audit: PpeDepreciationAudit = {
    ppeBrutoCop: ppeBruto,
    depreciacionAcumuladaCop: depAccumulada,
    gastoDepreciacionCop: gastoDeprec,
    ppeWithoutDepreciation,
  };

  if (!snapshot.findings) snapshot.findings = {};
  snapshot.findings.ppeWithoutDepreciation = ppeWithoutDepreciation;
  snapshot.ppeDepreciationAudit = audit;

  if (ppeWithoutDepreciation) {
    const ppeList = ppeAccounts
      .filter((a) => a.balance > ZERO_TOLERANCE)
      .map((a) => `${a.code} ${a.name} ($${formatCOP(a.balance)})`)
      .join('; ');

    findings.push({
      code: 'CUR-R14',
      severity: 'alto',
      title: 'PPE sin depreciación correspondiente — incumplimiento Sección 17 NIIF para PYMES',
      description:
        `La entidad reporta PPE bruto material por $${formatCOP(ppeBruto)} ` +
        `(${ppeList}), pero la cuenta 1592 (Depreciación acumulada) está en ` +
        `$${formatCOP(depAccumulada)} y la cuenta 5160 (Gasto depreciación del periodo) ` +
        `está en $${formatCOP(gastoDeprec)}. La depreciación sistemática es obligatoria ` +
        `(Sección 17.16 NIIF para PYMES — "una entidad depreciará todo elemento de ` +
        `PPE incluso si su valor razonable supera su valor en libros").`,
      normReference: 'Sección 17.16-17.23 NIIF para PYMES + NIC 16 párr. 50-59 + Art. 137 E.T.',
      recommendation:
        'Determinar la vida útil estimada de cada elemento de PPE conforme al uso ' +
        'esperado y el tipo de activo. Calcular la depreciación del periodo (típicamente ' +
        'línea recta) y reconocer Dr. 5160xx contra Cr. 1592xx. Documentar el método ' +
        'en políticas contables (Sección 10 NIIF para PYMES).',
      impact:
        'Sin depreciación, los activos quedan sobrevaluados y la utilidad del ejercicio ' +
        'sobreestimada. La DIAN puede objetar la base gravable (Art. 137 E.T. — depreciación ' +
        'fiscal mínima del 10% para PPE) y cuestionar la realidad económica del balance.',
      period: snapshot.period,
    });
  }

  return { audit, findings };
}

function formatCOP(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return amount < 0 ? `-${formatted}` : formatted;
}
