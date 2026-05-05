// ─── WS4 — Provisiones laborales y parafiscales (Colombia 2026) ───────────────
//
// Tasas estándar por provision_type (Ley 21/1982, CST, Decreto 1295/1994):
//   prima              8.33%   (Ley 52/1975 — 15 días por semestre)
//   cesantias          8.33%   (Art. 249 CST)
//   intereses_cesantias 1.00%  (Ley 52/1975 art. 5 — 12% anual / 12 meses)
//   vacaciones         4.17%   (Art. 186 CST — 15 días por año)
//   salud              8.50%   (Ley 100/1993 — empleador)
//   pension           12.00%   (Ley 100/1993 — empleador)
//   arl                0.522%  (Decreto 1295/1994 — Clase de Riesgo I)
//   parafiscales       9.00%   (Ley 21/1982: 4% Caja + 3% ICBF + 2% SENA)
//
// income_tax: ver income-tax.ts
//
// Algoritmo por provisión:
//   1. Sumar el saldo del período de las cuentas en `base_account_codes`.
//   2. provision_amount = base * rate
//   3. Si provision_amount <= 0 → skip.
//   4. Construir CreateEntryInput con dos líneas (gasto / pasivo).
//
// Nota: `base_account_codes` se compara como prefijo — un código "51" incluye
// todas las subcuentas que empiezan por "51" (grupo Gastos de personal).
// Para un control más fino se pueden listar subcuentas explícitas en la DB.

import type { AccountingPeriodRow, ProvisionsConfigRow } from '@/lib/db/schema';
import type { CreateEntryInput, JournalLineInput } from '@/lib/accounting/types';
import type { ProvisionLine, ProvisionsPreview } from '../types';

// ---------------------------------------------------------------------------
// BigInt helpers
// ---------------------------------------------------------------------------

const SCALE = BigInt(100);
const ZERO = BigInt(0);

function toCentavos(raw: string): bigint {
  const trimmed = (raw ?? '0').trim() || '0';
  const dot = trimmed.indexOf('.');
  let intPart: string;
  let fracPart: string;
  if (dot < 0) {
    intPart = trimmed;
    fracPart = '';
  } else {
    intPart = trimmed.slice(0, dot) || '0';
    fracPart = trimmed.slice(dot + 1);
  }
  fracPart = fracPart.padEnd(2, '0').slice(0, 2);
  return BigInt(intPart) * SCALE + BigInt(fracPart);
}

function fromCentavos(c: bigint): string {
  const abs = c < ZERO ? -c : c;
  return `${c < ZERO ? '-' : ''}${abs / SCALE}.${(abs % SCALE).toString().padStart(2, '0')}`;
}

/** Multiplica centavos por una tasa decimal (string "0.0833") con 6 decimales de precisión.
 *  Usa escalado ×1_000_000 para evitar float. */
function applyRate(centavos: bigint, rateStr: string): bigint {
  // rateStr ej. "0.083300" → 6 decimales máx en la DB (numeric 8,6)
  const RATE_SCALE = BigInt(1_000_000);
  const dot = rateStr.indexOf('.');
  let intR = '0';
  let fracR = '';
  if (dot < 0) {
    intR = rateStr;
  } else {
    intR = rateStr.slice(0, dot) || '0';
    fracR = rateStr.slice(dot + 1);
  }
  fracR = fracR.padEnd(6, '0').slice(0, 6);
  const rateBig = BigInt(intR) * RATE_SCALE + BigInt(fracR);
  return (centavos * rateBig) / RATE_SCALE;
}

// ---------------------------------------------------------------------------
// JournalLineSummary — para calcular saldos desde journal_lines
// ---------------------------------------------------------------------------

export interface PeriodAccountBalance {
  /** PUC code (puede ser prefijo o exacto, depende de la query del repo). */
  code: string;
  /** Suma débitos del período en este código. NUMERIC string. */
  totalDebit: string;
  /** Suma créditos del período en este código. NUMERIC string. */
  totalCredit: string;
}

// ---------------------------------------------------------------------------
// calculateProvisions — puro, sin escrituras a DB
// ---------------------------------------------------------------------------

export interface ProvisionsCalcInput {
  workspaceId: string;
  period: AccountingPeriodRow;
  entryDate: Date;
  configs: (ProvisionsConfigRow & {
    /** Código PUC de la cuenta de gasto (para el label del ProvisionLine). */
    expenseAccountCode: string;
    /** Código PUC de la cuenta de pasivo. */
    liabilityAccountCode: string;
  })[];
  /**
   * Saldos de las cuentas del período, ya agregados por el repository.
   * El calculator los usa para calcular la base de cada provisión.
   */
  periodBalances: PeriodAccountBalance[];
  /**
   * Para income_tax: utilidad antes de impuestos del período.
   * Si es null, el calculator la calcula a partir de periodBalances
   * usando la convención colombiana (INGRESO crédito - GASTO/COSTO débito).
   */
  pretaxIncome?: string | null;
}

