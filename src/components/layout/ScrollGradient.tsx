'use client';

import { ReactNode } from 'react';

export function ScrollGradient({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      {/* Novaforge: subtle dot grid instead of color gradient */}
      <div
        className="fixed inset-0 pointer-events-none z-0 opacity-40"
        style={{
          backgroundImage: 'radial-gradient(circle, #d4d4d4 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      <div className="relative z-[1]">
        {children}
      </div>
    </div>
  );
}
