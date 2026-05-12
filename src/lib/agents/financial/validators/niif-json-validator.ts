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
 * @param options  Anclas del preprocessor para checks cruzados:
 *   - `cashAccountPuc11Cents`: Efectivo (PUC 11) en centavos — cruza contra cashClosing del EFE.
 *   - `totalExpensesClass5Cents`: Total Clase 5 preprocesado — detecta duplicación Grupo 53.
 */
export function validateNiifReportJson(
  json: NiifReportJson,
  options: { cashAccountPuc11Cents?: string; totalExpensesClass5Cents?: string } = {},
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

  // -- E7. Utilidad Neta P&L vs Variación 3605 ECP (Parte 8.1 CHECK 2 spec v2.0) --
  //
  // El incremento de resultadoEjercicio entre opening_balance y closing_balance
  // del ECP DEBE coincidir con la Utilidad Neta del P&L del periodo.
  // Tolerancia 0.5% para absorber redondeos de cents → pesos en presentación.
  // Capa 1 Elite Protocol — invariante de consistencia entre EEFF.
  {
    const openingRow = json.equityChanges.rows.find((r) => r.kind === 'opening_balance');
    if (!openingRow || !closing) {
      errors.push('E7. ECP debe incluir opening_balance y closing_balance para verificar Utilidad Neta.');
    } else {
      const openingResult = parseMoneyCop(openingRow.resultadoEjercicio);
      const closingResult = parseMoneyCop(closing.resultadoEjercicio);
      const delta = closingResult - openingResult;
      const netIncome = parseMoneyCop(json.incomeStatement.netIncomePrimary);
      const absNetIncome = netIncome < ZERO ? -netIncome : netIncome;
      // Tolerancia: 0.5% del netIncome (mín $10.000 cents = $100 COP para casos cercanos a cero)
      const tolerance = absNetIncome / BigInt(200) + BigInt(10000);
      const diff = delta > netIncome ? delta - netIncome : netIncome - delta;
      if (diff > tolerance) {
        errors.push(
          `E7. Variación resultadoEjercicio ECP (${fmtCop(delta)}) ≠ Utilidad Neta P&L (${fmtCop(netIncome)}); ` +
            `diferencia ${fmtCop(diff)} excede tolerancia ${fmtCop(tolerance)}. ` +
            `Capa 1 Elite — Parte 8.1 CHECK 2 spec v2.0.`,
        );
      }
    }
  }

  // -- E8. Anti-duplicación Grupo 53 (Parte 8.1 CHECK 4 spec v2.0) -----------
  //
  // Verifica que Σ líneas de incomeStatement con código de cuenta que empieza
  // por '5' NO excede `totalExpensesClass5Cents` del preprocessor. Si el LLM
  // listó "Grupo 53 (total)" y también subcuentas "5305", "5395" como líneas
  // independientes, la suma será mayor que el total real de Clase 5.
  // Tolerancia 1% del total anchored (mín $100.000 cents = $1.000 COP).
  // Capa 1 Elite Protocol — anti-doble-contabilización.
  if (options.totalExpensesClass5Cents !== undefined) {
    const totalAnchored = parseMoneyCop(options.totalExpensesClass5Cents);
    const absAnchored = totalAnchored < ZERO ? -totalAnchored : totalAnchored;
    let sumLines = ZERO;
    for (const line of json.incomeStatement.lines) {
      if (line.account !== null && line.account.startsWith('5')) {
        const lineAmt = parseMoneyCop(line.amountPrimary);
        sumLines += lineAmt < ZERO ? -lineAmt : lineAmt;
      }
    }
    // Tolerancia: 1% del total anchored + $100.000 cents floor
    const tolerance = absAnchored / BigInt(100) + BigInt(100000);
    if (sumLines > absAnchored + tolerance) {
      errors.push(
        `E8. Σ líneas Clase 5 en incomeStatement (${fmtCop(sumLines)}) excede total preprocesado ` +
          `(${fmtCop(absAnchored)}) en más de tolerancia (${fmtCop(tolerance)}). ` +
          `Posible duplicación Grupo 53 + subcuentas 5305/5395 — Parte 8.1 CHECK 4 spec v2.0.`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
