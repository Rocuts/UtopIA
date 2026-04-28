'use client';

/**
 * PymeLanding — pagina home del modulo Contabilidad Pyme.
 *
 * Lista los libros del workspace y permite crear uno nuevo.
 * Renderiza desde `/workspace/pyme/page.tsx` (server component).
 *
 * NO importa de `@/lib/db/*` ni `@/lib/agents/pyme/*`. Solo `fetch` a
 * `/api/pyme/*`. La cookie `utopia_workspace_id` la inyecta el browser
 * automaticamente en el request, asi que no hay que pasar workspaceId.
 *
 * TODO: cuando el home del workspace (`src/app/workspace/page.tsx`)
 * agregue un slot para modulos Pyme, conectar este link aqui:
 *   <Link href="/workspace/pyme">Contabilidad Pyme</Link>
 *
 * FIXME: token — el spec pedia `text-acento-vino` pero ese token no existe
 * en `globals.css`. Usamos `text-area-escudo` (bordeaux family — el mismo
 * que usan los modulos Verdad/Escudo) como aproximacion mas cercana sin
 * inventar hex. Si en el futuro se anade un token `--color-acento-vino-*`
 * cambiar globalmente las clases de este modulo.
 */

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Plus,
  AlertCircle,
  X,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';
import type { PymeBook } from './types';

interface BooksResponse {
  ok: boolean;
  books?: PymeBook[];
  error?: string;
}

interface CreateBookResponse {
  ok: boolean;
  book?: PymeBook;
  error?: string;
}

