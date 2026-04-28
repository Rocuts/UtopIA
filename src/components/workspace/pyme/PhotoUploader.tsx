'use client';

/**
 * PhotoUploader — sube fotos del cuaderno y hace polling de OCR status.
 *
 * Flujo:
 *  1. Usuario selecciona archivos (input file con `capture="environment"`
 *     para que mobile abra la camara directamente).
 *  2. Por cada archivo: POST a `/api/pyme/uploads` con FormData. Recibe
 *     `{ uploadId }`.
 *  3. Polling cada 2s a `/api/pyme/uploads/[uploadId]` hasta que el
 *     `ocrStatus` sea `done` o `failed`. Limpia el `setInterval` al
 *     unmount o al terminar.
 *  4. Cuando todos los uploads terminaron, llama `onUploadsComplete()`
 *     para que el padre (EntryReview) recargue los drafts.
 *
 * NO importa de `@/lib/db/*`. Solo `fetch` a `/api/pyme/*`.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Camera,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Upload,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';

type FileStage = 'pending' | 'uploading' | 'processing' | 'done' | 'failed';

interface FileItem {
  localId: string;
  file: File;
  previewUrl: string;
  uploadId: string | null;
  stage: FileStage;
  error: string | null;
}

interface PhotoUploaderProps {
  bookId: string;
  /** Llamado cuando al menos un upload llego a `done`. Se invoca tras cada
   * `done`, no solo al final del batch — asi `EntryReview` puede ir
   * mostrando drafts incrementales. */
  onUploadsComplete?: () => void;
}

const POLL_INTERVAL_MS = 2_000;
const MAX_FILE_SIZE = 4 * 1024 * 1024;
const ALLOWED_MIME = /^image\/(jpeg|png|webp|heic|heif)$/i;
// Spec §4.11: cap de 5 fotos por batch / por minuto (cap de costo OCR).
// El servidor enforza el rate-limit; aqui hacemos hard-cap UX para evitar
// que el usuario suba 50 fotos y vea 45 errores.
const MAX_BATCH_FILES = 5;

