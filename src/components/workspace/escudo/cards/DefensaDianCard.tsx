'use client';

/**
 * DefensaDianCard — Módulo 5: Defensa DIAN.
 *
 * Tipo de requerimiento (Art. 752/685/715/702) + plazo + vista previa
 * de carta colapsable + botón "Descargar carta (.txt)".
 */

import { useState, useCallback } from 'react';
import { Shield, ChevronDown, ChevronUp, Download, Clock } from 'lucide-react';
import { NormaCitation } from '@/components/workspace/cards/SurvivalCard';
import { cn } from '@/lib/utils';
import type { DefensaDianModuleResult, DianRequirementKind } from '@/lib/agents/financial/escudo-survival/fiscal-agent';
import type { FiscalDefensaDianT } from '../types';

function Shimmer({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block rounded animate-pulse bg-n-300/30', className)}
    />
  );
}

// ---------------------------------------------------------------------------
// Requirement kind labels
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<DianRequirementKind, { es: string; en: string; norma: string }> = {
  requerimiento_ordinario: { es: 'Requerimiento ordinario', en: 'Ordinary notice', norma: 'Art. 752 E.T.' },
  emplazamiento_corregir: { es: 'Emplazamiento para corregir', en: 'Notice to correct', norma: 'Art. 685 E.T.' },
  emplazamiento_no_declarar: { es: 'Emplazamiento por no declarar', en: 'Notice to file', norma: 'Art. 715 E.T.' },
  pliego_cargos: { es: 'Pliego de cargos', en: 'Charge brief', norma: 'Art. 707 E.T.' },
  liquidacion_oficial_revision: { es: 'Liquidación oficial de revisión', en: 'Official assessment', norma: 'Art. 702 E.T.' },
  desconocido: { es: 'Tipo desconocido', en: 'Unknown type', norma: '' },
};

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

function downloadCarta(text: string, language: 'es' | 'en') {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = language === 'es' ? 'carta_defensa_dian.txt' : 'dian_defense_letter.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DefensaDianCardProps {
  data?: DefensaDianModuleResult;
  loading?: boolean;
  error?: string;
  t: FiscalDefensaDianT;
  language?: 'es' | 'en';
}

