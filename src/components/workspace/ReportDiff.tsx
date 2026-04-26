'use client';

// ---------------------------------------------------------------------------
// ReportDiff — Phase 3 hook 3 (Doctor de Datos / WS2)
// ---------------------------------------------------------------------------
// Visualiza el diff entre el reporte ORIGINAL (antes del regen con ajustes)
// y el reporte ACTUAL (post-ajustes). Tres pestanas: Antes / Cambios / Despues.
//
// Diseno:
//   - Tabs ARIA-compliant (role=tablist + role=tab + aria-selected).
//   - Default tab "Cambios" (es lo que el usuario quiere ver primero).
//   - "Antes" y "Despues" renderizan Markdown via react-markdown +
//     remark-gfm + rehype-sanitize (mismo patron del ReportViewer).
//   - "Cambios" pinta linea por linea segun DiffSegment.type:
//       unchanged -> texto neutro
//       added     -> bg-success/10, prefix '+ '
//       removed   -> bg-danger/10, prefix '- ', opacidad reducida
//   - Lineas que mencionan codigos en `affectedAccounts` reciben un badge
//     inline "Cuenta ajustada" (gold) — util para que el usuario ubique el
//     impacto de sus ajustes en el cuerpo del reporte.
//   - Container con scroll interno + `data-lenis-prevent` (Lenis root mode
//     hijack-ea wheel events globalmente; sin esto el scroll del diff muere).
//
// Performance: el diff se calcula con `useMemo` keyed por before+after.
// Para reportes grandes (~5K lineas) la matriz LCS es ~25M celdas (~100MB
// con Uint32Array, NO factible). Si en el futuro se proyectan reportes asi,
// migrar a Myers diff. Hoy los reportes financieros caben holgados.
// ---------------------------------------------------------------------------

import { useMemo, useState, useId } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { cn } from '@/lib/utils';
import { diffMarkdown, type DiffSegment } from '@/lib/diff/markdown-diff';

type DiffTab = 'before' | 'changes' | 'after';

interface ReportDiffProps {
  before: string;
  after: string;
  /** PUC codes que fueron tocados via adjustments — para destacar lineas que los mencionan. */
  affectedAccounts?: string[];
  language: 'es' | 'en';
  className?: string;
}

const LABELS: Record<'es' | 'en', Record<string, string>> = {
  es: {
    before: 'Antes',
    changes: 'Cambios',
    after: 'Despues',
    statsAdded: 'lineas agregadas',
    statsRemoved: 'lineas eliminadas',
    statsUnchanged: 'sin cambios',
    affectedBadge: 'Cuenta ajustada',
    noChanges: 'No se detectaron cambios entre las versiones.',
    emptyBefore: '(El reporte original esta vacio.)',
    emptyAfter: '(El reporte actual esta vacio.)',
  },
  en: {
    before: 'Before',
    changes: 'Changes',
    after: 'After',
    statsAdded: 'lines added',
    statsRemoved: 'lines removed',
    statsUnchanged: 'unchanged',
    affectedBadge: 'Adjusted account',
    noChanges: 'No changes detected between versions.',
    emptyBefore: '(The original report is empty.)',
    emptyAfter: '(The current report is empty.)',
  },
};

/**
 * Construye un set normalizado de codigos PUC afectados para lookup O(1).
 * Normaliza removiendo separadores comunes (puntos, guiones, espacios).
 */
function normalizeCode(code: string): string {
  return String(code ?? '').replace(/[.\-\s]/g, '');
}

/**
 * Determina si una linea menciona alguna de las cuentas afectadas. Busca
 * cada codigo como token (numero seguido por borde no-digito o EOL).
 *
 * Optimizacion: usa una sola RegExp pre-compilada (alternation) cuando hay
 * cuentas afectadas. Si no las hay, retorna false sin trabajo.
 */
