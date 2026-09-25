/**
 * ERP Query Tool — Bridge between chat agents and live ERP data.
 *
 * Allows specialist agents to query connected ERP systems (Alegra, Siigo, Helisa,
 * SAP, etc.) and receive formatted data ready for LLM analysis.
 *
 * Supported query types:
 * - trial_balance:     Balance de prueba by period, with PUC class summary
 * - invoices:          Facturas by date range, summarized by month/type
 * - journal_entries:   Comprobantes contables by date range, grouped by month
 * - contacts:          Clientes y proveedores from the ERP
 * - chart_of_accounts: Plan Unico de Cuentas (PUC) / chart of accounts
 */

import type { ERPProvider, ERPCredentials, ERPTrialBalance, ERPJournalEntry, ERPInvoice, ERPContact, ERPAccount } from '@/lib/erp/types';
import { getConnector } from '@/lib/erp/registry';
import { resolveERPPeriod, ERPPeriodError } from '@/lib/erp/period';
import { trialBalanceLeafAccounts, trialBalanceToCSV } from '@/lib/erp/trial-balance-serialization';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';

// ─── Public Types ────────────────────────────────────────────────────────────

export interface ERPConnectionInfo {
  provider: ERPProvider;
  credentials: Record<string, string>;
}

export interface QueryERPArgs {
  type: 'trial_balance' | 'invoices' | 'journal_entries' | 'contacts' | 'chart_of_accounts';
  period?: string;        // "2025", "2025-Q3" → resolved to date range
  dateFrom?: string;      // ISO date
  dateTo?: string;        // ISO date
  accountCode?: string;   // PUC filter e.g. "41" for all revenue
}

export interface QueryERPResult {
  content: string;        // Formatted text for the LLM to analyze
  provider: string;       // Which ERP was used
  recordCount: number;    // How many records returned
  period: string;         // What period was queried
}

// ─── Colombian Peso Formatting ───────────────────────────────────────────────

