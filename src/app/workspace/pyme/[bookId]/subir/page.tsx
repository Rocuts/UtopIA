'use client';

/**
 * Pagina dedicada de subir fotos — cámara OCR con UI por etapas.
 * Usa el área pyme (fondo verde + partículas) como las demás páginas del área.
 */

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft, Camera } from 'lucide-react';

import { AreaFX } from '@/components/workspace/AreaFX';
import { PhotoUploader } from '@/components/workspace/pyme/PhotoUploader';

interface PageProps {
  params: Promise<{ bookId: string }>;
}

export default function PymeUploadPage({ params }: PageProps) {
  const { bookId } = use(params);

  return (
    <div
      className="relative min-h-full w-full"
      style={{
        background: [
          'radial-gradient(1200px 700px at 84% -14%, color-mix(in srgb, var(--color-area-pyme, #357A28) 24%, transparent), transparent 58%)',
          'linear-gradient(180deg, color-mix(in srgb, var(--color-area-pyme, #357A28) 8%, var(--color-n-0, #FCFBF8)), var(--color-n-0, #FCFBF8) 320px)',
          'color-mix(in srgb, var(--color-area-pyme, #357A28) 9%, var(--color-n-0, #FCFBF8))',
        ].join(', '),
      }}
    >
      <AreaFX area="pyme" />

      <div className="relative z-[2] mx-auto w-full max-w-3xl px-6 md:px-10 py-8">
        {/* Back link */}
        <Link
          href={`/workspace/pyme/${bookId}`}
          className="inline-flex items-center gap-1.5 text-sm text-n-600 hover:text-n-1000 mb-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#357A28] rounded-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          <span>Volver a mi negocio</span>
        </Link>

        {/* Subhead */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-md"
              style={{ background: 'rgb(53 122 40 / 0.12)', color: '#357A28' }}
            >
              <Camera className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            </span>
            <span className="text-xs font-medium text-n-600 tracking-wide uppercase">
              Contabilidad Pyme — Foto de Factura
            </span>
          </div>
          <h1 className="font-serif-elite text-3xl md:text-4xl font-medium tracking-tight text-n-1000 leading-tight">
            Foto de Factura
          </h1>
          <p className="mt-2 text-n-600 max-w-lg">
            Tómele una foto a la factura y nosotros la anotamos por usted.{' '}
            Si no se ve bien, le ayudamos a arreglarlo.
          </p>
        </div>

        {/* Main uploader — centered on mobile, left-aligned on wide */}
        <PhotoUploader bookId={bookId} />
      </div>
    </div>
  );
}
