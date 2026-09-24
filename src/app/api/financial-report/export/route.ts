import { NextResponse } from 'next/server';
import { adjustmentLedgerSchema, unknownAdjustmentPeriodReasons } from '@/lib/reports/adjustment-ledger';
import { financialExportBlockers } from '@/lib/export/financial-export-validation';
import { Readable } from 'node:stream';
import { generateFinancialExcel } from '@/lib/export/excel-export';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import {
  preprocessUploadedTrialBalanceText,
  type UploadedTrialBalancePreprocess,
} from '@/lib/preprocessing/raw-data';
import {
  preprocessedAnchorMismatches,
  revivePreprocessedBalance,
} from '@/lib/preprocessing/json-safe';
import {
  orchestrateFinancialReport,
  BalanceValidationError,
} from '@/lib/agents/financial/orchestrator';
import { applyAdjustments } from '@/lib/agents/repair/adjustments';
import type { Adjustment, AdjustmentLedger } from '@/lib/agents/repair/types';
import {
  financialReportRequestSchema,
  exportFormatSchema,
} from '@/lib/validation/schemas';
import {
  composeEditorialReport,
  renderEditorialReportToStream,
} from '@/lib/export/pdf-elite-react';
import { aggregatePillars } from '@/lib/pillars/service';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { AuditReport } from '@/lib/agents/financial/audit/types';
import type { QualityAssessment } from '@/lib/agents/financial/quality/types';
import type { OutputOptionsToggle } from '@/lib/export/pdf-elite-react/types';
import { requireAuthSession } from '@/lib/auth/require-session';
import {
  resolvePersistedReport,
  type PersistedReportResolution,
} from '@/lib/reports/persisted-report-request';
import { rederivePreprocessedFromRows } from '@/lib/reports/preprocessed-integrity';
import { withServerPartVerdicts } from '@/lib/reports/part-verdicts';
import {
  withServerRenderedClientReport,
  withServerRenderedPersisted,
} from '@/lib/reports/part-markdown';
import { applyRequestConfirmations } from '@/lib/reports/ingest-confirmations';
import {
  appendPdfProvenance,
  isProvisionalDraft,
  provenanceHeaders,
  withExcelProvenance,
  type ArtifactProvenance,
} from '@/lib/reports/provenance-stamp';

// ---------------------------------------------------------------------------
// POST /api/financial-report/export
// ---------------------------------------------------------------------------
// Three modes:
//
// 1. FULL PIPELINE (Excel):    Send rawData + company → preprocess → 3 agents → .xlsx
// 2. EXPORT ONLY (Excel):      Send an existing FinancialReport → .xlsx
// 3. EDITORIAL PDF (pdf-elite): Send rawData + company + format='pdf-elite'
//                               → preprocess → 3 agents → editorial PDF
//
// Selection: body.format ∈ {'excel'|'pdf'|'pdf-elite'} (default 'excel').
// `pdf` is the legacy jsPDF format and is deprecated — prefer `pdf-elite`.
//
// Procedencia servidor (fase 2, P1): con `reportRef: {reportId, reportHash}`
// (la referencia que devuelve /consolidate) el informe y su balance se CARGAN
// de la versión persistida del workspace de la sesión y se exporta ESA
// versión; `report`, `rawData`, `preprocessed` y `adjustmentLedger` del cuerpo
// se ignoran. Referencia inválida → 400; de otro workspace o inexistente → 404
// (sin distinguir); huella distinta → 409. Sin referencia (informes históricos,
// modo sin DB) se conserva el comportamiento anterior y el artefacto se rotula
// "procedencia no verificada". Ver src/lib/reports/.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';
// 800 (no 300): los exports full-pipeline ejecutan orchestrateFinancialReport
// completo — con 300s Vercel mataba la function a mitad de run (504 sin
// payload). Mismo techo que /niif /strategy /governance.
export const maxDuration = 800;

