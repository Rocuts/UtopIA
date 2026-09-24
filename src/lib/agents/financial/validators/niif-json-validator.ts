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
//   E6. ORI Income Statement coincide con ORI Equity Changes (también en el
//       periodo comparativo cuando hay ECP comparativo)
//  E6b. ORI del ERI == Δ grupo PUC 38 del balance de prueba en cada periodo
//       (enmienda 12, spec v2.1); sin corte de apertura, $0 o N/D
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
//  E27. Subtotales corriente / no corriente del ESF == controlTotals
//       (activo/pasivo corriente y no corriente, ambos periodos; integración I4)
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
  signedLineAmount,
  type StatementPeriod,
  type StatementLineWithColumns,
} from '../contracts/statement-lines';
import {
  crossCheckCashFlowAgainstDeterministic,
  crossCheckCashFlowLinesAgainstDeterministic,
  formatCashFlowCrossCheckViolations,
  formatCashFlowLineViolations,
  type CashFlowStatementLike,
  type ComparativeStatementsBasis,
  type DeterministicCashFlow,
  type LedgerLeaf,
} from '../contracts/deterministic-breakdown';
import { moneyCopEquals, parseMoneyCop, serializeMoneyCop } from '../contracts/money';
import type { NiifReportJson, EquityChangeRowJson } from '../contracts/niif-report';
import type { ReportValidationResult } from '../types';
import {
  balanceTermOfLabel,
  incomeCascadeKindOfLabel,
  type IncomeCascadeKind,
} from '@/lib/export/statement-presentation';

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
  /**
   * E21/E24 — hojas del balance de prueba de cada periodo (auditoría
   * 2026-09-24, e2e-niif-02/05/06/08). Con ellas cada renglón con código PUC
   * del ESF y del ERI, en ambas columnas, se ancla a la suma de las hojas que
   * su código agrupa, y cada columna del ECP al grupo patrimonial del balance.
   */
  ledgers?: {
    primary: readonly LedgerLeaf[];
    comparative: readonly LedgerLeaf[] | null;
  };
  /**
   * El comparativo proviene de una columna de saldo inicial/anterior
   * (`PeriodSnapshot.saldosDeApertura`, ingesta-09): su ESF es el de apertura
   * y NO hay P&G del periodo anterior. E9 no exige ni cruza los totales del
   * P&G comparativo (son N/D), y las reglas del ERI no evalúan esa columna.
   */
  comparativeIsOpening?: boolean;
  /**
   * Comparativos del EFE y del ECP (auditoría integral 2026-09-24, pendiente
   * #3): base determinista del periodo comparativo
   * (`buildComparativeStatementsBasis`).
   *   - `undefined`: sin anclas; sólo la coherencia interna de lo presentado.
   *   - `null`: el balance no tiene periodo comparativo; presentar un
   *     comparativo del EFE o del ECP es error.
   *   - base: lo presentado se cruza al centavo contra ella, y presentarlo
   *     cuando la base no lo presenta es error (NIIF para las PYMES 3.14: sin
   *     corte de apertura no hay comparativo que calcular).
   */
  comparativeStatements?: ComparativeStatementsBasis | null;
  /**
   * E26 (auditoría 2026-09, niif-contrato-23): banderas del Curator desde el
   * snapshot (`deterministicCuratorFlags`). `curatorFlags` del informe debe
   * coincidir: el modelo las copiaba sin contraste y Pass-2/3 las citaban.
   */
  curatorFlags?: NiifReportJson['curatorFlags'];
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
  // E6b. El ORI del ERI contra su ancla determinista (enmienda 12, spec v2.1;
  // integración I4). El ORI del periodo es la variación del grupo PUC 38
  // entre el corte de apertura y el de cierre: la misma cifra que la columna
  // ORI del ECP mueve (E24 fija esa columna al saldo del grupo 38 en cada
  // corte y E6 su variación al ORI del ERI). Hasta esta enmienda E6b exigía
  // ORI $0 sin componentes mapeados, y con un grupo 38 que se movió en el año
  // ninguna cifra del ERI satisfacía E6 y E6b a la vez. Sin corte de apertura
  // rige lo anterior (auditoría niif-contrato-12 / prompts-normativa-11): $0
  // en el periodo actual; en el comparativo, N/D si el grupo 38 tiene saldo.
  errors.push(...oriAnchorErrors(json, options, oriPnl));

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
  // Comparativo de saldos de apertura (ingesta-09, cross-dep de W3-A): el ESF
  // del comparativo es el de apertura y su P&G es N/D. Exigir o cruzar sus
  // totales de resultados obligaba al modelo a copiar cifras "sólo por
  // contrato" que ninguna superficie puede presentar como P&G comparativo.
  const pygComparativeIsNd = options.comparativeIsOpening === true;
  if (json.company.comparativePeriod !== null) {
    const is = json.incomeStatement;
    const missing: string[] = [];
    if (bs.totalAssetsComparative === null) missing.push('totalAssetsComparative');
    if (bs.totalLiabilitiesComparative === null) missing.push('totalLiabilitiesComparative');
    if (bs.totalEquityComparative === null) missing.push('totalEquityComparative');
    if (!pygComparativeIsNd) {
      if (is.grossProfitComparative === null) missing.push('grossProfitComparative');
      if (is.operatingProfitComparative === null) missing.push('operatingProfitComparative');
      if (is.netIncomeComparative === null) missing.push('netIncomeComparative');
    }

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
      if (!pygComparativeIsNd) {
        crossCheck('GrossProfit', is.grossProfitComparative, bct.grossProfit);
        crossCheck('OperatingProfit', is.operatingProfitComparative, bct.operatingProfit);
        crossCheck('NetIncome', is.netIncomeComparative, bct.netIncome);
      }
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
      // Con un comparativo de saldos de apertura no hay P&G comparativo (N/D).
      if (
        json.company.comparativePeriod !== null &&
        !pygComparativeIsNd &&
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
        const bucketsCA = buildBuckets(true, 'comparative');
        const cA = evalC(bucketsCA);
        const missing = comparativeCellsMissing;
        const bucketsCB = buildBuckets(false, 'comparative');
        const cB = evalC(bucketsCB);
        const ok = (c: ReturnType<typeof evalC>) =>
          c.grossCalc === grossC && c.opCalc === opC && c.netCalc === netC;
        // E22 sobre la columna comparativa, con la lectura de signo que cierra.
        {
          const useCB = !ok(cA) && ok(cB);
          const bc = useCB ? bucketsCB : bucketsCA;
          const uaiC = opC + bc.otrosIngresos + bc.g53 + bc.otros5;
          errors.push(
            ...uncodedIncomeRowErrors(json, 'comparative', bc, !useCB, {
              gross: grossC,
              op: opC,
              uai: uaiC,
              net: netC,
              ori: is.oriComparative === null ? null : parseMoneyCop(is.oriComparative),
            }),
          );
        }
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

      // -- E22. Renglones SIN código del ERI (auditoría 2026-09-24) -----------
      //
      // Sustituye la regla de subtotales anterior, que (1) sólo miraba los
      // renglones de nivel ≥ 3 y (2) aceptaba cualquier cifra del conjunto
      // admisible CON EL SIGNO INVERTIDO. Medido (e2e-niif-01/-02): un renglón
      // "UTILIDAD NETA DEL PERÍODO" por +$40.000.000 con una pérdida de
      // −$40.000.000 pasaba (admisibles.has(-v)) y sustituía el total en PDF,
      // Excel y Markdown; un "EBITDA" de nivel 2 por $55.555.555,00 no se
      // revisaba. Ahora todo renglón sin código con importe se evalúa, con
      // signo: si su rótulo es un escalón de la cascada debe ser ESA cifra
      // anclada; si no, debe ser un escalón, una agregación de los renglones o
      // un bloque contiguo de ellos. Los gastos y costos agregados admiten su
      // magnitud (presentación absoluta del P&G); los resultados, no.
      errors.push(
        ...uncodedIncomeRowErrors(json, 'primary', bucket, !useB, {
          gross,
          op: opProfit,
          uai: uaiCalc,
          net: netIncome,
          ori: parseMoneyCop(is.oriPrimary),
        }),
      );
    }
  }

  // -- E22. Renglones sin código del ESF, con signo (e2e-niif-12) -------------
  // `findUnsupportedSubtotals` (E15, aviso) y el gate de exportación comparaban
  // valores absolutos: "Resultado neto del período +$40.000.000" bajo un
  // renglón 36 de −$40.000.000 pasaba. Un subtotal honesto es, con su signo,
  // la suma de un bloque de renglones impresos, el total de la sección o el
  // total pasivo + patrimonio. Las correctoras ya restan por su código.
  {
    const liabPlusEquity = (period: StatementPeriod): bigint | null => {
      const l = period === 'primary' ? bs.totalLiabilitiesPrimary : bs.totalLiabilitiesComparative;
      const e = period === 'primary' ? bs.totalEquityPrimary : bs.totalEquityComparative;
      return l !== null && e !== null ? parseMoneyCop(l) + parseMoneyCop(e) : null;
    };
    const periods: StatementPeriod[] = ['primary'];
    if (hasComparative) periods.push('comparative');
    for (const period of periods) {
      const etiqueta =
        period === 'primary'
          ? `periodo ${json.company.fiscalPeriod}`
          : `periodo comparativo ${json.company.comparativePeriod}`;
      for (const [nombre, lineas, totalRaw] of [
        ['Activo', bs.assets, period === 'primary' ? bs.totalAssetsPrimary : bs.totalAssetsComparative],
        ['Pasivo', bs.liabilities, period === 'primary' ? bs.totalLiabilitiesPrimary : bs.totalLiabilitiesComparative],
        ['Patrimonio', bs.equity, period === 'primary' ? bs.totalEquityPrimary : bs.totalEquityComparative],
      ] as const) {
        errors.push(
          ...uncodedBalanceRowErrors(
            nombre,
            lineas,
            totalRaw === null ? null : parseMoneyCop(totalRaw),
            liabPlusEquity(period),
            period,
            etiqueta,
          ),
        );
      }
    }
  }

  // -- E27. Subtotales corriente / no corriente del ESF == controlTotals ------
  // Integración I4: los subtotales de plazo que imprime un ESF escrito por el
  // modelo son las cifras de liquidez de los KPIs, el gate y X03, en ambos
  // periodos (ver `termSubtotalErrors`).
  if (options.ledgers) {
    const termPeriods: Array<[StatementPeriod, readonly LedgerLeaf[] | null, string]> = [
      ['primary', options.ledgers.primary, `periodo ${json.company.fiscalPeriod}`],
    ];
    if (hasComparative) {
      termPeriods.push([
        'comparative',
        options.ledgers.comparative,
        `periodo comparativo ${json.company.comparativePeriod}`,
      ]);
    }
    for (const [period, leaves, etiqueta] of termPeriods) {
      if (!leaves) continue;
      errors.push(
        ...termSubtotalErrors('Activo', 'assets', bs.assets, leaves, period, etiqueta),
        ...termSubtotalErrors('Pasivo', 'liabilities', bs.liabilities, leaves, period, etiqueta),
      );
    }
  }

  // -- E21. Renglones con código PUC anclados al balance de prueba ------------
  // Auditoría 2026-09-24 (e2e-niif-02/-05/-06). E14/E9 anclaban los TOTALES y
  // E3b sólo el renglón 11: el modelo podía mover $1.000.000 de deudores (13)
  // a PPE (15), de obligaciones financieras (21) a proveedores (22), o inflar
  // ingresos (41) y costo (61) en la misma cifra, en cualquiera de las dos
  // columnas, con todos los totales intactos. Cada renglón con código se ancla
  // ahora a la suma de las hojas del balance de prueba que su código agrupa
  // (la hoja se asigna al código MÁS específico listado, así "15" bruto +
  // "1592" depreciación también cuadra), tolerancia $0.
  if (options.ledgers) {
    const ledgerPeriods: Array<[StatementPeriod, readonly LedgerLeaf[]]> = [
      ['primary', options.ledgers.primary],
    ];
    if (hasComparative && options.ledgers.comparative) {
      ledgerPeriods.push(['comparative', options.ledgers.comparative]);
    }
    for (const [period, leaves] of ledgerPeriods) {
      const etiqueta =
        period === 'primary'
          ? `periodo ${json.company.fiscalPeriod}`
          : `periodo comparativo ${json.company.comparativePeriod}`;
      for (const [nombre, lineas, classCode] of [
        ['Activo', bs.assets, 1],
        ['Pasivo', bs.liabilities, 2],
        ['Patrimonio', bs.equity, 3],
      ] as const) {
        errors.push(...balanceLineAnchorErrors(nombre, lineas, classCode, leaves, period, etiqueta));
      }
      if (period === 'primary' || !pygComparativeIsNd) {
        errors.push(...incomeLineAnchorErrors(json.incomeStatement.lines, leaves, period, etiqueta));
      }
    }
  }

  // -- E23. EFE renglón a renglón contra el determinista (e2e-niif-07) --------
  if (options.deterministicCashFlow) {
    for (const msg of formatCashFlowLineViolations(
      crossCheckCashFlowLinesAgainstDeterministic(cf, options.deterministicCashFlow),
    )) {
      errors.push(`E23. ${msg}`);
    }
  }

  // -- E19b. Apertura del ECP por componente == patrimonio comparativo del ESF
  // Auditoría 2026-09-24 (e2e-niif-08): E19 sólo cruzaba el TOTAL de apertura;
  // mover $1.000.000 de resultados acumulados a capital en la apertura (y en el
  // cierre) salía limpio. Misma regla que E20, sobre la columna comparativa.
  {
    const openingRow = json.equityChanges.rows.find((r) => r.kind === 'opening_balance');
    if (openingRow && hasComparative && bs.totalEquityComparative !== null) {
      errors.push(...equityRowVsBalanceLines(openingRow, bs.equity, 'comparative', 'E19b', 'saldo inicial'));
    }
  }

  // -- E24. ECP por componente contra el balance de prueba (e2e-niif-08) ------
  if (options.ledgers) {
    errors.push(
      ...equityLedgerErrors(
        json,
        options.ledgers.primary,
        hasComparative ? options.ledgers.comparative : null,
        options.deterministicCashFlow ?? null,
      ),
    );
  }

  // -- Comparativos del EFE y del ECP (pendiente #3, NIIF PYMES 3.14) --------
  // Las mismas identidades del periodo actual sobre la columna comparativa del
  // EFE (E2/E3/E11 internas; E18/E23 contra el determinista) y sobre las filas
  // del ECP del periodo comparativo (E4/E7/E17/E19 internas; E24 contra el
  // determinista). Presentarlos sin base determinista es error.
  {
    const cmp = comparativeStatementErrors(json, options, pygComparativeIsNd);
    errors.push(...cmp.errors);
    warnings.push(...cmp.warnings);
  }

  // -- E25. Rótulos fechados en otro periodo (e2e-niif-09) --------------------
  errors.push(...labelYearErrors(json));

  // -- E26. curatorFlags == banderas del Curator (niif-contrato-23) ----------
  if (options.curatorFlags) {
    const expected = options.curatorFlags;
    const emitted = json.curatorFlags;
    for (const key of [
      'equityConvergenceApplied',
      'cashFlowClosureForced',
      'negativeAssetReclassified',
      'presumedCostWarning',
    ] as const) {
      if (emitted[key] !== expected[key]) {
        errors.push(
          `E26. curatorFlags.${key} = ${emitted[key]} y el Curator del balance de prueba registra ${expected[key]}.`,
        );
      }
    }
    if (parseMoneyCop(emitted.reclassifiedAmountCop) !== parseMoneyCop(expected.reclassifiedAmountCop)) {
      errors.push(
        `E26. curatorFlags.reclassifiedAmountCop ${fmtCop(parseMoneyCop(emitted.reclassifiedAmountCop))} ≠ ` +
          `monto reclasificado por R1 en el balance de prueba ${fmtCop(parseMoneyCop(expected.reclassifiedAmountCop))}.`,
      );
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

// ---------------------------------------------------------------------------
// Helpers de E21–E25 (auditoría 2026-09-24)
// ---------------------------------------------------------------------------

interface IncomeBuckets {
  ingresos41: bigint;
  devoluciones: bigint;
  otrosIngresos: bigint;
  costos: bigint;
  g51: bigint;
  g52: bigint;
  g53: bigint;
  g54: bigint;
  otros5: bigint;
}

type IncomeLine = NiifReportJson['incomeStatement']['lines'][number];
type BalanceLine = NiifReportJson['balanceSheet']['assets'][number];

function periodCell(line: { amountPrimary: string; amountComparative: string | null }, period: StatementPeriod) {
  return period === 'primary' ? line.amountPrimary : line.amountComparative;
}

function codeDigits(account: string | null): string {
  return (account ?? '').replace(/\D/g, '');
}

/**
 * Aporte de un renglón con código al resultado (+ aumenta la utilidad, − la
 * reduce), con la misma regla de signo que la cascada E16. `null` si el
 * renglón no tiene código de las clases 4–7 o la celda no viaja.
 */
function incomeLineContribution(
  line: IncomeLine,
  period: StatementPeriod,
  expenseSignedIsEffect: boolean,
): { value: bigint; expense: boolean } | null {
  const code = codeDigits(line.account);
  const raw = periodCell(line, period);
  if (code.length === 0 || raw === null) return null;
  const v = parseMoneyCop(raw);
  if (code.startsWith('4')) {
    if (code.startsWith('4175')) return { value: -abs(v), expense: true };
    return { value: line.isAbsolute ? abs(v) : v, expense: false };
  }
  if (!/^[567]/.test(code)) return null;
  return { value: line.isAbsolute ? -abs(v) : expenseSignedIsEffect ? v : -v, expense: true };
}

const CASCADE_NAME: Record<IncomeCascadeKind, string> = {
  gross: 'Utilidad Bruta',
  operating: 'Resultado Operacional (EBIT)',
  pretax: 'Utilidad Antes de Impuestos',
  net: 'Utilidad Neta',
  ori: 'Otro Resultado Integral',
  comprehensive: 'Resultado Integral Total',
};

/** E22 del ERI: renglones sin código con importe (ver la nota en el llamador). */
function uncodedIncomeRowErrors(
  json: NiifReportJson,
  period: StatementPeriod,
  b: IncomeBuckets,
  expenseSignedIsEffect: boolean,
  casc: { gross: bigint; op: bigint; uai: bigint; net: bigint; ori: bigint | null },
): string[] {
  const lines = json.incomeStatement.lines;
  const etiqueta =
    period === 'primary'
      ? `periodo ${json.company.fiscalPeriod}`
      : `periodo comparativo ${json.company.comparativePeriod}`;
  const admisibles = new Set<string>();
  const add = (v: bigint) => admisibles.add(v.toString());
  for (const v of [ZERO, casc.gross, casc.op, casc.uai, casc.net]) add(v);
  if (casc.ori !== null) {
    add(casc.ori);
    add(casc.net + casc.ori);
  }
  // Ingresos y agregados mixtos: sólo con su signo.
  for (const v of [
    b.ingresos41,
    b.ingresos41 + b.devoluciones,
    b.otrosIngresos,
    b.ingresos41 + b.devoluciones + b.otrosIngresos,
    b.ingresos41 + b.otrosIngresos,
    b.otrosIngresos + b.g53 + b.otros5,
  ]) {
    add(v);
  }
  // Costos, gastos y devoluciones: su aporte (negativo) o su magnitud impresa.
  for (const v of [
    b.devoluciones,
    b.costos,
    b.devoluciones + b.costos,
    b.g51,
    b.g52,
    b.g51 + b.g52,
    b.costos + b.g51 + b.g52,
    b.g53,
    b.g54,
    b.otros5,
    b.g53 + b.otros5,
    b.g51 + b.g52 + b.g53 + b.g54 + b.otros5,
    b.g51 + b.g52 + b.g53 + b.otros5,
    b.costos + b.g51 + b.g52 + b.g53 + b.g54 + b.otros5,
  ]) {
    add(v);
    add(-v);
  }
  const cascadeValue = (kind: IncomeCascadeKind): bigint | null => {
    switch (kind) {
      case 'gross':
        return casc.gross;
      case 'operating':
        return casc.op;
      case 'pretax':
        return casc.uai;
      case 'net':
        return casc.net;
      case 'ori':
        return casc.ori;
      case 'comprehensive':
        return casc.ori === null ? null : casc.net + casc.ori;
    }
  };
  const isCoded = (l: IncomeLine) => codeDigits(l.account).length > 0;
  const contributions = lines.map((l) => incomeLineContribution(l, period, expenseSignedIsEffect));

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCoded(line)) continue;
    const raw = periodCell(line, period);
    if (raw === null) continue;
    const v = parseMoneyCop(raw);
    if (v === ZERO) continue;

    const kind = incomeCascadeKindOfLabel(line.label);
    if (kind !== null) {
      const expected = cascadeValue(kind);
      if (expected === null || v === expected) continue;
      // "PÉRDIDA NETA" (o "UTILIDAD (PÉRDIDA) NETA") impresa en magnitud sobre
      // una pérdida: el rótulo ya dice el signo, y la superficie imprime de
      // todos modos el campo anclado con su signo. Un rótulo que sólo dice
      // utilidad sobre una pérdida, no.
      const wordsLoss = /p[eé]rdida|negativ|d[eé]ficit/i.test(line.label);
      if (expected < ZERO && v === -expected && wordsLoss) continue;
      out.push(
        `E22. Estado de Resultados (${etiqueta}): el renglón sin código "${line.label}" es el escalón ` +
          `${CASCADE_NAME[kind]} e imprime ${fmtCop(v)}; la cifra anclada del estado es ` +
          `${fmtCop(expected)} (brecha ${fmtCop(v - expected)}). Un renglón del analista no sustituye un ` +
          `total del estado: el total se imprime desde su campo anclado y este renglón bloquea la emisión.`,
      );
      continue;
    }
    if (admisibles.has(v.toString())) continue;

    // Bloques contiguos de renglones con código, antes y después del renglón.
    let supported = false;
    for (const dir of [-1, 1]) {
      let sum = ZERO;
      let expenseOnly = true;
      for (let j = i + dir; j >= 0 && j < lines.length && isCoded(lines[j]); j += dir) {
        const c = contributions[j];
        if (c === null) break;
        sum += c.value;
        expenseOnly = expenseOnly && c.expense;
        if (sum === v || (expenseOnly && sum === -v)) {
          supported = true;
          break;
        }
      }
      if (supported) break;
    }
    if (supported) continue;
    out.push(
      `E22. Estado de Resultados (${etiqueta}): el renglón sin código "${line.label}" imprime ${fmtCop(v)}, ` +
        `que no es ningún escalón de la cascada (Utilidad Bruta ${fmtCop(casc.gross)}, EBIT ${fmtCop(casc.op)}, ` +
        `UAI ${fmtCop(casc.uai)}, Utilidad Neta ${fmtCop(casc.net)}) ni la suma de un bloque de renglones ` +
        `listados. Una cifra que el lector no puede reconstruir no se imprime en el estado.`,
    );
  }
  return out;
}

