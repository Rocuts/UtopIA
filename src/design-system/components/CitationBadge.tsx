'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ExternalLink, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CitationBadgeProps {
  article: string;
  source: string;
  normText?: string;
  url?: string;
  onOpenDrawer?: () => void;
  className?: string;
}

export function CitationBadge({
  article,
  source,
  normText,
  url,
  onOpenDrawer,
  className,
}: CitationBadgeProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const badgeRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showTooltip) return;
    const handleClick = (e: MouseEvent) => {
      if (
        badgeRef.current && !badgeRef.current.contains(e.target as Node) &&
        tooltipRef.current && !tooltipRef.current.contains(e.target as Node)
      ) {
        setShowTooltip(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showTooltip]);

  return (
    <span className={cn('inline-block relative', className)}>
      <button
        ref={badgeRef}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onClick={() => onOpenDrawer?.()}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#EEF2FF] border border-[#C7D2FE] text-[#4F46E5] text-[10px] font-medium font-[family-name:var(--font-geist-mono)] hover:bg-[#E0E7FF] transition-colors cursor-pointer"
        aria-label={`Referencia: ${article}`}
      >
        <BookOpen className="w-2.5 h-2.5" />
        {article}
      </button>

      <AnimatePresence>
        {showTooltip && normText && (
          <motion.div
            ref={tooltipRef}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 bottom-full left-0 mb-2 w-72 p-3 bg-white border border-[#e5e5e5] rounded-lg shadow-lg"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
          >
            <div className="flex items-start gap-2 mb-1.5">
              <span className="text-[10px] font-bold text-[#4F46E5] font-[family-name:var(--font-geist-mono)]">
                {article}
              </span>
              <span className="text-[10px] text-[#a3a3a3]">{source}</span>
            </div>
            <p className="text-xs text-[#525252] leading-relaxed line-clamp-3">
              {normText}
            </p>
            <div className="flex items-center gap-2 mt-2">
              {onOpenDrawer && (
                <button
                  onClick={onOpenDrawer}
                  className="text-[10px] text-[#4F46E5] hover:underline font-medium"
                >
                  Ver articulo completo
                </button>
              )}
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-[#a3a3a3] hover:text-[#525252] flex items-center gap-0.5"
                >
                  <ExternalLink className="w-2.5 h-2.5" />
                  Fuente
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}
