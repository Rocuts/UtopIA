'use client';

/**
 * EntryReview — tabla editable de drafts pendientes de confirmar.
 *
 * Recibe `bookId` y carga drafts desde `/api/pyme/entries?bookId=...&status=draft`
 * al montar y cada vez que el padre llama `refreshKey`. Las ediciones son
 * locales hasta que el usuario presiona "Confirmar todos" (PATCH masivo)
 * o "Eliminar" individual (DELETE).
 *
 * Pantalla critica para confiabilidad: el OCR puede haber leido mal el
 * monto, la fecha o la categoria, asi que cada celda es editable y la
 * confianza se muestra como chip visual.
 *
 * Lenis: el contenedor con `overflow-y-auto` lleva `data-lenis-prevent`
 * para que el wheel scrollee la tabla sin pelearse con el scroll global.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';
import type { PymeEntry, PymeEntryKind } from './types';

interface EntryReviewProps {
  bookId: string;
  /** Cambia este valor desde el padre para forzar re-fetch (ej. tras
   * que `PhotoUploader` reporte que un OCR termino). */
  refreshKey?: number;
}

interface DraftEdit {
  entryDate: string; // YYYY-MM-DD
  description: string;
  kind: PymeEntryKind;
  amount: string; // texto para no perder el "0.50" mientras se tipea
  category: string;
}

/** Hace round-trip Entry → DraftEdit. */
function entryToEdit(e: PymeEntry): DraftEdit {
  // entryDate viene como ISO string; truncamos a YYYY-MM-DD para <input type="date">.
  const datePart = (e.entryDate ?? '').slice(0, 10);
  return {
    entryDate: datePart,
    description: e.description ?? '',
    kind: e.kind,
    amount: String(e.amount ?? ''),
    category: e.category ?? '',
  };
}