const TERM_CONTROL_TOTAL: Record<'assets' | 'liabilities', Record<'current' | 'nonCurrent', [string, string]>> = {
  assets: {
    current: ['activo corriente', 'activoCorriente'],
    nonCurrent: ['activo no corriente', 'activoNoCorriente'],
  },
  liabilities: {
    current: ['pasivo corriente', 'pasivoCorriente'],
    nonCurrent: ['pasivo no corriente', 'pasivoNoCorriente'],
  },
};

/**
 * E27 — subtotales corriente / no corriente del ESF contra la partición del
 * preprocesador (integración I4). `controlTotals.activoCorriente` /
 * `activoNoCorriente` / `pasivoCorriente` / `pasivoNoCorriente` son las cifras
 * de los KPIs de liquidez, el gate y X03; aquí se reconstruyen al centavo
 * desde las hojas del periodo con su plazo (`LedgerLeaf.term`: excepción de
 * vencimiento declarada, virtual de R1 por su origen, grupo PUC). E21 ancla
 * cada grupo y E22 exige que el subtotal sume su bloque, así que un grupo en el
 * bloque equivocado imprimía subtotales coherentes consigo mismos y distintos
 * de los KPIs cuando el ESF lo escribía el modelo (sin completado determinista).
 * Tolerancia $0. Una celda `null` no se contrasta (no es $0); un encabezado sin
 * "total" sólo si imprime monto; una sección con hojas de plazo no
 * determinable, tampoco.
 */
