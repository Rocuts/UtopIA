import type { FinancialReport } from '@/lib/agents/financial/types';
import { dict } from '@/lib/i18n/dictionaries';
import type { ReportProvenance } from './report-ref';
import { FINANCIAL_REPORT_CONTRACT_VERSION } from './financial-report-version';
import { adjustmentTrailRows, appliedAdjustmentsCount, type AdjustmentsTrail } from './adjustment-ledger';

// ---------------------------------------------------------------------------
// Procedencia impresa DENTRO del artefacto (Excel, PDF, HTML)
// ---------------------------------------------------------------------------
// Un encabezado HTTP no sobrevive a la descarga; el rótulo tiene que viajar en
// el archivo. Con referencia verificada se imprime la versión persistida, la
// huella del informe, la del balance preprocesado, el contrato de reglas con
// que se persistió y aquel con que se re-renderizó al producir el artefacto
// (I5-5); sin ella, "procedencia no verificada" con el motivo.
//
// Las superficies (excel-export, pdf-elite-react, html-editor) no tienen hoy un
// campo dedicado a la procedencia, así que el sello se aplica en la frontera de
// la ruta sin tocar su composición:
//   - Excel: bloque al inicio del texto de la hoja "Resumen" (sobre una copia
//     del informe: la versión persistida y su huella no cambian);
//   - PDF: renglones en las advertencias del Anexo Normativo;
//   - HTML: comentario + <meta> y un aviso visible tras <body>.
// ---------------------------------------------------------------------------

/**
 * Por qué un artefacto sale marcado BORRADOR (procedencia-R2-06). El sello
 * nunca dice "verificado" sin aclararlo, sea cual sea la marca:
 *   - `override`: el usuario eligió "Continuar de todas formas" en el Doctor de
 *     Datos (pipeline-flujo-21) y el consolidado lleva el encabezado BORRADOR;
 *   - `not-emittable`: el HTML del Editor Jefe no superó su verificación
 *     numérica automática (`emittable: false`) y viene estampado BORRADOR;
 *   - `watermark`: el PDF lleva la marca de agua del composer (BORRADOR por
 *     comparativos impracticables, INCOMPLETO o BLOQUEADO) con su subtítulo.
 */
export type DraftReason =
  | { kind: 'override' }
  | { kind: 'not-emittable' }
  | { kind: 'watermark'; mark: string; subtitle?: string };

/**
 * `draft`: el artefacto sale marcado BORRADOR (ver `DraftReason`; sin
 * `draftReasons`, el del override). El sello lo aclara: "procedencia
 * verificada" certifica la versión persistida y su balance, no que el
 * documento sea definitivo.
 */
export type ArtifactProvenance =
  | {
      kind: 'verified';
      provenance: ReportProvenance;
      draft?: boolean;
      draftReasons?: DraftReason[];
      /**
       * Ajustes confirmados del Doctor de Datos incluidos en las cifras
       * (procedencia-R2-02): el sello los cuenta y distingue la huella del
       * balance ajustado de la del archivo recibido; el HTML los lista.
       */
      adjustments?: AdjustmentsTrail | null;
      /**
       * Contrato de reglas con que el servidor RE-RENDERIZÓ la versión al
       * producir el artefacto (I5-5). /export y /html por referencia recalculan
       * el Markdown, los veredictos y los gates con las reglas vigentes: por
       * defecto `FINANCIAL_REPORT_CONTRACT_VERSION`. `provenance.contractVersion`
       * es el contrato con que se PERSISTIÓ.
       */
      renderedWith?: string;
    }
  | { kind: 'unverified'; draft?: boolean; draftReasons?: DraftReason[]; adjustments?: AdjustmentsTrail | null };

/** Contrato del re-render de una procedencia verificada. */
function renderedContract(p: Extract<ArtifactProvenance, { kind: 'verified' }>): string {
  return p.renderedWith ?? FINANCIAL_REPORT_CONTRACT_VERSION;
}

type Lang = 'es' | 'en';

/**
 * Encabezado BORRADOR del override (`buildProvisionalDraftBanner` del camino
 * partido y `buildProvisionalWatermark` del legacy): mismo reconocimiento que
 * el composer del PDF, que estampa la marca de agua con él.
 */
const PROVISIONAL_DRAFT_RE = /BORRADOR — VALIDACION PENDIENTE|DRAFT — VALIDATION PENDING/i;

/** ¿El consolidado del informe está marcado como BORRADOR por el override? */
export function isProvisionalDraft(report: { consolidatedReport?: unknown } | null | undefined): boolean {
  return typeof report?.consolidatedReport === 'string' && PROVISIONAL_DRAFT_RE.test(report.consolidatedReport);
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k] : m));
}

function sameReason(a: DraftReason, b: DraftReason): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'watermark' && b.kind === 'watermark') return a.mark === b.mark && a.subtitle === b.subtitle;
  return true;
}

