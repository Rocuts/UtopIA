// ---------------------------------------------------------------------------
// Validator JSON-strict del Pipeline Financiero (Fase 3.3)
// ---------------------------------------------------------------------------
//
// Valida `NiifReportJson` directamente, sin regex sobre Markdown. Las cifras
// viajan tipadas en centavos (`MoneyCop`), así que los cuadres invariantes
// se verifican con TOLERANCIA EXACTA $0 — un orden de magnitud más estricto
// que el validator legacy (`report-validator.ts`, 1%).
//
// Reglas Elite Protocol Capa 1 (Integridad Aritmética):
//   E1. Ecuación patrimonial: TotalAssets = TotalLiabilities + TotalEquity
//   E2. Identidad EFE final: cashClosing = cashOpening + sum(netFlow secciones)
//   E3. EFE final = PUC 11 Balance (efectivo y equivalentes)
//   E4. ECP saldo final = Patrimonio Balance
//   E5. Coherencia Net Income ↔ Operating Profit ↔ Gross Profit
//   E6. ORI Income Statement coincide con ORI Equity Changes
//
// El validator legacy `validateConsolidatedReport` queda en uso para reglas
// que tocan estructura Markdown (placeholders, secciones PARTE I/II/III) que
// no aplican al JSON. Los dos son complementarios.
//
// Devuelve `ReportValidationResult` (mismo shape que el legacy) para que el
// orchestrator pueda sumar errores/warnings sin discriminar el origen.
// ---------------------------------------------------------------------------

import { moneyCopEquals, parseMoneyCop, serializeMoneyCop } from '../contracts/money';
import type { NiifReportJson, EquityChangeRowJson } from '../contracts/niif-report';
import type { ReportValidationResult } from '../types';

const ZERO = BigInt(0);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function diffCents(a: string, b: string): bigint {
  return parseMoneyCop(a) - parseMoneyCop(b);
}

