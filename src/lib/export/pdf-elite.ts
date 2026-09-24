// ─── PDF Élite — Dark Premium Gold/Black ──────────────────────────────────────
// Informe de cierre mensual con sello de integridad hash.
//
// Páginas:
//   1. Cover (logo, workspace, período, certificado de integridad)
//   2. Estado de situación financiera a la fecha de corte
//   3. Estado de resultados del período
//   4. 4 KPIs por pilar (Resiliencia / Valor / Verdad / Futuro)
//
// Auditoría 2026-09 (contab-nomina-02, reportes-export-03). La versión anterior:
//   - filtraba período y estado en el ON del segundo LEFT JOIN y sumaba sobre
//     `journal_lines`, así que agregaba movimientos de TODOS los períodos, de
//     borradores y de asientos reversados;
//   - como el PDF se genera DESPUÉS del asiento de cierre, el P&G del mes
//     quedaba en cero y lo que se veía eran saldos de otros meses;
//   - descartaba activos con saldo ≤ 0 (correctoras 1592/1399), pasivos con
//     saldo deudor, sumaba patrimonio y resultados con Math.abs y no verificaba
//     Activo = Pasivo + Patrimonio, bajo la leyenda "valor probatorio".
// Ahora los saldos salen de una consulta con filtros en WHERE/FILTER, en
// centavos BigInt, firmados por naturaleza, y el documento se BLOQUEA (throw)
// si el balance no cuadra.

import { jsPDF } from 'jspdf';
import type { AccountingPeriodRow } from '@/lib/db/schema';
import { getDb } from '@/lib/db/client';
import { sql } from 'drizzle-orm';
import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import { parseCOPToCentavos } from '@/lib/format/cop';

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

/** Centavos firmados → "$1.234.567,89" / "($1.234.567,89)" (convención NIIF). */
function cop(cents: bigint): string {
  return formatCopFromCents(cents, false);
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

// ─── Consulta de saldos ──────────────────────────────────────────────────────

export interface MonthlyAccountRow {
  code: string;
  name: string;
  type: string;
  /** Σ(débito − crédito) de todos los períodos con cierre ≤ corte (incluye el asiento de cierre). */
  balanceToDateCents: bigint;
  /** Σ(débito − crédito) del período, SIN el asiento de cierre (P&G del mes). */
  periodMovementCents: bigint;
}

/**
 * Consulta de saldos del cierre mensual.
 *
 * - INNER JOIN con `journal_entries` y `accounting_periods`: sólo cuentan
 *   líneas de asientos del workspace, nunca líneas huérfanas de otro período.
 * - Estado `posted` y `reversed`: al reversar, el original pasa a `reversed` y
 *   el asiento espejo (`source_type = 'reversal'`) queda `posted`; ambos deben
 *   sumarse para que el efecto neto sea cero. Filtrar sólo `posted` dejaría el
 *   reverso sin su original (efecto neto = −original). Los borradores (`draft`)
 *   nunca cuentan.
 * - Saldo a la fecha de corte: períodos cuyo `ends_at` ≤ el del período.
 * - Movimiento del período: `period_id` = período y sin el asiento de cierre
 *   (`source_type <> 'closing'`), que deja en cero las cuentas de resultado.
 * - Sumas en NUMERIC y devueltas como texto (sin `parseFloat`).
 */
export function monthlyBalancesQuery(workspaceId: string, periodId: string) {
  return sql`
    SELECT
      ca.code,
      ca.name,
      ca.type,
      COALESCE(SUM(jl.functional_debit - jl.functional_credit)
        FILTER (WHERE ap.ends_at <= cut.ends_at), 0)::text AS balance_to_date,
      COALESCE(SUM(jl.functional_debit - jl.functional_credit)
        FILTER (WHERE je.period_id = ${periodId} AND je.source_type <> 'closing'), 0)::text AS period_movement
    FROM chart_of_accounts ca
    JOIN journal_lines jl
      ON jl.account_id = ca.id
     AND jl.workspace_id = ${workspaceId}
    JOIN journal_entries je
      ON je.id = jl.entry_id
     AND je.workspace_id = ${workspaceId}
    JOIN accounting_periods ap
      ON ap.id = je.period_id
     AND ap.workspace_id = ${workspaceId}
    CROSS JOIN (
      SELECT ends_at FROM accounting_periods
      WHERE id = ${periodId} AND workspace_id = ${workspaceId}
    ) AS cut
    WHERE ca.workspace_id = ${workspaceId}
      AND ca.is_postable = true
      AND je.status IN ('posted', 'reversed')
      AND ap.ends_at <= cut.ends_at
    GROUP BY ca.id, ca.code, ca.name, ca.type
    ORDER BY ca.code
  `;
}

function toCents(raw: unknown, what: string): bigint {
  const cents = parseCOPToCentavos(typeof raw === 'number' ? String(raw) : (raw as string | null | undefined));
  if (cents === null) {
    throw new Error(`PDF de cierre: saldo no interpretable en ${what}.`);
  }
  return BigInt(cents);
}

async function getAccountBalances(workspaceId: string, periodId: string): Promise<MonthlyAccountRow[]> {
  const db = getDb();
  const result = await db.execute(monthlyBalancesQuery(workspaceId, periodId));
  const rows = (result as unknown as {
    rows?: Array<{ code: string; name: string; type: string; balance_to_date: string; period_movement: string }>;
  }).rows ?? [];
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    type: r.type,
    balanceToDateCents: toCents(r.balance_to_date, r.code),
    periodMovementCents: toCents(r.period_movement, r.code),
  }));
}

