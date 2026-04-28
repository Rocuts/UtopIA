'use client';

/**
 * Pagina dedicada de subir fotos — vista mobile-friendly que prioriza
 * la camara. Renderiza `<PhotoUploader />` y `<EntryReview />` para
 * que el tendero pueda subir varias fotos y revisar drafts en una
 * sola vista lineal (no tabs).
 *
 * Esta vista es opcional desde el flujo principal: el wrapper de tabs
 * en `[bookId]/page.tsx` ya cubre el mismo contenido. La ruta dedicada
 * existe para enlaces directos / shortcut PWA / camara nativa.
 *
 * NO importa de `@/lib/db/*`. Solo `fetch` a `/api/pyme/*`.
 */

import Link from 'next/link';
import { use, useCallback, useState } from 'react';
import { ArrowLeft } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { EntryReview } from '@/components/workspace/pyme/EntryReview';
import { PhotoUploader } from '@/components/workspace/pyme/PhotoUploader';

interface PageProps {
  params: Promise<{ bookId: string }>;
}

export default function PymeUploadPage({ params }: PageProps) {
  // Next 15+: params es Promise. Como esta es una page client component,
  // usamos `use(params)` para resolver la promesa de forma concurrent-safe.
  const { bookId } = use(params);
  const { t } = useLanguage();
  const [refreshKey, setRefreshKey] = useState(0);

  const handleUploadsComplete = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="relative w-full px-6 md:px-10 py-8 max-w-3xl mx-auto">
      <Link
        href={`/workspace/pyme/${bookId}`}
        className="inline-flex items-center gap-1.5 text-sm text-n-600 hover:text-n-1000 mb-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 rounded-sm"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        <span>{t.pyme.book.back}</span>
      </Link>

      <header className="mb-6">
        <h1 className="font-serif-elite text-2xl md:text-3xl font-medium tracking-tight text-n-1000 leading-tight">
          {t.pyme.book.tabs.upload}
        </h1>
      </header>

      <div className="space-y-8">
        <PhotoUploader bookId={bookId} onUploadsComplete={handleUploadsComplete} />
        <EntryReview bookId={bookId} refreshKey={refreshKey} />
      </div>
    </div>
  );
}