// ---------------------------------------------------------------------------
// Una sola fuente por informe (pipeline-flujo-07)
// ---------------------------------------------------------------------------
// Los estados (Balance, P&G, EFE, ECP) salen de `report.niifAnalysis.json`; el
// KPI grid, la cascada, los diales, el anexo del PDF y las pestañas
// deterministas del Excel salen del preprocesado. Hasta ahora ese preprocesado
// se re-derivaba del `rawData` ORIGINAL — sin los ajustes del Doctor de Datos
// que /niif sí aplicó — y nadie comparaba las dos fuentes: un mismo PDF podía
// mostrar dos cifras para el mismo rubro. Ahora:
//   1. El preprocesado de exportación es el que usó /niif: el que envía el
//      cliente (`preprocessed`, ya ajustado) o el re-derivado de `rawData` con
//      el MISMO `adjustmentLedger` aplicado.
//   2. El JSON NIIF se cruza contra las anclas de ese preprocesado con el mismo
//      validador de /niif (`financialExportBlockers`, gate común con /html);
//      si difieren, la exportación se rechaza (422).
//   3. El `rawData` se lee con el helper compartido de /upload y /niif
//      (`preprocessUploadedTrialBalanceText`): CSV, bloques XLSX `[period=…]`
//      y texto con el informe de validación antepuesto (ingesta-01). Hojas en
//      conflicto o un rawData que no produce balance → 422, nunca una
//      exportación sin procedencia (pipeline-flujo-13).
// ---------------------------------------------------------------------------

/**
 * Lee el balance recibido como texto con la misma regla que /upload y /niif.
 * Un fallo inesperado del parser se trata como balance ilegible.
 */
function readRawData(rawData: string, label: string): UploadedTrialBalancePreprocess {
  try {
    return preprocessUploadedTrialBalanceText(rawData);
  } catch (err) {
    console.warn(`[${label}] preprocess failed:`, err instanceof Error ? err.message : err);
    return { kind: 'empty', tabular: true };
  }
}

/** 422 con los motivos de ingesta (hojas/periodos incompatibles). */
function ingestRejectedResponse(reasons: string[]): Response {
  return NextResponse.json(
    {
      error: 'El balance de prueba tiene inconsistencias criticas.',
      code: 'BALANCE_VALIDATION_FAILED',
      reasons,
      suggestedAccounts: [],
    },
    { status: 422 },
  );
}

// Contrato único del ledger (incluye `period` del ajuste multiperiodo).

type ExportSource =
  | {
      ok: true;
      preprocessed: PreprocessedBalance | undefined;
      /** Ajustes confirmados aplicados y su detalle (traza del consolidado, I3). */
      adjustments?: { applied: Adjustment[]; affected: ReturnType<typeof applyAdjustments>['affected'] };
      /** `rawData` efectivo (con las confirmaciones de ingesta) del que se derivó el preprocesado. */
      rawData?: string;
    }
  | { ok: false; response: Response };

/**
 * El preprocesado con el que se componen las superficies deterministas: el
 * mismo balance (ajustado) que usó /niif.
 *
 * niif-preproceso-33: el preprocesado que envía el cliente ya no se usa tal
 * cual. El servidor lo RE-DERIVA con el mismo `adjustmentLedger` que aplicó
 * /niif —desde el `rawData` de la petición o, si no hay `rawData` legible,
 * desde las filas crudas (`rawRows`) que trae el propio preprocesado— y usa el
 * re-derivado; si los totales de control del enviado no coinciden al centavo,
 * la exportación se rechaza (422). La procedencia completa (que ese balance es
 * el de la empresa) sólo la da la versión persistida (`reportRef`).
 */