// ─── Estados (puro, testeable) ───────────────────────────────────────────────

export interface MonthlyStatementLine {
  code: string;
  name: string;
  /** Saldo firmado por naturaleza: positivo = saldo normal; negativo = contrario (p. ej. correctoras). */
  amountCents: bigint;
}

export interface MonthlyStatements {
  balance: {
    activos: MonthlyStatementLine[];
    pasivos: MonthlyStatementLine[];
    patrimonio: MonthlyStatementLine[];
    /** Resultado acumulado en cuentas de resultado aún no trasladado a patrimonio. */
    resultadoNoTrasladadoCents: bigint;
    totalActivosCents: bigint;
    totalPasivosCents: bigint;
    /** Incluye el resultado no trasladado. */
    totalPatrimonioCents: bigint;
    /** Activo − (Pasivo + Patrimonio). Debe ser 0. */
    diferenciaCents: bigint;
  };
  pnl: {
    ingresos: MonthlyStatementLine[];
    costosGastos: MonthlyStatementLine[];
    totalIngresosCents: bigint;
    totalCostosGastosCents: bigint;
    utilidadCents: bigint;
  };
}

const ZERO = BigInt(0);
const sum = (lines: MonthlyStatementLine[]) => lines.reduce((a, l) => a + l.amountCents, ZERO);

/**
 * Estados del cierre mensual con signo por naturaleza (sin filtros por signo ni
 * `Math.abs`): las correctoras (1592, 1399) restan dentro del activo, un pasivo
 * con saldo deudor resta del pasivo, las pérdidas acumuladas restan del
 * patrimonio y una devolución 4175 resta de los ingresos.
 */
export function buildMonthlyStatements(rows: MonthlyAccountRow[]): MonthlyStatements {
  const debitNature = (r: MonthlyAccountRow, v: bigint): MonthlyStatementLine => ({ code: r.code, name: r.name, amountCents: v });
  const creditNature = (r: MonthlyAccountRow, v: bigint): MonthlyStatementLine => ({ code: r.code, name: r.name, amountCents: -v });

  const activos: MonthlyStatementLine[] = [];
  const pasivos: MonthlyStatementLine[] = [];
  const patrimonio: MonthlyStatementLine[] = [];
  const ingresos: MonthlyStatementLine[] = [];
  const costosGastos: MonthlyStatementLine[] = [];
  let resultadoAcumulado = ZERO; // ingresos (C−D) − gastos/costos (D−C), saldo a la fecha

  for (const r of rows) {
    const bal = r.balanceToDateCents;
    const mov = r.periodMovementCents;
    switch (r.type) {
      case 'ACTIVO':
        if (bal !== ZERO) activos.push(debitNature(r, bal));
        break;
      case 'PASIVO':
        if (bal !== ZERO) pasivos.push(creditNature(r, bal));
        break;
      case 'PATRIMONIO':
        if (bal !== ZERO) patrimonio.push(creditNature(r, bal));
        break;
      case 'INGRESO':
        resultadoAcumulado += -bal;
        if (mov !== ZERO) ingresos.push(creditNature(r, mov));
        break;
      case 'GASTO':
      case 'COSTO':
        resultadoAcumulado -= bal;
        if (mov !== ZERO) costosGastos.push(debitNature(r, mov));
        break;
      default:
        // Cuentas de orden: no forman parte de los estados. Si no se compensan
        // entre sí, el descuadre aparece en la diferencia A − (P + C).
        break;
    }
  }

  const totalActivos = sum(activos);
  const totalPasivos = sum(pasivos);
  const totalPatrimonio = sum(patrimonio) + resultadoAcumulado;
  const totalIngresos = sum(ingresos);
  const totalCostosGastos = sum(costosGastos);
  return {
    balance: {
      activos,
      pasivos,
      patrimonio,
      resultadoNoTrasladadoCents: resultadoAcumulado,
      totalActivosCents: totalActivos,
      totalPasivosCents: totalPasivos,
      totalPatrimonioCents: totalPatrimonio,
      diferenciaCents: totalActivos - totalPasivos - totalPatrimonio,
    },
    pnl: {
      ingresos,
      costosGastos,
      totalIngresosCents: totalIngresos,
      totalCostosGastosCents: totalCostosGastos,
      utilidadCents: totalIngresos - totalCostosGastos,
    },
  };
}

