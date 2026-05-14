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
    if (opMinusNet < EQUALITY_TOL && absNet > NET_MATERIAL) {
      errors.push(
        `E5. EBIT incorrectamente igualado a Utilidad Neta — el Grupo 53 debe deducirse DESPUÉS del EBIT. ` +
          `operatingProfitPrimary (${fmtCop(op)}) ≈ netIncomePrimary (${fmtCop(net)}); ` +
          `diferencia ${fmtCop(opMinusNet)} < tolerancia ${fmtCop(EQUALITY_TOL)} con netIncome material. ` +
          `Revisar cascada: EBIT = grossProfit − Grupo 51 − Grupo 52; UAI = EBIT − Grupo 53; netIncome = UAI − impuesto.`,
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

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
