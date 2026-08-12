// ---------------------------------------------------------------------------
// Reconciliador determinista de anclas
// ---------------------------------------------------------------------------
// Frontera entre CÁLCULO y REDACCIÓN. El preprocesador calcula los totales de
// forma exacta en centavos; el modelo sólo tiene que copiarlos y redactar
// alrededor. Este módulo corre DESPUÉS de la respuesta del LLM y ANTES de
// validar, y hace tres cosas:
//
//   1. Sobrescribe con la cifra del preprocesador las anclas que puede
//      sobrescribir sin fabricar una incoherencia interna.
//   2. Registra CADA desviación —sobrescrita o no—. Es la única medición de la
//      obediencia real del modelo; hasta ahora era invisible.
//   3. Detecta que el desglose impreso no suma el total, que es el fallo que
//      realmente ve el cliente.
//
// Qué se sobrescribe y qué no, y por qué
// ---------------------------------------
// SE SOBRESCRIBE el tríptico patrimonial (activo, pasivo, patrimonio) de cada
// periodo, y de forma ATÓMICA. Es seguro porque el preprocesador cumple
// `A = P + K` por construcción, así que E1 se preserva. Sobrescribir uno solo
// de los tres sí rompería la identidad.
//
// NO SE SOBRESCRIBEN la utilidad neta ni el efectivo de cierre, aunque el
// preprocesador los conozca. `netIncomePrimary` cuelga de la cascada del P&L y
// del cierre del ECP (E4); `cashClosing` cuelga de `cashOpening + netChange`
// (E2). Cambiarlos en solitario dejaría el estado cuadrando contra el
// preprocesador y descuadrando contra sí mismo — cambiar una mentira por otra.
// Se REPORTAN, y el bucle de reparación los ataca reinvocando al pase que los
// produjo con la discrepancia exacta inyectada.
//
// Por qué el desglose importa más que los totales
// ------------------------------------------------
// La medición de FASE 0 (docs/FASE0_MEDICION_2026-08.md) corrió el pipeline tres
// veces sobre el mismo balance real: las 9 anclas salieron exactas las tres
// veces —el modelo SÍ copia los tokens `[MoneyCop: N]`—, pero el desglose del
// Activo se quedó corto entre $4,3M (0,1%) y $1.726M (41%) según la corrida. Es
// decir: el total es correcto y el estado que el cliente suma con la calculadora
// no. Por eso `lineGaps` es un resultado de primera clase de este módulo y no un
// efecto secundario.
// ---------------------------------------------------------------------------

import { ANCHOR_LABELS, type AnchorKey, type ReportAnchors } from '../contracts/anchors';
import { parseMoneyCop, serializeMoneyCop } from '../contracts/money';
import { sumStatementDetail } from '../contracts/statement-lines';
import {
  buildDeterministicBreakdown,
  type BreakdownSection,
} from '../contracts/deterministic-breakdown';
import type { PeriodSnapshot } from '@/lib/preprocessing/trial-balance';
import type { NiifReportJson } from '../contracts/niif-report';

/**
 * Lo mínimo que necesita el reconciliador. Se define estructuralmente para que
 * sirva tanto al JSON completo como al sub-schema de Pass-1 (que aún no tiene
 * `cashFlow`): el bucle de reparación corre DENTRO del analista, justo después
 * de Pass-1, que es donde nace el desglose que no cuadra. Esperar al reensamblaje
 * obligaría a repetir los tres pases para arreglar uno.
 */
export type ReconcilableReport = Pick<NiifReportJson, 'balanceSheet' | 'incomeStatement'> &
  Partial<Pick<NiifReportJson, 'cashFlow'>>;

const ZERO = BigInt(0);

/** Una cifra que el modelo emitió distinta de la del preprocesador. */
export interface AnchorDeviation {
  period: 'primary' | 'comparative';
  /** Ruta del campo en el JSON, p. ej. `balanceSheet.totalAssetsPrimary`. */
  field: string;
  /** Etiqueta legible del ancla, tal como aparece en TOTALES VINCULANTES. */
  label: string;
  key: AnchorKey;
  emitted: string;
  expected: string;
  /** `emitted − expected`, en centavos. */
  gapCents: string;
  /** `true` si el código ya corrigió la cifra en el JSON devuelto. */
  overwritten: boolean;
}

