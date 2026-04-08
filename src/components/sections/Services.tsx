'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform, useSpring } from 'motion/react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Shield, RefreshCcw, TrendingUp, BarChart3 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { Reveal } from '@/components/ui/ParallaxWrapper';

function FloatingCard({ children, index }: { children: React.ReactNode; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });

  // Each card moves at slightly different speed for depth
  const speed = [0.15, 0.1, 0.12, 0.08][index % 4];
  const rawY = useTransform(scrollYProgress, [0, 1], [speed * 60, speed * -60]);
  const y = useSpring(rawY, { stiffness: 100, damping: 30, mass: 0.5 });

  return (
    <motion.div
      ref={ref}
      style={{ y, willChange: 'transform' }}
      whileHover={{
        rotateX: -2,
        rotateY: 3,
        scale: 1.02,
        transition: { duration: 0.3 },
      }}
      className="perspective-[1000px]"
    >
      {children}
    </motion.div>
  );
}

export function Services() {
  const { t } = useLanguage();

  const servicesList = [
    {
      icon: <Shield className="w-8 h-8 text-[#d4a017]" />,
      title: t.services.s1_title,
      description: t.services.s1_desc,
      outcome: t.services.s1_outcome,
      bullets: t.services.s1_bullets,
    },
    {
      icon: <RefreshCcw className="w-8 h-8 text-[#d4a017]" />,
      title: t.services.s2_title,
      description: t.services.s2_desc,
      outcome: t.services.s2_outcome,
      bullets: t.services.s2_bullets,
    },
    {
      icon: <TrendingUp className="w-8 h-8 text-[#d4a017]" />,
      title: t.services.s3_title,
      description: t.services.s3_desc,
      outcome: t.services.s3_outcome,
      bullets: t.services.s3_bullets,
    },
    {
      icon: <BarChart3 className="w-8 h-8 text-[#d4a017]" />,
      title: t.services.s4_title,
      description: t.services.s4_desc,
      outcome: t.services.s4_outcome,
      bullets: t.services.s4_bullets,
    },
  ];

  return (
    <section id="services" className="py-24 md:py-32 relative w-full container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">
      <Reveal>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-16 gap-8">
          <div className="max-w-2xl">
            <Badge variant="accent" className="mb-4">{t.services.badge}</Badge>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
              {t.services.title.split(' ').map((word: string, i: number, arr: string[]) =>
                i === arr.length - 1 || i === arr.length - 2 ? <span key={i} className="text-gradient">{word} </span> : <span key={i}>{word} </span>
              )}
            </h2>
            <p className="text-lg text-foreground/70">
              {t.services.desc}
            </p>
          </div>
        </div>
      </Reveal>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
        {servicesList.map((service, index) => (
          <Reveal key={index} delay={index * 0.1} distance={30}>
            <FloatingCard index={index}>
              <Card className="group flex flex-col justify-between h-full bg-[var(--surface-bg)] transition-transform duration-300">
                <div>
                  <div className="mb-6 p-4 rounded-xl inline-flex bg-[var(--background)] border border-[var(--surface-border-solid)] shadow-[0_4px_10px_rgba(0,0,0,0.5)]">
                    {service.icon}
                  </div>
                  <h3 className="text-2xl font-semibold mb-3">{service.title}</h3>
                  <p className="text-foreground/80 mb-6 leading-relaxed">
                    {service.description}
                  </p>

                  <div className="bg-[var(--background)]/50 p-4 rounded-lg border border-[var(--surface-border)] mb-6">
                    <span className="text-sm font-semibold text-[#d4a017] uppercase tracking-wider block mb-1">
                      {t.services.outcome}
                    </span>
                    <span className="text-sm text-foreground/90 font-medium">{service.outcome}</span>
                  </div>
                </div>

                <ul className="flex flex-col gap-2 border-t border-[var(--surface-border)] pt-6 mt-auto">
                  {service.bullets.map((bullet, i) => (
                    <li key={i} className="flex items-center text-sm text-foreground/60">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#d4a017]/50 mr-3" />
                      {bullet}
                    </li>
                  ))}
                </ul>
              </Card>
            </FloatingCard>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
