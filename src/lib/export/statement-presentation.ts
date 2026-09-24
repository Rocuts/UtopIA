// ---------------------------------------------------------------------------
// Reglas de presentación compartidas por el PDF Élite y el Excel
// ---------------------------------------------------------------------------
// Un solo sitio para las decisiones de presentación que, duplicadas, hicieron
// que el mismo informe dijera cosas distintas en cada entregable (auditoría de
// exportes 2026-09): signo de las correctoras, rótulo de pérdida, fecha de
// corte, moneda, citas normativas y leyenda de comparativo no presentado.
// ---------------------------------------------------------------------------

import { parseMoneyCop } from '@/lib/agents/financial/contracts/money';
import {
  balanceGroupLabel,
  cashFlowLabelClaims,
} from '@/lib/agents/financial/contracts/deterministic-breakdown';
import { isContraAsset } from '@/lib/preprocessing/curator-rules/contra-asset-registry';

const ZERO = BigInt(0);

/**
 * Importe con el signo con que debe IMPRIMIRSE un renglón de estado.
 *
 * Las cuentas correctoras (1592 depreciación acumulada, 1399 deterioro, …)
 * viajan en valor absoluto (`isAbsolute = true`) aunque RESTEN; E15 las resta
 * por código PUC. Imprimirlas en positivo hace que la columna no sume el total
 * impreso (reportes-export-17): se presentan como negativo para que el lector
 * reconstruya el total. El resto de renglones conserva su signo tal cual.
 */
export function presentedLineCents(
  account: string | null,
  amount: bigint,
  isAbsolute: boolean,
): bigint {
  if (account && isAbsolute && isContraAsset(account)) {
    return amount > ZERO ? -amount : amount;
  }
  return amount;
}

export type IncomeTotalKind = 'gross' | 'operating' | 'net';

/** Escalones de la cascada del ERI que un renglón sin código puede rotular. */
export type IncomeCascadeKind = IncomeTotalKind | 'pretax' | 'ori' | 'comprehensive';

const INCOME_TOTAL_LABELS: Record<IncomeTotalKind | 'pretax', { profit: string; loss: string }> = {
  gross: { profit: 'UTILIDAD BRUTA', loss: 'PÉRDIDA BRUTA' },
  operating: { profit: 'UTILIDAD OPERATIVA (EBIT)', loss: 'PÉRDIDA OPERATIVA (EBIT)' },
  pretax: { profit: 'UTILIDAD ANTES DE IMPUESTOS', loss: 'PÉRDIDA ANTES DE IMPUESTOS' },
  net: { profit: 'UTILIDAD NETA DEL PERÍODO', loss: 'PÉRDIDA NETA DEL PERÍODO' },
};

/** Rótulo de un total del ERI según el signo del periodo actual. */
export function incomeTotalLabel(kind: IncomeTotalKind | 'pretax', primaryCents: bigint): string {
  const l = INCOME_TOTAL_LABELS[kind];
  return primaryCents < ZERO ? l.loss : l.profit;
}

/** Ambos rótulos posibles (para no duplicar un total que el analista ya emitió). */
export function incomeTotalLabelVariants(kind: IncomeTotalKind): string[] {
  const l = INCOME_TOTAL_LABELS[kind];
  return [l.profit, l.loss];
}

/**
 * Qué escalón de la cascada del ERI afirma el rótulo de un renglón SIN código
 * (auditoría 2026-09-24, e2e-niif-01/-02). `null` = el rótulo no es un total.
 *
 * El orden importa: "RESULTADO INTEGRAL TOTAL" antes que "OTRO RESULTADO
 * INTEGRAL", y "ANTES DE IMPUESTOS" antes que el resultado neto. EBITDA no es
 * un escalón del ERI (NIIF para las PYMES 5.5): no se reconoce como total.
 */