/**
 * Recorta una lista para la página sin romper la suma: si hay más renglones que
 * `max`, los restantes se agregan en "Otras cuentas (n)" con su suma, de modo
 * que el total impreso sea siempre la suma de las líneas impresas.
 */
export function linesForPage(lines: MonthlyStatementLine[], max: number): MonthlyStatementLine[] {
  if (lines.length <= max) return lines;
  const shown = lines.slice(0, max - 1);
  const rest = lines.slice(max - 1);
  return [...shown, { code: '', name: `Otras cuentas (${rest.length})`, amountCents: sum(rest) }];
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

function periodLabel(period: AccountingPeriodRow): string {
  return `${period.year}-${String(period.month).padStart(2, '0')}`;
}

function cutDateLabel(period: AccountingPeriodRow): string {
  const d = period.endsAt instanceof Date ? period.endsAt : new Date(period.endsAt as unknown as string);
  return Number.isNaN(d.getTime())
    ? periodLabel(period)
    : d.toLocaleDateString('es-CO', { dateStyle: 'long', timeZone: 'UTC' });
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
  doc.text(`Período ${periodLabel(period)}`, 105, 58, { align: 'center' });

  drawGoldAccent(doc, 65);

  // Workspace
  doc.setFontSize(11);
  setTextColor(doc, C.GRAY);
  doc.text('Workspace ID', 25, 80);
  doc.setFontSize(13);
  setTextColor(doc, C.WHITE);
  doc.text(workspaceId, 25, 87);

  // Fecha de corte (fin del período) y fecha de generación: son cosas distintas.
  doc.setFontSize(11);
  setTextColor(doc, C.GRAY);
  doc.text('Fecha de corte', 25, 100);
  doc.setFontSize(13);
  setTextColor(doc, C.WHITE);
  doc.text(cutDateLabel(period), 25, 107);
  doc.setFontSize(8);
  setTextColor(doc, C.GRAY);
  doc.text(`Generado el ${new Date().toLocaleDateString('es-CO', { dateStyle: 'long' })}`, 25, 113);

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
  doc.text('Generado por UtopIA — Plataforma Contable y Financiera Colombia 2026', 105, 279, { align: 'center' });
  doc.text('Cifras en pesos colombianos (COP). Negativos entre paréntesis.', 105, 285, { align: 'center' });
  doc.text('Este documento tiene valor probatorio. El hash encadenado garantiza integridad.', 105, 291, { align: 'center' });
}

const LINE_H = 5.5;

/** Sección de estado: título, renglones (código, nombre, cifra firmada) y total. */
function drawSection(
  doc: jsPDF,
  y: number,
  title: string,
  lines: MonthlyStatementLine[],
  totalLabel: string,
  totalCents: bigint,
  titleColor: string,
): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  setTextColor(doc, titleColor);
  doc.text(title, 25, y);
  y += LINE_H + 1;

  for (const l of lines) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    setTextColor(doc, C.WHITE);
    doc.text(l.code ? `${l.code} ${l.name}` : l.name, 28, y, { maxWidth: 110 });
    setTextColor(doc, l.amountCents < ZERO ? C.NEGATIVE : C.WHITE);
    doc.text(cop(l.amountCents), 185, y, { align: 'right' });
    y += LINE_H;
  }

  drawGoldAccent(doc, y - 3, 160, 25);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  setTextColor(doc, C.GOLD);
  doc.text(totalLabel, 28, y + 1);
  doc.text(cop(totalCents), 185, y + 1, { align: 'right' });
  return y + LINE_H + 3;
}