/** Procedencia marcada BORRADOR con los motivos dados (sin duplicar; conserva los previos). */
export function withDraftReasons<T extends ArtifactProvenance>(p: T, reasons: readonly DraftReason[]): T {
  if (reasons.length === 0) return p;
  const previous: DraftReason[] = p.draft === true ? (p.draftReasons ?? [{ kind: 'override' }]) : [];
  const merged = [...previous];
  for (const r of reasons) if (!merged.some((m) => sameReason(m, r))) merged.push(r);
  return { ...p, draft: true, draftReasons: merged };
}

/**
 * Motivos BORRADOR de un PDF compuesto: la marca de agua que el composer
 * estampó en la portada (`meta.watermark`). Un BORRADOR sin subtítulo es el
 * del override (consolidado o preprocesado provisional).
 */
export function pdfDraftReasons(doc: { meta?: { watermark?: string; watermarkSubtitle?: string } }): DraftReason[] {
  const mark = doc.meta?.watermark;
  if (!mark) return [];
  const subtitle = doc.meta?.watermarkSubtitle;
  if (mark === 'BORRADOR' && !subtitle) return [{ kind: 'override' }];
  return [{ kind: 'watermark', mark, ...(subtitle ? { subtitle } : {}) }];
}

const WATERMARK_EN: Record<string, string> = { BORRADOR: 'DRAFT', INCOMPLETO: 'INCOMPLETE', BLOQUEADO: 'BLOCKED' };

function draftReasonLine(r: DraftReason, language: Lang): string {
  const t = dict[language].reportProvenance;
  if (r.kind === 'override') return t.draftLine;
  if (r.kind === 'not-emittable') return t.draftNotEmittableLine;
  // La marca del composer es un literal en español (`WatermarkKind`); el
  // subtítulo ya viene en el idioma del entregable.
  const mark = language === 'en' ? (WATERMARK_EN[r.mark] ?? r.mark) : r.mark;
  return fill(t.draftWatermarkLine, { mark: r.subtitle ? `${mark} (${r.subtitle})` : mark });
}

/** Título + cuerpo + detalle de la procedencia, en el idioma del entregable. */
export function provenanceLines(p: ArtifactProvenance, language: Lang): string[] {
  const t = dict[language].reportProvenance;
  const draft =
    p.draft === true
      ? (p.draftReasons && p.draftReasons.length > 0 ? p.draftReasons : [{ kind: 'override' } as DraftReason]).map(
          (r) => draftReasonLine(r, language),
        )
      : [];
  const adjusted = appliedAdjustmentsCount(p.adjustments);
  const adjustments = adjusted > 0 ? [fill(t.adjustmentsLine, { count: String(adjusted) })] : [];
  if (p.kind === 'unverified') {
    return [p.draft ? t.unverifiedDraftTitle : t.unverifiedTitle, t.unverifiedBody, ...draft, ...adjustments];
  }
  const v = p.provenance;
  return [
    p.draft ? t.verifiedDraftTitle : t.verifiedTitle,
    t.verifiedBody,
    ...draft,
    ...adjustments,
    fill(t.versionLine, { reportId: v.reportId, createdAt: v.createdAt }),
    fill(t.reportHashLine, { hash: v.reportHash }),
    v.sourceHash
      ? fill(adjusted > 0 ? t.sourceHashAdjustedLine : t.sourceHashLine, { hash: v.sourceHash })
      : t.sourceMissingLine,
    ...(v.rawDataHash
      ? [fill(adjusted > 0 ? t.rawDataHashBeforeAdjustmentsLine : t.rawDataHashLine, { hash: v.rawDataHash })]
      : []),
    fill(t.contractRenderedLine, {
      contract: v.contractVersion,
      rendered: renderedContract(p),
      preprocessor: v.preprocessorVersion,
    }),
  ];
}

/** Encabezados máquina-legibles (complemento, no sustituto, del sello impreso). */
export function provenanceHeaders(p: ArtifactProvenance): Record<string, string> {
  const draft: Record<string, string> = p.draft === true ? { 'X-Report-Draft': 'true' } : {};
  if (p.kind === 'unverified') return { 'X-Report-Provenance': 'unverified', ...draft };
  return {
    'X-Report-Provenance': 'verified',
    'X-Report-Id': p.provenance.reportId,
    'X-Report-Hash': p.provenance.reportHash,
    'X-Report-Contract': p.provenance.contractVersion,
    'X-Report-Rendered-Contract': renderedContract(p),
    ...draft,
  };
}

/**
 * Copia del informe con el bloque de procedencia al inicio del texto que el
 * Excel imprime en la hoja "Resumen". No altera el objeto recibido.
 */
export function withExcelProvenance(
  report: FinancialReport,
  p: ArtifactProvenance,
  language: Lang,
): FinancialReport {
  const [title, ...rest] = provenanceLines(p, language);
  const block = [`# ${title}`, ...rest].join('\n');
  return { ...report, consolidatedReport: `${block}\n\n${report.consolidatedReport ?? ''}` };
}

