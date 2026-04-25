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

export interface RawAccountRow {
  /** Account code (e.g. "110505", "1105", "1") */
  code: string;
  /** Account name */
  name: string;
  /** Account level: "Clase", "Grupo", "Cuenta", "Subcuenta", "Auxiliar" */
  level: string;
  /** Whether this is a transactional account */
  transactional: boolean;
  /** Debit balance */
  debit: number;
  /** Credit balance */
  credit: number;
  /** Final balance (debit - credit or as provided) */
  balance: number;
  /** Previous period balance (comparative) */
  previousBalance?: number;
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

export interface ValidatedAccount {
  code: string;
  name: string;
  level: string;
  balance: number;
  previousBalance?: number;
  /** Whether this is a leaf/transactional account used in summation */
  isLeaf: boolean;
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

/**
 * Totales de control — contrato numerico vinculante para los agentes.
 * Todos los campos son requeridos (0 si ausentes en la entrada).
 *
 * Los campos efectivoCuenta11..obligacionesLaborales25 son cuentas PUC
 * segregadas para alimentar la proyeccion de flujo de caja Big Four
 * (CFO + NIIF) en el Strategy Director (Paso 4). Se identifican por
 * prefijo numerico de 2 digitos (Grupo PUC).
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
  // (Paso 4: Proyeccion de Flujo de Caja con Working Capital y obligaciones
  // fiscales/laborales programadas en linea de tiempo real).
  // -----------------------------------------------------------------------
  /** PUC 11 — Efectivo y equivalentes (caja, bancos, ahorros, fiduciaria) */
  efectivoCuenta11: number;
  /** PUC 13 — Deudores comerciales y otros (cuentas por cobrar) */
  deudoresCuenta13: number;
  /** PUC 23 — Cuentas por pagar (proveedores, costos y gastos por pagar) */
  cuentasPorPagar23: number;
  /** PUC 24 — Impuestos, gravamenes y tasas por pagar (renta, IVA, ICA, ReteFuente) */
  impuestosCuenta24: number;
  /** PUC 25 — Obligaciones laborales (salarios, prestaciones, aportes) */
  obligacionesLaborales25: number;
}

/**
 * Resultado de la validacion aritmetica del balance de prueba.
 *
 * `blocking = true` indica que los numeros son inconsistentes al punto de no
 * poder generar un reporte confiable. El orchestrator financiero debe abortar
 * la Fase 1 y devolver `reasons` + `suggestedAccounts` al usuario para que
 * corrija el Excel antes de reintentar.
 *
 * `adjustments` documenta reparaciones aplicadas al vuelo (p.ej. reinyeccion
 * de la utilidad del ejercicio cuando el ERP esta antes del cierre). Son
 * informativas — el reporte se genera con los totales ya ajustados.
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

/**
 * Desglose del patrimonio (Clase 3). Todos los campos son opcionales:
 * solo se emiten si la cuenta/subcuenta existe en el balance.
 */
export interface EquityBreakdown {
  /** 3105 — Capital autorizado */
  capitalAutorizado?: number;
  /** 3115 + 3120 — Capital suscrito y pagado / Aporte de socios */
  capitalSuscritoPagado?: number;
  /** 3305 — Reserva legal */
  reservaLegal?: number;
  /** 3310-3395 — Otras reservas agregadas */
  otrasReservas?: number;
  /** 3605 — Utilidad del ejercicio */
  utilidadEjercicio?: number;
  /** 3610 + 3705 + 3710 — Utilidades acumuladas / resultados de ejercicios anteriores */
  utilidadesAcumuladas?: number;
}

export interface PreprocessedBalance {
  /** Fiscal period (if detected) */
  period: string | null;
  /** All PUC classes with validated totals */
  classes: PUCClass[];
  /**
   * Resumen agregado legacy (mantenido por compatibilidad con consumers
   * existentes: excel-export, api/financial-report, api/financial-report/export,
   * agents/financial/quality).
   */
  summary: {
    totalAssets: number;        // Clase 1
    totalLiabilities: number;   // Clase 2
    totalEquity: number;        // Clase 3
    totalRevenue: number;       // Clase 4
    totalExpenses: number;      // Clase 5
    totalCosts: number;         // Clase 6
    totalProduction: number;    // Clase 7
    netIncome: number;          // Revenue - Expenses - Costs
    equationBalance: number;    // Assets - Liabilities - Equity (should be ≈ 0)
    equationBalanced: boolean;
  };
  /**
   * Totales de control — contrato numerico nuevo, vinculante para agentes.
   * Ver ControlTotals.
   */
  controlTotals: ControlTotals;
  /** Desglose del patrimonio por sub-cuenta principal. */
  equityBreakdown: EquityBreakdown;
  /**
   * Validacion aritmetica del balance: si `validation.blocking === true`, el
   * orchestrator debe abortar la Fase 1 y pedirle al usuario corregir el
   * archivo en vez de generar un reporte mediocre.
   */
  validation: ValidationResult;
  /** Detected discrepancies (Discrepancy[] estructuradas). */
  discrepancies: Discrepancy[];
  /**
   * Cuentas PUC importantes faltantes o con saldo 0 inesperado.
   * Lista de mensajes legibles.
   */
  missingAccounts: string[];
  /** Number of auxiliary accounts processed */
  auxiliaryCount: number;
  /** Total accounts in the raw data */
  totalRowCount: number;
  /** Human-readable validation report (Markdown) */
  validationReport: string;
  /** Clean CSV-like text for the NIIF analyst agent */
  cleanData: string;
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
// Activo corriente (realizable en <= 12 meses):
//   11 Disponible, 12 Inversiones (corto plazo — la norma permite ajuste fino,
//   pero para efectos de sumario conservador se incluyen por defecto), 13
//   Deudores, 14 Inventarios, 15 seria Propiedades, planta y equipo — NO es
//   corriente; se excluye. Aqui usamos 11, 12, 13, 14.
// Activo NO corriente: 15 (PP&E), 16 Intangibles, 17 Diferidos, 18 Otros
//   activos, 19 Valorizaciones.
// Nota: la norma permite que inversiones de largo plazo vayan a 1205+ como
//   no corriente. Sin sub-clasificacion explicita preferimos conservador:
//   todo 12 queda en corriente. Si el input trae nivel suficiente, el agente
//   puede re-clasificar.
// ---------------------------------------------------------------------------
const ACTIVO_CORRIENTE_GROUPS = new Set(['11', '12', '13', '14']);
const ACTIVO_NO_CORRIENTE_GROUPS = new Set(['15', '16', '17', '18', '19']);

// Pasivo corriente (exigible en <= 12 meses):
//   21 Obligaciones financieras (corto plazo en teoria — aqui conservador,
//   todo 21 va a corriente salvo que venga sub-clasificado), 22 Proveedores,
//   23 Cuentas por pagar, 24 Impuestos, 25 Obligaciones laborales, 26
//   Pasivos estimados (corriente por defecto).
// Pasivo NO corriente: 27 Diferidos, 28 Otros pasivos, 29 Bonos y papeles
//   comerciales de largo plazo.
// ---------------------------------------------------------------------------
const PASIVO_CORRIENTE_GROUPS = new Set(['21', '22', '23', '24', '25', '26']);
const PASIVO_NO_CORRIENTE_GROUPS = new Set(['27', '28', '29']);

// ---------------------------------------------------------------------------
// Subcuentas importantes para findMissingAccounts (D6)
// ---------------------------------------------------------------------------
// Mapa: codigo subcuenta -> { nombre, grupo padre }
// Si el grupo padre tiene saldo > 0 y la subcuenta no aparece, se reporta.
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
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse raw CSV text into account rows.
 * Handles various CSV formats from Colombian ERPs (Siigo, World Office, Helisa, etc.).
 */
export function parseTrialBalanceCSV(csvText: string): RawAccountRow[] {
  const lines = csvText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  // Detect separator (comma, semicolon, tab)
  const firstLine = lines[0];
  const separator = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';

  // Parse header to find column indices
  const headers = parseLine(firstLine, separator).map((h) => h.toLowerCase().trim());

  const codeIdx = findColumnIndex(headers, ['codigo', 'code', 'cuenta', 'account', 'cta', 'cod']);
  const nameIdx = findColumnIndex(headers, ['nombre', 'name', 'descripcion', 'description', 'concepto']);
  const levelIdx = findColumnIndex(headers, ['nivel', 'level', 'tipo', 'type', 'naturaleza']);
  const transIdx = findColumnIndex(headers, ['transaccional', 'transactional', 'auxiliar', 'movimiento']);
  const debitIdx = findColumnIndex(headers, ['debito', 'debit', 'debitos', 'debe', 'db']);
  const creditIdx = findColumnIndex(headers, ['credito', 'credit', 'creditos', 'haber', 'cr']);
  const balanceIdx = findColumnIndex(headers, ['saldo', 'balance', 'saldo_final', 'neto', 'saldo final']);
  const prevBalIdx = findColumnIndex(headers, ['saldo_anterior', 'anterior', 'previous', 'saldo anterior', 'comparativo']);

  if (codeIdx === -1) return [];

  const rows: RawAccountRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i], separator);
    const rawCode = (cols[codeIdx] || '').trim().replace(/['"]/g, '');
    // Normalizacion PUC: algunos ERPs exportan codigos con puntos/guiones
    // (p.ej. "1.1.05.01" o "11-05-01"). Los agrupamos a digitos contiguos
    // para que inferLevel pueda decidir el nivel correctamente. Si el codigo
    // queda vacio o no empieza por digito, saltamos la fila.
    const code = rawCode.replace(/[.\-\s]/g, '');
    if (!code || !/^\d/.test(code)) continue; // skip non-account rows

    const debit = safeNumber(parseNumber(cols[debitIdx]));
    const credit = safeNumber(parseNumber(cols[creditIdx]));
    const rawBalance = balanceIdx !== -1 ? parseNumber(cols[balanceIdx]) : NaN;
    const hasRawBalance = !Number.isNaN(rawBalance);

    // Determine level
    let level = levelIdx !== -1 ? (cols[levelIdx] || '').trim() : inferLevel(code);
    level = normalizeLevel(level);

    // Determine transactional flag
    let transactional = false;
    if (transIdx !== -1) {
      const val = (cols[transIdx] || '').trim().toLowerCase();
      transactional = val === 'si' || val === 'sí' || val === 'yes' || val === '1' || val === 'true';
    } else {
      transactional = level === 'Auxiliar';
    }

    // Calculate balance: use provided balance, or debit - credit for asset/expense classes
    const classCode = parseInt(code[0], 10);
    let balance: number;
    if (hasRawBalance) {
      balance = rawBalance;
    } else {
      // Classes 1, 5, 6, 7 are debit-nature; classes 2, 3, 4 are credit-nature
      if ([1, 5, 6, 7].includes(classCode)) {
        balance = debit - credit;
      } else {
        balance = credit - debit;
      }
    }

    rows.push({
      code,
      name: (cols[nameIdx] || '').trim().replace(/['"]/g, ''),
      level,
      transactional,
      debit,
      credit,
      balance,
      previousBalance: prevBalIdx !== -1 ? safeNumberOrUndefined(parseNumber(cols[prevBalIdx])) : undefined,
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Validation & Structuring
// ---------------------------------------------------------------------------

/**
 * Process parsed account rows into a validated, structured balance.
 */
export function preprocessTrialBalance(rows: RawAccountRow[]): PreprocessedBalance {
  // -------------------------------------------------------------------------
  // 1. Calcular el conjunto de "leaf rows" (hojas) — la base de toda suma.
  // Regla:
  //   (a) Auxiliar (8+ digitos o flag transactional=true) siempre cuenta.
  //   (b) Subcuenta (6 digitos) cuenta SI no existe ningun Auxiliar con codigo
  //       que empiece por el codigo de esta Subcuenta. Esto captura
  //       Subcuentas exportadas sin detalle — caso clasico: 1120 Ahorros
  //       solo a nivel Subcuenta, sin 8 digitos debajo.
  //   (c) Si para un mismo prefijo PUC coexisten Subcuenta y Auxiliar,
  //       preferimos Auxiliar (es el nivel mas detallado y la regla clasica
  //       del parser previo).
  // -------------------------------------------------------------------------
  const auxiliarRows = rows.filter((r) => r.transactional || r.level === 'Auxiliar');
  const subcuentaRows = rows.filter((r) => r.level === 'Subcuenta');

  // Para cada Subcuenta, verificar si tiene descendencia entre auxiliares.
  const orphanSubcuentas: RawAccountRow[] = [];
  for (const sub of subcuentaRows) {
    const hasAuxiliarDescendant = auxiliarRows.some(
      (aux) => aux.code !== sub.code && aux.code.startsWith(sub.code),
    );
    if (!hasAuxiliarDescendant) {
      orphanSubcuentas.push(sub);
    }
  }

  // Evitar dobles conteos: si un codigo aparece en ambos grupos, auxiliar gana.
  const auxiliarCodes = new Set(auxiliarRows.map((r) => r.code));
  const leafRows: RawAccountRow[] = [
    ...auxiliarRows,
    ...orphanSubcuentas.filter((r) => !auxiliarCodes.has(r.code)),
  ];

  const classRows = rows.filter((r) => r.level === 'Clase');

  // -------------------------------------------------------------------------
  // 2. Agrupar leafs por clase PUC (1..7)
  // -------------------------------------------------------------------------
  const classMap = new Map<number, { leaves: RawAccountRow[]; reportedRow: RawAccountRow | null }>();
  for (let c = 1; c <= 7; c++) {
    classMap.set(c, { leaves: [], reportedRow: null });
  }

  for (const row of leafRows) {
    const classCode = parseInt(row.code[0], 10);
    if (classCode >= 1 && classCode <= 7) {
      classMap.get(classCode)!.leaves.push(row);
    }
  }

  for (const row of classRows) {
    const classCode = parseInt(row.code[0], 10);
    if (classMap.has(classCode)) {
      classMap.get(classCode)!.reportedRow = row;
    }
  }

  // -------------------------------------------------------------------------
  // 3. Construir clases validadas + detectar discrepancias por clase
  // -------------------------------------------------------------------------
  const classes: PUCClass[] = [];
  const discrepancies: Discrepancy[] = [];

  for (const [classCode, data] of classMap) {
    const auxiliaryTotal = data.leaves.reduce((sum, r) => sum + r.balance, 0);
    const reportedTotal = data.reportedRow ? data.reportedRow.balance : null;
    const discrepancy = reportedTotal !== null ? Math.abs(auxiliaryTotal - reportedTotal) : 0;

    // Report discrepancy if > $1 (floating point tolerance)
    if (reportedTotal !== null && discrepancy > 1) {
      const missingDesc = findMissingAccountsForClass(rows, classCode, data.leaves);
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
      previousBalance: r.previousBalance,
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
  // 4. Calcular summary legacy
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
  // 4.1. Auto-reparacion: reinyeccion de utilidad del ejercicio en patrimonio
  // -------------------------------------------------------------------------
  // Caso comun: un ERP colombiano que exporta el balance ANTES del cierre del
  // ejercicio deja Clase 3 solo con capital + reservas + resultados anteriores.
  // La utilidad del ejercicio vive en Clase 4/5/6/7 (P&L) y aun no fue
  // trasladada a 3605. El resultado: Activo != Pasivo + Patrimonio por una
  // cantidad aprox = netIncome.
  //
  // Si detectamos ese patron, reinyectamos la utilidad al patrimonio para que
  // el balance cuadre y el reporte sea correcto. Documentamos el ajuste en
  // validation.adjustments para que el agente NIIF lo cite en notas.
  // -------------------------------------------------------------------------
  const adjustments: string[] = [];
  const validationReasons: string[] = [];
  const suggestedAccounts: string[] = [];
  let totalEquity = totalEquityRaw;

  const shortfallBeforeReinject = totalAssets - totalLiabilities - totalEquity;
  const RECONCILE_TOL = Math.max(Math.abs(totalAssets) * 0.001, 1000); // 0.1% del activo o $1K

  if (
    netIncome !== 0 &&
    Math.abs(shortfallBeforeReinject - netIncome) < RECONCILE_TOL &&
    Math.abs(shortfallBeforeReinject) > RECONCILE_TOL
  ) {
    totalEquity = totalEquityRaw + netIncome;
    adjustments.push(
      `Se reinyecto la utilidad del ejercicio (${formatCOP(netIncome)} COP) al ` +
        `Total Patrimonio. El balance exportado parece estar ANTES del cierre ` +
        `contable: Clase 3 solo incluia capital, reservas y resultados anteriores ` +
        `(${formatCOP(totalEquityRaw)} COP). Tras el traslado a 3605, la ecuacion ` +
        `patrimonial cuadra.`,
    );
  }

  // -------------------------------------------------------------------------
  // 5. Calcular controlTotals (contrato nuevo D4)
  // -------------------------------------------------------------------------
  const activoCorriente = sumLeavesByGroupPrefixes(leafRows, '1', ACTIVO_CORRIENTE_GROUPS);
  const activoNoCorriente = sumLeavesByGroupPrefixes(leafRows, '1', ACTIVO_NO_CORRIENTE_GROUPS);
  const pasivoCorriente = sumLeavesByGroupPrefixes(leafRows, '2', PASIVO_CORRIENTE_GROUPS);
  const pasivoNoCorriente = sumLeavesByGroupPrefixes(leafRows, '2', PASIVO_NO_CORRIENTE_GROUPS);

  // -------------------------------------------------------------------------
  // 5.1 Segregacion Big Four — cuentas PUC clave para flujo de caja proyectado
  // -------------------------------------------------------------------------
  // El Strategy Director (Paso 4) ya no asume que ingresos = caja. Necesita:
  //   - PUC 11: efectivo real (saldo inicial depurado, sin deudores ni inv.)
  //   - PUC 13: deudores -> aplicar DSO para Year 1 cash inflow
  //   - PUC 23: cuentas por pagar -> salida obligatoria H1 Year 1
  //   - PUC 24: impuestos por pagar -> salida inmediata Year 1 (Q1)
  //   - PUC 25: obligaciones laborales -> salida obligatoria H1 Year 1
  // -------------------------------------------------------------------------
  const efectivoCuenta11 = sumLeavesByGroupPrefixes(leafRows, '1', new Set(['11']));
  const deudoresCuenta13 = sumLeavesByGroupPrefixes(leafRows, '1', new Set(['13']));
  const cuentasPorPagar23 = sumLeavesByGroupPrefixes(leafRows, '2', new Set(['23']));
  const impuestosCuenta24 = sumLeavesByGroupPrefixes(leafRows, '2', new Set(['24']));
  const obligacionesLaborales25 = sumLeavesByGroupPrefixes(leafRows, '2', new Set(['25']));

  const equationBalance = totalAssets - totalLiabilities - totalEquity;
  const equationBalanced = Math.abs(equationBalance) < 100;

  const controlTotals: ControlTotals = {
    activo: totalAssets,
    activoCorriente,
    activoNoCorriente,
    pasivo: totalLiabilities,
    pasivoCorriente,
    pasivoNoCorriente,
    patrimonio: totalEquity,
    ingresos: totalRevenue,
    // Contrato: gastos = Clase 5 + Clase 6 (costos). Clase 7 (costos de
    // produccion) se suma tambien aqui porque representa costo imputable
    // al estado de resultados.
    gastos: totalExpenses + totalCosts + totalProduction,
    utilidadNeta: netIncome,
    // Big Four Cash Flow — cuentas PUC segregadas
    efectivoCuenta11,
    deudoresCuenta13,
    cuentasPorPagar23,
    impuestosCuenta24,
    obligacionesLaborales25,
  };

  // -------------------------------------------------------------------------
  // 6. Calcular equityBreakdown (D3)
  // -------------------------------------------------------------------------
  const equityBreakdown = extractEquityBreakdown(rows, discrepancies);

  // -------------------------------------------------------------------------
  // 7. Checks cruzados (D5): ecuacion patrimonial, consistencia utilidad,
  //    totales en 0 con filas existentes, riesgo de liquidez Big Four
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // 7.0 GATE BIG FOUR — Riesgo de Liquidez (AC < PC)
  // -------------------------------------------------------------------------
  // El Prompt Maestro Big Four exige: si Activo Corriente < Pasivo Corriente,
  // detener la proyeccion antes de gastar tokens. La empresa esta en riesgo
  // de iliquidez tecnica y proyectar flujo sin resolverlo es irresponsable.
  // Tolerancia: 1% del activo total o $100K (lo mayor) para evitar falsos
  // positivos por redondeo en balances de tamano modesto.
  // -------------------------------------------------------------------------
  const LIQUIDEZ_TOL = Math.max(Math.abs(controlTotals.activo) * 0.01, 100_000);
  const liquidezGap = controlTotals.activoCorriente - controlTotals.pasivoCorriente;
  const hasLiquidezRisk =
    controlTotals.pasivoCorriente > 0 &&
    liquidezGap < 0 &&
    Math.abs(liquidezGap) > LIQUIDEZ_TOL;

  if (hasLiquidezRisk) {
    validationReasons.push(
      `Riesgo de liquidez detectado: Activo Corriente ($${formatCOP(controlTotals.activoCorriente)}) ` +
        `< Pasivo Corriente ($${formatCOP(controlTotals.pasivoCorriente)}). ` +
        `Brecha: $${formatCOP(Math.abs(liquidezGap))}. ` +
        `Analisis Big Four exige detener proyeccion hasta evaluar este riesgo.`,
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
      location: 'Riesgo de Liquidez (Big Four)',
      reported: controlTotals.pasivoCorriente,
      calculated: controlTotals.activoCorriente,
      difference: liquidezGap,
      description:
        `AC ($${formatCOP(controlTotals.activoCorriente)}) < PC ` +
        `($${formatCOP(controlTotals.pasivoCorriente)}). El Strategy Director NO debe ` +
        `proyectar flujo de caja hasta que se evalue el riesgo de liquidez.`,
    });
  }

  const ECUACION_TOL = 1000; // COP
  // Tolerancia critica para bloqueo: 1% del activo o $100K (lo mayor). Por
  // encima de esto los numeros no son defendibles y preferimos abortar.
  const BLOCKING_TOL = Math.max(Math.abs(controlTotals.activo) * 0.01, 100_000);
  const equationDiff = controlTotals.activo - (controlTotals.pasivo + controlTotals.patrimonio);

  if (Math.abs(equationDiff) > ECUACION_TOL) {
    discrepancies.push({
      location: 'Ecuacion Patrimonial',
      reported: controlTotals.pasivo + controlTotals.patrimonio,
      calculated: controlTotals.activo,
      difference: equationDiff,
      description: `Ecuacion patrimonial descuadrada: Activo $${formatCOP(controlTotals.activo)} != Pasivo $${formatCOP(controlTotals.pasivo)} + Patrimonio $${formatCOP(controlTotals.patrimonio)} (diferencia $${formatCOP(equationDiff)})`,
    });

    // Si el descuadre supera la tolerancia de bloqueo, construimos razones
    // y sugerencias accionables para el usuario.
    if (Math.abs(equationDiff) > BLOCKING_TOL) {
      validationReasons.push(
        `La ecuacion contable no cuadra: Activo (${formatCOP(controlTotals.activo)}) ` +
          `!= Pasivo (${formatCOP(controlTotals.pasivo)}) + Patrimonio ` +
          `(${formatCOP(controlTotals.patrimonio)}). Diferencia: ${formatCOP(equationDiff)}.`,
      );

      // Diagnostico heuristico: si el descuadre ~ netIncome significa que la
      // utilidad no esta en Clase 3 pero tampoco pudimos reinyectarla (ej.
      // porque la detectamos en patron diferente).
      if (netIncome !== 0 && Math.abs(equationDiff - netIncome) < BLOCKING_TOL * 0.5) {
        validationReasons.push(
          `El descuadre (${formatCOP(equationDiff)}) coincide aproximadamente con ` +
            `la utilidad del ejercicio (${formatCOP(netIncome)}). Posiblemente el ` +
            `balance fue exportado antes del cierre y la utilidad no fue trasladada ` +
            `a la cuenta 3605.`,
        );
        suggestedAccounts.push('3605 — Utilidad del ejercicio (Clase 3)');
      }

      // Si Patrimonio es sospechosamente bajo, sugerir revisar cuentas 31xx/33xx
      if (Math.abs(controlTotals.patrimonio) < Math.abs(controlTotals.activo) * 0.01) {
        validationReasons.push(
          `El Total Patrimonio (${formatCOP(controlTotals.patrimonio)}) es menor al ` +
            `1% del Total Activo, lo cual es inusual. Revisa si faltan cuentas de ` +
            `capital (31xx), reservas (33xx) o resultados acumulados (37xx) en el Excel.`,
        );
        suggestedAccounts.push(
          '3105 — Capital autorizado',
          '3115 — Capital suscrito y pagado',
          '3305 — Reserva legal',
          '3705 — Utilidades acumuladas / Resultados de ejercicios anteriores',
        );
      }
    }
  } else if (!equationBalanced) {
    // Tolerancia mas estricta (100 COP) — avisamos pero sin el prefijo duro.
    discrepancies.push({
      location: 'Ecuacion Patrimonial (tolerancia fina)',
      reported: 0,
      calculated: equationBalance,
      difference: equationBalance,
      description: `Activo ($${formatCOP(totalAssets)}) - Pasivo ($${formatCOP(totalLiabilities)}) - Patrimonio ($${formatCOP(totalEquity)}) = $${formatCOP(equationBalance)}. Diferencia menor a $${ECUACION_TOL} (posible redondeo).`,
    });
  }

  // Cross-check utilidad P&L vs utilidad del ejercicio en patrimonio
  const UTIL_TOL = 1000; // COP
  if (equityBreakdown.utilidadEjercicio !== undefined) {
    const diffUtil = controlTotals.utilidadNeta - equityBreakdown.utilidadEjercicio;
    if (Math.abs(diffUtil) > UTIL_TOL) {
      discrepancies.push({
        location: 'Consistencia Utilidad',
        reported: equityBreakdown.utilidadEjercicio,
        calculated: controlTotals.utilidadNeta,
        difference: diffUtil,
        description: `Utilidad neta P&L $${formatCOP(controlTotals.utilidadNeta)} difiere de Utilidad del ejercicio en patrimonio $${formatCOP(equityBreakdown.utilidadEjercicio)} (diferencia $${formatCOP(diffUtil)})`,
      });
    }
  }

  // Totales en 0 con filas existentes (posible fallo de parseo)
  for (let c = 1; c <= 6; c++) {
    const classData = classMap.get(c);
    const classTotal = getClassTotal(c);
    const hasClassRows = rows.some((r) => r.code.startsWith(String(c)));
    if (classTotal === 0 && hasClassRows && classData && classData.leaves.length === 0) {
      discrepancies.push({
        location: `Clase ${c} (${PUC_CLASS_NAMES[c]})`,
        reported: 0,
        calculated: 0,
        difference: 0,
        description: `Advertencia: Total de Clase ${c} es $0 pero existen filas con codigo ${c}xxx en la entrada. Posible fallo de parseo de numeros o niveles.`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 8. missingAccounts (D6): cuentas y subcuentas PUC importantes ausentes
  // -------------------------------------------------------------------------
  const missingAccounts = buildMissingAccounts(rows, leafRows, classes);

  // -------------------------------------------------------------------------
  // 9. Informe de validacion + datos limpios
  // -------------------------------------------------------------------------
  const auxiliaryCount = leafRows.length;
  const summary = {
    totalAssets, totalLiabilities, totalEquity, totalRevenue,
    totalExpenses, totalCosts, totalProduction, netIncome,
    equationBalance, equationBalanced,
  };

  // -------------------------------------------------------------------------
  // 10. Construir ValidationResult final
  // -------------------------------------------------------------------------
  // Deduplica sugerencias conservando orden de aparicion
  const dedupedSuggestions = Array.from(new Set(suggestedAccounts));
  const validation: ValidationResult = {
    blocking: validationReasons.length > 0,
    reasons: validationReasons,
    suggestedAccounts: dedupedSuggestions,
    adjustments,
  };

  const validationReport = buildValidationReport(
    classes,
    discrepancies,
    missingAccounts,
    summary,
    controlTotals,
    equityBreakdown,
    auxiliaryCount,
    rows.length,
  );

  const cleanData = buildCleanData(classes);

  return {
    period: null,
    classes,
    summary,
    controlTotals,
    equityBreakdown,
    validation,
    discrepancies,
    missingAccounts,
    auxiliaryCount,
    totalRowCount: rows.length,
    validationReport,
    cleanData,
  };
}

// ---------------------------------------------------------------------------
// equityBreakdown (D3)
// ---------------------------------------------------------------------------

/**
 * Extrae el desglose de patrimonio a partir de todas las filas (no solo leafs).
 * Preferimos el nivel mas agregado que sume correctamente. Si 3105 y 310505
 * conviven con saldos distintos, usamos 3105 y emitimos discrepancia.
 */
export function extractEquityBreakdown(
  rows: RawAccountRow[],
  discrepancies: Discrepancy[],
): EquityBreakdown {
  const breakdown: EquityBreakdown = {};

  // Helper: suma filas que comienzan por prefijo exacto, preferentemente al
  // nivel indicado. Si el nivel preferido existe y los descendientes suman
  // distinto, preferimos el nivel preferido y emitimos discrepancia.
  const sumPreferring = (
    prefix: string,
    preferredLevel: 'Cuenta' | 'Subcuenta',
    label: string,
  ): number | undefined => {
    const preferred = rows.find((r) => r.code === prefix && r.level === preferredLevel);
    const descendants = rows.filter(
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

    // Sin nivel preferido: usamos descendientes (leaf-like) como fallback.
    const descSum = descendants
      .filter((r) => r.level === 'Auxiliar' || r.level === 'Subcuenta' || r.transactional)
      .reduce((s, r) => s + r.balance, 0);
    return descSum !== 0 ? descSum : undefined;
  };

  // 3105 — Capital autorizado
  const v3105 = sumPreferring('3105', 'Cuenta', 'Capital autorizado');
  if (v3105 !== undefined) breakdown.capitalAutorizado = v3105;

  // 3115 + 3120 — Capital suscrito y pagado (+ Aporte de socios si existe)
  const v3115 = sumPreferring('3115', 'Cuenta', 'Capital suscrito y pagado');
  const v3120 = sumPreferring('3120', 'Cuenta', 'Aporte de socios');
  const capSuscrito = (v3115 ?? 0) + (v3120 ?? 0);
  if (v3115 !== undefined || v3120 !== undefined) {
    breakdown.capitalSuscritoPagado = capSuscrito;
  }

  // 3305 — Reserva legal
  const v3305 = sumPreferring('3305', 'Cuenta', 'Reserva legal');
  if (v3305 !== undefined) breakdown.reservaLegal = v3305;

  // 3310..3395 — Otras reservas (agregadas). Sumamos a nivel Cuenta (4 digitos)
  // que empiezan por 33 pero no sean 3305. Si no hay Cuenta, caemos a subcuentas
  // del grupo 33 excluyendo prefijo 3305.
  let otrasReservasTotal = 0;
  let otrasReservasFound = false;
  const cuentasGrupo33 = rows.filter(
    (r) => r.level === 'Cuenta' && r.code.startsWith('33') && r.code !== '3305' && r.balance !== 0,
  );
  if (cuentasGrupo33.length > 0) {
    otrasReservasTotal = cuentasGrupo33.reduce((s, r) => s + r.balance, 0);
    otrasReservasFound = true;
  } else {
    const hojas33 = rows.filter(
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

  // 3605 — Utilidad del ejercicio
  const v3605 = sumPreferring('3605', 'Cuenta', 'Utilidad del ejercicio');
  if (v3605 !== undefined) breakdown.utilidadEjercicio = v3605;

  // 3610 + 3705 + 3710 — Utilidades acumuladas / ejercicios anteriores
  const v3610 = sumPreferring('3610', 'Cuenta', 'Utilidades acumuladas');
  const v3705 = sumPreferring('3705', 'Cuenta', 'Utilidad ejercicios anteriores');
  const v3710 = sumPreferring('3710', 'Cuenta', 'Perdida ejercicios anteriores');
  if (v3610 !== undefined || v3705 !== undefined || v3710 !== undefined) {
    breakdown.utilidadesAcumuladas = (v3610 ?? 0) + (v3705 ?? 0) + (v3710 ?? 0);
  }

  return breakdown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseLine(line: string, separator: string): string[] {
  // Simple CSV parser that handles quoted fields
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === separator && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * parseNumber — robusto contra formatos diversos de ERP colombianos.
 *
 * Soporta:
 *  - Envoltura `(...)` como negativo (convencion contable: credit balance).
 *  - Prefijo/sufijo `-` como negativo (incluye `1234-` estilo mainframe).
 *  - Simbolos de moneda y etiquetas: `$`, `COP`, `USD`, espacios.
 *  - Formato colombiano: `1.234.567,89` (. miles, , decimal).
 *  - Formato US: `1,234,567.89` (, miles, . decimal).
 *  - Entrada solo con `.` o solo con `,`: heuristica por numero de digitos
 *    despues del ultimo separador (<=2 digitos => decimal).
 *  - Entradas invalidas: retorna NaN (permite al caller distinguir "no es
 *    numero" de 0). Para el contrato publico historico (debit/credit en
 *    parseTrialBalanceCSV) se envuelve con safeNumber().
 *
 * Devuelve: number | NaN.
 */
export function parseNumber(val: string | undefined): number {
  if (val === undefined || val === null) return NaN;
  // Normalizacion: trim + remover $, COP, USD, espacios internos y comillas.
  let cleaned = String(val).trim();
  if (cleaned.length === 0) return NaN;

  // Remover simbolos/etiquetas monetarias (case-insensitive) y comillas.
  cleaned = cleaned
    .replace(/\b(COP|USD|EUR)\b/gi, '')
    .replace(/[$€£'"\s]/g, '')
    .trim();
  if (cleaned.length === 0) return NaN;

  // Detectar envoltura (...) como negativo.
  let isNegative = false;
  if (/^\(.*\)$/.test(cleaned)) {
    isNegative = true;
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Sufijo '-' (e.g. "1234-") o prefijo '-' (e.g. "-1234").
  if (cleaned.endsWith('-')) {
    isNegative = !isNegative;
    cleaned = cleaned.slice(0, -1).trim();
  }
  if (cleaned.startsWith('-')) {
    isNegative = !isNegative;
    cleaned = cleaned.slice(1).trim();
  }
  // Prefijo '+' opcional.
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1).trim();
  }

  if (cleaned.length === 0) return NaN;

  // Si quedan caracteres no numericos salvo . y , es invalido.
  if (!/^[\d.,]+$/.test(cleaned)) return NaN;

  const hasDot = cleaned.includes('.');
  const hasComma = cleaned.includes(',');
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');

  let normalized: string;

  if (hasDot && hasComma) {
    // Ambos separadores: el ultimo es el decimal.
    if (lastComma > lastDot) {
      // Colombian: 1.234.567,89
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // US: 1,234,567.89
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (hasDot) {
    // Solo '.': si <=2 digitos despues del ultimo punto => decimal; si no, miles.
    const digitsAfter = cleaned.length - lastDot - 1;
    const occurrences = (cleaned.match(/\./g) || []).length;
    if (occurrences === 1 && digitsAfter <= 2) {
      // decimal
      normalized = cleaned;
    } else {
      // miles — remover todos los puntos
      normalized = cleaned.replace(/\./g, '');
    }
  } else if (hasComma) {
    // Solo ',': si <=2 digitos despues de la ultima coma => decimal; si no, miles.
    const digitsAfter = cleaned.length - lastComma - 1;
    const occurrences = (cleaned.match(/,/g) || []).length;
    if (occurrences === 1 && digitsAfter <= 2) {
      normalized = cleaned.replace(',', '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  } else {
    // Solo digitos.
    normalized = cleaned;
  }

  const num = parseFloat(normalized);
  if (Number.isNaN(num)) return NaN;
  return isNegative ? -num : num;
}

/** Convierte NaN en 0 — para campos historicos donde se espera number. */
function safeNumber(val: number): number {
  return Number.isNaN(val) ? 0 : val;
}

/** Convierte NaN en undefined — para campos opcionales. */
function safeNumberOrUndefined(val: number): number | undefined {
  return Number.isNaN(val) ? undefined : val;
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = headers.findIndex((h) => h.includes(candidate));
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Infiere el nivel PUC a partir del numero de digitos del codigo (ya
 * normalizado, sin puntos ni guiones). Convencion PUC colombiano:
 *   1 digito  -> Clase       (1, 2, 3, 4, 5, 6, 7)
 *   2 digitos -> Grupo       (11 Disponible, 13 Deudores, etc.)
 *   4 digitos -> Cuenta      (1105 Caja, 1110 Bancos)
 *   6 digitos -> Subcuenta   (110505 Caja general)
 *   8+ dig.   -> Auxiliar    (nivel mas granular del libro mayor)
 *
 * Longitudes intermedias (3, 5, 7) son atipicas pero algunos ERPs las
 * exportan. Las mapeamos al nivel PUC mas cercano por arriba para no
 * perderlas: 3 -> Grupo, 5 -> Cuenta, 7 -> Subcuenta.
 */
function inferLevel(code: string): string {
  const len = code.length;
  if (len === 1) return 'Clase';
  if (len === 2 || len === 3) return 'Grupo';
  if (len === 4 || len === 5) return 'Cuenta';
  if (len === 6 || len === 7) return 'Subcuenta';
  return 'Auxiliar'; // 8+ digitos
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

/**
 * Busca discrepancias por clase: grupos/cuentas con saldo != 0 pero sin hojas.
 * Legacy — se usa para la descripcion textual en discrepancies por clase.
 */
function findMissingAccountsForClass(
  allRows: RawAccountRow[],
  classCode: number,
  leafRows: RawAccountRow[],
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

/**
 * Construye la lista missingAccounts (D6) — cuentas y subcuentas PUC
 * importantes que deberian existir pero no aparecen (o aparecen en 0).
 *
 * Reglas:
 *  1. Para cada subcuenta en IMPORTANT_SUBCUENTAS, si el grupo padre tiene
 *     saldo > 0 pero la subcuenta no aparece entre las hojas o tiene saldo 0,
 *     se reporta.
 *  2. Tambien se reportan grupos/cuentas con saldo reportado > 0 pero sin
 *     hojas descendientes (caso tradicional: ERP exporto Grupo pero no
 *     detalle).
 */
function buildMissingAccounts(
  allRows: RawAccountRow[],
  leafRows: RawAccountRow[],
  classes: PUCClass[],
): string[] {
  const out: string[] = [];
  const leafByCode = new Map<string, RawAccountRow>();
  for (const r of leafRows) leafByCode.set(r.code, r);

  // Saldo total por grupo (2 digitos) — usando hojas (que ya consideran
  // subcuentas huerfanas).
  const groupTotals = new Map<string, number>();
  for (const r of leafRows) {
    if (r.code.length >= 2) {
      const grp = r.code.slice(0, 2);
      groupTotals.set(grp, (groupTotals.get(grp) ?? 0) + r.balance);
    }
  }

  // (1) Subcuentas importantes ausentes
  for (const [subCode, meta] of Object.entries(IMPORTANT_SUBCUENTAS)) {
    const parentTotal = groupTotals.get(meta.parentGroup) ?? 0;
    if (Math.abs(parentTotal) <= 1) continue; // grupo padre sin actividad

    // Buscar la subcuenta o cualquier hoja bajo su prefijo.
    const hasHere = leafRows.some((l) => l.code === subCode);
    const hasBelow = leafRows.some((l) => l.code.startsWith(subCode) && l.code !== subCode);
    const rowAtSub = allRows.find((r) => r.code === subCode);
    const subBalance = rowAtSub?.balance ?? 0;

    if (!hasHere && !hasBelow) {
      out.push(
        `Subcuenta PUC esperada ausente: ${subCode} ${meta.name} (grupo ${meta.parentGroup} tiene saldo $${formatCOP(parentTotal)} — la subcuenta deberia aportar parte).`,
      );
    } else if (hasHere && Math.abs(subBalance) < 1 && !hasBelow) {
      out.push(
        `Subcuenta PUC ${subCode} ${meta.name} presente pero con saldo $0 (grupo ${meta.parentGroup} = $${formatCOP(parentTotal)}). Verificar.`,
      );
    }
  }

  // (2) Grupos/cuentas a nivel superior con saldo pero sin hojas descendientes
  for (const cl of classes) {
    const classPrefix = String(cl.code);
    const groupsAndAccounts = allRows.filter(
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
          `${g.level} ${g.code} ${g.name} con saldo $${formatCOP(g.balance)} sin hojas (auxiliares/subcuentas) debajo. Revisar exportacion del ERP.`,
        );
      }
    }
  }

  return out;
}

function sumLeavesByGroupPrefixes(
  leafRows: RawAccountRow[],
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

function buildValidationReport(
  classes: PUCClass[],
  discrepancies: Discrepancy[],
  missingAccounts: string[],
  summary: PreprocessedBalance['summary'],
  controlTotals: ControlTotals,
  equityBreakdown: EquityBreakdown,
  auxCount: number,
  totalCount: number,
): string {
  const lines: string[] = [];
  lines.push('# INFORME DE VALIDACION ARITMETICA DEL BALANCE DE PRUEBA');
  lines.push('');
  lines.push(`**Cuentas totales:** ${totalCount} | **Hojas procesadas (aux + subcuentas huerfanas):** ${auxCount}`);
  lines.push('');
  lines.push('## Resumen por Clase PUC');
  lines.push('');
  lines.push('| Clase | Nombre | Total Hojas | Total Reportado | Discrepancia |');
  lines.push('|-------|--------|-------------|-----------------|--------------|');

  for (const c of classes) {
    const reported = c.reportedTotal !== null ? `$${formatCOP(c.reportedTotal)}` : 'N/A';
    const disc = c.discrepancy > 1 ? `$${formatCOP(c.discrepancy)}` : 'OK';
    const flag = c.discrepancy > 1 ? ' !!' : '';
    lines.push(`| ${c.code} | ${c.name} | $${formatCOP(c.auxiliaryTotal)} | ${reported} | ${disc}${flag} |`);
  }

  lines.push('');
  lines.push('## Totales de Control (Contrato Vinculante)');
  lines.push('');
  lines.push(`- **Activo Total:** $${formatCOP(controlTotals.activo)} (corriente $${formatCOP(controlTotals.activoCorriente)} + no corriente $${formatCOP(controlTotals.activoNoCorriente)})`);
  lines.push(`- **Pasivo Total:** $${formatCOP(controlTotals.pasivo)} (corriente $${formatCOP(controlTotals.pasivoCorriente)} + no corriente $${formatCOP(controlTotals.pasivoNoCorriente)})`);
  lines.push(`- **Patrimonio Total:** $${formatCOP(controlTotals.patrimonio)}`);
  lines.push(`- **Ingresos:** $${formatCOP(controlTotals.ingresos)}`);
  lines.push(`- **Gastos+Costos:** $${formatCOP(controlTotals.gastos)}`);
  lines.push(`- **Utilidad Neta:** $${formatCOP(controlTotals.utilidadNeta)}`);
  lines.push('');
  lines.push('## Ecuacion Patrimonial');
  lines.push('');
  lines.push(`- **Activo - (Pasivo + Patrimonio) = $${formatCOP(controlTotals.activo - (controlTotals.pasivo + controlTotals.patrimonio))}**`);
  lines.push(`- **Estado:** ${summary.equationBalanced ? 'CUADRA' : 'NO CUADRA'}`);

  // Desglose de patrimonio (si hay datos)
  const eb = equityBreakdown;
  const hasEB = Object.keys(eb).length > 0;
  if (hasEB) {
    lines.push('');
    lines.push('## Desglose de Patrimonio');
    lines.push('');
    if (eb.capitalAutorizado !== undefined) lines.push(`- **Capital autorizado (3105):** $${formatCOP(eb.capitalAutorizado)}`);
    if (eb.capitalSuscritoPagado !== undefined) lines.push(`- **Capital suscrito y pagado (3115+3120):** $${formatCOP(eb.capitalSuscritoPagado)}`);
    if (eb.reservaLegal !== undefined) lines.push(`- **Reserva legal (3305):** $${formatCOP(eb.reservaLegal)}`);
    if (eb.otrasReservas !== undefined) lines.push(`- **Otras reservas (3310-3395):** $${formatCOP(eb.otrasReservas)}`);
    if (eb.utilidadEjercicio !== undefined) lines.push(`- **Utilidad del ejercicio (3605):** $${formatCOP(eb.utilidadEjercicio)}`);
    if (eb.utilidadesAcumuladas !== undefined) lines.push(`- **Utilidades acumuladas (3610+3705+3710):** $${formatCOP(eb.utilidadesAcumuladas)}`);
  }

  if (discrepancies.length > 0) {
    lines.push('');
    lines.push('## Discrepancias Detectadas');
    lines.push('');
    for (const d of discrepancies) {
      lines.push(`### ${d.location}`);
      lines.push(`- **Reportado:** $${formatCOP(d.reported)}`);
      lines.push(`- **Calculado:** $${formatCOP(d.calculated)}`);
      lines.push(`- **Diferencia:** $${formatCOP(d.difference)}`);
      lines.push(`- **Nota:** ${d.description}`);
      lines.push('');
    }
    lines.push('> **REGLA DE ORO:** Se priorizan los totales calculados desde hojas sobre los totales reportados.');
  } else {
    lines.push('');
    lines.push('*No se detectaron discrepancias. Los totales reportados coinciden con la suma de hojas.*');
  }

  if (missingAccounts.length > 0) {
    lines.push('');
    lines.push('## Cuentas PUC Importantes Faltantes o Con Saldo 0');
    lines.push('');
    for (const m of missingAccounts) {
      lines.push(`- ${m}`);
    }
  }

  return lines.join('\n');
}

function buildCleanData(classes: PUCClass[]): string {
  const lines: string[] = [];
  lines.push('codigo,nombre,nivel,saldo');

  for (const c of classes) {
    for (const acc of c.accounts) {
      lines.push(`${acc.code},"${acc.name}",${acc.level},${acc.balance.toFixed(2)}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Test assertions (snippet inline — NO LLM, NO ejecutable en runtime)
// ---------------------------------------------------------------------------
// Las siguientes aserciones se usaron durante desarrollo para validar
// parseNumber. Estan comentadas y no corren en produccion.
// ---------------------------------------------------------------------------
/*
import assert from 'node:assert';
// Caso colombiano normal
assert.strictEqual(parseNumber('1.234.567,89'), 1234567.89);
// Parentesis como negativo
assert.strictEqual(parseNumber('(1.234,56)'), -1234.56);
// Prefijo - con decimal US
assert.strictEqual(parseNumber('-1234.56'), -1234.56);
// Formato US
assert.strictEqual(parseNumber('1,234,567.89'), 1234567.89);
// Con simbolos de moneda
assert.strictEqual(parseNumber('$ 1.234,56 COP'), 1234.56);
// Sufijo - (mainframe)
assert.strictEqual(parseNumber('1234-'), -1234);
// Input vacio / whitespace => NaN
assert.ok(Number.isNaN(parseNumber(' ')));
assert.ok(Number.isNaN(parseNumber('')));
// Texto no numerico => NaN
assert.ok(Number.isNaN(parseNumber('N/A')));
*/
