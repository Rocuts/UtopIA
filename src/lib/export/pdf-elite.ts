// ─── PDF Élite — Dark Premium Gold/Black ──────────────────────────────────────
// Informe de cierre mensual con sello de integridad hash.
//
// Páginas:
//   1. Cover (logo, workspace, período, certificado de integridad)
//   2. Balance General (Activo vs Pasivo + Patrimonio)
//   3. Estado de Resultados (Ingresos vs Gastos/Costos)
//   4. 4 KPIs por pilar (Resiliencia / Valor / Verdad / Futuro)

import { jsPDF } from 'jspdf';
import type { AccountingPeriodRow } from '@/lib/db/schema';
import { getDb } from '@/lib/db/client';
import { accountingPeriods, chartOfAccounts, journalEntries, journalLines } from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';

// ─── Paleta élite ────────────────────────────────────────────────────────────
const C = {
  BLACK: '#0A0A0A',
  DARK: '#111111',
  CARD: '#1A1A1A',
  GOLD: '#C9A84C',
  GOLD_LIGHT: '#E8C97A',
  WHITE: '#F5F5F5',
  GRAY: '#888888',
  POSITIVE: '#4CAF50',
  NEGATIVE: '#F44336',
} as const;

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function setFill(doc: jsPDF, hex: string) {
  const [r, g, b] = hexToRgb(hex);
  doc.setFillColor(r, g, b);
}

function setTextColor(doc: jsPDF, hex: string) {
  const [r, g, b] = hexToRgb(hex);
  doc.setTextColor(r, g, b);
}

function setDrawColor(doc: jsPDF, hex: string) {
  const [r, g, b] = hexToRgb(hex);
  doc.setDrawColor(r, g, b);
}