/** Un estado cuyo desglose impreso no suma el total impreso. */
export interface LineGap {
  statement: 'Activo' | 'Pasivo' | 'Patrimonio';
  lineCount: number;
  sumCents: string;
  totalCents: string;
  /** `suma − total`, en centavos. Negativo = falta desglosar. */
  gapCents: string;
}

/**
 * Veredicto de la reconciliación sobre el reporte YA reensamblado. Es lo que
 * decide el ARTEFACTO: cuando `clean` es `false`, el informe se sella como
 * "REPORTE CON SALVEDADES" y la descarga queda bloqueada. Un banner que el
 * cliente puede ignorar no cambia nada — la auditoría integral ya documentó que
 * los eventos SSE `warning` mueren en el navegador sin handler.
 */
export interface ReconciliationOutcome {
  deviations: AnchorDeviation[];
  lineGaps: LineGap[];
  /** `true` si se gastó el único reintento permitido. */
  repairAttempted: boolean;
  /** `true` sólo si NO quedó ninguna discrepancia tras la reparación. */
  clean: boolean;
}

/**
 * Texto de las salvedades, para el sello de portada y para las notas técnicas.
 * Devuelve `[]` cuando el informe quedó limpio.
 */
export function describeQualifications(outcome: ReconciliationOutcome): string[] {
  if (outcome.clean) return [];
  const out: string[] = [];
  for (const d of outcome.deviations) {
    out.push(
      `${d.label} (${d.period === 'primary' ? 'periodo actual' : 'comparativo'}): el analista ` +
        `emitió ${fmtCop(parseMoneyCop(d.emitted))} frente a ${fmtCop(parseMoneyCop(d.expected))} ` +
        `del balance preprocesado` +
        (d.overwritten
          ? ' — corregido automáticamente en el informe.'
          : ' — NO corregido: la cifra depende de la cascada del estado y no puede sobrescribirse aisladamente.'),
    );
  }
  for (const g of outcome.lineGaps) {
    out.push(
      `${g.statement}: el desglose impreso (${g.lineCount} renglones, ` +
        `${fmtCop(parseMoneyCop(g.sumCents))}) no suma el total del estado ` +
        `(${fmtCop(parseMoneyCop(g.totalCents))}). Diferencia sin desglosar: ` +
        `${fmtCop(parseMoneyCop(g.gapCents))}.`,
    );
  }
  return out;
}

export interface ReconcileResult<T extends ReconcilableReport = NiifReportJson> {
  /** Copia del JSON con las anclas sobrescribibles ya corregidas. */
  json: T;
  deviations: AnchorDeviation[];
  lineGaps: LineGap[];
  /**
   * Discrepancias redactadas para inyectarlas al prompt del pase que falló.
   * Vacío cuando no hay nada que reparar.
   */
  repairInstructions: string[];
}

