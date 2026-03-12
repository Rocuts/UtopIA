'use client';

import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import * as m from 'motion/react-m';
import { LazyMotion, domAnimation } from 'motion/react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useLanguage } from '@/context/LanguageContext';

// Lazy load the 3D canvas so we don't block the main thread
const Canvas = dynamic(() => import('@react-three/fiber').then((mod) => mod.Canvas), {
  ssr: false,
});
const HeroScene = dynamic(() => import('@/components/canvas/HeroScene'), { ssr: false });

export function Hero() {
  const { t } = useLanguage();

  return (
    <LazyMotion features={domAnimation}>
      <section className="relative min-h-[90vh] flex flex-col items-center justify-center overflow-hidden w-full pt-20">
        
        {/* Background 3D Layer with Fallback */}
        <div className="absolute inset-0 z-[var(--z-canvas)] bg-[var(--background)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,229,255,0.08)_0%,transparent_50%)]" />
          <Suspense fallback={<div className="w-full h-full bg-[var(--background)]" />}>
            <Canvas camera={{ position: [0, 0, 5], fov: 45 }} dpr={[1, 2]}>
              <HeroScene />
            </Canvas>
          </Suspense>
        </div>

        {/* Foreground Content Layer */}
        <div className="relative z-[var(--z-base)] container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl flex flex-col items-center text-center">
          
          <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="mb-8"
          >
            <Badge variant="glow" className="mb-4">
              {t.hero.badge}
            </Badge>
          </m.div>

          <m.h1 
            className="text-balance text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tighter mb-6 text-foreground whitespace-pre-wrap"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.1 }}
          >
            {t.hero.title}
          </m.h1>

          <m.p 
            className="text-balance mt-4 text-lg sm:text-xl text-foreground/70 max-w-2xl mx-auto mb-10"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
          >
            {t.hero.subtitle}
          </m.p>

          <m.div 
            className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full sm:w-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.3 }}
          >
            <Button size="lg" className="w-full sm:w-auto shadow-cyan" onClick={() => {
              document.getElementById('ai-consult')?.scrollIntoView({ behavior: 'smooth' });
            }}>
              {t.hero.cta1}
            </Button>
            <Button size="lg" variant="glass" className="w-full sm:w-auto" onClick={() => {
              document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' });
            }}>
              {t.hero.cta2}
            </Button>
          </m.div>

        </div>

        {/* Bottom Fade */}
        <div className="absolute bottom-0 w-full h-32 bg-gradient-to-t from-[var(--background)] to-transparent pointer-events-none z-[var(--z-base)]" />
      </section>
    </LazyMotion>
  );
}