function resolveExportPreprocessed(body: Record<string, unknown>, label: string): ExportSource {
  let claimed: PreprocessedBalance | undefined;
  if (body.preprocessed !== undefined && body.preprocessed !== null) {
    const revived = revivePreprocessedBalance(body.preprocessed);
    if (!revived) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Invalid preprocessed format.' }, { status: 400 }),
      };
    }
    claimed = revived;
  }

  const ledger = adjustmentLedgerSchema.safeParse(body.adjustmentLedger);
  if (!ledger.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Invalid adjustmentLedger format.',
          details: ledger.error.issues.map((i) => `adjustmentLedger.${i.path.join('.')}: ${i.message}`),
        },
        { status: 400 },
      ),
    };
  }
  const applied = ((ledger.data as AdjustmentLedger | undefined)?.adjustments ?? []).filter(
    (a) => a.status === 'applied',
  );

  // Sin `rawData` legible: se re-deriva desde las filas del propio preprocesado.
  const fromOwnRows = (): ExportSource => {
    if (!claimed) return { ok: true, preprocessed: undefined };
    const rederived = rederivePreprocessedFromRows(claimed, applied);
    if (!rederived.ok) return { ok: false, response: incoherentSourcesResponse(rederived.details) };
    return {
      ok: true,
      preprocessed: rederived.preprocessed,
      ...(applied.length > 0 ? { adjustments: { applied, affected: rederived.affected } } : {}),
    };
  };

  if (typeof body.rawData !== 'string' || body.rawData.trim().length === 0) {
    return fromOwnRows();
  }
  // Mismas confirmaciones de ingesta que /niif (unidad, vencimientos): sin
  // ellas un balance "en miles" se re-derivaría sin reexpresar (422 falso).
  const confirmed = applyRequestConfirmations(body, body.rawData);
  if (!confirmed.ok) return { ok: false, response: confirmed.response };
  const read = readRawData(confirmed.rawData, label);
  if (read.kind === 'rejected') return { ok: false, response: ingestRejectedResponse(read.reasons) };
  if (read.kind === 'empty') {
    // Mismo respaldo que /niif: sin filas legibles en `rawData` se usa el
    // preprocesado que trae la petición (re-derivado desde sus filas).
    if (claimed) return fromOwnRows();
    // El cliente envió un balance y no se pudo leer: sin preprocesado el gate
    // no puede cruzar el informe contra él. Conservador: no se exporta.
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Report is not exportable.',
          details: [
            read.tabular
              ? 'El balance de prueba enviado no produjo filas legibles (encabezado no reconocible o ' +
                'cifras ilegibles): no se puede verificar que el informe corresponda a ese balance.'
              : 'El texto enviado como balance de prueba no es un balance tabular: no se puede ' +
                'verificar que las cifras del informe correspondan a ese balance.',
          ],
        },
        { status: 422 },
      ),
    };
  }
  // Mismo paso que Stage 0.4 de /niif (`prepareFinancialContext`), incluido el
  // rechazo de un ajuste confirmado con un periodo inexistente.
  const periodErrors = unknownAdjustmentPeriodReasons(read.preprocessed, applied);
  if (periodErrors.length > 0) return { ok: false, response: incoherentSourcesResponse(periodErrors) };
  const application = applied.length === 0 ? null : applyAdjustments(read.preprocessed, applied);
  const derived = application ? application.balance : read.preprocessed;
  if (claimed) {
    const mismatches = preprocessedAnchorMismatches(claimed, derived);
    if (mismatches.length > 0) {
      return {
        ok: false,
        response: incoherentSourcesResponse([
          'Fuentes incoherentes — el balance preprocesado enviado no corresponde al balance de la ' +
            'solicitud re-derivado por el servidor (con los ajustes confirmados).',
          ...mismatches,
        ]),
      };
    }
  }
  return {
    ok: true,
    preprocessed: derived,
    rawData: confirmed.rawData,
    ...(application ? { adjustments: { applied, affected: application.affected } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Markdown de las Partes I–III (I3)
// ---------------------------------------------------------------------------
// El PDF (notas, acta, recomendaciones, punto de equilibrio, proyecciones) y el
// Excel (Parte II y pestaña Resumen = consolidado) imprimen el Markdown de las
// Partes. Ese texto se RE-RENDERIZA en el servidor desde el JSON de cada Parte
// (`withServerRenderedParts`) antes del gate y de componer el artefacto; el
// que trae el cuerpo o una versión persistida anterior se descarta:
//   - por referencia (`withServerRenderedPersisted`), en el consolidado
//     persistido (ensamblado por el servidor) se sustituye sólo el segmento de
//     las Partes y el gate de texto de /consolidate se recalcula sobre él;
//   - sin referencia, el consolidado se reconstruye entero con la misma
//     función que /consolidate y la traza de ajustes del ledger de la petición,
//     y su validación y bloqueantes de texto se pliegan sobre los recibidos.
// ---------------------------------------------------------------------------

function clientReportWithServerMarkdown(
  report: FinancialReport,
  source: Extract<ExportSource, { ok: true }>,
  language: 'es' | 'en',
): FinancialReport {
  // Sin las tres Partes no hay nada que re-renderizar: el gate lo rechaza
  // (informe incompleto / sin cifras estructuradas).
  return withServerRenderedClientReport(report, source, language) ?? report;
}

/**
 * Veredictos del informe que el pipeline completo acaba de producir en esta
 * misma petición: su Markdown es del servidor (no se re-renderiza) y una Parte
 * sin JSON no es texto del cliente, así que no se sella por esa sola razón.
 */
function serverGeneratedVerdicts(
  report: FinancialReport,
  preprocessed: PreprocessedBalance | undefined,
  language: 'es' | 'en',
): FinancialReport {
  return withServerPartVerdicts(report, preprocessed, language, { sealUnstructuredParts: false });
}

function incoherentSourcesResponse(details: string[]): Response {
  return NextResponse.json({ error: 'Report is not exportable.', details }, { status: 422 });
}

/**
 * Sello de las exportaciones sin referencia persistida; aclara BORRADOR si el
 * consolidado lleva el encabezado del override (pipeline-flujo-21).
 */
function unverified(report: FinancialReport | null | undefined): ArtifactProvenance {
  return isProvisionalDraft(report) ? { kind: 'unverified', draft: true } : { kind: 'unverified' };
}

/**
 * Exportación desde la versión persistida (procedencia servidor). El gate
 * común vuelve a correr sobre ESA versión y su balance (reglas vigentes); el
 * cuerpo sólo aporta presentación (formato, idioma, entregables del PDF).
 */
async function exportPersisted(
  persisted: Extract<PersistedReportResolution, { kind: 'ok' }>,
  body: Record<string, unknown>,
  format: 'excel' | 'pdf-elite',
): Promise<Response> {
  const { preprocessed, provenance } = persisted;
  const language: 'es' | 'en' = body.language === 'en' ? 'en' : 'es';
  // Veredictos con las reglas vigentes y Markdown re-renderizado desde el JSON
  // persistido (una versión anterior a I3 pudo guardar el texto del cliente).
  const report = withServerRenderedPersisted(persisted.report, preprocessed, language);
  const blocked = rejectInvalidExport(report, preprocessed);
  if (blocked) return blocked;
  const stamp: ArtifactProvenance = isProvisionalDraft(report)
    ? { kind: 'verified', provenance, draft: true }
    : { kind: 'verified', provenance };
  const headers = provenanceHeaders(stamp);

  if (format === 'pdf-elite') {
    let pillars = null;
    if (preprocessed?.primary) {
      try {
        pillars = aggregatePillars({
          snapshot: preprocessed.primary,
          comparative: preprocessed.comparative ?? null,
        });
      } catch (err) {
        console.warn('[pdf-elite/persisted] aggregatePillars failed:', err);
      }
    }
    const doc = composeEditorialReport({
      report,
      preprocessed: preprocessed ?? null,
      pillars,
      language,
      auditReport: (body.auditReport as AuditReport | null | undefined) ?? null,
      qualityReport: (body.qualityReport as QualityAssessment | null | undefined) ?? null,
      outputOptions: (body.outputOptions as OutputOptionsToggle | null | undefined) ?? null,
    });
    appendPdfProvenance(doc, stamp, language);
    const stream = await renderEditorialReportToStream(doc);
    return pdfResponse(stream, report.company.name, headers);
  }

  const buffer = await generateFinancialExcel({
    report: withExcelProvenance(report, stamp, language),
    preprocessed,
    language,
  });
  return createExcelResponse(buffer, report.company.name, headers);
}

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  try {
    let body;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
    }

    const formatParse = exportFormatSchema.safeParse(body?.format);
    if (!formatParse.success || formatParse.data === 'pdf') {
      return NextResponse.json({ error: "Unsupported format. Use 'excel' or 'pdf-elite'." }, { status: 400 });
    }
    const format = formatParse.data;

    // -----------------------------------------------------------------------
    // Versión persistida (procedencia servidor) — prevalece sobre el cuerpo.
    // -----------------------------------------------------------------------
    const persisted = await resolvePersistedReport(body);
    if (persisted.kind === 'error') return persisted.response;
    if (persisted.kind === 'ok') return await exportPersisted(persisted, body, format);

    // -----------------------------------------------------------------------
    // EDITORIAL PDF branch
    // -----------------------------------------------------------------------
    if (format === 'pdf-elite') {
      return await handlePdfElite(body);
    }

    // -----------------------------------------------------------------------
    // Mode 2 (Excel-only): pre-built report passthrough.
    // -----------------------------------------------------------------------
    if (body.report && body.report.consolidatedReport) {
      // Guard de shape mínimo antes del cast: un `report` malformado debe ser
      // 400, no TypeError 500 al leer `report.company.name`.
      if (typeof body.report?.company?.name !== 'string') {
        return NextResponse.json(
          { error: 'Invalid report format: company.name is required.' },
          { status: 400 },
        );
      }
      const source = resolveExportPreprocessed(body, 'export/excel');
      if (!source.ok) return source.response;
      const { preprocessed } = source;
      const excelLanguage: 'es' | 'en' = body.language === 'en' ? 'en' : 'es';
      const report = clientReportWithServerMarkdown(body.report as FinancialReport, source, excelLanguage);
      const blocked = rejectInvalidExport(report, preprocessed);
      if (blocked) return blocked;
      const stamp = unverified(report);
      const buffer = await generateFinancialExcel({
        report: withExcelProvenance(report, stamp, excelLanguage),
        preprocessed,
        language: excelLanguage,
      });
      return createExcelResponse(buffer, report.company.name, provenanceHeaders(stamp));
    }

    // -----------------------------------------------------------------------
    // Mode 1 (Excel full pipeline) — original behavior preserved verbatim.
    // -----------------------------------------------------------------------
    const parsed = financialReportRequestSchema.safeParse(body);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json({ error: 'Invalid request.', details: errors }, { status: 400 });
    }

    const { company, language, instructions } = parsed.data;
    const confirmed = applyRequestConfirmations(body, parsed.data.rawData);
    if (!confirmed.ok) return confirmed.response;
    const rawData = confirmed.rawData;

    const read = readRawData(rawData, 'export/full');
    if (read.kind === 'rejected') return ingestRejectedResponse(read.reasons);
    // Sin filas: el orquestador decide (balance tabular ilegible → 422; texto
    // no tabular, p. ej. OCR, sigue sin totales vinculantes declarados).
    const preprocessed = read.kind === 'ok' ? read.preprocessed : undefined;

    const enhancedData = preprocessed
      ? `${preprocessed.validationReport}\n\n---\n\nDATOS LIMPIOS (auxiliares validados):\n${preprocessed.cleanData}`
      : rawData;

    const enhancedInstructions = instructions || '';
    let effectiveCompany = company;
    if (preprocessed) {
      // NM-16 (re-auditoría 2026-09-24): aquí se publicaba un segundo bloque
      // "TOTALES PRE-CALCULADOS (VINCULANTES)" con `summary` PREVIO al curator
      // (Activo sin la reclasificación R1) y la Σ bruta de la clase 4 como
      // "Total Ingresos" (+ su YoY). El orquestador ya inyecta el bloque
      // vinculante único (renderSnapshotLines sobre controlTotals post-curator,
      // ingresos netos y operacionales, discrepancias y regla multiperiodo):
      // dos anclas distintas para la misma cifra confundían al modelo.
      // Autocomplete `comparativePeriod` / `detectedPeriods` para prompts y UI.
      const detected = preprocessed.periods.map((s) => s.period);
      if (!effectiveCompany.comparativePeriod && detected.length >= 2) {
        effectiveCompany = {
          ...effectiveCompany,
          comparativePeriod: detected[detected.length - 2],
          detectedPeriods: detected,
        };
      } else if (!effectiveCompany.detectedPeriods) {
        effectiveCompany = { ...effectiveCompany, detectedPeriods: detected };
      }
    }

    // pipeline-flujo-06: el orquestador recibe el MISMO preprocesado. Sin él
    // re-parseaba `enhancedData` (primera línea "# INFORME DE VALIDACION…" →
    // 0 filas): sin anclas, sin totales vinculantes y sin el gate 422, de modo
    // que un balance descuadrado producía un Excel con estados 100% LLM.
    let report: FinancialReport;
    try {
      report = await orchestrateFinancialReport(
        {
          rawData: enhancedData,
          company: effectiveCompany,
          language,
          instructions: enhancedInstructions,
        },
        { preprocessed },
      );
    } catch (err) {
      if (err instanceof BalanceValidationError) return balanceValidationResponse(err);
      throw err;
    }

    const blocked = rejectInvalidExport(serverGeneratedVerdicts(report, preprocessed, language), preprocessed);
    if (blocked) return blocked;

    const stamp = unverified(report);
    const buffer = await generateFinancialExcel({
      report: withExcelProvenance(report, stamp, language),
      preprocessed,
      language,
    });
    return createExcelResponse(buffer, effectiveCompany.name, provenanceHeaders(stamp));
  } catch (error) {
    console.error('[financial-report/export] Error:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: 'Error generating export.' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// pdf-elite branch
// ---------------------------------------------------------------------------
// Runs the same preprocess + 3-agent pipeline as the Excel path. On
// BalanceValidationError, builds a degenerate doc and renders a BLOQUEADO PDF
// (cover + appendix + closing only). On success, optionally aggregates pillars
// and renders the full editorial document.

async function handlePdfElite(body: unknown): Promise<Response> {
  const b = (body ?? {}) as {
    report?: FinancialReport;
    rawData?: string;
    company?: FinancialReport['company'];
    language?: 'es' | 'en';
    instructions?: string;
    // Phase 2 inputs — optional. When PipelineWorkspace finishes Phase 2/3
    // (audit + quality), it forwards the full reports here so the PDF renders
    // AuditFindingsPage + QualityMetaAuditPage. If absent, those pages are
    // omitted by the composer (page-level null guards take care of it).
    auditReport?: AuditReport | null;
    qualityReport?: QualityAssessment | null;
    // Toggle del intake — qué entregables incluir. Omitido o null = todos.
    outputOptions?: OutputOptionsToggle | null;
    // Preprocesado usado por /niif (ya ajustado) o ledger de ajustes para
    // re-derivarlo desde `rawData` — ver `resolveExportPreprocessed`.
    preprocessed?: unknown;
    adjustmentLedger?: unknown;
  };

  // FAST PATH: client already has a completed FinancialReport in state (e.g.
  // PipelineWorkspace just finished the 3-agent run). Skip orchestration; only
  // re-preprocess the trial balance so the editorial template can show full
  // statements + pillar aggregates without paying the 30-60s LLM cost again.
  if (b.report?.consolidatedReport) {
    // Mismo guard de shape que Mode 2: 400 en vez de TypeError 500.
    if (typeof b.report?.company?.name !== 'string') {
      return NextResponse.json(
        { error: 'Invalid report format: company.name is required.' },
        { status: 400 },
      );
    }
    const source = resolveExportPreprocessed(b as Record<string, unknown>, 'pdf-elite/fast');
    if (!source.ok) return source.response;
    const { preprocessed } = source;
    const language: 'es' | 'en' = b.language === 'en' ? 'en' : 'es';
    const report = clientReportWithServerMarkdown(b.report, source, language);
    const blocked = rejectInvalidExport(report, preprocessed);
    if (blocked) return blocked;

    let pillars = null;
    if (preprocessed?.primary) {
      try {
        pillars = aggregatePillars({
          snapshot: preprocessed.primary,
          comparative: preprocessed.comparative ?? null,
        });
      } catch (err) {
        console.warn('[pdf-elite/fast] aggregatePillars failed:', err);
      }
    }

    const doc = composeEditorialReport({
      report,
      preprocessed: preprocessed ?? null,
      pillars,
      language,
      auditReport: b.auditReport ?? null,
      qualityReport: b.qualityReport ?? null,
      outputOptions: b.outputOptions ?? null,
    });
    const stamp = unverified(report);
    appendPdfProvenance(doc, stamp, language);
    const stream = await renderEditorialReportToStream(doc);
    return pdfResponse(stream, report.company.name, provenanceHeaders(stamp));
  }

  // SLOW PATH: no pre-built report — re-run the full pipeline (used by callers
  // that only have rawData + company, e.g. server-side cron jobs or programmatic
  // exports). Same behavior as before this fast path was added.
  const parsed = financialReportRequestSchema.safeParse(body);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    return NextResponse.json({ error: 'Invalid request.', details: errors }, { status: 400 });
  }
  const { company, language, instructions } = parsed.data;
  const confirmed = applyRequestConfirmations(body, parsed.data.rawData);
  if (!confirmed.ok) return confirmed.response;
  const rawData = confirmed.rawData;

  // Preprocess up front so we can reuse the snapshot for both pillars and the
  // BLOQUEADO degenerate path. El orquestador recibe el MISMO preprocesado: una
  // sola fuente para estados, KPI grid y anexo (pipeline-flujo-06/07).
  const read = readRawData(rawData, 'pdf-elite');
  const preprocessed = read.kind === 'ok' ? read.preprocessed : undefined;

  let report: FinancialReport | null = null;
  let blockerReasons: string[] = [];

  if (read.kind === 'rejected') {
    // Hojas/periodos incompatibles: el mismo PDF BLOQUEADO que un balance
    // descuadrado, sin pagar el pipeline.
    blockerReasons = read.reasons;
  } else {
    try {
      report = await orchestrateFinancialReport(
        {
          rawData,
          company,
          language,
          instructions,
        },
        { preprocessed },
      );
    } catch (err) {
      if (err instanceof BalanceValidationError) {
        blockerReasons = err.reasons;
      } else {
        throw err;
      }
    }
  }

  if (!report) {
    // BLOCKED branch: build a minimal stub report so composer can produce a
    // doc whose meta.watermark === 'BLOQUEADO'. The renderer is responsible
    // for showing only Cover + Normative Appendix + Closing.
    const stub: FinancialReport = {
      company,
      niifAnalysis: {
        balanceSheet: '',
        incomeStatement: '',
        cashFlowStatement: '',
        equityChangesStatement: '',
        technicalNotes: '',
        fullContent: '',
      },
      strategicAnalysis: {
        kpiDashboard: '',
        breakEvenAnalysis: '',
        projectedCashFlow: '',
        strategicRecommendations: '',
        fullContent: '',
      },
      governance: {
        financialNotes: '',
        shareholderMinutes: '',
        fullContent: '',
      },
      consolidatedReport:
        language === 'en'
          ? '# REPORT BLOCKED — VALIDATION FAILED'
          : '# REPORTE BLOQUEADO — VALIDACION FALLIDA',
      generatedAt: new Date().toISOString(),
    };
    const doc = composeEditorialReport({
      report: stub,
      preprocessed: preprocessed ?? null,
      pillars: null,
      language,
      emittable: { ok: false, blockers: blockerReasons },
    });
    const stamp = unverified(stub);
    appendPdfProvenance(doc, stamp, language);
    const stream = await renderEditorialReportToStream(doc);
    return pdfResponse(stream, company.name, provenanceHeaders(stamp));
  }

  const blocked = rejectInvalidExport(serverGeneratedVerdicts(report, preprocessed, language), preprocessed);
  if (blocked) return blocked;

  // Successful path: optionally aggregate pillars (fail-soft).
  let pillars = null;
  if (preprocessed?.primary) {
    try {
      pillars = aggregatePillars({
        snapshot: preprocessed.primary,
        comparative: preprocessed.comparative ?? null,
      });
    } catch (err) {
      console.warn('[pdf-elite] aggregatePillars failed:', err);
    }
  }

  const doc = composeEditorialReport({
    report,
    preprocessed: preprocessed ?? null,
    pillars,
    language,
  });
  const stamp = unverified(report);
  appendPdfProvenance(doc, stamp, language);

  const stream = await renderEditorialReportToStream(doc);
  return pdfResponse(stream, company.name, provenanceHeaders(stamp));
}

/**
 * Un solo gate (mismo que /html): coherencia interna, procedencia contra el
 * preprocesado de la petición, Parte II, completitud e identidad. El informe
 * que llega aquí ya trae los veredictos RECALCULADOS contra ese preprocesado
 * (`withServerRenderedParts` en los caminos que exportan un informe recibido o
 * persistido; `withServerPartVerdicts` en el pipeline completo): invariantes
 * del JSON NIIF, aritmética y prosa del acta y de las notas, anclas y prosa de
 * la Parte II y sello de la Parte sin JSON válido. Un `clean: true` del
 * cliente —o de una versión persistida con reglas anteriores— no sustituye el
 * cruce; el recálculo sólo endurece.
 */
function rejectInvalidExport(
  report: FinancialReport,
  preprocessed: PreprocessedBalance | undefined,
): Response | null {
  const details = financialExportBlockers(report, preprocessed);
  return details.length > 0
    ? NextResponse.json({ error: 'Report is not exportable.', details }, { status: 422 })
    : null;
}

function balanceValidationResponse(err: BalanceValidationError): Response {
  return NextResponse.json(
    {
      error: 'El balance de prueba tiene inconsistencias criticas.',
      code: 'BALANCE_VALIDATION_FAILED',
      reasons: err.reasons,
      suggestedAccounts: err.suggestedAccounts,
    },
    { status: 422 },
  );
}

function pdfResponse(
  stream: Readable,
  companyName: string,
  extraHeaders: Record<string, string> = {},
): Response {
  const safeName = companyName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').slice(0, 30);
  const filename = `Reporte_Editorial_${safeName}_${Date.now()}.pdf`;
  const web = Readable.toWeb(stream) as unknown as ReadableStream;
  return new Response(web, {
    headers: {
      ...extraHeaders,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

function createExcelResponse(
  buffer: Buffer,
  companyName: string,
  extraHeaders: Record<string, string> = {},
): Response {
  const safeName = companyName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').slice(0, 30);
  const filename = `Reporte_Financiero_1mas1_${safeName}_${Date.now()}.xlsx`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      ...extraHeaders,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    },
  });
}