export function incomeCascadeKindOfLabel(label: string): IncomeCascadeKind | null {
  // Sin puntuación: "UTILIDAD (PÉRDIDA) NETA", "RESULTADO OPERACIONAL — EBIT".
  const l = normalizeStatementLabel(label.replace(/[()[\]{}\-—–:;,.=+/*|]/g, ' '));
  const RESULT = '(?:UTILIDAD|UTILIDADES|PERDIDA|PERDIDAS|GANANCIA|GANANCIAS|RESULTADO|RESULTADOS|EXCEDENTE|DEFICIT)';
  if (/RESULTADO INTEGRAL TOTAL|TOTAL (?:DEL )?RESULTADO INTEGRAL/.test(l)) return 'comprehensive';
  if (/OTRO(?:S)? RESULTADO(?:S)? INTEGRAL(?:ES)?|\bORI\b/.test(l)) return 'ori';
  if (
    (new RegExp(`\\b${RESULT}\\b`).test(l) && /\bANTES DE(?: LOS)? IMPUESTOS?\b/.test(l)) ||
    /\bUAI\b/.test(l)
  ) {
    return 'pretax';
  }
  if (new RegExp(`${RESULT}\\s+BRUT[AO]S?`).test(l)) return 'gross';
  if (
    new RegExp(`${RESULT}\\s+(?:OPERACIONAL|OPERACIONALES|OPERATIV[AO]S?|DE\\s+(?:LA\\s+)?OPERACION(?:ES)?)`).test(l) ||
    /\bEBIT\b/.test(l)
  ) {
    return 'operating';
  }
  if (
    new RegExp(`${RESULT}\\s+(?:NET[AO]S?|DEL\\s+(?:EJERCICIO|PERIODO|ANO)|LIQUID[AO]S?)`).test(l) ||
    new RegExp(`^${RESULT}$`).test(l)
  ) {
    return 'net';
  }
  return null;
}

/** Campos anclados del ERI de los que salen los totales impresos. */
export interface IncomeStatementAnchoredFields {
  grossProfitPrimary: string;
  grossProfitComparative: string | null;
  operatingProfitPrimary: string;
  operatingProfitComparative: string | null;
  netIncomePrimary: string;
  netIncomeComparative: string | null;
  oriPrimary: string;
  oriComparative: string | null;
}

/**
 * Importe anclado de un escalón de la cascada en el JSON. `undefined` = el
 * escalón no tiene campo propio (UAI: la valida E14/E22 contra la cascada).
 */
export function anchoredCascadeValue(
  p: IncomeStatementAnchoredFields,
  kind: IncomeCascadeKind,
  period: 'primary' | 'comparative',
): string | null | undefined {
  const primary = period === 'primary';
  switch (kind) {
    case 'gross':
      return primary ? p.grossProfitPrimary : p.grossProfitComparative;
    case 'operating':
      return primary ? p.operatingProfitPrimary : p.operatingProfitComparative;
    case 'net':
      return primary ? p.netIncomePrimary : p.netIncomeComparative;
    case 'ori':
      return primary ? p.oriPrimary : p.oriComparative;
    case 'comprehensive':
      return primary
        ? addCents(p.netIncomePrimary, p.oriPrimary) ?? p.netIncomePrimary
        : addCents(p.netIncomeComparative, p.oriComparative);
    case 'pretax':
      return undefined;
  }
}

const CANONICAL_CASCADE_LABEL: Record<'ori' | 'comprehensive', string> = {
  ori: 'OTRO RESULTADO INTEGRAL',
  comprehensive: 'RESULTADO INTEGRAL TOTAL',
};

/** Rótulo canónico de un escalón, según el signo del periodo actual. */
export function canonicalCascadeLabel(kind: IncomeCascadeKind, primaryCents: bigint): string {
  if (kind === 'ori' || kind === 'comprehensive') return CANONICAL_CASCADE_LABEL[kind];
  return incomeTotalLabel(kind, primaryCents);
}

/** Rótulo normalizado (sin tildes, espacios colapsados, mayúsculas) para comparar filas. */
export function normalizeStatementLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

const addCents = (a: string | null, b: string | null): string | null =>
  a !== null && b !== null ? (parseMoneyCop(a) + parseMoneyCop(b)).toString(10) : null;

/**
 * Rótulos PUC (Decreto 2650/1993) de los grupos de resultados de dos dígitos,
 * en su denominación NIIF. Auditoría 2026-09-24 (e2e-niif-09): el rótulo de un
 * grupo PUC es dato del catálogo, no redacción del modelo.
 */
const INCOME_GROUP_LABELS: Record<string, string> = {
  '41': 'Ingresos de actividades ordinarias',
  '42': 'Otros ingresos (no operacionales)',
  '51': 'Gastos de administración',
  '52': 'Gastos de ventas',
  '53': 'Otros gastos (no operacionales)',
  '54': 'Impuesto de renta y complementarios',
  '61': 'Costo de ventas y de prestación de servicios',
  '62': 'Compras',
  '71': 'Costo de producción — materia prima',
  '72': 'Costo de producción — mano de obra directa',
  '73': 'Costos indirectos de producción',
  '74': 'Costo de producción — contratos de servicios',
};

/**
 * Términos que identifican cada grupo PUC de dos dígitos (Decreto 2650/1993)
 * en un rótulo, sobre el texto sin tildes y en minúsculas. Un rótulo del
 * analista que no contiene ninguno de los términos de su propio grupo describe
 * otra cosa ("13 — Inventarios de mercancía") y se reemplaza por el del
 * catálogo; uno que sí los contiene ("37 — Pérdidas acumuladas") se conserva.
 */
const GROUP_LABEL_TERMS: Record<string, RegExp> = {
  // Activo
  '11': /efectivo|caja|banco|disponible|equivalente/,
  '12': /inversion/,
  '13': /deudor|por cobrar|cartera|cliente|anticipo|avance|prestamos? a/,
  '14': /inventario|mercancia|materia prima|producto|existencia/,
  '15': /propiedad|planta|equipo|maquinaria|edificio|construccion|terreno|vehiculo|flota|mueble|activos? fijos?|ppe/,
  '16': /intangible|marca|licencia|software|patente|derecho|credito mercantil|plusvalia|goodwill/,
  '17': /diferido|anticipado|pagados? por anticipado/,
  '18': /otros? activos?|arte|cultura/,
  '19': /valorizacion/,
  // Pasivo
  '21': /obligaci[a-z]* financier|prestamo|banco|bancari|credito|sobregiro|financier|leasing|pagare/,
  '22': /proveedor/,
  '23': /por pagar|acreedor|retencion|dividendo/,
  '24': /impuesto|gravamen|tasas?\b|iva\b|renta|\bica\b|tributari/,
  '25': /laboral|empleado|salario|prestacion|cesantia|nomina|vacacion|trabajador/,
  '26': /estimad|provision/,
  '27': /diferido|anticipad/,
  '28': /otros? pasivos?|anticipo|deposito|avance|terceros/,
  '29': /bono|papel(?:es)? comercial/,
  // Patrimonio
  '31': /capital|aporte|cuota|accion/,
  '32': /superavit|prima|donacion/,
  '33': /reserva/,
  '34': /revalorizacion/,
  '35': /dividendo|participacion/,
  '36': /resultado|utilidad|perdida|ganancia|excedente|ejercicio/,
  '37': /anterior|acumulad|retenid/,
  '38': /valorizacion|resultado integral|\bori\b|superavit|revaluacion/,
  // Resultados
  '41': /ingreso|venta|operacional|actividades ordinarias|servicio/,
  '42': /ingreso|no operacional|financier|interes|dividendo|arrendamiento|recuperacion|diverso|otros/,
  '51': /administraci|administrativ|personal|honorario|general/,
  '52': /venta|comercializ|distribucion|mercadeo/,
  '53': /no operacional|financier|interes|otros gastos|diverso|extraordinari|bancari|comision/,
  '54': /impuesto|renta/,
  '61': /costo/,
  '62': /compra/,
  '71': /costo|produccion|materia prima/,
  '72': /costo|produccion|mano de obra/,
  '73': /costo|produccion|indirecto/,
  '74': /costo|produccion|contrato/,
};

/**
 * Rótulo con que se imprime un renglón CON código de un estado (auditoría
 * 2026-09-24, e2e-niif-09). Para un grupo PUC de dos dígitos con rótulo de
 * catálogo: el del analista si nombra su grupo, el del catálogo si no. En los
 * demás códigos, el del analista.
 */
export function presentedAccountLabel(
  statement: 'balance' | 'income',
  account: string | null,
  label: string,
): string {
  const code = (account ?? '').trim();
  if (!/^\d{2}$/.test(code)) return label;
  const catalog =
    statement === 'balance'
      ? balanceGroupLabel(code)
      : Object.prototype.hasOwnProperty.call(INCOME_GROUP_LABELS, code)
        ? INCOME_GROUP_LABELS[code]
        : null;
  if (catalog === null) return label;
  const terms = Object.prototype.hasOwnProperty.call(GROUP_LABEL_TERMS, code) ? GROUP_LABEL_TERMS[code] : null;
  const plain = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return terms !== null && terms.test(plain) ? label : catalog;
}

/** Renglón del ERI tal como se imprime (PDF, Excel y Markdown). */
export interface IncomePresentationRow {
  account: string | null;
  label: string;
  /** MoneyCop del periodo actual (renglón: tal cual; total: campo anclado). */
  amountPrimary: string;
  /** MoneyCop del comparativo; `null` = sin cifra comparativa. */
  amountComparative: string | null;
  level: number;
  isAbsolute: boolean;
  /** Escalón de la cascada: se imprime como total, desde el campo anclado. */
  total: boolean;
}

interface IncomeStatementPresentationInput extends IncomeStatementAnchoredFields {
  lines: ReadonlyArray<{
    account: string | null;
    label: string;
    amountPrimary: string;
    amountComparative: string | null;
    level: number;
    isAbsolute: boolean;
  }>;
}

const CASCADE_ORDER: IncomeCascadeKind[] = ['gross', 'operating', 'net', 'ori', 'comprehensive'];

/**
 * Filas del Estado de Resultados Integral con la MISMA regla en Markdown/HTML,
 * PDF y Excel.
 *
 * Auditoría 2026-09-24 (e2e-niif-01): un renglón del analista rotulado
 * "UTILIDAD NETA DEL PERÍODO" por +$40.000.000 SUSTITUÍA al total determinista
 * (una pérdida de −$40.000.000): la regla anterior omitía el total anclado si
 * el analista ya había emitido un renglón con ese rótulo. Ahora:
 *   - un renglón sin código cuyo rótulo es un escalón de la cascada (UB, EBIT,
 *     UAI, UN, ORI, resultado integral total) se imprime con el importe del
 *     CAMPO ANCLADO del JSON y el rótulo canónico según el signo; su importe
 *     propio, si difiere, es un error del validador (E22) que bloquea;
 *   - la UAI no tiene campo propio: conserva su importe (E22 lo exige igual a
 *     la cascada, E14 al preprocesador) y sólo se normaliza el rótulo;
 *   - un escalón se imprime una sola vez; los que el analista no emitió se
 *     añaden al final (UTILIDAD/PÉRDIDA bruta, operativa y neta, ORI y
 *     RESULTADO INTEGRAL TOTAL — NIIF para las PYMES 5.5 / NIC 1.81A);
 *   - un renglón con código de grupo PUC de dos dígitos lleva el rótulo del
 *     catálogo.
 */
export function incomeStatementPresentationRows(
  p: IncomeStatementPresentationInput,
): IncomePresentationRow[] {
  const rows: IncomePresentationRow[] = [];
  const seen = new Set<IncomeCascadeKind>();
  const cascadeRow = (
    kind: IncomeCascadeKind,
    ownPrimary: string,
    ownComparative: string | null,
  ): IncomePresentationRow => {
    const anchoredPrimary = anchoredCascadeValue(p, kind, 'primary');
    const anchoredComparative = anchoredCascadeValue(p, kind, 'comparative');
    const primary =
      anchoredPrimary === undefined || anchoredPrimary === null ? ownPrimary : anchoredPrimary;
    const comparative = anchoredComparative === undefined ? ownComparative : anchoredComparative;
    return {
      account: null,
      label: canonicalCascadeLabel(kind, parseMoneyCop(primary)),
      amountPrimary: primary,
      amountComparative: comparative,
      level: 4,
      isAbsolute: false,
      total: true,
    };
  };
  for (const line of p.lines) {
    const coded = line.account !== null && line.account.trim() !== '';
    if (coded) {
      rows.push({ ...line, label: presentedAccountLabel('income', line.account, line.label), total: false });
      continue;
    }
    const kind = incomeCascadeKindOfLabel(line.label);
    if (kind === null) {
      rows.push({ ...line, total: false });
      continue;
    }
    if (seen.has(kind)) continue;
    seen.add(kind);
    rows.push(cascadeRow(kind, line.amountPrimary, line.amountComparative));
  }
  for (const kind of CASCADE_ORDER) {
    if (seen.has(kind)) continue;
    rows.push(cascadeRow(kind, '0', null));
  }
  return rows;
}

/**
 * El ERI no trae P&G comparativo (los tres totales comparativos en `null`):
 * caso del comparativo de saldos de apertura (ingesta-09), cuyo P&G es N/D.
 */
export function openingPygNotPresented(p: {
  grossProfitComparative: string | null;
  operatingProfitComparative: string | null;
  netIncomeComparative: string | null;
}): boolean {
  return (
    p.grossProfitComparative === null &&
    p.operatingProfitComparative === null &&
    p.netIncomeComparative === null
  );
}

// ---------------------------------------------------------------------------
// Rótulos deterministas (auditoría 2026-09-24, e2e-niif-09)
// ---------------------------------------------------------------------------

/**
 * Ajusta el calificativo de un rótulo de resultado al signo del importe: una
 * pérdida no se rotula "utilidad"/"ganancia" ni una utilidad "pérdida". Sólo
 * toca rótulos que afirman un resultado del ejercicio.
 */
export function resultWordingForSign(label: string, cents: bigint): string {
  if (cents === ZERO) return label;
  const saysProfit = /(?<![\p{L}])(?:utilidad|utilidades|ganancia|ganancias)(?![\p{L}])/iu.test(label);
  const saysLoss = /(?<![\p{L}])p[eé]rdidas?(?![\p{L}])/iu.test(label);
  if (cents < ZERO && saysProfit && !saysLoss) {
    return label
      .replace(/\s*\((?:ganancia|utilidad)\)/giu, '')
      .replace(/(?<![\p{L}])(?:UTILIDADES|GANANCIAS)(?![\p{L}])/gu, 'PÉRDIDAS')
      .replace(/(?<![\p{L}])(?:UTILIDAD|GANANCIA)(?![\p{L}])/gu, 'PÉRDIDA')
      .replace(/(?<![\p{L}])(?:Utilidades|Ganancias)(?![\p{L}])/gu, 'Pérdidas')
      .replace(/(?<![\p{L}])(?:Utilidad|Ganancia)(?![\p{L}])/gu, 'Pérdida')
      .replace(/(?<![\p{L}])(?:utilidades|ganancias)(?![\p{L}])/gu, 'pérdidas')
      .replace(/(?<![\p{L}])(?:utilidad|ganancia)(?![\p{L}])/gu, 'pérdida');
  }
  if (cents > ZERO && saysLoss && !saysProfit) {
    return label
      .replace(/\s*\(p[eé]rdida\)/giu, '')
      .replace(/(?<![\p{L}])P[EÉ]RDIDAS(?![\p{L}])/gu, 'UTILIDADES')
      .replace(/(?<![\p{L}])P[EÉ]RDIDA(?![\p{L}])/gu, 'UTILIDAD')
      .replace(/(?<![\p{L}])P[eé]rdidas(?![\p{L}])/gu, 'Utilidades')
      .replace(/(?<![\p{L}])P[eé]rdida(?![\p{L}])/gu, 'Utilidad')
      .replace(/(?<![\p{L}])p[eé]rdidas(?![\p{L}])/gu, 'utilidades')
      .replace(/(?<![\p{L}])p[eé]rdida(?![\p{L}])/gu, 'utilidad');
  }
  return label;
}

export interface StatementLabelContext {
  /** Tipo del periodo actual; sólo `cerrado` permite afirmar 1-ene / 31-dic. */
  primaryPeriodoTipo?: PeriodoTipo | null;
}

/** Rótulo determinista de las filas del ECP cuyo contenido fija el contrato. */
export function equityRowLabel(
  kind: string,
  fiscalPeriod: string,
  comparativePeriod: string | null,
  resultCents: bigint,
  ctx: StatementLabelContext = {},
): string | null {
  const closed = ctx.primaryPeriodoTipo === 'cerrado';
  const year = /^\d{4}$/.test(fiscalPeriod) ? Number(fiscalPeriod) : null;
  switch (kind) {
    case 'opening_balance':
      return closed ? `Saldo al 1 de enero de ${fiscalPeriod}` : `Saldo al inicio del periodo ${fiscalPeriod}`;
    case 'closing_balance':
      return closed
        ? `Saldo al 31 de diciembre de ${fiscalPeriod}`
        : `Saldo al cierre del periodo ${fiscalPeriod}`;
    case 'profit_for_period':
      return resultCents < ZERO
        ? `Pérdida del ejercicio ${fiscalPeriod}`
        : resultCents > ZERO
          ? `Utilidad del ejercicio ${fiscalPeriod}`
          : `Resultado del ejercicio ${fiscalPeriod}`;
    case 'prior_period_result_cancellation': {
      const prior = comparativePeriod ?? (year !== null ? String(year - 1) : 'del periodo anterior');
      return `Traslado del resultado ${prior} a resultados acumulados`;
    }
    default:
      return null;
  }
}

/** Forma mínima del JSON NIIF que la normalización de rótulos necesita. */
interface LabelledStatementLine {
  account: string | null;
  label: string;
  amountPrimary: string;
}
interface LabelledNiifJson {
  company: { fiscalPeriod: string; comparativePeriod: string | null };
  balanceSheet: {
    assets: LabelledStatementLine[];
    liabilities: LabelledStatementLine[];
    equity: LabelledStatementLine[];
  };
  incomeStatement: { lines: LabelledStatementLine[] };
  cashFlow: { sections: Array<{ lines: LabelledStatementLine[] }> };
  equityChanges: { rows: Array<{ kind: string; label: string; resultadoEjercicio: string }> };
}

/**
 * Normaliza de forma determinista los rótulos cuyo contenido fija el contrato
 * (auditoría 2026-09-24, e2e-niif-09): grupos PUC de dos dígitos del ESF y del
 * ERI con el rótulo del catálogo; filas de apertura, cierre, resultado del
 * ejercicio y traslado del ECP con el periodo del informe; y el calificativo
 * de los renglones de resultado del EFE según su signo. Función pura e
 * idempotente: la aplican el orquestador sobre el JSON y cada superficie de
 * exportación sobre el JSON que recibe.
 */
export function normalizeNiifStatementLabels<T extends LabelledNiifJson>(
  json: T,
  ctx: StatementLabelContext = {},
): { json: T; changed: number } {
  let changed = 0;
  const relabel = <L extends LabelledStatementLine>(line: L, next: string): L => {
    if (next === line.label) return line;
    changed++;
    return { ...line, label: next };
  };
  const bs = json.balanceSheet;
  const balance = <L extends LabelledStatementLine>(lines: L[]): L[] =>
    lines.map((l) => {
      const label = presentedAccountLabel('balance', l.account, l.label);
      // "3605 — Utilidad del ejercicio" con saldo negativo es una pérdida.
      const worded = cashFlowLabelClaims(label).includes('netIncome')
        ? resultWordingForSign(label, parseMoneyCop(l.amountPrimary))
        : label;
      return relabel(l, worded);
    });
  const income = json.incomeStatement.lines.map((l) =>
    relabel(l, presentedAccountLabel('income', l.account, l.label)),
  );
  const sections = json.cashFlow.sections.map((s) => ({
    ...s,
    lines: s.lines.map((l) =>
      cashFlowLabelClaims(l.label).includes('netIncome')
        ? relabel(l, resultWordingForSign(l.label, parseMoneyCop(l.amountPrimary)))
        : l,
    ),
  }));
  const rows = json.equityChanges.rows.map((r) => {
    const label = (tipo: PeriodoTipo | null) =>
      equityRowLabel(
        r.kind,
        json.company.fiscalPeriod,
        json.company.comparativePeriod,
        parseMoneyCop(r.resultadoEjercicio),
        { primaryPeriodoTipo: tipo },
      );
    // Sin tipo de periodo conocido (`undefined`, p. ej. el renderer Markdown)
    // se respeta cualquiera de las dos formas canónicas ya fijadas por quien
    // sí lo conocía; si no es canónica, se usa la que no afirma 1-ene/31-dic.
    if (ctx.primaryPeriodoTipo === undefined && (r.label === label('cerrado') || r.label === label(null))) {
      return r;
    }
    const next = label(ctx.primaryPeriodoTipo ?? null);
    if (next === null || next === r.label) return r;
    changed++;
    return { ...r, label: next };
  });
  if (changed === 0) return { json, changed: 0 };
  return {
    json: {
      ...json,
      balanceSheet: {
        ...bs,
        assets: balance(bs.assets),
        liabilities: balance(bs.liabilities),
        equity: balance(bs.equity),
      },
      incomeStatement: { ...json.incomeStatement, lines: income },
      cashFlow: { ...json.cashFlow, sections },
      equityChanges: { ...json.equityChanges, rows },
    },
    changed,
  };
}

/** Nota estructurada mínima (ref libre + cuerpo). */
interface NumberableNote {
  ref: string | null;
  body: string;
}
interface NotedNiifJson {
  balanceSheet: { notes: NumberableNote[] };
  incomeStatement: { notes: NumberableNote[] };
  equityChanges: { notes: NumberableNote[] };
  technicalNotes: NumberableNote[];
}

/** "Nota 3" o "Nota 3 — Inventarios": número y, si lo hay, el título. */
const NUMBERED_REF = /^\s*nota\s*(\d+)\b\s*(.*)$/i;

/**
 * Numeración determinista de las notas del informe NIIF (spec v2.1
 * Corrección 6; auditoría 2026-09, niif-contrato-19). `ref` es texto libre del
 * modelo y ninguna regla controlaba saltos ni duplicados; el respaldo del
 * renderer reiniciaba "Nota 1" en cada estado. Aquí las notas numerables (ref
 * nulo, "Nota N" o "Nota N — título") reciben un número global secuencial 1..N en el orden
 * ESF → ERI → ECP → notas técnicas; las marcas no numéricas ("*") se
 * conservan. Las referencias "Nota X" en los cuerpos se actualizan sólo cuando
 * el número anterior era único (sin ambigüedad). Pura e idempotente.
 */
export function numberStatementNotes<T extends NotedNiifJson>(json: T): { json: T; changed: number } {
  const lists: NumberableNote[][] = [
    json.balanceSheet.notes,
    json.incomeStatement.notes,
    json.equityChanges.notes,
    json.technicalNotes,
  ];
  const oldNumbers = new Map<string, number>();
  for (const list of lists) {
    for (const n of list) {
      const m = NUMBERED_REF.exec(n.ref ?? '');
      if (m) oldNumbers.set(m[1], (oldNumbers.get(m[1]) ?? 0) + 1);
    }
  }
  const remap = new Map<string, number>();
  let next = 0;
  const numbered = lists.map((list) =>
    list.map((n) => {
      const ref = n.ref?.trim() ?? '';
      const m = NUMBERED_REF.exec(ref);
      if (ref !== '' && !m) return { note: n, ref: n.ref };
      next++;
      if (m && oldNumbers.get(m[1]) === 1) remap.set(String(Number(m[1])), next);
      const title = m?.[2]?.trim() ?? '';
      const sep = /^[:.,;)]/.test(title) ? '' : ' ';
      return { note: n, ref: title ? `Nota ${next}${sep}${title}` : `Nota ${next}` };
    }),
  );
  let changed = 0;
  const rewrite = (body: string) =>
    body.replace(/\b(Nota)\s+(\d+)\b/g, (whole, word: string, num: string) => {
      const target = remap.get(String(Number(num)));
      return target === undefined ? whole : `${word} ${target}`;
    });
  const out = numbered.map((list) =>
    list.map(({ note, ref }) => {
      const body = rewrite(note.body);
      if (ref === note.ref && body === note.body) return note;
      changed++;
      return { ...note, ref, body };
    }),
  );
  if (changed === 0) return { json, changed: 0 };
  return {
    json: {
      ...json,
      balanceSheet: { ...json.balanceSheet, notes: out[0] },
      incomeStatement: { ...json.incomeStatement, notes: out[1] },
      equityChanges: { ...json.equityChanges, notes: out[2] },
      technicalNotes: out[3],
    },
    changed,
  };
}

export type PeriodoTipo = 'cerrado' | 'parcial' | 'indeterminado';

export interface StatementDateContext {
  fiscalPeriod: string;
  comparativePeriod: string | null;
  /** Tipo de periodo inferido del archivo (preprocesador). Sin dato → no se supone el 31-dic. */
  primaryPeriodoTipo?: PeriodoTipo | null;
  comparativePeriodoTipo?: PeriodoTipo | null;
}

export const CURRENCY_NOTE = 'Cifras expresadas en pesos colombianos (COP), con centavos';

interface SnapshotPeriodLike {
  period?: unknown;
  periodoTipo?: PeriodoTipo | null;
}

/**
 * Tipo de periodo (año completo / corte parcial) que el preprocesador infirió
 * del archivo, SÓLO cuando el snapshot corresponde al mismo año que declara el
 * informe. Sin esa coincidencia no se afirma una fecha de corte.
 */
export function resolvePeriodoTipos(
  fiscalPeriod: string,
  comparativePeriod: string | null,
  primary: SnapshotPeriodLike | null | undefined,
  comparative: SnapshotPeriodLike | null | undefined,
): { primaryPeriodoTipo: PeriodoTipo | null; comparativePeriodoTipo: PeriodoTipo | null } {
  const tipoFor = (snap: SnapshotPeriodLike | null | undefined, year: string | null) =>
    snap && year && typeof snap.period === 'string' && snap.period.includes(year)
      ? snap.periodoTipo ?? null
      : null;
  return {
    primaryPeriodoTipo: tipoFor(primary, fiscalPeriod),
    comparativePeriodoTipo: tipoFor(comparative, comparativePeriod),
  };
}

/**
 * Advertencia que acompaña la narrativa redactada por el LLM (resumen, KPIs
 * narrativos, notas en prosa). Sus cifras no se reconcilian automáticamente con
 * los estados validados (reportes-export-11): se exportan rotuladas, no como
 * cifras certificadas.
 */
export const NARRATIVE_DISCLAIMER =
  'Narrativa generada por IA — no auditada: sus cifras no se contrastan automáticamente con los ' +
  'estados financieros validados. Las cifras vinculantes son las de los estados.';

/** Versión en inglés de `NARRATIVE_DISCLAIMER` (mismo contenido). */
export const NARRATIVE_DISCLAIMER_EN =
  'AI-generated narrative — not audited: its figures are not automatically checked against the ' +
  'validated financial statements. The binding figures are those of the statements.';

/** Aviso de narrativa no auditada en el idioma del entregable (español por defecto). */
export function narrativeDisclaimer(language: 'es' | 'en' = 'es'): string {
  return language === 'en' ? NARRATIVE_DISCLAIMER_EN : NARRATIVE_DISCLAIMER;
}

/**
 * Fecha de corte (ESF) o periodo cubierto (ERI/EFE/ECP), derivada de los datos.
 * NIIF para las PYMES 3.23 exige mostrar de forma destacada la fecha de cierre y
 * el periodo cubierto. El año solo no lo identifica y `fiscalPeriod` puede ser
 * un corte parcial: sólo se afirma el 31 de diciembre cuando el preprocesador
 * clasificó el periodo como año completo ('cerrado').
 */
export function statementDateLabel(kind: 'position' | 'period', ctx: StatementDateContext): string {
  const { fiscalPeriod: fp, comparativePeriod: cp } = ctx;
  const closed = ctx.primaryPeriodoTipo === 'cerrado';
  const compClosed = ctx.comparativePeriodoTipo === 'cerrado';
  if (!closed) {
    return `Periodo ${fp}${cp ? ` y ${cp}` : ''} — fecha de corte no identificada en el archivo fuente`;
  }
  const compSuffix = cp
    ? compClosed
      ? ` y ${cp}`
      : ` (comparativo ${cp}: fecha de corte no identificada)`
    : '';
  return kind === 'position'
    ? `Al 31 de diciembre de ${fp}${compSuffix}`
    : `Por el año terminado el 31 de diciembre de ${fp}${compSuffix}`;
}

/**
 * Leyenda cuando el informe declara comparativo pero el estado sólo trae el
 * periodo actual. NIIF para las PYMES 3.14 exige comparativos para todos los
 * importes; no se presenta en silencio (reportes-export-13). Desde el
 * contrato con comparativos del EFE y del ECP (auditoría 2026-09-24,
 * pendiente #3) el motivo lo redacta el código (`comparativeNote`); esta
 * leyenda genérica queda para los informes serializados antes de él.
 */
export function comparativeNotPresentedLegend(comparativePeriod: string | null): string | null {
  if (!comparativePeriod) return null;
  return (
    `Información comparativa ${comparativePeriod} no presentada en este estado: el informe ` +
    `no contiene las cifras del periodo anterior para este estado (NIIF para las PYMES 3.14). ` +
    `No debe leerse como un conjunto comparativo completo.`
  );
}

/** Forma mínima del EFE con su columna comparativa. */
interface CashFlowComparativeLike {
  sections: ReadonlyArray<{ netFlowComparative?: string | null }>;
  netChangeComparative?: string | null;
  cashOpeningComparative?: string | null;
  cashClosingComparative?: string | null;
  comparativeNote?: string | null;
}

/**
 * El EFE trae su columna comparativa completa (subtotales, variación y
 * efectivo al inicio y al final): sólo entonces se imprime la segunda columna.
 */
export function cashFlowHasComparativeColumn(cf: CashFlowComparativeLike): boolean {
  const cells = [
    cf.netChangeComparative,
    cf.cashOpeningComparative,
    cf.cashClosingComparative,
    ...cf.sections.map((s) => s.netFlowComparative),
  ];
  return cells.every((v) => v !== null && v !== undefined);
}

/**
 * Leyenda del EFE o del ECP cuando el informe declara comparativo y ese estado
 * no lo presenta: la nota determinista del informe (qué falta y qué
 * suministrar, NIIF para las PYMES 3.14) o, en informes anteriores a ella, la
 * genérica.
 * `null` cuando no hay comparativo o el estado sí lo presenta.
 */
export function comparativeStatementLegend(
  statement: 'cashFlow' | 'equity',
  json: {
    company: { comparativePeriod: string | null };
    cashFlow: CashFlowComparativeLike;
    equityChanges: { comparativeRows?: readonly unknown[] | null; comparativeNote?: string | null };
  },
): string | null {
  const cp = json.company.comparativePeriod;
  if (!cp) return null;
  if (statement === 'cashFlow') {
    if (cashFlowHasComparativeColumn(json.cashFlow)) return null;
    return json.cashFlow.comparativeNote?.trim() || comparativeNotPresentedLegend(cp);
  }
  const rows = json.equityChanges.comparativeRows;
  if (rows && rows.length > 0) return null;
  return json.equityChanges.comparativeNote?.trim() || comparativeNotPresentedLegend(cp);
}

/**
 * Rótulo legible del método del EFE (reportes-export-21): el contrato guarda el
 * literal `'indirect'` y el Excel lo imprimía crudo al pie de la hoja. Con el
 * método indirecto degenerado (spec v8.1 §5 Slide 08) se añade la limitación.
 */
export function cashFlowMethodLabel(
  methodNote: string,
  degeneracyFlag: string | null | undefined,
  language: 'es' | 'en' = 'es',
): string {
  const base =
    methodNote === 'indirect'
      ? language === 'en'
        ? 'Indirect method (IAS 7 ¶18(b) / IFRS for SMEs Section 7)'
        : 'Método indirecto (NIC 7 ¶18(b) / NIIF para las PYMES Secc. 7)'
      : methodNote;
  if (degeneracyFlag !== 'indirect_method_unreliable') return base;
  return language === 'en'
    ? `${base} — limited informative value: most working-capital lines are zero (no auxiliary detail).`
    : `${base} — valor informativo limitado: la mayoría de los renglones de capital de trabajo están en cero (sin auxiliares).`;
}

export type StatementKind = 'balance' | 'income' | 'cashFlow' | 'equity';

/**
 * Citas normativas por estado según el grupo NIIF de la empresa.
 *
 * Corrige reportes-export-16: el PDF citaba "NIIF 1.10" (adopción por primera
 * vez), "NIIF 5.36" (activos mantenidos para la venta), "NIIF 7" (revelaciones
 * de instrumentos financieros) y "NIIF 6.20" (recursos minerales) como base de
 * los estados. La base es:
 *   - Grupo 2 (NIIF para las PYMES): Secciones 4, 5, 7 y 6.
 *   - Grupo 1 (NIIF plenas): NIC 1 (párr. 54, 81A, 106) y NIC 7.
 *   - Grupo 3 (microempresas): marco técnico del Anexo 3 del DUR 2420/2015.
 * Sin grupo declarado se muestran las dos referencias que prescribe la spec
 * v10.1 (sección PYMES + NIC). NIIF 18 no se cita: no está incorporada al
 * marco técnico colombiano vigente.
 */
export function statementCitations(kind: StatementKind, niifGroup: 1 | 2 | 3 | null | undefined): string[] {
  const pymes: Record<StatementKind, string> = {
    balance: 'NIIF PYMES Secc. 4',
    income: 'NIIF PYMES Secc. 5',
    cashFlow: 'NIIF PYMES Secc. 7',
    equity: 'NIIF PYMES Secc. 6',
  };
  const plenas: Record<StatementKind, string> = {
    balance: 'NIC 1.54',
    income: 'NIC 1.81A',
    cashFlow: 'NIC 7',
    equity: 'NIC 1.106',
  };
  if (niifGroup === 1) return [plenas[kind]];
  if (niifGroup === 2) return [pymes[kind]];
  if (niifGroup === 3) return ['DUR 2420/2015 Anexo 3'];
  return [pymes[kind], plenas[kind]];
}
