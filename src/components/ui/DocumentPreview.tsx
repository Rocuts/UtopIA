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
  size: number; // bytes
  status: DocStatus;
  textPreview?: string;
  onRemove?: () => void;
  className?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_CONFIG: Record<
  DocStatus,
  { icon: typeof FileText; color: string; label: { es: string; en: string }; variant: 'outline' | 'glow' | 'accent' }
> = {
  uploading: {
    icon: Loader2,
    color: '#d4a017',
    label: { es: 'Subiendo', en: 'Uploading' },
    variant: 'outline',
  },
  processing: {
    icon: Loader2,
    color: '#8b5cf6',
    label: { es: 'Procesando', en: 'Processing' },
    variant: 'accent',
  },
  ready: {
    icon: CheckCircle,
    color: '#10b981',
    label: { es: 'Listo', en: 'Ready' },
    variant: 'glow',
  },
  error: {
    icon: AlertCircle,
    color: '#ef4444',
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
}: DocumentPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const config = STATUS_CONFIG[status];
  const StatusIcon = config.icon;
  const isAnimated = status === 'uploading' || status === 'processing';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.98 }}
      transition={{ duration: 0.3 }}
    >
      <GlassPanel
        className={cn(
          'p-4 border-[var(--surface-border-solid)]',
          className
        )}
        hoverEffect
      >
        <div className="flex items-center gap-3">
          {/* File icon */}
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${config.color}15`, border: `1px solid ${config.color}30` }}
          >
            <FileText className="w-5 h-5" style={{ color: config.color }} />
          </div>

          {/* File info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{filename}</p>
            <p className="text-xs text-foreground/50">{formatFileSize(size)}</p>
          </div>

          {/* Status badge */}
          <Badge
            variant={config.variant}
            className="shrink-0 text-[10px]"
            style={{ color: config.color, borderColor: `${config.color}50` }}
          >
            <StatusIcon
              className={cn('w-3 h-3 mr-1', { 'animate-spin': isAnimated })}
            />
            {config.label.es}
          </Badge>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            {textPreview && status === 'ready' && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-1.5 rounded-lg text-foreground/40 hover:text-[#d4a017] hover:bg-[#d4a017]/10 transition-colors"
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
                className="p-1.5 rounded-lg text-foreground/40 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                aria-label="Remove document"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Collapsible text preview */}
        <AnimatePresence>
          {expanded && textPreview && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <div className="mt-3 pt-3 border-t border-[var(--surface-border)]">
                <pre className="text-xs text-foreground/60 font-mono whitespace-pre-wrap max-h-[200px] overflow-y-auto leading-relaxed styled-scrollbar">
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
