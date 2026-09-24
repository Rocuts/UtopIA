import type { FinancialReport } from '@/lib/agents/financial/types';
import { dict } from '@/lib/i18n/dictionaries';
import type { ReportProvenance } from './report-ref';

// ---------------------------------------------------------------------------
// Procedencia impresa DENTRO del artefacto (Excel, PDF, HTML)
// ---------------------------------------------------------------------------
// Un encabezado HTTP no sobrevive a la descarga; el rótulo tiene que viajar en
// el archivo. Con referencia verificada se imprime la versión persistida, la
// huella del informe, la del balance preprocesado y el contrato de reglas; sin
// ella, "procedencia no verificada" con el motivo.
//
// Las superficies (excel-export, pdf-elite-react, html-editor) no tienen hoy un
// campo dedicado a la procedencia, así que el sello se aplica en la frontera de
// la ruta sin tocar su composición:
//   - Excel: bloque al inicio del texto de la hoja "Resumen" (sobre una copia
//     del informe: la versión persistida y su huella no cambian);
//   - PDF: renglones en las advertencias del Anexo Normativo;
//   - HTML: comentario + <meta> y un aviso visible tras <body>.
// ---------------------------------------------------------------------------

export type ArtifactProvenance =
  | { kind: 'verified'; provenance: ReportProvenance }
  | { kind: 'unverified' };

type Lang = 'es' | 'en';

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k] : m));
}

/** Título + cuerpo + detalle de la procedencia, en el idioma del entregable. */
export function provenanceLines(p: ArtifactProvenance, language: Lang): string[] {
  const t = dict[language].reportProvenance;
  if (p.kind === 'unverified') return [t.unverifiedTitle, t.unverifiedBody];
  const v = p.provenance;
  return [
    t.verifiedTitle,
    t.verifiedBody,
    fill(t.versionLine, { reportId: v.reportId, createdAt: v.createdAt }),
    fill(t.reportHashLine, { hash: v.reportHash }),
    v.sourceHash ? fill(t.sourceHashLine, { hash: v.sourceHash }) : t.sourceMissingLine,
    ...(v.rawDataHash ? [fill(t.rawDataHashLine, { hash: v.rawDataHash })] : []),
    fill(t.contractLine, { contract: v.contractVersion, preprocessor: v.preprocessorVersion }),
  ];
}

/** Encabezados máquina-legibles (complemento, no sustituto, del sello impreso). */
export function provenanceHeaders(p: ArtifactProvenance): Record<string, string> {
  if (p.kind === 'unverified') return { 'X-Report-Provenance': 'unverified' };
  return {
    'X-Report-Provenance': 'verified',
    'X-Report-Id': p.provenance.reportId,
    'X-Report-Hash': p.provenance.reportHash,
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
 * Sella el HTML: comentario y <meta> máquina-legibles y un aviso visible tras
 * <body>. Misma inserción que el sello BORRADOR del Editor Jefe (si no hay
 * <body> se antepone: mejor un aviso desubicado que un artefacto sin rótulo).
 */
export function stampHtmlProvenance(html: string, p: ArtifactProvenance, language: Lang): string {
  const lines = provenanceLines(p, language);
  const [title, body, ...detail] = lines;
  const status = p.kind === 'verified' ? 'verified' : 'unverified';
  const machine =
    p.kind === 'verified'
      ? `status=${status}; report=${p.provenance.reportId}; hash=${p.provenance.reportHash}; ` +
        `source=${p.provenance.sourceHash ?? 'none'}; contract=${p.provenance.contractVersion}`
      : `status=${status}`;
  const comment = `<!-- REPORT_PROVENANCE: ${machine.replace(/--/g, '- -')} -->`;
  const meta = `<meta name="utopia-report-provenance" content="${escapeHtml(machine)}">`;
  const style = `<style>
  .utopia-procedencia{position:relative;z-index:9997;margin:0;padding:8px 16px;background:#FFFFFF;color:#1E3A5F;border-bottom:2px solid #1E3A5F;font-family:Inter,system-ui,sans-serif;font-size:11px;line-height:1.45}
  .utopia-procedencia strong{letter-spacing:.12em}
  .utopia-procedencia code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;word-break:break-all}
</style>`;
  const detailHtml = detail.length
    ? `<br>${detail.map((d) => `<code>${escapeHtml(d)}</code>`).join('<br>')}`
    : '';
  const banner =
    `<div class="utopia-procedencia" data-provenance="${status}"><strong>${escapeHtml(title)}</strong> — ` +
    `${escapeHtml(body)}${detailHtml}</div>`;

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