function termSubtotalErrors(
  nombre: string,
  section: 'assets' | 'liabilities',
  lines: readonly BalanceLine[],
  leaves: readonly LedgerLeaf[],
  period: StatementPeriod,
  etiqueta: string,
): string[] {
  const classCode = section === 'assets' ? 1 : 2;
  const expected = { current: ZERO, nonCurrent: ZERO };
  for (const leaf of leaves) {
    if (leaf.classCode !== classCode) continue;
    if (leaf.term === undefined || leaf.term === null) {
      if (leaf.cents !== ZERO) return [];
      continue;
    }
    expected[leaf.term] += leaf.cents;
  }
  const out: string[] = [];
  for (const line of lines) {
    if (line.account !== null && line.account.trim() !== '') continue;
    const kind = balanceTermOfLabel(section, line.label);
    if (!kind) continue;
    const raw = periodCell(line, period);
    if (raw === null) continue;
    const v = parseMoneyCop(raw);
    if (kind.header && v === ZERO) continue;
    const e = expected[kind.term];
    if (v === e) continue;
    const [noun, key] = TERM_CONTROL_TOTAL[section][kind.term];
    out.push(
      `E27. Estado de Situación Financiera — ${nombre} (${etiqueta}): "${line.label}" imprime ${fmtCop(v)} ` +
        `y el ${noun} del balance de prueba (controlTotals.${key}: la cifra de los KPIs de liquidez, ` +
        `el gate y X03) es ${fmtCop(e)}. Brecha: ${fmtCop(v - e)}. La clasificación corriente / no corriente ` +
        `del ESF es la del preprocesador, con los vencimientos declarados (NIIF para las PYMES 4.4).`,
    );
  }
  return out;
}

