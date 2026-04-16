'use client';

import { cn } from '@/lib/utils';
import { tokens } from '../tokens';
import type { RiskSeverityKey, TierKey, GradeKey } from '../tokens';

type BadgeVariant = 'risk' | 'tier' | 'grade' | 'status' | 'default';
type BadgeSize = 'sm' | 'md';

interface BadgeProps {
  variant?: BadgeVariant;
  label: string;
  riskLevel?: RiskSeverityKey;
  tier?: TierKey;
  grade?: string;
  size?: BadgeSize;
  className?: string;
}

export function DSBadge({
  variant = 'default',
  label,
  riskLevel,
  tier,
  grade,
  size = 'sm',
  className,
}: BadgeProps) {
  const sizeClasses = size === 'sm'
    ? 'text-[10px] px-1.5 py-0.5'
    : 'text-xs px-2 py-1';

  if (variant === 'risk' && riskLevel) {
    const risk = tokens.color.risk[riskLevel];
    return (
      <span
        className={cn('inline-flex items-center gap-1 rounded font-medium', sizeClasses, className)}
        style={{ backgroundColor: risk.bg, color: risk.text, border: `1px solid ${risk.border}` }}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: risk.dot }} />
        {label}
      </span>
    );
  }

  if (variant === 'tier' && tier) {
    const t = tokens.color.tier[tier];
    return (
      <span
        className={cn('inline-flex items-center gap-1 rounded font-medium font-[family-name:var(--font-geist-mono)]', sizeClasses, className)}
        style={{ backgroundColor: t.bg, color: t.color }}
      >
        {tier} · {t.label}
      </span>
    );
  }

  if (variant === 'grade' && grade) {
    const gradeColor = tokens.color.grade[grade] ?? tokens.color.neutral[600];
    return (
      <span
        className={cn('inline-flex items-center rounded font-bold font-[family-name:var(--font-geist-mono)]', sizeClasses, className)}
        style={{ color: gradeColor, backgroundColor: `${gradeColor}12` }}
      >
        {grade}
      </span>
    );
  }

  if (variant === 'status') {
    return (
      <span className={cn(
        'inline-flex items-center rounded font-medium',
        'bg-[#fafafa] border border-[#e5e5e5] text-[#525252]',
        sizeClasses, className,
      )}>
        {label}
      </span>
    );
  }

  return (
    <span className={cn(
      'inline-flex items-center rounded font-medium',
      'bg-[#f5f5f5] text-[#525252]',
      sizeClasses, className,
    )}>
      {label}
    </span>
  );
}
