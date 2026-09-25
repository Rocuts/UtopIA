// ─── WS4 — Provisiones laborales y parafiscales (Colombia 2026) ───────────────
//
// Tasas estándar por provision_type (Ley 21/1982, CST, Decreto 1295/1994):
//   prima              1/12    (Art. 306 CST — 30 días de salario por año)
//   cesantias          1/12    (Art. 249 CST — un mes de salario por año)
//   intereses_cesantias 1.00%  (Ley 52/1975: 12% anual sobre cesantías; sobre
//                              la MISMA base de cesantías = 8,33% × 12% ≈ 1%)
//   vacaciones         1/24    (Art. 186 CST — 15 días hábiles por año)
//   (las fracciones se aplican exactas: ver EXACT_FRACTIONS)
//   salud              8.50%   (Ley 100/1993 — empleador) *
//   pension           12.00%   (Ley 100/1993 — empleador)
//   arl                0.522%  (Decreto 1772/1994 — Clase de Riesgo I)
//   caja               4.00%   (Ley 21/1982 — nunca exonerada)
//   sena               2.00%   (Ley 21/1982) *
//   icbf               3.00%   (Ley 89/1988) *
//   parafiscales       9.00%   LEGADO (caja+sena+icbf agrupados) — se omite
//                              con `legacy_parafiscales_split`: la exoneración
//                              del Art. 114-1 sólo cubre SENA/ICBF, no Caja.
//
// * Exonerables por el Art. 114-1 E.T. (auditoría contab-nomina-07): los
//   empleadores beneficiarios (sociedades/personas jurídicas declarantes de
//   renta; personas naturales con 2+ trabajadores) no pagan salud, SENA ni
//   ICBF por trabajadores que devenguen, individualmente, menos de 10 SMMLV.
//   Depende de la condición del empleador (`employerExonerated114_1`):
//     null  → no configurada: se omite con `employer_114_1_unknown` (N/D).
//     false → no beneficiario: se provisiona sobre toda la base.
//     true  → sólo sobre trabajadores ≥ 10 SMMLV; exige tercero en las líneas
//             de nómina (si falta: `worker_detail_required`).
//
// income_tax: ver income-tax.ts
//
// Algoritmo por provisión laboral:
//   1. Base = saldo débito neto del período de las cuentas en
//      `base_account_codes` (prefijos), por centro de costo.
//   2. Provisión por centro de costo = base_cc × rate, redondeo half-up al
//      centavo (misma regla que la renta). Una línea de gasto por
//      centro de costo (las cuentas 5105xx del PUC sembrado lo exigen) y una
//      línea de pasivo por el total.
//
// Nota: `base_account_codes` se compara como prefijo — un código "51" incluye
// todas las subcuentas que empiezan por "51" (grupo Gastos de personal).
// Para un control más fino se pueden listar subcuentas explícitas en la DB.

import type { AccountingPeriodRow, ProvisionsConfigRow } from '@/lib/db/schema';
import type { CreateEntryInput, JournalLineInput } from '@/lib/accounting/types';
import type { ProvisionLine, ProvisionsPreview } from '../types';
import { computePretaxIncome } from './income-tax';

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

const RATE_SCALE = BigInt(1_000_000);

/** Tasa decimal (string "0.083333", NUMERIC(8,6) en la DB) escalada ×1_000_000. */
function rateToMicros(rateStr: string): bigint {
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
  return BigInt(intR) * RATE_SCALE + BigInt(fracR);
}

/** centavos × num / den, redondeo half-up al centavo (una sola regla de redondeo). */
function mulDivHalfUp(centavos: bigint, num: bigint, den: bigint): bigint {
  const n = centavos * num;
  const q = n / den;
  const r = n % den;
  return r * BigInt(2) >= den ? q + BigInt(1) : q;
}

