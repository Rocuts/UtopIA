'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform, useSpring } from 'motion/react';
import { Badge } from "@/components/ui/Badge";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { useLanguage } from '@/context/LanguageContext';
import { Reveal } from '@/components/ui/ParallaxWrapper';

const NOVA_SPRING = { stiffness: 400, damping: 25 };

const sources = [
  'Estatuto Tributario', 'Doctrina DIAN', 'Normas NIIF/NIC',
  'Ley 1819 de 2016 (Reforma Tributaria)', 'Ley 2277 de 2022', 'Decreto 1625 de 2016 (DUR Tributario)',
  'Resoluciones DIAN', 'Ley 1581 (Protección de Datos)'
];

function FloatingBadge({ children, index }: { children: React.ReactNode; index: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });

  const speed = ((index % 3) - 1) * 6;
  const rawY = useTransform(scrollYProgress, [0, 1], [speed, -speed]);
  const y = useSpring(rawY, NOVA_SPRING);

  return (
    <motion.span
      ref={ref}
      style={{ y, willChange: 'transform' }}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{
        type: "spring",
        ...NOVA_SPRING,
        delay: index * 0.04,
      }}
      className="inline-flex py-2 px-4 bg-white border border-[#e5e5e5] rounded-sm text-sm text-[#525252] tracking-tight hover:border-[#0a0a0a] hover:text-[#0a0a0a] transition-colors"
    >
      {children}
    </motion.span>
  );
}

export function Trust() {
  const { t } = useLanguage();

  return (
    <section className="py-24 border-y border-[#e5e5e5] bg-[#fafafa]">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl flex flex-col md:flex-row gap-16 items-center">

        <Reveal direction="left" className="md:w-1/3">
          <div>
            <Badge variant="outline" className="mb-4">{t.trust.badge}</Badge>
            <h3 className="text-2xl md:text-3xl font-bold tracking-tight mb-4 text-[#0a0a0a]">
              {t.trust.title} <br className="hidden md:block"/> {t.trust.titleBreak}
            </h3>
            <p className="text-[#525252] text-sm leading-relaxed mb-6">
              {t.trust.desc}
            </p>
          </div>
        </Reveal>

        <Reveal direction="right" className="md:w-2/3 flex w-full">
          <GlassPanel className="w-full flex flex-wrap gap-2 p-6 sm:p-8 bg-white">
            {sources.map((source, i) => (
              <FloatingBadge key={i} index={i}>
                {source}
              </FloatingBadge>
            ))}
          </GlassPanel>
        </Reveal>

      </div>
    </section>
  );
}
