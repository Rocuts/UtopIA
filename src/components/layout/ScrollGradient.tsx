'use client';

import { motion, useScroll, useTransform } from 'motion/react';
import { ReactNode } from 'react';

export function ScrollGradient({ children }: { children: ReactNode }) {
  const { scrollYProgress } = useScroll();

  // Subtle gradient shift: warm at top, cooler at bottom
  const bgOpacity = useTransform(scrollYProgress, [0, 0.5, 1], [0, 0.03, 0.06]);

  return (
    <div className="relative">
      {/* Subtle gradient overlay that shifts as user scrolls */}
      <motion.div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          background: 'linear-gradient(180deg, rgba(212, 160, 23, 0.02) 0%, rgba(30, 58, 95, 0.08) 100%)',
          opacity: bgOpacity,
          willChange: 'opacity',
        }}
      />
      <div className="relative z-[1]">
        {children}
      </div>
    </div>
  );
}
