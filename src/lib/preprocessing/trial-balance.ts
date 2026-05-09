// ---------------------------------------------------------------------------
// Trial Balance Preprocessor — deterministic arithmetic validation
// ---------------------------------------------------------------------------
// Parses CSV/Excel trial balance data, filters a leaf set of accounts (the
// most granular level per PUC code), sums by PUC class, validates totals,
// cross-checks la ecuacion patrimonial y la utilidad del ejercicio, y emite
// un contrato de totales vinculantes (controlTotals) + desglose de patrimonio
// (equityBreakdown) que los agentes del pipeline financiero consumen como
// anclas anti-alucinacion.
//
// Multiperíodo (refactor 2026-04-28): cada `RawAccountRow` ahora puede llevar
// saldos de varios periodos en `balancesByPeriod`. `preprocessTrialBalance`
// agrupa los datos por periodo y emite un `PeriodSnapshot` por cada uno;
// `primary` apunta al periodo más reciente y `comparative` al anterior.
//
// NO LLM — computacion pura. Corre antes del pipeline financiero para que los
// agentes reciban datos limpios con garantias aritmeticas.
//
// Convenciones:
//   Clase 1 = Activo, 2 = Pasivo, 3 = Patrimonio, 4 = Ingresos, 5 = Gastos,
//   6 = Costos de Ventas, 7 = Costos de Produccion.
//   Niveles: Clase (1 digito), Grupo (2), Cuenta (4), Subcuenta (6),
//   Auxiliar (8+).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import { runCurator } from './balance-curator';
import type {
  CashFlowStatement,
  Class18ClassificationAudit,
  ClosingDetectorAudit,
  CostClassificationAudit,
  CuratorFinding,
  CuratorResult,
  PpeDepreciationAudit,
  PrecisionCentsAudit,
  PresumedCostWarning,
  Reclassification,
  VirtualCloseAdjustment,
} from './curator-rules/types';

export interface RawAccountRow {
  /** Account code (e.g. "110505", "1105", "1") */
  code: string;
  /** Account name */
  name: string;
  /** Account level: "Clase", "Grupo", "Cuenta", "Subcuenta", "Auxiliar" */
  level: string;
  /** Whether this is a transactional account */
  transactional: boolean;
  /**
   * Saldos por periodo. Claves: "2024", "2025", etc. Para entradas sin
   * año detectado se usa la etiqueta provista (default `'current'`).
   */
  balancesByPeriod: Record<string, number>;
}

export interface ValidatedAccount {
  code: string;
  name: string;
  level: string;
  /** Solo el balance del snapshot al que pertenece esta cuenta. */
  balance: number;
  /** Whether this is a leaf/transactional account used in summation */
  isLeaf: boolean;
}

export interface PUCClass {
  code: number;
  name: string;
  /** Sum of auxiliary accounts only */
  auxiliaryTotal: number;
  /** Reported class total (from the "Clase" row, if present) */
  reportedTotal: number | null;
  /** Discrepancy between reported and calculated */
  discrepancy: number;
  /** Accounts in this class */
  accounts: ValidatedAccount[];
}

export interface Discrepancy {
  /** PUC class or account code */
  location: string;
  /** What was reported */
  reported: number;
  /** What was calculated */
  calculated: number;
  /** Difference */
  difference: number;
  /** Probable cause */
  description: string;
}

// ---------------------------------------------------------------------------
// Pulido NIIF PYME Grupo 2 — contrato cents + raw (precisión preservada)
// ---------------------------------------------------------------------------
// Las anclas anti-alucinación se calculan en BigInt centavos. `cents` guarda
// la representación entera (sin floating-point drift) y `raw` la string
// canónica leída del archivo (para auditoría del parser). El gate
// `auditReportEmittable` compara SIEMPRE en cents con tolerancia 0n.
// ---------------------------------------------------------------------------
export interface ControlTotalsCents {
  activo: bigint;
  pasivo: bigint;
  patrimonio: bigint;
  ingresos: bigint;
  /** Gastos totales (clase 5 + clase 6 + clase 7), incluye impuesto. */
  gastos: bigint;
  /** Utilidad neta = ingresos − gastos totales. */
  utilidadNeta: bigint;
  /** Utilidad antes de impuestos (UAI) = ingresos − gastos sin impuesto. */
  utilidadAntesImpuestos: bigint;
  /** Impuesto causado del periodo (grupo 54 dentro de clase 5). */
  impuestoCausado: bigint;
  /** Saldo final caja (PUC 11) en cents. */
  efectivoCuenta11: bigint;
  /**
   * Saldo a favor del impuesto de renta (Pulido NIIF PYME Grupo 2).
   * Detector cents:
   *   1. Si grupo 5404 acreedor (saldo crédito) → magnitud absoluta del crédito.
   *   2. Si 5404 ausente y 1805 (Impuesto corriente activo) > 0 → saldo de 1805.
   *   3. Si 1355 (Anticipo de impuestos) > 0 sin 1805 ni 5404 → ese saldo.
   *   0n cuando no hay saldo a favor identificable.
   * Why: el Art. 850 E.T. exige que un saldo a favor de renta se presente como
   * activo (1355 / 1805), nunca neteado contra el gasto (clase 54). V13 lee este
   * campo para validar que el reporte declara el saldo a favor en cuenta de
   * activo y NO compensa contra gasto en P&L.
   */
  saldoAFavorImpuesto: bigint;
}

export interface ControlTotalsRaw {
  /** String canónica del activo total leída del Excel/CSV. */
  activo: string;
  pasivo: string;
  patrimonio: string;
  ingresos: string;
  gastos: string;
  utilidadNeta: string;
  utilidadAntesImpuestos: string;
  impuestoCausado: string;
  efectivoCuenta11: string;
  /** String canónica del saldo a favor del impuesto de renta. */
  saldoAFavorImpuesto: string;
}

/**
 * Totales de control — contrato numerico vinculante para los agentes.
 * Todos los campos son requeridos (0 si ausentes en la entrada).
 */
export interface ControlTotals {
  activo: number;
  activoCorriente: number;
  activoNoCorriente: number;
  pasivo: number;
  pasivoCorriente: number;
  pasivoNoCorriente: number;
  patrimonio: number;
  ingresos: number;
  /** Gastos (Clase 5) + Costos (Clases 6 y 7) */
  gastos: number;
  /** Ingresos - Gastos */
  utilidadNeta: number;
  // -----------------------------------------------------------------------
  // Big Four Cash Flow — segregacion de cuentas PUC para el Strategy Director
  // -----------------------------------------------------------------------
  /** PUC 11 — Efectivo y equivalentes */
  efectivoCuenta11: number;
  /** PUC 13 — Deudores comerciales y otros */
  deudoresCuenta13: number;
  /** PUC 23 — Cuentas por pagar */
  cuentasPorPagar23: number;
  /** PUC 24 — Impuestos por pagar */
  impuestosCuenta24: number;
  /** PUC 25 — Obligaciones laborales */
  obligacionesLaborales25: number;
  // -----------------------------------------------------------------------
  // Pulido Diamante R6 — anclas de caja para validar EFE ↔ Balance al centavo.
  // Opcionales por ahora: la lógica que los popula la pondrá B1. Hacerlos
  // obligatorios hoy rompería tests/literales existentes que construyen
  // `ControlTotals` sin estos campos.
  // -----------------------------------------------------------------------
  /**
   * Saldo final de caja (= efectivoCuenta11) — alias semántico para validar
   * EFE↔Balance al centavo.
   */
  // TODO(B1): hacer obligatorio cuando R6 popule estos campos
  cashClose?: number;
  /** Saldo inicial de caja (PUC 11 del comparativo, 0 si single-period). */
  // TODO(B1): hacer obligatorio cuando R6 popule estos campos
  cashOpen?: number;
  // -----------------------------------------------------------------------
  // Pulido NIIF PYME Grupo 2 — anclas en BigInt centavos + string raw.
  // Opcionales por retrocompatibilidad: `buildSnapshotForPeriod` los popula
  // siempre, pero los tests/literales históricos que construyen
  // `ControlTotals` a mano no necesitan llenarlos.
  // -----------------------------------------------------------------------
  /** BigInt centavos — fuente única para validators del gate. */
  cents?: ControlTotalsCents;
  /** Strings canónicas leídas del archivo (auditoría del parser). */
  raw?: ControlTotalsRaw;
}

// ---------------------------------------------------------------------------
// Hallazgos a nivel de snapshot (banderas determinísticas, no métricas)
// ---------------------------------------------------------------------------
// Los curator rules y el parser pueden marcar banderas en `snapshot.findings`
// que el gate `auditReportEmittable` lee para decidir si bloquea la emisión.
// Todos opcionales: ausencia equivale a `false`.
// ---------------------------------------------------------------------------
export interface SnapshotFindings {
  /** R12 — saldo neto P&L ≠ 0 y grupo 36/37 ≈ 0 (utilidad sin trasladar). */
  librosNoCerrados?: boolean;
  /** R10 — gasto impuesto en clase 54 sin causación correspondiente en 24. */
  missingTaxCausation?: boolean;
  /** R10 — saldo acreedor en cuenta 18 indica uso como gasto. */
  cuenta18UsadaComoGasto?: boolean;
  /** R14 — PPE bruto material sin depreciación correspondiente. */
  ppeWithoutDepreciation?: boolean;
  /** R15 — comercializadora con clase 7 sin descargue 6135. */
  costeoIncompleto?: boolean;
}

// ---------------------------------------------------------------------------
// Metadata de la empresa extraída del archivo (vs. la del intake)
// ---------------------------------------------------------------------------
// `razonSocialFromFile` y `nitFromFile` provienen de los encabezados del
// balance de prueba (filas previas a las cuentas en el Excel). Si el parser
// no los pudo extraer, ambos son `null` y el gate los reporta como blocker
// V5. `niifGroup` y `tipoSocietario` provienen del intake del usuario.
// ---------------------------------------------------------------------------
export interface ExtractedCompanyMetadata {
  /** Razón social literal del Excel (NUNCA placeholder/fallback). */
  razonSocialFromFile: string | null;
  /** NIT literal del Excel con DV (formato canónico "NNN.NNN.NNN-D"). */
  nitFromFile: string | null;
  /** NIT sin DV (sólo dígitos del cuerpo, para validación contra DV DIAN). */
  nitBodyDigits: string | null;
  /** Dígito de verificación leído del archivo (string del char individual). */
  nitCheckDigit: string | null;
  /** Texto crudo del header donde se detectó la metadata (debug). */
  sourceLines: string[];
}

/**
 * Resultado de la validacion aritmetica del balance de prueba.
 */
export interface ValidationResult {
  /** Si true, el pipeline no debe generar un reporte. */
  blocking: boolean;
  /** Descripciones legibles de por que no cuadra la ecuacion patrimonial. */
  reasons: string[];
  /** Cuentas o grupos que el usuario deberia revisar en el archivo original. */
  suggestedAccounts: string[];
  /** Ajustes aplicados al vuelo (informativos, no bloquean). */
  adjustments: string[];
}

