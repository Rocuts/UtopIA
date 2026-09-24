import { NextResponse } from 'next/server';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { ClientPreprocessedResult } from './client-preprocessed';
import { withServerRenderedClientReport } from './part-markdown';

// ---------------------------------------------------------------------------
// Informe que auditan las Partes IV/V (I5-1)
// ---------------------------------------------------------------------------
// /api/financial-audit (Parte IV), /api/financial-quality (Parte V) y
// /api/fiscal-audit-opinion (dictamen) reciben el informe del cliente y pasan
// su `consolidatedReport` a los LLM. Ese texto es Markdown del navegador: con
// un JSON honesto y una cifra falsa sólo en el texto, los auditores leían la
// cifra falsa como si fuera del informe. Aquí el servidor lo sustituye por el
// que produce desde el JSON validado de cada Parte —con sus veredictos, sellos
// y el preprocesado ya re-derivado—, igual que /consolidate y /export
// (`withServerRenderedClientReport`). Un informe sin las Partes I–III no
// tiene texto que el servidor pueda producir: 422, no se audita texto ajeno.
// ---------------------------------------------------------------------------

export const REPORT_PARTS_REQUIRED_CODE = 'REPORT_PARTS_REQUIRED';

export type AuditedReportResult = { ok: true; report: FinancialReport } | { ok: false; response: Response };

/**
 * `raw` es el `report` crudo del cuerpo (con el JSON de cada Parte, que el
 * esquema de validación de la ruta descarta); `client` el preprocesado ya
 * re-derivado (`resolveClientPreprocessed`).
 */
export function resolveAuditedReport(
  raw: unknown,
  client: Extract<ClientPreprocessedResult, { ok: true }>,
  language: 'es' | 'en',
): AuditedReportResult {
  const report = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as FinancialReport) : null;
  const rendered = report
    ? withServerRenderedClientReport(
        report,
        { preprocessed: client.preprocessed, adjustments: client.adjustments ?? null },
        language,
      )
    : null;
  if (rendered) return { ok: true, report: rendered };
  return {
    ok: false,
    response: NextResponse.json(
      {
        error:
          language === 'en'
            ? 'The report does not carry Parts I–III: the server cannot produce the text to be audited.'
            : 'El informe no trae las Partes I–III: el servidor no puede producir el texto que se audita.',
        code: REPORT_PARTS_REQUIRED_CODE,
      },
      { status: 422 },
    ),
  };
}
