'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { tokens } from '../tokens';
import type { AuditFinding, AuditSeverity } from '@/types/platform';

interface FindingCardProps {
  finding: AuditFinding;
  className?: string;
}

const SEVERITY_MAP: Record<AuditSeverity, keyof typeof tokens.color.risk> = {
  critico: 'critical',
  alto: 'high',
  medio: 'medium',
  bajo: 'low',
  informativo: 'info',
};

const SEVERITY_LABELS: Record<AuditSeverity, string> = {
  critico: 'Critico',
  alto: 'Alto',
  medio: 'Medio',
  bajo: 'Bajo',
  informativo: 'Info',
};

export function FindingCard({ finding, className }: FindingCardProps) {
  const [expanded, setExpanded] = useState(false);
  const riskKey = SEVERITY_MAP[finding.severity];
  const risk = tokens.color.risk[riskKey];

  return (
    <div
      className={cn('border border-[#e5e5e5] rounded-lg overflow-hidden', className)}
      style={{ borderLeftWidth: 3, borderLeftColor: risk.dot }}
    >
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-[#fafafa] transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded font-[family-name:var(--font-geist-mono)]"
              style={{ backgroundColor: risk.bg, color: risk.text }}
            >
              {finding.code}
            </span>
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
              style={{ backgroundColor: risk.bg, color: risk.text }}
            >
              {SEVERITY_LABELS[finding.severity]}
            </span>
          </div>
          <p className="text-sm font-medium text-[#0a0a0a]">{finding.title}</p>
          <p className="text-xs text-[#525252] mt-0.5 line-clamp-2">{finding.description}</p>
          <p className="text-[10px] text-[#a3a3a3] mt-1 font-[family-name:var(--font-geist-mono)]">
            {finding.normReference}
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-[#a3a3a3] shrink-0 mt-1" />
        ) : (
          <ChevronDown className="w-4 h-4 text-[#a3a3a3] shrink-0 mt-1" />
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2 border-t border-[#e5e5e5] pt-2">
              <div>
                <h4 className="text-[10px] font-medium text-[#a3a3a3] uppercase tracking-wider mb-0.5">
                  Recomendacion
                </h4>
                <p className="text-xs text-[#525252]">{finding.recommendation}</p>
              </div>
              <div>
                <h4 className="text-[10px] font-medium text-[#a3a3a3] uppercase tracking-wider mb-0.5">
                  Impacto
                </h4>
                <p className="text-xs text-[#525252]">{finding.impact}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
