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

import {
  sumStatementDetail,
  sumStatementDetailByPeriod,
  findUnsupportedSubtotals,
  type StatementPeriod,
} from '../contracts/statement-lines';
import {
  crossCheckCashFlowAgainstDeterministic,
  formatCashFlowCrossCheckViolations,
  type DeterministicCashFlow,
} from '../contracts/deterministic-breakdown';
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
  /**
   * E18 — EFE determinista (`buildDeterministicCashFlow(primary, comparative)`).
   * Cuando existe, el EFE emitido se cruza contra él: subtotal por actividad,
   * efectivo inicial, variación neta y efectivo final, tolerancia $0; y una
   * línea de dividendos sin sustento en el balance es error (niif-contrato-02).
   */
  deterministicCashFlow?: DeterministicCashFlow | null;
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

  // -- E18. EFE emitido == EFE determinista (auditoría niif-contrato-02) -----
  // E2/E3 son coherencia interna y cierre contra el PUC 11; no ven una
  // reclasificación entre actividades, un efectivo inicial inventado
  // compensado en otra sección ni un dividendo fabricado compensado en
  // operación. El EFE determinista es la identidad del Balance: se exige al
  // centavo por actividad y en los tres totales.
  if (options.deterministicCashFlow) {
    for (const msg of formatCashFlowCrossCheckViolations(
      crossCheckCashFlowAgainstDeterministic(cf, options.deterministicCashFlow),
    )) {
      errors.push(`E18. ${msg}`);
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
          `Revisar cascada: EBIT = grossProfit − Grupo 51 − Grupo 52; UAI = EBIT + otros ingresos (Grupo 42) − Grupo 53; netIncome = UAI − impuesto.`,
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
  // Auditoría 2026-09 (niif-contrato-12): era warning, así que un ORI
  // inventado llegaba al "Resultado integral total" con el informe limpio. La
  // variación de la columna ORI del ECP y el ORI del P&G son la misma cifra
  // (NIIF PYMES 6.3): la diferencia es error.
  const oriPnl = parseMoneyCop(json.incomeStatement.oriPrimary);
  if (closing) {
    const openingRow = json.equityChanges.rows.find((r) => r.kind === 'opening_balance');
    if (openingRow) {
      const oriDelta = parseMoneyCop(closing.ori) - parseMoneyCop(openingRow.ori);
      if (oriDelta !== oriPnl) {
        const gap = oriDelta - oriPnl;
        errors.push(
          `E6. Δ(ORI) en ECP (${fmtCop(oriDelta)}) ≠ ORI del P&G (${fmtCop(oriPnl)}). Brecha: ${fmtCop(gap)}.`,
        );
      }
    }
  }
  // E6b. Sin componentes ORI mapeados por el preprocesador, el ORI no tiene
  // ancla: se exige $0 en ambos periodos. Presentar un ORI requiere un mapeo
  // explícito de cuentas ORI de la entidad (auditoría niif-contrato-12 /
  // prompts-normativa-11: el grupo 31 es capital, no ORI).
  if (options.presentationV3 && options.presentationV3.oriComponents.length === 0) {
    const oriCmp = json.incomeStatement.oriComparative;
    if (oriPnl !== ZERO || (oriCmp !== null && parseMoneyCop(oriCmp) !== ZERO)) {
      errors.push(
        `E6b. El P&G presenta Otro Resultado Integral (${fmtCop(oriPnl)}` +
          `${oriCmp !== null ? ` / comparativo ${fmtCop(parseMoneyCop(oriCmp))}` : ''}) y el ` +
          `balance de prueba no tiene cuentas ORI mapeadas: el ORI no tiene ancla y debe ser $0.`,
      );
    }
  }

  // -- E19. Saldo inicial del ECP == patrimonio comparativo del ESF ----------
  // Auditoría 2026-09 (niif-contrato-11a): el saldo inicial nunca se cruzaba
  // con el patrimonio del periodo anterior; una fila de "convergencia" podía
  // compensar un saldo inicial inventado. NIIF PYMES 6.3(c).
  {
    const openingRow = json.equityChanges.rows.find((r) => r.kind === 'opening_balance');
    if (openingRow && bs.totalEquityComparative !== null) {
      const opening = parseMoneyCop(openingRow.total);
      const expected = parseMoneyCop(bs.totalEquityComparative);
      if (opening !== expected) {
        errors.push(
          `E19. ECP saldo inicial (${fmtCop(opening)}) ≠ Total Patrimonio del periodo comparativo ` +
            `(${fmtCop(expected)}). Brecha: ${fmtCop(opening - expected)}. El saldo inicial es el ` +
            `patrimonio de cierre del periodo anterior (NIIF PYMES 6.3).`,
        );
      }
    }
  }

  // -- E20. Columnas del cierre del ECP == renglones de patrimonio del ESF ----
  // Auditoría 2026-09 (niif-contrato-11b). Sólo se contrastan los componentes
  // de mapeo inequívoco (31 capital, 32 prima, 33 reservas, 36 resultado del
  // ejercicio, 37 acumulados, 38 ORI/valorizaciones) y sólo cuando TODOS los
  // renglones de patrimonio con monto traen código PUC reconocible.
  if (closing) {
    const byGroup = new Map<string, bigint>();
    let mappable = true;
    let detailCount = 0;
    for (const line of bs.equity) {
      if (line.account === null || line.account.trim() === '') continue;
      const code = line.account.replace(/\D/g, '');
      const group = code.slice(0, 2);
      if (!['31', '32', '33', '34', '35', '36', '37', '38'].includes(group)) {
        mappable = false;
        break;
      }
      const amount = parseMoneyCop(line.amountPrimary);
      byGroup.set(group, (byGroup.get(group) ?? ZERO) + amount);
      detailCount++;
    }
    // 34/35 no tienen columna propia en el ECP: si traen saldo, no se compara.
    const hasUnmappedEquity = (byGroup.get('34') ?? ZERO) !== ZERO || (byGroup.get('35') ?? ZERO) !== ZERO;
    // El ESF debe desagregar los grupos que el ECP usa: si el ECP muestra
    // reservas pero el ESF no tiene renglón 33, la presentación del ESF es
    // agregada y la comparación por columna no es posible (E15/E4 ya atan el
    // total).
    const columnGroups: Array<[string, string[]]> = [
      ['31', [closing.capitalSocial]],
      ['32', [closing.primaColocacion]],
      ['33', [closing.reservaLegal, closing.otrasReservas]],
      ['36', [closing.resultadoEjercicio]],
      ['37', [closing.resultadosAcumulados]],
      ['38', [closing.ori]],
    ];
    const esfCoversEcp = columnGroups.every(
      ([group, cells]) => byGroup.has(group) || cells.every((c) => parseMoneyCop(c) === ZERO),
    );
    if (mappable && detailCount > 0 && !hasUnmappedEquity && esfCoversEcp) {
      const g = (k: string) => byGroup.get(k) ?? ZERO;
      const checks: Array<[string, bigint, bigint]> = [
        ['Capital social (31)', parseMoneyCop(closing.capitalSocial), g('31')],
        ['Superávit / prima (32)', parseMoneyCop(closing.primaColocacion), g('32')],
        [
          'Reservas (33)',
          parseMoneyCop(closing.reservaLegal) + parseMoneyCop(closing.otrasReservas),
          g('33'),
        ],
        ['Resultado del ejercicio (36)', parseMoneyCop(closing.resultadoEjercicio), g('36')],
        ['Resultados acumulados (37)', parseMoneyCop(closing.resultadosAcumulados), g('37')],
        ['ORI / superávit por valorizaciones (38)', parseMoneyCop(closing.ori), g('38')],
      ];
      for (const [nombre, ecp, esf] of checks) {
        if (ecp === esf) continue;
        errors.push(
          `E20. ECP saldo final — ${nombre}: ${fmtCop(ecp)} ≠ renglones del Estado de Situación ` +
            `Financiera ${fmtCop(esf)}. Brecha: ${fmtCop(ecp - esf)}.`,
        );
      }
    }
  }

  // -- E7. Utilidad Neta del periodo registrada en el ECP (v2.5) ------------
  //
  // Modo matricial estricto cuando existe fila `profit_for_period`:
  //   E7a — profit_for_period.resultadoEjercicio == netIncomePrimary.
  //   E7b — Si opening_balance.resultadoEjercicio es material y ≠ 0,
  //         DEBE existir una fila prior_period_result_cancellation con
  //         resultadoEjercicio = -opening.resultadoEjercicio. Esa fila es el
  //         traslado interno Dr 3605 / Cr 37: su total es $0 (auditoría
  //         niif-contrato-11d — antes el contrato la hacía reducir el
  //         patrimonio sin contrapartida, que es una distribución disfrazada).
  //   E7c — Cuadre matricial: opening + Σ(movement rows) == closing,
  //         columna a columna.
  //
  // Modo legacy (sin profit_for_period): el resultado del periodo es implícito
  // (netIncome en la columna resultadoEjercicio y en el total) y el cuadre por
  // columna se exige igual (auditoría niif-contrato-11c).
  //
  // Tolerancia $0 en todo (auditoría niif-contrato-10): las cifras viajan en
  // centavos exactos; la holgura anterior (0,5% + $100 en E7a, $1.000 por
  // columna en E7c) sólo servía para que una fila compensatoria la usara.
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
      const openingResult = parseMoneyCop(openingRow.resultadoEjercicio);
      const absOpeningResult = openingResult < ZERO ? -openingResult : openingResult;
      const MATERIALITY = BigInt(100_000_000); // $1.000.000 COP en centavos
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
      const matrixCheck = (label: string, implied: Partial<Record<(typeof cols)[number], bigint>>) => {
        for (const col of cols) {
          const computed =
            json.equityChanges.rows.reduce<bigint>((acc, row) => {
              if (row.kind === 'closing_balance') return acc;
              return acc + parseMoneyCop(row[col]);
            }, ZERO) + (implied[col] ?? ZERO);
          const closingVal = parseMoneyCop(closing[col]);
          if (computed === closingVal) continue;
          errors.push(
            `${label}. ECP columna "${col}" no cuadra: Σ filas (${fmtCop(computed)}) ≠ ` +
              `closing_balance (${fmtCop(closingVal)}); brecha ${fmtCop(computed - closingVal)}. ` +
              `Cuadre matricial: opening + Σ(movements) == closing, tolerancia $0.`,
          );
        }
      };

      if (profitRow) {
        // -- Modo v2.5 -----------------------------------------------------
        const profitInEcp = parseMoneyCop(profitRow.resultadoEjercicio);
        if (profitInEcp !== netIncome) {
          errors.push(
            `E7a. ECP fila profit_for_period.resultadoEjercicio (${fmtCop(profitInEcp)}) ≠ ` +
              `Utilidad Neta P&L (${fmtCop(netIncome)}); diferencia ` +
              `${fmtCop(profitInEcp - netIncome)}. Tolerancia $0 (NIIF PYMES 6.3).`,
          );
        }

        // E7b — Traslado obligatorio si opening arrastra resultado prior material.
        if (absOpeningResult > MATERIALITY) {
          if (!cancellationRow) {
            errors.push(
              `E7b. ECP: opening_balance.resultadoEjercicio material (${fmtCop(openingResult)}) ` +
                `exige fila kind="prior_period_result_cancellation" que traslade ese saldo ` +
                `a resultados acumulados (Dr 3605 / Cr 37).`,
            );
          } else {
            const cancellation = parseMoneyCop(cancellationRow.resultadoEjercicio);
            if (cancellation !== -openingResult) {
              errors.push(
                `E7b. ECP fila prior_period_result_cancellation.resultadoEjercicio ` +
                  `(${fmtCop(cancellation)}) ≠ -opening_balance.resultadoEjercicio ` +
                  `(${fmtCop(-openingResult)}); diferencia ${fmtCop(cancellation + openingResult)}. ` +
                  `Tolerancia $0.`,
              );
            }
          }
        }
        if (cancellationRow && parseMoneyCop(cancellationRow.total) !== ZERO) {
          errors.push(
            `E7b. ECP fila prior_period_result_cancellation con total ` +
              `${fmtCop(parseMoneyCop(cancellationRow.total))}: el traslado del resultado anterior ` +
              `es interno del patrimonio (Dr 3605 / Cr 37) y su total es $0. Una disminución del ` +
              `patrimonio es una distribución (fila dividend_distribution, con soporte).`,
          );
        }

        // E7c — Cuadre matricial columna a columna.
        matrixCheck('E7c', {});
      } else {
        // -- Modo legacy: resultado implícito -------------------------------
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
          if (delta !== netIncome) {
            errors.push(
              `E7. Variación resultadoEjercicio ECP (${fmtCop(delta)}) ≠ ` +
                `Utilidad Neta P&L (${fmtCop(netIncome)}); diferencia ${fmtCop(delta - netIncome)}. ` +
                `Tolerancia $0.`,
            );
          }
          matrixCheck('E7c', { resultadoEjercicio: netIncome, total: netIncome });
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

  // -- E15 (subtotales y columna comparativa) — auditoría 2026-09 -------------
  // niif-contrato-06: los subtotales impresos (activo/pasivo corriente y no
  // corriente) y los encabezados con monto no se contrastaban y el PDF los
  // imprime como subtotales. niif-contrato-08: la columna comparativa de los
  // renglones no estaba cubierta por ninguna identidad. Mismo prefijo `E15.`
  // (el canal de exportación los bloquea); una celda comparativa ausente no se
  // trata como cero: si impide verificar, se avisa como `E15c.` (no bloquea).
  const hasComparative = json.company.comparativePeriod !== null;
  for (const [nombre, lineas, totalPrimario, totalComparativo] of [
    ['Activo', bs.assets, bs.totalAssetsPrimary, bs.totalAssetsComparative],
    ['Pasivo', bs.liabilities, bs.totalLiabilitiesPrimary, bs.totalLiabilitiesComparative],
    ['Patrimonio', bs.equity, bs.totalEquityPrimary, bs.totalEquityComparative],
  ] as const) {
    const periods: Array<[StatementPeriod, string | null]> = [['primary', totalPrimario]];
    if (hasComparative) periods.push(['comparative', totalComparativo]);
    for (const [period, totalRaw] of periods) {
      const total = totalRaw === null ? null : parseMoneyCop(totalRaw);
      const etiqueta = period === 'primary' ? 'periodo actual' : 'periodo comparativo';
      for (const s of findUnsupportedSubtotals(lineas, total, period)) {
        warnings.push(
          `E15. En ${nombre} (${etiqueta}), el renglón sin código "${s.label}" imprime ` +
            `${fmtCop(s.amount)}, que no es la suma de los renglones de detalle de su bloque ni ` +
            `el total de la sección. Un subtotal que no se reconstruye sumando la columna no ` +
            `puede imprimirse; un encabezado no lleva monto.`,
        );
      }
      if (period === 'comparative' && total !== null) {
        const { sum, count, missing } = sumStatementDetailByPeriod(lineas, 'comparative');
        if (count === 0 && total === ZERO) continue;
        if (sum === total) continue;
        if (missing > 0) {
          warnings.push(
            `E15c. En ${nombre} (periodo comparativo), ${missing} renglón(es) de detalle no traen ` +
              `cifra comparativa y la columna no se puede verificar contra el total ` +
              `${fmtCop(total)} (suma disponible ${fmtCop(sum)}).`,
          );
        } else {
          warnings.push(
            `E15. En ${nombre} (periodo comparativo), la suma de los ${count} renglones de detalle ` +
              `(${fmtCop(sum)}) ≠ el total comparativo declarado (${fmtCop(total)}). ` +
              `Brecha: ${fmtCop(sum - total)}. NIIF PYMES 3.14.`,
          );
        }
      }
    }
  }

  // -- E3b. Renglón de efectivo del ESF == efectivo del EFE -----------------
  // Auditoría 2026-09 (niif-contrato-09): E3 ata cashClosing al PUC 11, pero
  // nadie ataba el renglón '11' que imprime el ESF. Trasladar un monto de 13 a
  // 11 conservaba el total y el ESF mostraba un efectivo distinto del cierre
  // del EFE (NIC 7 ¶45 / NIIF PYMES 7.20).
  {
    const cashLines = bs.assets.filter(
      (l) => l.account !== null && l.account.replace(/\D/g, '').startsWith('11'),
    );
    if (cashLines.length > 0) {
      const esfCash = cashLines.reduce((a, l) => a + parseMoneyCop(l.amountPrimary), ZERO);
      const efeClose = parseMoneyCop(cf.cashClosing);
      if (esfCash !== efeClose) {
        errors.push(
          `E3b. Efectivo del Estado de Situación Financiera (renglones PUC 11: ${fmtCop(esfCash)}) ≠ ` +
            `efectivo al final del EFE (${fmtCop(efeClose)}). Brecha: ${fmtCop(esfCash - efeClose)}.`,
        );
      }
      if (hasComparative && cashLines.every((l) => l.amountComparative !== null)) {
        const esfCashCmp = cashLines.reduce((a, l) => a + parseMoneyCop(l.amountComparative!), ZERO);
        const efeOpen = parseMoneyCop(cf.cashOpening);
        if (esfCashCmp !== efeOpen) {
          errors.push(
            `E3b. Efectivo del periodo comparativo en el ESF (${fmtCop(esfCashCmp)}) ≠ efectivo al ` +
              `inicio del EFE (${fmtCop(efeOpen)}). Brecha: ${fmtCop(esfCashCmp - efeOpen)}.`,
          );
        }
      }
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
  // (Decreto 2650/1993, catálogo cerrado), que es dato estructurado. Cascada
  // (enmienda spec v2.1 del 2026-09-24 — grupo 42 DEBAJO de la utilidad
  // operacional; auditoría niif-contrato-01):
  //
  //   Utilidad Bruta = ingresos 41 − devoluciones 4175 − costos (clases 6 y 7)
  //   EBIT           = Utilidad Bruta − grupo 51 − grupo 52
  //   UAI            = EBIT + otros ingresos (42 y demás de clase 4)
  //                    − grupo 53 − resto de clase 5 salvo 54
  //   Utilidad Neta  = UAI − grupo 54
  //
  // Un renglón con código de un dígito "4" no permite separar 41 de 42: se
  // toma como operacional, y si el balance tiene grupo 42 la cascada no cierra
  // contra el ancla — el modelo debe desagregar.
  //
  // Signo de cada renglón (auditoría niif-contrato-13):
  //   - `isAbsolute = true` → magnitud: el ingreso suma y el costo/gasto resta.
  //   - `isAbsolute = false` → el importe viaja firmado. En la clase 4 el signo
  //     es el del ingreso (una recuperación 4250 con saldo débito resta). En
  //     las clases 5/6/7 el contrato admite dos lecturas estables: signo de
  //     efecto en el resultado (gasto negativo) o signo natural (gasto
  //     positivo, saldo crédito negativo). Se acepta la cascada si cierra bajo
  //     UNA de las dos lecturas aplicada a todos los renglones; tomar `abs`
  //     rechazaba un P&G correcto con una partida contranatura firmada.
  //   - 4175 siempre resta su magnitud (NIIF 15 §47).
  //
  // Tolerancia $0. Todas las cifras son enteros de centavos que el modelo
  // compone en la misma respuesta: no existe ruta de redondeo que produzca
  // deriva de un centavo.
  {
    const is = json.incomeStatement;
    type Buckets = {
      ingresos41: bigint;
      devoluciones: bigint;
      otrosIngresos: bigint;
      costos: bigint;
      g51: bigint;
      g52: bigint;
      g53: bigint;
      g54: bigint;
      otros5: bigint;
    };
    // Aporte de cada renglón al resultado (+ aumenta la utilidad, − la reduce).
    let comparativeCellsMissing = 0;
    const buildBuckets = (
      expenseSignedIsEffect: boolean,
      period: StatementPeriod = 'primary',
    ): Buckets => {
      const b: Buckets = {
        ingresos41: ZERO, devoluciones: ZERO, otrosIngresos: ZERO, costos: ZERO,
        g51: ZERO, g52: ZERO, g53: ZERO, g54: ZERO, otros5: ZERO,
      };
      for (const line of is.lines) {
        if (line.account === null) continue; // subtotales del propio modelo
        const code = String(line.account).replace(/\D/g, '');
        if (code.length === 0) continue;
        const raw = period === 'primary' ? line.amountPrimary : line.amountComparative;
        if (raw === null) {
          comparativeCellsMissing++;
          continue;
        }
        const v = parseMoneyCop(raw);
        if (code.startsWith('4')) {
          if (code.startsWith('4175')) b.devoluciones -= abs(v);
          else {
            const aporte = line.isAbsolute ? abs(v) : v;
            if (code === '4' || code.startsWith('41')) b.ingresos41 += aporte;
            else b.otrosIngresos += aporte;
          }
          continue;
        }
        if (!/^[567]/.test(code)) continue;
        const aporte = line.isAbsolute ? -abs(v) : expenseSignedIsEffect ? v : -v;
        if (code.startsWith('6') || code.startsWith('7')) b.costos += aporte;
        else if (code.startsWith('51')) b.g51 += aporte;
        else if (code.startsWith('52')) b.g52 += aporte;
        else if (code.startsWith('53')) b.g53 += aporte;
        else if (code.startsWith('54')) b.g54 += aporte;
        else b.otros5 += aporte;
      }
      return b;
    };
    let codedLines = 0;
    let revenueLines = 0;
    for (const line of is.lines) {
      if (line.account === null) continue;
      const code = String(line.account).replace(/\D/g, '');
      if (code.length === 0) continue;
      codedLines++;
      if (code.startsWith('4')) revenueLines++;
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
      const cascadeOf = (b: Buckets) => {
        const grossCalc = b.ingresos41 + b.devoluciones + b.costos;
        const opCalc = gross + b.g51 + b.g52;
        const uaiCalc = opProfit + b.otrosIngresos + b.g53 + b.otros5;
        const netCalc = uaiCalc + b.g54;
        return { grossCalc, opCalc, uaiCalc, netCalc };
      };
      const cierra = (c: ReturnType<typeof cascadeOf>) =>
        c.grossCalc === gross && c.opCalc === opProfit && c.netCalc === netIncome;
      // Lectura A: gasto firmado por su efecto (negativo). Lectura B: signo
      // natural (positivo). Sólo difieren si hay gastos con isAbsolute=false.
      const bucketsA = buildBuckets(true);
      const bucketsB = buildBuckets(false);
      const cascadeA = cascadeOf(bucketsA);
      const cascadeB = cascadeOf(bucketsB);
      const useB = !cierra(cascadeA) && cierra(cascadeB);
      const bucket = useB ? bucketsB : bucketsA;
      const { grossCalc, opCalc, uaiCalc, netCalc } = useB ? cascadeB : cascadeA;

      const cascada: Array<[string, bigint, bigint, string]> = [
        [
          'Utilidad Bruta',
          grossCalc,
          gross,
          'ingresos operacionales (grupo 41) − devoluciones (4175) − costos (clases 6 y 7); el grupo 42 va debajo del EBIT',
        ],
        ['Resultado Operacional (EBIT)', opCalc, opProfit, 'Utilidad Bruta − grupo 51 − grupo 52'],
        [
          'Utilidad Neta',
          netCalc,
          netIncome,
          'EBIT + otros ingresos (grupo 42) − grupo 53 − resto de clase 5 − impuesto (grupo 54)',
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

      // Columna comparativa (auditoría niif-contrato-08): la misma cascada con
      // `amountComparative` contra los subtotales comparativos. Una celda
      // ausente no se trata como cero: si impide cerrar, se avisa (`E16c.`).
      if (
        json.company.comparativePeriod !== null &&
        is.grossProfitComparative !== null &&
        is.operatingProfitComparative !== null &&
        is.netIncomeComparative !== null
      ) {
        const grossC = parseMoneyCop(is.grossProfitComparative);
        const opC = parseMoneyCop(is.operatingProfitComparative);
        const netC = parseMoneyCop(is.netIncomeComparative);
        comparativeCellsMissing = 0;
        const evalC = (b: Buckets) => ({
          grossCalc: b.ingresos41 + b.devoluciones + b.costos,
          opCalc: grossC + b.g51 + b.g52,
          netCalc: opC + b.otrosIngresos + b.g53 + b.otros5 + b.g54,
        });
        const cA = evalC(buildBuckets(true, 'comparative'));
        const missing = comparativeCellsMissing;
        const cB = evalC(buildBuckets(false, 'comparative'));
        const ok = (c: ReturnType<typeof evalC>) =>
          c.grossCalc === grossC && c.opCalc === opC && c.netCalc === netC;
        if (!ok(cA) && !ok(cB)) {
          const c = cA;
          const pares: Array<[string, bigint, bigint]> = [
            ['Utilidad Bruta', c.grossCalc, grossC],
            ['Resultado Operacional (EBIT)', c.opCalc, opC],
            ['Utilidad Neta', c.netCalc, netC],
          ];
          for (const [nombre, calculado, declarado] of pares) {
            if (calculado === declarado) continue;
            const msg =
              `${nombre} del periodo comparativo (${json.company.comparativePeriod}): los renglones ` +
              `suman ${fmtCop(calculado)} y el estado declara ${fmtCop(declarado)}. ` +
              `Brecha: ${fmtCop(calculado - declarado)}.`;
            if (missing > 0) {
              warnings.push(
                `E16c. ${msg} ${missing} celda(s) comparativa(s) ausente(s): la columna no es verificable.`,
              );
            } else {
              errors.push(`E16. ${msg}`);
            }
          }
        }
      }

      // Impuesto de renta — la línea que la auditoría midió como totalmente
      // libre. Se contrasta contra el grupo 54 preprocesado con tolerancia $0.
      // Defensa Art. 647 E.T.: un gasto por impuesto que no existe en libros
      // es inexactitud sancionable con el 100% del mayor impuesto.
      if (bpt?.impuestoCausado !== undefined) {
        const impuestoAncla = parseMoneyCop(bpt.impuestoCausado);
        const impuestoRenglones = -bucket.g54;
        if (impuestoRenglones !== impuestoAncla) {
          errors.push(
            `E14. Impuesto de renta del periodo ${json.company.fiscalPeriod}: los renglones del ` +
              `P&G del grupo PUC 54 suman ${fmtCop(impuestoRenglones)} y el preprocesador causó ` +
              `${fmtCop(impuestoAncla)}. Brecha: ${fmtCop(impuestoRenglones - impuestoAncla)}. ` +
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
        bucket.ingresos41,
        bucket.ingresos41 + bucket.devoluciones,
        bucket.devoluciones,
        bucket.otrosIngresos,
        bucket.ingresos41 + bucket.devoluciones + bucket.otrosIngresos,
        bucket.ingresos41 + bucket.otrosIngresos,
        bucket.costos,
        bucket.g51,
        bucket.g52,
        bucket.g51 + bucket.g52,
        bucket.g53,
        bucket.g54,
        bucket.otros5,
        bucket.g53 + bucket.otros5,
        bucket.otrosIngresos + bucket.g53 + bucket.otros5,
        bucket.g51 + bucket.g52 + bucket.g53 + bucket.g54 + bucket.otros5,
        bucket.g51 + bucket.g52 + bucket.g53 + bucket.otros5,
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
