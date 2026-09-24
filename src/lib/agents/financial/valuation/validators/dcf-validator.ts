// ---------------------------------------------------------------------------
// Validador determinista del DCF (valoracion-06 / 07 / 08)
// ---------------------------------------------------------------------------
// El LLM aporta los SUPUESTOS (ingresos, EBIT, D&A, CAPEX, ΔWC, componentes del
// WACC, g, deuda, caja). El código recalcula y publica TODAS las cifras
// derivadas; lo que el LLM emitió sólo se contrasta y, si difiere, se lista como
// discrepancia:
//
//   Impuesto_t = t × EBIT_t si EBIT_t > 0; 0 si EBIT_t ≤ 0
//   FCF_t      = EBIT_t − Impuesto_t + D&A_t − CAPEX_t − ΔWC_t
//   EBITDA_t   = EBIT_t + D&A_t
//   VP(FCF_t)  = FCF_t / (1 + WACC)^t            (t = 1..n, fin de año)
//   FCF_{n+1}  = FCF_n × (1 + g)
//   TV         = FCF_{n+1} / (WACC − g)           (g < WACC obligatorio)
//   VP(TV)     = TV / (1 + WACC)^n
//   EV         = Σ VP(FCF_t) + VP(TV)
//   Deuda neta = Deuda financiera − Efectivo (si ambos se declaran)
//   Equity     = EV − Deuda neta (+ ajustes netos del puente)
//                → la caja NO se suma otra vez (valoracion-08)
//   Sensibilidad WACC ± {1, 2} pp × g ± {0,5, 1} pp, calculada aquí.
//
// Bloqueos (DCF no emitible): g ≥ WACC, años no consecutivos, WACC inválido
// (ver `recomputeWacc`), acciones en circulación ≤ 0.
// Aritmética: centavos BigInt + tasas escaladas (calc/fixed-point.ts).
// ---------------------------------------------------------------------------

import type { DcfModelReportJson } from '../../contracts/valuation';
import { formatCopFromCents, parseMoneyCop, serializeMoneyCop } from '../../contracts/money';
import {
  ZERO,
  RATE_SCALE,
  applyRateCents,
  divRoundHalfUp,
  growCents,
  maxBig,
  minBig,
  moneyDiffers,
  percentDiffers,
  percentToScaled,
  presentValueCents,
  roundPercent,
} from '../calc/fixed-point';
import { recomputeWacc, type ValidationDiscrepancy, type ValidationIssue, type WaccComputed } from './wacc';

export interface DcfComputedRow {
  year: number;
  revenueCop: string;
  ebitdaCop: string;
  ebitCop: string;
  taxCop: string;
  depAmortCop: string;
  capexCop: string;
  workingCapitalChangeCop: string;
  fcfCop: string;
  /** Periodo de descuento (1..n). */
  period: number;
  pvFcfCop: string;
}

export interface DcfSensitivityCell {
  waccPercent: number;
  growthPercent: number;
  /** null cuando g ≥ WACC o WACC ≤ 0 (Gordon no definido). */
  enterpriseValueCop: string | null;
  equityValueCop: string | null;
}

export interface DcfComputed {
  wacc: WaccComputed;
  growthPercent: number;
  rows: DcfComputedRow[];
  sumPvFcfCop: string;
  nextYearFcfCop: string;
  terminalValueCop: string;
  pvTerminalValueCop: string;
  enterpriseValueCop: string;
  /** VP(TV)/EV en %; null si EV ≤ 0. */
  terminalValuePercentOfEv: number | null;
  financialDebtCop: string | null;
  cashAndEquivalentsCop: string | null;
  netDebtCop: string;
  /** true si la deuda neta se derivó de deuda − caja; false si es la declarada sin desglose. */
  netDebtDerived: boolean;
  otherBridgeAdjustmentsCop: string | null;
  equityValueCop: string;
  sharesOutstanding: number | null;
  pricePerShareCop: string | null;
  sensitivity: {
    waccs: number[];
    growths: number[];
    cells: DcfSensitivityCell[];
  };
  /** Rango de patrimonio sobre las celdas válidas de la sensibilidad. */
  equityRange: { lowCop: string; highCop: string };
}

export type DcfValidation =
  | { status: 'ok'; computed: DcfComputed; discrepancies: ValidationDiscrepancy[]; notes: ValidationIssue[] }
  | { status: 'blocked'; blockingErrors: ValidationIssue[]; discrepancies: ValidationDiscrepancy[] };

