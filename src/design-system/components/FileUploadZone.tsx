'use client';

import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Upload, CheckCircle, AlertCircle, FileText, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type UploadState = 'idle' | 'dragover' | 'uploading' | 'success' | 'error';

interface UploadedFileInfo {
  name: string;
  size: number;
  status: UploadState;
}

interface FileUploadZoneProps {
  accept?: string;
  onUpload: (file: File) => Promise<void>;
  maxSizeMB?: number;
  label?: string;
  sublabel?: string;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileUploadZone({
  accept = '.csv,.xlsx,.xls,.pdf,.docx,.doc,.jpg,.jpeg,.png',
  onUpload,
  maxSizeMB = 25,
  label = 'Arrastre su archivo aquí',
  sublabel = 'o haga clic para seleccionar',
  disabled = false,
  className,
  children,
}: FileUploadZoneProps) {
  const prefersReduced = useReducedMotion();
  const [state, setState] = useState<UploadState>('idle');
  const [files, setFiles] = useState<UploadedFileInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    if (file.size > maxSizeMB * 1024 * 1024) {
      setError(`Archivo excede ${maxSizeMB}MB`);
      setState('error');
      return;
    }

    const fileInfo: UploadedFileInfo = { name: file.name, size: file.size, status: 'uploading' };
    setFiles(prev => [...prev, fileInfo]);
    setState('uploading');
    setError(null);
    setProgress(0);

    const progressInterval = setInterval(() => {
      setProgress(p => Math.min(p + Math.random() * 15, 90));
    }, 200);

    try {
      await onUpload(file);
      clearInterval(progressInterval);
      setProgress(100);
      setState('success');
      setFiles(prev => prev.map(f => f.name === file.name ? { ...f, status: 'success' } : f));
      setTimeout(() => setState('idle'), 2000);
    } catch (err) {
      clearInterval(progressInterval);
      setState('error');
      setError(err instanceof Error ? err.message : 'Error al subir archivo');
      setFiles(prev => prev.map(f => f.name === file.name ? { ...f, status: 'error' } : f));
    }
  }, [maxSizeMB, onUpload]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setState('dragover');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setState('idle');
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) await processFile(file);
  };

  const handleSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await processFile(file);
    if (inputRef.current) inputRef.current.value = '';
  };

  const removeFile = (name: string) => {
    setFiles(prev => prev.filter(f => f.name !== name));
  };

  return (
    <div className={cn('w-full', className)}>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={cn(
          'relative rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-all',
          state === 'dragover' && 'border-[#D4A017] bg-[#FEF9EC]',
          state === 'uploading' && 'border-[#D4A017] bg-[#FEF9EC]/50 pointer-events-none',
          state === 'success' && 'border-[#22C55E] bg-[#F0FDF4]',
          state === 'error' && 'border-[#EF4444] bg-[#FEF2F2]',
          state === 'idle' && 'border-[#e5e5e5] hover:border-[#D4A017] hover:bg-[#FEF9EC]/30',
          disabled && 'opacity-50 pointer-events-none',
        )}
        role="button"
        tabIndex={0}
        aria-label={label}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleSelect}
          className="hidden"
          disabled={disabled}
          aria-label={label}
          aria-describedby={sublabel ? 'file-upload-hint' : undefined}
          tabIndex={-1}
        />

        <AnimatePresence mode="wait">
          {state === 'uploading' ? (
            <motion.div
              key="uploading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-2"
            >
              <motion.div
                animate={prefersReduced ? {} : { rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              >
                <Upload className="w-8 h-8 text-[#D4A017]" />
              </motion.div>
              <span className="text-sm text-[#525252]">Subiendo archivo... {Math.round(progress)}%</span>
              <div className="w-48 h-1.5 bg-[#e5e5e5] rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-[#D4A017] rounded-full"
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.2 }}
                />
              </div>
            </motion.div>
          ) : state === 'success' ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-2"
            >
              <CheckCircle className="w-8 h-8 text-[#22C55E]" />
              <span className="text-sm text-[#16A34A] font-medium">Archivo procesado</span>
            </motion.div>
          ) : state === 'error' ? (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-2"
            >
              <AlertCircle className="w-8 h-8 text-[#EF4444]" />
              <span className="text-sm text-[#DC2626] font-medium">{error}</span>
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-2"
            >
              <Upload className="w-8 h-8 text-[#a3a3a3]" />
              <span className="text-sm font-medium text-[#525252]">{label}</span>
              <span className="text-xs text-[#a3a3a3]">{sublabel}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {children}
      </div>

      {files.length > 0 && (
        <div className="mt-2 space-y-1">
          {files.map(f => (
            <div key={f.name} className="flex items-center gap-2 px-3 py-1.5 bg-[#fafafa] border border-[#e5e5e5] rounded">
              <FileText className="w-3.5 h-3.5 text-[#525252] shrink-0" />
              <span className="text-xs text-[#0a0a0a] flex-1 truncate">{f.name}</span>
              <span className="text-[10px] text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">
                {formatSize(f.size)}
              </span>
              {f.status === 'success' && <CheckCircle className="w-3.5 h-3.5 text-[#22C55E] shrink-0" />}
              {f.status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-[#EF4444] shrink-0" />}
              <button
                type="button"
                onClick={e => { e.stopPropagation(); removeFile(f.name); }}
                className="p-0.5 text-[#a3a3a3] hover:text-[#EF4444] transition-colors"
                aria-label={`Remover ${f.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
