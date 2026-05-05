'use client';

// ---------------------------------------------------------------------------
// ImportStatementDialog — modal de importación de extracto bancario (WS3).
//
// Acepta un CSV via drag-and-drop o selector de archivo.
// POST → /api/accounting/banking/imports (JSON + base64)
//
// Estados: idle → loading → success | error
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  FileText,
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BankAccountRow } from '@/lib/accounting/banking/types';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface ImportResult {
  transactionCount: number;
  duplicatesSkipped: number;
  filename: string;
}

type DialogState = 'idle' | 'loading' | 'success' | 'error';

interface Props {
  bankAccount: BankAccountRow;
  open: boolean;
  onClose: () => void;
  /** Llamado cuando la importación termina con éxito */
  onImported: (result: ImportResult) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Quitar el prefijo "data:...;base64,"
      const base64 = dataUrl.split(',')[1];
      if (!base64) reject(new Error('No se pudo leer el archivo.'));
      else resolve(base64);
    };
    reader.onerror = () => reject(new Error('Error al leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ImportStatementDialog({
  bankAccount,
  open,
  onClose,
  onImported,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<DialogState>('idle');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Abrir/cerrar el <dialog> nativo en sync con la prop `open`
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open) {
      if (!el.open) el.showModal();
    } else {
      if (el.open) el.close();
      // Reset state al cerrar
      setFile(null);
      setState('idle');
      setResult(null);
      setErrorMsg(null);
    }
  }, [open]);

  // Cierre con Escape nativo — sincronizar estado
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener('cancel', handleCancel);
    return () => el.removeEventListener('cancel', handleCancel);
  }, [onClose]);

  const handleFileChange = useCallback(
    (incoming: File | null) => {
      if (!incoming) return;
      if (!incoming.name.toLowerCase().endsWith('.csv')) {
        setErrorMsg('Solo se aceptan archivos CSV.');
        return;
      }
      setErrorMsg(null);
      setFile(incoming);
      setState('idle');
      setResult(null);
    },
    [],
  );

  // Drag-and-drop handlers
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }
  function handleDragLeave() {
    setDragging(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0] ?? null;
    handleFileChange(dropped);
  }

  async function handleSubmit() {
    if (!file) return;
    setState('loading');
    setErrorMsg(null);
    try {
      const contentBase64 = await readFileAsBase64(file);
      const res = await fetch('/api/accounting/banking/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankAccountId: bankAccount.id,
          filename: file.name,
          contentBase64,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        throw new Error(
          body.message ?? body.error ?? `Error ${res.status} al importar.`,
        );
      }
      const data = (await res.json()) as {
        transactionCount?: number;
        duplicatesSkipped?: number;
        filename?: string;
      };
      const importResult: ImportResult = {
        transactionCount: data.transactionCount ?? 0,
        duplicatesSkipped: data.duplicatesSkipped ?? 0,
        filename: data.filename ?? file.name,
      };
      setResult(importResult);
      setState('success');
    } catch (err) {
      setErrorMsg((err as Error).message ?? 'Error desconocido al importar.');
      setState('error');
    }
  }

  function handleRetry() {
    setState('idle');
    setErrorMsg(null);
    setResult(null);
    setFile(null);
  }

  function handleSuccessClose() {
    if (result) onImported(result);
    else onClose();
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <dialog
      ref={dialogRef}
      className={cn(
        'fixed inset-0 m-auto w-full max-w-md rounded-xl',
        'border border-zinc-700 bg-zinc-900 p-0 shadow-2xl',
        'backdrop:bg-black/70 backdrop:backdrop-blur-sm',
        'open:flex open:flex-col',
      )}
      style={{ maxHeight: '90vh' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4 shrink-0">
        <div>
          <p className="text-xs font-mono uppercase tracking-widest text-zinc-500">
            Conciliación bancaria
          </p>
          <h2 className="mt-0.5 text-base font-semibold text-zinc-100">
            Importar extracto bancario
          </h2>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition"
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Cuenta destino */}
      <div className="border-b border-zinc-800/60 bg-zinc-900/80 px-6 py-3 shrink-0">
        <p className="text-xs text-zinc-500">
          Cuenta:{' '}
          <span className="text-zinc-300 font-medium">{bankAccount.bankName}</span>
          {' · '}
          <span className="font-mono text-zinc-400">{bankAccount.accountNumber}</span>
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {/* ── Estado: idle / error (sin archivo previo) ── */}
        {(state === 'idle' || state === 'error') && (
          <>
            {/* Drop zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'cursor-pointer rounded-xl border-2 border-dashed px-6 py-10 text-center transition select-none',
                dragging
                  ? 'border-amber-500/60 bg-amber-500/5'
                  : 'border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800/30',
              )}
            >
              <Upload
                className={cn(
                  'mx-auto h-8 w-8 mb-3',
                  dragging ? 'text-amber-400' : 'text-zinc-600',
                )}
                aria-hidden="true"
              />
              <p className="text-sm text-zinc-400">
                Arrastra el CSV aquí o{' '}
                <span className="text-amber-400 underline underline-offset-2">
                  selecciona un archivo
                </span>
              </p>
              <p className="mt-1 text-xs text-zinc-600">Solo archivos .csv</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              />
            </div>

            {/* Archivo seleccionado */}
            {file && state === 'idle' && (
              <div className="mt-4 flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3">
                <FileText className="h-5 w-5 text-amber-400 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-200 truncate">{file.name}</p>
                  <p className="text-xs text-zinc-500">{formatBytes(file.size)}</p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                  }}
                  className="text-zinc-600 hover:text-zinc-400 transition"
                  aria-label="Quitar archivo"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Error message */}
            {errorMsg && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-800/40 bg-red-950/20 px-3 py-2.5 text-xs text-red-400">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
          </>
        )}

        {/* ── Estado: loading ── */}
        {state === 'loading' && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-amber-400" aria-hidden="true" />
            <p className="text-sm text-zinc-400">
              Importando extracto, por favor espera…
            </p>
            {file && (
              <p className="text-xs text-zinc-600 font-mono">{file.name}</p>
            )}
          </div>
        )}

        {/* ── Estado: success ── */}
        {state === 'success' && result && (
          <div className="flex flex-col items-center text-center py-8 gap-4">
            <CheckCircle2 className="h-10 w-10 text-emerald-400" aria-hidden="true" />
            <div>
              <p className="text-base font-semibold text-zinc-100">
                Extracto importado exitosamente
              </p>
              <p className="mt-1 text-sm text-zinc-400">
                <span className="font-medium text-zinc-200">{result.transactionCount}</span>{' '}
                transacciones importadas
                {result.duplicatesSkipped > 0 && (
                  <>
                    ,{' '}
                    <span className="font-medium text-zinc-400">
                      {result.duplicatesSkipped}
                    </span>{' '}
                    duplicadas omitidas
                  </>
                )}
                .
              </p>
              <p className="mt-2 text-xs text-zinc-600 font-mono">{result.filename}</p>
            </div>
          </div>
        )}
      </div>

      {/* Footer acciones */}
      <div className="border-t border-zinc-800 px-6 py-4 flex justify-end gap-3 shrink-0">
        {state === 'idle' && (
          <>
            <button
              onClick={onClose}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 transition"
            >
              Cancelar
            </button>
            <button
              onClick={() => void handleSubmit()}
              disabled={!file}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition',
                'bg-amber-500 text-zinc-900 hover:bg-amber-400',
                'disabled:opacity-40 disabled:cursor-not-allowed',
              )}
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              Subir e importar
            </button>
          </>
        )}

        {state === 'error' && (
          <>
            <button
              onClick={onClose}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 transition"
            >
              Cancelar
            </button>
            <button
              onClick={handleRetry}
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-600 transition"
            >
              <RefreshCw className="h-4 w-4" />
              Reintentar
            </button>
          </>
        )}

        {state === 'success' && (
          <button
            onClick={handleSuccessClose}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-amber-400 transition"
          >
            <CheckCircle2 className="h-4 w-4" />
            Cerrar y reconciliar
          </button>
        )}

        {state === 'loading' && (
          <button
            disabled
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500/40 px-4 py-2 text-sm font-medium text-zinc-600 cursor-not-allowed"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Importando…
          </button>
        )}
      </div>
    </dialog>
  );
}