function makeAffectedMatcher(
  affectedAccounts: string[] | undefined,
): (line: string) => boolean {
  if (!affectedAccounts || affectedAccounts.length === 0) {
    return () => false;
  }
  const codes = Array.from(
    new Set(
      affectedAccounts
        .map(normalizeCode)
        .filter((c) => c.length > 0 && /^\d+$/.test(c)),
    ),
  );
  if (codes.length === 0) return () => false;
  // Borde no-digito o BOF/EOF a ambos lados, para evitar match en sub-cadenas
  // (ej: '1110' no debe matchear '11105').
  const pattern = new RegExp(`(?:^|\\D)(?:${codes.join('|')})(?:\\D|$)`);
  return (line: string) => pattern.test(line);
}

interface DiffLineProps {
  segment: DiffSegment;
  isAffected: boolean;
  affectedLabel: string;
}

function DiffLine({ segment, isAffected, affectedLabel }: DiffLineProps) {
  const { type, content } = segment;

  // Linea vacia: render minimo para preservar el espaciado pero sin que se
  // colapse el row.
  const display = content.length === 0 ? ' ' : content;

  if (type === 'unchanged') {
    return (
      <div
        className={cn(
          'group flex items-start gap-2 px-3 py-0.5 leading-relaxed',
          isAffected && 'bg-gold-300/10',
        )}
      >
        <span className="select-none w-3 shrink-0 text-n-400">{' '}</span>
        <span
          className={cn(
            'flex-1 whitespace-pre-wrap break-words text-n-700',
            isAffected && 'text-n-800',
          )}
        >
          {display}
        </span>
        {isAffected && (
          <span className="shrink-0 text-2xs font-mono uppercase text-gold-700 bg-gold-300/20 border border-gold-500/30 rounded px-1.5 py-0.5">
            {affectedLabel}
          </span>
        )}
      </div>
    );
  }

  if (type === 'added') {
    return (
      <div
        className={cn(
          'group flex items-start gap-2 px-3 py-0.5 leading-relaxed bg-success/10 border-l-2 border-success',
          isAffected && 'bg-gold-300/15',
        )}
      >
        <span className="select-none w-3 shrink-0 text-success font-bold">+</span>
        <span className="flex-1 whitespace-pre-wrap break-words text-n-900">
          {display}
        </span>
        {isAffected && (
          <span className="shrink-0 text-2xs font-mono uppercase text-gold-700 bg-gold-300/20 border border-gold-500/30 rounded px-1.5 py-0.5">
            {affectedLabel}
          </span>
        )}
      </div>
    );
  }

  // removed
  return (
    <div
      className={cn(
        'group flex items-start gap-2 px-3 py-0.5 leading-relaxed bg-danger/10 border-l-2 border-danger opacity-70',
        isAffected && 'bg-gold-300/15 opacity-90',
      )}
    >
      <span className="select-none w-3 shrink-0 text-danger font-bold">-</span>
      <span className="flex-1 whitespace-pre-wrap break-words text-n-700 line-through decoration-danger/40">
        {display}
      </span>
      {isAffected && (
        <span className="shrink-0 text-2xs font-mono uppercase text-gold-700 bg-gold-300/20 border border-gold-500/30 rounded px-1.5 py-0.5">
          {affectedLabel}
        </span>
      )}
    </div>
  );
}

