'use client';

import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Shield, RefreshCcw, TrendingUp, BarChart3 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { Reveal } from '@/components/ui/ParallaxWrapper';

export function Services() {
  const { t } = useLanguage();

  const servicesList = [
    {
      icon: <Shield className="w-6 h-6 text-n-900" />,
      title: t.services.s1_title,
      description: t.services.s1_desc,
      outcome: t.services.s1_outcome,
      bullets: t.services.s1_bullets,
    },
    {
      icon: <RefreshCcw className="w-6 h-6 text-n-900" />,
      title: t.services.s2_title,
      description: t.services.s2_desc,
      outcome: t.services.s2_outcome,
      bullets: t.services.s2_bullets,
    },
    {
      icon: <TrendingUp className="w-6 h-6 text-n-900" />,
      title: t.services.s3_title,
      description: t.services.s3_desc,
      outcome: t.services.s3_outcome,
      bullets: t.services.s3_bullets,
    },
    {
      icon: <BarChart3 className="w-6 h-6 text-n-900" />,
      title: t.services.s4_title,
      description: t.services.s4_desc,
      outcome: t.services.s4_outcome,
      bullets: t.services.s4_bullets,
    },
  ];

  return (
    <section id="services" className="py-20 md:py-28 relative w-full container mx-auto px-4 sm:px-6 lg:px-8 max-w-[var(--content-width)]">
      <Reveal>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-16 gap-8">
          <div className="max-w-2xl">
            <Badge variant="muted" className="mb-4">{t.services.badge}</Badge>
            <h2 className="font-serif-elite text-4xl md:text-5xl font-medium tracking-tight mb-4 text-n-900 leading-display"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 0, "WONK" 0' }}>
              {t.services.title}
            </h2>
            <p className="text-lg text-n-600 leading-relaxed">
              {t.services.desc}
            </p>
          </div>
        </div>
      </Reveal>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-n-200 border border-n-200 rounded-sm overflow-hidden">
        {servicesList.map((service, index) => (
          <Reveal key={index} delay={index * 0.05} distance={16}>
            <Card className="group flex flex-col justify-between h-full bg-n-0 rounded-none border-0" hoverEffect={false}>
              <div>
                <div className="mb-6 p-3 rounded-sm inline-flex bg-n-50 border border-n-200">
                  {service.icon}
                </div>
                <h3 className="text-xl font-semibold mb-3 text-n-900 leading-tight tracking-tight">{service.title}</h3>
                <p className="text-n-600 mb-6 leading-relaxed">
                  {service.description}
                </p>

                <div className="bg-n-50 p-4 rounded-sm border border-n-200 mb-6">
                  <span className="text-xs font-medium text-n-900 uppercase tracking-eyebrow block mb-1 font-mono">
                    {t.services.outcome}
                  </span>
                  <span className="text-sm text-n-600">{service.outcome}</span>
                </div>
              </div>

              <ul className="flex flex-col gap-2 border-t border-n-200 pt-6 mt-auto">
                {service.bullets.map((bullet, i) => (
                  <li key={i} className="flex items-center text-sm text-n-600">
                    <span className="w-1 h-1 rounded-full bg-n-900 mr-3 shrink-0" />
                    {bullet}
                  </li>
                ))}
              </ul>
            </Card>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