/**
 * Fracciones exactas de las prestaciones (contab-nomina-24). La tasa se guarda
 * con 6 decimales y 1/12 no cabe: 0,083333 (o 0,0833) infraprovisiona prima y
 * cesantías; 4.000.000 → 333.332 / 333.200 en vez de 333.333,33.
 *   prima       Art. 306 CST: 30 días de salario por año → 1/12 mensual.
 *   cesantías   Art. 249 CST: un mes de salario por año  → 1/12 mensual.
 *   vacaciones  Art. 186 CST: 15 días hábiles por año    → 15/360 = 1/24.
 * Sólo se usa la fracción si la tasa configurada es su redondeo (±0,00005);
 * una tasa distinta, fijada por el usuario, se respeta tal cual.
 */
const EXACT_FRACTIONS: Record<string, [bigint, bigint]> = {
  prima: [BigInt(1), BigInt(12)],
  cesantias: [BigInt(1), BigInt(12)],
  vacaciones: [BigInt(1), BigInt(24)],
};
const FRACTION_TOLERANCE_MICROS = BigInt(50);

/**
 * Aplica la tasa de la provisión a una base en centavos, con redondeo half-up
 * — el mismo de `computeIncomeTaxProvision` (contab-nomina-25: antes este
 * camino, que es el que POSTEA, truncaba y el de renta redondeaba).
 */
export function applyProvisionRate(
  centavos: bigint,
  rateStr: string,
  provisionType?: string,
): bigint {
  const micros = rateToMicros(rateStr);
  const frac = provisionType ? EXACT_FRACTIONS[provisionType] : undefined;
  if (frac) {
    const [num, den] = frac;
    const exactMicros = mulDivHalfUp(RATE_SCALE, num, den);
    const diff = micros > exactMicros ? micros - exactMicros : exactMicros - micros;
    if (diff <= FRACTION_TOLERANCE_MICROS) return mulDivHalfUp(centavos, num, den);
  }
  return mulDivHalfUp(centavos, micros, RATE_SCALE);
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
  /** Centro de costo de las líneas agregadas (null/ausente = sin centro). */
  costCenterId?: string | null;
  /** Tercero (trabajador) de las líneas agregadas (null/ausente = sin tercero). */
  thirdPartyId?: string | null;
}

/** Provisiones exonerables por el Art. 114-1 E.T. */
const EXONERABLE_114_1 = new Set(['salud', 'sena', 'icbf']);
const UMBRAL_114_1_SMMLV = BigInt(10);

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
  /**
   * Condición del empleador frente al Art. 114-1 E.T. (true beneficiario,
   * false no beneficiario, null/ausente sin configurar).
   */
  employerExonerated114_1?: boolean | null;
  /** SMMLV del año del período (NUMERIC string); null si no está disponible. */
  smmlvCop?: string | null;
}

