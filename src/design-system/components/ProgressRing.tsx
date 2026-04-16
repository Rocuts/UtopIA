'use client';

import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

interface ProgressRingProps {
  progress: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  className?: string;
}

export function ProgressRing({
  progress,
  size = 40,
  strokeWidth = 3,
  color = '#D4A017',
  className,
}: ProgressRingProps) {
  const prefersReduced = useReducedMotion();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#f5f5f5"
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeLinecap="round"
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={prefersReduced ? { duration: 0 } : { duration: 0.6, ease: 'easeOut' }}
        />
      </svg>
      <span className="absolute text-[10px] font-bold font-[family-name:var(--font-geist-mono)] text-[#525252]">
        {Math.round(progress)}
      </span>
    </div>
  );
}