/** E22 del ESF: subtotales y encabezados sin código, comparados con signo. */
function uncodedBalanceRowErrors(
  nombre: string,
  lines: readonly BalanceLine[],
  total: bigint | null,
  liabPlusEquity: bigint | null,
  period: StatementPeriod,
  etiqueta: string,
): string[] {
  const out: string[] = [];
  const isDetail = (l: BalanceLine) => l.account !== null && l.account.trim() !== '';
  const presented = (l: BalanceLine) =>
    signedLineAmount(l as StatementLineWithColumns, period) ?? ZERO;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isDetail(line)) continue;
    const raw = periodCell(line, period);
    if (raw === null) continue;
    const v = parseMoneyCop(raw);
    if (v === ZERO) continue;
    if (total !== null && v === total) continue;
    if (liabPlusEquity !== null && v === liabPlusEquity) continue;
    // Bloques que terminan justo antes del renglón (subtotal al pie, subtotal
    // acumulado desde el inicio de la sección) y el bloque que lo sigue
    // (encabezado con monto).
    let supported = false;
    let sum = ZERO;
    for (let j = i - 1; j >= 0 && !supported; j--) {
      if (!isDetail(lines[j])) continue;
      sum += presented(lines[j]);
      if (sum === v) supported = true;
    }
    sum = ZERO;
    for (let j = i + 1; j < lines.length && isDetail(lines[j]) && !supported; j++) {
      sum += presented(lines[j]);
      if (sum === v) supported = true;
    }
    if (supported) continue;
    out.push(
      `E22. Estado de Situación Financiera — ${nombre} (${etiqueta}): el renglón sin código "${line.label}" ` +
        `imprime ${fmtCop(v)}, que no es, con su signo, la suma de ningún bloque de renglones de la ` +
        `sección, ni su total${total !== null ? ` (${fmtCop(total)})` : ''}. El lector no puede reconstruirlo.`,
    );
  }
  return out;
}

/**
 * Agrupa los renglones con código por códigos compartidos (unión de conjuntos)
 * y asigna cada hoja al código listado MÁS específico que la contiene.
 * Devuelve, por grupo, los índices de los renglones y la suma asignada.
 */
function anchorGroups(
  keysByLine: Array<{ index: number; keys: string[] }>,
  leaves: readonly LedgerLeaf[],
  acceptLeaf: (leaf: LedgerLeaf) => boolean,
  leafValue: (leaf: LedgerLeaf, key: string) => void,
): Array<{ indices: number[]; keys: Set<string> }> {
  const allKeys = Array.from(new Set(keysByLine.flatMap((x) => x.keys)));
  for (const leaf of leaves) {
    if (!acceptLeaf(leaf)) continue;
    let best: string | null = null;
    for (const k of allKeys) {
      if (leaf.code.startsWith(k) && (best === null || k.length > best.length)) best = k;
    }
    if (best !== null) leafValue(leaf, best);
  }
  // Unión de renglones que comparten algún código.
  const groups: Array<{ indices: number[]; keys: Set<string> }> = [];
  for (const { index, keys } of keysByLine) {
    const touching = groups.filter((g) => keys.some((k) => g.keys.has(k)));
    const merged = { indices: [index], keys: new Set(keys) };
    for (const g of touching) {
      merged.indices.push(...g.indices);
      for (const k of g.keys) merged.keys.add(k);
      groups.splice(groups.indexOf(g), 1);
    }
    groups.push(merged);
  }
  return groups;
}

/** E21 del ESF: cada renglón con código contra las hojas de su clase. */
function balanceLineAnchorErrors(
  nombre: string,
  lines: readonly BalanceLine[],
  classCode: number,
  leaves: readonly LedgerLeaf[],
  period: StatementPeriod,
  etiqueta: string,
): string[] {
  const out: string[] = [];
  const keysByLine: Array<{ index: number; keys: string[] }> = [];
  lines.forEach((line, index) => {
    if (line.account === null || line.account.trim() === '') return;
    const keys = (line.account.match(/\d+/g) ?? []).filter((k) => k.startsWith(String(classCode)));
    if (keys.length === 0) {
      if (periodCell(line, period) === null || parseMoneyCop(periodCell(line, period)!) === ZERO) return;
      out.push(
        `E21. Estado de Situación Financiera — ${nombre} (${etiqueta}): el renglón "${line.account} — ` +
          `${line.label}" no lleva un código PUC de la clase ${classCode}; su cifra no se puede anclar al ` +
          `balance de prueba.`,
      );
      return;
    }
    keysByLine.push({ index, keys });
  });
  const assigned = new Map<string, bigint>();
  const groups = anchorGroups(
    keysByLine,
    leaves,
    (leaf) => leaf.classCode === classCode,
    (leaf, key) => assigned.set(key, (assigned.get(key) ?? ZERO) + leaf.cents),
  );
  for (const g of groups) {
    let emitted = ZERO;
    let missingCell = false;
    for (const i of g.indices) {
      const v = signedLineAmount(lines[i] as StatementLineWithColumns, period);
      if (v === null) missingCell = true;
      else emitted += v;
    }
    if (missingCell) continue; // E15c: una celda ausente no se trata como cero.
    const expected = [...g.keys].reduce((acc, k) => acc + (assigned.get(k) ?? ZERO), ZERO);
    if (emitted === expected) continue;
    const rotulo = g.indices.map((i) => `${lines[i].account} — ${lines[i].label}`).join(' + ');
    out.push(
      `E21. Estado de Situación Financiera — ${nombre} (${etiqueta}): "${rotulo}" imprime ` +
        `${fmtCop(emitted)} y las cuentas del balance de prueba de ese código suman ${fmtCop(expected)} ` +
        `(brecha ${fmtCop(emitted - expected)}). El importe de un renglón con código PUC es la suma de sus ` +
        `cuentas: no lo redacta el analista.`,
    );
  }
  return out;
}

/** E21 del ERI: cada renglón con código de las clases 4–7 contra sus hojas. */
function incomeLineAnchorErrors(
  lines: readonly IncomeLine[],
  leaves: readonly LedgerLeaf[],
  period: StatementPeriod,
  etiqueta: string,
): string[] {
  const out: string[] = [];
  const keysByLine: Array<{ index: number; keys: string[] }> = [];
  lines.forEach((line, index) => {
    const keys = (line.account?.match(/\d+/g) ?? []).filter((k) => /^[4-7]/.test(k));
    if (keys.length > 0) keysByLine.push({ index, keys });
  });
  if (keysByLine.length === 0) return out;
  // Orientación de la clase 4 (firmada o en magnitudes): la del total de las
  // ordinarias, igual que las anclas (`anchors.ts`).
  const ordinarias = leaves
    .filter((l) => l.classCode === 4 && !l.code.startsWith('4175'))
    .reduce((acc, l) => acc + l.cents, ZERO);
  const signo = ordinarias < ZERO ? BigInt(-1) : BigInt(1);
  const ord = new Map<string, bigint>();
  const dev = new Map<string, bigint>();
  const exp = new Map<string, bigint>();
  const bump = (m: Map<string, bigint>, k: string, v: bigint) => m.set(k, (m.get(k) ?? ZERO) + v);
  const groups = anchorGroups(
    keysByLine,
    leaves,
    (leaf) => leaf.classCode >= 4 && leaf.classCode <= 7,
    (leaf, key) => {
      if (leaf.classCode === 4) bump(leaf.code.startsWith('4175') ? dev : ord, key, leaf.cents);
      else bump(exp, key, leaf.cents);
    },
  );
  for (const g of groups) {
    let expected = ZERO;
    for (const k of g.keys) {
      expected += signo * (ord.get(k) ?? ZERO) - abs(dev.get(k) ?? ZERO) - (exp.get(k) ?? ZERO);
    }
    let emittedA = ZERO;
    let emittedB = ZERO;
    let skip = false;
    for (const i of g.indices) {
      const a = incomeLineContribution(lines[i], period, true);
      const b = incomeLineContribution(lines[i], period, false);
      if (periodCell(lines[i], period) === null) {
        skip = true;
        break;
      }
      emittedA += a?.value ?? ZERO;
      emittedB += b?.value ?? ZERO;
    }
    if (skip) continue; // E16c: una celda ausente no se trata como cero.
    if (emittedA === expected || emittedB === expected) continue;
    const rotulo = g.indices.map((i) => `${lines[i].account} — ${lines[i].label}`).join(' + ');
    out.push(
      `E21. Estado de Resultados (${etiqueta}): "${rotulo}" aporta ${fmtCop(emittedA)} al resultado y las ` +
        `cuentas del balance de prueba de ese código aportan ${fmtCop(expected)} (brecha ` +
        `${fmtCop(emittedA - expected)}). Ingresos 41 − devoluciones 4175, costos 6/7 y gastos 51/52/53/54 ` +
        `salen de las hojas del balance: el analista no los redacta.`,
    );
  }
  return out;
}

