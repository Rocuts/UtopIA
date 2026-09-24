// ---------------------------------------------------------------------------
// Constructores de ERPTrialBalance compartidos por los conectores
// ---------------------------------------------------------------------------
// buildMovementsTrialBalance — Siigo (alliances), Alegra, World Office, SAP B1,
//   Dynamics y Odoo sólo exponen comprobantes: sin saldo inicial no se puede
//   obtener el saldo final (saldo inicial + débitos − créditos). Se agregan los
//   movimientos por cuenta y el resultado queda `movements_only` con su
//   motivo, para que nadie lo presente ni lo serialice como balance de prueba.
//
// buildClosingTrialBalance — informes nativos con saldo final (ContaPyme,
//   Helisa, Siigo Nube, S/4HANA, Oracle). Marca hojas por jerarquía real,
//   verifica saldo final = saldo inicial + débitos − créditos cuando el ERP
//   entrega el saldo inicial y deja el balance `partial` si algo no cuadra.
// ---------------------------------------------------------------------------

import type { ERPAccount, ERPTrialBalance } from './types';
import type { ResolvedERPPeriod } from './period';
import {
  accountLevelFromCode,
  closingBalanceMatches,
  deriveParentCode,
  leafCodes,
  pucClassFromCode,
  pucTypeFromCode,
} from './puc';
import { movementsOnlyReason, statusFromWarnings } from './trial-balance-status';

export interface ClosingBalanceRow {
  code: string;
  name: string;
  /** Saldo inicial del periodo; null/undefined si el ERP no lo entrega. */
  opening?: number | null;
  debit: number;
  credit: number;
  closing: number;
  type?: ERPAccount['type'];
  level?: number;
  parentCode?: string;
}

export interface ClosingTrialBalanceInput {
  period: ResolvedERPPeriod;
  rows: ClosingBalanceRow[];
  companyName: string;
  companyNit?: string;
  currency: string;
  warnings?: string[];
}

const MAX_LISTED_CODES = 5;

function listCodes(codes: string[]): string {
  const shown = codes.slice(0, MAX_LISTED_CODES).join(', ');
  return codes.length > MAX_LISTED_CODES ? `${shown} y ${codes.length - MAX_LISTED_CODES} más` : shown;
}

export function buildClosingTrialBalance(input: ClosingTrialBalanceInput): ERPTrialBalance {
  const warnings = [...(input.warnings ?? [])];
  const withoutCode = input.rows.filter((r) => !r.code?.trim()).length;
  if (withoutCode > 0) {
    warnings.push(`${withoutCode} fila(s) sin código PUC excluidas.`);
  }
  const rows = input.rows.filter((r) => r.code?.trim());

  const nonFinite = rows
    .filter((r) => ![r.debit, r.credit, r.closing].every(Number.isFinite))
    .map((r) => r.code);
  if (nonFinite.length > 0) {
    warnings.push(`Saldo final o movimientos no numéricos en: ${listCodes(nonFinite)}.`);
  }

  const inconsistent = rows
    .filter((r) => typeof r.opening === 'number' && Number.isFinite(r.opening))
    .filter((r) => [r.debit, r.credit, r.closing].every(Number.isFinite))
    .filter((r) => !closingBalanceMatches(r.code, r.opening as number, r.debit, r.credit, r.closing))
    .map((r) => r.code);
  if (inconsistent.length > 0) {
    warnings.push(
      `Saldo final ≠ saldo inicial + débitos − créditos en: ${listCodes(inconsistent)}.`,
    );
  }

  const accounts: ERPAccount[] = rows.map((r) => ({
    code: r.code,
    name: r.name,
    type: r.type ?? pucTypeFromCode(r.code),
    pucClass: pucClassFromCode(r.code) || undefined,
    balance: r.closing,
    debit: r.debit,
    credit: r.credit,
    level: r.level ?? accountLevelFromCode(r.code),
    parentCode: r.parentCode ?? deriveParentCode(r.code),
    isAuxiliary: false,
  }));
  const leaves = leafCodes(accounts);
  for (const a of accounts) a.isAuxiliary = leaves.has(a.code);
  const leafAccounts = accounts.filter((a) => a.isAuxiliary);

  return {
    period: input.period.label,
    companyName: input.companyName,
    companyNit: input.companyNit,
    currency: input.currency,
    accounts,
    // Sólo hojas: sumar subcuentas y auxiliares duplicaría los totales.
    totalDebit: leafAccounts.reduce((s, a) => s + a.debit, 0),
    totalCredit: leafAccounts.reduce((s, a) => s + a.credit, 0),
    generatedAt: new Date().toISOString(),
    ...statusFromWarnings(warnings),
    warnings,
  };
}

export interface MovementLine {
  /** Código PUC de la cuenta; cadena vacía si el ERP no lo entregó. */
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

export interface MovementsTrialBalanceInput {
  providerName: string;
  period: ResolvedERPPeriod;
  /** Plan de cuentas (nombres, tipos, jerarquía) — sus saldos se ignoran. */
  chart: ERPAccount[];
  lines: Iterable<MovementLine>;
  companyName: string;
  companyNit?: string;
  currency: string;
  warnings?: string[];
}

export function buildMovementsTrialBalance(input: MovementsTrialBalanceInput): ERPTrialBalance {
  const chartByCode = new Map(input.chart.map((a) => [a.code, a]));
  const aggregated = new Map<string, { name: string; debit: number; credit: number }>();
  let linesWithoutCode = 0;

  for (const line of input.lines) {
    const code = line.accountCode.trim();
    if (!code) {
      if (line.debit !== 0 || line.credit !== 0) linesWithoutCode++;
      continue;
    }
    const current = aggregated.get(code) ?? { name: line.accountName, debit: 0, credit: 0 };
    current.debit += line.debit;
    current.credit += line.credit;
    aggregated.set(code, current);
  }

  const warnings = [...(input.warnings ?? [])];
  if (linesWithoutCode > 0) {
    warnings.push(
      `${linesWithoutCode} línea(s) de comprobante sin código PUC excluidas (no se clasifica por ID interno).`,
    );
  }

  // Cada línea de comprobante afecta una sola cuenta de registro, así que la
  // suma de todas las cuentas con movimiento no duplica saldos: todas son
  // cuentas de registro (isAuxiliary = true) aunque el plan las tenga en otro nivel.
  const accounts: ERPAccount[] = [...aggregated.entries()]
    .map(([code, totals]) => {
      const chartAccount = chartByCode.get(code);
      return {
        code,
        name: chartAccount?.name ?? totals.name ?? code,
        type: chartAccount?.type ?? pucTypeFromCode(code),
        pucClass: chartAccount?.pucClass ?? pucClassFromCode(code),
        balance: totals.debit - totals.credit,
        debit: totals.debit,
        credit: totals.credit,
        level: chartAccount?.level ?? accountLevelFromCode(code),
        parentCode: chartAccount?.parentCode ?? deriveParentCode(code),
        isAuxiliary: true,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  return {
    period: input.period.label,
    companyName: input.companyName,
    companyNit: input.companyNit,
    currency: input.currency,
    accounts,
    totalDebit: accounts.reduce((s, a) => s + a.debit, 0),
    totalCredit: accounts.reduce((s, a) => s + a.credit, 0),
    generatedAt: new Date().toISOString(),
    balanceStatus: 'movements_only',
    balanceStatusReason: movementsOnlyReason(input.providerName),
    warnings,
  };
}
