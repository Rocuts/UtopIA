'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform, useSpring } from 'motion/react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Shield, RefreshCcw, TrendingUp, BarChart3 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { Reveal } from '@/components/ui/ParallaxWrapper';

const NOVA_SPRING = { stiffness: 400, damping: 25 };

function FloatingCard({ children, index }: { children: React.ReactNode; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });

  const speed = [0.15, 0.1, 0.12, 0.08][index % 4];
  const rawY = useTransform(scrollYProgress, [0, 1], [speed * 60, speed * -60]);
  const y = useSpring(rawY, NOVA_SPRING);

  return (
    <motion.div
      ref={ref}
      style={{ y, willChange: 'transform' }}
      whileHover={{
        scale: 1.01,
        transition: { type: "spring", ...NOVA_SPRING },
      }}
    >
      {children}
    </motion.div>
  );
}

export function Services() {
  const { t } = useLanguage();

  const servicesList = [
    {
      icon: <Shield className="w-6 h-6 text-[#0a0a0a]" />,
      title: t.services.s1_title,
      description: t.services.s1_desc,
      outcome: t.services.s1_outcome,
      bullets: t.services.s1_bullets,
    },
    {
      icon: <RefreshCcw className="w-6 h-6 text-[#0a0a0a]" />,
      title: t.services.s2_title,
      description: t.services.s2_desc,
      outcome: t.services.s2_outcome,
      bullets: t.services.s2_bullets,
    },
    {
      icon: <TrendingUp className="w-6 h-6 text-[#0a0a0a]" />,
      title: t.services.s3_title,
      description: t.services.s3_desc,
      outcome: t.services.s3_outcome,
      bullets: t.services.s3_bullets,
    },
    {
      icon: <BarChart3 className="w-6 h-6 text-[#0a0a0a]" />,
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
            <Badge variant="muted" className="mb-4">{t.services.badge}</Badge>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4 text-[#0a0a0a]">
              {t.services.title}
            </h2>
            <p className="text-lg text-[#525252]">
              {t.services.desc}
            </p>
          </div>
        </div>
      </Reveal>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[#e5e5e5] border border-[#e5e5e5] rounded-sm overflow-hidden">
        {servicesList.map((service, index) => (
          <Reveal key={index} delay={index * 0.05} distance={16}>
            <FloatingCard index={index}>
              <Card className="group flex flex-col justify-between h-full bg-white rounded-none border-0" hoverEffect={false}>
                <div>
                  <div className="mb-6 p-3 rounded-sm inline-flex bg-[#fafafa] border border-[#e5e5e5]">
                    {service.icon}
                  </div>
                  <h3 className="text-xl font-semibold mb-3 text-[#0a0a0a]">{service.title}</h3>
                  <p className="text-[#525252] mb-6 leading-relaxed">
                    {service.description}
                  </p>

                  <div className="bg-[#fafafa] p-4 rounded-sm border border-[#e5e5e5] mb-6">
                    <span className="text-xs font-medium text-[#0a0a0a] uppercase tracking-wider block mb-1 font-[family-name:var(--font-geist-mono)]">
                      {t.services.outcome}
                    </span>
                    <span className="text-sm text-[#525252]">{service.outcome}</span>
                  </div>
                </div>

                <ul className="flex flex-col gap-2 border-t border-[#e5e5e5] pt-6 mt-auto">
                  {service.bullets.map((bullet, i) => (
                    <li key={i} className="flex items-center text-sm text-[#525252]">
                      <span className="w-1 h-1 rounded-full bg-[#0a0a0a] mr-3 shrink-0" />
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
