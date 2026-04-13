'use client';

import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import type { RiskLevel } from '@/lib/storage/conversation-history';

interface RiskGaugeProps {
  level: RiskLevel;
  label?: string;
  score: number; // 0-100
  className?: string;
}

const RISK_CONFIG: Record<
  RiskLevel,
  { color: string; displayLabel: { es: string; en: string } }
> = {
  bajo: {
    color: '#22c55e',
    displayLabel: { es: 'BAJO', en: 'LOW' },
  },
  medio: {
    color: '#eab308',
    displayLabel: { es: 'MEDIO', en: 'MEDIUM' },
  },
  alto: {
    color: '#f97316',
    displayLabel: { es: 'ALTO', en: 'HIGH' },
  },
  critico: {
    color: '#ef4444',
    displayLabel: { es: 'CRITICO', en: 'CRITICAL' },
  },
};

export function RiskGauge({ level, label, score, className }: RiskGaugeProps) {
  const config = RISK_CONFIG[level];
  const angle = (Math.min(Math.max(score, 0), 100) / 100) * 180;

  const cx = 100;
  const cy = 100;
  const r = 80;

  const segments = [
    { start: 0, end: 45, color: '#22c55e' },
    { start: 45, end: 90, color: '#eab308' },
    { start: 90, end: 135, color: '#f97316' },
    { start: 135, end: 180, color: '#ef4444' },
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
              stroke={config.color}
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
            stroke="#0a0a0a"
            strokeWidth="2"
            strokeLinecap="butt"
            initial={{ x2: cx - (r - 10), y2: cy }}
            animate={{ x2: needleX, y2: needleY }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
          />

          <circle cx={cx} cy={cy} r="4" fill="#0a0a0a" />

          <motion.text
            x={cx}
            y={cy - 15}
            textAnchor="middle"
            fill="#0a0a0a"
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
          className="text-xs font-medium uppercase tracking-widest px-2.5 py-0.5 rounded-sm border font-[family-name:var(--font-geist-mono)]"
          style={{
            color: config.color,
            borderColor: '#e5e5e5',
            backgroundColor: '#fafafa',
          }}
        >
          {label ?? config.displayLabel.es}
        </span>
      </motion.div>
    </div>
  );
}
