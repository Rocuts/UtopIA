'use client';

/**
 * /workspace/pyme/subir — resolvedor de "Foto de Factura" sin libro.
 *
 * El hub Pyme y "Mi Libro" enlazan a la foto de factura sin conocer un
 * bookId (el flujo real vive en /workspace/pyme/[bookId]/subir). Esta ruta
 * resuelve el libro destino:
 *   1. GET /api/pyme/books → si hay libros, redirige al subir del primero.
 *   2. Si no hay libros aún, redirige al listado para crear el primero.
 *
 * Sin esta ruta estática, /workspace/pyme/subir caería en el segmento
 * dinámico [bookId] con bookId="subir".
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Camera } from 'lucide-react';
import { AreaFX } from '@/components/workspace/AreaFX';

interface BooksResponse {
  ok: boolean;
  books?: { id: string }[];
}

export default function PymeSubirResolverPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/pyme/books');
        const json: BooksResponse = await res.json();
        if (cancelled) return;
        const first = json.books?.[0];
        if (first) {
          router.replace(`/workspace/pyme/${first.id}/subir`);
        } else {
          router.replace('/workspace/pyme/libros');
        }
      } catch {
        if (!cancelled) router.replace('/workspace/pyme/libros');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div
      className="relative flex min-h-full w-full items-center justify-center"
      style={{
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--color-area-pyme, #357A28) 8%, var(--color-n-0, #FCFBF8)), var(--color-n-0, #FCFBF8) 320px)',
      }}
    >
      <AreaFX area="pyme" />
      <div className="relative z-[2] flex flex-col items-center gap-3 text-center">
        <span className="inline-flex h-12 w-12 animate-pulse items-center justify-center rounded-full bg-area-pyme/15 text-area-pyme">
          <Camera className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <p className="text-sm text-n-600">Abriendo su libro…</p>
      </div>
    </div>
  );
}
