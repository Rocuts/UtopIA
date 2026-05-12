// ---------------------------------------------------------------------------
// R17 — Proveedores (PUC Clase 22) con saldo débito (anomalía Parte 5 spec v2.0)
// ---------------------------------------------------------------------------
// PUC Clase 2 (Pasivos) tiene naturaleza CRÉDITO. Un saldo positivo en una
// auxiliar 22xx (Proveedores) — interpretado por la convención del parser
// como saldo débito — indica:
//   - Anticipo a proveedor (debió clasificarse como Activo, grupo 1330).
//   - Error de imputación al causar.
//   - Pago duplicado pendiente de reverso.
//
// NIC 1 §32 prohíbe COMPENSAR partidas de Activo/Pasivo aunque pertenezcan
// al mismo proveedor — cada partida se presenta en bruto. PUC Clase 2
// (convención crédito) refuerza la prohibición.
//
// La regla NO muta saldos — sólo emite finding informativo para que el
// auditor revise. El renderer del Balance debe mostrar la partida en bruto
// en el lado del Activo (anticipos a proveedores) si corresponde, NUNCA
// comprimida contra el pasivo Cta 22.
// ---------------------------------------------------------------------------

import type { PUCClass, PeriodSnapshot } from '../trial-balance';
import type { CuratorFinding } from './types';

/** Materialidad mínima — saldos < $50.000 son redondeos triviales. */
const SUPPLIER_DEBIT_MATERIALITY = 50_000; // $50K COP

export interface R17Result {
  findings: CuratorFinding[];
  /** Cuentas detectadas con saldo débito anómalo (auditoría). */
  affectedAccounts: Array<{ code: string; name: string; balance: number }>;
}

export function runR17(snapshot: PeriodSnapshot): R17Result {
  const findings: CuratorFinding[] = [];

  const class2 = snapshot.classes.find((c: PUCClass) => c.code === 2);
  if (!class2) {
    return { findings, affectedAccounts: [] };
  }

  // Detectar auxiliares 22xx con saldo > 0 (débito por convención del parser).
  const ctas22Anomalas = class2.accounts.filter(
    (a) => a.code.startsWith('22') && a.balance > SUPPLIER_DEBIT_MATERIALITY,
  );

  if (ctas22Anomalas.length === 0) {
    return { findings, affectedAccounts: [] };
  }

  const affectedAccounts = ctas22Anomalas.map((a) => ({
    code: a.code,
    name: a.name,
    balance: a.balance,
  }));
  const total = affectedAccounts.reduce((s, a) => s + a.balance, 0);
  const detail = affectedAccounts
    .map((a) => `${a.code} ${a.name} ($${formatCOP(a.balance)})`)
    .join('; ');

  findings.push({
    code: 'CUR-R17',
    severity: 'informativo',
    title:
      'Proveedores (Cta 22) con saldo débito — anomalía de presentación NIC 1 §32',
    description:
      `Se detectaron ${ctas22Anomalas.length} cuenta(s) PUC 22xx ` +
      `(Proveedores) con saldo débito por un total de $${formatCOP(total)}. ` +
      `Detalle: ${detail}. PUC Clase 2 tiene naturaleza crédito; un saldo ` +
      `débito sugiere (a) anticipos pagados a proveedores (que deberían ` +
      `presentarse en Activo grupo 1330), o (b) error de imputación al causar.`,
    normReference:
      'NIC 1 §32 (no compensación de activos y pasivos) + PUC Clase 2 (convención crédito, Decreto 2649/93)',
    recommendation:
      'Reclasificar el saldo a Activo (grupo 1330 — Anticipos a proveedores) ' +
      'cuando corresponda a anticipos genuinos. Si se trata de pago duplicado ' +
      'o error de imputación, reverter el asiento original.',
    impact:
      'Sin reclasificación, el balance presenta un pasivo NETO (no en bruto) ' +
      'violando NIC 1 §32 y subestima la posición de anticipos a proveedores ' +
      'en el Activo.',
    period: snapshot.period,
  });

  return { findings, affectedAccounts };
}

function formatCOP(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return amount < 0 ? `-${formatted}` : formatted;
}
