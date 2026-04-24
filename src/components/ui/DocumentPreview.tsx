'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FileText, ChevronDown, ChevronUp, CheckCircle, Loader2, AlertCircle, X } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { cn } from '@/lib/utils';

export type DocStatus = 'uploading' | 'processing' | 'ready' | 'error';

interface DocumentPreviewProps {
  filename: string;
  size: number;
  status: DocStatus;
  textPreview?: string;
  onRemove?: () => void;
  className?: string;
  language?: 'es' | 'en';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Status config: tokenized. Color classes drive icon + text, while wrapper
 * tints use translucent semantic backgrounds. No more hex palette.
 */
const STATUS_CONFIG: Record<
  DocStatus,
  {
    icon: typeof FileText;
    iconClass: string;
    bgClass: string;
    label: { es: string; en: string };
    variant: 'outline' | 'solid' | 'muted';
  }
> = {
  uploading: {
    icon: Loader2,
    iconClass: 'text-n-600',
    bgClass: 'bg-n-50',
    label: { es: 'Subiendo', en: 'Uploading' },
    variant: 'outline',
  },
  processing: {
    icon: Loader2,
    iconClass: 'text-n-600',
    bgClass: 'bg-n-50',
    label: { es: 'Procesando', en: 'Processing' },
    variant: 'muted',
  },
  ready: {
    icon: CheckCircle,
    iconClass: 'text-success',
    bgClass: 'bg-success/10',
    label: { es: 'Listo', en: 'Ready' },
    variant: 'outline',
  },
  error: {
    icon: AlertCircle,
    iconClass: 'text-danger',
    bgClass: 'bg-danger/10',
    label: { es: 'Error', en: 'Error' },
    variant: 'outline',
  },
};

export function DocumentPreview({
  filename,
  size,
  status,
  textPreview,
  onRemove,
  className,
  language = 'es',
}: DocumentPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const config = STATUS_CONFIG[status];
  const StatusIcon = config.icon;
  const isAnimated = status === 'uploading' || status === 'processing';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
    >
      <GlassPanel
        className={cn('p-4', className)}
        hoverEffect
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-10 h-10 rounded-sm flex items-center justify-center shrink-0 border border-n-200',
              config.bgClass,
            )}
          >
            <FileText className={cn('w-5 h-5', config.iconClass)} />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-n-900 truncate">{filename}</p>
            <p className="text-xs text-n-400 font-[family-name:var(--font-geist-mono)]">{formatFileSize(size)}</p>
          </div>

          <Badge
            variant={config.variant}
            className={cn('shrink-0', config.iconClass)}
          >
            <StatusIcon
              className={cn('w-3 h-3 mr-1', { 'animate-spin': isAnimated })}
            />
            {config.label[language]}
          </Badge>

          <div className="flex items-center gap-1 shrink-0">
            {textPreview && status === 'ready' && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-1.5 rounded-sm text-n-400 hover:text-n-900 hover:bg-n-50 transition-colors"
                aria-label={expanded ? 'Collapse preview' : 'Expand preview'}
              >
                {expanded ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
            )}
            {onRemove && (
              <button
                onClick={onRemove}
                className="p-1.5 rounded-sm text-n-400 hover:text-danger hover:bg-danger/10 transition-colors"
                aria-label="Remove document"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <AnimatePresence>
          {expanded && textPreview && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className="overflow-hidden"
            >
              <div className="mt-3 pt-3 border-t border-n-200">
                <pre className="text-xs text-n-600 font-[family-name:var(--font-geist-mono)] whitespace-pre-wrap max-h-[200px] overflow-y-auto leading-relaxed styled-scrollbar">
                  {textPreview.slice(0, 2000)}
                  {textPreview.length > 2000 && '\n...'}
                </pre>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassPanel>
    </motion.div>
  );
}
