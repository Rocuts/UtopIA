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
//   E9. Comparativo completo: cuando comparativePeriod != null TODOS los
//       6 totales *Comparative (3 Balance + 3 P&L) son non-null y cuadran la
//       ecuación patrimonial al centavo. Si el preprocesador suministra
//       `bindingComparativeTotalsCents`, los totales emitidos se cruzan
//       contra esa fuente con tolerancia $0. Esta regla cierra la grieta
//       2026-05-14 donde el LLM null-eaba comparativos silenciosamente —
//       Pass-1 era libre de devolver null para *Comparative y el validator
//       lo aceptaba.
//  E10. Corrección v2.4 — flujos ficticios PROHIBIDOS en cashFlow.sections.
//       Bloquea labels que materializan el asiento contable de cierre
//       Cta.3605 como "flujo" de caja (típicamente en financing): el LLM
//       lo usaba como comodín para hacer cuadrar el EFE en lugar de
//       (a) incluir un ajuste no-cash en operating por el saldo inicial
//       Cta.3605, (b) revisar variaciones de capital de trabajo, o (c)
//       emitir degeneracyFlag. Sustento: NIC 7 §18(b) (método indirecto:
//       ajustes son partidas no monetarias y cambios en WC, no transferencias
//       contables internas). Defensa Art. 647 E.T.: la salida ficticia
//       distorsiona el flujo informado a la DIAN sin sustento documental.
//
// El validator legacy `validateConsolidatedReport` queda en uso para reglas
// que tocan estructura Markdown (placeholders, secciones PARTE I/II/III) que
// no aplican al JSON. Los dos son complementarios.
//
// Devuelve `ReportValidationResult` (mismo shape que el legacy) para que el
// orchestrator pueda sumar errores/warnings sin discriminar el origen.
// ---------------------------------------------------------------------------

import { sumStatementDetail } from '../contracts/statement-lines';
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
 * Anclas del preprocessor para cruzar contra el output del LLM.
 *
 * `bindingComparativeTotalsCents` es opcional: cuando se suministra, los seis
 * totales del periodo comparativo emitidos por Pass-1 se cruzan al centavo
 * contra los totales pre-calculados por el preprocesador. Esta es la red
 * dura que evita que el LLM "redondee" o re-derive las cifras del periodo
 * anterior — la única autoridad numérica es el preprocesador.
 *
 * `presentationV3` es opcional: cuando se suministra con componentes ORI
 * materiales (`oriComponents.length > 0`), E13 verifica que la suma de los
 * componentes ORI coincide con `oriPrimary` del P&L (desglose ↔ total).
 */
export interface NiifJsonValidatorOptions {
  cashAccountPuc11Cents?: string;
  totalExpensesClass5Cents?: string;
  bindingComparativeTotalsCents?: {
    totalAssets?: string;
    totalLiabilities?: string;
    totalEquity?: string;
    grossProfit?: string;
    operatingProfit?: string;
    netIncome?: string;
  };
  /**
   * E14 — anclas del periodo PRIMARIO (el año que el cliente firma).
   *
   * Auditoría 2026-08 (P0 `totales-primarios-nunca-cruzados-contra-preprocesador`):
   * hasta esta versión sólo se cruzaba el periodo COMPARATIVO. Del periodo
   * actual el único control era E1 —`totalAssets = totalLiabilities +
   * totalEquity`—, que es coherencia INTERNA: el LLM podía emitir un balance
   * entero inventado y, mientras cuadrara consigo mismo, el validador daba OK.
   * En modo LINEA_BASE (sin comparativo) eso significaba que NINGUNA cifra del
   * informe se contrastaba contra la fuente determinista.
   */
  bindingPrimaryTotalsCents?: {
    totalAssets?: string;
    totalLiabilities?: string;
    totalEquity?: string;
    netIncome?: string;
    /**
     * Utilidad Bruta y EBIT del periodo primario. Auditoría 2026-08
     * (superficie 5, P&G): eran CUATRO cifras libres —UB y EBIT en los dos
     * periodos—. Medido: `+$500.000.000` en `grossProfitPrimary` producía 0
     * errores, 0 warnings, `clean=true` y descarga habilitada, y la cifra
     * falsa se promovía a *binding figure* del HTML, donde
     * `reconcileBindingFigures` EXIGE reproducirla literalmente: el sistema
     * certificaba fidelidad a un número que nadie había verificado.
     */
    grossProfit?: string;
    operatingProfit?: string;
    utilidadAntesImpuestos?: string;
    impuestoCausado?: string;
  };
  presentationV3?: import('@/lib/agents/financial/prompts/presentation-v3').PresentationV3Data;
}

/**
 * Valida los invariantes aritméticos del NiifReport. Tolerancia exacta $0
 * (cero centavos) porque las cifras viajan como BigInt serializado, sin
 * pérdida de precisión.
 *
 * @param json     Output del NIIF Analyst validado por Zod.
 * @param options  Anclas del preprocessor para checks cruzados:
 *   - `cashAccountPuc11Cents`: Efectivo (PUC 11) en centavos — cruza contra cashClosing del EFE.
 *   - `totalExpensesClass5Cents`: Total Clase 5 preprocesado — detecta duplicación Grupo 53.
 *   - `bindingComparativeTotalsCents`: Totales del periodo comparativo —
 *      cruza E9 contra el preprocesador (tolerancia $0).
 */