/** Formato COP legible desde centavos. Local para no arrastrar el validador. */
function fmtCop(cents: bigint): string {
  const neg = cents < ZERO;
  const abs = neg ? -cents : cents;
  const s = abs.toString().padStart(3, '0');
  const whole = (s.slice(0, -2) || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}$${whole},${s.slice(-2)}`;
}

/** Descriptor de un ancla: dónde vive en el JSON y si es sobrescribible. */
interface AnchorBinding {
  key: AnchorKey;
  field: string;
  read: (json: ReconcilableReport) => string | null;
  write: ((json: ReconcilableReport, value: string) => void) | null;
}

const PRIMARY_BINDINGS: AnchorBinding[] = [
  {
    key: 'activo',
    field: 'balanceSheet.totalAssetsPrimary',
    read: (j) => j.balanceSheet.totalAssetsPrimary,
    write: (j, v) => {
      j.balanceSheet.totalAssetsPrimary = v;
    },
  },
  {
    key: 'pasivo',
    field: 'balanceSheet.totalLiabilitiesPrimary',
    read: (j) => j.balanceSheet.totalLiabilitiesPrimary,
    write: (j, v) => {
      j.balanceSheet.totalLiabilitiesPrimary = v;
    },
  },
  {
    key: 'patrimonio',
    field: 'balanceSheet.totalEquityPrimary',
    read: (j) => j.balanceSheet.totalEquityPrimary,
    write: (j, v) => {
      j.balanceSheet.totalEquityPrimary = v;
    },
  },
  // Sin `write`: ver la nota de cabecera — su sobrescritura aislada rompería
  // E4 (cierre del ECP) y la cascada del P&L.
  {
    key: 'utilidadNeta',
    field: 'incomeStatement.netIncomePrimary',
    read: (j) => j.incomeStatement.netIncomePrimary,
    write: null,
  },
  // Sin `write`: amarrado por E2 (`cashOpening + netChange`).
  {
    key: 'efectivoCuenta11',
    field: 'cashFlow.cashClosing',
    // `cashFlow` no existe todavía en Pass-1: se omite el cruce en esa fase y
    // se hace sobre el reporte reensamblado.
    read: (j) => j.cashFlow?.cashClosing ?? null,
    write: null,
  },
];

const COMPARATIVE_BINDINGS: AnchorBinding[] = [
  {
    key: 'activo',
    field: 'balanceSheet.totalAssetsComparative',
    read: (j) => j.balanceSheet.totalAssetsComparative,
    write: (j, v) => {
      j.balanceSheet.totalAssetsComparative = v;
    },
  },
  {
    key: 'pasivo',
    field: 'balanceSheet.totalLiabilitiesComparative',
    read: (j) => j.balanceSheet.totalLiabilitiesComparative,
    write: (j, v) => {
      j.balanceSheet.totalLiabilitiesComparative = v;
    },
  },
  {
    key: 'patrimonio',
    field: 'balanceSheet.totalEquityComparative',
    read: (j) => j.balanceSheet.totalEquityComparative,
    write: (j, v) => {
      j.balanceSheet.totalEquityComparative = v;
    },
  },
  {
    key: 'utilidadNeta',
    field: 'incomeStatement.netIncomeComparative',
    read: (j) => j.incomeStatement.netIncomeComparative,
    write: null,
  },
];

/**
 * Cruza el JSON del analista contra las anclas del preprocesador, corrige lo
 * que es seguro corregir y devuelve todo lo que quedó desalineado.
 *
 * @param json     Output del NIIF Analyst, ya validado por Zod.
 * @param anchors  `buildReportAnchors(primary, comparative)`.
 */
export function reconcileAnchors<T extends ReconcilableReport>(
  json: T,
  anchors: ReportAnchors,
): ReconcileResult<T> {
  // Copia superficial por rama: sólo tocamos los objetos que mutamos.
  const out: T = {
    ...json,
    balanceSheet: { ...json.balanceSheet },
    incomeStatement: { ...json.incomeStatement },
    ...(json.cashFlow ? { cashFlow: { ...json.cashFlow } } : {}),
  };

  const deviations: AnchorDeviation[] = [];

  const reconcilePeriod = (
    period: 'primary' | 'comparative',
    bindings: AnchorBinding[],
  ) => {
    const periodAnchors = anchors[period];
    if (!periodAnchors) return;

    for (const binding of bindings) {
      const expected = periodAnchors.cents[binding.key];
      if (typeof expected !== 'bigint') continue;

      const emitted = binding.read(out);
      // `null` es legítimo: en modo LÍNEA BASE el comparativo no viaja.
      if (emitted === null || emitted === undefined) continue;

      let emittedCents: bigint;
      try {
        emittedCents = parseMoneyCop(emitted);
      } catch {
        // Un MoneyCop malformado ya lo rechazó Zod; si llegara aquí, lo
        // tratamos como desviación total en vez de reventar.
        deviations.push({
          period,
          field: binding.field,
          label: ANCHOR_LABELS[binding.key],
          key: binding.key,
          emitted,
          expected: serializeMoneyCop(expected),
          gapCents: 'NaN',
          overwritten: false,
        });
        continue;
      }

      if (emittedCents === expected) continue;

      const canWrite = binding.write !== null;
      if (canWrite) binding.write!(out, serializeMoneyCop(expected));

      deviations.push({
        period,
        field: binding.field,
        label: ANCHOR_LABELS[binding.key],
        key: binding.key,
        emitted: serializeMoneyCop(emittedCents),
        expected: serializeMoneyCop(expected),
        gapCents: serializeMoneyCop(emittedCents - expected),
        overwritten: canWrite,
      });
    }
  };

  reconcilePeriod('primary', PRIMARY_BINDINGS);
  reconcilePeriod('comparative', COMPARATIVE_BINDINGS);

  // -------------------------------------------------------------------------
  // Desglose vs total. Se mide contra el total YA reconciliado a propósito: un
  // modelo que inventa un total coherente con sus propios renglones pasaría
  // limpio si midiéramos contra lo que él mismo emitió.
  // -------------------------------------------------------------------------
  const lineGaps: LineGap[] = [];
  const statements: Array<[LineGap['statement'], typeof out.balanceSheet.assets, string]> = [
    ['Activo', out.balanceSheet.assets, out.balanceSheet.totalAssetsPrimary],
    ['Pasivo', out.balanceSheet.liabilities, out.balanceSheet.totalLiabilitiesPrimary],
    ['Patrimonio', out.balanceSheet.equity, out.balanceSheet.totalEquityPrimary],
  ];

  for (const [statement, lines, declaredTotal] of statements) {
    const { sum, count } = sumStatementDetail(lines);
    const total = parseMoneyCop(declaredTotal);
    // Un estado con total material y CERO renglones no es un caso exento: es la
    // forma más severa del defecto. Medido en producción sobre el balance real
    // (2026-08-08): el Pasivo salió con los dos encabezados de sección y ningún
    // renglón, declarando $1.962.538.849,62 sin una sola cuenta debajo, y la
    // regla anterior —`if (count === 0) continue`— lo dejaba pasar en silencio.
    // Esa exención existía porque TODOS los fixtures del validador traían
    // `assets: []`, que es justamente lo que la auditoría integral señaló como
    // "la superficie que el usuario lee es la que tiene cero cobertura".
    if (count === 0 && total === ZERO) continue;
    if (sum === total) continue;
    lineGaps.push({
      statement,
      lineCount: count,
      sumCents: serializeMoneyCop(sum),
      totalCents: serializeMoneyCop(total),
      gapCents: serializeMoneyCop(sum - total),
    });
  }

  return {
    json: out,
    deviations,
    lineGaps,
    repairInstructions: buildRepairInstructions(deviations, lineGaps),
  };
}

/**
 * Redacta las discrepancias como instrucciones accionables para reinyectar al
 * pase que las produjo. Cada línea nombra la cifra vinculante literal, porque
 * es lo único que el modelo tiene que copiar.
 */
export function buildRepairInstructions(
  deviations: AnchorDeviation[],
  lineGaps: LineGap[],
): string[] {
  const out: string[] = [];

  for (const d of deviations.filter((x) => !x.overwritten)) {
    out.push(
      `${d.label} del periodo ${d.period === 'primary' ? 'actual' : 'comparativo'}: emitiste ` +
        `${fmtCop(parseMoneyCop(d.emitted))} y la cifra vinculante del preprocesador es ` +
        `${fmtCop(parseMoneyCop(d.expected))} (brecha ${fmtCop(parseMoneyCop(d.gapCents))}). ` +
        `Copia literalmente el token [MoneyCop: ${d.expected}] en \`${d.field}\` y recalcula ` +
        `hacia atrás los renglones que lo componen — no ajustes una cuenta suelta para cuadrar.`,
    );
  }

  for (const g of lineGaps) {
    const missing = parseMoneyCop(g.gapCents);
    out.push(
      `${g.statement}: los ${g.lineCount} renglones de detalle suman ` +
        `${fmtCop(parseMoneyCop(g.sumCents))} y el total es ` +
        `${fmtCop(parseMoneyCop(g.totalCents))}. ` +
        (missing < ZERO
          ? `Faltan ${fmtCop(-missing)} por desglosar: añade los rubros del balance ` +
            `preprocesado que no listaste. El lector suma la columna y no le da.`
          : `Sobran ${fmtCop(missing)}: hay doble conteo o una correctora presentada en ` +
            `valor absoluto sin identificar.`),
    );
  }

  return out;
}

