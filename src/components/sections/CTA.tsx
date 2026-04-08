'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform, useSpring } from 'motion/react';
import { Button } from "@/components/ui/Button";
import { useLanguage } from '@/context/LanguageContext';

export function CTA() {
  const { t } = useLanguage();
  const sectionRef = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'end start'],
  });

  // Background gradient orb shifts subtly with scroll
  const orbY = useSpring(
    useTransform(scrollYProgress, [0, 1], [60, -40]),
    { stiffness: 80, damping: 30 }
  );
  const orbScale = useTransform(scrollYProgress, [0, 0.5, 1], [0.8, 1.1, 0.9]);

  return (
    <section ref={sectionRef} className="py-24 relative overflow-hidden">
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--background)] to-[#1e3a5f] opacity-80" />
        <motion.div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[var(--accent-glow)] rounded-full blur-[100px] pointer-events-none"
          style={{
            y: orbY,
            scale: orbScale,
            willChange: 'transform',
          }}
        />
      </div>

      <div className="relative z-10 container mx-auto px-4 sm:px-6 lg:px-8 max-w-4xl text-center">
        {/* Convergence: heading comes from top */}
        <motion.h2
          className="text-4xl md:text-6xl font-bold tracking-tighter mb-6 text-foreground"
          initial={{ opacity: 0, y: -30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
        >
          {t.cta.title1} <br className="hidden md:block" />
          {t.cta.title2} <span className="text-[#d4a017]">{t.cta.titleHighlight}</span>?
        </motion.h2>

        {/* Description fades in from center */}
        <motion.p
          className="text-xl text-foreground/70 mb-10 max-w-2xl mx-auto"
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.7, ease: [0.25, 0.1, 0.25, 1], delay: 0.1 }}
        >
          {t.cta.desc}
        </motion.p>

        {/* Buttons converge from left and right */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1], delay: 0.2 }}
          >
            <Button size="lg" className="shadow-[0_0_20px_rgba(212,160,23,0.3)] hover:shadow-[0_0_30px_rgba(212,160,23,0.6)] w-full sm:w-auto text-lg font-semibold px-10">
              {t.cta.btn1}
            </Button>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1], delay: 0.2 }}
          >
            <Button size="lg" variant="secondary" className="w-full sm:w-auto text-lg font-semibold px-10">
              {t.cta.btn2}
            </Button>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