export function DefensaDianCard({ data, loading, error, t, language = 'es' }: DefensaDianCardProps) {
  const [letterExpanded, setLetterExpanded] = useState(false);
  const toggleLetter = useCallback(() => setLetterExpanded((v) => !v), []);

  const kindInfo = data ? KIND_LABELS[data.data.tipoRequerimiento] : null;

  const handleDownload = useCallback(() => {
    if (data?.data.cartaCompleta) {
      downloadCarta(data.data.cartaCompleta, language);
    }
  }, [data, language]);

  return (
    <article
      className={cn(
        'relative flex flex-col gap-5 p-6 rounded-xl h-full',
        'glass-elite-elevated ring-1 ring-[rgb(168_56_56_/_0.3)]',
      )}
      aria-labelledby="defensa-dian-title"
      aria-busy={loading}
    >
      {/* Ambient glow */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-12 -left-12 w-[180px] h-[180px] rounded-full blur-[64px] opacity-20"
        style={{ background: 'radial-gradient(circle, rgb(168 56 56 / 0.6) 0%, transparent 70%)' }}
      />

      {/* Header */}
      <div className="relative flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span
            aria-hidden="true"
            className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[rgb(168_56_56_/_0.18)] text-area-escudo"
          >
            {loading ? <Shimmer className="h-5 w-5 rounded" /> : <Shield className="h-5 w-5" strokeWidth={1.75} />}
          </span>
          <div className="min-w-0">
            <h3 id="defensa-dian-title" className="font-serif-elite text-lg leading-tight font-medium tracking-tight text-n-1000 truncate">
              {t.title}
            </h3>
            {kindInfo && (
              <p className="text-xs text-area-escudo mt-0.5 font-medium">{kindInfo[language]}</p>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      {error ? (
        <div className="rounded-md p-3 bg-[rgb(239_68_68_/_0.10)] ring-1 ring-[rgb(239_68_68_/_0.25)]" role="alert">
          <p className="text-sm text-danger leading-relaxed">{error}</p>
        </div>
      ) : loading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Shimmer className="h-8 w-48" />
          <Shimmer className="h-4 w-full" />
          <Shimmer className="h-4 w-5/6" />
          <Shimmer className="h-20 w-full" />
        </div>
      ) : data ? (
        <div className="flex flex-col gap-4">
          {/* Type + plazo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 p-3 rounded-md bg-n-50/50 ring-1 ring-n-200/40">
              <span className="text-xs uppercase tracking-eyebrow text-n-500">{t.tipoLabel}</span>
              <span className="font-medium text-n-1000 text-sm">{kindInfo?.[language] ?? data.data.tipoRequerimiento}</span>
              {kindInfo?.norma && <NormaCitation norma={kindInfo.norma} />}
            </div>
            <div className="flex flex-col gap-1 p-3 rounded-md bg-n-50/50 ring-1 ring-n-200/40">
              <span className="text-xs uppercase tracking-eyebrow text-n-500 flex items-center gap-1">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {t.plazoLabel}
              </span>
              <span className="font-medium text-n-1000 text-sm">{data.data.plazoRespuesta}</span>
              <NormaCitation norma={data.data.normaPlazo} />
            </div>
          </div>

          {/* Posición jurídica */}
          <div className="flex flex-col gap-1.5">
            <p className="text-xs uppercase tracking-eyebrow text-n-500 font-medium">{t.posicionLabel}</p>
            <p className="text-sm leading-relaxed text-n-800 line-clamp-4">
              {data.data.posicionJuridica}
            </p>
          </div>

          {/* Reducciones disponibles */}
          {data.data.reduccionesDisponibles.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-eyebrow text-n-500 font-medium mb-1.5">{t.reduccionesLabel}</p>
              <ul role="list" className="flex flex-col gap-1">
                {data.data.reduccionesDisponibles.map((r, i) => (
                  <li key={i} className="text-xs text-n-700 flex items-start gap-1.5">
                    <span aria-hidden="true" className="shrink-0 mt-1 h-1 w-1 rounded-full bg-success" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Carta colapsable */}
          <div>
            <button
              type="button"
              onClick={toggleLetter}
              aria-expanded={letterExpanded}
              aria-controls="carta-defensa-preview"
              className={cn(
                'w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm font-medium',
                'bg-n-100/60 text-n-800',
                'hover:bg-n-200/60 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-area-escudo',
              )}
            >
              <span>{t.previewLabel}</span>
              {letterExpanded
                ? <ChevronUp className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                : <ChevronDown className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
            </button>
            {letterExpanded && (
              <div
                id="carta-defensa-preview"
                className={cn(
                  'mt-2 p-3 rounded-md max-h-64 overflow-y-auto',
                  'bg-n-50/60 ring-1 ring-n-200/40',
                )}
                data-lenis-prevent
              >
                <pre className="text-xs leading-relaxed text-n-800 whitespace-pre-wrap font-[family-name:var(--font-geist-mono,monospace)]">
                  {data.data.cartaCompleta}
                </pre>
              </div>
            )}
          </div>

          {/* Download button */}
          <button
            type="button"
            onClick={handleDownload}
            aria-label={language === 'es' ? 'Descargar carta de defensa en formato .txt' : 'Download defense letter in .txt format'}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium self-start',
              'bg-[rgb(168_56_56_/_0.18)] hover:bg-[rgb(168_56_56_/_0.30)] text-area-escudo',
              'border border-[rgb(168_56_56_/_0.35)] hover:border-[rgb(168_56_56_/_0.55)]',
              'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-area-escudo focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
            )}
          >
            <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            {t.downloadLabel}
          </button>
        </div>
      ) : null}

      {/* Footer */}
      {!loading && !error && (
        <div className="mt-auto pt-2 border-t border-n-200/40">
          <NormaCitation norma="Art. 647 E.T." />
        </div>
      )}
    </article>
  );
}
