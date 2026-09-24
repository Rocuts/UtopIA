import type { FinancialReport } from '@/lib/agents/financial/types';
import { NiifReportSchema, type NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import type { StatementLineJson } from '@/lib/agents/financial/contracts/base';
import { parseMoneyCop } from '@/lib/agents/financial/contracts/money';
import { validateNiifReportJson } from '@/lib/agents/financial/validators/niif-json-validator';
import { checkCashFlowInvariants, formatCashFlowViolations } from '@/lib/agents/financial/contracts/deterministic-breakdown';
import { buildNiifValidatorOptions } from '@/lib/agents/financial/orchestrator';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { presentedLineCents } from './statement-presentation';

const ZERO = BigInt(0);

/**
 * Server-side output gate. Client flags never substitute for arithmetic checks.
 *
 * Qué comprueba (auditoría de exportes 2026-09):
 *   - Coherencia interna del JSON NIIF (validador E1–E17), con E15 y E6
 *     promovidos a bloqueo: toda cifra impresa debe reconstruirse.
 *   - Procedencia contra la balanza enviada (pipeline-flujo-13): si el llamador
 *     entrega el `preprocessed` del `rawData` de la misma petición, el JSON se
 *     cruza contra sus anclas (E3/E9/E14). Un informe coherente pero AJENO al
 *     balance enviado deja de exportarse.
 *   - Columna comparativa (reportes-export-07): E15/E16 también sobre
 *     `amountComparative`; subtotales sin código PUC del Balance deben ser una
 *     suma de renglones; el ERI sólo admite códigos de las clases 4–7 (y 3 sólo
 *     como desglose del ORI).
 *   - Identidad (reportes-export-10): nombre, NIT y periodos de `report.company`
 *     deben coincidir con `json.company`.
 *
 * Límite documentado: sin `preprocessed` (la petición no trae `rawData`) el
 * gate sólo prueba coherencia interna, no procedencia. La procedencia completa
 * exige exportar desde una versión persistida del informe (HANDOFF, tarea
 * "procedencia servidor").
 */
export function financialExportBlockers(
  report: FinancialReport,
  preprocessed?: PreprocessedBalance | null,
): string[] {
  const blockers: string[] = [];
  if (report.emittability?.kind === 'no-emitible' ||
      report.niifAnalysis?.reconciliation?.clean === false ||
      report.governance?.actaQualifications?.clean === false || report.validation?.ok === false) {
    blockers.push('El informe contiene salvedades o validaciones bloqueantes.');
  }
  const parsed = NiifReportSchema.safeParse(report.niifAnalysis?.json);
  if (!parsed.success) {
    blockers.push('Faltan cifras estructuradas válidas. Regenera el informe antes de exportar.');
    return blockers;
  }
  const json = parsed.data;

  let options: ReturnType<typeof buildNiifValidatorOptions> | undefined;
  if (preprocessed) {
    try {
      options = buildNiifValidatorOptions(preprocessed);
    } catch {
      blockers.push(
        'No se pudieron obtener las anclas de la balanza enviada para cruzarlas con el informe.',
      );
    }
  }

  const validation = validateNiifReportJson(json, options);
  blockers.push(...validation.errors);
  // A printed balance without supporting detail must not be downloadable, and
  // the ORI printed in the P&G must be the one the ECP moves (E6).
  blockers.push(...validation.warnings.filter(w => w.startsWith('E15.') || w.startsWith('E6.')));
  blockers.push(...formatCashFlowViolations(checkCashFlowInvariants(json.cashFlow)));

  blockers.push(...identityBlockers(report, json));
  blockers.push(...comparativeDetailBlockers(json));
  blockers.push(...balanceSubtotalBlockers(json, 'primary'));
  if (json.company.comparativePeriod !== null) {
    blockers.push(...balanceSubtotalBlockers(json, 'comparative'));
  }
  blockers.push(...incomeStatementCodeBlockers(json));
  return blockers;
}

// ---------------------------------------------------------------------------
// Identidad: cabecera/portada (report.company) = columnas/EFE/ECP (json.company)
// ---------------------------------------------------------------------------

function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/** NIT comparable: sólo dígitos; admite que uno de los dos incluya el DV. */
function sameNit(a: string, b: string): boolean {
  const da = a.replace(/\D/g, '');
  const db = b.replace(/\D/g, '');
  if (!da || !db) return da === db;
  if (da === db) return true;
  const [longer, shorter] = da.length > db.length ? [da, db] : [db, da];
  return longer.length === shorter.length + 1 && longer.startsWith(shorter);
}

function identityBlockers(report: FinancialReport, json: NiifReportJson): string[] {
  const out: string[] = [];
  const rc = report.company;
  const jc = json.company;
  if (!rc) return out;
  if (typeof rc.name === 'string' && normName(rc.name) !== normName(jc.name)) {
    out.push(
      `Identidad: la empresa del encabezado ("${rc.name}") no coincide con la de los estados ("${jc.name}").`,
    );
  }
  if (typeof rc.nit === 'string' && !sameNit(rc.nit, jc.nit)) {
    out.push(`Identidad: el NIT del encabezado (${rc.nit}) no coincide con el de los estados (${jc.nit}).`);
  }
  if (typeof rc.fiscalPeriod === 'string' && rc.fiscalPeriod.trim() !== jc.fiscalPeriod) {
    out.push(
      `Identidad: el periodo del encabezado (${rc.fiscalPeriod}) no coincide con el de los estados (${jc.fiscalPeriod}).`,
    );
  }
  if (
    typeof rc.comparativePeriod === 'string' &&
    rc.comparativePeriod.trim() !== '' &&
    rc.comparativePeriod.trim() !== (jc.comparativePeriod ?? '')
  ) {
    out.push(
      `Identidad: el periodo comparativo solicitado (${rc.comparativePeriod}) no coincide con el de los estados (${jc.comparativePeriod ?? 'ninguno'}).`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Columna comparativa: mismas invariantes E15/E16 que el periodo actual
// ---------------------------------------------------------------------------

/**
 * Proyecta el periodo COMPARATIVO como si fuera el primario y corre el mismo
 * validador, de modo que E15 (renglones = total del Balance) y E16 (cascada y
 * subtotales del ERI) se apliquen a `amountComparative` con exactamente las
 * mismas reglas — incluida cualquier evolución futura de E16. Sólo se toman
 * E15/E16: el resto de invariantes (EFE, ECP) no tiene columna comparativa en
 * el contrato y ya se validan sobre el periodo actual.
 */
function comparativeDetailBlockers(json: NiifReportJson): string[] {
  const cp = json.company.comparativePeriod;
  if (cp === null) return [];
  const bs = json.balanceSheet;
  const is = json.incomeStatement;
  // Sin totales comparativos E9 ya bloquea; aquí no hay contra qué sumar.
  if (
    bs.totalAssetsComparative === null || bs.totalLiabilitiesComparative === null ||
    bs.totalEquityComparative === null || is.grossProfitComparative === null ||
    is.operatingProfitComparative === null || is.netIncomeComparative === null
  ) {
    return [];
  }
  const out: string[] = [];
  // Un renglón sin cifra comparativa se imprime "n/c" y suma cero: si con eso
  // la columna no llega a su total, E15/E16 lo señalan.
  const asPrimary = (lines: StatementLineJson[]) =>
    lines.map((l) => ({ ...l, amountPrimary: l.amountComparative ?? '0', amountComparative: null }));
  const projected: NiifReportJson = {
    ...json,
    company: { ...json.company, fiscalPeriod: cp, comparativePeriod: null },
    balanceSheet: {
      ...bs,
      assets: asPrimary(bs.assets),
      liabilities: asPrimary(bs.liabilities),
      equity: asPrimary(bs.equity),
      totalAssetsPrimary: bs.totalAssetsComparative,
      totalLiabilitiesPrimary: bs.totalLiabilitiesComparative,
      totalEquityPrimary: bs.totalEquityComparative,
      totalAssetsComparative: null,
      totalLiabilitiesComparative: null,
      totalEquityComparative: null,
    },
    incomeStatement: {
      ...is,
      lines: asPrimary(is.lines),
      grossProfitPrimary: is.grossProfitComparative,
      operatingProfitPrimary: is.operatingProfitComparative,
      netIncomePrimary: is.netIncomeComparative,
      oriPrimary: is.oriComparative ?? '0',
      grossProfitComparative: null,
      operatingProfitComparative: null,
      netIncomeComparative: null,
      oriComparative: null,
    },
  };
  const v = validateNiifReportJson(projected);
  for (const msg of [...v.errors, ...v.warnings]) {
    if (msg.startsWith('E15.') || msg.startsWith('E16.')) out.push(`Comparativo ${cp}: ${msg}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Subtotales del Balance sin código PUC
// ---------------------------------------------------------------------------

/**
 * Un subtotal honesto del Balance (renglón sin código, nivel ≥ 3) es la suma de
 * un bloque contiguo de renglones de detalle que lo preceden en su sección, el
 * total de la sección o cero. Cualquier otra cifra es un número que el lector
 * no puede reconstruir sumando la columna (reportes-export-07: un
 * "TOTAL ACTIVO CORRIENTE" de $9.999.999,99 se imprimía tal cual). Misma regla
 * por valor —no por rótulo— que E16 aplica a los subtotales del ERI.
 */
function balanceSubtotalBlockers(json: NiifReportJson, period: 'primary' | 'comparative'): string[] {
  const bs = json.balanceSheet;
  const amountOf = (l: StatementLineJson): string | null =>
    period === 'primary' ? l.amountPrimary : l.amountComparative;
  const totals = period === 'primary'
    ? { a: bs.totalAssetsPrimary, l: bs.totalLiabilitiesPrimary, e: bs.totalEquityPrimary }
    : { a: bs.totalAssetsComparative, l: bs.totalLiabilitiesComparative, e: bs.totalEquityComparative };
  const label = period === 'primary' ? json.company.fiscalPeriod : json.company.comparativePeriod;
  const out: string[] = [];
  const sections: Array<[string, StatementLineJson[], string | null]> = [
    ['Activo', bs.assets, totals.a],
    ['Pasivo', bs.liabilities, totals.l],
    ['Patrimonio', bs.equity, totals.e],
  ];
  const liabPlusEquity =
    totals.l !== null && totals.e !== null ? parseMoneyCop(totals.l) + parseMoneyCop(totals.e) : null;

  for (const [name, lines, total] of sections) {
    const detail: bigint[] = [];
    for (const line of lines) {
      const raw = amountOf(line);
      const isDetail = line.account !== null && line.account.trim() !== '';
      if (isDetail) {
        detail.push(raw === null ? ZERO : presentedLineCents(line.account, parseMoneyCop(raw), line.isAbsolute));
        continue;
      }
      if (line.level < 3 || raw === null) continue;
      const v = parseMoneyCop(raw);
      const admissible = new Set<string>([ZERO.toString()]);
      if (total !== null) admissible.add(parseMoneyCop(total).toString());
      if (liabPlusEquity !== null) admissible.add(liabPlusEquity.toString());
      let suffix = ZERO;
      for (let i = detail.length - 1; i >= 0; i--) {
        suffix += detail[i];
        admissible.add(suffix.toString());
      }
      if (admissible.has(v.toString()) || admissible.has((-v).toString())) continue;
      out.push(
        `Balance ${label ?? ''}: el subtotal "${line.label}" (${name}) imprime ${fmt(v)}, que no es la suma ` +
          `de ningún bloque de renglones que lo preceden ni el total de la sección. El lector no puede reconstruirlo.`,
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// ERI: sólo códigos de resultados
// ---------------------------------------------------------------------------

/**
 * Los renglones codificados del ERI deben ser de las clases 4–7 (Decreto
 * 2650/1993). E16 ignora cualquier otro código, así que un renglón 8105 por
 * $5.000 millones se imprimía sin entrar en la cascada (reportes-export-07).
 * La clase 3 se admite sólo como desglose del ORI: su suma debe ser el ORI
 * declarado.
 */
function incomeStatementCodeBlockers(json: NiifReportJson): string[] {
  const out: string[] = [];
  const is = json.incomeStatement;
  let class3 = ZERO;
  let hasClass3 = false;
  for (const line of is.lines) {
    const code = String(line.account ?? '').replace(/\D/g, '');
    if (!code) continue;
    const cls = code[0];
    if (cls >= '4' && cls <= '7') continue;
    if (cls === '3') {
      hasClass3 = true;
      class3 += parseMoneyCop(line.amountPrimary);
      continue;
    }
    out.push(
      `ERI: el renglón "${line.label}" lleva el código ${line.account}, que no es una cuenta de ` +
        `resultados (clases 4–7 del PUC); no entra en la cascada y no puede imprimirse en el estado.`,
    );
  }
  if (hasClass3) {
    const ori = parseMoneyCop(is.oriPrimary);
    const abs = (v: bigint) => (v < ZERO ? -v : v);
    if (abs(class3) !== abs(ori)) {
      out.push(
        `ERI: los renglones de la clase 3 suman ${fmt(class3)} y el ORI declarado es ${fmt(ori)}; ` +
          `la clase 3 sólo se admite en el ERI como desglose del otro resultado integral.`,
      );
    }
  }
  return out;
}

function fmt(cents: bigint): string {
  const neg = cents < ZERO;
  const s = (neg ? -cents : cents).toString().padStart(3, '0');
  const whole = (s.slice(0, -2) || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}$${whole},${s.slice(-2)}`;
}