/** Añade la procedencia a las advertencias del Anexo Normativo del PDF. */
export function appendPdfProvenance<T extends { appendix?: { validationWarnings?: string[] } }>(
  doc: T,
  p: ArtifactProvenance,
  language: Lang,
): T {
  const [title, ...rest] = provenanceLines(p, language);
  const line = `${title} — ${rest.join(' · ')}`;
  const appendix = doc.appendix ?? {};
  doc.appendix = {
    ...appendix,
    validationWarnings: [...(appendix.validationWarnings ?? []), line],
  };
  return doc;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Anexo de ajustes confirmados dentro del aviso de procedencia del HTML
 * (procedencia-R2-02): la misma información que la traza del consolidado. El
 * Editor Jefe no recibe el ledger (su contrato de entrada no lo trae), así que
 * el HTML lo divulga aquí, fuera del cuerpo que redacta el modelo.
 */
function adjustmentsAnnexHtml(trail: AdjustmentsTrail | null | undefined, language: Lang): string {
  const rows = adjustmentTrailRows(trail);
  if (rows.length === 0) return '';
  const t = dict[language].reportProvenance;
  const head = [t.adjId, t.adjAccount, t.adjPrevious, t.adjAmount, t.adjNew, t.adjRationale]
    .map((h) => `<th>${escapeHtml(h)}</th>`)
    .join('');
  const body = rows
    .map(
      (r) =>
        '<tr>' +
        [
          r.id,
          `${r.accountCode} ${r.accountName}${r.period ? ` (${r.period})` : ''}`,
          r.previous,
          r.amount,
          r.next,
          r.rationale,
        ]
          .map((c) => `<td>${escapeHtml(c)}</td>`)
          .join('') +
        '</tr>',
    )
    .join('');
  return (
    `<div class="utopia-procedencia-ajustes"><strong>${escapeHtml(t.adjustmentsAnnexTitle)}</strong>` +
    `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
  );
}

/**
 * Sella el HTML: comentario y <meta> máquina-legibles y un aviso visible tras
 * <body>. Misma inserción que el sello BORRADOR del Editor Jefe (si no hay
 * <body> se antepone: mejor un aviso desubicado que un artefacto sin rótulo).
 */
export function stampHtmlProvenance(html: string, p: ArtifactProvenance, language: Lang): string {
  const lines = provenanceLines(p, language);
  const [title, body, ...detail] = lines;
  const status = p.kind === 'verified' ? 'verified' : 'unverified';
  const draft = p.draft === true ? '; draft=true' : '';
  const machine =
    (p.kind === 'verified'
      ? `status=${status}; report=${p.provenance.reportId}; hash=${p.provenance.reportHash}; ` +
        `source=${p.provenance.sourceHash ?? 'none'}; contract=${p.provenance.contractVersion}; ` +
        `rendered=${renderedContract(p)}`
      : `status=${status}`) + draft;
  const comment = `<!-- REPORT_PROVENANCE: ${machine.replace(/--/g, '- -')} -->`;
  const meta = `<meta name="utopia-report-provenance" content="${escapeHtml(machine)}">`;
  const style = `<style>
  .utopia-procedencia{position:relative;z-index:9997;margin:0;padding:8px 16px;background:#FFFFFF;color:#1E3A5F;border-bottom:2px solid #1E3A5F;font-family:Inter,system-ui,sans-serif;font-size:11px;line-height:1.45}
  .utopia-procedencia strong{letter-spacing:.12em}
  .utopia-procedencia code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;word-break:break-all}
  .utopia-procedencia table{border-collapse:collapse;margin-top:6px;font-size:10px}
  .utopia-procedencia th,.utopia-procedencia td{border:1px solid #1E3A5F;padding:2px 6px;text-align:left;vertical-align:top}
</style>`;
  const detailHtml = detail.length
    ? `<br>${detail.map((d) => `<code>${escapeHtml(d)}</code>`).join('<br>')}`
    : '';
  const banner =
    `<div class="utopia-procedencia" data-provenance="${status}"${p.draft === true ? ' data-draft="true"' : ''}><strong>${escapeHtml(title)}</strong> — ` +
    `${escapeHtml(body)}${detailHtml}${adjustmentsAnnexHtml(p.adjustments, language)}</div>`;

  let out = html;
  const headOpen = out.match(/<head[^>]*>/i);
  if (headOpen) {
    const at = (headOpen.index ?? 0) + headOpen[0].length;
    out = `${out.slice(0, at)}${meta}${out.slice(at)}`;
  }
  const bodyOpen = out.match(/<body[^>]*>/i);
  if (!bodyOpen) return `${comment}${style}${banner}${out}`;
  const at = (bodyOpen.index ?? 0) + bodyOpen[0].length;
  return `${out.slice(0, at)}${comment}${style}${banner}${out.slice(at)}`;
}
