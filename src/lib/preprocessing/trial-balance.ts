// ---------------------------------------------------------------------------
// Trial Balance Preprocessor — deterministic arithmetic validation
// ---------------------------------------------------------------------------
// Parses CSV/Excel trial balance data, filters to auxiliary/transactional
// accounts, sums by PUC class, validates totals, and detects discrepancies.
//
// NO LLM — pure computation. Runs before the financial pipeline so agents
// receive clean, pre-validated data with arithmetic guarantees.
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

export interface PreprocessedBalance {
  /** Fiscal period (if detected) */
  period: string | null;
  /** All PUC classes with validated totals */
  classes: PUCClass[];
  /** Summary figures */
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
  /** Detected discrepancies */
  discrepancies: Discrepancy[];
  /** Number of auxiliary accounts processed */
  auxiliaryCount: number;
  /** Total accounts in the raw data */
  totalRowCount: number;
  /** Human-readable validation report (Markdown) */
  validationReport: string;
  /** Clean CSV-like text for the NIIF analyst agent */
  cleanData: string;
}

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
    const code = (cols[codeIdx] || '').trim().replace(/['"]/g, '');
    if (!code || !/^\d/.test(code)) continue; // skip non-account rows

    const debit = parseNumber(cols[debitIdx]);
    const credit = parseNumber(cols[creditIdx]);
    const rawBalance = balanceIdx !== -1 ? parseNumber(cols[balanceIdx]) : null;

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
    if (rawBalance !== null) {
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
      previousBalance: prevBalIdx !== -1 ? parseNumber(cols[prevBalIdx]) : undefined,
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
  // Separate leaf accounts (auxiliaries/transactional) from summary rows
  const leafRows = rows.filter((r) => r.transactional || r.level === 'Auxiliar');
  const classRows = rows.filter((r) => r.level === 'Clase');

  // Group by PUC class
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

  // Build validated classes
  const classes: PUCClass[] = [];
  const discrepancies: Discrepancy[] = [];

  for (const [classCode, data] of classMap) {
    const auxiliaryTotal = data.leaves.reduce((sum, r) => sum + r.balance, 0);
    const reportedTotal = data.reportedRow ? data.reportedRow.balance : null;
    const discrepancy = reportedTotal !== null ? Math.abs(auxiliaryTotal - reportedTotal) : 0;

    // Report discrepancy if > $1 (floating point tolerance)
    if (reportedTotal !== null && discrepancy > 1) {
      // Try to find which accounts might be missing
      const missingDesc = findMissingAccounts(rows, classCode, data.leaves);
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

    // Sort accounts by code
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

  // Calculate summary (using VALIDATED auxiliary totals, not reported)
  const getClassTotal = (c: number) => classes.find((cl) => cl.code === c)?.auxiliaryTotal ?? 0;

  const totalAssets = getClassTotal(1);
  const totalLiabilities = getClassTotal(2);
  const totalEquity = getClassTotal(3);
  const totalRevenue = getClassTotal(4);
  const totalExpenses = getClassTotal(5);
  const totalCosts = getClassTotal(6);
  const totalProduction = getClassTotal(7);
  const netIncome = totalRevenue - totalExpenses - totalCosts;
  const equationBalance = totalAssets - totalLiabilities - totalEquity;
  // Tolerance of $100 for floating point
  const equationBalanced = Math.abs(equationBalance) < 100;

  if (!equationBalanced) {
    discrepancies.push({
      location: 'Ecuacion Patrimonial',
      reported: 0,
      calculated: equationBalance,
      difference: equationBalance,
      description: `Activo ($${formatCOP(totalAssets)}) - Pasivo ($${formatCOP(totalLiabilities)}) - Patrimonio ($${formatCOP(totalEquity)}) = $${formatCOP(equationBalance)}. La ecuacion NO cuadra.`,
    });
  }

  const auxiliaryCount = leafRows.length;
  const validationReport = buildValidationReport(classes, discrepancies, {
    totalAssets, totalLiabilities, totalEquity, totalRevenue,
    totalExpenses, totalCosts, totalProduction, netIncome,
    equationBalance, equationBalanced,
  }, auxiliaryCount, rows.length);

  const cleanData = buildCleanData(classes);

  return {
    period: null,
    classes,
    summary: {
      totalAssets, totalLiabilities, totalEquity, totalRevenue,
      totalExpenses, totalCosts, totalProduction, netIncome,
      equationBalance, equationBalanced,
    },
    discrepancies,
    auxiliaryCount,
    totalRowCount: rows.length,
    validationReport,
    cleanData,
  };
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

function parseNumber(val: string | undefined): number {
  if (!val) return 0;
  // Remove currency symbols, thousands separators (both . and ,)
  // Colombian format: 1.234.567,89 → handle both formats
  let cleaned = val.trim().replace(/['"$\sCOP]/gi, '');
  if (!cleaned) return 0;

  // Detect format: if last separator is comma and has exactly 2 digits after → Colombian
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma > lastDot && lastComma === cleaned.length - 3) {
    // Colombian format: 1.234.567,89
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma && lastDot === cleaned.length - 3) {
    // US format: 1,234,567.89
    cleaned = cleaned.replace(/,/g, '');
  } else {
    // No decimals or ambiguous — remove all non-numeric except dots
    cleaned = cleaned.replace(/,/g, '');
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = headers.findIndex((h) => h.includes(candidate));
    if (idx !== -1) return idx;
  }
  return -1;
}

function inferLevel(code: string): string {
  switch (code.length) {
    case 1: return 'Clase';
    case 2: return 'Grupo';
    case 4: return 'Cuenta';
    case 6: return 'Subcuenta';
    default: return code.length >= 6 ? 'Auxiliar' : 'Cuenta';
  }
}

function normalizeLevel(level: string): string {
  const l = level.toLowerCase().trim();
  if (l.includes('clase') || l === 'class') return 'Clase';
  if (l.includes('grupo') || l === 'group') return 'Grupo';
  if (l.includes('cuenta') || l === 'account') return 'Cuenta';
  if (l.includes('sub')) return 'Subcuenta';
  if (l.includes('auxiliar') || l.includes('aux') || l.includes('detalle')) return 'Auxiliar';
  return level;
}

function findMissingAccounts(allRows: RawAccountRow[], classCode: number, leafRows: RawAccountRow[]): string {
  // Find group/account-level rows that might contain accounts not in the leaves
  const classPrefix = String(classCode);
  const groupRows = allRows.filter(
    (r) => r.code.startsWith(classPrefix) && (r.level === 'Grupo' || r.level === 'Cuenta') && r.balance !== 0,
  );

  const leafCodes = new Set(leafRows.map((r) => r.code));
  const missing: string[] = [];

  for (const group of groupRows) {
    // Check if this group has any leaf children
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

function formatCOP(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `-${formatted}` : formatted;
}

function buildValidationReport(
  classes: PUCClass[],
  discrepancies: Discrepancy[],
  summary: PreprocessedBalance['summary'],
  auxCount: number,
  totalCount: number,
): string {
  const lines: string[] = [];
  lines.push('# INFORME DE VALIDACION ARITMETICA DEL BALANCE DE PRUEBA');
  lines.push('');
  lines.push(`**Cuentas totales:** ${totalCount} | **Auxiliares procesados:** ${auxCount}`);
  lines.push('');
  lines.push('## Resumen por Clase PUC');
  lines.push('');
  lines.push('| Clase | Nombre | Total Auxiliares | Total Reportado | Discrepancia |');
  lines.push('|-------|--------|-----------------|-----------------|--------------|');

  for (const c of classes) {
    const reported = c.reportedTotal !== null ? `$${formatCOP(c.reportedTotal)}` : 'N/A';
    const disc = c.discrepancy > 1 ? `$${formatCOP(c.discrepancy)}` : 'OK';
    const flag = c.discrepancy > 1 ? ' ⚠' : '';
    lines.push(`| ${c.code} | ${c.name} | $${formatCOP(c.auxiliaryTotal)} | ${reported} | ${disc}${flag} |`);
  }

  lines.push('');
  lines.push('## Ecuacion Patrimonial');
  lines.push('');
  lines.push(`- **Activo Total:** $${formatCOP(summary.totalAssets)}`);
  lines.push(`- **Pasivo Total:** $${formatCOP(summary.totalLiabilities)}`);
  lines.push(`- **Patrimonio Total:** $${formatCOP(summary.totalEquity)}`);
  lines.push(`- **Verificacion:** Activo - Pasivo - Patrimonio = $${formatCOP(summary.equationBalance)}`);
  lines.push(`- **Estado:** ${summary.equationBalanced ? 'CUADRA' : 'NO CUADRA'}`);
  lines.push('');
  lines.push(`- **Utilidad Neta Calculada:** $${formatCOP(summary.netIncome)}`);
  lines.push(`  (Ingresos $${formatCOP(summary.totalRevenue)} - Gastos $${formatCOP(summary.totalExpenses)} - Costos $${formatCOP(summary.totalCosts)})`);

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
    lines.push('> **REGLA DE ORO:** Se priorizan los totales calculados desde auxiliares sobre los totales reportados.');
  } else {
    lines.push('');
    lines.push('*No se detectaron discrepancias. Los totales reportados coinciden con la suma de auxiliares.*');
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