type EquityColumns = {
  capital: bigint;
  prima: bigint;
  reservas: bigint;
  ejercicio: bigint;
  acumulados: bigint;
  ori: bigint;
  /** Grupos sin columna en el ECP (34, 35, …): si ≠ 0 la comparación por columna no aplica. */
  unmapped: bigint;
};

function equityColumnsFromLedger(leaves: readonly LedgerLeaf[]): EquityColumns {
  const c: EquityColumns = {
    capital: ZERO, prima: ZERO, reservas: ZERO, ejercicio: ZERO, acumulados: ZERO, ori: ZERO, unmapped: ZERO,
  };
  for (const leaf of leaves) {
    if (leaf.classCode !== 3) continue;
    const g = leaf.code.slice(0, 2);
    if (g === '31') c.capital += leaf.cents;
    else if (g === '32') c.prima += leaf.cents;
    else if (g === '33') c.reservas += leaf.cents;
    else if (g === '36') c.ejercicio += leaf.cents;
    else if (g === '37') c.acumulados += leaf.cents;
    else if (g === '38') c.ori += leaf.cents;
    else c.unmapped += leaf.cents;
  }
  return c;
}

/**
 * E6b — ORI del ERI contra el ancla determinista de cada periodo (enmienda 12,
 * spec v2.1). Ancla = Δ grupo PUC 38 entre el corte de apertura y el de cierre
 * (`buildOriAnchors`, `ComparativeStatementsBasis.oriCents`):
 *   - periodo actual: apertura = corte comparativo (hojas `ledgers.comparative`);
 *     sin él, $0 bajo el modo simple de PresentationV3 (lo anterior);
 *   - periodo comparativo: apertura = corte anterior al comparativo (la base
 *     comparativa); sin él y con saldo en el grupo 38, N/D (null); sin saldo,
 *     $0 o N/D. Con P&G comparativo N/D (saldos de apertura) no se exige.
 */
function oriAnchorErrors(
  json: NiifReportJson,
  options: NiifJsonValidatorOptions,
  oriPnl: bigint,
): string[] {
  const out: string[] = [];
  const fp = json.company.fiscalPeriod;
  const cp = json.company.comparativePeriod;
  const ledgers = options.ledgers;
  const basis = options.comparativeStatements;
  const simpleMode = !!options.presentationV3 && options.presentationV3.oriComponents.length === 0;
  const g38 = (leaves: readonly LedgerLeaf[]) => equityColumnsFromLedger(leaves).ori;
  const regla =
    'El ORI del periodo es el movimiento de la columna ORI del ECP (NIIF para las PYMES, Secciones 5 y 6 — ' +
    '6.3(c)); lo calcula el código y el ERI lo copia.';

  if (cp !== null && ledgers?.comparative) {
    const anchor = g38(ledgers.primary) - g38(ledgers.comparative);
    if (oriPnl !== anchor) {
      out.push(
        `E6b. ORI del ERI ${fp} (${fmtCop(oriPnl)}) ≠ variación del grupo PUC 38 (superávit por valorizaciones / ORI) ` +
          `entre los cortes ${cp} y ${fp} (${fmtCop(anchor)}). Brecha: ${fmtCop(oriPnl - anchor)}. ${regla}`,
      );
    }
  } else if (simpleMode && oriPnl !== ZERO) {
    out.push(
      `E6b. El ERI ${fp} presenta Otro Resultado Integral (${fmtCop(oriPnl)}) sin corte de apertura del periodo: ` +
        `la variación del grupo PUC 38 no es medible y el ORI no tiene ancla; debe ser $0.`,
    );
  }

  if (cp === null || options.comparativeIsOpening === true) return out;
  const oriCmp = json.incomeStatement.oriComparative;
  const cmp = oriCmp === null ? null : parseMoneyCop(oriCmp);
  const measured = basis?.oriCents ?? null;
  if (basis && measured !== null) {
    if (cmp === null ? measured !== ZERO : cmp !== measured) {
      out.push(
        `E6b. ORI del ERI comparativo ${cp} (${cmp === null ? 'N/D' : fmtCop(cmp)}) ≠ variación del grupo PUC 38 ` +
          `(superávit por valorizaciones / ORI) entre los cortes ${basis.openingPeriod} y ${cp} (${fmtCop(measured)})` +
          `${cmp === null ? '' : `. Brecha: ${fmtCop(cmp - measured)}`}. ${regla}`,
      );
    }
    return out;
  }
  if (cmp === null) return out;
  const anchored = !!basis && !!ledgers?.comparative;
  const saldo38 = anchored ? g38(ledgers!.comparative!) : ZERO;
  if (saldo38 !== ZERO) {
    out.push(
      `E6b. ORI del ERI comparativo ${cp} (${fmtCop(cmp)}): sin un corte de apertura utilizable del periodo ` +
        `comparativo la variación del grupo PUC 38 (saldo al cierre de ${cp}: ${fmtCop(saldo38)}) no es medible; ` +
        `el ORI comparativo se presenta N/D (null), no ${fmtCop(cmp)}.`,
    );
  } else if ((simpleMode || anchored) && cmp !== ZERO) {
    out.push(
      `E6b. El ERI presenta Otro Resultado Integral comparativo ${cp} (${fmtCop(cmp)}) sin ancla: el balance ` +
        `no permite medir la variación del grupo PUC 38 de ese periodo; debe ser $0 o N/D.`,
    );
  }
  return out;
}

function equityColumnsOfRow(r: EquityChangeRowJson): Omit<EquityColumns, 'unmapped'> {
  return {
    capital: parseMoneyCop(r.capitalSocial),
    prima: parseMoneyCop(r.primaColocacion),
    reservas: parseMoneyCop(r.reservaLegal) + parseMoneyCop(r.otrasReservas),
    ejercicio: parseMoneyCop(r.resultadoEjercicio),
    acumulados: parseMoneyCop(r.resultadosAcumulados),
    ori: parseMoneyCop(r.ori),
  };
}

const EQUITY_COLUMN_NAMES: Record<keyof Omit<EquityColumns, 'unmapped'>, string> = {
  capital: 'Capital social (31)',
  prima: 'Superávit / prima (32)',
  reservas: 'Reservas (33)',
  ejercicio: 'Resultado del ejercicio (36)',
  acumulados: 'Resultados acumulados (37)',
  ori: 'ORI / superávit por valorizaciones (38)',
};

/**
 * E19b: una fila del ECP (saldo inicial) contra los renglones de patrimonio del
 * ESF de la columna pedida, por grupo PUC. Mismas condiciones de E20: todos los
 * renglones con código mapeables, sin 34/35 con saldo y el ESF desagregando
 * los grupos que el ECP usa.
 */
function equityRowVsBalanceLines(
  row: EquityChangeRowJson,
  equityLines: readonly BalanceLine[],
  period: StatementPeriod,
  rule: string,
  nombreFila: string,
): string[] {
  const byGroup = new Map<string, bigint>();
  let detail = 0;
  for (const line of equityLines) {
    if (line.account === null || line.account.trim() === '') continue;
    const group = codeDigits(line.account).slice(0, 2);
    if (!['31', '32', '33', '34', '35', '36', '37', '38'].includes(group)) return [];
    const raw = periodCell(line, period);
    if (raw === null) return [];
    byGroup.set(group, (byGroup.get(group) ?? ZERO) + parseMoneyCop(raw));
    detail++;
  }
  if (detail === 0) return [];
  if ((byGroup.get('34') ?? ZERO) !== ZERO || (byGroup.get('35') ?? ZERO) !== ZERO) return [];
  const cols = equityColumnsOfRow(row);
  const groupOf: Record<keyof typeof cols, string> = {
    capital: '31', prima: '32', reservas: '33', ejercicio: '36', acumulados: '37', ori: '38',
  };
  const covered = (Object.keys(groupOf) as Array<keyof typeof cols>).every(
    (k) => byGroup.has(groupOf[k]) || cols[k] === ZERO,
  );
  if (!covered) return [];
  const out: string[] = [];
  for (const k of Object.keys(groupOf) as Array<keyof typeof cols>) {
    const esf = byGroup.get(groupOf[k]) ?? ZERO;
    if (cols[k] === esf) continue;
    out.push(
      `${rule}. ECP ${nombreFila} — ${EQUITY_COLUMN_NAMES[k]}: ${fmtCop(cols[k])} ≠ renglones del Estado ` +
        `de Situación Financiera ${period === 'comparative' ? 'del periodo comparativo ' : ''}` +
        `${fmtCop(esf)}. Brecha: ${fmtCop(cols[k] - esf)}. NIIF para las PYMES 6.3.`,
    );
  }
  return out;
}

