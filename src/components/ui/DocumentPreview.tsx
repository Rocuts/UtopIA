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

const STATUS_CONFIG: Record<
  DocStatus,
  { icon: typeof FileText; color: string; bgColor: string; label: { es: string; en: string }; variant: 'outline' | 'solid' | 'muted' }
> = {
  uploading: {
    icon: Loader2,
    color: '#525252',
    bgColor: '#fafafa',
    label: { es: 'Subiendo', en: 'Uploading' },
    variant: 'outline',
  },
  processing: {
    icon: Loader2,
    color: '#525252',
    bgColor: '#fafafa',
    label: { es: 'Procesando', en: 'Processing' },
    variant: 'muted',
  },
  ready: {
    icon: CheckCircle,
    color: '#22c55e',
    bgColor: '#f0fdf4',
    label: { es: 'Listo', en: 'Ready' },
    variant: 'outline',
  },
  error: {
    icon: AlertCircle,
    color: '#ef4444',
    bgColor: '#fef2f2',
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
            className="w-10 h-10 rounded-sm flex items-center justify-center shrink-0 border"
            style={{ backgroundColor: config.bgColor, borderColor: '#e5e5e5' }}
          >
            <FileText className="w-5 h-5" style={{ color: config.color }} />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[#0a0a0a] truncate">{filename}</p>
            <p className="text-xs text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">{formatFileSize(size)}</p>
          </div>

          <Badge
            variant={config.variant}
            className="shrink-0"
            style={{ color: config.color }}
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
                className="p-1.5 rounded-sm text-[#a3a3a3] hover:text-[#0a0a0a] hover:bg-[#fafafa] transition-colors"
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
                className="p-1.5 rounded-sm text-[#a3a3a3] hover:text-[#ef4444] hover:bg-[#fef2f2] transition-colors"
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
              <div className="mt-3 pt-3 border-t border-[#e5e5e5]">
                <pre className="text-xs text-[#525252] font-[family-name:var(--font-geist-mono)] whitespace-pre-wrap max-h-[200px] overflow-y-auto leading-relaxed styled-scrollbar">
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