function drawBalancePage(doc: jsPDF, st: MonthlyStatements, period: AccountingPeriodRow) {
  drawBackground(doc);
  setFill(doc, C.GOLD);
  doc.rect(0, 0, 210, 8, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  setTextColor(doc, C.GOLD);
  doc.text('ESTADO DE SITUACIÓN FINANCIERA', 105, 22, { align: 'center' });

  doc.setFontSize(10);
  setTextColor(doc, C.GRAY);
  doc.text(`Al ${cutDateLabel(period)} · Cifras en pesos colombianos (COP)`, 105, 30, { align: 'center' });

  drawGoldAccent(doc, 35);

  const b = st.balance;
  let y = 44;
  y = drawSection(doc, y, 'ACTIVOS', linesForPage(b.activos, 12), 'Total Activos', b.totalActivosCents, C.GOLD_LIGHT);
  y = drawSection(doc, y, 'PASIVOS', linesForPage(b.pasivos, 7), 'Total Pasivos', b.totalPasivosCents, C.GOLD_LIGHT);
  const patrimonioLines = linesForPage(b.patrimonio, 7);
  if (b.resultadoNoTrasladadoCents !== ZERO) {
    patrimonioLines.push({
      code: '',
      name: 'Resultado del ejercicio no trasladado',
      amountCents: b.resultadoNoTrasladadoCents,
    });
  }
  y = drawSection(doc, y, 'PATRIMONIO', patrimonioLines, 'Total Patrimonio', b.totalPatrimonioCents, C.GOLD_LIGHT);

  // Verificación A = P + C
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  setTextColor(doc, C.GOLD);
  doc.text('Total Pasivos + Patrimonio', 28, y);
  doc.text(cop(b.totalPasivosCents + b.totalPatrimonioCents), 185, y, { align: 'right' });
  y += LINE_H;
  setTextColor(doc, b.diferenciaCents === ZERO ? C.POSITIVE : C.NEGATIVE);
  doc.text('Diferencia Activo - (Pasivo + Patrimonio)', 28, y);
  doc.text(cop(b.diferenciaCents), 185, y, { align: 'right' });
}

function drawPnLPage(doc: jsPDF, st: MonthlyStatements, period: AccountingPeriodRow) {
  drawBackground(doc);
  setFill(doc, C.GOLD);
  doc.rect(0, 0, 210, 8, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  setTextColor(doc, C.GOLD);
  doc.text('ESTADO DE RESULTADOS', 105, 22, { align: 'center' });

  doc.setFontSize(10);
  setTextColor(doc, C.GRAY);
  doc.text(
    `Período ${periodLabel(period)} (antes del asiento de cierre) · Cifras en pesos colombianos (COP)`,
    105, 30, { align: 'center' },
  );

  drawGoldAccent(doc, 35);

  const p = st.pnl;
  let y = 44;
  y = drawSection(doc, y, 'INGRESOS', linesForPage(p.ingresos, 14), 'Total Ingresos', p.totalIngresosCents, C.POSITIVE);
  y = drawSection(doc, y, 'COSTOS Y GASTOS', linesForPage(p.costosGastos, 14), 'Total Costos y Gastos', p.totalCostosGastosCents, C.NEGATIVE);

  // Utilidad neta con signo: una pérdida sale entre paréntesis y rotulada.
  drawGoldAccent(doc, y, 160, 25);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  setTextColor(doc, p.utilidadCents >= ZERO ? C.GOLD : C.NEGATIVE);
  doc.text(p.utilidadCents >= ZERO ? 'UTILIDAD NETA' : 'PÉRDIDA NETA', 28, y);
  doc.text(cop(p.utilidadCents), 185, y, { align: 'right' });
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

  const statements = buildMonthlyStatements(await getAccountBalances(workspaceId, periodId));

  // Un documento con "valor probatorio" no se emite descuadrado.
  if (statements.balance.diferenciaCents !== ZERO) {
    throw new Error(
      `PDF de cierre bloqueado: Activo ≠ Pasivo + Patrimonio al corte del período ${periodLabel(period)} ` +
        `(diferencia ${cop(statements.balance.diferenciaCents)}).`,
    );
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Página 1: Cover
  drawCoverPage(doc, workspaceId, period, periodHash, previousPeriodHash, override);

  // Página 2: Balance
  doc.addPage();
  drawBalancePage(doc, statements, period);

  // Página 3: P&L
  doc.addPage();
  drawPnLPage(doc, statements, period);

  // Página 4: KPIs
  doc.addPage();
  drawKpiPage(doc);

  return Buffer.from(doc.output('arraybuffer'));
}
