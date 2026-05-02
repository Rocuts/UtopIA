'use client';

/**
 * OpeningBalanceUploader — drag-and-drop importer for opening balances.
 *
 * The user drops (or picks) a CSV / Excel file with their balances. We POST
 * it to `/api/accounting/opening-balance` as multipart form-data and surface
 * the resulting `ImportResult.warnings` so they know which rows fell back
 * to "unmapped account" or had odd data.
 *
 * We deliberately do NOT parse the spreadsheet client-side here:
 *   - the server already runs sheetjs / papaparse via the preprocessing
 *     pipeline, so doing it twice doubles the bundle weight,
 *   - it lets us hand the user a list of warnings the server validated
 *     against the actual chart_of_accounts (auxiliary check, currency check,
 *     etc.) instead of a "looks plausible" client preview.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';

interface PeriodOption {
  id: string;
  year: number;
  month: number;
  status: 'open' | 'closed' | 'locked';
  label?: string;
}

interface ImportResult {
  ok: boolean;
  inserted?: number;
  warnings?: string[];
  error?: string;
}

const ACCEPT =
  '.csv,.txt,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';
const MAX_BYTES = 5 * 1024 * 1024;

function periodLabel(p: PeriodOption): string {
  if (p.label) return p.label;
  const month = String(p.month).padStart(2, '0');
  return `${p.year}-${month}`;
}

export function OpeningBalanceUploader() {
  const { t, language } = useLanguage();
  const router = useRouter();
  const ac = t.accounting;

  const inputRef = useRef<HTMLInputElement>(null);

  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(true);
  const [periodId, setPeriodId] = useState<string>('');

  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ─── Load periods ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const year = new Date().getFullYear();
        const res = await fetch(`/api/accounting/periods?year=${year}`);
        if (!res.ok) throw new Error('periods_failed');
        const json = (await res.json()) as
          | { ok: true; periods: PeriodOption[] }
          | PeriodOption[];
        const list: PeriodOption[] = Array.isArray(json)
          ? json
          : 'periods' in json && Array.isArray(json.periods)
            ? json.periods
            : [];
        if (cancelled) return;
        setPeriods(list);
        const open = list.find((p) => p.status === 'open');
        setPeriodId(open?.id ?? list[0]?.id ?? '');
      } catch {
        if (!cancelled) setError(ac.errorGeneric);
      } finally {
        if (!cancelled) setPeriodsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ac.errorGeneric]);

  // ─── File handling ───────────────────────────────────────────────────────
  const acceptFile = useCallback(
    (f: File | null) => {
      setError(null);
      setResult(null);
      if (!f) {
        setFile(null);
        return;
      }
      if (f.size > MAX_BYTES) {
        setError(
          language === 'es'
            ? 'El archivo supera el máximo de 5 MB'
            : 'File exceeds the 5 MB limit',
        );
        return;
      }
      setFile(f);
    },
    [language],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDrag(false);
      const f = e.dataTransfer.files?.[0] ?? null;
      acceptFile(f);
    },
    [acceptFile],
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0] ?? null;
      acceptFile(f);
    },
    [acceptFile],
  );

  const clearFile = useCallback(() => {
    setFile(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  // ─── Submit ──────────────────────────────────────────────────────────────
  const submit = useCallback(async () => {
    if (!file || !periodId) return;
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('periodId', periodId);
      const res = await fetch('/api/accounting/opening-balance', {
        method: 'POST',
        body: fd,
      });
      const json = (await res.json()) as ImportResult;
      if (!res.ok || json.ok === false) {
        setError(json.error ?? ac.errorGeneric);
      } else {
        setResult(json);
        // Auto-refresh the workspace landing so the user sees the import
        // reflected in "Recent entries" once they navigate back.
        router.refresh();
      }
    } catch {
      setError(ac.errorGeneric);
    } finally {
      setSubmitting(false);
    }
  }, [file, periodId, ac.errorGeneric, router]);

  return (
    <div className="flex flex-col gap-5">
      {/* Period selector */}
      <div className={cn('rounded-xl border border-gold-500/20 bg-n-0 p-5')}>
        <label
          htmlFor="opening-balance-period"
          className="block text-xs-mono uppercase tracking-eyebrow text-n-700 font-medium mb-2"
        >
          {ac.period}
        </label>
        {periodsLoading ? (
          <div className="flex items-center gap-2 text-sm text-n-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {ac.loading}
          </div>
        ) : periods.length === 0 ? (
          <p className="text-sm text-n-700">
            {language === 'es'
              ? 'Aún no hay periodos creados. Crea uno antes de importar.'
              : 'No periods yet. Create one before importing.'}
          </p>
        ) : (
          <select
            id="opening-balance-period"
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
            className={cn(
              'w-full max-w-sm h-9 px-3 rounded-md border bg-n-0',
              'border-gold-500/25 focus:border-gold-500/60 outline-none',
              'text-sm text-n-1000',
              'focus-visible:ring-2 focus-visible:ring-gold-500',
            )}
          >
            <option value="" disabled>
              {ac.selectPeriod}
            </option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {periodLabel(p)} {p.status !== 'open' ? `(${p.status})` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cn(
          'rounded-xl border-2 border-dashed transition-colors',
          drag
            ? 'border-gold-500 bg-gold-500/8'
            : 'border-gold-500/30 bg-n-0 hover:border-gold-500/50',
          'p-8 text-center cursor-pointer',
          'focus-within:ring-2 focus-within:ring-gold-500',
        )}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        aria-label={ac.uploadCsv}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          onChange={onPick}
          className="hidden"
        />
        <div className="flex flex-col items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-gold-500/10 text-gold-600"
          >
            <Upload className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-n-1000">
              {drag ? ac.uploadCsvDrop : ac.uploadCsv}
            </p>
            <p className="text-xs text-n-500 mt-1">{ac.uploadCsvHint}</p>
          </div>
        </div>
      </div>

      {/* Selected file summary */}
      {file && (
        <div
          className={cn(
            'rounded-md border border-gold-500/25 bg-n-0',
            'flex items-center justify-between gap-3 px-4 py-2',
          )}
        >
          <div className="min-w-0">
            <p className="text-sm text-n-1000 truncate font-medium">{file.name}</p>
            <p className="text-2xs text-n-500 tabular-nums">
              {(file.size / 1024).toFixed(1)} KB
            </p>
          </div>
          <button
            type="button"
            onClick={clearFile}
            disabled={submitting}
            className={cn(
              'p-1.5 rounded text-n-500 hover:text-danger hover:bg-danger/8',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-danger',
              'disabled:opacity-50',
            )}
            aria-label={
              language === 'es' ? 'Quitar archivo' : 'Remove file'
            }
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Action */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !file || !periodId}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2 rounded-md',
            'bg-gold-500 text-n-0 hover:bg-gold-600 transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
            'focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
            'disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gold-500/30',
            'text-sm font-semibold',
          )}
        >
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {ac.import}
        </button>
        <button
          type="button"
          onClick={() => router.push('/workspace/contabilidad')}
          disabled={submitting}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2 rounded-md',
            'border border-gold-500/30 text-n-1000 bg-n-0',
            'hover:bg-gold-500/8 transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'text-sm font-medium',
          )}
        >
          {ac.cancel}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className={cn(
            'rounded-md border border-danger/30 bg-danger/8 px-3 py-2',
            'text-sm text-danger flex items-center gap-2',
          )}
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Result */}
      {result && (
        <div
          className={cn(
            'rounded-xl border bg-n-0 p-4',
            result.ok ? 'border-success/30' : 'border-danger/30',
          )}
        >
          <div className="flex items-center gap-2 mb-2">
            {result.ok ? (
              <CheckCircle2
                className="h-4 w-4 text-success"
                aria-hidden="true"
              />
            ) : (
              <AlertCircle className="h-4 w-4 text-danger" aria-hidden="true" />
            )}
            <p className="text-sm font-semibold text-n-1000">
              {result.ok
                ? language === 'es'
                  ? `Importadas ${result.inserted ?? 0} líneas`
                  : `Imported ${result.inserted ?? 0} lines`
                : language === 'es'
                  ? 'La importación falló'
                  : 'Import failed'}
            </p>
          </div>
          {result.warnings && result.warnings.length > 0 && (
            <div>
              <p className="text-xs-mono uppercase tracking-eyebrow text-n-600 font-medium mb-1">
                {ac.warnings}
              </p>
              <ul className="text-sm text-n-700 list-disc pl-5 space-y-0.5">
                {result.warnings.map((w, i) => (
                  <li key={`${w}-${i}`} className="text-warning">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default OpeningBalanceUploader;