/**
 * Sello de portada. Se antepone al Markdown del informe cuando la
 * reconciliación no quedó limpia.
 *
 * Va en el CUERPO del entregable a propósito, no en un evento SSE ni en un
 * banner de la UI: la auditoría integral verificó que el cliente no registra
 * handler para `warning`, así que cualquier señal por ese canal muere en el
 * navegador. Un sello dentro del Markdown viaja a todo lo que se derive de él
 * —informe consolidado, HTML, PDF— sin que ninguna superficie tenga que
 * acordarse de mirarlo.
 */
export function buildQualificationSeal(
  outcome: ReconciliationOutcome,
  language: 'es' | 'en' = 'es',
): string {
  const qualifications = describeQualifications(outcome);
  if (qualifications.length === 0) return '';

  if (language === 'en') {
    return [
      '> ## REPORT WITH QUALIFICATIONS',
      '>',
      '> Deterministic reconciliation against the preprocessed trial balance did not close.',
      '> This report is NOT signable as issued. Qualifications:',
      '>',
      ...qualifications.map((q) => `> - ${q}`),
      '>',
      outcome.repairAttempted
        ? '> A bounded repair pass was attempted and did not resolve the discrepancies.'
        : '> No repair pass was attempted.',
      '',
    ].join('\n');
  }

  return [
    '> ## REPORTE CON SALVEDADES',
    '>',
    '> La reconciliación determinista contra el balance preprocesado no cerró.',
    '> Este informe NO es firmable tal como está. Salvedades:',
    '>',
    ...qualifications.map((q) => `> - ${q}`),
    '>',
    outcome.repairAttempted
      ? '> Se intentó una reparación acotada y no resolvió las discrepancias.'
      : '> No se intentó reparación.',
    '',
  ].join('\n');
}


