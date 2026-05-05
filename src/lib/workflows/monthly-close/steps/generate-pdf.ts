// ─── WS5 — Step: generate-pdf ────────────────────────────────────────────────
// Genera el PDF élite gold/black del período cerrado y lo sube a Vercel Blob.
// Si BLOB_READ_WRITE_TOKEN no está configurado, loggea warning y retorna null.

import type { CloseMonthInput } from '@/lib/accounting/closing/types';
import { getPeriodById } from '../repository';

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
    const filename = `closing-reports/${workspaceId}/${period.year}-${String(period.month).padStart(2, '0')}/informe-cierre-elite.pdf`;

    const { url } = await put(filename, pdfBuffer, {
      access: 'public',
      contentType: 'application/pdf',
    });

    return url;
  } catch (err) {
    console.error('[generate-pdf] Error generando PDF:', err);
    return null;
  }
}