/**
 * E24: columnas del ECP contra los grupos patrimoniales del balance de prueba
 * (apertura = comparativo, cierre = periodo actual), y movimientos contra las
 * variaciones deterministas. Un movimiento en una columna cuyo grupo no varió
 * en el balance, una distribución sin soporte (2360/35 o disminución
 * patrimonial no explicada) o un aporte sin aumento no explicado por el
 * resultado son movimientos fabricados (NIIF para las PYMES 6.3, NIC 7 ¶43).
 */
function equityLedgerErrors(
  json: NiifReportJson,
  primary: readonly LedgerLeaf[],
  comparative: readonly LedgerLeaf[] | null,
  efe: DeterministicCashFlow | null,
): string[] {
  const out: string[] = [];
  const rows = json.equityChanges.rows;
  const opening = rows.find((r) => r.kind === 'opening_balance');
  const closing = [...rows].reverse().find((r) => r.kind === 'closing_balance');
  const colsP = equityColumnsFromLedger(primary);
  const colsC = comparative ? equityColumnsFromLedger(comparative) : null;
  const keys = Object.keys(EQUITY_COLUMN_NAMES) as Array<keyof typeof EQUITY_COLUMN_NAMES>;

  const compare = (row: EquityChangeRowJson, ledger: EquityColumns, fila: string, periodo: string) => {
    if (ledger.unmapped !== ZERO) return;
    const cols = equityColumnsOfRow(row);
    for (const k of keys) {
      if (cols[k] === ledger[k]) continue;
      out.push(
        `E24. ECP ${fila} — ${EQUITY_COLUMN_NAMES[k]}: ${fmtCop(cols[k])} y el balance de prueba ` +
          `${periodo} registra ${fmtCop(ledger[k])} (brecha ${fmtCop(cols[k] - ledger[k])}). ` +
          `Cada columna del ECP es el saldo de su grupo patrimonial (NIIF para las PYMES 6.3).`,
      );
    }
  };
  if (closing) compare(closing, colsP, 'saldo final', `del periodo ${json.company.fiscalPeriod}`);
  if (opening && colsC) {
    compare(opening, colsC, 'saldo inicial', `del periodo comparativo ${json.company.comparativePeriod ?? ''}`);
  }

  const movements = rows.filter((r) => r.kind !== 'opening_balance' && r.kind !== 'closing_balance');
  if (colsC && colsP.unmapped === ZERO && colsC.unmapped === ZERO) {
    // Capital, prima, reservas y ORI sólo se mueven si su grupo varió.
    for (const k of ['capital', 'prima', 'reservas', 'ori'] as const) {
      if (colsP[k] !== colsC[k]) continue;
      for (const r of movements) {
        const v = equityColumnsOfRow(r)[k];
        if (v === ZERO) continue;
        out.push(
          `E24. ECP fila "${r.label}" (${r.kind}) mueve ${EQUITY_COLUMN_NAMES[k]} en ${fmtCop(v)} y el ` +
            `balance de prueba no registra variación de ese grupo entre ${json.company.comparativePeriod ?? 'la apertura'} ` +
            `y ${json.company.fiscalPeriod}: el movimiento no tiene soporte.`,
        );
      }
    }
  }
  for (const r of movements) {
    if (r.kind === 'profit_for_period') {
      const c = equityColumnsOfRow(r);
      const others = c.capital + c.prima + c.reservas + c.acumulados + c.ori;
      if (c.capital !== ZERO || c.prima !== ZERO || c.reservas !== ZERO || c.acumulados !== ZERO || c.ori !== ZERO) {
        out.push(
          `E24. ECP fila "${r.label}" (resultado del ejercicio) mueve columnas distintas del resultado ` +
            `del ejercicio (${fmtCop(others)}): el resultado del periodo sólo afecta la columna 36.`,
        );
      }
    }
  }
  if (efe) {
    const distributionSupported =
      efe.dividendEvidence.found ||
      efe.ownerFlows.classification === 'distribution_pending_support' ||
      efe.ownerFlows.classification === 'unreconciled';
    for (const r of movements) {
      const nonZero = keys.some((k) => equityColumnsOfRow(r)[k] !== ZERO) || parseMoneyCop(r.total) !== ZERO;
      if (!nonZero) continue;
      if (r.kind === 'dividend_distribution' && !distributionSupported) {
        out.push(
          `E24. ECP fila "${r.label}" (distribución de dividendos, ${fmtCop(parseMoneyCop(r.total))}): el ` +
            `balance de prueba no la sostiene (sin movimiento en 2360/35 ni disminución patrimonial no ` +
            `explicada por el resultado). Una distribución fabricada no se presenta (Art. 155 C.Co.).`,
        );
      }
      if (
        r.kind === 'capital_contribution' &&
        parseMoneyCop(r.total) !== ZERO &&
        efe.ownerFlows.classification !== 'contribution'
      ) {
        out.push(
          `E24. ECP fila "${r.label}" (aporte de capital, ${fmtCop(parseMoneyCop(r.total))}): el patrimonio ` +
            `del balance de prueba no aumentó más allá del resultado del ejercicio; el aporte no tiene soporte.`,
        );
      }
    }
  }
  return out;
}

/**
 * Año citado junto a una norma ("Decreto 2420 de 2015", "Ley 1314/2009",
 * "NIIF para las PYMES 2015"): no fecha la cifra del renglón.
 */
const CITATION_BEFORE_YEAR_RE =
  /(?:\b(?:ley|decreto|dur|resoluci[oó]n|circular|concepto|oficio|sentencia|art[ií]culo|art|estatuto|acuerdo|c[oó]digo|secci[oó]n|par[aá]grafo|norma)\b\.?\s*(?:n(?:o|º|°|úm|um|úmero|umero)?\.?\s*)?[\d.\-]*\s*(?:de(?:l)?\s+)?$)|(?:\b(?:niif|nic|nif|pymes|iasb|ifrs|ias)\b[^\d]{0,24}$)/i;

/**
 * E25: rótulos de los cuatro estados que fechan una cifra en un año fuera del
 * informe (auditoría 2026-09-24, e2e-niif-09: "Saldo al 31 de diciembre de
 * 2023" en un informe 2025/2024). Se admiten el año del informe, el anterior
 * (apertura) y el comparativo; los años de una cita normativa no cuentan.
 */
