// ---------------------------------------------------------------------------
// R10 — Clasificación cuenta 18 + detección de causación de impuesto
// ---------------------------------------------------------------------------
// La cuenta PUC 18xx ("Otros activos / Diferidos") es Activo por naturaleza.
// La regla detecta dos patologías:
//
//   1. `cuenta18UsadaComoGasto`: saldo neto del grupo 18 < 0 (acreedor).
//      Los activos no pueden tener saldo crédito sin compensación
//      (NIC 1 párr. 32). R1 ya reclasifica a virtual liability — R10
//      simplemente marca el flag para el gate.
//
//   2. `missingTaxCausation`: gasto del impuesto del periodo (grupo 54
//      dentro de clase 5: 5405 De renta y complementarios + 5410 ICA, etc.)
//      > 0 PERO grupo 24 (impuestos por pagar) ≈ 0. Indica que la entidad
//      reconoció el gasto SIN causar la contraparte de pasivo — patología
//      común cuando se usa la cuenta 18 como contraparte y se "desaparece"
//      el pasivo del balance.
//
// La regla NO inventa asientos. NO muta el snapshot. Sólo escribe banderas
// en `snapshot.findings` y emite findings cualitativos.
// ---------------------------------------------------------------------------

import type { PUCClass, PeriodSnapshot } from '../trial-balance';
import type { Class18ClassificationAudit, CuratorFinding } from './types';

/** Materialidad mínima para disparar `missingTaxCausation`. */
const TAX_CAUSATION_MATERIALITY = 1_000_000; // $1M COP
/** Tolerancia para considerar grupo 24 ≈ 0. */
const TAX_PAYABLE_TOLERANCE = 1_000; // $1K COP

export interface R10Result {
  audit: Class18ClassificationAudit;
  findings: CuratorFinding[];
}

export function runR10(snapshot: PeriodSnapshot): R10Result {
  const findings: CuratorFinding[] = [];

  const class1 = snapshot.classes.find((c: PUCClass) => c.code === 1);
  const class2 = snapshot.classes.find((c: PUCClass) => c.code === 2);
  const class5 = snapshot.classes.find((c: PUCClass) => c.code === 5);

  // -------------------------------------------------------------------------
  // 1. Saldo neto del grupo 18xx (clase 1, accounts.code que comienzan con '18').
  // -------------------------------------------------------------------------
  const class18Accounts = (class1?.accounts ?? []).filter((a) =>
    a.code.startsWith('18'),
  );
  const class18Balance = class18Accounts.reduce((s, a) => s + a.balance, 0);

  // -------------------------------------------------------------------------
  // 2. Gasto del impuesto del periodo (grupo 54xx en clase 5).
  // -------------------------------------------------------------------------
  const taxExpenseAccounts = (class5?.accounts ?? []).filter((a) =>
    a.code.startsWith('54'),
  );
  const taxExpense = taxExpenseAccounts.reduce((s, a) => s + a.balance, 0);

  // -------------------------------------------------------------------------
  // 3. Pasivo de impuestos por pagar (grupo 24xx en clase 2).
  // -------------------------------------------------------------------------
  const taxPayableAccounts = (class2?.accounts ?? []).filter((a) =>
    a.code.startsWith('24'),
  );
  const taxPayable = taxPayableAccounts.reduce((s, a) => s + a.balance, 0);

  // -------------------------------------------------------------------------
  // 4. Banderas determinísticas.
  // -------------------------------------------------------------------------
  const cuenta18UsadaComoGasto = class18Balance < -TAX_PAYABLE_TOLERANCE;
  const missingTaxCausation =
    taxExpense > TAX_CAUSATION_MATERIALITY &&
    Math.abs(taxPayable) <= TAX_PAYABLE_TOLERANCE;

  const audit: Class18ClassificationAudit = {
    class18BalanceCop: class18Balance,
    taxExpenseCop: taxExpense,
    taxPayableCop: taxPayable,
    missingTaxCausation,
    cuenta18UsadaComoGasto,
  };

  // Escribir banderas en snapshot.findings (gate las consume).
  if (!snapshot.findings) snapshot.findings = {};
  snapshot.findings.cuenta18UsadaComoGasto = cuenta18UsadaComoGasto;
  snapshot.findings.missingTaxCausation = missingTaxCausation;
  snapshot.class18ClassificationAudit = audit;

  // -------------------------------------------------------------------------
  // 5. Findings cualitativos.
  // -------------------------------------------------------------------------
  if (cuenta18UsadaComoGasto) {
    const list = class18Accounts
      .filter((a) => a.balance < 0)
      .map((a) => `${a.code} ${a.name} ($${formatCOP(a.balance)})`)
      .join('; ');
    findings.push({
      code: 'CUR-R10',
      severity: 'alto',
      title: 'Cuenta 18 (Otros activos) con saldo acreedor — uso como gasto detectado',
      description:
        `El grupo 18xx presenta saldo neto acreedor de $${formatCOP(class18Balance)}. ` +
        `Cuentas afectadas: ${list}. La cuenta PUC 18 es Activo por naturaleza (saldo deudor). ` +
        `Un saldo crédito indica que la entidad la usó como contraparte de gasto sin la ` +
        `causación correcta — típicamente Dr. 5xxx contra Cr. 1815 en lugar de Cr. 24xx.`,
      normReference: 'NIC 1 párr. 32 (no compensación) + Concepto CTCP 2018-1100 (clasificación PUC)',
      recommendation:
        'Investigar la causación: si el cargo corresponde a un gasto del periodo, ' +
        'reverter el asiento y reconocer Dr. 5xxx contra Cr. 24xx (impuesto por pagar). ' +
        'Si corresponde a un activo legítimo (anticipo, depósito), corregir el signo.',
      impact:
        'Sin corrección, el balance presenta un activo negativo y el pasivo de impuestos ' +
        'queda subreportado, lo que genera exposición sancionatoria Art. 647 E.T.',
      period: snapshot.period,
    });
  }

  if (missingTaxCausation) {
    findings.push({
      code: 'CUR-R10',
      severity: 'critico',
      title: 'Gasto de impuesto del periodo sin causación en pasivo',
      description:
        `Grupo 54xx (impuestos como gasto) reporta $${formatCOP(taxExpense)} pero el grupo 24xx ` +
        `(impuestos por pagar) está en $${formatCOP(taxPayable)}. La contraparte de pasivo ` +
        `de la causación del impuesto del periodo está ausente del balance.`,
      normReference: 'Art. 19 Decreto 2649/1993 + NIC 12 (impuesto a las ganancias) + Art. 26 E.T.',
      recommendation:
        'Verificar si el asiento de causación del impuesto del periodo se registró ' +
        'correctamente: Dr. 5405 (Impuesto de renta gasto) contra Cr. 2404 (Impuesto sobre ' +
        'la renta y complementarios por pagar). Si la entidad pagó directamente sin causar, ' +
        'reverter el cargo a caja y reclasificar.',
      impact:
        'El informe NO es emitible mientras este flag esté activo: la utilidad neta ' +
        'reportada incluye un gasto sin contraparte de pasivo, violando la ecuación ' +
        'patrimonial Activo = Pasivo + Patrimonio.',
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
