'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Suspense, useRef } from 'react';
import { motion, useScroll, useTransform, useSpring } from 'motion/react';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/context/LanguageContext';

const Canvas = dynamic(() => import('@react-three/fiber').then((mod) => mod.Canvas), {
  ssr: false,
});
const HeroScene = dynamic(() => import('@/components/canvas/HeroScene'), { ssr: false });

const NOVA_SPRING = { stiffness: 400, damping: 25 };

export function Hero() {
  const { t } = useLanguage();
  const sectionRef = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  });

  const bgY = useSpring(
    useTransform(scrollYProgress, [0, 1], [0, 80]),
    NOVA_SPRING
  );

  const contentY = useSpring(
    useTransform(scrollYProgress, [0, 1], [0, -120]),
    NOVA_SPRING
  );
  const contentOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const contentScale = useTransform(scrollYProgress, [0, 0.5], [1, 0.97]);

  return (
    <section ref={sectionRef} className="relative min-h-[90vh] flex flex-col items-center justify-center overflow-hidden w-full pt-20 bg-n-0">

      {/* Background 3D Layer */}
      <motion.div
        className="absolute inset-0 z-[var(--z-canvas)]"
        style={{ y: bgY, willChange: 'transform' }}
      >
        <Suspense fallback={<div className="w-full h-full bg-n-0" />}>
          <Canvas
            camera={{ position: [0, 0, 5], fov: 45 }}
            dpr={[1, 2]}
            gl={{ alpha: true, antialias: true }}
            style={{ background: 'transparent' }}
          >
            <HeroScene />
          </Canvas>
        </Suspense>
      </motion.div>

      {/* Foreground Content */}
      <motion.div
        className="relative z-[var(--z-base)] container mx-auto px-4 sm:px-6 lg:px-8 max-w-[var(--content-width)] flex flex-col items-center text-center"
        style={{
          y: contentY,
          opacity: contentOpacity,
          scale: contentScale,
          willChange: 'transform, opacity',
        }}
      >

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", ...NOVA_SPRING }}
          className="mb-8"
        >
          <span className="inline-flex items-center gap-2 text-xs tracking-eyebrow uppercase text-n-500 font-medium">
            <span className="h-px w-5 bg-n-300" aria-hidden="true" />
            {t.hero.badge}
            <span className="h-px w-5 bg-n-300" aria-hidden="true" />
          </span>
        </motion.div>

        <motion.h1
          className="font-serif-elite text-balance font-medium tracking-tight mb-6 text-n-900 leading-display"
          style={{ fontSize: 'clamp(2.5rem, 8vw, 5.5rem)', fontVariationSettings: '"opsz" 144, "SOFT" 0, "WONK" 0' }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", ...NOVA_SPRING, delay: 0.05 }}
        >
          {t.hero.title}
        </motion.h1>

        <motion.p
          className="text-balance mt-4 text-lg sm:text-xl text-n-600 max-w-2xl mx-auto mb-10 leading-relaxed"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", ...NOVA_SPRING, delay: 0.1 }}
        >
          {t.hero.subtitle}
        </motion.p>

        <motion.div
          className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full sm:w-auto"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", ...NOVA_SPRING, delay: 0.15 }}
        >
          <Link href="/workspace" className="w-full sm:w-auto">
            <Button size="lg" className="w-full">
              {t.hero.cta1}
            </Button>
          </Link>
          <Button size="lg" variant="secondary" className="w-full sm:w-auto" onClick={() => {
            document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' });
          }}>
            {t.hero.cta2}
          </Button>
        </motion.div>

      </motion.div>

      {/* Bottom border line */}
      <div className="absolute bottom-0 w-full h-px bg-n-200" />
    </section>
  );
}
