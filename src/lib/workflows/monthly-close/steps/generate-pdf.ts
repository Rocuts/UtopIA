// ─── WS5 — Step: generate-pdf ────────────────────────────────────────────────
// Genera el PDF élite gold/black del período cerrado y lo sube a Vercel Blob.
// Si BLOB_READ_WRITE_TOKEN no está configurado, loggea warning y retorna null.

import { randomUUID } from 'node:crypto';
import type { CloseMonthInput } from '@/lib/accounting/closing/types';
import { getPeriodById } from '../repository';

/**
 * Clave del PDF de cierre en Blob: sin workspaceId ni ruta determinística.
 * Sólo el periodo (año-mes) queda legible para operación.
 */
export function closingReportBlobKey(year: number, month: number): string {
  return `closing-reports/${randomUUID()}/informe-cierre-${year}-${String(month).padStart(2, '0')}.pdf`;
}

export async function generatePdfReport(
  input: CloseMonthInput & { runId: string; hash: string },
): Promise<string | null> {
  'use step';

  const { workspaceId, periodId, hash } = input;

  const period = await getPeriodById(workspaceId, periodId);
  if (!period) {
    console.warn('[generate-pdf] Período no encontrado — PDF omitido.');
    return null;
  }

  try {
    // Importación dinámica para evitar cargar jspdf en el servidor si no se usa
    const { generateElitePdf } = await import('@/lib/export/pdf-elite');
    const pdfBuffer = await generateElitePdf({
      workspaceId,
      periodId,
      periodHash: hash,
      period,
    });

    // Subir a Vercel Blob
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.warn(
        '[generate-pdf] BLOB_READ_WRITE_TOKEN no configurado — PDF generado pero no subido.',
      );
      return null;
    }

    const { put } = await import('@vercel/blob');
    const filename = closingReportBlobKey(period.year, period.month);

    // reportes-export-23: el blob es `public` (el enlace viaja en la
    // notificación de cierre), así que su ruta no puede ser adivinable ni
    // llevar identificadores del tenant: prefijo aleatorio + `addRandomSuffix`
    // (mismo criterio que /api/pyme/uploads). Cada recierre produce un blob
    // nuevo en vez de chocar con el anterior (`allowOverwrite` es false por
    // defecto y el `put` fallaba). La relación PDF → workspace vive en
    // `monthly_close_runs.pdf_report_url`.
    const { url } = await put(filename, pdfBuffer, {
      access: 'public',
      addRandomSuffix: true,
      contentType: 'application/pdf',
    });

    return url;
  } catch (err) {
    console.error('[generate-pdf] Error generando PDF:', err);
    return null;
  }
}
