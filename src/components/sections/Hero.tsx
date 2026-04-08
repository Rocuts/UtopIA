'use client';

import dynamic from 'next/dynamic';
import { Suspense, useRef } from 'react';
import { motion, useScroll, useTransform, useSpring } from 'motion/react';
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
  const sectionRef = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  });

  // Background moves slower (parallax depth)
  const bgY = useSpring(
    useTransform(scrollYProgress, [0, 1], [0, 80]),
    { stiffness: 100, damping: 30 }
  );

  // Foreground text moves up faster and fades out
  const contentY = useSpring(
    useTransform(scrollYProgress, [0, 1], [0, -120]),
    { stiffness: 100, damping: 30 }
  );
  const contentOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const contentScale = useTransform(scrollYProgress, [0, 0.5], [1, 0.95]);

  return (
    <section ref={sectionRef} className="relative min-h-[90vh] flex flex-col items-center justify-center overflow-hidden w-full pt-20">

      {/* Background 3D Layer with Fallback — moves slower on scroll */}
      <motion.div
        className="absolute inset-0 z-[var(--z-canvas)] bg-[var(--background)]"
        style={{ y: bgY, willChange: 'transform' }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(212,160,23,0.06)_0%,transparent_50%)]" />
        <Suspense fallback={<div className="w-full h-full bg-[var(--background)]" />}>
          <Canvas camera={{ position: [0, 0, 5], fov: 45 }} dpr={[1, 2]}>
            <HeroScene />
          </Canvas>
        </Suspense>
      </motion.div>

      {/* Foreground Content Layer — parallax + fade + scale */}
      <motion.div
        className="relative z-[var(--z-base)] container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl flex flex-col items-center text-center"
        style={{
          y: contentY,
          opacity: contentOpacity,
          scale: contentScale,
          willChange: 'transform, opacity',
        }}
      >

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="mb-8"
        >
          <Badge variant="glow" className="mb-4">
            {t.hero.badge}
          </Badge>
        </motion.div>

        <motion.h1
          className="text-balance text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tighter mb-6 text-foreground whitespace-pre-wrap"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.1 }}
        >
          {t.hero.title}
        </motion.h1>

        <motion.p
          className="text-balance mt-4 text-lg sm:text-xl text-foreground/70 max-w-2xl mx-auto mb-10"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
        >
          {t.hero.subtitle}
        </motion.p>

        <motion.div
          className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full sm:w-auto"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.3 }}
        >
          <Button size="lg" className="w-full sm:w-auto shadow-[0_0_20px_rgba(212,160,23,0.3)]" onClick={() => {
            document.getElementById('ai-consult')?.scrollIntoView({ behavior: 'smooth' });
          }}>
            {t.hero.cta1}
          </Button>
          <Button size="lg" variant="glass" className="w-full sm:w-auto" onClick={() => {
            document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' });
          }}>
            {t.hero.cta2}
          </Button>
        </motion.div>

      </motion.div>

      {/* Bottom Fade */}
      <div className="absolute bottom-0 w-full h-32 bg-gradient-to-t from-[var(--background)] to-transparent pointer-events-none z-[var(--z-base)]" />
    </section>
  );
}
