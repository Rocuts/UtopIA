'use client';

/**
 * /workspace/contabilidad/apertura — Cargar Apertura de Saldos
 *
 * Página completa con:
 *  1. Back link + heading con icono Upload
 *  2. Stats row: Período / Cuentas cargadas / Estado
 *  3. Import options (3 cards): Excel/CSV · ERP directo · Manual
 *  4. Dropzone con borde dorado punteado
 *  5. Column mapping preview (tabla de 3 filas de muestra)
 */

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  FileSpreadsheet,
  Link2,
  Loader2,
  PenLine,
  Upload,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ImportCard = 'excel' | 'erp' | 'manual';

type Status = 'pendiente' | 'cargando' | 'validado' | 'error';

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  pendiente: {
    label: 'Pendiente',
    cls: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  },
  cargando: {
    label: 'Cargando…',
    cls: 'bg-n-100 text-n-700 border-n-300',
  },
  validado: {
    label: 'Validado',
    cls: 'bg-success/10 text-success border-success/30',
  },
  error: {
    label: 'Error',
    cls: 'bg-danger/10 text-danger border-danger/30',
  },
};

// Sample preview rows for the column-mapping table
const PREVIEW_ROWS = [
  { codigo: '1105', nombre: 'Caja general', saldo: '$1.240.000' },
  { codigo: '1110', nombre: 'Bancos — Cuenta corriente', saldo: '$11.240.000' },
  { codigo: '1435', nombre: 'Inventarios de mercancías', saldo: '$26.400.000' },
];

const ACCEPT =
  '.csv,.txt,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';
