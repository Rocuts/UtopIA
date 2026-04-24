'use client';

/**
 * RiskMeter — horizontal bar risk indicator used in analysis panels. Takes
 * `RiskSeverityKey` (`low | medium | high | critical | info`) from the
 * legacy `tokens` map.
 *
 * NOT the same component as `@/components/ui/RiskGauge`, which renders an
 * SVG semicircle with a needle and takes `RiskLevel` (`bajo | medio | alto
 * | critico`). The two APIs diverge in shape and vocabulary — do not merge
 * without a consumer migration.
 */

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { tokens } from '../tokens';
import { DSBadge } from './Badge';
import type { RiskSeverityKey } from '../tokens';

interface RiskMeterProps {
  score: number;
  level: RiskSeverityKey;
  animated?: boolean;
  className?: string;
}

const LEVEL_LABELS: Record<RiskSeverityKey, string> = {
  critical: 'CRITICO',
  high: 'ALTO',
  medium: 'MEDIO',
  low: 'BAJO',
  info: 'INFO',
};

export function RiskMeter({ score, level, animated = true, className }: RiskMeterProps) {
  const prefersReduced = useReducedMotion();
  const [displayScore, setDisplayScore] = useState(animated && !prefersReduced ? 0 : score);
  const risk = tokens.color.risk[level];

  useEffect(() => {
    if (!animated || prefersReduced) {
      setDisplayScore(score);
      return;
    }
    setDisplayScore(0);
    const timeout = setTimeout(() => setDisplayScore(score), 100);
    return () => clearTimeout(timeout);
  }, [score, animated, prefersReduced]);

  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-[#525252] uppercase tracking-wide">
          Nivel de Riesgo
        </span>
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-bold font-[family-name:var(--font-geist-mono)]"
            style={{ color: risk.text }}
          >
            {score} / 100
          </span>
          <DSBadge variant="risk" riskLevel={level} label={LEVEL_LABELS[level]} />
        </div>
      </div>
      <div className="w-full h-2 rounded-full bg-[#f5f5f5] overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: risk.dot }}
          initial={{ width: 0 }}
          animate={{ width: `${displayScore}%` }}
          transition={prefersReduced ? { duration: 0 } : { duration: 0.8, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}