// ---------------------------------------------------------------------------
// Completar el desglose desde el preprocesador
// ---------------------------------------------------------------------------

const SECTION_BY_STATEMENT: Record<LineGap['statement'], BreakdownSection> = {
  Activo: 'assets',
  Pasivo: 'liabilities',
  Patrimonio: 'equity',
};

/**
 * Reemplaza el desglose de los estados que no cuadran por el desglose
 * determinista del preprocesador, agregado por grupo PUC.
 *
 * Por qué reemplazar y no completar: no hay forma fiable de saber qué renglón
 * del modelo corresponde a qué grupo cuando el modelo mezcla niveles de
 * agregación —una corrida listó la cuenta 1355 y otra el grupo 13 entero—, y un
 * merge por código produciría doble conteo. El desglose por grupo es completo
 * por construcción y suma el total exacto.
 *
 * Se CONSERVA la etiqueta que escribió el modelo cuando su código coincide con
 * el grupo: la redacción NIIF es suyo, la aritmética no.
 *
 * Sólo toca los estados con brecha. Un desglose que ya cuadra se respeta tal
 * cual, incluida su granularidad, que suele ser mejor que la agregación por
 * grupo.
 */
export function completeBreakdownFromSnapshot<T extends ReconcilableReport>(
  json: T,
  gaps: LineGap[],
  snapshot: PeriodSnapshot | undefined,
  comparativeSnapshot?: PeriodSnapshot | undefined,
): { json: T; completed: LineGap['statement'][] } {
  if (!snapshot || gaps.length === 0) return { json, completed: [] };

  const balanceSheet = { ...json.balanceSheet };
  const completed: LineGap['statement'][] = [];

  for (const gap of gaps) {
    const section = SECTION_BY_STATEMENT[gap.statement];
    const rows = buildDeterministicBreakdown(snapshot, section);
    if (rows.length === 0) continue;

    const previous = balanceSheet[section] as ReadonlyArray<{
      account: string | null;
      label: string;
      amountComparative: string | null;
      level: number;
      isAbsolute: boolean;
    }>;
    const labelByAccount = new Map(
      previous.filter((l) => l.account).map((l) => [l.account as string, l.label]),
    );
    // Cifra comparativa del MISMO grupo PUC, por la misma proyección
    // determinista. Ver la nota de `fillComparativeBreakdownFromSnapshot`.
    const comparativeByAccount = buildComparativeCentsByAccount(comparativeSnapshot, section);

    balanceSheet[section] = rows.map((row) => ({
      account: row.account,
      label: labelByAccount.get(row.account) ?? row.label,
      amountPrimary: serializeMoneyCop(row.cents),
      amountComparative: comparativeByAccount?.has(row.account)
        ? serializeMoneyCop(comparativeByAccount.get(row.account)!.cents)
        : null,
      level: 2,
      // Se emite CON signo: una correctora agregada dentro de su grupo ya viene
      // neta, y forzar valor absoluto convertiría una reducción en un aumento.
      isAbsolute: false,
      // `confidence` y `anomalyFlag` son obligatorios en StatementLineV8Schema
      // (aceptan null, pero la clave tiene que existir — el contrato de Zod
      // strict mode del repo prohíbe `.optional()`). Sin ellos
      // `NiifReportSchema.safeParse` rechaza el reensamblaje entero y
      // `runNiifAnalyst` lanza, tumbando el informe completo. Medido en una
      // corrida real antes de que ningún test unitario lo notara, porque los
      // fixtures de test usan `as unknown as NiifReportJson` y nunca vuelven a
      // pasar por el schema.
      confidence: 'high',
      // Una cifra derivada del preprocesador no puede tener anomalía sectorial:
      // no la derivó el modelo.
      anomalyFlag: null,
    })) as T['balanceSheet'][typeof section];
    completed.push(gap.statement);
  }

  if (completed.length === 0) return { json, completed: [] };
  return { json: { ...json, balanceSheet }, completed };
}

