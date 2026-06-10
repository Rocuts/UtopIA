import ExcelJS from 'exceljs';
import { NextResponse, type NextRequest } from 'next/server';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import * as repo from '@/lib/db/pyme';
import { assertBookOwned, HttpError } from '../../../_lib/ownership';

// ---------------------------------------------------------------------------
// GET /api/pyme/books/[bookId]/export.xlsx
// ---------------------------------------------------------------------------
// Exporta todas las entradas del libro como archivo Excel (.xlsx):
//   • Hoja 1 "Movimientos" — listado completo con formato corporativo
//   • Hoja 2 "Resumen"     — totales ingresos / egresos / margen por mes
//
// Devuelve application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
// con Content-Disposition: attachment para forzar descarga directa.
// ---------------------------------------------------------------------------

type RouteContext = { params: Promise<{ bookId: string }> };

const CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { bookId } = await ctx.params;
    const ws = await getOrCreateWorkspace();
    const book = await assertBookOwned(bookId, ws.id);

    // Fetch all entries — no status filter so exportamos draft + confirmed
    const entries = await repo.listEntries({ bookId, limit: 5000 });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'UtopIA 1+1';
    wb.created = new Date();

    // ── Hoja 1: Movimientos ──────────────────────────────────────────────────
    const wsSheet = wb.addWorksheet('Movimientos');

    wsSheet.columns = [
      { header: 'Fecha',       key: 'date',        width: 14 },
      { header: 'Descripción', key: 'description', width: 40 },
      { header: 'Tipo',        key: 'kind',        width: 10 },
      { header: 'Monto (COP)', key: 'amount',      width: 18 },
      { header: 'Categoría',   key: 'category',    width: 22 },
      { header: 'PUC',         key: 'puc',         width: 12 },
      { header: 'Estado',      key: 'status',      width: 12 },
    ];

    // Cabecera en negrita con fondo azul oscuro
    const headerRow = wsSheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    headerRow.alignment = { horizontal: 'center' };

    for (const entry of entries) {
      const row = wsSheet.addRow({
        date:        entry.entryDate.toISOString().slice(0, 10),
        description: entry.description,
        kind:        entry.kind === 'ingreso' ? 'Ingreso' : 'Egreso',
        amount:      Number(entry.amount),
        category:    entry.category ?? '',
        puc:         entry.pucHint ?? '',
        status:      entry.status === 'confirmed' ? 'Confirmado' : 'Borrador',
      });

      // Color por tipo
      const amountCell = row.getCell('amount');
      amountCell.numFmt = '#,##0.00';
      amountCell.font = {
        color: { argb: entry.kind === 'ingreso' ? 'FF1A7A4A' : 'FFB71C1C' },
      };

      // Fila gris suave para borradores
      if (entry.status === 'draft') {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
      }
    }

    wsSheet.autoFilter = { from: 'A1', to: 'G1' };

    // ── Hoja 2: Resumen mensual ──────────────────────────────────────────────
    const summary = wb.addWorksheet('Resumen');

    summary.columns = [
      { header: 'Mes',       key: 'month',    width: 14 },
      { header: 'Ingresos',  key: 'ingresos', width: 18 },
      { header: 'Egresos',   key: 'egresos',  width: 18 },
      { header: 'Margen',    key: 'margen',   width: 18 },
    ];

    const summaryHeader = summary.getRow(1);
    summaryHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    summaryHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    summaryHeader.alignment = { horizontal: 'center' };

    // Agrupar entradas confirmadas por YYYY-MM
    const monthBuckets: Record<string, { ingresos: number; egresos: number }> = {};
    for (const entry of entries) {
      if (entry.status !== 'confirmed') continue;
      const key = entry.entryDate.toISOString().slice(0, 7); // YYYY-MM
      if (!monthBuckets[key]) monthBuckets[key] = { ingresos: 0, egresos: 0 };
      const amount = Number(entry.amount);
      if (entry.kind === 'ingreso') monthBuckets[key].ingresos += amount;
      else monthBuckets[key].egresos += amount;
    }

    for (const [month, totals] of Object.entries(monthBuckets).sort()) {
      const row = summary.addRow({
        month,
        ingresos: totals.ingresos,
        egresos:  totals.egresos,
        margen:   totals.ingresos - totals.egresos,
      });
      ['ingresos', 'egresos', 'margen'].forEach((col) => {
        row.getCell(col).numFmt = '#,##0.00';
      });
      const margenCell = row.getCell('margen');
      const margen = totals.ingresos - totals.egresos;
      margenCell.font = { color: { argb: margen >= 0 ? 'FF1A7A4A' : 'FFB71C1C' } };
    }

    const buffer = await wb.xlsx.writeBuffer();
    const safeBookName = book.name.replace(/[^a-zA-Z0-9\-_]/g, '_').slice(0, 40);

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type':        CONTENT_TYPE,
        'Content-Disposition': `attachment; filename="${safeBookName}.xlsx"`,
        'Cache-Control':       'no-store',
      },
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('[pyme/books/[bookId]/export.xlsx]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'internal_error' },
      { status: 500 },
    );
  }
}
