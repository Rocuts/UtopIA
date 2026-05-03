/**
 * Book detail page (server component) — Pyme module.
 *
 * Recibe `bookId` por params (Next 15+: params es Promise — `await params`).
 * Renderiza un wrapper cliente con tabs: Ledger (default), Subir fotos,
 * Reportes. El cliente se ocupa de hacer fetch a `/api/pyme/books/[id]`
 * para obtener nombre y currency del libro.
 */

import { BookWorkspace } from '@/components/workspace/pyme/BookWorkspace';

interface PageProps {
  params: Promise<{ bookId: string }>;
}

export default async function PymeBookPage({ params }: PageProps) {
  const { bookId } = await params;
  return <BookWorkspace bookId={bookId} />;
}
