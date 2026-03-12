'use client';

import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Scale, HeartPulse, ShieldAlert, Gavel } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

export function Services() {
  const { t } = useLanguage();

  const servicesList = [
    {
      icon: <HeartPulse className="w-8 h-8 text-[#00e5ff]" />,
      title: t.services.s3_title,
      description: t.services.s3_desc,
      outcome: t.services.s3_outcome,
      bullets: t.services.s3_bullets,
    },
    {
      icon: <Scale className="w-8 h-8 text-[#00e5ff]" />,
      title: t.services.s2_title,
      description: t.services.s2_desc,
      outcome: t.services.s2_outcome,
      bullets: t.services.s2_bullets,
    },
    {
      icon: <ShieldAlert className="w-8 h-8 text-[#00e5ff]" />,
      title: t.services.s1_title,
      description: t.services.s1_desc,
      outcome: t.services.s1_outcome,
      bullets: t.services.s1_bullets,
    },
    {
      icon: <Gavel className="w-8 h-8 text-[#00e5ff]" />,
      title: t.services.s4_title,
      description: t.services.s4_desc,
      outcome: t.services.s4_outcome,
      bullets: t.services.s4_bullets,
    },
  ];

  return (
    <section id="services" className="py-24 md:py-32 relative w-full container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
        {servicesList.map((service, index) => (
          <Card key={index} className="group flex flex-col justify-between h-full bg-[var(--surface-bg)] hover:-translate-y-1 transition-transform duration-300">
            <div>
              <div className="mb-6 p-4 rounded-xl inline-flex bg-[var(--background)] border border-[var(--surface-border-solid)] shadow-[0_4px_10px_rgba(0,0,0,0.5)]">
                {service.icon}
              </div>
              <h3 className="text-2xl font-semibold mb-3">{service.title}</h3>
              <p className="text-foreground/80 mb-6 leading-relaxed">
                {service.description}
              </p>

              <div className="bg-[var(--background)]/50 p-4 rounded-lg border border-[var(--surface-border)] mb-6">
                <span className="text-sm font-semibold text-[#00e5ff] uppercase tracking-wider block mb-1">
                  {t.services.outcome}
                </span>
                <span className="text-sm text-foreground/90 font-medium">{service.outcome}</span>
              </div>
            </div>

            <ul className="flex flex-col gap-2 border-t border-[var(--surface-border)] pt-6 mt-auto">
              {service.bullets.map((bullet, i) => (
                <li key={i} className="flex items-center text-sm text-foreground/60">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00e5ff]/50 mr-3" />
                  {bullet}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </section>
  );
}
