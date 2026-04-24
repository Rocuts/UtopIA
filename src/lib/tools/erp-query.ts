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
  label: string;
}

/**
 * Parse a period string into a concrete date range.
 *
 *   "2025"     → 2025-01-01 to 2025-12-31
 *   "2025-Q1"  → 2025-01-01 to 2025-03-31
 *   "2025-Q2"  → 2025-04-01 to 2025-06-30
 *   "2025-Q3"  → 2025-07-01 to 2025-09-30
 *   "2025-Q4"  → 2025-10-01 to 2025-12-31
 */
function parsePeriod(period: string): DateRange {
  const quarterMatch = period.match(/^(\d{4})-Q([1-4])$/i);
  if (quarterMatch) {
    const year = quarterMatch[1];
    const quarter = parseInt(quarterMatch[2], 10);
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const lastDay = new Date(parseInt(year, 10), endMonth, 0).getDate();
    return {
      dateFrom: `${year}-${String(startMonth).padStart(2, '0')}-01`,
      dateTo: `${year}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      label: `${year} T${quarter}`,
    };
  }

  const yearMatch = period.match(/^(\d{4})$/);
  if (yearMatch) {
    return {
      dateFrom: `${yearMatch[1]}-01-01`,
      dateTo: `${yearMatch[1]}-12-31`,
      label: yearMatch[1],
    };
  }

  // Fall back: treat as-is, label with the raw string
  return {
    dateFrom: period,
    dateTo: period,
    label: period,
  };
}

/**
 * Resolve the effective date range from explicit dates or a period string.
 * Explicit dateFrom/dateTo take precedence over the period shorthand.
 */
function resolveDateRange(args: QueryERPArgs): DateRange {
  if (args.dateFrom && args.dateTo) {
    return {
      dateFrom: args.dateFrom,
      dateTo: args.dateTo,
      label: `${args.dateFrom} a ${args.dateTo}`,
    };
  }

  if (args.period) {
    return parsePeriod(args.period);
  }

  // Default to current year
  const year = new Date().getFullYear().toString();
  return parsePeriod(year);
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

function formatTrialBalance(tb: ERPTrialBalance, accountCodeFilter?: string): string {
  const lines: string[] = [];

  lines.push(`# Balance de Prueba — ${tb.companyName}`);
  if (tb.companyNit) lines.push(`NIT: ${tb.companyNit}`);
  lines.push(`Periodo: ${tb.period} | Moneda: ${tb.currency}`);
  lines.push(`Generado: ${tb.generatedAt}`);
  lines.push('');

  // Filter accounts if accountCode is specified
  let accounts = tb.accounts;
  if (accountCodeFilter) {
    accounts = accounts.filter(a => a.code.startsWith(accountCodeFilter));
    lines.push(`> Filtro aplicado: cuentas que inician con "${accountCodeFilter}"`);
    lines.push('');
  }

  // ── PUC Class Summary ──
  const classTotals = new Map<number, { debit: number; credit: number; balance: number }>();
  for (const acct of accounts) {
    const cls = acct.pucClass ?? parseInt(acct.code.charAt(0), 10);
    if (isNaN(cls)) continue;
    const current = classTotals.get(cls) ?? { debit: 0, credit: 0, balance: 0 };
    // Only sum auxiliaries to avoid double-counting
    if (acct.isAuxiliary) {
      current.debit += acct.debit;
      current.credit += acct.credit;
      current.balance += acct.balance;
    }
    classTotals.set(cls, current);
  }

  lines.push('## Resumen por Clase PUC');
  lines.push('');
  lines.push('| Clase | Nombre | Debitos | Creditos | Saldo |');
  lines.push('|-------|--------|---------|----------|-------|');
  for (const [cls, totals] of [...classTotals.entries()].sort((a, b) => a[0] - b[0])) {
    const name = PUC_CLASS_NAMES[cls] ?? `Clase ${cls}`;
    lines.push(
      `| ${cls} | ${name} | ${formatCOP(totals.debit)} | ${formatCOP(totals.credit)} | ${formatCOP(totals.balance)} |`,
    );
  }
  lines.push('');

  // ── Key Financial Highlights ──
  const totalRevenue = classTotals.get(4)?.balance ?? 0;
  const totalExpenses = classTotals.get(5)?.balance ?? 0;
  const totalCosts = classTotals.get(6)?.balance ?? 0;
  const totalAssets = classTotals.get(1)?.balance ?? 0;
  const totalLiabilities = classTotals.get(2)?.balance ?? 0;
  const totalEquity = classTotals.get(3)?.balance ?? 0;

  lines.push('## Cifras Clave');
  lines.push('');
  lines.push(`- **Ingresos totales:** ${formatCOP(Math.abs(totalRevenue))}`);
  lines.push(`- **Gastos totales:** ${formatCOP(Math.abs(totalExpenses))}`);
  lines.push(`- **Costos de venta:** ${formatCOP(Math.abs(totalCosts))}`);
  lines.push(`- **Resultado operacional:** ${formatCOP(Math.abs(totalRevenue) - Math.abs(totalExpenses) - Math.abs(totalCosts))}`);
  lines.push(`- **Total activos:** ${formatCOP(Math.abs(totalAssets))}`);
  lines.push(`- **Total pasivos:** ${formatCOP(Math.abs(totalLiabilities))}`);
  lines.push(`- **Total patrimonio:** ${formatCOP(Math.abs(totalEquity))}`);
  lines.push('');

  // ── Detailed Accounts Table ──
  // Show auxiliary accounts (up to 100 to keep output manageable)
  const detailAccounts = accounts
    .filter(a => a.isAuxiliary)
    .slice(0, 100);

  if (detailAccounts.length > 0) {
    lines.push('## Detalle de Cuentas Auxiliares');
    lines.push('');
    lines.push('| Codigo | Cuenta | Debitos | Creditos | Saldo |');
    lines.push('|--------|--------|---------|----------|-------|');
    for (const acct of detailAccounts) {
      lines.push(
        `| ${acct.code} | ${acct.name} | ${formatCOP(acct.debit)} | ${formatCOP(acct.credit)} | ${formatCOP(acct.balance)} |`,
      );
    }
    if (accounts.filter(a => a.isAuxiliary).length > 100) {
      lines.push(`| ... | *${accounts.filter(a => a.isAuxiliary).length - 100} cuentas adicionales omitidas* | | | |`);
    }
    lines.push('');
  }

  // ── Totals ──
  lines.push('## Totales');
  lines.push(`- **Total debitos:** ${formatCOP(tb.totalDebit)}`);
  lines.push(`- **Total creditos:** ${formatCOP(tb.totalCredit)}`);
  const diff = Math.abs(tb.totalDebit - tb.totalCredit);
  if (diff > 1) {
    lines.push(`- **Diferencia:** ${formatCOP(diff)} (el balance NO cuadra)`);
  } else {
    lines.push('- **Diferencia:** $0 (el balance cuadra correctamente)');
  }

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

  try {
    const connector = await getConnector(provider);
    const range = resolveDateRange(args);

    switch (args.type) {
      case 'trial_balance': {
        const periodLabel = args.period ?? range.label;
        const tb = await connector.getTrialBalance(credentials, periodLabel);
        const content = formatTrialBalance(tb, args.accountCode);
        const recordCount = tb.accounts.filter(a => a.isAuxiliary).length;
        return {
          content,
          provider,
          recordCount,
          period: periodLabel,
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
            `Tipo de consulta no reconocido: "${(args as any).type}". ` +
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
