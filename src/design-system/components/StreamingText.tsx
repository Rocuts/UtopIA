'use client';

import { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

interface StreamingTextProps {
  isStreaming: boolean;
  onComplete?: () => void;
  children: React.ReactNode;
  className?: string;
}

export function StreamingText({ isStreaming, onComplete, children, className }: StreamingTextProps) {
  const prefersReduced = useReducedMotion();
  const completedRef = useRef(false);

  useEffect(() => {
    if (!isStreaming && !completedRef.current) {
      completedRef.current = true;
      onComplete?.();
    }
    if (isStreaming) {
      completedRef.current = false;
    }
  }, [isStreaming, onComplete]);

  return (
    <div className={cn('relative', className)}>
      {children}
      {isStreaming && (
        <motion.span
          className="inline-block w-0.5 h-4 bg-[#D4A017] ml-0.5 align-text-bottom"
          animate={prefersReduced ? {} : { opacity: [1, 0, 1] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
      )}
    </div>
  );
}