function formatCOP(amount: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─── Input ───────────────────────────────────────────────────────────────────

export interface GenerateElitePdfInput {
  workspaceId: string;
  periodId: string;
  periodHash: string;
  period: AccountingPeriodRow;
  previousPeriodHash?: string;
  override?: boolean;
}

// ─── Queries de datos ────────────────────────────────────────────────────────

interface AccountBalance {
  code: string;
  name: string;
  type: string;
  balance: number;
}

async function getAccountBalances(workspaceId: string, periodId: string): Promise<AccountBalance[]> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT
      ca.code,
      ca.name,
      ca.type,
      COALESCE(SUM(jl.functional_debit), 0) - COALESCE(SUM(jl.functional_credit), 0) AS balance
    FROM chart_of_accounts ca
    LEFT JOIN journal_lines jl ON jl.account_id = ca.id AND jl.workspace_id = ${workspaceId}
    LEFT JOIN journal_entries je ON je.id = jl.entry_id AND je.period_id = ${periodId} AND je.status = 'posted'
    WHERE ca.workspace_id = ${workspaceId}
      AND ca.active = true
      AND ca.is_postable = true
    GROUP BY ca.id, ca.code, ca.name, ca.type
    HAVING COALESCE(SUM(jl.functional_debit), 0) - COALESCE(SUM(jl.functional_credit), 0) != 0
    ORDER BY ca.code
  `);

  const rows = (result as unknown as { rows?: Array<{ code: string; name: string; type: string; balance: string }> }).rows ?? [];
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    type: r.type,
    balance: parseFloat(r.balance),
  }));
}

// ─── Páginas ─────────────────────────────────────────────────────────────────

function drawBackground(doc: jsPDF) {
  setFill(doc, C.BLACK);
  doc.rect(0, 0, 210, 297, 'F');
}

function drawGoldAccent(doc: jsPDF, y: number, width = 160, x = 25) {
  setFill(doc, C.GOLD);
  doc.rect(x, y, width, 0.5, 'F');
}

function drawCoverPage(
  doc: jsPDF,
  workspaceId: string,
  period: AccountingPeriodRow,
  hash: string,
  previousHash: string,
  override: boolean,
) {
  drawBackground(doc);

  // Gold top bar
  setFill(doc, C.GOLD);
  doc.rect(0, 0, 210, 8, 'F');

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  setTextColor(doc, C.GOLD);
  doc.text('INFORME DE CIERRE', 105, 45, { align: 'center' });

  doc.setFontSize(20);
  setTextColor(doc, C.WHITE);
  const periodLabel = `${period.year}-${String(period.month).padStart(2, '0')}`;
  doc.text(`Período ${periodLabel}`, 105, 58, { align: 'center' });

  drawGoldAccent(doc, 65);

  // Workspace
  doc.setFontSize(11);
  setTextColor(doc, C.GRAY);
  doc.text('Workspace ID', 25, 80);
  doc.setFontSize(13);
  setTextColor(doc, C.WHITE);
  doc.text(workspaceId, 25, 87);

  // Fecha de cierre
  doc.setFontSize(11);
  setTextColor(doc, C.GRAY);
  doc.text('Fecha de cierre', 25, 100);
  doc.setFontSize(13);
  setTextColor(doc, C.WHITE);
  doc.text(new Date().toLocaleDateString('es-CO', { dateStyle: 'long' }), 25, 107);

  // Certificado de integridad
  drawGoldAccent(doc, 120);

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  setTextColor(doc, C.GOLD);
  doc.text('CERTIFICADO DE INTEGRIDAD', 25, 130);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  setTextColor(doc, C.GRAY);
  doc.text('Hash SHA-256 del período:', 25, 142);
  setTextColor(doc, C.GOLD_LIGHT);
  doc.setFontSize(7.5);
  // Split hash in two lines for readability
  doc.text(hash.slice(0, 32), 25, 150);
  doc.text(hash.slice(32), 25, 156);

  doc.setFontSize(9);
  setTextColor(doc, C.GRAY);
  doc.text('Hash período anterior:', 25, 168);
  setTextColor(doc, C.WHITE);
  doc.setFontSize(7.5);
  doc.text(previousHash.slice(0, 32), 25, 176);
  doc.text(previousHash.slice(32), 25, 182);

  if (override) {
    doc.setFontSize(10);
    setTextColor(doc, C.NEGATIVE);
    doc.setFont('helvetica', 'bold');
    doc.text('⚠ CERRADO CON SALVEDADES (override)', 25, 196);
  }

  drawGoldAccent(doc, 210);

  // Footer
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  setTextColor(doc, C.GRAY);
  doc.text('Generado por UtopIA — Plataforma Contable y Financiera Colombia 2026', 105, 285, { align: 'center' });
  doc.text('Este documento tiene valor probatorio. El hash encadenado garantiza integridad.', 105, 291, { align: 'center' });
}

function drawBalancePage(doc: jsPDF, balances: AccountBalance[], period: AccountingPeriodRow) {
  drawBackground(doc);
  setFill(doc, C.GOLD);
  doc.rect(0, 0, 210, 8, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  setTextColor(doc, C.GOLD);
  doc.text('BALANCE GENERAL', 105, 22, { align: 'center' });

  doc.setFontSize(11);
  setTextColor(doc, C.GRAY);
  const label = `Período ${period.year}-${String(period.month).padStart(2, '0')}`;
  doc.text(label, 105, 30, { align: 'center' });

  drawGoldAccent(doc, 35);

  const activos = balances.filter((b) => b.type === 'ACTIVO' && b.balance > 0);
  const pasivos = balances.filter((b) => b.type === 'PASIVO' && b.balance < 0);
  const patrimonio = balances.filter((b) => b.type === 'PATRIMONIO');

  const totalActivos = activos.reduce((s, b) => s + Math.abs(b.balance), 0);
  const totalPasivos = pasivos.reduce((s, b) => s + Math.abs(b.balance), 0);
  const totalPatrimonio = patrimonio.reduce((s, b) => s + Math.abs(b.balance), 0);

  let y = 45;
  const lineH = 7;

  // Activos
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  setTextColor(doc, C.GOLD_LIGHT);
  doc.text('ACTIVOS', 25, y);
  y += lineH;

  for (const a of activos.slice(0, 18)) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    setTextColor(doc, C.WHITE);
    doc.text(`${a.code} ${a.name}`, 28, y, { maxWidth: 110 });
    doc.text(formatCOP(Math.abs(a.balance)), 185, y, { align: 'right' });
    y += lineH - 1;
  }

  drawGoldAccent(doc, y, 160, 25);
  y += 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  setTextColor(doc, C.GOLD);
  doc.text('Total Activos', 28, y);
  doc.text(formatCOP(totalActivos), 185, y, { align: 'right' });
  y += lineH + 2;

  // Pasivos
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  setTextColor(doc, C.GOLD_LIGHT);
  doc.text('PASIVOS', 25, y);
  y += lineH;

  for (const p of pasivos.slice(0, 8)) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    setTextColor(doc, C.WHITE);
    doc.text(`${p.code} ${p.name}`, 28, y, { maxWidth: 110 });
    doc.text(formatCOP(Math.abs(p.balance)), 185, y, { align: 'right' });
    y += lineH - 1;
  }

  drawGoldAccent(doc, y, 80, 25);
  y += 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  setTextColor(doc, C.GOLD);
  doc.text('Total Pasivos + Patrimonio', 28, y);
  doc.text(formatCOP(totalPasivos + totalPatrimonio), 185, y, { align: 'right' });
}

function drawPnLPage(doc: jsPDF, balances: AccountBalance[], period: AccountingPeriodRow) {
  drawBackground(doc);
  setFill(doc, C.GOLD);
  doc.rect(0, 0, 210, 8, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  setTextColor(doc, C.GOLD);
  doc.text('ESTADO DE RESULTADOS', 105, 22, { align: 'center' });

  doc.setFontSize(11);
  setTextColor(doc, C.GRAY);
  doc.text(`Período ${period.year}-${String(period.month).padStart(2, '0')}`, 105, 30, { align: 'center' });

  drawGoldAccent(doc, 35);

  const ingresos = balances.filter((b) => b.type === 'INGRESO');
  const gastos = balances.filter((b) => b.type === 'GASTO' || b.type === 'COSTO');

  const totalIngresos = ingresos.reduce((s, b) => s + Math.abs(b.balance), 0);
  const totalGastos = gastos.reduce((s, b) => s + Math.abs(b.balance), 0);
  const utilidad = totalIngresos - totalGastos;

  let y = 45;
  const lineH = 7;

  // Ingresos
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  setTextColor(doc, C.POSITIVE);
  doc.text('INGRESOS', 25, y);
  y += lineH;

  for (const i of ingresos.slice(0, 15)) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    setTextColor(doc, C.WHITE);
    doc.text(`${i.code} ${i.name}`, 28, y, { maxWidth: 110 });
    doc.text(formatCOP(Math.abs(i.balance)), 185, y, { align: 'right' });
    y += lineH - 1;
  }

  drawGoldAccent(doc, y, 160, 25);
  y += 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  setTextColor(doc, C.POSITIVE);
  doc.text('Total Ingresos', 28, y);
  doc.text(formatCOP(totalIngresos), 185, y, { align: 'right' });
  y += lineH + 3;

  // Gastos
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  setTextColor(doc, C.NEGATIVE);
  doc.text('GASTOS Y COSTOS', 25, y);
  y += lineH;

  for (const g of gastos.slice(0, 12)) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    setTextColor(doc, C.WHITE);
    doc.text(`${g.code} ${g.name}`, 28, y, { maxWidth: 110 });
    doc.text(`(${formatCOP(Math.abs(g.balance))})`, 185, y, { align: 'right' });
    y += lineH - 1;
  }

  drawGoldAccent(doc, y, 160, 25);
  y += 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  setTextColor(doc, C.NEGATIVE);
  doc.text('Total Gastos y Costos', 28, y);
  doc.text(`(${formatCOP(totalGastos)})`, 185, y, { align: 'right' });
  y += lineH + 3;

  // Utilidad neta
  drawGoldAccent(doc, y, 160, 25);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  setTextColor(doc, utilidad >= 0 ? C.GOLD : C.NEGATIVE);
  doc.text(utilidad >= 0 ? 'UTILIDAD NETA' : 'PÉRDIDA NETA', 28, y);
  doc.text(formatCOP(Math.abs(utilidad)), 185, y, { align: 'right' });
}

function drawKpiPage(doc: jsPDF) {
  drawBackground(doc);
  setFill(doc, C.GOLD);
  doc.rect(0, 0, 210, 8, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  setTextColor(doc, C.GOLD);
  doc.text('KPIs POR PILAR', 105, 22, { align: 'center' });

  drawGoldAccent(doc, 30);

  const pillars = [
    { name: 'Resiliencia', icon: '⬡', description: 'Provisiones y capacidad de absorción de choques', value: 'Ver dashboard' },
    { name: 'Valor', icon: '◇', description: 'EBITDA y generación de valor económico', value: 'Ver dashboard' },
    { name: 'Verdad', icon: '△', description: 'Documentos verificados y precisión contable', value: 'Ver dashboard' },
    { name: 'Futuro', icon: '◎', description: 'Flujo de caja libre proyectado', value: 'Ver dashboard' },
  ];

  const cardW = 75;
  const cardH = 55;
  let col = 0;
  let row = 0;

  for (const p of pillars) {
    const x = 20 + col * 90;
    const y = 40 + row * 65;

    setFill(doc, C.CARD);
    doc.roundedRect(x, y, cardW, cardH, 3, 3, 'F');
    setDrawColor(doc, C.GOLD);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, cardW, cardH, 3, 3, 'S');

    doc.setFontSize(22);
    setTextColor(doc, C.GOLD);
    doc.text(p.icon, x + cardW / 2, y + 14, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    setTextColor(doc, C.WHITE);
    doc.text(p.name, x + cardW / 2, y + 24, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    setTextColor(doc, C.GRAY);
    const lines = doc.splitTextToSize(p.description, cardW - 10);
    doc.text(lines, x + cardW / 2, y + 32, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    setTextColor(doc, C.GOLD_LIGHT);
    doc.text(p.value, x + cardW / 2, y + 50, { align: 'center' });

    col++;
    if (col > 1) {
      col = 0;
      row++;
    }
  }

  // Nota
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  setTextColor(doc, C.GRAY);
  doc.text(
    'Los KPIs detallados están disponibles en el dashboard. Active UTOPIA_ENABLE_NOTIFICATIONS para datos en tiempo real.',
    105,
    220,
    { align: 'center', maxWidth: 160 },
  );
}

// ─── Función principal ───────────────────────────────────────────────────────

export async function generateElitePdf(input: GenerateElitePdfInput): Promise<Buffer> {
  const { workspaceId, periodId, periodHash, period, previousPeriodHash = '0'.repeat(64), override = false } = input;

  const balances = await getAccountBalances(workspaceId, periodId);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Página 1: Cover
  drawCoverPage(doc, workspaceId, period, periodHash, previousPeriodHash, override);

  // Página 2: Balance
  doc.addPage();
  drawBalancePage(doc, balances, period);

  // Página 3: P&L
  doc.addPage();
  drawPnLPage(doc, balances, period);

  // Página 4: KPIs
  doc.addPage();
  drawKpiPage(doc);

  return Buffer.from(doc.output('arraybuffer'));
}