/** Desglose del patrimonio (Clase 3). */
export interface EquityBreakdown {
  capitalAutorizado?: number;
  capitalSuscritoPagado?: number;
  reservaLegal?: number;
  otrasReservas?: number;
  utilidadEjercicio?: number;
  utilidadesAcumuladas?: number;
  /** Gap absorbido por R5; 0 o ausente si Balance y ECP cuadraban. */
  convergenceAdjustment?: number;
}

/**
 * Snapshot de un periodo individual. Cada `PeriodSnapshot` corre su propia
 * validacion patrimonial, control totals y equity breakdown. La estructura
 * replica el contrato historico de `PreprocessedBalance` pero confinado al
 * periodo nombrado por `period`.
 */
export interface PeriodSnapshot {
  period: string;
  classes: PUCClass[];
  controlTotals: ControlTotals;
  equityBreakdown: EquityBreakdown;
  summary: {
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    totalRevenue: number;
    totalExpenses: number;
    totalCosts: number;
    totalProduction: number;
    netIncome: number;
    equationBalance: number;
    equationBalanced: boolean;
  };
  validation: ValidationResult;
  discrepancies: Discrepancy[];
  missingExpectedAccounts: string[];
  /** Resultado del Curator NIIF middleware (R1–R4). Inyectado por
   *  `preprocessTrialBalance` después de construir el snapshot. */
  curator?: CuratorResult;
  /** Estado de Flujos de Efectivo método indirecto (NIC 7), generado por
   *  R2 cuando hay periodo comparativo. */
  cashFlowIndirecto?: CashFlowStatement;
  /** Reclasificaciones APLICADAS por R1 (con mutación efectiva). */
  reclassifications?: Reclassification[];
  /** Gap absorbido por R5 (mismo valor que equityBreakdown.convergenceAdjustment). */
  equityAnchorAdjustment?: number;
  /** Gap absorbido por R6. */
  cashFlowClosureAdjustment?: number;
  /** Callout R7 si margen > 85% Y inventario > 50% ingresos. */
  presumedCostWarning?: PresumedCostWarning;
  /** Ajuste de Cierre Virtual aplicado por R8 (siempre presente post-curator). */
  virtualCloseAdjustment?: VirtualCloseAdjustment;
  /** R9 audit — contrato cents + raw preservado al centavo. */
  precisionCentsAudit?: PrecisionCentsAudit;
  /** R10 audit — clasificación cuenta 18 + causación impuesto. */
  class18ClassificationAudit?: Class18ClassificationAudit;
  /** R12 audit — detector de cierre de libros. */
  closingDetectorAudit?: ClosingDetectorAudit;
  /** R14 audit — PPE sin depreciación. */
  ppeDepreciationAudit?: PpeDepreciationAudit;
  /** R15 audit — costeo incompleto en clase 7. */
  costClassificationAudit?: CostClassificationAudit;
  /**
   * Banderas determinísticas a nivel de snapshot (R10/R12/R14/R15 → gate).
   * Inicializado como `{}` por `buildSnapshotForPeriod`; las reglas escriben
   * banderas booleanas que `auditReportEmittable` lee. Optional para
   * retrocompatibilidad con tests legacy que construyen `PeriodSnapshot` a mano.
   */
  findings?: SnapshotFindings;
}

// ---------------------------------------------------------------------------
// Pulido NIIF PYME Grupo 2 — actividad inferida desde el balance.
// ---------------------------------------------------------------------------
// `sectorCIIU` es la **letra** del CIIU rev. 4 A.C. (DANE), NUNCA un código
// numérico. La inferencia es informativa, no autoritativa: el intake del
// usuario sigue siendo la fuente formal de actividad económica.
//
// Detector AMPLIADO (sector G — Comercio):
//   Dispara si CUALQUIERA se cumple:
//     (a) 1435 (Mercancías no fabricadas) material (>5% activo corriente) Y
//         clase 6 ausente o <1% de los ingresos.
//     (b) Clase 14 (Inventarios) > 30% del activo total.
//
// Why: en NIIF para PYMES Sec. 13 + Decreto 2650/93, una empresa con
// concentración fuerte en inventario de mercancías es comercializadora aunque
// no haya descargado el CMV en clase 6. V14 usa esta inferencia + margen bruto
// para detectar costeo incompleto enmascarado como rentabilidad alta.
// ---------------------------------------------------------------------------
export interface ActividadInferida {
  /** Letra CIIU rev. 4 (G, F, C, etc.). NUNCA código numérico. */
  sectorCIIU: string;
  /** Descripción legible del sector. */
  descripcion: string;
  /** Lista de criterios que dispararon la inferencia (auditable). */
  evidencia: string[];
}

/**
 * Reclasificación NIC 1 párr. 32 (no compensación) — contrato externo.
 *
 * Diferente del shape interno `Reclassification` (que vive en R1 con códigos
 * virtuales `2810ZZ-*` / `2895VC-*`). Aquí mapeamos al contrato PUC-aware
 * que los agentes del pipeline financiero y los renderers consumen:
 *
 *   - `cuenta_destino_pasivo='2895'` para clase 12 (Inversiones, NIC 28).
 *   - `cuenta_destino_pasivo='2105'` para clase 11 (sobregiros bancarios).
 *   - `cuenta_destino_pasivo='2810'` para el resto del activo (default).
 *
 * Why: el LLM en producción debe citar códigos PUC reales, no códigos
 * virtuales internos. Este mapeo aísla el contrato externo del detalle de
 * implementación de R1.
 */
export interface ReclasificacionNoCompensacion {
  cuenta_origen: string;
  /** Magnitud absoluta del saldo invertido (en centavos, BigInt). */
  saldo_invertido_centavos: bigint;
  /** Cuenta PUC de destino: '2895' | '2810' | '2105'. */
  cuenta_destino_pasivo: string;
  /** Norma + justificación legible. */
  motivo_norma: string;
}

/**
 * Resultado del preprocesamiento multiperiodo. `periods` esta ordenado
 * ascendentemente (mas antiguo -> mas reciente). `primary` apunta siempre al
 * periodo mas reciente; `comparative` al inmediatamente anterior si existe.
 */
export interface PreprocessedBalance {
  /** No vacio. Ordenado ascendente. */
  periods: PeriodSnapshot[];
  /** = periods[periods.length - 1] */
  primary: PeriodSnapshot;
  /** = periods[periods.length - 2] o null */
  comparative: PeriodSnapshot | null;
  /** Cross-period: filas crudas con todos los saldos. */
  rawRows: RawAccountRow[];
  auxiliaryCount: number;
  /** CSV consolidado etiquetado por bloque `[period=YYYY]` */
  cleanData: string;
  /** Markdown human-readable que documenta TODOS los periodos. */
  validationReport: string;
  // -------------------------------------------------------------------------
  // Pulido NIIF PYME Grupo 2 — banderas y contratos a nivel cross-period.
  // -------------------------------------------------------------------------
  /**
   * `true` si NO existe periodo comparativo material (single-period import o
   * comparative con auxiliaryTotal ≈ 0 en TODAS las clases). `false` si hay
   * comparativo con saldos de cualquier clase.
   *
   * Why: NIIF para PYMES §3.14 + §10.21 exigen presentar comparativos. Cuando
   * son impracticables, la entidad debe declararlo explícitamente — NO
   * reconstruir cuentas individuales desde Utilidades Retenidas (§10.19 lo
   * prohíbe). V15 valida que el reporte declare la impracticabilidad cuando
   * este flag es `true`.
   */
  comparativos_impracticables: boolean;
  /**
   * Sector CIIU inferido del balance + criterios que lo soportan. Opcional:
   * sólo se popula cuando el detector tiene evidencia suficiente.
   */
  actividadInferida?: ActividadInferida;
  /**
   * Lista PUC-aware de reclasificaciones por no-compensación (NIC 1 párr. 32)
   * aplicadas por R1. Vacío `[]` si no hubo. Why: contrato externo estable
   * que los agentes citan; aísla códigos PUC reales del detalle interno R1.
   */
  reclasificacionesNoCompensacion: ReclasificacionNoCompensacion[];
}

/** Alias de compatibilidad hacia atras. */
export type PreprocessedBalanceData = PreprocessedBalance;

// ---------------------------------------------------------------------------
// PUC class names
// ---------------------------------------------------------------------------

const PUC_CLASS_NAMES: Record<number, string> = {
  1: 'Activo',
  2: 'Pasivo',
  3: 'Patrimonio',
  4: 'Ingresos',
  5: 'Gastos',
  6: 'Costos de Ventas',
  7: 'Costos de Produccion',
};

// ---------------------------------------------------------------------------
// PUC — clasificacion corriente / no corriente (Decreto 2650/1993 ajustado)
// ---------------------------------------------------------------------------
const ACTIVO_CORRIENTE_GROUPS = new Set(['11', '12', '13', '14']);
const ACTIVO_NO_CORRIENTE_GROUPS = new Set(['15', '16', '17', '18', '19']);
const PASIVO_CORRIENTE_GROUPS = new Set(['21', '22', '23', '24', '25', '26']);
const PASIVO_NO_CORRIENTE_GROUPS = new Set(['27', '28', '29']);

// ---------------------------------------------------------------------------
// Subcuentas importantes
// ---------------------------------------------------------------------------
const IMPORTANT_SUBCUENTAS: Record<string, { name: string; parentGroup: string }> = {
  '1105': { name: 'Caja', parentGroup: '11' },
  '1110': { name: 'Bancos', parentGroup: '11' },
  '1120': { name: 'Cuentas de ahorro', parentGroup: '11' },
  '1435': { name: 'Mercancias no fabricadas por la empresa', parentGroup: '14' },
  '2365': { name: 'Retencion en la fuente', parentGroup: '23' },
  '2408': { name: 'IVA por pagar', parentGroup: '24' },
  '3105': { name: 'Capital autorizado', parentGroup: '31' },
  '3115': { name: 'Capital suscrito y pagado', parentGroup: '31' },
  '3305': { name: 'Reserva legal', parentGroup: '33' },
  '3605': { name: 'Utilidad del ejercicio', parentGroup: '36' },
};

// ---------------------------------------------------------------------------
// Period detection helpers
// ---------------------------------------------------------------------------

/**
 * Etiqueta default para cuando no se detecta un año en headers ni en
 * `parseTrialBalanceCSV` options. Los consumers deberian preferir pasar
 * `fiscalPeriod` por `options` desde la upload route para evitarla.
 */
export const DEFAULT_PERIOD = 'current';

/** Regex para detectar un año tipo "2024" en cualquier string. */
const YEAR_REGEX = /\b(20\d{2})\b/;

/**
 * Detecta el año embebido en un string (header de columna o nombre de hoja
 * Excel). Devuelve el año como string ("2024") o `null` si no hay año.
 */