// ---------------------------------------------------------------------------
// La columna comparativa del Balance
// ---------------------------------------------------------------------------
// Auditoría 2026-08 (superficie 4, 2/10): el completado determinista de arriba
// era una REGRESIÓN para el periodo anterior. Reemplazaba la sección entera y
// escribía `amountComparative: null` en cada renglón, así que el PDF salía con
// "n/c" en las once líneas de detalle bajo un TOTAL ACTIVOS 2024 de
// $2.798.204.117,50 que ningún renglón sostenía — y con `clean = true`, sin
// sello y con la descarga habilitada. Medido en 2/2 corridas de cierre y
// reproducido aquí: 11 celdas "n/c" en la tabla del PDF Élite.
//
// La proyección comparativa NO había que inventarla: es la misma
// `buildDeterministicBreakdown` sobre el snapshot del año anterior, y cuadra al
// centavo con las anclas ($2.798.204.117,50 / $1.232.263.178,39 /
// $1.565.940.939,11). Lo único que faltaba era pasarle el snapshot.
//
// Incumplimiento que cierra: NIIF para las PYMES §3.14 exige información
// comparativa para todos los importes del periodo anterior.
// ---------------------------------------------------------------------------

/**
 * Renglones del periodo comparativo indexados por grupo PUC, o `null` si no hay
 * snapshot anterior. La etiqueta viaja con la fila —la produce el propio
 * `buildDeterministicBreakdown`— para no duplicar aquí el diccionario PUC↔NIIF.
 */
function buildComparativeCentsByAccount(
  comparativeSnapshot: PeriodSnapshot | undefined,
  section: BreakdownSection,
): Map<string, { cents: bigint; label: string }> | null {
  if (!comparativeSnapshot) return null;
  const rows = buildDeterministicBreakdown(comparativeSnapshot, section);
  if (rows.length === 0) return null;
  return new Map(rows.map((r) => [r.account, { cents: r.cents, label: r.label }]));
}