function labelYearErrors(json: NiifReportJson): string[] {
  const fp = /\d{4}/.exec(json.company.fiscalPeriod)?.[0];
  if (!fp) return [];
  const allowed = new Set([fp, String(Number(fp) - 1)]);
  const cp = json.company.comparativePeriod ? /\d{4}/.exec(json.company.comparativePeriod)?.[0] : undefined;
  if (cp) allowed.add(cp);
  // El ECP del periodo comparativo abre con el cierre del año anterior al
  // comparativo (traslado de su resultado): ese año se admite SÓLO en sus
  // filas; en el resto del informe sigue fuera de periodo (e2e-niif-09).
  const comparativeRows = json.equityChanges.comparativeRows ?? [];
  const allowedComparativeRows = new Set(allowed);
  if (cp) allowedComparativeRows.add(String(Number(cp) - 1));
  const labels: Array<[string, string, Set<string>]> = [];
  for (const [where, lines] of [
    ['Estado de Situación Financiera', [...json.balanceSheet.assets, ...json.balanceSheet.liabilities, ...json.balanceSheet.equity]],
    ['Estado de Resultados', json.incomeStatement.lines],
    ['Estado de Flujos de Efectivo', json.cashFlow.sections.flatMap((s) => s.lines)],
  ] as const) {
    for (const l of lines) labels.push([where, l.label, allowed]);
  }
  for (const r of json.equityChanges.rows) labels.push(['Estado de Cambios en el Patrimonio', r.label, allowed]);
  for (const r of comparativeRows) {
    labels.push(['Estado de Cambios en el Patrimonio (periodo comparativo)', r.label, allowedComparativeRows]);
  }

  const out: string[] = [];
  for (const [where, label, years] of labels) {
    const re = /(?<![\d/.,])((?:19|20)\d{2})(?![\d])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(label)) !== null) {
      const year = m[1];
      if (years.has(year)) continue;
      const before = label.slice(0, m.index);
      if (/\/\s*$/.test(before) || CITATION_BEFORE_YEAR_RE.test(before)) continue;
      out.push(
        `E25. ${where}: el rótulo "${label}" cita el año ${year}, fuera del periodo del informe ` +
          `(${json.company.fiscalPeriod}${json.company.comparativePeriod ? ` y comparativo ${json.company.comparativePeriod}` : ''}). ` +
          `Un rótulo no puede fechar la cifra en otro periodo.`,
      );
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Comparativos del EFE y del ECP (auditoría integral 2026-09-24, pendiente #3)
// ---------------------------------------------------------------------------

const EQUITY_ROW_COLUMNS = [
  'capitalSocial',
  'primaColocacion',
  'reservaLegal',
  'otrasReservas',
  'resultadosAcumulados',
  'resultadoEjercicio',
  'ori',
  'total',
] as const;

/** El EFE declara columna comparativa (algún subtotal, total o celda no nulo). */
function cashFlowComparativePresented(cf: NiifReportJson['cashFlow']): {
  anyTotal: boolean;
  allTotals: boolean;
  anyCell: boolean;
} {
  const totals = [
    cf.netChangeComparative,
    cf.cashOpeningComparative,
    cf.cashClosingComparative,
    ...cf.sections.map((s) => s.netFlowComparative),
  ];
  // `undefined` (informe serializado antes del contrato, sin pasar por
  // `NiifReportSchema`) cuenta como no presentado, igual que `null`.
  const shown = (v: string | null | undefined) => v !== null && v !== undefined;
  return {
    anyTotal: totals.some(shown),
    allTotals: totals.every(shown),
    anyCell: cf.sections.some((s) => s.lines.some((l) => shown(l.amountComparative))),
  };
}

/** La columna comparativa del EFE vista como un EFE de un periodo. */
function comparativeCashFlowView(cf: NiifReportJson['cashFlow']): CashFlowStatementLike {
  return {
    sections: cf.sections.map((s) => ({
      section: s.section,
      lines: s.lines
        .filter((l) => (l.amountComparative ?? null) !== null)
        .map((l) => ({ account: l.account, label: l.label, amountPrimary: l.amountComparative as string })),
      netFlow: s.netFlowComparative ?? '0',
    })),
    netChange: cf.netChangeComparative ?? '0',
    cashOpening: cf.cashOpeningComparative ?? '0',
    cashClosing: cf.cashClosingComparative ?? '0',
  };
}

function comparativeStatementErrors(
  json: NiifReportJson,
  options: NiifJsonValidatorOptions,
  pygComparativeIsNd: boolean,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cp = json.company.comparativePeriod;
  const etiqueta = `periodo comparativo ${cp ?? '(no declarado)'}`;
  const basis = options.comparativeStatements;
  const anchored = basis !== undefined;

  // -- EFE -------------------------------------------------------------------
  const cf = json.cashFlow;
  const presence = cashFlowComparativePresented(cf);
  const cfPresented = presence.anyTotal || presence.anyCell;
  if (cfPresented && cp === null) {
    errors.push(
      `E2. EFE: se presenta una columna comparativa y el informe no declara periodo comparativo. ` +
        `Una cifra comparativa sin periodo no se imprime.`,
    );
  } else if (presence.anyCell && !presence.anyTotal) {
    errors.push(
      `E2. EFE (${etiqueta}): renglones con cifra comparativa sin subtotales ni efectivo comparativos. ` +
        `La columna comparativa del EFE la calcula el código desde el balance de prueba; una celda ` +
        `suelta no tiene base determinista y no se imprime.`,
    );
  } else if (presence.anyTotal && !presence.allTotals) {
    errors.push(
      `E2. EFE (${etiqueta}): la columna comparativa está incompleta (subtotales o efectivo al ` +
        `inicio/final en null). O se presenta completa o no se presenta (nota de comparativo no presentado).`,
    );
  } else if (presence.allTotals && cp !== null) {
    const netChange = parseMoneyCop(cf.netChangeComparative!);
    const opening = parseMoneyCop(cf.cashOpeningComparative!);
    const closing = parseMoneyCop(cf.cashClosingComparative!);
    const sumSections = cf.sections.reduce((acc, s) => acc + parseMoneyCop(s.netFlowComparative!), ZERO);
    if (sumSections !== netChange) {
      errors.push(
        `E2. EFE (${etiqueta}): netChange ≠ Σ(netFlow secciones). Brecha: ${fmtCop(netChange - sumSections)}.`,
      );
    }
    if (opening + netChange !== closing) {
      errors.push(
        `E2. EFE (${etiqueta}): cashClosing ≠ cashOpening + netChange. Brecha: ` +
          `${fmtCop(closing - opening - netChange)}.`,
      );
    }
    // E3 del comparativo: su efectivo final ES el efectivo inicial del periodo.
    const primaryOpening = parseMoneyCop(cf.cashOpening);
    if (closing !== primaryOpening) {
      errors.push(
        `E3. EFE (${etiqueta}): el efectivo al final del periodo comparativo (${fmtCop(closing)}) ≠ ` +
          `efectivo al inicio del periodo ${json.company.fiscalPeriod} (${fmtCop(primaryOpening)}). ` +
          `Brecha: ${fmtCop(closing - primaryOpening)}. Es el mismo saldo (NIC 7 ¶45).`,
      );
    }
    const missing = cf.sections.reduce(
      (acc, s) =>
        acc + s.lines.filter((l) => (l.amountComparative ?? null) === null && parseMoneyCop(l.amountPrimary) !== ZERO).length,
      0,
    );
    if (missing > 0) {
      errors.push(
        `E2. EFE (${etiqueta}): ${missing} renglón(es) sin cifra comparativa bajo una columna comparativa ` +
          `presentada; la columna no se puede verificar contra sus subtotales.`,
      );
    } else {
      // Σ renglones comparativos == subtotal comparativo de cada actividad.
      for (const s of cf.sections) {
        const sum = s.lines.reduce(
          (acc, l) => ((l.amountComparative ?? null) === null ? acc : acc + parseMoneyCop(l.amountComparative!)),
          ZERO,
        );
        const netFlow = parseMoneyCop(s.netFlowComparative!);
        if (sum === netFlow) continue;
        errors.push(
          `E2. EFE (${etiqueta}) — actividades de ${s.section}: los renglones comparativos suman ` +
            `${fmtCop(sum)} y el subtotal comparativo es ${fmtCop(netFlow)}. Brecha: ${fmtCop(sum - netFlow)}.`,
        );
      }
    }
    // E11 del comparativo: el método indirecto parte del resultado del periodo.
    const operating = cf.sections.find((s) => s.section === 'operating');
    const first = operating?.lines[0];
    const netIncomeComparative = json.incomeStatement.netIncomeComparative;
    if (first && first.amountComparative !== null && netIncomeComparative !== null && !pygComparativeIsNd) {
      const firstCmp = parseMoneyCop(first.amountComparative);
      const niCmp = parseMoneyCop(netIncomeComparative);
      if (firstCmp !== niCmp) {
        errors.push(
          `E11. EFE (${etiqueta}): el primer renglón de operación (${fmtCop(firstCmp)}) ≠ utilidad neta ` +
            `comparativa del P&G (${fmtCop(niCmp)}). Brecha: ${fmtCop(firstCmp - niCmp)}.`,
        );
      }
    }
  }

  if (anchored) {
    const detCf = basis?.cashFlow ?? null;
    if (cfPresented && detCf === null) {
      const reason = basis?.cashFlowNote ?? 'el balance de prueba no tiene periodo comparativo';
      errors.push(
        `E18. EFE (${etiqueta}): se presenta una columna comparativa sin base determinista — ${reason} ` +
          `Un comparativo del EFE sin corte de apertura no se presenta (NIIF para las PYMES 3.14).`,
      );
    } else if (detCf !== null && presence.allTotals && cp !== null) {
      const view = comparativeCashFlowView(cf);
      for (const msg of formatCashFlowCrossCheckViolations(crossCheckCashFlowAgainstDeterministic(view, detCf))) {
        errors.push(`E18. (${etiqueta}) ${msg}`);
      }
      for (const msg of formatCashFlowLineViolations(crossCheckCashFlowLinesAgainstDeterministic(view, detCf))) {
        errors.push(`E23. (${etiqueta}) ${msg}`);
      }
    } else if (detCf !== null && !cfPresented && cp !== null) {
      warnings.push(
        `E18c. EFE: la columna comparativa ${cp} es calculable desde el balance de prueba y el informe ` +
          `no la presenta (NIIF para las PYMES 3.14). Regenere el informe.`,
      );
    }
  }

  // -- ECP del periodo comparativo ---------------------------------------------
  const rows = json.equityChanges.comparativeRows ?? null;
  if (rows !== null) {
    if (cp === null) {
      errors.push(
        `E4. ECP: se presentan filas del periodo comparativo y el informe no declara periodo comparativo.`,
      );
    } else {
      for (const [index, row] of rows.entries()) {
        const sum = EQUITY_ROW_COLUMNS.slice(0, 7).reduce((acc, k) => acc + parseMoneyCop(row[k]), ZERO);
        const total = parseMoneyCop(row.total);
        if (sum !== total) {
          errors.push(
            `E17. ECP (${etiqueta}) fila ${index + 1} (${row.kind}): suma de componentes ${fmtCop(sum)} ≠ ` +
              `total ${fmtCop(total)}. Brecha: ${fmtCop(sum - total)}.`,
          );
        }
      }
      const opening = rows.find((r) => r.kind === 'opening_balance');
      const closing = [...rows].reverse().find((r) => r.kind === 'closing_balance');
      if (!opening || !closing) {
        errors.push(`E7. ECP (${etiqueta}): debe incluir opening_balance y closing_balance.`);
      } else {
        for (const col of EQUITY_ROW_COLUMNS) {
          const computed = rows.reduce<bigint>(
            (acc, r) => (r.kind === 'closing_balance' ? acc : acc + parseMoneyCop(r[col])),
            ZERO,
          );
          const closingVal = parseMoneyCop(closing[col]);
          if (computed === closingVal) continue;
          errors.push(
            `E7c. ECP (${etiqueta}) columna "${col}" no cuadra: Σ filas (${fmtCop(computed)}) ≠ ` +
              `closing_balance (${fmtCop(closingVal)}); brecha ${fmtCop(computed - closingVal)}.`,
          );
        }
        const totalEquityComparative = json.balanceSheet.totalEquityComparative;
        if (totalEquityComparative !== null && parseMoneyCop(closing.total) !== parseMoneyCop(totalEquityComparative)) {
          errors.push(
            `E4. ECP (${etiqueta}): saldo final ${fmtCop(parseMoneyCop(closing.total))} ≠ Total Patrimonio ` +
              `comparativo del ESF ${fmtCop(parseMoneyCop(totalEquityComparative))}.`,
          );
        }
        // E20 del comparativo: cada columna del saldo final del ECP
        // comparativo == renglones de patrimonio del ESF comparativo.
        if (totalEquityComparative !== null) {
          errors.push(
            ...equityRowVsBalanceLines(
              closing,
              json.balanceSheet.equity,
              'comparative',
              'E20c',
              `(${etiqueta}) saldo final`,
            ),
          );
        }
        // E6 del periodo comparativo (integración I2): el ORI del ERI
        // comparativo es la variación de la columna ORI del ECP comparativo
        // (Δ grupo 38), igual que en el periodo actual (NIIF para las PYMES
        // 6.3). Un ORI comparativo no presentado (null) o un P&G comparativo
        // N/D (saldos de apertura) no se cruzan.
        //
        // La revisión I2 lo había apagado bajo el régimen de E6b porque E6b
        // fijaba el ORI del ERI en $0 y el ECP comparativo determinista lleva
        // Δ38 en la columna ORI. Con la enmienda 12 (spec v2.1) E6b ancla el ORI
        // a esa misma Δ38, así que los dos cruces coinciden y corre siempre.
        const oriCmp = json.incomeStatement.oriComparative;
        if (!pygComparativeIsNd && oriCmp !== null) {
          const oriDelta = parseMoneyCop(closing.ori) - parseMoneyCop(opening.ori);
          const oriPnlCmp = parseMoneyCop(oriCmp);
          if (oriDelta !== oriPnlCmp) {
            errors.push(
              `E6. ECP (${etiqueta}): Δ(ORI) del ECP comparativo (${fmtCop(oriDelta)}) ≠ ORI del ERI ` +
                `comparativo (${fmtCop(oriPnlCmp)}). Brecha: ${fmtCop(oriDelta - oriPnlCmp)}. NIIF para las PYMES 6.3.`,
            );
          }
        }
        // E19 entre periodos: el saldo final del comparativo es el saldo
        // inicial del periodo, columna a columna (NIIF para las PYMES 6.3).
        const primaryOpening = json.equityChanges.rows.find((r) => r.kind === 'opening_balance');
        if (primaryOpening) {
          for (const col of EQUITY_ROW_COLUMNS) {
            const a = parseMoneyCop(closing[col]);
            const b = parseMoneyCop(primaryOpening[col]);
            if (a === b) continue;
            errors.push(
              `E19. ECP: columna "${col}" — saldo final del periodo comparativo ${cp} (${fmtCop(a)}) ≠ saldo ` +
                `inicial del periodo ${json.company.fiscalPeriod} (${fmtCop(b)}). Es el mismo saldo.`,
            );
          }
        }
      }
      const profit = rows.find((r) => r.kind === 'profit_for_period');
      const niCmp = json.incomeStatement.netIncomeComparative;
      if (!pygComparativeIsNd && niCmp !== null) {
        const expected = parseMoneyCop(niCmp);
        const emitted = profit ? parseMoneyCop(profit.resultadoEjercicio) : null;
        if (emitted !== expected) {
          errors.push(
            `E7a. ECP (${etiqueta}): resultado del ejercicio ${emitted === null ? 'ausente' : fmtCop(emitted)} ≠ ` +
              `utilidad neta comparativa del P&G ${fmtCop(expected)}.`,
          );
        }
      }
      for (const r of rows) {
        if (r.kind === 'prior_period_result_cancellation' && parseMoneyCop(r.total) !== ZERO) {
          errors.push(
            `E7b. ECP (${etiqueta}): el traslado del resultado anterior es interno del patrimonio y su total ` +
              `es $0 (fila "${r.label}": ${fmtCop(parseMoneyCop(r.total))}).`,
          );
        }
      }
    }
  }
  if (anchored) {
    const detRows = basis?.equityRows ?? null;
    if (rows !== null && detRows === null) {
      const reason = basis?.equityNote ?? 'el balance de prueba no tiene periodo comparativo';
      errors.push(
        `E24. ECP (${etiqueta}): se presentan filas del periodo comparativo sin base determinista — ${reason} ` +
          `(NIIF para las PYMES 3.14).`,
      );
    } else if (rows !== null && detRows !== null) {
      errors.push(...equityComparativeRowDiffs(rows, detRows, etiqueta));
    } else if (rows === null && detRows !== null && cp !== null) {
      warnings.push(
        `E24c. ECP: el estado de cambios en el patrimonio del periodo comparativo ${cp} es calculable desde ` +
          `el balance de prueba y el informe no lo presenta (NIIF para las PYMES 3.14). Regenere el informe.`,
      );
    }
  }
  return { errors, warnings };
}

/**
 * E24 del ECP comparativo: sus filas son una proyección del balance de prueba
 * (`buildDeterministicEquityChanges`), así que se exigen idénticas — tipo,
 * rótulo y cada columna — a las que calcula el código.
 */
function equityComparativeRowDiffs(
  rows: readonly EquityChangeRowJson[],
  expected: readonly EquityChangeRowJson[],
  etiqueta: string,
): string[] {
  const out: string[] = [];
  if (rows.length !== expected.length) {
    out.push(
      `E24. ECP (${etiqueta}): ${rows.length} fila(s) presentadas y el cálculo desde el balance de prueba ` +
        `tiene ${expected.length}. Las filas del comparativo no las redacta el analista.`,
    );
  }
  const n = Math.min(rows.length, expected.length);
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    const e = expected[i];
    if (r.kind !== e.kind || r.label !== e.label) {
      out.push(
        `E24. ECP (${etiqueta}) fila ${i + 1}: "${r.label}" (${r.kind}) y el cálculo desde el balance de ` +
          `prueba es "${e.label}" (${e.kind}).`,
      );
      continue;
    }
    for (const col of EQUITY_ROW_COLUMNS) {
      const a = parseMoneyCop(r[col]);
      const b = parseMoneyCop(e[col]);
      if (a === b) continue;
      out.push(
        `E24. ECP (${etiqueta}) fila "${r.label}" — columna "${col}": ${fmtCop(a)} y el balance de prueba ` +
          `da ${fmtCop(b)} (brecha ${fmtCop(a - b)}).`,
      );
    }
  }
  return out;
}