function fmtCop(cents: bigint): string {
  const abs = cents < ZERO ? -cents : cents;
  const s = abs.toString().padStart(3, '0');
  const whole = (s.slice(0, -2) || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cents < ZERO ? '-' : ''}$${whole},${s.slice(-2)}`;
}

function findEquityClosingRow(json: NiifReportJson): EquityChangeRowJson | null {
  for (let i = json.equityChanges.rows.length - 1; i >= 0; i--) {
    const r = json.equityChanges.rows[i];
    if (r.kind === 'closing_balance') return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Validador principal
// ---------------------------------------------------------------------------

/**
 * Valida los invariantes aritméticos del NiifReport. Tolerancia exacta $0
 * (cero centavos) porque las cifras viajan como BigInt serializado, sin
 * pérdida de precisión.
 *
 * @param json     Output del NIIF Analyst validado por Zod.
 * @param options  `cashAccountPuc11` opcional: cifra de Efectivo (PUC 11) en
 *                 centavos según el preprocessor — para cruzar contra el cash
 *                 closing del EFE.
 */
export function validateNiifReportJson(
  json: NiifReportJson,
  options: { cashAccountPuc11Cents?: string } = {},
): ReportValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // -- E1. Ecuación patrimonial -----------------------------------------------
  const bs = json.balanceSheet;
  const sumLiabEq = serializeMoneyCop(
    parseMoneyCop(bs.totalLiabilitiesPrimary) + parseMoneyCop(bs.totalEquityPrimary),
  );
  if (!moneyCopEquals(bs.totalAssetsPrimary, sumLiabEq)) {
    const gap = diffCents(bs.totalAssetsPrimary, sumLiabEq);
    errors.push(
      `E1. Ecuación patrimonial rota: TotalAssets ≠ TotalLiabilities + TotalEquity. ` +
        `Brecha: ${fmtCop(gap)}.`,
    );
  }
  if (bs.totalAssetsComparative !== null && bs.totalLiabilitiesComparative !== null && bs.totalEquityComparative !== null) {
    const sumLiabEqCmp = serializeMoneyCop(
      parseMoneyCop(bs.totalLiabilitiesComparative) + parseMoneyCop(bs.totalEquityComparative),
    );
    if (!moneyCopEquals(bs.totalAssetsComparative, sumLiabEqCmp)) {
      const gap = diffCents(bs.totalAssetsComparative, sumLiabEqCmp);
      errors.push(`E1. Ecuación patrimonial rota en periodo comparativo. Brecha: ${fmtCop(gap)}.`);
    }
  }

  // -- E2. Identidad EFE -----------------------------------------------------
  const cf = json.cashFlow;
  const sumNetFlows = serializeMoneyCop(
    cf.sections.reduce((acc, s) => acc + parseMoneyCop(s.netFlow), ZERO),
  );
  if (!moneyCopEquals(cf.netChange, sumNetFlows)) {
    const gap = diffCents(cf.netChange, sumNetFlows);
    errors.push(`E2. netChange ≠ Σ(netFlow secciones). Brecha: ${fmtCop(gap)}.`);
  }
  const expectedClosing = serializeMoneyCop(parseMoneyCop(cf.cashOpening) + parseMoneyCop(cf.netChange));
  if (!moneyCopEquals(cf.cashClosing, expectedClosing)) {
    const gap = diffCents(cf.cashClosing, expectedClosing);
    errors.push(`E2. cashClosing ≠ cashOpening + netChange. Brecha: ${fmtCop(gap)}.`);
  }

  // -- E3. EFE final == PUC 11 Balance ---------------------------------------
  if (options.cashAccountPuc11Cents !== undefined) {
    if (!moneyCopEquals(cf.cashClosing, options.cashAccountPuc11Cents)) {
      const gap = diffCents(cf.cashClosing, options.cashAccountPuc11Cents);
      errors.push(
        `E3. EFE cashClosing ≠ PUC 11 (Efectivo y Equivalentes) del Balance. Brecha: ${fmtCop(gap)}.`,
      );
    }
  }

  // -- E4. ECP saldo final == Patrimonio Balance -----------------------------
  const closing = findEquityClosingRow(json);
  if (!closing) {
    errors.push(`E4. ECP no contiene fila tipo "closing_balance".`);
  } else if (!moneyCopEquals(closing.total, bs.totalEquityPrimary)) {
    const gap = diffCents(closing.total, bs.totalEquityPrimary);
    errors.push(`E4. ECP saldo final ≠ Total Patrimonio Balance. Brecha: ${fmtCop(gap)}.`);
  }

  // -- E5. Coherencia P&G -----------------------------------------------------
  // Gross >= Operating implícito (en presentación absoluta NIIF Analyst).
  // Operating >= NetIncome típico (después de financieros + impuestos).
  // Estos son soft checks — pueden romperse en empresas con resultados financieros positivos altos.
  const gross = parseMoneyCop(json.incomeStatement.grossProfitPrimary);
  const op = parseMoneyCop(json.incomeStatement.operatingProfitPrimary);
  const net = parseMoneyCop(json.incomeStatement.netIncomePrimary);
  if (gross < op) {
    warnings.push(
      `E5. GrossProfit (${fmtCop(gross)}) < OperatingProfit (${fmtCop(op)}). ` +
        `Inusual — verificar otros ingresos operacionales o reclasificaciones.`,
    );
  }
  if (op < net && net > ZERO) {
    warnings.push(
      `E5. OperatingProfit (${fmtCop(op)}) < NetIncome (${fmtCop(net)}). ` +
        `Posible — empresa con resultados financieros / no operacionales netos positivos. Verificar.`,
    );
  }

  // -- E6. ORI cruzado P&G ↔ ECP --------------------------------------------
  const oriPnl = parseMoneyCop(json.incomeStatement.oriPrimary);
  if (closing) {
    const openingRow = json.equityChanges.rows.find((r) => r.kind === 'opening_balance');
    if (openingRow) {
      const oriDelta = parseMoneyCop(closing.ori) - parseMoneyCop(openingRow.ori);
      if (oriDelta !== oriPnl) {
        const gap = oriDelta - oriPnl;
        warnings.push(
          `E6. Δ(ORI) en ECP (${fmtCop(oriDelta)}) ≠ ORI del P&G (${fmtCop(oriPnl)}). Brecha: ${fmtCop(gap)}.`,
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