export function PhotoUploader({ bookId, onUploadsComplete }: PhotoUploaderProps) {
  const { t } = useLanguage();
  const tt = t.pyme.uploader;

  const [items, setItems] = useState<FileItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Timers indexados por localId para limpieza al unmount. */
  const timersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(
    new Map(),
  );
  /** Object URLs creados por createObjectURL que hay que revocar. */
  const objectUrlsRef = useRef<Set<string>>(new Set());

  // Cleanup on unmount. Capture refs at effect-mount time per React's
  // exhaustive-deps lint guideline, even though these refs hold mutable
  // state (Map / Set) rather than DOM nodes.
  useEffect(() => {
    const timers = timersRef.current;
    const objectUrls = objectUrlsRef.current;
    return () => {
      timers.forEach((tm) => clearInterval(tm));
      timers.clear();
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.clear();
    };
  }, []);

  const updateItem = useCallback(
    (localId: string, patch: Partial<FileItem>) => {
      setItems((prev) =>
        prev.map((it) => (it.localId === localId ? { ...it, ...patch } : it)),
      );
    },
    [],
  );

  const startPolling = useCallback(
    (localId: string, uploadId: string) => {
      // Avoid duplicate timers for the same item.
      const existing = timersRef.current.get(localId);
      if (existing) clearInterval(existing);

      const timer = setInterval(async () => {
        try {
          const res = await fetch(`/api/pyme/uploads/${uploadId}`);
          if (!res.ok) throw new Error('poll_failed');
          const json = (await res.json()) as {
            ok: boolean;
            upload?: { ocrStatus: string; errorMessage: string | null };
          };
          if (!json.ok || !json.upload) throw new Error('bad_response');
          const status = json.upload.ocrStatus;
          if (status === 'done') {
            clearInterval(timer);
            timersRef.current.delete(localId);
            updateItem(localId, { stage: 'done' });
            onUploadsComplete?.();
          } else if (status === 'failed') {
            clearInterval(timer);
            timersRef.current.delete(localId);
            updateItem(localId, {
              stage: 'failed',
              error: json.upload.errorMessage ?? 'ocr_failed',
            });
          }
        } catch {
          // Transient errors: keep polling. Hard failures get caught by status.
        }
      }, POLL_INTERVAL_MS);
      timersRef.current.set(localId, timer);
    },
    [updateItem, onUploadsComplete],
  );

  const uploadFile = useCallback(
    async (item: FileItem) => {
      updateItem(item.localId, { stage: 'uploading', error: null });
      try {
        const fd = new FormData();
        fd.append('bookId', bookId);
        fd.append('file', item.file);
        const res = await fetch('/api/pyme/uploads', {
          method: 'POST',
          body: fd,
        });
        const json = (await res.json()) as {
          ok: boolean;
          uploadId?: string;
          error?: string;
        };
        if (!res.ok || !json.ok || !json.uploadId) {
          throw new Error(json.error ?? 'upload_failed');
        }
        updateItem(item.localId, {
          stage: 'processing',
          uploadId: json.uploadId,
        });
        startPolling(item.localId, json.uploadId);
      } catch (err) {
        updateItem(item.localId, {
          stage: 'failed',
          error: err instanceof Error ? err.message : 'upload_failed',
        });
      }
    },
    [bookId, updateItem, startPolling],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      // Hard-cap UX: el spec limita 5 fotos por batch (cap de costo OCR).
      // Recortamos antes de procesar y mostramos mensaje inline si el usuario
      // selecciono mas. El servidor tambien enforza rate-limit por minuto.
      const arr = Array.from(files);
      const slice = arr.slice(0, MAX_BATCH_FILES);
      if (arr.length > MAX_BATCH_FILES) {
        setBatchError(
          `Maximo ${MAX_BATCH_FILES} fotos a la vez. Sube las restantes despues.`,
        );
      } else {
        setBatchError(null);
      }

      const newItems: FileItem[] = [];
      slice.forEach((file) => {
        // Validate size + mime client-side. Backend re-validates.
        if (file.size > MAX_FILE_SIZE) return;
        if (!ALLOWED_MIME.test(file.type) && !file.type.startsWith('image/')) {
          return;
        }
        const previewUrl = URL.createObjectURL(file);
        objectUrlsRef.current.add(previewUrl);
        newItems.push({
          localId:
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
              ? crypto.randomUUID()
              : `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          file,
          previewUrl,
          uploadId: null,
          stage: 'pending',
          error: null,
        });
      });
      if (newItems.length === 0) return;
      setItems((prev) => [...prev, ...newItems]);
      // Kick off uploads
      newItems.forEach((it) => {
        void uploadFile(it);
      });
    },
    [uploadFile],
  );

  const removeItem = useCallback((localId: string) => {
    const timer = timersRef.current.get(localId);
    if (timer) {
      clearInterval(timer);
      timersRef.current.delete(localId);
    }
    setItems((prev) => {
      const found = prev.find((it) => it.localId === localId);
      if (found) {
        URL.revokeObjectURL(found.previewUrl);
        objectUrlsRef.current.delete(found.previewUrl);
      }
      return prev.filter((it) => it.localId !== localId);
    });
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      // Reset so re-selecting same file works
      e.target.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const allDone = items.length > 0 && items.every((it) => it.stage === 'done');

  return (
    <div className="space-y-5">
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={cn(
          'relative rounded-xl border-2 border-dashed bg-n-100 p-8 transition-colors',
          'flex flex-col items-center justify-center text-center gap-3',
          dragActive
            ? 'border-area-escudo bg-n-200'
            : 'border-n-300 hover:border-area-escudo',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={handleInputChange}
          className="sr-only"
          aria-label={tt.choose_files}
        />
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-n-0 text-area-escudo">
          <Camera className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div>
          <p className="text-base font-medium text-n-1000">{tt.drop}</p>
          <p className="text-sm text-n-600">{tt.drop_hint}</p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={cn(
            'mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-md',
            'bg-area-escudo text-n-0 text-sm font-medium',
            'hover:opacity-90 transition-opacity',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2',
          )}
        >
          <Upload className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          <span>{tt.choose_files}</span>
        </button>
        <p className="text-xs text-n-500 mt-1">
          {tt.formats} · {tt.max_size}
        </p>
      </div>

      {/* Batch-cap warning */}
      {batchError && (
        <div className="flex items-center gap-3 rounded-md border border-n-200 bg-n-100 px-4 py-3">
          <AlertCircle
            className="h-5 w-5 text-area-escudo shrink-0"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <p className="text-sm text-n-1000">{batchError}</p>
        </div>
      )}

      {/* All-done banner */}
      {allDone && (
        <div className="flex items-center gap-3 rounded-md border border-n-200 bg-n-100 px-4 py-3">
          <CheckCircle2
            className="h-5 w-5 text-success shrink-0"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <p className="text-sm font-medium text-n-1000">{tt.all_done}</p>
        </div>
      )}

      {/* File list */}
      {items.length > 0 && (
        <ul role="list" className="space-y-2">
          {items.map((it) => (
            <FileRow key={it.localId} item={it} onRemove={removeItem} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── File row ────────────────────────────────────────────────────────────────

function FileRow({
  item,
  onRemove,
}: {
  item: FileItem;
  onRemove: (id: string) => void;
}) {
  const { t } = useLanguage();
  const tt = t.pyme.uploader;

  const stageLabel: Record<FileStage, string> = {
    pending: tt.pending,
    uploading: tt.uploading,
    processing: tt.processing,
    done: tt.done,
    failed: tt.failed,
  };

  const isFinal = item.stage === 'done' || item.stage === 'failed';

  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-md border bg-n-0 px-3 py-2.5',
        item.stage === 'failed' ? 'border-n-300' : 'border-n-200',
      )}
    >
      {/* Thumbnail */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.previewUrl}
        alt=""
        className="h-12 w-12 rounded-md object-cover bg-n-200 shrink-0"
      />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-n-1000 truncate">
          {item.file.name}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <StatusBadge stage={item.stage} label={stageLabel[item.stage]} />
          {item.error && item.stage === 'failed' && (
            <span className="text-xs text-area-escudo truncate">
              {item.error}
            </span>
          )}
        </div>
      </div>

      {/* Action */}
      {isFinal && (
        <button
          type="button"
          onClick={() => onRemove(item.localId)}
          aria-label={tt.remove}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-n-600 hover:bg-n-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

// ─── Status badge ────────────────────────────────────────────────────────────

function StatusBadge({ stage, label }: { stage: FileStage; label: string }) {
  if (stage === 'done') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-n-100 text-success border border-n-200">
        <CheckCircle2 className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
        {label}
      </span>
    );
  }
  if (stage === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-n-100 text-area-escudo border border-n-200">
        <AlertCircle className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
        {label}
      </span>
    );
  }
  // pending / uploading / processing
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-n-100 text-n-700 border border-n-200">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-area-escudo animate-pulse"
      />
      {label}
    </span>
  );
}