function formatCOP(amount: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─── Period Parsing ──────────────────────────────────────────────────────────

interface DateRange {
  dateFrom: string;
  dateTo: string;
  /** Etiqueta canónica del periodo ("2025", "2025-Q3", "2025-06" o "desde..hasta"). */
  label: string;
}

/**
 * Resuelve el rango efectivo con la misma regla que los conectores
 * (`resolveERPPeriod`): "2025", "2025-Q3", "2025-06" o fechas explícitas.
 * Las fechas explícitas tienen prioridad. Un formato no soportado lanza
 * `ERPPeriodError` en vez de enviar al ERP fechas como "2025-NaN".
 *
 * Sin periodo: el balance de prueba usa el mes en curso (saldos a su corte);
 * las demás consultas, el año en curso.
 */
function resolveDateRange(args: QueryERPArgs, now = new Date()): DateRange {
  let resolved;
  if (args.dateFrom && args.dateTo) {
    resolved = resolveERPPeriod(`${args.dateFrom}..${args.dateTo}`);
  } else if (args.period) {
    resolved = resolveERPPeriod(args.period);
  } else if (args.type === 'trial_balance') {
    resolved = resolveERPPeriod(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  } else {
    resolved = resolveERPPeriod(String(now.getFullYear()));
  }
  return { dateFrom: resolved.from, dateTo: resolved.to, label: resolved.label };
}

// ─── PUC Class Names ─────────────────────────────────────────────────────────

const PUC_CLASS_NAMES: Record<number, string> = {
  1: 'Activo',
  2: 'Pasivo',
  3: 'Patrimonio',
  4: 'Ingresos',
  5: 'Gastos',
  6: 'Costos de Venta',
  7: 'Costos de Produccion',
  8: 'Cuentas de Orden Deudoras',
  9: 'Cuentas de Orden Acreedoras',
};

// ─── Formatters ──────────────────────────────────────────────────────────────

/** Importe con signo (los saldos invertidos deben verse, no ocultarse con |x|). */
function formatSignedCOP(amount: number): string {
  return formatCOP(amount);
}

interface KeyFigures {
  activo: number;
  pasivo: number;
  patrimonio: number;
  ingresosNetos: number | null;
  costoVentas6: number | null;
  costoProduccion7: number | null;
  resultadoOperacional: number | null;
  utilidadNeta: number;
  blocking: boolean;
  reasons: string[];
}

/**
 * Cifras clave con la MISMA función determinista que alimenta los informes:
 * serializador ERP → parser CSV → preprocesador. Sólo para balances completos.
 * Resultado operacional = controlTotals.ebit del preprocesador (utilidad bruta
 * con costos de las clases 6 y 7, menos gastos operacionales 51 y 52).
 */
function computeKeyFigures(tb: ERPTrialBalance): KeyFigures {
  const snapshot = preprocessTrialBalance(parseTrialBalanceCSV(trialBalanceToCSV(tb))).primary;
  const ct = snapshot.controlTotals;
  return {
    activo: ct.activo,
    pasivo: ct.pasivo,
    patrimonio: ct.patrimonio,
    ingresosNetos: ct.ingresosNetos ?? null,
    costoVentas6: ct.costoVentas6 ?? null,
    costoProduccion7: ct.costoProduccion7 ?? null,
    resultadoOperacional: ct.ebit ?? null,
    utilidadNeta: ct.utilidadNeta,
    blocking: snapshot.validation.blocking,
    reasons: snapshot.validation.reasons,
  };
}

const ND = 'N/D';
const orND = (value: number | null) => (value === null ? ND : formatSignedCOP(value));

function formatTrialBalance(tb: ERPTrialBalance, accountCodeFilter?: string): string {
  const lines: string[] = [];
  const movementsOnly = tb.balanceStatus === 'movements_only';

  if (movementsOnly) {
    lines.push(`# Movimientos contables del periodo — ${tb.companyName || 'Empresa'}`);
    lines.push('');
    lines.push(`> NO es un balance de prueba. ${tb.balanceStatusReason ?? ''}`.trim());
    lines.push('> No se calculan activos, pasivos, patrimonio, resultado ni cuadre: sin saldos iniciales esas cifras serían la variación del periodo.');
  } else if (tb.balanceStatus === 'partial') {
    lines.push(`# Balance de Prueba PARCIAL — ${tb.companyName || 'Empresa'}`);
    lines.push('');
    lines.push(`> ${tb.balanceStatusReason ?? 'Balance parcial.'}`);
  } else {
    lines.push(`# Balance de Prueba — ${tb.companyName || 'Empresa'}`);
  }
  if (tb.companyNit) lines.push(`NIT: ${tb.companyNit}`);
  lines.push(`Periodo: ${tb.period} | Moneda: ${tb.currency || 'no determinada'}`);
  lines.push(`Generado: ${tb.generatedAt}`);
  if (tb.warnings.length > 0) {
    lines.push('');
    lines.push('## Advertencias de integridad');
    for (const w of tb.warnings) lines.push(`- ${w}`);
  }
  lines.push('');

  // Cuentas a sumar: en movimientos, todas las cuentas con movimiento (cada
  // línea afecta una sola cuenta); en saldos, sólo las hojas de la jerarquía
  // real para no sumar subcuenta y auxiliares a la vez.
  let accounts = movementsOnly ? tb.accounts : trialBalanceLeafAccounts(tb);
  if (accountCodeFilter) {
    accounts = accounts.filter(a => a.code.startsWith(accountCodeFilter));
    lines.push(`> Filtro aplicado: cuentas que inician con "${accountCodeFilter}"`);
    lines.push('');
  }

  // ── PUC Class Summary ──
  const classTotals = new Map<number, { debit: number; credit: number; balance: number }>();
  for (const acct of accounts) {
    const cls = acct.pucClass ?? parseInt(acct.code.charAt(0), 10);
    if (!Number.isFinite(cls)) continue;
    const current = classTotals.get(cls) ?? { debit: 0, credit: 0, balance: 0 };
    current.debit += acct.debit;
    current.credit += acct.credit;
    current.balance += acct.balance;
    classTotals.set(cls, current);
  }

  const lastColumn = movementsOnly ? 'Movimiento neto (D − C)' : 'Saldo';
  lines.push(movementsOnly ? '## Movimientos por Clase PUC' : '## Resumen por Clase PUC');
  lines.push('');
  lines.push(`| Clase | Nombre | Debitos | Creditos | ${lastColumn} |`);
  lines.push('|-------|--------|---------|----------|-------|');
  for (const [cls, totals] of [...classTotals.entries()].sort((a, b) => a[0] - b[0])) {
    const name = PUC_CLASS_NAMES[cls] ?? `Clase ${cls}`;
    lines.push(
      `| ${cls} | ${name} | ${formatCOP(totals.debit)} | ${formatCOP(totals.credit)} | ${formatSignedCOP(totals.balance)} |`,
    );
  }
  lines.push('');

  // ── Key Financial Highlights ──
  lines.push('## Cifras Clave');
  lines.push('');
  if (movementsOnly) {
    lines.push('- No disponibles: el ERP sólo entregó movimientos del periodo (sin saldo inicial ni saldos acumulados).');
  } else if (tb.balanceStatus !== 'complete') {
    lines.push(`- No disponibles: ${tb.balanceStatusReason ?? 'balance parcial.'}`);
  } else {
    let figures: KeyFigures | null = null;
    let unavailable = '';
    try {
      figures = computeKeyFigures(tb);
    } catch (error) {
      unavailable = error instanceof Error ? error.message : 'no se pudo preprocesar el balance.';
    }
    if (!figures) {
      lines.push(`- No disponibles: ${unavailable}`);
    } else {
      lines.push(`- **Total activos:** ${formatSignedCOP(figures.activo)}`);
      lines.push(`- **Total pasivos:** ${formatSignedCOP(figures.pasivo)}`);
      lines.push(`- **Total patrimonio:** ${formatSignedCOP(figures.patrimonio)}`);
      lines.push(`- **Ingresos netos (clase 4 menos devoluciones 4175):** ${orND(figures.ingresosNetos)}`);
      lines.push(`- **Costo de ventas (clase 6):** ${orND(figures.costoVentas6)}`);
      lines.push(`- **Costos de producción (clase 7):** ${orND(figures.costoProduccion7)}`);
      lines.push(
        `- **Resultado operacional (utilidad bruta − gastos operacionales 51 y 52):** ${orND(figures.resultadoOperacional)}`,
      );
      lines.push(`- **Resultado del ejercicio:** ${formatSignedCOP(figures.utilidadNeta)}`);
      lines.push(
        figures.blocking
          ? `- **Validación del preprocesador:** BLOQUEADA — ${figures.reasons.join(' ')}`
          : '- **Validación del preprocesador:** sin bloqueos.',
      );
    }
  }
  lines.push('');

  // ── Detailed Accounts Table ──
  const detailAccounts = accounts.slice(0, 100);
  if (detailAccounts.length > 0) {
    lines.push(movementsOnly ? '## Detalle de Cuentas con Movimiento' : '## Detalle de Cuentas Auxiliares');
    lines.push('');
    lines.push(`| Codigo | Cuenta | Debitos | Creditos | ${lastColumn} |`);
    lines.push('|--------|--------|---------|----------|-------|');
    for (const acct of detailAccounts) {
      lines.push(
        `| ${acct.code} | ${acct.name} | ${formatCOP(acct.debit)} | ${formatCOP(acct.credit)} | ${formatSignedCOP(acct.balance)} |`,
      );
    }
    if (accounts.length > 100) {
      lines.push(`| ... | *${accounts.length - 100} cuentas adicionales omitidas* | | | |`);
    }
    lines.push('');
  }

  // ── Totals ──
  // Sumas del periodo tal como las entrega el ERP. Débitos = créditos es una
  // condición necesaria de la partida doble, no prueba que los saldos cuadren.
  lines.push('## Sumas del Periodo');
  lines.push(`- **Total debitos:** ${formatCOP(tb.totalDebit)}`);
  lines.push(`- **Total creditos:** ${formatCOP(tb.totalCredit)}`);
  lines.push(`- **Diferencia débitos − créditos:** ${formatSignedCOP(tb.totalDebit - tb.totalCredit)}`);

  return lines.join('\n');
}

function formatInvoices(invoices: ERPInvoice[], range: DateRange): string {
  const lines: string[] = [];

  lines.push(`# Facturas — Periodo: ${range.label}`);
  lines.push(`Total de facturas: ${invoices.length}`);
  lines.push('');

  if (invoices.length === 0) {
    lines.push('No se encontraron facturas en el periodo consultado.');
    return lines.join('\n');
  }

  // ── Summary by Type ──
  const sales = invoices.filter(i => i.type === 'sale');
  const purchases = invoices.filter(i => i.type === 'purchase');
  const totalSales = sales.reduce((sum, i) => sum + i.total, 0);
  const totalPurchases = purchases.reduce((sum, i) => sum + i.total, 0);
  const totalTax = invoices.reduce((sum, i) => sum + i.taxTotal, 0);

  lines.push('## Resumen General');
  lines.push('');
  lines.push(`- **Facturas de venta:** ${sales.length} por ${formatCOP(totalSales)}`);
  lines.push(`- **Facturas de compra:** ${purchases.length} por ${formatCOP(totalPurchases)}`);
  lines.push(`- **IVA total:** ${formatCOP(totalTax)}`);
  lines.push(`- **Balance neto:** ${formatCOP(totalSales - totalPurchases)}`);
  lines.push('');

  // ── Summary by Status ──
  const statusCounts = new Map<string, { count: number; total: number }>();
  for (const inv of invoices) {
    const current = statusCounts.get(inv.status) ?? { count: 0, total: 0 };
    current.count++;
    current.total += inv.total;
    statusCounts.set(inv.status, current);
  }

  const statusLabels: Record<string, string> = {
    draft: 'Borrador',
    open: 'Abierta',
    paid: 'Pagada',
    overdue: 'Vencida',
    cancelled: 'Anulada',
  };

  lines.push('## Por Estado');
  lines.push('');
  lines.push('| Estado | Cantidad | Total |');
  lines.push('|--------|----------|-------|');
  for (const [status, data] of statusCounts) {
    lines.push(`| ${statusLabels[status] ?? status} | ${data.count} | ${formatCOP(data.total)} |`);
  }
  lines.push('');

  // ── Summary by Month ──
  const monthGroups = new Map<string, { count: number; total: number }>();
  for (const inv of invoices) {
    const month = inv.date.substring(0, 7); // YYYY-MM
    const current = monthGroups.get(month) ?? { count: 0, total: 0 };
    current.count++;
    current.total += inv.total;
    monthGroups.set(month, current);
  }

  lines.push('## Por Mes');
  lines.push('');
  lines.push('| Mes | Cantidad | Total |');
  lines.push('|-----|----------|-------|');
  for (const [month, data] of [...monthGroups.entries()].sort()) {
    lines.push(`| ${month} | ${data.count} | ${formatCOP(data.total)} |`);
  }
  lines.push('');

  // ── Top 15 Invoices ──
  const topInvoices = [...invoices]
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);

  lines.push('## Facturas de Mayor Valor');
  lines.push('');
  lines.push('| No. | Fecha | Tipo | Tercero | Subtotal | IVA | Total | Estado |');
  lines.push('|-----|-------|------|---------|----------|-----|-------|--------|');
  for (const inv of topInvoices) {
    const tipo = inv.type === 'sale' ? 'Venta' : 'Compra';
    const estado = statusLabels[inv.status] ?? inv.status;
    lines.push(
      `| ${inv.number} | ${inv.date} | ${tipo} | ${inv.contactName} | ${formatCOP(inv.subtotal)} | ${formatCOP(inv.taxTotal)} | ${formatCOP(inv.total)} | ${estado} |`,
    );
  }

  // ── Overdue Alert ──
  const overdue = invoices.filter(i => i.status === 'overdue');
  if (overdue.length > 0) {
    const overdueTotal = overdue.reduce((sum, i) => sum + i.total, 0);
    lines.push('');
    lines.push('## Alerta: Facturas Vencidas');
    lines.push('');
    lines.push(`Se encontraron **${overdue.length}** facturas vencidas por un total de **${formatCOP(overdueTotal)}**.`);
    lines.push('');
    for (const inv of overdue.slice(0, 10)) {
      lines.push(`- ${inv.number} — ${inv.contactName} — ${formatCOP(inv.total)} (vence: ${inv.dueDate ?? 'N/A'})`);
    }
  }

  return lines.join('\n');
}

function formatJournalEntries(entries: ERPJournalEntry[], range: DateRange): string {
  const lines: string[] = [];

  lines.push(`# Comprobantes Contables — Periodo: ${range.label}`);
  lines.push(`Total de comprobantes: ${entries.length}`);
  lines.push('');

  if (entries.length === 0) {
    lines.push('No se encontraron comprobantes contables en el periodo consultado.');
    return lines.join('\n');
  }

  // ── Summary ──
  const totalDebit = entries.reduce((sum, e) => sum + e.totalDebit, 0);
  const totalCredit = entries.reduce((sum, e) => sum + e.totalCredit, 0);
  const totalLines = entries.reduce((sum, e) => sum + e.lines.length, 0);

  lines.push('## Resumen General');
  lines.push('');
  lines.push(`- **Total comprobantes:** ${entries.length}`);
  lines.push(`- **Total lineas contables:** ${totalLines}`);
  lines.push(`- **Total debitos:** ${formatCOP(totalDebit)}`);
  lines.push(`- **Total creditos:** ${formatCOP(totalCredit)}`);
  lines.push('');

  // ── Summary by Month ──
  const monthGroups = new Map<string, { count: number; debit: number; credit: number }>();
  for (const entry of entries) {
    const month = entry.date.substring(0, 7);
    const current = monthGroups.get(month) ?? { count: 0, debit: 0, credit: 0 };
    current.count++;
    current.debit += entry.totalDebit;
    current.credit += entry.totalCredit;
    monthGroups.set(month, current);
  }

  lines.push('## Por Mes');
  lines.push('');
  lines.push('| Mes | Comprobantes | Debitos | Creditos |');
  lines.push('|-----|-------------|---------|----------|');
  for (const [month, data] of [...monthGroups.entries()].sort()) {
    lines.push(`| ${month} | ${data.count} | ${formatCOP(data.debit)} | ${formatCOP(data.credit)} |`);
  }
  lines.push('');

  // ── Top Accounts by Movement ──
  const accountMovements = new Map<string, { name: string; debit: number; credit: number }>();
  for (const entry of entries) {
    for (const line of entry.lines) {
      const key = line.accountCode;
      const current = accountMovements.get(key) ?? { name: line.accountName, debit: 0, credit: 0 };
      current.debit += line.debit;
      current.credit += line.credit;
      accountMovements.set(key, current);
    }
  }

  const topAccounts = [...accountMovements.entries()]
    .sort((a, b) => (b[1].debit + b[1].credit) - (a[1].debit + a[1].credit))
    .slice(0, 20);

  lines.push('## Cuentas con Mayor Movimiento');
  lines.push('');
  lines.push('| Codigo | Cuenta | Debitos | Creditos |');
  lines.push('|--------|--------|---------|----------|');
  for (const [code, data] of topAccounts) {
    lines.push(`| ${code} | ${data.name} | ${formatCOP(data.debit)} | ${formatCOP(data.credit)} |`);
  }
  lines.push('');

  // ── Top 10 Entries by Value ──
  const topEntries = [...entries]
    .sort((a, b) => b.totalDebit - a.totalDebit)
    .slice(0, 10);

  lines.push('## Comprobantes de Mayor Valor');
  lines.push('');
  lines.push('| ID | Fecha | Descripcion | Debito | Credito |');
  lines.push('|----|-------|-------------|--------|---------|');
  for (const entry of topEntries) {
    const desc = entry.description.length > 50
      ? entry.description.substring(0, 50) + '...'
      : entry.description;
    lines.push(
      `| ${entry.id} | ${entry.date} | ${desc} | ${formatCOP(entry.totalDebit)} | ${formatCOP(entry.totalCredit)} |`,
    );
  }

  return lines.join('\n');
}

function formatContacts(contacts: ERPContact[]): string {
  const lines: string[] = [];

  lines.push(`# Directorio de Terceros`);
  lines.push(`Total de contactos: ${contacts.length}`);
  lines.push('');

  if (contacts.length === 0) {
    lines.push('No se encontraron contactos registrados en el ERP.');
    return lines.join('\n');
  }

  // ── Summary by Type ──
  const customers = contacts.filter(c => c.type === 'customer');
  const suppliers = contacts.filter(c => c.type === 'supplier');
  const both = contacts.filter(c => c.type === 'both');

  lines.push('## Resumen');
  lines.push('');
  lines.push(`- **Clientes:** ${customers.length}`);
  lines.push(`- **Proveedores:** ${suppliers.length}`);
  lines.push(`- **Cliente y proveedor:** ${both.length}`);
  lines.push('');

  // ── Summary by City ──
  const cityCounts = new Map<string, number>();
  for (const c of contacts) {
    const city = c.city ?? 'Sin ciudad';
    cityCounts.set(city, (cityCounts.get(city) ?? 0) + 1);
  }

  if (cityCounts.size > 1) {
    const topCities = [...cityCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    lines.push('## Por Ciudad');
    lines.push('');
    lines.push('| Ciudad | Cantidad |');
    lines.push('|--------|----------|');
    for (const [city, count] of topCities) {
      lines.push(`| ${city} | ${count} |`);
    }
    lines.push('');
  }

  // ── Contact Table (up to 50) ──
  const typeLabels: Record<string, string> = {
    customer: 'Cliente',
    supplier: 'Proveedor',
    both: 'Ambos',
  };

  const displayContacts = contacts.slice(0, 50);

  lines.push('## Listado de Terceros');
  lines.push('');
  lines.push('| Nombre | NIT | Tipo | Ciudad | Email |');
  lines.push('|--------|-----|------|--------|-------|');
  for (const c of displayContacts) {
    lines.push(
      `| ${c.name} | ${c.nit ?? 'N/A'} | ${typeLabels[c.type] ?? c.type} | ${c.city ?? 'N/A'} | ${c.email ?? 'N/A'} |`,
    );
  }
  if (contacts.length > 50) {
    lines.push(`| ... | *${contacts.length - 50} contactos adicionales omitidos* | | | |`);
  }

  return lines.join('\n');
}

function formatChartOfAccounts(accounts: ERPAccount[], accountCodeFilter?: string): string {
  const lines: string[] = [];

  lines.push('# Plan de Cuentas');
  lines.push('');

  // Filter if accountCode is specified
  let filtered = accounts;
  if (accountCodeFilter) {
    filtered = accounts.filter(a => a.code.startsWith(accountCodeFilter));
    lines.push(`> Filtro aplicado: cuentas que inician con "${accountCodeFilter}"`);
    lines.push('');
  }

  lines.push(`Total de cuentas: ${filtered.length}`);
  lines.push('');

  if (filtered.length === 0) {
    lines.push('No se encontraron cuentas con el filtro aplicado.');
    return lines.join('\n');
  }

  // ── Summary by Class ──
  const classCounts = new Map<number, number>();
  for (const acct of filtered) {
    const cls = acct.pucClass ?? parseInt(acct.code.charAt(0), 10);
    if (!isNaN(cls)) {
      classCounts.set(cls, (classCounts.get(cls) ?? 0) + 1);
    }
  }

  lines.push('## Resumen por Clase');
  lines.push('');
  lines.push('| Clase | Nombre | Cuentas |');
  lines.push('|-------|--------|---------|');
  for (const [cls, count] of [...classCounts.entries()].sort((a, b) => a[0] - b[0])) {
    const name = PUC_CLASS_NAMES[cls] ?? `Clase ${cls}`;
    lines.push(`| ${cls} | ${name} | ${count} |`);
  }
  lines.push('');

  // ── Account Table (up to 100) ──
  const typeLabels: Record<string, string> = {
    asset: 'Activo',
    liability: 'Pasivo',
    equity: 'Patrimonio',
    revenue: 'Ingreso',
    expense: 'Gasto',
    cost: 'Costo',
  };

  const displayAccounts = filtered.slice(0, 100);

  lines.push('## Listado de Cuentas');
  lines.push('');
  lines.push('| Codigo | Cuenta | Tipo | Nivel | Auxiliar |');
  lines.push('|--------|--------|------|-------|----------|');
  for (const acct of displayAccounts) {
    const indent = '\u00A0\u00A0'.repeat(Math.max(0, acct.level - 1));
    lines.push(
      `| ${acct.code} | ${indent}${acct.name} | ${typeLabels[acct.type] ?? acct.type} | ${acct.level} | ${acct.isAuxiliary ? 'Si' : 'No'} |`,
    );
  }
  if (filtered.length > 100) {
    lines.push(`| ... | *${filtered.length - 100} cuentas adicionales omitidas* | | | |`);
  }

  return lines.join('\n');
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Query a connected ERP system and return formatted data for LLM consumption.
 *
 * Uses the FIRST connection in the erpConnections array (the user's primary ERP).
 * If no connections are provided, returns a clear message.
 */
export async function queryERP(
  args: QueryERPArgs,
  erpConnections: ERPConnectionInfo[],
): Promise<QueryERPResult> {
  // ── No ERP connected ──
  if (!erpConnections || erpConnections.length === 0) {
    return {
      content:
        'No hay ningun ERP conectado. Para consultar datos contables en tiempo real, ' +
        'conecte su sistema ERP (Alegra, Siigo, Helisa, SAP, QuickBooks, Xero, etc.) ' +
        'desde la seccion de Integraciones en la configuracion de 1+1.',
      provider: 'ninguno',
      recordCount: 0,
      period: args.period ?? 'N/A',
    };
  }

  const connection = erpConnections[0];
  const { provider } = connection;
  const credentials: ERPCredentials = {
    provider,
    ...connection.credentials,
  };

  // Periodo validado ANTES de llamar al ERP: un formato no soportado no debe
  // convertirse en fechas inválidas ni en un rango distinto al pedido.
  let range: DateRange;
  try {
    range = resolveDateRange(args);
  } catch (error) {
    if (!(error instanceof ERPPeriodError)) throw error;
    return {
      content:
        `${error.message} Periodo recibido: "${args.period ?? `${args.dateFrom ?? ''}..${args.dateTo ?? ''}`}". ` +
        'Ejemplos válidos: "2025", "2025-Q3", "2025-06" o dateFrom/dateTo en formato AAAA-MM-DD.',
      provider,
      recordCount: 0,
      period: args.period ?? 'N/A',
    };
  }

  try {
    const connector = await getConnector(provider);

    switch (args.type) {
      case 'trial_balance': {
        const tb = await connector.getTrialBalance(credentials, range.label);
        const content = formatTrialBalance(tb, args.accountCode);
        const recordCount = tb.balanceStatus === 'movements_only'
          ? tb.accounts.length
          : trialBalanceLeafAccounts(tb).length;
        return {
          content,
          provider,
          recordCount,
          period: tb.period,
        };
      }

      case 'invoices': {
        const invoices = await connector.getInvoices(credentials, range.dateFrom, range.dateTo);
        const content = formatInvoices(invoices, range);
        return {
          content,
          provider,
          recordCount: invoices.length,
          period: range.label,
        };
      }

      case 'journal_entries': {
        const entries = await connector.getJournalEntries(credentials, range.dateFrom, range.dateTo);
        const content = formatJournalEntries(entries, range);
        return {
          content,
          provider,
          recordCount: entries.length,
          period: range.label,
        };
      }

      case 'contacts': {
        const contacts = await connector.getContacts(credentials);
        const content = formatContacts(contacts);
        return {
          content,
          provider,
          recordCount: contacts.length,
          period: 'N/A',
        };
      }

      case 'chart_of_accounts': {
        const accounts = await connector.getChartOfAccounts(credentials);
        const content = formatChartOfAccounts(accounts, args.accountCode);
        const filtered = args.accountCode
          ? accounts.filter(a => a.code.startsWith(args.accountCode!))
          : accounts;
        return {
          content,
          provider,
          recordCount: filtered.length,
          period: 'N/A',
        };
      }

      default:
        return {
          content:
            `Tipo de consulta no reconocido: "${(args as unknown as Record<string, unknown>).type}". ` +
            'Tipos validos: trial_balance, invoices, journal_entries, contacts, chart_of_accounts.',
          provider,
          recordCount: 0,
          period: args.period ?? 'N/A',
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    console.error(`ERP query failed (${provider}):`, error);

    return {
      content:
        `Error al consultar el ERP (${provider}): ${errorMessage}\n\n` +
        'Posibles causas:\n' +
        '- Las credenciales del ERP han expirado o son invalidas\n' +
        '- El servicio del ERP no esta disponible temporalmente\n' +
        '- El periodo consultado no tiene datos registrados\n' +
        '- Hay un problema de conectividad con la API del ERP\n\n' +
        'Recomendacion: Verifique la conexion del ERP desde la seccion de Integraciones.',
      provider,
      recordCount: 0,
      period: args.period ?? 'N/A',
    };
  }
}
