'use client';

/**
 * BookWorkspace — wrapper cliente con tabs (Ledger / Subir / Reportes)
 * para una pagina de libro Pyme. Lo consume el server component
 * `app/workspace/pyme/[bookId]/page.tsx`.
 *
 * Hace un fetch inicial a `/api/pyme/books/[id]` para obtener el nombre
 * y la moneda del libro. Si el libro no existe, muestra estado not_found.
 *
 * NO importa de `@/lib/db/*`. Solo `fetch` a `/api/pyme/*`.
 *
 * Nota: este archivo no esta en la lista canonica del spec — es un
 * helper que evita meter logica cliente en la ruta server. La lista
 * del spec lo cubre indirectamente bajo "[bookId]/page.tsx (server con
 * tabs cliente)".
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Camera,
  LineChart,
  TrendingUp,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';
import { Ledger } from './Ledger';
import { MonthlyReport } from './MonthlyReport';
import { PhotoUploader } from './PhotoUploader';
import { EntryReview } from './EntryReview';
import type { PymeBook } from './types';

type TabKey = 'ledger' | 'upload' | 'reports';

interface BookResponse {
  ok: boolean;
  book?: PymeBook;
  error?: string;
}

export function BookWorkspace({ bookId }: { bookId: string }) {
  const { t, language } = useLanguage();
  const tt = t.pyme.book;

  const [book, setBook] = useState<PymeBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('ledger');
  const [draftRefreshKey, setDraftRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErrored(false);
      try {
        const res = await fetch(`/api/pyme/books/${bookId}`);
        const json = (await res.json()) as BookResponse;
        if (cancelled) return;
        if (!res.ok || !json.ok || !json.book) throw new Error('not_found');
        setBook(json.book);
      } catch {
        if (!cancelled) setErrored(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const handleUploadsComplete = useCallback(() => {
    setDraftRefreshKey((k) => k + 1);
  }, []);

  const tabs: Array<{ key: TabKey; label: string; Icon: typeof BookOpen }> = [
    { key: 'ledger', label: tt.tabs.ledger, Icon: LineChart },
    { key: 'upload', label: tt.tabs.upload, Icon: Camera },
    { key: 'reports', label: tt.tabs.reports, Icon: TrendingUp },
  ];

  return (
    <div className="relative w-full px-6 md:px-10 py-8 max-w-6xl mx-auto">
      {/* Back link */}
      <Link
        href="/workspace/pyme"
        className="inline-flex items-center gap-1.5 text-sm text-n-600 hover:text-n-1000 mb-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 rounded-sm"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        <span>{tt.back}</span>
      </Link>

      {/* Header */}
      <header className="mb-6">
        {loading && (
          <div className="h-8 w-1/2 bg-n-200 rounded animate-skeleton" />
        )}
        {!loading && errored && (
          <p className="text-sm text-area-escudo">{tt.not_found}</p>
        )}
        {!loading && !errored && book && (
          <div className="flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-n-100 text-area-escudo">
              <BookOpen className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="font-serif-elite text-2xl md:text-3xl font-medium tracking-tight text-n-1000 leading-tight truncate">
                {book.name}
              </h1>
              <p className="text-xs font-mono uppercase tracking-wide text-n-500 mt-0.5">
                {book.currency}
              </p>
            </div>
          </div>
        )}
      </header>

      {/* Tabs */}
      {!errored && (
        <>
          <div
            role="tablist"
            aria-label={language === 'es' ? 'Secciones del libro' : 'Book sections'}
            className="flex gap-1 border-b border-n-200 mb-6 overflow-x-auto"
          >
            {tabs.map(({ key, label, Icon }) => {
              const active = activeTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={`tab-${key}`}
                  aria-selected={active}
                  aria-controls={`panel-${key}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setActiveTab(key)}
                  className={cn(
                    'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium',
                    'border-b-2 transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 rounded-t-sm',
                    active
                      ? 'border-area-escudo text-n-1000'
                      : 'border-transparent text-n-600 hover:text-n-1000',
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>

          <div className="min-h-[300px]">
            {activeTab === 'ledger' && (
              <div role="tabpanel" id="panel-ledger" aria-labelledby="tab-ledger">
                <Ledger bookId={bookId} currency={book?.currency} />
              </div>
            )}
            {activeTab === 'upload' && (
              <div
                role="tabpanel"
                id="panel-upload"
                aria-labelledby="tab-upload"
                className="space-y-8"
              >
                <PhotoUploader
                  bookId={bookId}
                  onUploadsComplete={handleUploadsComplete}
                />
                <EntryReview bookId={bookId} refreshKey={draftRefreshKey} />
              </div>
            )}
            {activeTab === 'reports' && (
              <div role="tabpanel" id="panel-reports" aria-labelledby="tab-reports">
                <MonthlyReport bookId={bookId} currency={book?.currency} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