export function calculateProvisions(
  input: ProvisionsCalcInput,
): ProvisionsPreview {
  const { period, entryDate, configs, periodBalances } = input;

  const lines: ProvisionLine[] = [];
  const skipped: ProvisionsPreview['skipped'] = [];
  const proposedEntries: CreateEntryInput[] = [];

  for (const cfg of configs) {
    if (!cfg.active) {
      skipped.push({ provisionType: cfg.provisionType, reason: 'inactive' });
      continue;
    }
    // Este cálculo es MENSUAL. Una configuración con cadencia anual se
    // aceptaba y se provisionaba cada mes como si fuera mensual
    // (contab-nomina-25): se omite con motivo explícito.
    const cadence = (cfg as { cadence?: string | null }).cadence;
    if (cadence && cadence !== 'monthly') {
      skipped.push({ provisionType: cfg.provisionType, reason: 'cadence_not_monthly' });
      continue;
    }

    // ── Calcular base ────────────────────────────────────────────────────────

    let baseCentavos = ZERO;
    /** Base por centro de costo (clave '' = sin centro de costo). */
    const baseByCostCenter = new Map<string, bigint>();

    if (cfg.provisionType === 'income_tax') {
      // Utilidad antes de impuestos: puede venir precalculada o se computa aquí.
      if (input.pretaxIncome !== null && input.pretaxIncome !== undefined) {
        baseCentavos = toCentavos(input.pretaxIncome);
      } else {
        // Una sola implementación de la base gravable. Este bloque tenía su
        // propia copia —clampeada por cuenta, sin clase 7 y restando el grupo
        // 54— y como es el camino que POSTEA ASIENTOS, la copia divergente
        // provisionaba de más. Ver `income-tax.ts` para la identidad completa.
        baseCentavos = toCentavos(computePretaxIncome(periodBalances));
      }
      // Sobre pérdida no hay provisión de renta corriente.
      if (baseCentavos < ZERO) baseCentavos = ZERO;
      baseByCostCenter.set('', baseCentavos);
    } else {
      if (cfg.provisionType === 'parafiscales') {
        // Config legado (Caja + SENA + ICBF agrupados al 9%): no se puede
        // aplicar la exoneración 114-1 sobre SENA/ICBF sin separar la Caja.
        skipped.push({
          provisionType: cfg.provisionType,
          reason: 'legacy_parafiscales_split',
        });
        continue;
      }

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

      const baseRows = periodBalances
        .filter((b) =>
          baseCodePrefixes.some(
            (prefix) => b.code === prefix || b.code.startsWith(prefix),
          ),
        )
        .map((b) => {
          const debit = toCentavos(b.totalDebit);
          const credit = toCentavos(b.totalCredit);
          // Para cuentas de gasto (débito normal), el saldo neto es débito - crédito.
          return {
            net: debit > credit ? debit - credit : ZERO,
            costCenterId: b.costCenterId ?? null,
            thirdPartyId: b.thirdPartyId ?? null,
          };
        })
        .filter((r) => r.net > ZERO);

      let eligibleRows = baseRows;
      if (EXONERABLE_114_1.has(cfg.provisionType)) {
        const employer = input.employerExonerated114_1;
        if (employer === null || employer === undefined) {
          skipped.push({
            provisionType: cfg.provisionType,
            reason: 'employer_114_1_unknown',
          });
          continue;
        }
        if (employer === true) {
          if (!input.smmlvCop) {
            skipped.push({
              provisionType: cfg.provisionType,
              reason: 'smmlv_not_available',
            });
            continue;
          }
          if (baseRows.some((r) => r.thirdPartyId === null)) {
            skipped.push({
              provisionType: cfg.provisionType,
              reason: 'worker_detail_required',
            });
            continue;
          }
          const umbral = toCentavos(input.smmlvCop) * UMBRAL_114_1_SMMLV;
          const byWorker = new Map<string, bigint>();
          for (const r of baseRows) {
            const k = r.thirdPartyId as string;
            byWorker.set(k, (byWorker.get(k) ?? ZERO) + r.net);
          }
          eligibleRows = baseRows.filter(
            (r) => (byWorker.get(r.thirdPartyId as string) ?? ZERO) >= umbral,
          );
          if (eligibleRows.length === 0) {
            skipped.push({
              provisionType: cfg.provisionType,
              reason: 'exonerated_114_1',
            });
            continue;
          }
        }
      }

      for (const r of eligibleRows) {
        const k = r.costCenterId ?? '';
        baseByCostCenter.set(k, (baseByCostCenter.get(k) ?? ZERO) + r.net);
        baseCentavos += r.net;
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

    // Provisión por centro de costo (la suma de las partes es el total).
    const perCostCenter: Array<{ costCenterId: string | null; amount: bigint }> = [];
    for (const [cc, base] of baseByCostCenter) {
      const amount = applyProvisionRate(base, cfg.rate, cfg.provisionType);
      if (amount > ZERO) perCostCenter.push({ costCenterId: cc || null, amount });
    }
    const provisionCentavos = perCostCenter.reduce((acc, p) => acc + p.amount, ZERO);

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

    // Una entry por provision_type para legibilidad en el libro mayor: una
    // línea de gasto por centro de costo y una de pasivo por el total.
    const entryLines: JournalLineInput[] = [
      ...perCostCenter.map((p) => ({
        accountId: cfg.expenseAccountId,
        costCenterId: p.costCenterId,
        debit: fromCentavos(p.amount),
        credit: '0.00',
        description: `Provisión ${cfg.provisionType} ${period.year}-${String(period.month).padStart(2, '0')}`,
      })),
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