const fmtCop = (v: bigint) => formatCopFromCents(v, false);
const pct = (v: number) => `${v.toFixed(2)}%`;

interface EvResult {
  pvs: bigint[];
  sumPv: bigint;
  nextYearFcf: bigint;
  terminalValue: bigint;
  pvTerminalValue: bigint;
  enterpriseValue: bigint;
}

/** EV con WACC y g escalados. Precondición: g < WACC, WACC > 0. */
function computeEnterpriseValue(fcfs: readonly bigint[], waccScaled: bigint, growthScaled: bigint): EvResult {
  const pvs = fcfs.map((fcf, i) => presentValueCents(fcf, waccScaled, i + 1));
  const sumPv = pvs.reduce((a, b) => a + b, ZERO);
  const lastFcf = fcfs[fcfs.length - 1];
  const nextYearFcf = growCents(lastFcf, growthScaled);
  const terminalValue = divRoundHalfUp(nextYearFcf * RATE_SCALE, waccScaled - growthScaled);
  const pvTerminalValue = presentValueCents(terminalValue, waccScaled, fcfs.length);
  return { pvs, sumPv, nextYearFcf, terminalValue, pvTerminalValue, enterpriseValue: sumPv + pvTerminalValue };
}

export function validateDcf(json: DcfModelReportJson): DcfValidation {
  const discrepancies: ValidationDiscrepancy[] = [];
  const notes: ValidationIssue[] = [];
  const blocking: ValidationIssue[] = [];

  // -- 1. WACC ---------------------------------------------------------------
  const waccCheck = recomputeWacc(json.wacc);
  discrepancies.push(...waccCheck.discrepancies);
  if (waccCheck.status === 'blocked') blocking.push(...waccCheck.blockingErrors);

  // -- 2. Años consecutivos -----------------------------------------------------
  const rows = json.projection.rows;
  const consecutive = rows.every((r, i) => i === 0 || r.year === rows[i - 1].year + 1);
  if (!consecutive) {
    blocking.push({
      code: 'years_not_consecutive',
      es: `Los años proyectados no son consecutivos y ascendentes (${rows.map((r) => r.year).join(', ')}): el periodo de descuento sería ambiguo.`,
      en: `Projected years are not consecutive and ascending (${rows.map((r) => r.year).join(', ')}): discount periods would be ambiguous.`,
    });
  }

  // -- 3. g < WACC ---------------------------------------------------------------
  const growthPercent = roundPercent(json.terminalValue.perpetualGrowthPercent);
  if (waccCheck.status === 'ok' && growthPercent >= waccCheck.computed.waccPercent) {
    blocking.push({
      code: 'growth_not_below_wacc',
      es: `g (${pct(growthPercent)}) ≥ WACC recalculado (${pct(waccCheck.computed.waccPercent)}): el valor terminal de Gordon no está definido. DCF no emitible.`,
      en: `g (${pct(growthPercent)}) ≥ recomputed WACC (${pct(waccCheck.computed.waccPercent)}): the Gordon terminal value is undefined. DCF cannot be issued.`,
    });
  }

  const shares = json.valuation.sharesOutstanding;
  if (shares !== null && shares <= 0) {
    blocking.push({
      code: 'shares_not_positive',
      es: `Número de acciones en circulación no positivo (${shares}).`,
      en: `Non-positive number of shares outstanding (${shares}).`,
    });
  }

  if (blocking.length > 0 || waccCheck.status !== 'ok') {
    return { status: 'blocked', blockingErrors: blocking, discrepancies };
  }

  const wacc = waccCheck.computed;
  if (percentDiffers(json.terminalValue.waccPercent, wacc.waccPercent)) {
    discrepancies.push({
      field: 'WACC (valor terminal)',
      reported: pct(json.terminalValue.waccPercent),
      recomputed: pct(wacc.waccPercent),
    });
  }

  // -- 4. FCF por año --------------------------------------------------------------
  const taxScaled = percentToScaled(json.wacc.taxRatePercent);
  const fcfs: bigint[] = [];
  const partialRows = rows.map((r) => {
    const ebit = parseMoneyCop(r.ebitCop);
    const da = parseMoneyCop(r.depAmortCop);
    const capex = parseMoneyCop(r.capexCop);
    const dwc = parseMoneyCop(r.workingCapitalChangeCop);
    const tax = ebit > ZERO ? applyRateCents(ebit, taxScaled) : ZERO;
    const ebitda = ebit + da;
    const fcf = ebit - tax + da - capex - dwc;
    fcfs.push(fcf);

    const reportedEbitda = parseMoneyCop(r.ebitdaCop);
    const reportedTax = parseMoneyCop(r.taxCop);
    const reportedFcf = parseMoneyCop(r.fcfCop);
    if (moneyDiffers(reportedEbitda, ebitda)) {
      discrepancies.push({ field: `EBITDA ${r.year}`, reported: fmtCop(reportedEbitda), recomputed: fmtCop(ebitda) });
    }
    if (moneyDiffers(reportedTax, tax)) {
      discrepancies.push({ field: `Impuesto operacional ${r.year}`, reported: fmtCop(reportedTax), recomputed: fmtCop(tax) });
    }
    if (moneyDiffers(reportedFcf, fcf)) {
      discrepancies.push({ field: `FCF ${r.year}`, reported: fmtCop(reportedFcf), recomputed: fmtCop(fcf) });
    }
    if (capex < ZERO) {
      notes.push({
        code: 'negative_capex',
        es: `CAPEX ${r.year} negativo: se interpreta como desinversión (entrada de caja).`,
        en: `Negative CAPEX ${r.year}: treated as divestment (cash inflow).`,
      });
    }
    return { r, ebit, da, capex, dwc, tax, ebitda, fcf };
  });

  // -- 5. Valor terminal y EV ------------------------------------------------------
  const waccScaled = percentToScaled(wacc.waccPercent);
  const growthScaled = percentToScaled(growthPercent);
  const ev = computeEnterpriseValue(fcfs, waccScaled, growthScaled);

  const reportedNext = parseMoneyCop(json.terminalValue.nextYearFcfCop);
  if (moneyDiffers(reportedNext, ev.nextYearFcf)) {
    discrepancies.push({ field: 'FCF(n+1)', reported: fmtCop(reportedNext), recomputed: fmtCop(ev.nextYearFcf) });
  }
  const reportedTv = parseMoneyCop(json.terminalValue.terminalValueCop);
  if (moneyDiffers(reportedTv, ev.terminalValue)) {
    discrepancies.push({ field: 'TV', reported: fmtCop(reportedTv), recomputed: fmtCop(ev.terminalValue) });
  }
  const reportedEv = parseMoneyCop(json.valuation.enterpriseValueCop);
  if (moneyDiffers(reportedEv, ev.enterpriseValue)) {
    discrepancies.push({ field: 'Enterprise Value', reported: fmtCop(reportedEv), recomputed: fmtCop(ev.enterpriseValue) });
  }
  const tvPercent = ev.enterpriseValue > ZERO
    ? Math.round((Number(ev.pvTerminalValue) / Number(ev.enterpriseValue)) * 10_000) / 100
    : null;
  if (tvPercent !== null && Math.abs(json.terminalValue.terminalValuePercentOfTotal - tvPercent) > 0.1) {
    discrepancies.push({
      field: 'VP(TV) / EV',
      reported: pct(json.terminalValue.terminalValuePercentOfTotal),
      recomputed: pct(tvPercent),
    });
  }
  if (ev.terminalValue <= ZERO) {
    notes.push({
      code: 'terminal_value_not_positive',
      es: 'FCF(n+1) no positivo: el valor terminal es ≤ 0 y el negocio destruye valor en perpetuidad bajo estos supuestos.',
      en: 'Non-positive FCF(n+1): terminal value ≤ 0; the business destroys value in perpetuity under these assumptions.',
    });
  }

  // -- 6. Puente EV → patrimonio -----------------------------------------------------
  const v = json.valuation;
  const reportedNetDebt = parseMoneyCop(v.netDebtCop);
  let netDebt = reportedNetDebt;
  let netDebtDerived = false;
  if (v.financialDebtCop !== null && v.cashAndEquivalentsCop !== null) {
    netDebt = parseMoneyCop(v.financialDebtCop) - parseMoneyCop(v.cashAndEquivalentsCop);
    netDebtDerived = true;
    if (moneyDiffers(reportedNetDebt, netDebt)) {
      discrepancies.push({ field: 'Deuda neta', reported: fmtCop(reportedNetDebt), recomputed: fmtCop(netDebt) });
    }
  } else {
    notes.push({
      code: 'net_debt_not_itemized',
      es: 'Deuda neta sin desglose (deuda financiera y efectivo): se usa la cifra declarada sin poder verificar su composición.',
      en: 'Net debt not itemized (financial debt and cash): the declared figure is used without verifying its composition.',
    });
  }
  const adjustments = v.otherBridgeAdjustmentsCop !== null ? parseMoneyCop(v.otherBridgeAdjustmentsCop) : ZERO;
  const equityOf = (enterpriseValue: bigint) => enterpriseValue - netDebt + adjustments;
  const equity = equityOf(ev.enterpriseValue);
  const reportedEquity = parseMoneyCop(v.equityValueCop);
  if (moneyDiffers(reportedEquity, equity)) {
    discrepancies.push({ field: 'Equity Value', reported: fmtCop(reportedEquity), recomputed: fmtCop(equity) });
  }

  let pricePerShare: bigint | null = null;
  if (shares !== null) {
    pricePerShare = divRoundHalfUp(equity, BigInt(shares));
    if (v.pricePerShareCop !== null && moneyDiffers(parseMoneyCop(v.pricePerShareCop), pricePerShare)) {
      discrepancies.push({
        field: 'Precio por acción',
        reported: fmtCop(parseMoneyCop(v.pricePerShareCop)),
        recomputed: fmtCop(pricePerShare),
      });
    }
  } else if (v.pricePerShareCop !== null) {
    discrepancies.push({
      field: 'Precio por acción',
      reported: fmtCop(parseMoneyCop(v.pricePerShareCop)),
      recomputed: 'N/D (sin número de acciones)',
    });
  }

  // -- 7. Sensibilidad WACC × g (en código) --------------------------------------------
  const waccs = [-2, -1, 0, 1, 2].map((d) => roundPercent(wacc.waccPercent + d));
  const growths = [-1, -0.5, 0, 0.5, 1].map((d) => roundPercent(growthPercent + d));
  const cells: DcfSensitivityCell[] = [];
  const validEquities: bigint[] = [];
  for (const wp of waccs) {
    for (const gp of growths) {
      if (wp <= 0 || gp >= wp) {
        cells.push({ waccPercent: wp, growthPercent: gp, enterpriseValueCop: null, equityValueCop: null });
        continue;
      }
      const cellEv = computeEnterpriseValue(fcfs, percentToScaled(wp), percentToScaled(gp)).enterpriseValue;
      const cellEquity = equityOf(cellEv);
      validEquities.push(cellEquity);
      cells.push({
        waccPercent: wp,
        growthPercent: gp,
        enterpriseValueCop: serializeMoneyCop(cellEv),
        equityValueCop: serializeMoneyCop(cellEquity),
      });
    }
  }
  // La celda base siempre es válida (g < WACC comprobado arriba).
  const equityLow = minBig(validEquities);
  const equityHigh = maxBig(validEquities);

  const computedRows: DcfComputedRow[] = partialRows.map((p, i) => ({
    year: p.r.year,
    revenueCop: p.r.revenueCop,
    ebitdaCop: serializeMoneyCop(p.ebitda),
    ebitCop: serializeMoneyCop(p.ebit),
    taxCop: serializeMoneyCop(p.tax),
    depAmortCop: serializeMoneyCop(p.da),
    capexCop: serializeMoneyCop(p.capex),
    workingCapitalChangeCop: serializeMoneyCop(p.dwc),
    fcfCop: serializeMoneyCop(p.fcf),
    period: i + 1,
    pvFcfCop: serializeMoneyCop(ev.pvs[i]),
  }));

  return {
    status: 'ok',
    discrepancies,
    notes,
    computed: {
      wacc,
      growthPercent,
      rows: computedRows,
      sumPvFcfCop: serializeMoneyCop(ev.sumPv),
      nextYearFcfCop: serializeMoneyCop(ev.nextYearFcf),
      terminalValueCop: serializeMoneyCop(ev.terminalValue),
      pvTerminalValueCop: serializeMoneyCop(ev.pvTerminalValue),
      enterpriseValueCop: serializeMoneyCop(ev.enterpriseValue),
      terminalValuePercentOfEv: tvPercent,
      financialDebtCop: v.financialDebtCop,
      cashAndEquivalentsCop: v.cashAndEquivalentsCop,
      netDebtCop: serializeMoneyCop(netDebt),
      netDebtDerived,
      otherBridgeAdjustmentsCop: v.otherBridgeAdjustmentsCop,
      equityValueCop: serializeMoneyCop(equity),
      sharesOutstanding: shares,
      pricePerShareCop: pricePerShare === null ? null : serializeMoneyCop(pricePerShare),
      sensitivity: { waccs, growths, cells },
      equityRange: { lowCop: serializeMoneyCop(equityLow), highCop: serializeMoneyCop(equityHigh) },
    },
  };
}
