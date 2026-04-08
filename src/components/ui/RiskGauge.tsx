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
  { color: string; glowColor: string; displayLabel: { es: string; en: string } }
> = {
  bajo: {
    color: '#10b981',
    glowColor: 'rgba(16,185,129,0.3)',
    displayLabel: { es: 'BAJO', en: 'LOW' },
  },
  medio: {
    color: '#f59e0b',
    glowColor: 'rgba(245,158,11,0.3)',
    displayLabel: { es: 'MEDIO', en: 'MEDIUM' },
  },
  alto: {
    color: '#f97316',
    glowColor: 'rgba(249,115,22,0.3)',
    displayLabel: { es: 'ALTO', en: 'HIGH' },
  },
  critico: {
    color: '#ef4444',
    glowColor: 'rgba(239,68,68,0.3)',
    displayLabel: { es: 'CRITICO', en: 'CRITICAL' },
  },
};

export function RiskGauge({ level, label, score, className }: RiskGaugeProps) {
  const config = RISK_CONFIG[level];
  // Map score (0-100) to angle (0 to 180 degrees for semicircle)
  const angle = (Math.min(Math.max(score, 0), 100) / 100) * 180;

  // SVG arc parameters
  const cx = 100;
  const cy = 100;
  const r = 80;

  // Build the background arc segments (green -> yellow -> orange -> red)
  const segments = [
    { start: 0, end: 45, color: '#10b981' },
    { start: 45, end: 90, color: '#f59e0b' },
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

  // Needle endpoint
  const needleRad = ((180 + angle) * Math.PI) / 180;
  const needleX = cx + (r - 10) * Math.cos(needleRad);
  const needleY = cy + (r - 10) * Math.sin(needleRad);

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <div className="relative w-[200px] h-[115px]">
        <svg viewBox="0 0 200 115" className="w-full h-full overflow-visible">
          {/* Background arc segments */}
          {segments.map((seg, i) => (
            <path
              key={i}
              d={arcPath(seg.start, seg.end, r)}
              fill="none"
              stroke={seg.color}
              strokeWidth="12"
              strokeLinecap="round"
              opacity={0.2}
            />
          ))}

          {/* Active arc up to score */}
          {angle > 0 && (
            <motion.path
              d={arcPath(0, angle, r)}
              fill="none"
              stroke={config.color}
              strokeWidth="12"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.2, ease: 'easeOut' }}
              style={{
                filter: `drop-shadow(0 0 6px ${config.glowColor})`,
              }}
            />
          )}

          {/* Needle */}
          <motion.line
            x1={cx}
            y1={cy}
            x2={needleX}
            y2={needleY}
            stroke={config.color}
            strokeWidth="2.5"
            strokeLinecap="round"
            initial={{ x2: cx - (r - 10), y2: cy }}
            animate={{ x2: needleX, y2: needleY }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
            style={{
              filter: `drop-shadow(0 0 4px ${config.glowColor})`,
            }}
          />

          {/* Center dot */}
          <circle cx={cx} cy={cy} r="5" fill={config.color} />

          {/* Score text */}
          <motion.text
            x={cx}
            y={cy - 15}
            textAnchor="middle"
            fill={config.color}
            fontSize="24"
            fontWeight="bold"
            fontFamily="monospace"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
          >
            {score}
          </motion.text>
        </svg>
      </div>

      {/* Label */}
      <motion.div
        className="flex flex-col items-center gap-1 -mt-1"
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
      >
        <span
          className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full border"
          style={{
            color: config.color,
            borderColor: config.color,
            backgroundColor: `${config.color}15`,
          }}
        >
          {label ?? config.displayLabel.es}
        </span>
      </motion.div>
    </div>
  );
}