/**
 * Rellena la columna del periodo comparativo del Balance con la proyección
 * determinista del snapshot anterior, y añade los grupos PUC que existían en
 * el comparativo y desaparecieron en el periodo actual.
 *
 * Por qué la unión de grupos y no sólo los del periodo actual: si un rubro
 * existió en 2024 y no en 2025, omitirlo deja la columna 2024 sumando menos que
 * su propio total — el mismo defecto que este módulo viene a cerrar, movido de
 * columna. El renglón entra con `amountPrimary = "0"`, que es la verdad.
 *
 * Sólo actúa sobre secciones cuyos renglones ya son la proyección determinista
 * (todos con código de grupo PUC de dos dígitos). Cuando el modelo conservó su
 * propio desglose —porque cuadraba, y su granularidad suele ser mejor— no se
 * toca: mapear una cuenta auxiliar del modelo a un grupo del comparativo
 * produciría doble conteo, que es exactamente lo que
 * `completeBreakdownFromSnapshot` evita reemplazando en vez de mezclar.
 */
export function fillComparativeBreakdownFromSnapshot<T extends ReconcilableReport>(
  json: T,
  comparativeSnapshot: PeriodSnapshot | undefined,
): { json: T; filled: LineGap['statement'][] } {
  if (!comparativeSnapshot) return { json, filled: [] };

  const balanceSheet = { ...json.balanceSheet };
  const filled: LineGap['statement'][] = [];

  for (const [statement, section] of Object.entries(SECTION_BY_STATEMENT) as Array<
    [LineGap['statement'], BreakdownSection]
  >) {
    const comparativeByAccount = buildComparativeCentsByAccount(comparativeSnapshot, section);
    if (!comparativeByAccount) continue;

    const lines = balanceSheet[section] as ReadonlyArray<{
      account: string | null;
      label: string;
      amountPrimary: string;
      amountComparative: string | null;
      level: number;
      isAbsolute: boolean;
      confidence: unknown;
      anomalyFlag: unknown;
    }>;
    if (lines.length === 0) continue;

    // Firma de "esto ya es la proyección determinista": todos los renglones
    // llevan código de grupo PUC de dos dígitos y ninguno se repite.
    const codes = lines.map((l) => (l.account ?? '').trim());
    const esProyeccionDeterminista =
      codes.every((c) => /^\d{2}$/.test(c)) && new Set(codes).size === codes.length;
    if (!esProyeccionDeterminista) continue;

    const yaTieneComparativo = lines.every((l) => l.amountComparative !== null);
    const gruposFaltantes = [...comparativeByAccount.keys()].filter((g) => !codes.includes(g));
    if (yaTieneComparativo && gruposFaltantes.length === 0) continue;

    const conComparativo = lines.map((l) => {
      const cmp = comparativeByAccount.get(l.account ?? '');
      return {
        ...l,
        amountComparative: cmp
          ? serializeMoneyCop(cmp.cents)
          : // El grupo no existía el año anterior: `null` es la verdad (cuenta
            // nueva del periodo), no un cero que el lector leería como saldo.
            l.amountComparative,
        confidence: 'high',
      };
    });

    const nuevos = gruposFaltantes
      .sort((a, b) => a.localeCompare(b))
      .map((grupo) => {
        const cmp = comparativeByAccount.get(grupo)!;
        return {
          account: grupo,
          label: cmp.label,
          amountPrimary: '0',
          amountComparative: serializeMoneyCop(cmp.cents),
          level: 2,
          isAbsolute: false,
          confidence: 'high',
          anomalyFlag: null,
        };
      });

    balanceSheet[section] = [...conComparativo, ...nuevos].sort((a, b) =>
      (a.account ?? '').localeCompare(b.account ?? ''),
    ) as T['balanceSheet'][typeof section];
    filled.push(statement);
  }

  if (filled.length === 0) return { json, filled: [] };
  return { json: { ...json, balanceSheet }, filled };
}