export function validateNiifReportJson(
  json: NiifReportJson,
  options: NiifJsonValidatorOptions = {},
): ReportValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // -- E14. Anclaje del periodo PRIMARIO al preprocesador ---------------------
  //
  // Va PRIMERO a propósito. E1 sólo comprueba que el balance cuadre consigo
  // mismo, y un balance completamente inventado cuadra consigo mismo sin
  // esfuerzo. E14 es lo que ata el reporte a la realidad del archivo que
  // subió el cliente. Tolerancia $0: las cifras del preprocesador son exactas
  // en centavos y el LLM sólo tiene que copiarlas.
  const bs = json.balanceSheet;
  const bpt = options.bindingPrimaryTotalsCents;
  if (bpt) {
    const anchorCheck = (
      label: string,
      emitted: string | null | undefined,
      expected: string | undefined,
    ) => {
      if (emitted === null || emitted === undefined || expected === undefined) return;
      if (!moneyCopEquals(emitted, expected)) {
        const gap = diffCents(emitted, expected);
        errors.push(
          `E14. ${label} del periodo ${json.company.fiscalPeriod} emitido por el analista ` +
            `(${fmtCop(parseMoneyCop(emitted))}) ≠ preprocesador ` +
            `(${fmtCop(parseMoneyCop(expected))}). Brecha: ${fmtCop(gap)}. ` +
            `La cifra vinculante es la del preprocesador; el analista debe copiarla literalmente ` +
            `desde el token [MoneyCop: N] del bloque TOTALES VINCULANTES.`,
        );
      }
    };
    anchorCheck('TotalAssets', bs.totalAssetsPrimary, bpt.totalAssets);
    anchorCheck('TotalLiabilities', bs.totalLiabilitiesPrimary, bpt.totalLiabilities);
    anchorCheck('TotalEquity', bs.totalEquityPrimary, bpt.totalEquity);
    anchorCheck('NetIncome', json.incomeStatement.netIncomePrimary, bpt.netIncome);
    // Utilidad Bruta y EBIT. Sólo se pueden anclar DESPUÉS de la corrección de
    // la doble resta de las devoluciones 4175 (`trial-balance.ts`, ola 1
    // 2026-08): anclarlas antes habría cementado la cifra equivocada, que es
    // exactamente lo que la auditoría advirtió.
    anchorCheck('GrossProfit', json.incomeStatement.grossProfitPrimary, bpt.grossProfit);
    anchorCheck(
      'OperatingProfit (EBIT)',
      json.incomeStatement.operatingProfitPrimary,
      bpt.operatingProfit,
    );
  }

  // -- E1. Ecuación patrimonial -----------------------------------------------
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
  // E1 comparativo: SOLO un soft-check aquí — si los tres totales viajan,
  // verificar que cuadren. La regla DURA que exige que los tres existan
  // cuando hay periodo comparativo vive en E9 (al final), porque depende
  // de `json.company.comparativePeriod`.
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
  // Wave v2.2 corrección #3: EBIT (operatingProfitPrimary) NO deduce Grupo 53;
  // por tanto, salvo Grupo 53 = $0 y impuesto = $0, operatingProfit != netIncome.
  // Cuando el LLM iguala ambos, ha deducido Grupo 53 dentro del EBIT y producido
  // un P&L estructuralmente incorrecto (UAI desaparece como subtotal). Esto se
  // promueve a error duro cuando |op − net| < $1.000 (centavos 100_000) y
  // |netIncome| > $1.000.000 (mantenemos la tolerancia en empresas pequeñas
  // donde Grupo 53 = $0 e impuesto = $0 son escenarios reales).
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
  {
    const opMinusNet = op > net ? op - net : net - op;
    const absNet = net < ZERO ? -net : net;
    const EQUALITY_TOL = BigInt(100000); // $1.000 COP en centavos
    const NET_MATERIAL = BigInt(100000000); // $1.000.000 COP en centavos
    const hasSourceProfits = bpt?.operatingProfit !== undefined && bpt.netIncome !== undefined;
    const sourceProfitsDiffer = hasSourceProfits &&
      !moneyCopEquals(bpt!.operatingProfit!, bpt!.netIncome!);
    // Equality is valid when there are no net below-EBIT expenses. Materiality
    // alone cannot establish an accounting error; E14 checks source anchors.
    if (opMinusNet < EQUALITY_TOL && absNet > NET_MATERIAL &&
        (!hasSourceProfits || sourceProfitsDiffer)) {
      const messages = sourceProfitsDiffer ? errors : warnings;
      messages.push(
        `E5. EBIT incorrectamente igualado a Utilidad Neta — el Grupo 53 debe deducirse DESPUÉS del EBIT. ` +
          `operatingProfitPrimary (${fmtCop(op)}) ≈ netIncomePrimary (${fmtCop(net)}); ` +
          `diferencia ${fmtCop(opMinusNet)} < tolerancia ${fmtCop(EQUALITY_TOL)} con netIncome material. ` +
          `Revisar cascada: EBIT = grossProfit − Grupo 51 − Grupo 52; UAI = EBIT − Grupo 53; netIncome = UAI − impuesto.`,
      );
    }
  }

  // E17: every printed ECP row must equal the sum of its seven components.
  // Column checks alone allow an invented amount in both opening and closing.
  const equityComponents = [
    'capitalSocial', 'primaColocacion', 'reservaLegal', 'otrasReservas',
    'resultadosAcumulados', 'resultadoEjercicio', 'ori',
  ] as const;
  for (const [index, row] of json.equityChanges.rows.entries()) {
    const sum = equityComponents.reduce((acc, key) => acc + parseMoneyCop(row[key]), ZERO);
    const total = parseMoneyCop(row.total);
    if (sum !== total) {
      errors.push(
        `E17. ECP fila ${index + 1} (${row.kind}): suma de componentes ` +
        `${fmtCop(sum)} ≠ total ${fmtCop(total)}. Brecha: ${fmtCop(sum - total)}.`,
      );
    }
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

  // -- E7. Utilidad Neta del periodo registrada en el ECP (v2.5) ------------
  //
  // Antes (v2.0) se comparaba el delta `closing.resultadoEjercicio −
  // opening.resultadoEjercicio` contra netIncomePrimary. Esa heurística
  // fallaba cuando el opening_balance arrastraba el resultado del periodo
  // anterior (PUC 3605 no cerrado vía asiento Dr.3605/Cr.3705 al cierre
  // prior — práctica común en SAS colombianas donde 3605 se "sobreescribe"
  // anualmente).
  //
  // v2.5 introduce el modo matricial estricto cuando existe fila
  // `profit_for_period`:
  //   E7a — profit_for_period.resultadoEjercicio == netIncomePrimary.
  //   E7b — Si opening_balance.resultadoEjercicio es material y ≠ 0,
  //         DEBE existir una fila prior_period_result_cancellation con
  //         resultadoEjercicio = -opening.resultadoEjercicio.
  //   E7c — Cuadre matricial: opening + Σ(movement rows) == closing,
  //         columna a columna, tolerancia $1.000 COP.
  //
  // Modo legacy (sin profit_for_period): delta opening→closing como
  // proxy, válido SOLO cuando opening.resultadoEjercicio no es material.
  {
    const openingRow = json.equityChanges.rows.find((r) => r.kind === 'opening_balance');
    const profitRow = json.equityChanges.rows.find((r) => r.kind === 'profit_for_period');
    const cancellationRow = json.equityChanges.rows.find(
      (r) => r.kind === 'prior_period_result_cancellation',
    );

    if (!openingRow || !closing) {
      errors.push('E7. ECP debe incluir opening_balance y closing_balance.');
    } else {
      const netIncome = parseMoneyCop(json.incomeStatement.netIncomePrimary);
      const absNetIncome = netIncome < ZERO ? -netIncome : netIncome;
      // Tolerancia: 0.5% del netIncome (mín $10.000 cents = $100 COP para casos cercanos a cero)
      const tolerance = absNetIncome / BigInt(200) + BigInt(10000);
      const openingResult = parseMoneyCop(openingRow.resultadoEjercicio);
      const absOpeningResult = openingResult < ZERO ? -openingResult : openingResult;
      const MATERIALITY = BigInt(100_000_000); // $1.000.000 COP en centavos

      if (profitRow) {
        // -- Modo v2.5 -----------------------------------------------------
        // E7a — profit_for_period autoritativo.
        const profitInEcp = parseMoneyCop(profitRow.resultadoEjercicio);
        const diff = profitInEcp > netIncome ? profitInEcp - netIncome : netIncome - profitInEcp;
        if (diff > tolerance) {
          errors.push(
            `E7a. ECP fila profit_for_period.resultadoEjercicio (${fmtCop(profitInEcp)}) ≠ ` +
              `Utilidad Neta P&L (${fmtCop(netIncome)}); diferencia ${fmtCop(diff)} ` +
              `excede tolerancia ${fmtCop(tolerance)}. Parte 8.1 CHECK 2 spec v2.5.`,
          );
        }

        // E7b — Cancelación obligatoria si opening arrastra resultado prior material.
        if (absOpeningResult > MATERIALITY) {
          if (!cancellationRow) {
            errors.push(
              `E7b. ECP: opening_balance.resultadoEjercicio material (${fmtCop(openingResult)}) ` +
                `exige fila kind="prior_period_result_cancellation" que cancele ese saldo. ` +
                `Cierre contable PUC 3605 no trasladado a PUC 37 al cierre prior (v2.5).`,
            );
          } else {
            const cancellation = parseMoneyCop(cancellationRow.resultadoEjercicio);
            const expected = -openingResult;
            const cancelDiff =
              cancellation > expected ? cancellation - expected : expected - cancellation;
            if (cancelDiff > BigInt(10000)) {
              errors.push(
                `E7b. ECP fila prior_period_result_cancellation.resultadoEjercicio ` +
                  `(${fmtCop(cancellation)}) ≠ -opening_balance.resultadoEjercicio ` +
                  `(${fmtCop(expected)}); diferencia ${fmtCop(cancelDiff)} excede $100 COP. v2.5.`,
              );
            }
          }
        }

        // E7c — Cuadre matricial columna a columna.
        const cols = [
          'capitalSocial',
          'primaColocacion',
          'reservaLegal',
          'otrasReservas',
          'resultadosAcumulados',
          'resultadoEjercicio',
          'ori',
          'total',
        ] as const;
        const TOL = BigInt(100_000); // $1.000 COP en centavos
        for (const col of cols) {
          const computed = json.equityChanges.rows.reduce<bigint>((acc, row) => {
            if (row.kind === 'closing_balance') return acc;
            return acc + parseMoneyCop(row[col]);
          }, ZERO);
          const closingVal = parseMoneyCop(closing[col]);
          const diff = computed > closingVal ? computed - closingVal : closingVal - computed;
          if (diff > TOL) {
            errors.push(
              `E7c. ECP columna "${col}" no cuadra: Σ filas (${fmtCop(computed)}) ≠ ` +
                `closing_balance (${fmtCop(closingVal)}); brecha ${fmtCop(diff)}. ` +
                `v2.5 cuadre matricial: opening + Σ(movements) == closing.`,
            );
          }
        }
      } else {
        // -- Modo legacy: delta opening→closing ----------------------------
        // SOLO válido cuando opening.resultadoEjercicio no es material. Si es
        // material y no hay profit_for_period, el reporte viola v2.5.
        if (absOpeningResult > MATERIALITY) {
          errors.push(
            `E7. ECP: opening_balance.resultadoEjercicio material (${fmtCop(openingResult)}) ` +
              `exige fila kind="profit_for_period" (+ kind="prior_period_result_cancellation" ` +
              `cuando aplique). Modo legacy delta opening→closing solo aplica cuando ` +
              `opening.resultadoEjercicio = $0 (v2.5).`,
          );
        } else {
          const closingResult = parseMoneyCop(closing.resultadoEjercicio);
          const delta = closingResult - openingResult;
          const diff = delta > netIncome ? delta - netIncome : netIncome - delta;
          if (diff > tolerance) {
            errors.push(
              `E7. Variación resultadoEjercicio ECP (${fmtCop(delta)}) ≠ ` +
                `Utilidad Neta P&L (${fmtCop(netIncome)}); diferencia ${fmtCop(diff)} ` +
                `excede tolerancia ${fmtCop(tolerance)}. Parte 8.1 CHECK 2.`,
            );
          }
        }
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

  // -- E9. Comparativo completo (Wave 5 — 2026-05-14) -----------------------
  //
  // Cuando `json.company.comparativePeriod` está poblado, el reporte está
  // declarando un comparativo entre años (e.g. 2025 vs 2024). En ese modo
  // los 6 totales *Comparative (3 Balance + 3 P&L) DEBEN viajar non-null;
  // null-ear silenciosamente cualquiera de ellos rompe la presentación
  // comparativa (columnas alineadas) y enmascara fallas de Pass-1 que
  // ignoró el bloque `=== Periodo comparativo (YYYY) ===` de TOTALES
  // VINCULANTES.
  //
  // Si el preprocesador suministra `bindingComparativeTotalsCents`, los
  // totales emitidos por el LLM se cruzan al centavo contra esa fuente.
  // Tolerancia $0 — el LLM NO debe re-derivar valores ya pre-calculados.
  if (json.company.comparativePeriod !== null) {
    const is = json.incomeStatement;
    const missing: string[] = [];
    if (bs.totalAssetsComparative === null) missing.push('totalAssetsComparative');
    if (bs.totalLiabilitiesComparative === null) missing.push('totalLiabilitiesComparative');
    if (bs.totalEquityComparative === null) missing.push('totalEquityComparative');
    if (is.grossProfitComparative === null) missing.push('grossProfitComparative');
    if (is.operatingProfitComparative === null) missing.push('operatingProfitComparative');
    if (is.netIncomeComparative === null) missing.push('netIncomeComparative');

    if (missing.length > 0) {
      errors.push(
        `E9. Comparativo declarado (${json.company.comparativePeriod}) pero ` +
          `los siguientes totales viajan null: ${missing.join(', ')}. ` +
          `Pass-1 debe leer literalmente el bloque "=== Periodo comparativo (${json.company.comparativePeriod}) ===" ` +
          `de TOTALES VINCULANTES. NUNCA null-ear silenciosamente.`,
      );
    }

    const bct = options.bindingComparativeTotalsCents;
    if (bct) {
      const crossCheck = (
        label: string,
        emitted: string | null,
        expected: string | undefined,
      ) => {
        if (emitted === null || expected === undefined) return;
        if (!moneyCopEquals(emitted, expected)) {
          const gap = diffCents(emitted, expected);
          errors.push(
            `E9. ${label} del periodo comparativo (${json.company.comparativePeriod}) ` +
              `emitido por Pass-1 (${fmtCop(parseMoneyCop(emitted))}) ≠ ` +
              `preprocesador (${fmtCop(parseMoneyCop(expected))}). Brecha: ${fmtCop(gap)}.`,
          );
        }
      };
      crossCheck('TotalAssets', bs.totalAssetsComparative, bct.totalAssets);
      crossCheck('TotalLiabilities', bs.totalLiabilitiesComparative, bct.totalLiabilities);
      crossCheck('TotalEquity', bs.totalEquityComparative, bct.totalEquity);
      crossCheck('GrossProfit', is.grossProfitComparative, bct.grossProfit);
      crossCheck('OperatingProfit', is.operatingProfitComparative, bct.operatingProfit);
      crossCheck('NetIncome', is.netIncomeComparative, bct.netIncome);
    }
  }

  // -- E10. Corrección v2.4 — frases prohibidas en cashFlow.sections ---------
  //
  // Bloquea ítems del EFE cuyo label corresponda al asiento contable de cierre
  // Cta.3605 ("Distribución de utilidades de periodos anteriores", "Pagos a
  // propietarios asociados con utilidades", "Cancelación resultado acumulado
  // YYYY", "Traslado utilidad ejercicio a 3605"). Estos solo pueden aparecer
  // en financing CON evidencia real de pago (acta + comprobante de egreso) —
  // sin esa evidencia son flujos ficticios usados como comodín de cuadre.
  //
  // El check es defensivo: detecta cualquier sección (operating, investing,
  // financing) — el asiento 3605 no representa flujo en ninguna sección.
  // Capa 3 Elite Protocol — Defensa Tributaria Art. 647 E.T.
  {
    // Patrones LITERALES — case-insensitive, sin acentos para ser robustos
    // ante variantes de presentación que el LLM pueda emitir.
    const forbiddenPatterns: Array<{ pattern: RegExp; descripcion: string }> = [
      {
        pattern: /distribuci[oó]n\s+de\s+utilidades\s+de\s+periodos\s+anteriores/i,
        descripcion: 'distribución de utilidades de periodos anteriores',
      },
      {
        pattern: /pagos?\s+a\s+propietarios?\s+asociados?\s+con\s+utilidades/i,
        descripcion: 'pagos a propietarios asociados con utilidades',
      },
      {
        pattern: /cancelaci[oó]n\s+(?:de\s+)?resultado\s+acumulado/i,
        descripcion: 'cancelación resultado acumulado',
      },
      {
        pattern: /traslado\s+utilidad\s+(?:del?\s+)?ejercicio\s+a\s+3605/i,
        descripcion: 'traslado utilidad ejercicio a 3605',
      },
      {
        pattern: /distribuci[oó]n\/cancelaci[oó]n\s+resultado\s+acumulado/i,
        descripcion: 'distribución/cancelación resultado acumulado',
      },
    ];
    for (const section of cf.sections) {
      for (const line of section.lines) {
        const label = line.label ?? '';
        for (const { pattern, descripcion } of forbiddenPatterns) {
          if (pattern.test(label)) {
            errors.push(
              `E10. cashFlow.sections[${section.section}] contiene un flujo ficticio prohibido (Corrección v2.4): ` +
                `label "${label}" encaja con el patrón "${descripcion}". ` +
                `El asiento de cierre Cta.3605 NO es flujo de caja (NIC 7 §18.b — método indirecto). ` +
                `Si existe saldo inicial Cta.3605 material, va como AJUSTE NO-CASH NEGATIVO en operating, ` +
                `no como salida en financing. Defensa Art. 647 E.T.: la salida ficticia distorsiona el flujo ` +
                `informado a la DIAN sin sustento documental (acta de distribución + comprobante de pago).`,
            );
          }
        }
      }
    }
  }

  // -- E11. EFE primer ítem = netIncomePrimary (Wave v2.2 — corrección #4) ----
  // El método indirecto SIEMPRE comienza por la utilidad neta del período.
  // Cuando Pass-2 emite Δ 3605 (movimiento de la cuenta de utilidades
  // acumuladas) como primer ítem, el EFE pierde semántica: el incremento
  // 3605 = utilidad neta − dividendos = netIncome solo si no se distribuye.
  // La fórmula de cierre del EFE indirecto NIC 7 §18(b) exige partir del
  // resultado del período, ajustar partidas no monetarias y variaciones de
  // capital de trabajo. Forzar el ancla previene la confusión documentada
  // el 2026-05-14 (primer ítem = $655.775.316,77 = Δ 3605 ≠ utilidad neta
  // $2.228.496.789,73).
  {
    const operatingSection = json.cashFlow.sections.find((s) => s.section === 'operating');
    if (operatingSection && operatingSection.lines.length > 0) {
      const firstLine = operatingSection.lines[0];
      const firstAmount = parseMoneyCop(firstLine.amountPrimary);
      const netIncome = parseMoneyCop(json.incomeStatement.netIncomePrimary);
      if (firstAmount !== netIncome) {
        const gap = firstAmount - netIncome;
        errors.push(
          `E11. cashFlow.sections[operating].lines[0].amountPrimary (${fmtCop(firstAmount)}) ≠ ` +
            `netIncomePrimary del Pass-1 anchor (${fmtCop(netIncome)}). Brecha: ${fmtCop(gap)}. ` +
            `El EFE Indirecto (NIC 7 §18(b)) SIEMPRE comienza por la utilidad neta del período; ` +
            `prohibido usar Δ 3605 / movimiento utilidades acumuladas como primer ítem.`,
        );
      }
    }
  }

  // -- E12. No cuentas PUC ficticias (Wave v2.2 — corrección #7) -------------
  // El PUC colombiano (Decreto 2650/1993) es un catálogo CERRADO. Cualquier
  // código con sufijo no numérico (ZZ, XX, "transitorio", "virtual") es
  // inválido y confunde al usuario final. Detectar en
  // balanceSheet.assets/liabilities/equity líneas cuyo `account` contenga
  // patrón /[A-Z]{2,}|transitorio|virtual|curator/i (después de eliminar
  // guiones y comentarios) y rechazar.
  {
    const allBalanceLines = [
      ...json.balanceSheet.assets,
      ...json.balanceSheet.liabilities,
      ...json.balanceSheet.equity,
    ];
    const FICTITIOUS_PATTERN = /^\d+[A-Z]{2,}|transitorio|virtual|curator|^\d+ZZ|^\d+XX/i;
    for (const line of allBalanceLines) {
      if (line.account === null) continue;
      // Solo evaluamos el CÓDIGO de cuenta (parte antes del espacio o " — "),
      // no la etiqueta — la etiqueta puede contener libremente "transitorio"
      // como descripción legítima de un PUC válido (e.g. "Cuentas
      // transitorias 280520"). El sufijo ficticio vive en el código.
      const codePart = line.account.split(/\s|—|-/)[0] ?? line.account;
      if (FICTITIOUS_PATTERN.test(codePart)) {
        errors.push(
          `E12. Cuenta PUC ficticia detectada en balanceSheet: "${line.account}" — ` +
            `el PUC colombiano (Decreto 2650/1993) es un catálogo cerrado; ` +
            `sufijos no canónicos (ZZ, XX, "transitorio", "virtual", "curator") están prohibidos. ` +
            `Mantener la cuenta de origen con su saldo (incluso contranatura) + nota de anomalía.`,
        );
      }
    }
  }

  // -- E13. Suma de componentes ORI ↔ ORI agregado del P&L (Presentation v3.0)
  //
  // Se activa SOLO cuando `options.presentationV3?.oriComponents.length > 0`
  // (el curator detectó al menos un componente ORI material). En ese caso,
  // la suma de `amountPrimary` de los componentes debe coincidir al centavo
  // con `oriPrimary` del P&L emitido por el LLM.
  //
  // Es un WARNING no-blocking (doctrina Sección 0.7 — "siempre entregar el
  // informe, alertas son para el contador, no para detener el sistema").
  // El validador de desglose ORI ↔ ECP (E6) ya cubre el agregado; E13 cubre
  // la coherencia interna del desglose por componente.
  if (options.presentationV3 && options.presentationV3.oriComponents.length > 0) {
    const { oriComponents } = options.presentationV3;
    // Suma de amountPrimary como BigInt centavos (×100 para pasar de COP a cents).
    const sumOriComponents = oriComponents.reduce<bigint>(
      (acc, c) => acc + BigInt(Math.round(c.amountPrimary * 100)),
      ZERO,
    );
    const oriTotal = parseMoneyCop(json.incomeStatement.oriPrimary);
    if (sumOriComponents !== oriTotal) {
      const gap = sumOriComponents - oriTotal;
      warnings.push(
        `E13. Suma de componentes ORI (${fmtCop(sumOriComponents)}) ≠ ORI agregado del P&L ` +
          `(${fmtCop(oriTotal)}). Brecha: ${fmtCop(gap)}. ` +
          `Verificar que el LLM desglosó todos los componentes ORI detectados por el curator ` +
          `(Presentation v3.0 — Sección V3.2). La columna ORI del ECP también debe coincidir ` +
          `(validación cruzada E6/E13).`,
      );
    }
  }

  // -- E15. Los renglones impresos suman el total impreso ---------------------
  //
  // Auditoría 2026-08 (`sin-invariante-lineas-vs-total`). Ningún invariante
  // exigía que la suma de las líneas de un estado fuera igual al total que ese
  // mismo estado declara, y todos los fixtures usaban arrays de líneas VACÍOS,
  // así que la brecha nunca se notó. Es el síntoma más visible para el lector:
  // suma la columna con la calculadora y no le da.
  //
  // Sutileza que hace no trivial el chequeo: por regla del NIIF Analyst las
  // líneas del Balance viajan con `isAbsolute = true`, es decir la depreciación
  // acumulada aparece como un positivo aunque RESTE. Sumar a ciegas daría un
  // exceso sistemático de 2× la correctora en toda empresa con PPE depreciado.
  // Por eso las correctoras se identifican por su código PUC (Decreto
  // 2650/1993, ver `preprocessing/curator-rules/contra-asset-registry.ts`) y se
  // restan.
  //
  // Se emite como WARNING, no como error: la clasificación de una línea puede
  // ser legítimamente discutible y bloquear un informe correcto es peor que
  // señalarlo. El anclaje duro contra el preprocesador ya lo hace E14.
  for (const [nombre, lineas, totalDeclarado] of [
    ['Activo', bs.assets, bs.totalAssetsPrimary],
    ['Pasivo', bs.liabilities, bs.totalLiabilitiesPrimary],
    ['Patrimonio', bs.equity, bs.totalEquityPrimary],
  ] as const) {
    // La identificacion del detalle vive en `contracts/statement-lines.ts`,
    // compartida con el reconciliador de anclas. NO se filtra por `level`: la
    // medicion de FASE 0 mostro que el modelo emite el mismo encabezado con
    // level 3, 1 y 0 en tres corridas del mismo balance, asi que un filtro por
    // nivel acierta por casualidad y falla en silencio.
    const { sum: suma, count: detalleCount } = sumStatementDetail(lineas);
    const total = parseMoneyCop(totalDeclarado);
    // Un estado con total material y CERO renglones es la forma más severa del
    // descuadre, no un caso exento. Ver la nota de `reconcile-anchors.ts`.
    if (detalleCount === 0 && total === ZERO) continue;
    if (suma !== total) {
      const gap = suma - total;
      warnings.push(
        `E15. En ${nombre}, la suma de los ${detalleCount} renglones de detalle ` +
          `(${fmtCop(suma)}) ≠ el total declarado (${fmtCop(total)}). Brecha: ${fmtCop(gap)}. ` +
          `El lector que sume la columna no obtendrá el total impreso. ` +
          `${
            gap < ZERO
              ? 'La suma es MENOR: probablemente falta desglosar algún rubro.'
              : 'La suma es MAYOR: revisar doble conteo o una cuenta correctora presentada en valor absoluto sin identificar.'
          }`,
      );
    }
  }

  // -- E16. Los renglones del P&G sostienen la cascada que declara -----------
  //
  // Auditoría 2026-08 (superficie 5): el Estado de Resultados no tenía NINGÚN
  // invariante de detalle. Medido sobre el balance real: `lines = []` → 0
  // errores; el renglón de ingresos multiplicado ×3 → 0 errores; un impuesto
  // inventado de $700.000.000 → 0 errores; el impuesto real borrado → limpio y
  // descargable. Los subtotales viajaban anclados y el desglose que los
  // sostiene, libre.
  //
  // La verificación NO usa etiquetas. Usa el CÓDIGO PUC de cada renglón
  // (Decreto 2650/1993, catálogo cerrado), que es dato estructurado:
  //
  //   Utilidad Bruta = Σ|clase 4 salvo 4175| − Σ|4175| − Σ|clase 6| − Σ|clase 7|
  //   EBIT           = Utilidad Bruta − Σ|grupo 51| − Σ|grupo 52|
  //   UAI            = EBIT − Σ|grupo 53| − Σ|resto de clase 5 salvo 54|
  //   Utilidad Neta  = UAI − Σ|grupo 54|
  //
  // El 4175 (Devoluciones en ventas, naturaleza débito) se RESTA aunque venga
  // en valor absoluto: NIIF 15 §47 exige presentar el ingreso neto, y un
  // informe que liste "Ingresos brutos" y "(-) Devoluciones" por separado es
  // presentación legítima que no debe producir un falso positivo.
  //
  // Se toma la MAGNITUD de cada renglón (`abs`) porque el contrato permite las
  // dos convenciones —`isAbsolute = true` imprime el gasto como positivo que
  // resta, `false` lo trae ya firmado— y un costo es una resta en ambas.
  //
  // Tolerancia $0. Todas las cifras son enteros de centavos que el modelo
  // compone en la misma respuesta: no existe ruta de redondeo que produzca
  // deriva de un centavo. Medido en las 7 corridas reales con LLM archivadas
  // en `.fase0*`: la cascada reprodujo los tres subtotales con brecha $0,00 en
  // 7/7.
  {
    const is = json.incomeStatement;
    const bucket = { ingresos: ZERO, devoluciones: ZERO, costos: ZERO, g51: ZERO, g52: ZERO, g53: ZERO, g54: ZERO, otros5: ZERO };
    let codedLines = 0;
    let revenueLines = 0;
    for (const line of is.lines) {
      if (line.account === null) continue; // subtotales del propio modelo
      const code = String(line.account).replace(/\D/g, '');
      if (code.length === 0) continue;
      const magnitude = abs(parseMoneyCop(line.amountPrimary));
      codedLines++;
      if (code.startsWith('4')) {
        revenueLines++;
        if (code.startsWith('4175')) bucket.devoluciones += magnitude;
        else bucket.ingresos += magnitude;
      } else if (code.startsWith('6') || code.startsWith('7')) {
        bucket.costos += magnitude;
      } else if (code.startsWith('51')) bucket.g51 += magnitude;
      else if (code.startsWith('52')) bucket.g52 += magnitude;
      else if (code.startsWith('53')) bucket.g53 += magnitude;
      else if (code.startsWith('54')) bucket.g54 += magnitude;
      else if (code.startsWith('5')) bucket.otros5 += magnitude;
    }

    const gross = parseMoneyCop(is.grossProfitPrimary);
    const opProfit = parseMoneyCop(is.operatingProfitPrimary);
    const netIncome = parseMoneyCop(is.netIncomePrimary);
    // Un P&G cuyo mayor subtotal es inmaterial no tiene nada que sostener.
    const MATERIAL = BigInt(100_000_000); // $1.000.000 COP en centavos
    const declaresMaterial =
      abs(gross) > MATERIAL || abs(opProfit) > MATERIAL || abs(netIncome) > MATERIAL;

    if (revenueLines === 0) {
      if (declaresMaterial) {
        errors.push(
          `E16. El Estado de Resultados declara subtotales materiales ` +
            `(Utilidad Bruta ${fmtCop(gross)}, EBIT ${fmtCop(opProfit)}, ` +
            `Utilidad Neta ${fmtCop(netIncome)}) y no lista NI UN renglón de ingresos con ` +
            `código PUC de clase 4 (${codedLines} renglones codificados en total). ` +
            `El lector no puede reconstruir una sola de las tres cifras. ` +
            `Cada renglón del P&G debe llevar su código PUC (Decreto 2650/1993).`,
        );
      }
    } else {
      const grossCalc = bucket.ingresos - bucket.devoluciones - bucket.costos;
      const opCalc = gross - bucket.g51 - bucket.g52;
      const uaiCalc = opProfit - bucket.g53 - bucket.otros5;
      const netCalc = uaiCalc - bucket.g54;

      const cascada: Array<[string, bigint, bigint, string]> = [
        [
          'Utilidad Bruta',
          grossCalc,
          gross,
          'Σ ingresos (clase 4) − devoluciones (4175) − costos (clases 6 y 7)',
        ],
        ['Resultado Operacional (EBIT)', opCalc, opProfit, 'Utilidad Bruta − grupo 51 − grupo 52'],
        [
          'Utilidad Neta',
          netCalc,
          netIncome,
          'EBIT − grupo 53 − resto de clase 5 − impuesto (grupo 54)',
        ],
      ];
      for (const [nombre, calculado, declarado, formula] of cascada) {
        if (calculado === declarado) continue;
        errors.push(
          `E16. ${nombre}: los renglones del P&G suman ${fmtCop(calculado)} y el estado declara ` +
            `${fmtCop(declarado)}. Brecha: ${fmtCop(calculado - declarado)} (${formula}). ` +
            `El lector que sume la columna con la calculadora no obtiene el subtotal impreso.`,
        );
      }

      // Impuesto de renta — la línea que la auditoría midió como totalmente
      // libre. Se contrasta contra el grupo 54 preprocesado con tolerancia $0.
      // Defensa Art. 647 E.T.: un gasto por impuesto que no existe en libros
      // es inexactitud sancionable con el 100% del mayor impuesto.
      if (bpt?.impuestoCausado !== undefined) {
        const impuestoAncla = abs(parseMoneyCop(bpt.impuestoCausado));
        if (bucket.g54 !== impuestoAncla) {
          errors.push(
            `E14. Impuesto de renta del periodo ${json.company.fiscalPeriod}: los renglones del ` +
              `P&G del grupo PUC 54 suman ${fmtCop(bucket.g54)} y el preprocesador causó ` +
              `${fmtCop(impuestoAncla)}. Brecha: ${fmtCop(bucket.g54 - impuestoAncla)}. ` +
              `El gasto por impuesto no lo autora el analista: sale del grupo 54 del balance ` +
              `de prueba (Art. 26 y Art. 647 E.T.).`,
          );
        }
      }

      // Utilidad Antes de Impuestos — se calcula en centavos exactos, se pasa
      // al validador desde 2026-08 y hasta ahora NADIE la leía.
      if (bpt?.utilidadAntesImpuestos !== undefined) {
        const uaiAncla = parseMoneyCop(bpt.utilidadAntesImpuestos);
        if (uaiCalc !== uaiAncla) {
          errors.push(
            `E14. Utilidad Antes de Impuestos del periodo ${json.company.fiscalPeriod}: la cascada ` +
              `del P&G aterriza en ${fmtCop(uaiCalc)} y el preprocesador calcula ` +
              `${fmtCop(uaiAncla)}. Brecha: ${fmtCop(uaiCalc - uaiAncla)}. ` +
              `La UAI es la base de la conciliación fiscal (Art. 26 E.T.) y no puede diferir ` +
              `del balance de prueba.`,
          );
        }
      }

      // -- Los renglones de SUBTOTAL que el modelo escribe a mano -------------
      //
      // Las filas de subtotal del P&G viajan con `account = null` —no son una
      // cuenta PUC— así que la cascada de arriba no las mira: la Utilidad Antes
      // de Impuestos, por ejemplo, es una fila impresa que nada contrasta.
      // Medido: sumarle $500.000.000 a esa fila producía 0 errores.
      //
      // La regla no usa la etiqueta (que el modelo redacta libre, y ya se vio
      // salir como "RESULTADO OPERACIONAL", "Resultado operativo" y
      // "RESULTADO INTEGRAL TOTAL DEL PERIODO" en corridas del mismo balance).
      // Usa el VALOR: un subtotal honesto es, por definición, uno de los
      // escalones de la cascada o una agregación de los renglones que el propio
      // modelo listó. Si no es ninguno de los dos, es una cifra que nadie puede
      // reconstruir sumando la columna.
      //
      // Medido sobre las 7 corridas reales archivadas: 37 de 37 filas de
      // subtotal caen en el conjunto. Cero falsos positivos.
      const cierres = [
        gross,
        opProfit,
        uaiCalc,
        netIncome,
        parseMoneyCop(is.oriPrimary),
        netIncome + parseMoneyCop(is.oriPrimary),
      ];
      const agregados = [
        bucket.ingresos,
        bucket.ingresos - bucket.devoluciones,
        bucket.devoluciones,
        bucket.costos,
        bucket.g51,
        bucket.g52,
        bucket.g51 + bucket.g52,
        bucket.g53,
        bucket.g54,
        bucket.otros5,
        bucket.g53 + bucket.otros5,
        bucket.g51 + bucket.g52 + bucket.g53 + bucket.g54 + bucket.otros5,
      ];
      const admisibles = new Set([ZERO, ...cierres, ...agregados].map((v) => v.toString()));
      for (const line of is.lines) {
        if (line.account !== null) continue;
        if (line.level < 3) continue; // encabezados de sección, no subtotales
        const v = parseMoneyCop(line.amountPrimary);
        if (admisibles.has(v.toString()) || admisibles.has((-v).toString())) continue;
        errors.push(
          `E16. El subtotal "${line.label}" imprime ${fmtCop(v)}, que no corresponde a ningún ` +
            `escalón de la cascada del P&G (Utilidad Bruta ${fmtCop(gross)}, EBIT ` +
            `${fmtCop(opProfit)}, UAI ${fmtCop(uaiCalc)}, Utilidad Neta ${fmtCop(netIncome)}) ` +
            `ni a ninguna suma de los renglones listados. El lector no puede reconstruirlo.`,
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

/** Valor absoluto en BigInt. */
function abs(v: bigint): bigint {
  return v < ZERO ? -v : v;
}