const MAX_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AperturaPage() {
  const inputRef = useRef<HTMLInputElement>(null);

  const [activeCard, setActiveCard] = useState<ImportCard>('excel');
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('pendiente');
  const [cuentasCargadas, setCuentasCargadas] = useState(0);
  const [periodo] = useState('Ene 2026');

  // ─── File handling ────────────────────────────────────────────────────────

  const acceptFile = useCallback((f: File | null) => {
    setFileError(null);
    if (!f) {
      setFile(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      setFileError('El archivo supera el máximo de 5 MB');
      return;
    }
    setFile(f);
    setStatus('cargando');
    // Simulate async parse (real impl POSTs to /api/accounting/opening-balance)
    setUploading(true);
    setTimeout(() => {
      setUploading(false);
      setStatus('validado');
      setCuentasCargadas(412);
    }, 1400);
  }, []);

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
    setFileError(null);
    setStatus('pendiente');
    setCuentasCargadas(0);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────

  const st = STATUS_META[status];

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8 md:py-10">
      {/* Back link */}
      <Link
        href="/workspace/contabilidad"
        className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-n-700 hover:text-n-1000 mb-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A] rounded"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Contabilidad
      </Link>

      {/* Heading */}
      <header className="mb-7">
        <div className="flex items-center gap-2 mb-1">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#B8934A]/10">
            <Upload className="h-4 w-4 text-[#B8934A]" aria-hidden="true" />
          </span>
          <p className="font-mono text-xs uppercase tracking-widest text-[#B8934A] font-semibold">
            Contabilidad — Apertura
          </p>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-n-1000 tracking-tight">
          Carga de Saldos de Apertura
        </h1>
        <p className="mt-1.5 text-sm text-n-700 max-w-xl">
          Importe sus saldos iniciales desde Excel o CSV. Validamos la partida
          doble antes de contabilizar el asiento de apertura.
        </p>
      </header>

      {/* ── Stats row ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3 mb-7">
        {/* Período */}
        <div className="rounded-xl border border-n-200 bg-n-0 px-4 py-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-n-500 mb-0.5">
            Período
          </p>
          <p className="text-sm font-semibold text-n-1000 tabular-nums">
            {periodo}
          </p>
        </div>

        {/* Cuentas cargadas */}
        <div className="rounded-xl border border-n-200 bg-n-0 px-4 py-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-n-500 mb-0.5">
            Cuentas cargadas
          </p>
          <p className="text-sm font-semibold text-n-1000 tabular-nums">
            {cuentasCargadas === 0 ? '—' : cuentasCargadas.toLocaleString('es-CO')}
          </p>
        </div>

        {/* Estado */}
        <div className="rounded-xl border border-n-200 bg-n-0 px-4 py-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-n-500 mb-0.5">
            Estado
          </p>
          <span
            className={cn(
              'inline-flex items-center gap-1 text-xs font-semibold rounded-full border px-2 py-0.5',
              st.cls,
            )}
          >
            {uploading ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            ) : status === 'validado' ? (
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
            ) : null}
            {uploading ? 'Procesando…' : st.label}
          </span>
        </div>
      </div>

      {/* ── Import options (3 cards) ──────────────────────────────────────── */}
      <section className="mb-7">
        <p className="text-xs font-mono uppercase tracking-widest text-n-600 font-semibold mb-3">
          1. Seleccionar método de carga
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Excel / CSV — primary */}
          <button
            type="button"
            onClick={() => setActiveCard('excel')}
            className={cn(
              'rounded-xl border-2 p-4 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A]',
              activeCard === 'excel'
                ? 'border-[#B8934A] bg-[#B8934A]/8'
                : 'border-n-200 bg-n-0 hover:border-[#B8934A]/40',
            )}
          >
            <span
              className={cn(
                'inline-flex h-9 w-9 items-center justify-center rounded-lg mb-3',
                activeCard === 'excel'
                  ? 'bg-[#B8934A] text-n-0'
                  : 'bg-[#B8934A]/10 text-[#B8934A]',
              )}
            >
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            </span>
            <p className="text-sm font-semibold text-n-1000 mb-0.5">
              Excel / CSV
            </p>
            <p className="text-xs text-n-600">Plantilla estándar PUC</p>
          </button>

          {/* ERP directo */}
          <button
            type="button"
            onClick={() => setActiveCard('erp')}
            className={cn(
              'rounded-xl border-2 p-4 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A]',
              activeCard === 'erp'
                ? 'border-[#B8934A] bg-[#B8934A]/8'
                : 'border-n-200 bg-n-0 hover:border-[#B8934A]/40',
            )}
          >
            <span
              className={cn(
                'inline-flex h-9 w-9 items-center justify-center rounded-lg mb-3',
                activeCard === 'erp'
                  ? 'bg-[#B8934A] text-n-0'
                  : 'bg-[#B8934A]/10 text-[#B8934A]',
              )}
            >
              <Link2 className="h-4 w-4" aria-hidden="true" />
            </span>
            <p className="text-sm font-semibold text-n-1000 mb-0.5">
              ERP directo
            </p>
            <p className="text-xs text-n-600">Conectar con Siigo / Alegra</p>
          </button>

          {/* Manual */}
          <button
            type="button"
            onClick={() => setActiveCard('manual')}
            className={cn(
              'rounded-xl border-2 p-4 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A]',
              activeCard === 'manual'
                ? 'border-[#B8934A] bg-[#B8934A]/8'
                : 'border-n-200 bg-n-0 hover:border-[#B8934A]/40',
            )}
          >
            <span
              className={cn(
                'inline-flex h-9 w-9 items-center justify-center rounded-lg mb-3',
                activeCard === 'manual'
                  ? 'bg-[#B8934A] text-n-0'
                  : 'bg-[#B8934A]/10 text-[#B8934A]',
              )}
            >
              <PenLine className="h-4 w-4" aria-hidden="true" />
            </span>
            <p className="text-sm font-semibold text-n-1000 mb-0.5">Manual</p>
            <p className="text-xs text-n-600">Ingresar cuenta a cuenta</p>
          </button>
        </div>
      </section>

      {/* ── Dropzone (only for Excel card) ───────────────────────────────── */}
      {activeCard === 'excel' && (
        <section className="mb-7">
          <p className="text-xs font-mono uppercase tracking-widest text-n-600 font-semibold mb-3">
            2. Subir archivo
          </p>

          {/* Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            onClick={() => !file && inputRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !file) {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="Subir archivo Excel o CSV"
            className={cn(
              'rounded-xl border-2 border-dashed transition-colors p-10 text-center',
              !file && 'cursor-pointer',
              drag
                ? 'border-[#B8934A] bg-[#B8934A]/8'
                : file
                  ? 'border-[#B8934A]/50 bg-[#B8934A]/5'
                  : 'border-[#B8934A]/35 bg-n-0 hover:border-[#B8934A]/55',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A]',
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              onChange={onPick}
              className="hidden"
            />

            {file ? (
              /* File selected state */
              <div className="flex items-center justify-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#B8934A]/10 text-[#B8934A] shrink-0">
                  <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="text-left min-w-0">
                  <p className="text-sm font-semibold text-n-1000 truncate max-w-xs">
                    {file.name}
                  </p>
                  <p className="text-xs text-n-500 tabular-nums">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearFile();
                  }}
                  className="ml-auto p-1.5 rounded text-n-500 hover:text-danger hover:bg-danger/8 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger shrink-0"
                  aria-label="Quitar archivo"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : (
              /* Empty state */
              <div className="flex flex-col items-center gap-3">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#B8934A]/10 text-[#B8934A]">
                  <Upload className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-n-1000">
                    {drag
                      ? 'Suelta el archivo aquí'
                      : 'Arrastra tu archivo Excel'}
                  </p>
                  <p className="text-xs text-n-500 mt-1">
                    o haz clic para seleccionar
                  </p>
                </div>
                <p className="text-[11px] text-n-500 bg-n-100 rounded-full px-3 py-1">
                  .xlsx, .csv — Plantilla PUC Colombia
                </p>
              </div>
            )}
          </div>

          {/* File error */}
          {fileError && (
            <p className="mt-2 text-xs text-danger" role="alert">
              {fileError}
            </p>
          )}
        </section>
      )}

      {/* ERP placeholder */}
      {activeCard === 'erp' && (
        <section className="mb-7">
          <div className="rounded-xl border border-n-200 bg-n-0 p-8 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#B8934A]/10 text-[#B8934A] mb-3">
              <Link2 className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="text-sm font-semibold text-n-1000 mb-1">
              Integración ERP — próximamente
            </p>
            <p className="text-xs text-n-600 max-w-xs mx-auto">
              La conexión directa con Siigo y Alegra estará disponible en la
              próxima actualización.
            </p>
          </div>
        </section>
      )}

      {/* Manual placeholder */}
      {activeCard === 'manual' && (
        <section className="mb-7">
          <div className="rounded-xl border border-n-200 bg-n-0 p-8 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#B8934A]/10 text-[#B8934A] mb-3">
              <PenLine className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="text-sm font-semibold text-n-1000 mb-1">
              Entrada manual de cuentas
            </p>
            <p className="text-xs text-n-600 max-w-xs mx-auto">
              Use el módulo de asientos para ingresar saldos de apertura
              directamente en el diario.
            </p>
            <Link
              href="/workspace/contabilidad/asientos/nuevo"
              className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-md bg-[#B8934A] text-n-0 text-sm font-semibold hover:bg-[#a07a39] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A] focus-visible:ring-offset-2"
            >
              <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
              Nuevo asiento
            </Link>
          </div>
        </section>
      )}

      {/* ── Column mapping preview ─────────────────────────────────────────── */}
      <section className="mb-7">
        <p className="text-xs font-mono uppercase tracking-widest text-n-600 font-semibold mb-3">
          {activeCard === 'excel' ? '3. Vista previa de columnas' : '2. Vista previa de columnas'}
        </p>
        <div className="rounded-xl border border-n-200 bg-n-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Vista previa de columnas">
              <thead>
                <tr className="border-b border-n-200 bg-n-50">
                  <th
                    scope="col"
                    className="px-4 py-2.5 text-left text-[10px] font-mono uppercase tracking-widest text-n-500 font-semibold"
                  >
                    Código PUC
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2.5 text-left text-[10px] font-mono uppercase tracking-widest text-n-500 font-semibold"
                  >
                    Nombre cuenta
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2.5 text-right text-[10px] font-mono uppercase tracking-widest text-n-500 font-semibold"
                  >
                    Saldo inicial
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-n-100">
                {PREVIEW_ROWS.map((row) => (
                  <tr
                    key={row.codigo}
                    className="hover:bg-n-50 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-[#B8934A]">
                      {row.codigo}
                    </td>
                    <td className="px-4 py-3 text-sm text-n-800">
                      {row.nombre}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-n-700 tabular-nums">
                      {row.saldo}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-n-200 bg-n-50">
                  <td
                    colSpan={3}
                    className="px-4 py-2 text-[11px] text-n-500 italic"
                  >
                    {file && status === 'validado'
                      ? `${cuentasCargadas} cuentas detectadas — partida doble validada`
                      : 'Vista previa con datos de ejemplo — suba un archivo para ver los saldos reales'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </section>

      {/* ── Action buttons ─────────────────────────────────────────────────── */}
      {activeCard === 'excel' && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!file || uploading || status !== 'validado'}
            className={cn(
              'inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors',
              'bg-[#B8934A] text-n-0 hover:bg-[#a07a39]',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A] focus-visible:ring-offset-2',
              'disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-[#B8934A]/40',
            )}
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Contabilizar apertura
          </button>
          <Link
            href="/workspace/contabilidad"
            className={cn(
              'inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors',
              'border border-n-200 text-n-700 bg-n-0 hover:bg-n-50 hover:text-n-1000',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A]',
            )}
          >
            Descartar
          </Link>
        </div>
      )}
    </div>
  );
}
