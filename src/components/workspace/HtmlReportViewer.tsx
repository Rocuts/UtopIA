'use client';

// ---------------------------------------------------------------------------
// HtmlReportViewer (Wave 4.F8 — cap-stone visual viewer)
// ---------------------------------------------------------------------------
// Viewer ligero del HTML 15-page A4 v10.1 producido por el Editor Jefe HTML
// (agente F7). Se muestra inline en `PipelineWorkspace` cuando el usuario hace
// click en "Generar HTML" tras completar Phase 3.
//
// Diseño:
//   - Iframe `sandbox="allow-same-origin"` SIN `allow-scripts`. El HTML es
//     auto-contenido (CSS inline, sin JS) — no necesita ejecución para
//     renderizar y mantenerlo sin scripts elimina el vector XSS si en el
//     futuro un prompt malformado cuela algo. La spec v10.1 §10 declara que
//     el documento es estático.
//   - Botón "Descargar HTML" blob-iza el string y dispara download como
//     `reporte-{nit}-{period}.html`.
//   - Banner warn por `checklistFailures` (severity 'block' resaltado).
// ---------------------------------------------------------------------------

import { useCallback, useMemo } from 'react';
import { Download, X, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChecklistFailure {
  rule: string;
  detail: string;
  severity: 'block' | 'warn';
}

interface HtmlReportViewerProps {
  /** HTML5 auto-contenido emitido por el agente Editor Jefe HTML. */
  html: string;
  /** NIT de la empresa — usado como sufijo del filename del download. */
  nit: string;
  /** Periodo fiscal — usado como sufijo del filename. */
  fiscalPeriod: string;
  /** Failures del linter post-emisión (§11 spec). Vacío si el HTML pasó todo. */
  checklistFailures: ChecklistFailure[];
  /** es | en — controla labels. Default 'es'. */
  language: 'es' | 'en';
  /** Cierra el viewer y vuelve al ReportViewer del Markdown. */
  onClose: () => void;
}

export function HtmlReportViewer({
  html,
  nit,
  fiscalPeriod,
  checklistFailures,
  language,
  onClose,
}: HtmlReportViewerProps) {
  // Filename estable para el download — convierte caracteres no-ASCII / espacios
  // a guion-bajo para evitar errores en sistemas Windows / Linux antiguos.
  const filename = useMemo(() => {
    const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_');
    return `reporte-${safe(nit)}-${safe(fiscalPeriod)}.html`;
  }, [nit, fiscalPeriod]);

  const blockingFailures = checklistFailures.filter((f) => f.severity === 'block');
  const warnFailures = checklistFailures.filter((f) => f.severity === 'warn');
  const hasFailures = checklistFailures.length > 0;

  const handleDownload = useCallback(() => {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [html, filename]);

  return (
    <div className="h-full w-full flex flex-col bg-n-0">
      {/* Header con acciones */}
      <div className="shrink-0 border-b border-n-200 px-6 py-3 flex items-center gap-2 flex-wrap">
        <h2 className="text-sm font-bold text-n-1000">
          {language === 'es' ? 'Reporte HTML 1+1 v10.1' : 'HTML Report 1+1 v10.1'}
        </h2>
        <button
          type="button"
          onClick={handleDownload}
          aria-label={language === 'es' ? 'Descargar HTML' : 'Download HTML'}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-gold-500 text-n-0 hover:bg-gold-700 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          {language === 'es' ? 'Descargar HTML' : 'Download HTML'}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={language === 'es' ? 'Cerrar vista HTML' : 'Close HTML view'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-n-200 text-n-700 text-xs font-medium hover:bg-n-50 hover:text-n-1000 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          {language === 'es' ? 'Cerrar' : 'Close'}
        </button>
      </div>

      {/* Banner de checklist failures — visible sólo si hay items */}
      {hasFailures && (
        <div
          className={cn(
            'shrink-0 border-b px-6 py-3 flex items-start gap-2',
            blockingFailures.length > 0
              ? 'border-danger/30 bg-danger/10'
              : 'border-warning/30 bg-warning/10',
          )}
        >
          <AlertTriangle
            className={cn(
              'w-4 h-4 shrink-0 mt-0.5',
              blockingFailures.length > 0 ? 'text-danger' : 'text-warning',
            )}
            aria-hidden="true"
          />
          <div className="flex-1 min-w-0 text-xs">
            <div
              className={cn(
                'font-medium mb-1',
                blockingFailures.length > 0 ? 'text-danger' : 'text-warning',
              )}
            >
              {blockingFailures.length > 0
                ? language === 'es'
                  ? `${blockingFailures.length} fallo${blockingFailures.length === 1 ? '' : 's'} bloqueante${blockingFailures.length === 1 ? '' : 's'} del checklist §11`
                  : `${blockingFailures.length} blocking checklist failure${blockingFailures.length === 1 ? '' : 's'} (§11)`
                : language === 'es'
                  ? `${warnFailures.length} advertencia${warnFailures.length === 1 ? '' : 's'} del checklist §11`
                  : `${warnFailures.length} checklist warning${warnFailures.length === 1 ? '' : 's'} (§11)`}
            </div>
            <ul className="space-y-0.5 text-n-800">
              {blockingFailures.map((f, i) => (
                <li key={`block-${i}`} className="text-danger">
                  <span className="font-mono text-2xs">[{f.rule}]</span> {f.detail}
                </li>
              ))}
              {warnFailures.map((f, i) => (
                <li key={`warn-${i}`} className="text-n-800">
                  <span className="font-mono text-2xs">[{f.rule}]</span> {f.detail}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Iframe sandboxed — sin allow-scripts, allow-same-origin para que el
          CSS inline del HTML pueda referenciar @font-face desde data: URIs. El
          documento de Editor Jefe es estático por contrato §10. */}
      <iframe
        srcDoc={html}
        sandbox="allow-same-origin"
        title={language === 'es' ? 'Reporte HTML 1+1 v10.1' : 'HTML Report 1+1 v10.1'}
        className="flex-1 w-full border-0 bg-n-0"
      />
    </div>
  );
}