export function EntryReview({ bookId, refreshKey }: EntryReviewProps) {
  const { t, language } = useLanguage();
  const tt = t.pyme.review;

  const [drafts, setDrafts] = useState<PymeEntry[] | null>(null);
  const [edits, setEdits] = useState<Record<string, DraftEdit>>({});
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrored(false);
    try {
      const url = `/api/pyme/entries?bookId=${encodeURIComponent(bookId)}&status=draft&limit=200`;
      const res = await fetch(url);
      const json = (await res.json()) as { ok: boolean; entries?: PymeEntry[] };
      if (!res.ok || !json.ok || !json.entries) throw new Error('load_failed');
      setDrafts(json.entries);
      const m: Record<string, DraftEdit> = {};
      json.entries.forEach((e) => {
        m[e.id] = entryToEdit(e);
      });
      setEdits(m);
    } catch {
      setErrored(true);
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const updateEdit = useCallback(
    (id: string, patch: Partial<DraftEdit>) => {
      setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    },
    [],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/pyme/entries/${id}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error('delete_failed');
        setDrafts((prev) => (prev ? prev.filter((e) => e.id !== id) : prev));
        setEdits((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setFeedback(tt.deleted);
      } catch {
        setFeedback(language === 'es' ? 'No se pudo eliminar.' : 'Could not delete.');
      }
    },
    [tt.deleted, language],
  );

  const handleConfirmAll = useCallback(async () => {
    if (!drafts || drafts.length === 0 || bulkPending) return;
    setBulkPending(true);
    setFeedback(null);
    try {
      const results = await Promise.all(
        drafts.map(async (entry) => {
          const edit = edits[entry.id];
          if (!edit) return false;
          const amountNum = Number(edit.amount);
          if (!isFinite(amountNum) || amountNum <= 0) return false;
          const body = {
            entryDate: edit.entryDate,
            description: edit.description.trim(),
            kind: edit.kind,
            amount: amountNum,
            category: edit.category.trim() || undefined,
            status: 'confirmed' as const,
          };
          const res = await fetch(`/api/pyme/entries/${entry.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          return res.ok;
        }),
      );
      const okCount = results.filter(Boolean).length;
      setFeedback(tt.confirmed_count.replace('{n}', String(okCount)));
      // Drop confirmed ones from local state (they no longer have status=draft).
      await load();
    } catch {
      setFeedback(language === 'es' ? 'Error al guardar.' : 'Save failed.');
    } finally {
      setBulkPending(false);
    }
  }, [drafts, edits, bulkPending, tt.confirmed_count, language, load]);

  const sortedDrafts = useMemo(() => {
    if (!drafts) return [];
    return [...drafts].sort((a, b) => {
      const da = a.entryDate ?? '';
      const db = b.entryDate ?? '';
      return da.localeCompare(db);
    });
  }, [drafts]);

  if (loading) {
    return (
      <div className="rounded-xl glass-elite p-6 animate-skeleton">
        <div className="h-5 w-1/3 bg-n-200 rounded mb-4" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 bg-n-200 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (errored) {
    return (
      <div className="rounded-xl border border-n-200 bg-n-100 p-6 flex items-start gap-4">
        <AlertCircle className="h-5 w-5 text-area-escudo shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <div>
          <p className="text-sm text-n-1000">
            {language === 'es' ? 'No se pudieron cargar los renglones.' : 'Could not load entries.'}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 text-sm font-medium text-area-escudo hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 rounded-sm"
          >
            {language === 'es' ? 'Reintentar' : 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  if (sortedDrafts.length === 0) {
    return (
      <div className="rounded-xl glass-elite p-10 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-n-100 text-n-500 mb-4">
          <AlertCircle className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <p className="text-base text-n-800 max-w-md mx-auto mb-1">{tt.no_entries}</p>
        <p className="text-sm text-n-500">{tt.empty_hint}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-serif-elite text-xl font-medium tracking-tight text-n-1000">
            {tt.title}
          </h3>
          <p className="text-sm text-n-600 mt-1">{tt.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={handleConfirmAll}
          disabled={bulkPending}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2 rounded-md',
            'bg-area-escudo text-n-0 text-sm font-medium',
            'hover:opacity-90 transition-opacity',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          <CheckCircle2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          <span>{bulkPending ? tt.confirming : tt.confirm_all}</span>
        </button>
      </div>

      {feedback && (
        <p className="text-sm text-n-700" role="status">
          {feedback}
        </p>
      )}

      {/* Tabla con scroll interno + data-lenis-prevent */}
      <div
        data-lenis-prevent
        className="relative max-h-[60vh] overflow-y-auto overflow-x-auto styled-scrollbar rounded-xl glass-elite"
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-n-0/95 backdrop-blur">
            <tr className="text-left text-xs font-medium uppercase tracking-eyebrow text-n-600">
              <th scope="col" className="px-3 py-2.5 font-medium">{tt.col_date}</th>
              <th scope="col" className="px-3 py-2.5 font-medium min-w-[160px]">
                {tt.col_description}
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">{tt.col_kind}</th>
              <th scope="col" className="px-3 py-2.5 font-medium text-right">
                {tt.col_amount}
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">{tt.col_category}</th>
              <th scope="col" className="px-3 py-2.5 font-medium">{tt.col_confidence}</th>
              <th scope="col" className="px-3 py-2.5 font-medium text-right">
                <span className="sr-only">{tt.col_actions}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedDrafts.map((entry) => {
              const edit = edits[entry.id];
              if (!edit) return null;
              const conf = entry.confidence ?? 0;
              const lowConf = conf < 0.5;
              return (
                <tr
                  key={entry.id}
                  className={cn(
                    'border-t border-n-200',
                    lowConf ? 'bg-n-100' : 'bg-n-0',
                  )}
                >
                  <td className="px-3 py-2 align-top">
                    <input
                      type="date"
                      value={edit.entryDate}
                      onChange={(e) =>
                        updateEdit(entry.id, { entryDate: e.target.value })
                      }
                      className="w-full px-2 py-1 rounded-md bg-n-0 text-n-1000 border border-n-300 focus-visible:border-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/30"
                      aria-label={tt.col_date}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      type="text"
                      value={edit.description}
                      onChange={(e) =>
                        updateEdit(entry.id, { description: e.target.value })
                      }
                      className="w-full px-2 py-1 rounded-md bg-n-0 text-n-1000 border border-n-300 focus-visible:border-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/30"
                      maxLength={500}
                      aria-label={tt.col_description}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <KindToggle
                      value={edit.kind}
                      onChange={(k) => updateEdit(entry.id, { kind: k })}
                      ingresoLabel={tt.ingreso}
                      egresoLabel={tt.egreso}
                    />
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={edit.amount}
                      onChange={(e) =>
                        updateEdit(entry.id, { amount: e.target.value })
                      }
                      className="w-full px-2 py-1 rounded-md bg-n-0 text-n-1000 border border-n-300 text-right num focus-visible:border-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/30"
                      aria-label={tt.col_amount}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      type="text"
                      value={edit.category}
                      onChange={(e) =>
                        updateEdit(entry.id, { category: e.target.value })
                      }
                      placeholder={tt.category_placeholder}
                      className="w-full px-2 py-1 rounded-md bg-n-0 text-n-1000 border border-n-300 placeholder:text-n-500 focus-visible:border-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/30"
                      maxLength={120}
                      aria-label={tt.col_category}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <ConfidenceChip
                      value={conf}
                      lowLabel={tt.low_confidence}
                    />
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    <button
                      type="button"
                      onClick={() => handleDelete(entry.id)}
                      aria-label={`${tt.delete} ${edit.description || entry.id}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-n-600 hover:bg-n-100 hover:text-area-escudo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Kind toggle ─────────────────────────────────────────────────────────────

function KindToggle({
  value,
  onChange,
  ingresoLabel,
  egresoLabel,
}: {
  value: PymeEntryKind;
  onChange: (k: PymeEntryKind) => void;
  ingresoLabel: string;
  egresoLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="kind"
      className="inline-flex rounded-md border border-n-300 bg-n-0 p-0.5"
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === 'ingreso'}
        onClick={() => onChange('ingreso')}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
          value === 'ingreso'
            ? 'bg-n-100 text-success'
            : 'text-n-600 hover:text-n-1000',
        )}
      >
        <TrendingUp className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
        {ingresoLabel}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'egreso'}
        onClick={() => onChange('egreso')}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
          value === 'egreso'
            ? 'bg-n-100 text-area-escudo'
            : 'text-n-600 hover:text-n-1000',
        )}
      >
        <TrendingDown className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
        {egresoLabel}
      </button>
    </div>
  );
}

// ─── Confidence chip ─────────────────────────────────────────────────────────

function ConfidenceChip({ value, lowLabel }: { value: number; lowLabel: string }) {
  const pct = Math.round(value * 100);
  if (value < 0.5) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-n-100 text-warning border border-n-200"
        title={lowLabel}
      >
        <AlertCircle className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
        {pct}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-n-100 text-success border border-n-200">
      <CheckCircle2 className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
      {pct}%
    </span>
  );
}