export function detectYearFromString(value: string | undefined | null): string | null {
  if (!value) return null;
  const m = String(value).match(YEAR_REGEX);
  return m ? m[1] : null;
}

/**
 * Determina si un header pertenece a una columna de saldo (final, neto o
 * balance). Acepta variantes con espacios, guiones bajos y mayusculas.
 */
function isBalanceHeader(header: string): boolean {
  const lower = header.toLowerCase();
  // Excluye columnas de movimientos (debito/credito)
  if (/\b(debito|debit|credito|credit|debe|haber)\b/.test(lower)) return false;
  return /\b(saldo|balance|neto|saldos)\b/.test(lower);
}

/**
 * Determina si un header es explicitamente "saldo anterior" / comparativo,
 * SIN año explicito. Cuando se usa, el caller debe inferir el año restando 1
 * al periodo principal.
 */
function isPreviousBalanceHeader(header: string): boolean {
  const lower = header.toLowerCase();
  return /\b(saldo[ _]?anterior|previous|comparativo|prior)\b/.test(lower);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** Opciones del parser CSV. */
export interface ParseTrialBalanceOptions {
  /**
   * Periodo fiscal "actual" cuando los headers no traen año. Si los headers
   * tienen "saldo anterior" sin año explicito, el periodo anterior se infiere
   * como `Number(currentYear) - 1`.
   */
  currentYear?: string;
  /**
   * Si el caller ya sabe que toda la entrada (por ejemplo una hoja Excel
   * etiquetada con un año) corresponde a un solo periodo, lo pasa aqui y se
   * fuerza ese periodo en TODOS los rows, ignorando headers de año.
   */
  forcePeriod?: string;
}

interface BalanceColumn {
  index: number;
  period: string | null; // null = "saldo anterior" sin año todavia conocido
  isPrevious: boolean;
}

/**
 * Parse raw CSV text into account rows.
 * Detecta multiples columnas de saldo y las distribuye en `balancesByPeriod`.
 */
export function parseTrialBalanceCSV(
  csvText: string,
  options: ParseTrialBalanceOptions = {},
): RawAccountRow[] {
  const lines = csvText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const firstLine = lines[0];
  const separator = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';

  // Headers: conservamos tanto el original (para detectYearFromString, que es
  // case-insensitive pero no requiere mucho) como el lowercase (para findColumnIndex).
  const rawHeaders = parseLine(firstLine, separator).map((h) => h.trim());
  const headers = rawHeaders.map((h) => h.toLowerCase());

  const codeIdx = findColumnIndex(headers, ['codigo', 'code', 'cuenta', 'account', 'cta', 'cod']);
  const nameIdx = findColumnIndex(headers, ['nombre', 'name', 'descripcion', 'description', 'concepto']);
  const levelIdx = findColumnIndex(headers, ['nivel', 'level', 'tipo', 'type', 'naturaleza']);
  const transIdx = findColumnIndex(headers, ['transaccional', 'transactional', 'auxiliar', 'movimiento']);
  const debitIdx = findColumnIndex(headers, ['debito', 'debit', 'debitos', 'debe', 'db']);
  const creditIdx = findColumnIndex(headers, ['credito', 'credit', 'creditos', 'haber', 'cr']);

  if (codeIdx === -1) return [];

  // -------------------------------------------------------------------------
  // Detectar TODAS las columnas de saldo y mapearlas a periodos.
  // -------------------------------------------------------------------------
  const balanceColumns = detectBalanceColumns(rawHeaders, options);

  const rows: RawAccountRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i], separator);
    const rawCode = (cols[codeIdx] || '').trim().replace(/['"]/g, '');
    const code = rawCode.replace(/[.\-\s]/g, '');
    if (!code || !/^\d/.test(code)) continue;

    const debit = safeNumber(parseNumber(cols[debitIdx]));
    const credit = safeNumber(parseNumber(cols[creditIdx]));

    let level = levelIdx !== -1 ? (cols[levelIdx] || '').trim() : inferLevel(code);
    level = normalizeLevel(level);

    let transactional = false;
    if (transIdx !== -1) {
      const val = (cols[transIdx] || '').trim().toLowerCase();
      transactional = val === 'si' || val === 'sí' || val === 'yes' || val === '1' || val === 'true';
    } else {
      transactional = level === 'Auxiliar';
    }

    const classCode = parseInt(code[0], 10);
    const balancesByPeriod: Record<string, number> = {};

    if (balanceColumns.length > 0) {
      // Caso normal: hay columnas de saldo identificadas. Cada columna
      // alimenta su periodo correspondiente.
      for (const col of balanceColumns) {
        const raw = parseNumber(cols[col.index]);
        if (Number.isNaN(raw)) continue;
        const period = col.period ?? options.forcePeriod ?? options.currentYear ?? DEFAULT_PERIOD;
        balancesByPeriod[period] = raw;
      }
    } else if (debitIdx !== -1 || creditIdx !== -1) {
      // Solo hay debito/credito: derivamos el balance segun naturaleza PUC.
      const computed =
        [1, 5, 6, 7].includes(classCode) ? debit - credit : credit - debit;
      const period = options.forcePeriod ?? options.currentYear ?? DEFAULT_PERIOD;
      balancesByPeriod[period] = computed;
    }

    // Si no se detecto ningun balance para esta fila, la saltamos.
    if (Object.keys(balancesByPeriod).length === 0) continue;

    rows.push({
      code,
      name: (cols[nameIdx] || '').trim().replace(/['"]/g, ''),
      level,
      transactional,
      balancesByPeriod,
    });
  }

  return rows;
}

/**
 * Detecta las columnas de saldo del header y las mapea a periodos.
 *
 * Reglas:
 *  1. Cualquier header que matchee `isBalanceHeader` y contenga un año
 *     `20\d{2}` es columna de un periodo explicito.
 *  2. Header con "saldo anterior"/"comparativo" sin año -> columna previa,
 *     periodo a inferir como `currentYear - 1`.
 *  3. Header con "saldo"/"balance" sin año y sin "anterior" -> usa
 *     `options.currentYear` o `DEFAULT_PERIOD`.
 *  4. Si tras (1)/(2)/(3) hay ambiguedad por multiples columnas sin año,
 *     se desempata: la primera es "current", la segunda es "previous"
 *     (heuristica: muchos ERPs colombianos exportan "Saldo Final | Saldo Anterior").
 */
function detectBalanceColumns(
  rawHeaders: string[],
  options: ParseTrialBalanceOptions,
): BalanceColumn[] {
  const candidates: Array<BalanceColumn & { rawHeader: string }> = [];

  rawHeaders.forEach((header, index) => {
    if (!isBalanceHeader(header)) return;
    const year = detectYearFromString(header);
    const prev = isPreviousBalanceHeader(header);
    candidates.push({
      index,
      period: year, // si null, se resuelve mas abajo
      isPrevious: prev,
      rawHeader: header,
    });
  });

  if (candidates.length === 0) return [];

  // Si forcePeriod esta seteado, todas las columnas van al mismo periodo.
  if (options.forcePeriod) {
    return candidates.map((c) => ({
      index: c.index,
      period: options.forcePeriod!,
      isPrevious: false,
    }));
  }

  // Resolucion para columnas sin año:
  // - currentYear contextual
  const currentYear = options.currentYear;
  const currentYearNum = currentYear ? parseInt(currentYear, 10) : NaN;
  const prevYear =
    !Number.isNaN(currentYearNum) ? String(currentYearNum - 1) : null;

  // Si tenemos UNA columna explicita "saldo anterior" sin año, le asignamos prevYear.
  // Si tenemos UNA columna "saldo" sin año, le asignamos currentYear.
  // Si tenemos DOS columnas sin año (heuristica clasica saldo + saldo anterior):
  //   la marcada como "previous" -> prevYear; la otra -> currentYear.
  const resolved: BalanceColumn[] = [];
  const unlabeled = candidates.filter((c) => !c.period);

  for (const c of candidates) {
    if (c.period) {
      resolved.push({ index: c.index, period: c.period, isPrevious: c.isPrevious });
      continue;
    }
    // sin año: decidir por flag isPrevious
    if (c.isPrevious) {
      resolved.push({
        index: c.index,
        period: prevYear ?? `${DEFAULT_PERIOD}_anterior`,
        isPrevious: true,
      });
    } else {
      // Si hay un "saldo anterior" desambiguado y este NO lo es, asume currentYear
      resolved.push({
        index: c.index,
        period: currentYear ?? DEFAULT_PERIOD,
        isPrevious: false,
      });
    }
  }

  // Edge case: si tras la resolucion todas terminaron con el mismo periodo
  // (porque no habia year context) y son 2 columnas, la heuristica del par
  // saldo/saldo_anterior aplica: marcar la segunda como anterior.
  if (
    !currentYear &&
    unlabeled.length === 2 &&
    resolved.length === 2 &&
    resolved[0].period === resolved[1].period
  ) {
    resolved[1] = {
      index: resolved[1].index,
      period: `${DEFAULT_PERIOD}_anterior`,
      isPrevious: true,
    };
  }

  // Dedupe por periodo: si dos columnas terminan apuntando al mismo periodo
  // (caso raro de archivos con headers duplicados), prefiere la primera.
  const seen = new Set<string>();
  const dedup: BalanceColumn[] = [];
  for (const r of resolved) {
    if (seen.has(r.period!)) continue;
    seen.add(r.period!);
    dedup.push(r);
  }
  return dedup;
}

// ---------------------------------------------------------------------------
// Validation & Structuring
// ---------------------------------------------------------------------------

/** Opciones del preprocesador. */
export interface PreprocessTrialBalanceOptions {
  /**
   * Si la entrada solo tiene saldos sin año (todas con periodo `'current'`),
   * el caller puede pasar `defaultPeriod` para etiquetar el snapshot.
   */
  defaultPeriod?: string;
}

/**
 * Process parsed account rows into a multi-period validated balance.
 */
export function preprocessTrialBalance(
  rows: RawAccountRow[],
  options: PreprocessTrialBalanceOptions = {},
): PreprocessedBalance {
  // -------------------------------------------------------------------------
  // 1. Inventario de periodos presentes.
  // -------------------------------------------------------------------------
  const periodSet = new Set<string>();
  for (const r of rows) {
    for (const p of Object.keys(r.balancesByPeriod)) periodSet.add(p);
  }
  if (periodSet.size === 0 && options.defaultPeriod) {
    // No deberia pasar normalmente — pero aseguramos al menos un periodo.
    periodSet.add(options.defaultPeriod);
  }
  if (periodSet.size === 0) {
    periodSet.add(DEFAULT_PERIOD);
  }

  const periods = sortPeriodsAscending([...periodSet]);

  // -------------------------------------------------------------------------
  // 2. Construir un PeriodSnapshot por cada periodo + ejecutar Curator (R1–R4).
  // -------------------------------------------------------------------------
  const snapshots: PeriodSnapshot[] = [];
  for (let i = 0; i < periods.length; i++) {
    const snap = buildSnapshotForPeriod(rows, periods[i]);
    const prev = i > 0 ? snapshots[i - 1] : null;
    const curatorResult = runCurator(snap, prev);
    snap.curator = curatorResult;
    if (curatorResult.cashFlowIndirecto) {
      snap.cashFlowIndirecto = curatorResult.cashFlowIndirecto;
    }
    // Inyectar findings del curator como discrepancies para que aparezcan en
    // el reporte multiperiodo y en el `bindingTotalsBlock` que reciben los
    // agentes LLM. Mantenemos shape `Discrepancy` (location/reported/calculated/
    // difference/description) — los findings del curator son cualitativos, así
    // que reported=0 y calculated=0 con el contenido en `description`.
    for (const f of curatorResult.findings) {
      snap.discrepancies.push(curatorFindingToDiscrepancy(f, snap));
    }
    snapshots.push(snap);
  }

  const primary = snapshots[snapshots.length - 1];
  const comparative = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;

  // -------------------------------------------------------------------------
  // 3. Reportes y datos limpios consolidados (etiquetados por periodo).
  // -------------------------------------------------------------------------
  const cleanData = buildCleanDataMultiPeriod(snapshots);
  const validationReport = buildMultiPeriodValidationReport(snapshots, rows.length);

  const auxiliaryCount = primary.classes.reduce(
    (s, c) => s + c.accounts.length,
    0,
  );

  // -------------------------------------------------------------------------
  // 4. Pulido NIIF PYME Grupo 2 — banderas y contratos cross-period.
  // -------------------------------------------------------------------------
  const comparativos_impracticables = detectComparativosImpracticables(
    snapshots,
    comparative,
  );
  const actividadInferida = inferActividadFromSnapshot(primary);
  const reclasificacionesNoCompensacion =
    buildReclasificacionesNoCompensacion(primary);

  return {
    periods: snapshots,
    primary,
    comparative,
    rawRows: rows,
    auxiliaryCount,
    cleanData,
    validationReport,
    comparativos_impracticables,
    actividadInferida,
    reclasificacionesNoCompensacion,
  };
}

// ---------------------------------------------------------------------------
// Pulido NIIF PYME Grupo 2 — detectores cross-period
// ---------------------------------------------------------------------------

/**
 * Detector de comparativos impracticables (NIIF for SMEs §3.14, §10.21).
 *
 * `false` cuando:
 *   - Hay 2+ snapshots Y el comparative tiene saldos materiales en CUALQUIER
 *     clase (suma de auxiliaryTotal en valor absoluto > $1.000 COP).
 *
 * `true` cuando:
 *   - Sólo hay 1 snapshot (no hay opening balance), O
 *   - El comparative existe pero todas las clases tienen auxiliaryTotal ≈ 0.
 *
 * NUNCA inferir el flag desde Utilidades Retenidas — §10.19 prohíbe
 * reconstruir cuentas individuales desde Utilidades Retenidas.
 */
function detectComparativosImpracticables(
  snapshots: PeriodSnapshot[],
  comparative: PeriodSnapshot | null,
): boolean {
  if (snapshots.length < 2 || !comparative) return true;
  const TOL = 1_000;
  const totalAbs = comparative.classes.reduce(
    (s, c) => s + Math.abs(c.auxiliaryTotal),
    0,
  );
  return totalAbs <= TOL;
}

/**
 * Inferencia de sector CIIU (rev. 4 A.C., letra) desde el primary snapshot.
 *
 * Detector AMPLIADO sector G (Comercio):
 *   Dispara si CUALQUIERA se cumple:
 *     (a) 1435 (Mercancías no fabricadas) > 5% del activo corriente
 *         Y (clase 6 ausente o |clase6| < 1% de ingresos).
 *     (b) Clase 14 (Inventarios) > 30% del activo total.
 *
 * Why: el balance Grupo Empresarial 2 Tres SAS (fixture testigo) tiene
 * 1435 material y NO tiene 6135 — pero sí 7405 (clase 7 usada como costo).
 * El detector original (clase 6 obligatoria) lo perdía. Ampliado captura
 * comercializadoras que descargan costos a clase 7.
 *
 * Devuelve `undefined` si no hay evidencia suficiente.
 */
function inferActividadFromSnapshot(
  snap: PeriodSnapshot,
): ActividadInferida | undefined {
  const evidencia: string[] = [];
  const activoTotal = snap.controlTotals.activo;
  const activoCorriente = snap.controlTotals.activoCorriente;
  const ingresos = snap.controlTotals.ingresos;

  if (activoTotal <= 0) return undefined;

  const class6 = snap.classes.find((c) => c.code === 6);
  const class14 = snap.classes.find((c) => c.code === 1)?.accounts ?? [];
  const inv1435 = class14
    .filter((a) => a.code.startsWith('1435'))
    .reduce((s, a) => s + a.balance, 0);
  const totalInventarios = class14
    .filter((a) => a.code.startsWith('14'))
    .reduce((s, a) => s + a.balance, 0);

  const class6Total = class6 ? Math.abs(class6.auxiliaryTotal) : 0;
  const class6Ausente = !class6 || class6.accounts.length === 0;
  const class6MenorThan1Pct =
    ingresos > 0 ? class6Total < ingresos * 0.01 : class6Ausente;

  // Criterio (a): 1435 material + clase 6 ausente o irrelevante.
  const inv1435PctAC =
    activoCorriente > 0 ? inv1435 / activoCorriente : 0;
  const triggerA = inv1435PctAC > 0.05 && (class6Ausente || class6MenorThan1Pct);

  if (triggerA) {
    evidencia.push(
      `Cuenta 1435 (Mercancías no fabricadas) = $${formatCOP(inv1435)} ` +
        `(${(inv1435PctAC * 100).toFixed(1)}% del activo corriente).`,
    );
    if (class6Ausente) {
      evidencia.push('Clase 6 (Costo de Ventas) ausente del balance.');
    } else {
      evidencia.push(
        `Clase 6 (Costo de Ventas) inmaterial: $${formatCOP(class6Total)} ` +
          `< 1% de los ingresos ($${formatCOP(ingresos)}).`,
      );
    }
  }

  // Criterio (b): clase 14 > 30% del activo total.
  const inv14PctActivo = totalInventarios / activoTotal;
  const triggerB = inv14PctActivo > 0.30;

  if (triggerB) {
    evidencia.push(
      `Inventarios totales (Clase 14) = $${formatCOP(totalInventarios)} ` +
        `(${(inv14PctActivo * 100).toFixed(1)}% del activo total).`,
    );
  }

  if (!triggerA && !triggerB) return undefined;

  return {
    sectorCIIU: 'G',
    descripcion:
      'Comercio al por mayor y al por menor (CIIU rev. 4, sección G). ' +
      'Inferencia automática del balance — el intake del usuario sigue siendo ' +
      'la fuente formal.',
    evidencia,
  };
}

/**
 * Mapea las reclasificaciones internas R1 al contrato externo PUC-aware.
 *
 * Reglas de mapeo:
 *   - Origen clase 11 (códigos `11xx`) → destino '2105' (sobregiros).
 *   - Origen clase 12 (códigos `12xx`) → destino '2895' (NIC 28).
 *   - Resto del activo → destino '2810' (otros pasivos diversos).
 *
 * Why: el contrato externo cita códigos PUC reales que el LLM puede
 * referenciar. R1 internamente usa códigos virtuales `2810ZZ-*` / `2895VC-*`
 * para preservar trazabilidad — ese detalle NO viaja al prompt.
 */
function buildReclasificacionesNoCompensacion(
  snap: PeriodSnapshot,
): ReclasificacionNoCompensacion[] {
  const out: ReclasificacionNoCompensacion[] = [];
  const reclas = snap.reclassifications ?? [];
  for (const r of reclas) {
    if (!r.applied) continue;
    const origin = r.accountCode;
    let destino = '2810';
    if (origin.startsWith('11')) destino = '2105';
    else if (origin.startsWith('12')) destino = '2895';

    const amountCents = BigInt(
      Math.round(Math.abs(r.effectiveTransferCop ?? r.amountCop) * 100),
    );

    out.push({
      cuenta_origen: origin,
      saldo_invertido_centavos: amountCents,
      cuenta_destino_pasivo: destino,
      motivo_norma:
        `NIC 1 párr. 32 (no compensación): saldo crédito en cuenta ${origin} ` +
        `(${r.accountName}) reclasificado a pasivo PUC ${destino}. ` +
        r.justification,
    });
  }
  return out;
}

/**
 * Construye un snapshot completo (clases, controlTotals, equityBreakdown,
 * summary, validation, discrepancies) para un periodo concreto. Trabaja sobre
 * la "vista" del periodo: cada row se proyecta a `balance = balancesByPeriod[period] ?? 0`.
 */
function buildSnapshotForPeriod(
  allRows: RawAccountRow[],
  period: string,
): PeriodSnapshot {
  // Vista plana: rows con balance del periodo.
  const view = allRows.map((r) => ({
    code: r.code,
    name: r.name,
    level: r.level,
    transactional: r.transactional,
    balance: r.balancesByPeriod[period] ?? 0,
  }));

  // -------------------------------------------------------------------------
  // 1. Leaf rows: aux + subcuentas huerfanas
  // -------------------------------------------------------------------------
  const auxiliarRows = view.filter((r) => r.transactional || r.level === 'Auxiliar');
  const subcuentaRows = view.filter((r) => r.level === 'Subcuenta');

  const orphanSubcuentas: typeof view = [];
  for (const sub of subcuentaRows) {
    const hasAuxiliarDescendant = auxiliarRows.some(
      (aux) => aux.code !== sub.code && aux.code.startsWith(sub.code),
    );
    if (!hasAuxiliarDescendant) orphanSubcuentas.push(sub);
  }

  const auxiliarCodes = new Set(auxiliarRows.map((r) => r.code));
  const leafRows = [
    ...auxiliarRows,
    ...orphanSubcuentas.filter((r) => !auxiliarCodes.has(r.code)),
  ];

  const classRows = view.filter((r) => r.level === 'Clase');

  // -------------------------------------------------------------------------
  // 2. Agrupar leafs por clase PUC (1..7)
  // -------------------------------------------------------------------------
  const classMap = new Map<number, { leaves: typeof view; reportedRow: typeof view[number] | null }>();
  for (let c = 1; c <= 7; c++) classMap.set(c, { leaves: [], reportedRow: null });

  for (const row of leafRows) {
    const classCode = parseInt(row.code[0], 10);
    if (classCode >= 1 && classCode <= 7) {
      classMap.get(classCode)!.leaves.push(row);
    }
  }

  for (const row of classRows) {
    const classCode = parseInt(row.code[0], 10);
    if (classMap.has(classCode)) classMap.get(classCode)!.reportedRow = row;
  }

  // -------------------------------------------------------------------------
  // 3. Construir PUCClass[] + discrepancias por clase
  // -------------------------------------------------------------------------
  const classes: PUCClass[] = [];
  const discrepancies: Discrepancy[] = [];

  for (const [classCode, data] of classMap) {
    const auxiliaryTotal = data.leaves.reduce((sum, r) => sum + r.balance, 0);
    const reportedTotal = data.reportedRow ? data.reportedRow.balance : null;
    const discrepancy = reportedTotal !== null ? Math.abs(auxiliaryTotal - reportedTotal) : 0;

    if (reportedTotal !== null && discrepancy > 1) {
      const missingDesc = findMissingAccountsForClass(view, classCode, data.leaves);
      discrepancies.push({
        location: `Clase ${classCode} (${PUC_CLASS_NAMES[classCode]})`,
        reported: reportedTotal,
        calculated: auxiliaryTotal,
        difference: auxiliaryTotal - reportedTotal,
        description: missingDesc || `Diferencia de $${formatCOP(discrepancy)} entre el total reportado y la suma de auxiliares.`,
      });
    }

    const accounts: ValidatedAccount[] = data.leaves.map((r) => ({
      code: r.code,
      name: r.name,
      level: r.level,
      balance: r.balance,
      isLeaf: true,
    }));
    accounts.sort((a, b) => a.code.localeCompare(b.code));

    classes.push({
      code: classCode,
      name: PUC_CLASS_NAMES[classCode] || `Clase ${classCode}`,
      auxiliaryTotal,
      reportedTotal,
      discrepancy,
      accounts,
    });
  }

  // -------------------------------------------------------------------------
  // 4. Summary legacy (por periodo)
  // -------------------------------------------------------------------------
  const getClassTotal = (c: number) => classes.find((cl) => cl.code === c)?.auxiliaryTotal ?? 0;
  const totalAssets = getClassTotal(1);
  const totalLiabilities = getClassTotal(2);
  const totalEquityRaw = getClassTotal(3);
  const totalRevenue = getClassTotal(4);
  const totalExpenses = getClassTotal(5);
  const totalCosts = getClassTotal(6);
  const totalProduction = getClassTotal(7);
  const netIncome = totalRevenue - totalExpenses - totalCosts - totalProduction;

  // -------------------------------------------------------------------------
  // 4.1. Patrimonio crudo — la "Lógica de Cierre Virtual" (R8 del Curator)
  // sustituyó la auto-reparación condicional que vivía aquí.
  //
  // Razón: la auto-reparación previa sólo disparaba si `shortfall ≈ netIncome`
  // (frágil: balances con descuadres legítimos por otros motivos quedaban sin
  // utilidad, y balances post-cierre con saldo en 3605 ≠ utilidad dinámica
  // no se autocorregían). R8 (`curator-rules/r8-virtual-close.ts`) corre
  // SIEMPRE como primera regla del Curator y es autoritativo:
  //   - Inyecta cuenta virtual 3605VC con utilidad dinámica.
  //   - Reclasifica saldo histórico de 3605 a 3710VC (Resultados Acumulados)
  //     si difiere del cálculo dinámico.
  //   - Absorbe centavos de redondeo en 3710VC.
  // El renderer Excel pinta 3605VC como "Resultado del Ejercicio (Corte
  // Actual)" y los pilares Verdad/Valor leen `controlTotals.utilidadNeta`
  // y `equityBreakdown.utilidadEjercicio` (ambos sincronizados por R8).
  // -------------------------------------------------------------------------
  const adjustments: string[] = [];
  const validationReasons: string[] = [];
  const suggestedAccounts: string[] = [];
  const totalEquity = totalEquityRaw;

  // -------------------------------------------------------------------------
  // 5. controlTotals
  // -------------------------------------------------------------------------
  const activoCorriente = sumLeavesByGroupPrefixes(leafRows, '1', ACTIVO_CORRIENTE_GROUPS);
  const activoNoCorriente = sumLeavesByGroupPrefixes(leafRows, '1', ACTIVO_NO_CORRIENTE_GROUPS);
  const pasivoCorriente = sumLeavesByGroupPrefixes(leafRows, '2', PASIVO_CORRIENTE_GROUPS);
  const pasivoNoCorriente = sumLeavesByGroupPrefixes(leafRows, '2', PASIVO_NO_CORRIENTE_GROUPS);

  const efectivoCuenta11 = sumLeavesByGroupPrefixes(leafRows, '1', new Set(['11']));
  const deudoresCuenta13 = sumLeavesByGroupPrefixes(leafRows, '1', new Set(['13']));
  const cuentasPorPagar23 = sumLeavesByGroupPrefixes(leafRows, '2', new Set(['23']));
  const impuestosCuenta24 = sumLeavesByGroupPrefixes(leafRows, '2', new Set(['24']));
  const obligacionesLaborales25 = sumLeavesByGroupPrefixes(leafRows, '2', new Set(['25']));

  const equationBalance = totalAssets - totalLiabilities - totalEquity;
  const equationBalanced = Math.abs(equationBalance) < 100;

  // -------------------------------------------------------------------------
  // 5.1. Cálculos en BigInt centavos para anclas anti-alucinación.
  // El gate `auditReportEmittable` compara SIEMPRE en cents con tolerancia 0n.
  // -------------------------------------------------------------------------
  // Impuesto causado del periodo: grupo 54 (impuestos como gasto) dentro de
  // clase 5. PUC: 5405 De renta y complementarios, 5410 Industria y comercio.
  const impuestoCausadoPeriodo = sumLeavesByGroupPrefixes(
    leafRows,
    '5',
    new Set(['54']),
  );
  const gastosTotales = totalExpenses + totalCosts + totalProduction;
  const utilidadAntesImpuestos = totalRevenue - (gastosTotales - impuestoCausadoPeriodo);

  // -------------------------------------------------------------------------
  // Saldo a favor del impuesto de renta (Pulido NIIF PYME Grupo 2).
  // Detector cents:
  //   1. Si grupo 5404 acreedor (saldo crédito → balance < 0 en clase 5
  //      cuya naturaleza es deudora) → magnitud absoluta del crédito.
  //   2. Si 5404 ausente y 1805 (Impuesto corriente activo) > 0 → ese saldo.
  //   3. Si 1355 (Anticipo de impuestos) > 0 sin 1805 ni 5404 → ese saldo.
  //   0 cuando no hay saldo a favor identificable.
  // Why: el Art. 850 E.T. exige que un saldo a favor de renta se presente
  // como activo (1355 / 1805), nunca neteado contra el gasto (clase 54).
  // -------------------------------------------------------------------------
  const saldo5404 = leafRows
    .filter((r) => r.code.startsWith('5404'))
    .reduce((s, r) => s + r.balance, 0);
  const saldo1805 = leafRows
    .filter((r) => r.code.startsWith('1805'))
    .reduce((s, r) => s + r.balance, 0);
  const saldo1355 = leafRows
    .filter((r) => r.code.startsWith('1355'))
    .reduce((s, r) => s + r.balance, 0);

  let saldoAFavorImpuesto = 0;
  if (saldo5404 < 0) {
    // 5404 acreedor: clase 5 con saldo negativo es crédito (Art. 850 E.T.).
    saldoAFavorImpuesto = Math.abs(saldo5404);
  } else if (saldo1805 > 0) {
    saldoAFavorImpuesto = saldo1805;
  } else if (saldo1355 > 0) {
    saldoAFavorImpuesto = saldo1355;
  }

  const cents: ControlTotalsCents = {
    activo: toCents(totalAssets),
    pasivo: toCents(totalLiabilities),
    patrimonio: toCents(totalEquity),
    ingresos: toCents(totalRevenue),
    gastos: toCents(gastosTotales),
    utilidadNeta: toCents(netIncome),
    utilidadAntesImpuestos: toCents(utilidadAntesImpuestos),
    impuestoCausado: toCents(impuestoCausadoPeriodo),
    efectivoCuenta11: toCents(efectivoCuenta11),
    saldoAFavorImpuesto: toCents(saldoAFavorImpuesto),
  };

  const raw: ControlTotalsRaw = {
    activo: toRawString(totalAssets),
    pasivo: toRawString(totalLiabilities),
    patrimonio: toRawString(totalEquity),
    ingresos: toRawString(totalRevenue),
    gastos: toRawString(gastosTotales),
    utilidadNeta: toRawString(netIncome),
    utilidadAntesImpuestos: toRawString(utilidadAntesImpuestos),
    impuestoCausado: toRawString(impuestoCausadoPeriodo),
    efectivoCuenta11: toRawString(efectivoCuenta11),
    saldoAFavorImpuesto: toRawString(saldoAFavorImpuesto),
  };

  const controlTotals: ControlTotals = {
    activo: totalAssets,
    activoCorriente,
    activoNoCorriente,
    pasivo: totalLiabilities,
    pasivoCorriente,
    pasivoNoCorriente,
    patrimonio: totalEquity,
    ingresos: totalRevenue,
    gastos: gastosTotales,
    utilidadNeta: netIncome,
    efectivoCuenta11,
    deudoresCuenta13,
    cuentasPorPagar23,
    impuestosCuenta24,
    obligacionesLaborales25,
    cents,
    raw,
  };

  // -------------------------------------------------------------------------
  // 6. equityBreakdown
  // -------------------------------------------------------------------------
  const equityBreakdown = extractEquityBreakdownForView(view, discrepancies);

  // -------------------------------------------------------------------------
  // 7. Cross-checks (riesgo liquidez, ecuacion patrimonial, etc.)
  // -------------------------------------------------------------------------
  const LIQUIDEZ_TOL = Math.max(Math.abs(controlTotals.activo) * 0.01, 100_000);
  const liquidezGap = controlTotals.activoCorriente - controlTotals.pasivoCorriente;
  const hasLiquidezRisk =
    controlTotals.pasivoCorriente > 0 &&
    liquidezGap < 0 &&
    Math.abs(liquidezGap) > LIQUIDEZ_TOL;

  if (hasLiquidezRisk) {
    validationReasons.push(
      `[${period}] Riesgo de liquidez: Activo Corriente ($${formatCOP(controlTotals.activoCorriente)}) ` +
        `< Pasivo Corriente ($${formatCOP(controlTotals.pasivoCorriente)}). ` +
        `Brecha: $${formatCOP(Math.abs(liquidezGap))}.`,
    );
    suggestedAccounts.push(
      '11 — Efectivo y equivalentes (revisar saldos depurados)',
      '13 — Deudores comerciales (revisar rotacion de cartera)',
      '21 — Obligaciones financieras CP (revisar refinanciacion)',
      '23 — Cuentas por pagar (revisar plazos con proveedores)',
      '24 — Impuestos por pagar (DIAN — revisar calendario y acuerdos de pago)',
      '25 — Obligaciones laborales (revisar exigibilidad inmediata)',
    );
    discrepancies.push({
      location: `Riesgo de Liquidez (Big Four) [${period}]`,
      reported: controlTotals.pasivoCorriente,
      calculated: controlTotals.activoCorriente,
      difference: liquidezGap,
      description:
        `AC ($${formatCOP(controlTotals.activoCorriente)}) < PC ` +
        `($${formatCOP(controlTotals.pasivoCorriente)}).`,
    });
  }

  const ECUACION_TOL = 1000;
  const BLOCKING_TOL = Math.max(Math.abs(controlTotals.activo) * 0.01, 100_000);
  const equationDiff = controlTotals.activo - (controlTotals.pasivo + controlTotals.patrimonio);

  if (Math.abs(equationDiff) > ECUACION_TOL) {
    discrepancies.push({
      location: `Ecuacion Patrimonial [${period}]`,
      reported: controlTotals.pasivo + controlTotals.patrimonio,
      calculated: controlTotals.activo,
      difference: equationDiff,
      description: `[${period}] Ecuacion patrimonial descuadrada: Activo $${formatCOP(controlTotals.activo)} != Pasivo $${formatCOP(controlTotals.pasivo)} + Patrimonio $${formatCOP(controlTotals.patrimonio)} (diferencia $${formatCOP(equationDiff)})`,
    });

    if (Math.abs(equationDiff) > BLOCKING_TOL) {
      validationReasons.push(
        `[${period}] La ecuacion contable no cuadra: Activo (${formatCOP(controlTotals.activo)}) ` +
          `!= Pasivo (${formatCOP(controlTotals.pasivo)}) + Patrimonio (${formatCOP(controlTotals.patrimonio)}). ` +
          `Diferencia: ${formatCOP(equationDiff)}.`,
      );

      if (netIncome !== 0 && Math.abs(equationDiff - netIncome) < BLOCKING_TOL * 0.5) {
        validationReasons.push(
          `[${period}] El descuadre coincide aproximadamente con la utilidad del ejercicio. ` +
            `Posiblemente el balance fue exportado antes del cierre (3605 sin trasladar).`,
        );
        suggestedAccounts.push('3605 — Utilidad del ejercicio (Clase 3)');
      }

      if (Math.abs(controlTotals.patrimonio) < Math.abs(controlTotals.activo) * 0.01) {
        validationReasons.push(
          `[${period}] Total Patrimonio (${formatCOP(controlTotals.patrimonio)}) < 1% del Activo. ` +
            `Revisa si faltan cuentas 31xx/33xx/37xx.`,
        );
        suggestedAccounts.push(
          '3105 — Capital autorizado',
          '3115 — Capital suscrito y pagado',
          '3305 — Reserva legal',
          '3705 — Utilidades acumuladas',
        );
      }
    }
  } else if (!equationBalanced) {
    discrepancies.push({
      location: `Ecuacion Patrimonial (tolerancia fina) [${period}]`,
      reported: 0,
      calculated: equationBalance,
      difference: equationBalance,
      description: `[${period}] Activo - Pasivo - Patrimonio = $${formatCOP(equationBalance)} (posible redondeo).`,
    });
  }

  const UTIL_TOL = 1000;
  if (equityBreakdown.utilidadEjercicio !== undefined) {
    const diffUtil = controlTotals.utilidadNeta - equityBreakdown.utilidadEjercicio;
    if (Math.abs(diffUtil) > UTIL_TOL) {
      discrepancies.push({
        location: `Consistencia Utilidad [${period}]`,
        reported: equityBreakdown.utilidadEjercicio,
        calculated: controlTotals.utilidadNeta,
        difference: diffUtil,
        description: `[${period}] Utilidad neta P&L $${formatCOP(controlTotals.utilidadNeta)} difiere de Utilidad del ejercicio en patrimonio $${formatCOP(equityBreakdown.utilidadEjercicio)}.`,
      });
    }
  }

  for (let c = 1; c <= 6; c++) {
    const classData = classMap.get(c);
    const classTotal = getClassTotal(c);
    const hasClassRows = view.some((r) => r.code.startsWith(String(c)));
    if (classTotal === 0 && hasClassRows && classData && classData.leaves.length === 0) {
      discrepancies.push({
        location: `Clase ${c} (${PUC_CLASS_NAMES[c]}) [${period}]`,
        reported: 0,
        calculated: 0,
        difference: 0,
        description: `[${period}] Total de Clase ${c} es $0 pero existen filas con codigo ${c}xxx. Posible fallo de parseo.`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 8. missingExpectedAccounts
  // -------------------------------------------------------------------------
  const missingExpectedAccounts = buildMissingAccountsForView(view, leafRows, classes);

  const summary = {
    totalAssets,
    totalLiabilities,
    totalEquity,
    totalRevenue,
    totalExpenses,
    totalCosts,
    totalProduction,
    netIncome,
    equationBalance,
    equationBalanced,
  };

  const validation: ValidationResult = {
    blocking: validationReasons.length > 0,
    reasons: validationReasons,
    suggestedAccounts: Array.from(new Set(suggestedAccounts)),
    adjustments,
  };

  return {
    period,
    classes,
    controlTotals,
    equityBreakdown,
    summary,
    validation,
    discrepancies,
    missingExpectedAccounts,
    findings: {},
  };
}

// ---------------------------------------------------------------------------
// equityBreakdown helpers (refactor: trabajan sobre la "vista" de un periodo)
// ---------------------------------------------------------------------------

interface ViewRow {
  code: string;
  name: string;
  level: string;
  transactional: boolean;
  balance: number;
}

function extractEquityBreakdownForView(
  view: ViewRow[],
  discrepancies: Discrepancy[],
): EquityBreakdown {
  const breakdown: EquityBreakdown = {};

  const sumPreferring = (
    prefix: string,
    preferredLevel: 'Cuenta' | 'Subcuenta',
    label: string,
  ): number | undefined => {
    const preferred = view.find((r) => r.code === prefix && r.level === preferredLevel);
    const descendants = view.filter(
      (r) => r.code !== prefix && r.code.startsWith(prefix) && r.balance !== 0,
    );

    if (preferred && preferred.balance !== 0) {
      if (descendants.length > 0) {
        const descSum = descendants
          .filter((r) => r.level === 'Auxiliar' || r.level === 'Subcuenta')
          .reduce((s, r) => s + r.balance, 0);
        if (descSum !== 0 && Math.abs(descSum - preferred.balance) > 1) {
          discrepancies.push({
            location: `Patrimonio ${prefix} ${label}`,
            reported: preferred.balance,
            calculated: descSum,
            difference: descSum - preferred.balance,
            description: `Saldo agregado (${prefix}) $${formatCOP(preferred.balance)} difiere de la suma de descendientes $${formatCOP(descSum)}. Se prefiere nivel agregado.`,
          });
        }
      }
      return preferred.balance;
    }

    const descSum = descendants
      .filter((r) => r.level === 'Auxiliar' || r.level === 'Subcuenta' || r.transactional)
      .reduce((s, r) => s + r.balance, 0);
    return descSum !== 0 ? descSum : undefined;
  };

  const v3105 = sumPreferring('3105', 'Cuenta', 'Capital autorizado');
  if (v3105 !== undefined) breakdown.capitalAutorizado = v3105;

  const v3115 = sumPreferring('3115', 'Cuenta', 'Capital suscrito y pagado');
  const v3120 = sumPreferring('3120', 'Cuenta', 'Aporte de socios');
  const capSuscrito = (v3115 ?? 0) + (v3120 ?? 0);
  if (v3115 !== undefined || v3120 !== undefined) breakdown.capitalSuscritoPagado = capSuscrito;

  const v3305 = sumPreferring('3305', 'Cuenta', 'Reserva legal');
  if (v3305 !== undefined) breakdown.reservaLegal = v3305;

  let otrasReservasTotal = 0;
  let otrasReservasFound = false;
  const cuentasGrupo33 = view.filter(
    (r) => r.level === 'Cuenta' && r.code.startsWith('33') && r.code !== '3305' && r.balance !== 0,
  );
  if (cuentasGrupo33.length > 0) {
    otrasReservasTotal = cuentasGrupo33.reduce((s, r) => s + r.balance, 0);
    otrasReservasFound = true;
  } else {
    const hojas33 = view.filter(
      (r) =>
        (r.level === 'Auxiliar' || r.level === 'Subcuenta' || r.transactional) &&
        r.code.startsWith('33') &&
        !r.code.startsWith('3305') &&
        r.balance !== 0,
    );
    if (hojas33.length > 0) {
      otrasReservasTotal = hojas33.reduce((s, r) => s + r.balance, 0);
      otrasReservasFound = true;
    }
  }
  if (otrasReservasFound) breakdown.otrasReservas = otrasReservasTotal;

  const v3605 = sumPreferring('3605', 'Cuenta', 'Utilidad del ejercicio');
  if (v3605 !== undefined) breakdown.utilidadEjercicio = v3605;

  const v3610 = sumPreferring('3610', 'Cuenta', 'Utilidades acumuladas');
  const v3705 = sumPreferring('3705', 'Cuenta', 'Utilidad ejercicios anteriores');
  const v3710 = sumPreferring('3710', 'Cuenta', 'Perdida ejercicios anteriores');
  if (v3610 !== undefined || v3705 !== undefined || v3710 !== undefined) {
    breakdown.utilidadesAcumuladas = (v3610 ?? 0) + (v3705 ?? 0) + (v3710 ?? 0);
  }

  return breakdown;
}

/**
 * @deprecated Wrapper para retrocompatibilidad. Usa
 * `extractEquityBreakdownForView` internamente. Espera filas con `.balance`.
 */
export function extractEquityBreakdown(
  rows: { code: string; name: string; level: string; transactional?: boolean; balance: number }[],
  discrepancies: Discrepancy[],
): EquityBreakdown {
  const view: ViewRow[] = rows.map((r) => ({
    code: r.code,
    name: r.name,
    level: r.level,
    transactional: !!r.transactional,
    balance: r.balance,
  }));
  return extractEquityBreakdownForView(view, discrepancies);
}

// ---------------------------------------------------------------------------
// extractCompanyMetadata — Pulido NIIF PYME Grupo 2
// ---------------------------------------------------------------------------
// Extrae razón social y NIT de los encabezados del balance de prueba (filas
// previas a la cabecera de columnas en el Excel/CSV).
//
// Reglas:
//   1. NIT: cualquier secuencia "NIT" + separadores + 8-10 dígitos. El último
//      dígito posterior a un guión o punto se interpreta como DV.
//   2. Razón social: línea que matchee "Razón Social" / "RAZON SOCIAL" /
//      "Empresa" / "Compañía" / "Nombre" o el texto inmediatamente posterior
//      a NIT en archivos que ponen NIT primero, sin labels (heurística).
//   3. Si no se detecta NIT o razón social en el texto, se devuelve `null`
//      en cada campo respectivo. NUNCA un fallback / placeholder.
//
// La función NO valida el DV — la verificación DV vive en
// `src/lib/validation/nit-validator.ts` y la corre el gate
// `auditReportEmittable` (V6).
// ---------------------------------------------------------------------------

const NIT_REGEX = /\bNIT[\.: \t-]*([0-9](?:[0-9.,\s]*[0-9])?)\s*[-.]\s*(\d)\b/i;
const NIT_FALLBACK_REGEX = /\bNIT[\.: \t-]*([0-9][0-9.,\s]{6,14}[0-9])\b/i;
/**
 * Línea que empieza con un patrón "NNNNNNNNN-D" (NIT canónico) sin label
 * "NIT". Típico cuando el balance Excel pone el NIT en una fila propia
 * separada del label. Acepta puntos miles opcionales.
 */
const NIT_BARE_LINE_REGEX =
  /^\s*([0-9][0-9.]{6,14}[0-9])\s*-\s*(\d)\s*(?:,|$)/;
const RAZON_SOCIAL_REGEX =
  /(?:raz[oó]n\s+social|empresa|compa[ñn][ií]a|nombre)\s*[:.\t-]+\s*([^\n,;|]+)/i;

export function extractCompanyMetadata(rawText: string): ExtractedCompanyMetadata {
  const result: ExtractedCompanyMetadata = {
    razonSocialFromFile: null,
    nitFromFile: null,
    nitBodyDigits: null,
    nitCheckDigit: null,
    sourceLines: [],
  };

  if (!rawText || typeof rawText !== 'string') return result;

  // Sólo escaneamos las primeras 50 líneas no vacías — el header del balance
  // de prueba siempre vive en las primeras filas.
  const allLines = rawText.split(/\r?\n/);
  const headerLines = allLines
    .slice(0, 100)
    .filter((l) => l.trim().length > 0)
    .slice(0, 50);

  // Buscar NIT con DV (formato preferido).
  for (const line of headerLines) {
    const m = line.match(NIT_REGEX);
    if (m) {
      const body = m[1].replace(/[\s.,]/g, '');
      const dv = m[2].trim();
      if (body.length >= 6 && body.length <= 12 && /^\d+$/.test(body) && /^\d$/.test(dv)) {
        result.nitBodyDigits = body;
        result.nitCheckDigit = dv;
        result.nitFromFile = `${formatNitWithDots(body)}-${dv}`;
        result.sourceLines.push(line.trim());
        break;
      }
    }
  }

  // Fallback adicional: NIT en línea propia sin label "NIT" (típico
  // cuando el Excel separa el NIT en una fila dedicada).
  if (!result.nitFromFile) {
    for (const line of headerLines) {
      const m = line.match(NIT_BARE_LINE_REGEX);
      if (m) {
        const body = m[1].replace(/[\s.,]/g, '');
        const dv = m[2].trim();
        if (body.length >= 6 && body.length <= 12 && /^\d+$/.test(body) && /^\d$/.test(dv)) {
          result.nitBodyDigits = body;
          result.nitCheckDigit = dv;
          result.nitFromFile = `${formatNitWithDots(body)}-${dv}`;
          result.sourceLines.push(line.trim());
          break;
        }
      }
    }
  }

  // Fallback: NIT sin DV explícito (sólo dígitos consecutivos).
  if (!result.nitFromFile) {
    for (const line of headerLines) {
      const m = line.match(NIT_FALLBACK_REGEX);
      if (m) {
        const digits = m[1].replace(/[\s.,]/g, '');
        if (digits.length >= 8 && digits.length <= 11 && /^\d+$/.test(digits)) {
          // Asumimos que el último dígito es DV si la longitud es típica
          // (9-11 dígitos sugiere body+DV).
          if (digits.length >= 9) {
            result.nitBodyDigits = digits.slice(0, -1);
            result.nitCheckDigit = digits.slice(-1);
            result.nitFromFile = `${formatNitWithDots(result.nitBodyDigits)}-${result.nitCheckDigit}`;
          } else {
            result.nitBodyDigits = digits;
            result.nitCheckDigit = null;
            result.nitFromFile = formatNitWithDots(digits);
          }
          result.sourceLines.push(line.trim());
          break;
        }
      }
    }
  }

  // Razón social explícita por label.
  for (const line of headerLines) {
    const m = line.match(RAZON_SOCIAL_REGEX);
    if (m) {
      const candidate = sanitizeRazonSocial(m[1]);
      if (candidate.length >= 3) {
        result.razonSocialFromFile = candidate;
        result.sourceLines.push(line.trim());
        break;
      }
    }
  }

  // Heurística adicional: si encontramos NIT pero no razón social, buscar
  // una línea adyacente (anterior o siguiente) que parezca contener el
  // nombre de la empresa (todo en MAYÚSCULAS, sin código de cuenta, sin
  // labels conocidos, con sufijo societario tipo SAS / S.A. / LTDA / E.U.).
  if (result.nitFromFile && !result.razonSocialFromFile) {
    const SOCIETARIO_REGEX = /\b(S\.?A\.?S\.?|S\.?A\.?|LTDA\.?|E\.?U\.?|S\.?C\.?S\.?)\b/i;
    for (const line of headerLines) {
      const trimmed = line.trim();
      // Tope generoso: archivos exportados con Excel pueden repetir el mismo
      // valor 6+ veces a lo largo de las columnas (celda fusionada → CSV
      // produce "Empresa,Empresa,Empresa,...,Empresa"). El sanitize posterior
      // corta en la primera coma, así que importa cubrir la longitud cruda.
      if (trimmed.length < 5 || trimmed.length > 500) continue;
      // Saltamos líneas con códigos PUC (números > 5 dígitos consecutivos).
      if (/\b\d{5,}\b/.test(trimmed)) continue;
      // Saltamos líneas con labels conocidos.
      if (/\b(NIT|raz[oó]n|empresa|compa[ñn][ií]a|nombre|fecha|periodo|cierre)\b/i.test(trimmed)) {
        // permitido si la línea contiene además sufijo societario
        if (!SOCIETARIO_REGEX.test(trimmed)) continue;
      }
      if (SOCIETARIO_REGEX.test(trimmed)) {
        const candidate = sanitizeRazonSocial(trimmed);
        if (candidate.length >= 5) {
          result.razonSocialFromFile = candidate;
          result.sourceLines.push(trimmed);
          break;
        }
      }
    }
  }

  return result;
}

function formatNitWithDots(body: string): string {
  // 9 dígitos → "NNN.NNN.NNN"; ajustar para casos cortos preservando agrupación de 3.
  const reversed = body.split('').reverse().join('');
  const grouped = reversed.match(/.{1,3}/g) ?? [];
  return grouped.map((g) => g.split('').reverse().join('')).reverse().join('.');
}

function sanitizeRazonSocial(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[,;|].*$/, '')
    .trim();
}

/**
 * Convierte un monto en pesos colombianos a BigInt centavos.
 * `Math.round(value * 100)` corrige el floating-point drift al redondear al
 * centavo más cercano. Para enteros (típico en balances PUC sin decimales),
 * el resultado es exacto.
 */
function toCents(value: number): bigint {
  if (!Number.isFinite(value)) return BigInt(0);
  // Math.round corrige drift floating-point al redondear al centavo.
  return BigInt(Math.round(value * 100));
}

/**
 * Convierte el monto a string canónico con dos decimales y punto decimal
 * (formato "1968104173.17"). Usado como evidencia de auditoría del parser.
 */
function toRawString(value: number): string {
  if (!Number.isFinite(value)) return '0.00';
  // Math.round preserva el centavo entero antes de toFixed para evitar
  // drift en valores como 1234.005 → 1234.01 en lugar de 1234.00.
  const cents = Math.round(value * 100);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const integer = Math.floor(abs / 100);
  const fraction = (abs % 100).toString().padStart(2, '0');
  return `${sign}${integer}.${fraction}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseLine(line: string, separator: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === separator && !inQuotes) {
      result.push(current);
      current = '';
    } else current += ch;
  }
  result.push(current);
  return result;
}

/**
 * parseNumber — robusto contra formatos diversos de ERP colombianos.
 */
export function parseNumber(val: string | undefined): number {
  if (val === undefined || val === null) return NaN;
  let cleaned = String(val).trim();
  if (cleaned.length === 0) return NaN;

  cleaned = cleaned
    .replace(/\b(COP|USD|EUR)\b/gi, '')
    .replace(/[$€£'"\s]/g, '')
    .trim();
  if (cleaned.length === 0) return NaN;

  let isNegative = false;
  if (/^\(.*\)$/.test(cleaned)) {
    isNegative = true;
    cleaned = cleaned.slice(1, -1).trim();
  }

  if (cleaned.endsWith('-')) {
    isNegative = !isNegative;
    cleaned = cleaned.slice(0, -1).trim();
  }
  if (cleaned.startsWith('-')) {
    isNegative = !isNegative;
    cleaned = cleaned.slice(1).trim();
  }
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1).trim();

  if (cleaned.length === 0) return NaN;
  if (!/^[\d.,]+$/.test(cleaned)) return NaN;

  const hasDot = cleaned.includes('.');
  const hasComma = cleaned.includes(',');
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');

  let normalized: string;
  if (hasDot && hasComma) {
    if (lastComma > lastDot) normalized = cleaned.replace(/\./g, '').replace(',', '.');
    else normalized = cleaned.replace(/,/g, '');
  } else if (hasDot) {
    const digitsAfter = cleaned.length - lastDot - 1;
    const occurrences = (cleaned.match(/\./g) || []).length;
    if (occurrences === 1 && digitsAfter <= 2) normalized = cleaned;
    else normalized = cleaned.replace(/\./g, '');
  } else if (hasComma) {
    const digitsAfter = cleaned.length - lastComma - 1;
    const occurrences = (cleaned.match(/,/g) || []).length;
    if (occurrences === 1 && digitsAfter <= 2) normalized = cleaned.replace(',', '.');
    else normalized = cleaned.replace(/,/g, '');
  } else {
    normalized = cleaned;
  }

  const num = parseFloat(normalized);
  if (Number.isNaN(num)) return NaN;
  return isNegative ? -num : num;
}

function safeNumber(val: number): number {
  return Number.isNaN(val) ? 0 : val;
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = headers.findIndex((h) => h.includes(candidate));
    if (idx !== -1) return idx;
  }
  return -1;
}

function inferLevel(code: string): string {
  const len = code.length;
  if (len === 1) return 'Clase';
  if (len === 2 || len === 3) return 'Grupo';
  if (len === 4 || len === 5) return 'Cuenta';
  if (len === 6 || len === 7) return 'Subcuenta';
  return 'Auxiliar';
}

function normalizeLevel(level: string): string {
  const l = level.toLowerCase().trim();
  if (l.includes('clase') || l === 'class') return 'Clase';
  if (l.includes('grupo') || l === 'group') return 'Grupo';
  if (l.includes('sub')) return 'Subcuenta';
  if (l.includes('auxiliar') || l.includes('aux') || l.includes('detalle')) return 'Auxiliar';
  if (l.includes('cuenta') || l === 'account') return 'Cuenta';
  return level;
}

function findMissingAccountsForClass(
  allRows: ViewRow[],
  classCode: number,
  leafRows: ViewRow[],
): string {
  const classPrefix = String(classCode);
  const groupRows = allRows.filter(
    (r) => r.code.startsWith(classPrefix) && (r.level === 'Grupo' || r.level === 'Cuenta') && r.balance !== 0,
  );

  const missing: string[] = [];
  for (const group of groupRows) {
    const hasChildren = leafRows.some((l) => l.code.startsWith(group.code) && l.code !== group.code);
    if (!hasChildren && group.balance !== 0) {
      missing.push(`${group.code} ${group.name} ($${formatCOP(group.balance)})`);
    }
  }

  if (missing.length > 0) {
    return `Posibles cuentas omitidas de los auxiliares: ${missing.join(', ')}. PRIORIZAR la suma de auxiliares.`;
  }
  return '';
}

function buildMissingAccountsForView(
  view: ViewRow[],
  leafRows: ViewRow[],
  classes: PUCClass[],
): string[] {
  const out: string[] = [];

  const groupTotals = new Map<string, number>();
  for (const r of leafRows) {
    if (r.code.length >= 2) {
      const grp = r.code.slice(0, 2);
      groupTotals.set(grp, (groupTotals.get(grp) ?? 0) + r.balance);
    }
  }

  for (const [subCode, meta] of Object.entries(IMPORTANT_SUBCUENTAS)) {
    const parentTotal = groupTotals.get(meta.parentGroup) ?? 0;
    if (Math.abs(parentTotal) <= 1) continue;

    const hasHere = leafRows.some((l) => l.code === subCode);
    const hasBelow = leafRows.some((l) => l.code.startsWith(subCode) && l.code !== subCode);
    const rowAtSub = view.find((r) => r.code === subCode);
    const subBalance = rowAtSub?.balance ?? 0;

    if (!hasHere && !hasBelow) {
      out.push(
        `Subcuenta PUC esperada ausente: ${subCode} ${meta.name} (grupo ${meta.parentGroup} tiene saldo $${formatCOP(parentTotal)}).`,
      );
    } else if (hasHere && Math.abs(subBalance) < 1 && !hasBelow) {
      out.push(
        `Subcuenta PUC ${subCode} ${meta.name} presente pero con saldo $0 (grupo ${meta.parentGroup} = $${formatCOP(parentTotal)}).`,
      );
    }
  }

  for (const cl of classes) {
    const classPrefix = String(cl.code);
    const groupsAndAccounts = view.filter(
      (r) =>
        r.code.startsWith(classPrefix) &&
        (r.level === 'Grupo' || r.level === 'Cuenta') &&
        r.balance !== 0,
    );
    for (const g of groupsAndAccounts) {
      const hasLeafBelow = leafRows.some(
        (l) => l.code.startsWith(g.code) && l.code !== g.code,
      );
      if (!hasLeafBelow) {
        out.push(
          `${g.level} ${g.code} ${g.name} con saldo $${formatCOP(g.balance)} sin hojas debajo.`,
        );
      }
    }
  }

  return out;
}

function sumLeavesByGroupPrefixes(
  leafRows: ViewRow[],
  classDigit: string,
  groupSet: Set<string>,
): number {
  return leafRows.reduce((sum, r) => {
    if (!r.code.startsWith(classDigit)) return sum;
    const grp = r.code.length >= 2 ? r.code.slice(0, 2) : r.code;
    if (groupSet.has(grp)) return sum + r.balance;
    return sum;
  }, 0);
}

function formatCOP(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `-${formatted}` : formatted;
}

/**
 * Convierte un CuratorFinding en el shape `Discrepancy` que ya consume el
 * resto del pipeline. Los findings cualitativos del curator no llevan
 * montos numéricos en sí mismos (esos viven en sus subobjetos: reclassifications,
 * balanceGapAttribution, taxProvisionRisk), así que aquí solo proyectamos
 * la severidad + texto en `description`.
 */
function curatorFindingToDiscrepancy(
  f: CuratorFinding,
  snap: PeriodSnapshot,
): Discrepancy {
  const sev = f.severity.toUpperCase();
  return {
    location: `[CURATOR ${f.code} · ${sev}] ${f.title} [${snap.period}]`,
    reported: 0,
    calculated: 0,
    difference: 0,
    description: `${f.description} | Norma: ${f.normReference} | Recomendación: ${f.recommendation}`,
  };
}

/**
 * Ordena periodos ascendentemente. Periodos numericos (años) se ordenan
 * naturalmente; etiquetas no numericas (DEFAULT_PERIOD, etc.) van al final.
 */
function sortPeriodsAscending(periods: string[]): string[] {
  return [...periods].sort((a, b) => {
    const ay = /^20\d{2}$/.test(a) ? parseInt(a, 10) : null;
    const by = /^20\d{2}$/.test(b) ? parseInt(b, 10) : null;
    if (ay !== null && by !== null) return ay - by;
    if (ay !== null) return -1;
    if (by !== null) return 1;
    // Heuristica: "*_anterior" < "current"
    if (a.endsWith('_anterior') && !b.endsWith('_anterior')) return -1;
    if (b.endsWith('_anterior') && !a.endsWith('_anterior')) return 1;
    return a.localeCompare(b);
  });
}

// ---------------------------------------------------------------------------
// Reporting helpers (multi-period)
// ---------------------------------------------------------------------------

function buildCleanDataMultiPeriod(snapshots: PeriodSnapshot[]): string {
  const blocks: string[] = [];
  for (const snap of snapshots) {
    const lines: string[] = [];
    lines.push(`[period=${snap.period}]`);
    lines.push('codigo,nombre,nivel,saldo');
    for (const c of snap.classes) {
      for (const acc of c.accounts) {
        lines.push(`${acc.code},"${acc.name}",${acc.level},${acc.balance.toFixed(2)}`);
      }
    }
    lines.push(`[/period]`);
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

function buildMultiPeriodValidationReport(
  snapshots: PeriodSnapshot[],
  totalRowCount: number,
): string {
  const lines: string[] = [];
  lines.push('# INFORME DE VALIDACION ARITMETICA DEL BALANCE DE PRUEBA');
  lines.push('');
  lines.push(
    `**Periodos detectados:** ${snapshots.map((s) => s.period).join(', ')} | **Filas crudas:** ${totalRowCount}`,
  );
  lines.push('');

  for (const snap of snapshots) {
    lines.push(`## Periodo ${snap.period}`);
    lines.push('');
    lines.push('### Resumen por Clase PUC');
    lines.push('');
    lines.push('| Clase | Nombre | Total Hojas | Total Reportado | Discrepancia |');
    lines.push('|-------|--------|-------------|-----------------|--------------|');
    for (const c of snap.classes) {
      const reported = c.reportedTotal !== null ? `$${formatCOP(c.reportedTotal)}` : 'N/A';
      const disc = c.discrepancy > 1 ? `$${formatCOP(c.discrepancy)}` : 'OK';
      const flag = c.discrepancy > 1 ? ' !!' : '';
      lines.push(`| ${c.code} | ${c.name} | $${formatCOP(c.auxiliaryTotal)} | ${reported} | ${disc}${flag} |`);
    }
    lines.push('');
    lines.push('### Totales de Control');
    lines.push('');
    lines.push(`- **Activo Total:** $${formatCOP(snap.controlTotals.activo)} (corriente $${formatCOP(snap.controlTotals.activoCorriente)} + no corriente $${formatCOP(snap.controlTotals.activoNoCorriente)})`);
    lines.push(`- **Pasivo Total:** $${formatCOP(snap.controlTotals.pasivo)} (corriente $${formatCOP(snap.controlTotals.pasivoCorriente)} + no corriente $${formatCOP(snap.controlTotals.pasivoNoCorriente)})`);
    lines.push(`- **Patrimonio Total:** $${formatCOP(snap.controlTotals.patrimonio)}`);
    lines.push(`- **Ingresos:** $${formatCOP(snap.controlTotals.ingresos)}`);
    lines.push(`- **Gastos+Costos:** $${formatCOP(snap.controlTotals.gastos)}`);
    lines.push(`- **Utilidad Neta:** $${formatCOP(snap.controlTotals.utilidadNeta)}`);
    lines.push('');
    lines.push('### Ecuacion Patrimonial');
    lines.push('');
    lines.push(`- Activo - (Pasivo + Patrimonio) = $${formatCOP(snap.summary.equationBalance)}`);
    lines.push(`- Estado: **${snap.summary.equationBalanced ? 'CUADRA' : 'NO CUADRA'}**`);

    const eb = snap.equityBreakdown;
    if (Object.keys(eb).length > 0) {
      lines.push('');
      lines.push('### Desglose de Patrimonio');
      lines.push('');
      if (eb.capitalAutorizado !== undefined) lines.push(`- Capital autorizado (3105): $${formatCOP(eb.capitalAutorizado)}`);
      if (eb.capitalSuscritoPagado !== undefined) lines.push(`- Capital suscrito y pagado (3115+3120): $${formatCOP(eb.capitalSuscritoPagado)}`);
      if (eb.reservaLegal !== undefined) lines.push(`- Reserva legal (3305): $${formatCOP(eb.reservaLegal)}`);
      if (eb.otrasReservas !== undefined) lines.push(`- Otras reservas (3310-3395): $${formatCOP(eb.otrasReservas)}`);
      if (eb.utilidadEjercicio !== undefined) lines.push(`- Utilidad del ejercicio (3605): $${formatCOP(eb.utilidadEjercicio)}`);
      if (eb.utilidadesAcumuladas !== undefined) lines.push(`- Utilidades acumuladas (3610+3705+3710): $${formatCOP(eb.utilidadesAcumuladas)}`);
    }

    if (snap.discrepancies.length > 0) {
      lines.push('');
      lines.push('### Discrepancias Detectadas');
      lines.push('');
      for (const d of snap.discrepancies) {
        lines.push(`#### ${d.location}`);
        lines.push(`- Reportado: $${formatCOP(d.reported)}`);
        lines.push(`- Calculado: $${formatCOP(d.calculated)}`);
        lines.push(`- Diferencia: $${formatCOP(d.difference)}`);
        lines.push(`- Nota: ${d.description}`);
        lines.push('');
      }
    }

    if (snap.missingExpectedAccounts.length > 0) {
      lines.push('');
      lines.push('### Cuentas PUC Importantes Faltantes o Con Saldo 0');
      lines.push('');
      for (const m of snap.missingExpectedAccounts) lines.push(`- ${m}`);
    }

    if (snap.validation.adjustments.length > 0) {
      lines.push('');
      lines.push('### Ajustes Automaticos Aplicados');
      lines.push('');
      for (const a of snap.validation.adjustments) lines.push(`- ${a}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}