export function ReportDiff({
  before,
  after,
  affectedAccounts,
  language,
  className,
}: ReportDiffProps) {
  const [activeTab, setActiveTab] = useState<DiffTab>('changes');
  const tabId = useId();
  const labels = LABELS[language];

  // Diff calculado una sola vez por par (before, after). Si el componente
  // se re-monta con los mismos textos, el memo cachea.
  const diff = useMemo(() => diffMarkdown(before, after), [before, after]);

  const isAffected = useMemo(
    () => makeAffectedMatcher(affectedAccounts),
    [affectedAccounts],
  );

  const tabs: Array<{ id: DiffTab; label: string }> = [
    { id: 'before', label: labels.before },
    { id: 'changes', label: labels.changes },
    { id: 'after', label: labels.after },
  ];

  const hasChanges = diff.stats.added > 0 || diff.stats.removed > 0;

  return (
    <div className={cn('rounded-lg border border-n-200 bg-n-0 overflow-hidden', className)}>
      {/* Tablist */}
      <div
        role="tablist"
        aria-label={
          language === 'es' ? 'Comparacion de versiones del reporte' : 'Report version comparison'
        }
        className="flex items-center gap-0 border-b border-n-200 bg-n-50"
      >
        {tabs.map((t) => {
          const selected = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${tabId}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${tabId}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                'px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px',
                selected
                  ? 'text-gold-700 border-gold-500 bg-n-0'
                  : 'text-n-600 border-transparent hover:bg-n-100',
              )}
            >
              {t.label}
              {t.id === 'changes' && hasChanges && (
                <span className="ml-2 text-2xs font-mono text-n-500">
                  +{diff.stats.added} / -{diff.stats.removed}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Panels */}
      {/* Antes */}
      <div
        role="tabpanel"
        id={`${tabId}-panel-before`}
        aria-labelledby={`${tabId}-tab-before`}
        hidden={activeTab !== 'before'}
        className={cn(
          activeTab !== 'before' && 'hidden',
          'max-h-[600px] overflow-y-auto styled-scrollbar',
        )}
        data-lenis-prevent
      >
        <div className="px-6 py-4">
          {before.trim().length === 0 ? (
            <p className="text-xs text-n-500 italic">{labels.emptyBefore}</p>
          ) : (
            <div className="prose prose-sm max-w-none text-n-900 prose-headings:text-n-900 prose-headings:font-semibold prose-p:leading-relaxed prose-strong:text-n-900">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                {before}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>

      {/* Cambios */}
      <div
        role="tabpanel"
        id={`${tabId}-panel-changes`}
        aria-labelledby={`${tabId}-tab-changes`}
        hidden={activeTab !== 'changes'}
        className={cn(
          activeTab !== 'changes' && 'hidden',
          'max-h-[600px] overflow-y-auto styled-scrollbar',
        )}
        data-lenis-prevent
      >
        {/* Stats strip */}
        <div className="sticky top-0 z-10 border-b border-n-100 bg-n-50/95 backdrop-blur-sm px-4 py-2 flex items-center gap-3 text-2xs font-mono text-n-600">
          <span className="text-success">
            +{diff.stats.added} <span className="text-n-500 font-normal">{labels.statsAdded}</span>
          </span>
          <span className="text-danger">
            -{diff.stats.removed} <span className="text-n-500 font-normal">{labels.statsRemoved}</span>
          </span>
          <span>
            {diff.stats.unchanged} <span className="text-n-500 font-normal">{labels.statsUnchanged}</span>
          </span>
        </div>

        {!hasChanges ? (
          <div className="px-6 py-8 text-center text-xs text-n-500">
            {labels.noChanges}
          </div>
        ) : (
          <div className="font-mono text-sm py-2">
            {diff.segments.map((seg, idx) => (
              <DiffLine
                key={idx}
                segment={seg}
                isAffected={isAffected(seg.content)}
                affectedLabel={labels.affectedBadge}
              />
            ))}
          </div>
        )}
      </div>

      {/* Despues */}
      <div
        role="tabpanel"
        id={`${tabId}-panel-after`}
        aria-labelledby={`${tabId}-tab-after`}
        hidden={activeTab !== 'after'}
        className={cn(
          activeTab !== 'after' && 'hidden',
          'max-h-[600px] overflow-y-auto styled-scrollbar',
        )}
        data-lenis-prevent
      >
        <div className="px-6 py-4">
          {after.trim().length === 0 ? (
            <p className="text-xs text-n-500 italic">{labels.emptyAfter}</p>
          ) : (
            <div className="prose prose-sm max-w-none text-n-900 prose-headings:text-n-900 prose-headings:font-semibold prose-p:leading-relaxed prose-strong:text-n-900">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                {after}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