export function calculateProvisions(
  input: ProvisionsCalcInput,
): ProvisionsPreview {
  const { period, entryDate, configs, periodBalances } = input;

  const lines: ProvisionLine[] = [];
  const skipped: ProvisionsPreview['skipped'] = [];
  const proposedEntries: CreateEntryInput[] = [];

  // Build a fast lookup: code → net balance (crédito - débito para pasivos/ingresos,
  // o débito - crédito para activos/gastos). Para las bases de provisiones
  // laborales usamos el SALDO DÉBITO de las cuentas de nómina (clase 5x).
  const balanceMap = new Map<string, { debit: bigint; credit: bigint }>();
  for (const b of periodBalances) {
    balanceMap.set(b.code, {
      debit: toCentavos(b.totalDebit),
      credit: toCentavos(b.totalCredit),
    });
  }

  for (const cfg of configs) {
    if (!cfg.active) {
      skipped.push({ provisionType: cfg.provisionType, reason: 'inactive' });
      continue;
    }

    // ── Calcular base ────────────────────────────────────────────────────────

    let baseCentavos = ZERO;

    if (cfg.provisionType === 'income_tax') {
      // Utilidad antes de impuestos: puede venir precalculada o se computa aquí.
      if (input.pretaxIncome !== null && input.pretaxIncome !== undefined) {
        baseCentavos = toCentavos(input.pretaxIncome);
      } else {
        // Convención colombiana: INGRESO (crédito neto) - GASTO/COSTO (débito neto)
        let ingresos = ZERO;
        let gastosCostos = ZERO;
        for (const b of periodBalances) {
          const bal = balanceMap.get(b.code);
          if (!bal) continue;
          const code = b.code;
          // Clase 4 = INGRESO (saldo crédito normal)
          if (code.startsWith('4')) ingresos += bal.credit > bal.debit ? bal.credit - bal.debit : ZERO;
          // Clase 5 = GASTO, Clase 6 = COSTO (saldo débito normal)
          if (code.startsWith('5') || code.startsWith('6'))
            gastosCostos += bal.debit > bal.credit ? bal.debit - bal.credit : ZERO;
        }
        baseCentavos = ingresos > gastosCostos ? ingresos - gastosCostos : ZERO;
      }
    } else {
      // Provisiones laborales: base = suma de saldos débito de las cuentas en base_account_codes.
      const baseCodePrefixes: string[] = Array.isArray(cfg.baseAccountCodes)
        ? cfg.baseAccountCodes
        : [];

      if (baseCodePrefixes.length === 0) {
        // Sin base_account_codes configurado → skip con advertencia.
        skipped.push({
          provisionType: cfg.provisionType,
          reason: 'no_base_account_codes',
        });
        continue;
      }

      for (const b of periodBalances) {
        const matchesPrefix = baseCodePrefixes.some(
          (prefix) => b.code === prefix || b.code.startsWith(prefix),
        );
        if (!matchesPrefix) continue;
        const bal = balanceMap.get(b.code);
        if (!bal) continue;
        // Para cuentas de gasto (débito normal), el saldo neto es débito - crédito.
        const netDebit = bal.debit > bal.credit ? bal.debit - bal.credit : ZERO;
        baseCentavos += netDebit;
      }
    }

    if (baseCentavos <= ZERO) {
      skipped.push({
        provisionType: cfg.provisionType,
        reason: 'zero_or_negative_base',
      });
      continue;
    }

    // ── Calcular provisión ───────────────────────────────────────────────────

    const provisionCentavos = applyRate(baseCentavos, cfg.rate);

    if (provisionCentavos <= ZERO) {
      skipped.push({
        provisionType: cfg.provisionType,
        reason: 'zero_provision',
      });
      continue;
    }

    const baseStr = fromCentavos(baseCentavos);
    const provStr = fromCentavos(provisionCentavos);

    lines.push({
      provisionType: cfg.provisionType as import('../types').ProvisionType,
      rate: cfg.rate,
      baseAmountCop: baseStr,
      provisionAmountCop: provStr,
      expenseAccountCode: cfg.expenseAccountCode,
      liabilityAccountCode: cfg.liabilityAccountCode,
    });

    // Una entry por provision_type para legibilidad en el libro mayor.
    const entryLines: JournalLineInput[] = [
      {
        accountId: cfg.expenseAccountId,
        debit: provStr,
        credit: '0.00',
        description: `Provisión ${cfg.provisionType} ${period.year}-${String(period.month).padStart(2, '0')}`,
      },
      {
        accountId: cfg.liabilityAccountId,
        debit: '0.00',
        credit: provStr,
        description: `Provisión ${cfg.provisionType} por pagar`,
      },
    ];

    proposedEntries.push({
      workspaceId: input.workspaceId,
      periodId: period.id,
      entryDate,
      description: `Provisión ${cfg.provisionType} período ${period.year}-${String(period.month).padStart(2, '0')}`,
      sourceType: 'adjustment',
      sourceRef: `period:${period.id}:${cfg.provisionType}`,
      status: 'draft',
      lines: entryLines,
      metadata: {
        generator: 'auto_provisions',
        provisionType: cfg.provisionType,
        base: baseStr,
        rate: cfg.rate,
        periodId: period.id,
      },
    });
  }

  const totalCentavos = lines.reduce(
    (s, l) => s + toCentavos(l.provisionAmountCop),
    ZERO,
  );

  return {
    lines,
    totalAmountCop: fromCentavos(totalCentavos),
    proposedEntries,
    skipped,
  };
}