export function PymeLanding() {
  const { t, language } = useLanguage();
  const tt = t.pyme.landing;
  const [books, setBooks] = useState<PymeBook[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErrored(false);
    try {
      const res = await fetch('/api/pyme/books', { method: 'GET' });
      const json = (await res.json()) as BooksResponse;
      if (!res.ok || !json.ok || !json.books) {
        throw new Error(json.error ?? 'load_failed');
      }
      setBooks(json.books);
    } catch {
      setErrored(true);
      setBooks(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreated = useCallback(
    (created: PymeBook) => {
      setBooks((prev) => (prev ? [created, ...prev] : [created]));
      setShowCreate(false);
    },
    [],
  );

  return (
    <div className="relative w-full px-6 md:px-10 py-10 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-6 mb-10">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-eyebrow text-area-escudo mb-3">
            <span
              aria-hidden="true"
              className="inline-block h-1 w-6 rounded-full bg-area-escudo"
            />
            {language === 'es' ? 'Modulo Pyme' : 'SMB Module'}
          </span>
          <h1 className="font-serif-elite text-3xl md:text-4xl font-medium tracking-tight text-n-1000 leading-tight">
            {tt.title}
          </h1>
          <p className="mt-2 text-base text-n-600 max-w-2xl">{tt.subtitle}</p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className={cn(
            'inline-flex items-center gap-2 px-5 py-2.5 rounded-md',
            'bg-area-escudo text-n-0 font-medium text-sm',
            'hover:opacity-90 transition-opacity',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
          )}
        >
          <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          <span>{tt.create_book}</span>
        </button>
      </div>

      {/* Body */}
      {loading && <BooksSkeleton />}

      {!loading && errored && (
        <ErrorState message={tt.error} retryLabel={tt.retry} onRetry={load} />
      )}

      {!loading && !errored && books && books.length === 0 && (
        <EmptyState
          message={tt.empty}
          ctaLabel={tt.create_book}
          onCta={() => setShowCreate(true)}
        />
      )}

      {!loading && !errored && books && books.length > 0 && (
        <ul
          role="list"
          className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
        >
          {books.map((b) => (
            <li key={b.id}>
              <BookCard book={b} openLabel={tt.open_book} createdLabel={tt.created_at} />
            </li>
          ))}
        </ul>
      )}

      {/* Create dialog */}
      {showCreate && (
        <CreateBookDialog
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}

// ─── Book card ───────────────────────────────────────────────────────────────

function BookCard({
  book,
  openLabel,
  createdLabel,
}: {
  book: PymeBook;
  openLabel: string;
  createdLabel: string;
}) {
  const created = new Date(book.createdAt);
  const dateStr = isNaN(created.getTime())
    ? ''
    : created.toLocaleDateString();

  return (
    <Link
      href={`/workspace/pyme/${book.id}`}
      className={cn(
        'group block h-full rounded-xl glass-elite p-5',
        'transition-all hover:shadow-e3 hover:border-elite-gold',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2',
      )}
      aria-label={`${openLabel}: ${book.name}`}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-n-100 text-area-escudo">
          <BookOpen className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <span className="text-xs font-mono uppercase tracking-wide text-n-500">
          {book.currency}
        </span>
      </div>

      <h3 className="font-serif-elite text-lg font-medium tracking-tight text-n-1000 leading-snug mb-1 truncate">
        {book.name}
      </h3>

      {dateStr && (
        <p className="text-xs text-n-500 mb-4">
          {createdLabel} {dateStr}
        </p>
      )}

      <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-eyebrow text-area-escudo group-hover:gap-2 transition-all">
        <span>{openLabel}</span>
        <ArrowRight
          className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
          strokeWidth={2}
          aria-hidden="true"
        />
      </span>
    </Link>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function BooksSkeleton() {
  return (
    <ul
      role="list"
      aria-busy="true"
      className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
    >
      {Array.from({ length: 3 }).map((_, i) => (
        <li key={i}>
          <div className="rounded-xl glass-elite p-5 animate-skeleton">
            <div className="h-10 w-10 rounded-lg bg-n-200 mb-4" />
            <div className="h-4 w-2/3 bg-n-200 rounded mb-2" />
            <div className="h-3 w-1/3 bg-n-200 rounded mb-6" />
            <div className="h-3 w-1/4 bg-n-200 rounded" />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({
  message,
  ctaLabel,
  onCta,
}: {
  message: string;
  ctaLabel: string;
  onCta: () => void;
}) {
  return (
    <div className="rounded-xl glass-elite p-10 text-center">
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-n-100 text-area-escudo mb-4">
        <BookOpen className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <p className="text-base text-n-800 max-w-md mx-auto mb-6">{message}</p>
      <button
        type="button"
        onClick={onCta}
        className={cn(
          'inline-flex items-center gap-2 px-5 py-2.5 rounded-md',
          'bg-area-escudo text-n-0 font-medium text-sm',
          'hover:opacity-90 transition-opacity',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2',
        )}
      >
        <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        <span>{ctaLabel}</span>
      </button>
    </div>
  );
}

// ─── Error state ─────────────────────────────────────────────────────────────

function ErrorState({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-xl border border-n-200 bg-n-100 p-6 flex items-start gap-4">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-n-200 text-area-escudo shrink-0">
        <AlertCircle className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-n-1000 mb-1">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="text-sm font-medium text-area-escudo hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 rounded-sm"
        >
          {retryLabel}
        </button>
      </div>
    </div>
  );
}

// ─── Create dialog ───────────────────────────────────────────────────────────

const CURRENCIES = ['COP', 'USD', 'EUR', 'MXN', 'PEN'] as const;

function CreateBookDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (b: PymeBook) => void;
}) {
  const { t } = useLanguage();
  const tt = t.pyme.landing;

  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<string>('COP');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const currencyId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = name.trim();
      if (!trimmed || submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch('/api/pyme/books', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed, currency }),
        });
        const json = (await res.json()) as CreateBookResponse;
        if (!res.ok || !json.ok || !json.book) {
          throw new Error(json.error ?? 'create_failed');
        }
        onCreated(json.book);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'create_failed');
        setSubmitting(false);
      }
    },
    [name, currency, submitting, onCreated],
  );

  // Close on Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${nameId}-title`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-n-1000/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl glass-elite-elevated p-6 relative"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          aria-label={tt.new_book_cancel}
          className="absolute top-3 right-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-n-600 hover:bg-n-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
        >
          <X className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </button>

        <h2
          id={`${nameId}-title`}
          className="font-serif-elite text-xl font-medium tracking-tight text-n-1000 mb-5"
        >
          {tt.create_book}
        </h2>

        <div className="space-y-4">
          <div>
            <label
              htmlFor={nameId}
              className="block text-sm font-medium text-n-800 mb-1.5"
            >
              {tt.new_book_name}
            </label>
            <input
              ref={inputRef}
              id={nameId}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tt.new_book_placeholder}
              maxLength={120}
              disabled={submitting}
              className={cn(
                'w-full px-3 py-2 rounded-md',
                'bg-n-0 text-n-1000 placeholder:text-n-500',
                'border border-n-300 focus-visible:border-gold-500',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/30',
                'disabled:opacity-60',
              )}
              required
            />
          </div>

          <div>
            <label
              htmlFor={currencyId}
              className="block text-sm font-medium text-n-800 mb-1.5"
            >
              {tt.new_book_currency}
            </label>
            <select
              id={currencyId}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              disabled={submitting}
              className={cn(
                'w-full px-3 py-2 rounded-md',
                'bg-n-0 text-n-1000',
                'border border-n-300 focus-visible:border-gold-500',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/30',
                'disabled:opacity-60',
              )}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-sm text-area-escudo" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-md text-sm font-medium text-n-700 hover:bg-n-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 disabled:opacity-60"
          >
            {tt.new_book_cancel}
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className={cn(
              'px-5 py-2 rounded-md text-sm font-medium',
              'bg-area-escudo text-n-0 hover:opacity-90 transition-opacity',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {submitting ? '...' : tt.new_book_create}
          </button>
        </div>
      </form>
    </div>
  );
}
