'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { tokens } from '../tokens';

interface ScoreGaugeProps {
  grade: string;
  score: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  sm: { outer: 80, stroke: 6, gradeSize: '20px', scoreSize: '11px' },
  md: { outer: 120, stroke: 8, gradeSize: '28px', scoreSize: '13px' },
  lg: { outer: 160, stroke: 10, gradeSize: '36px', scoreSize: '15px' },
};

export function ScoreGauge({ grade, score, size = 'md', className }: ScoreGaugeProps) {
  const prefersReduced = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const { outer, stroke, gradeSize, scoreSize } = SIZES[size];
  const radius = (outer - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * 0.75;
  const fillLength = (score / 100) * arcLength;
  const gradeColor = tokens.color.grade[grade] ?? tokens.color.neutral[600];

  useEffect(() => {
    setMounted(true);
  }, []);

  const offset = mounted && !prefersReduced ? arcLength - fillLength : arcLength;

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: outer, height: outer }}>
      <svg width={outer} height={outer} className="-rotate-[135deg]">
        <circle
          cx={outer / 2}
          cy={outer / 2}
          r={radius}
          fill="none"
          stroke="#f5f5f5"
          strokeWidth={stroke}
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeLinecap="round"
        />
        <motion.circle
          cx={outer / 2}
          cy={outer / 2}
          r={radius}
          fill="none"
          stroke={gradeColor}
          strokeWidth={stroke}
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeLinecap="round"
          initial={{ strokeDashoffset: arcLength }}
          animate={{ strokeDashoffset: offset }}
          transition={prefersReduced ? { duration: 0 } : { duration: 1, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-bold font-[family-name:var(--font-geist-mono)]"
          style={{ fontSize: gradeSize, color: gradeColor, lineHeight: 1 }}
        >
          {grade}
        </span>
        <span
          className="text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]"
          style={{ fontSize: scoreSize }}
        >
          {score}/100
        </span>
      </div>
    </div>
  );
}
