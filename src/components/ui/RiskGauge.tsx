'use client';

/**
 * RiskGauge — SVG semicircle gauge (180° arc + needle) used in workspace
 * chat/sidebar risk panels. Takes `RiskLevel` (`bajo | medio | alto |
 * critico`) from `@/lib/storage/conversation-history`.
 *
 * NOT the same component as `@/design-system/components/RiskMeter`, which
 * renders a horizontal bar and takes a different `RiskSeverityKey`
 * (`low | medium | high | critical | info`). The two APIs diverge in both
 * shape and label vocabulary — do not merge without a consumer migration.
 */

import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import type { RiskLevel } from '@/lib/storage/conversation-history';

interface RiskGaugeProps {
  level: RiskLevel;
  label?: string;
  score: number; // 0-100
  className?: string;
}

/**
 * Risk color map. Stored as CSS variable names so they flow from the
 * tokenized palette in `globals.css` (@theme). No hex here.
 *
 * The SVG paths use `stroke="currentColor"` on wrapper spans when possible;
 * for paths that need a different color than the parent, we read
 * `getComputedStyle(--color-*)` via `var(...)` expressions in the stroke.
 */
const RISK_CONFIG: Record<
  RiskLevel,
  {
    cssVar: string; // CSS variable reference for the fill/stroke color
    displayLabel: { es: string; en: string };
    textClass: string;
  }
> = {
  bajo: {
    cssVar: 'var(--color-success)',
    displayLabel: { es: 'BAJO', en: 'LOW' },
    textClass: 'text-success',
  },
  medio: {
    cssVar: 'var(--color-warning)',
    displayLabel: { es: 'MEDIO', en: 'MEDIUM' },
    textClass: 'text-warning',
  },
  alto: {
    cssVar: 'var(--color-warning)',
    displayLabel: { es: 'ALTO', en: 'HIGH' },
    textClass: 'text-warning',
  },
  critico: {
    cssVar: 'var(--color-danger)',
    displayLabel: { es: 'CRITICO', en: 'CRITICAL' },
    textClass: 'text-danger',
  },
};

// Segment colors for the background arc (low→high severity gradient).
const SEGMENT_VARS = [
  'var(--color-success)', // 0-45°
  'var(--color-warning)', // 45-90°
  'var(--color-warning)', // 90-135°  (no separate "high" token yet)
  'var(--color-danger)',  // 135-180°
];

export function RiskGauge({ level, label, score, className }: RiskGaugeProps) {
  const config = RISK_CONFIG[level];
  const angle = (Math.min(Math.max(score, 0), 100) / 100) * 180;

  const cx = 100;
  const cy = 100;
  const r = 80;

  const segments = [
    { start: 0, end: 45, color: SEGMENT_VARS[0] },
    { start: 45, end: 90, color: SEGMENT_VARS[1] },
    { start: 90, end: 135, color: SEGMENT_VARS[2] },
    { start: 135, end: 180, color: SEGMENT_VARS[3] },
  ];

  function arcPath(startDeg: number, endDeg: number, radius: number) {
    const startRad = ((180 + startDeg) * Math.PI) / 180;
    const endRad = ((180 + endDeg) * Math.PI) / 180;
    const x1 = cx + radius * Math.cos(startRad);
    const y1 = cy + radius * Math.sin(startRad);
    const x2 = cx + radius * Math.cos(endRad);
    const y2 = cy + radius * Math.sin(endRad);
    const largeArc = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`;
  }

  const needleRad = ((180 + angle) * Math.PI) / 180;
  const needleX = cx + (r - 10) * Math.cos(needleRad);
  const needleY = cy + (r - 10) * Math.sin(needleRad);

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <div className="relative w-[200px] h-[115px]">
        <svg viewBox="0 0 200 115" className="w-full h-full overflow-visible">
          {segments.map((seg, i) => (
            <path
              key={i}
              d={arcPath(seg.start, seg.end, r)}
              fill="none"
              stroke={seg.color}
              strokeWidth="12"
              strokeLinecap="butt"
              opacity={0.15}
            />
          ))}

          {angle > 0 && (
            <motion.path
              d={arcPath(0, angle, r)}
              fill="none"
              stroke={config.cssVar}
              strokeWidth="12"
              strokeLinecap="butt"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
            />
          )}

          <motion.line
            x1={cx}
            y1={cy}
            x2={needleX}
            y2={needleY}
            stroke="var(--color-n-900)"
            strokeWidth="2"
            strokeLinecap="butt"
            initial={{ x2: cx - (r - 10), y2: cy }}
            animate={{ x2: needleX, y2: needleY }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
          />

          <circle cx={cx} cy={cy} r="4" fill="var(--color-n-900)" />

          <motion.text
            x={cx}
            y={cy - 15}
            textAnchor="middle"
            fill="var(--color-n-900)"
            fontSize="24"
            fontWeight="bold"
            fontFamily="var(--font-geist-mono), monospace"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            {score}
          </motion.text>
        </svg>
      </div>

      <motion.div
        className="flex flex-col items-center gap-1 -mt-1"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 25, delay: 0.2 }}
      >
        <span
          className={cn(
            "text-xs font-medium uppercase tracking-widest px-2.5 py-0.5 rounded-sm border bg-n-50 border-n-200 font-[family-name:var(--font-geist-mono)]",
            config.textClass,
          )}
        >
          {label ?? config.displayLabel.es}
        </span>
      </motion.div>
    </div>
  );
}
