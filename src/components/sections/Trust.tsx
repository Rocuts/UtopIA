'use client';

import { Badge } from "@/components/ui/Badge";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { useLanguage } from '@/context/LanguageContext';

const sources = [
  'U.S. Department of Labor (DOL)', 'OSHA Regulations', 'Fair Labor Standards Act (FLSA)',
  'Equal Employment Opportunity (EEOC)', 'NLRB Rulings', 'State-Level Jurisprudence',
  'Workers\' Compensation Laws', 'Title VII of the CRA'
];

export function Trust() {
  const { t } = useLanguage();

  return (
    <section className="py-24 border-y border-[var(--surface-border-solid)]/40 bg-[var(--background)]/50 backdrop-blur-sm">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl flex flex-col md:flex-row gap-16 items-center">

        <div className="md:w-1/3">
          <Badge variant="outline" className="mb-4">{t.trust.badge}</Badge>
          <h3 className="text-2xl md:text-3xl font-bold tracking-tight mb-4">
            {t.trust.title} <br className="hidden md:block"/> {t.trust.titleBreak}
          </h3>
          <p className="text-foreground/70 text-sm leading-relaxed mb-6">
            {t.trust.desc}
          </p>
        </div>

        <div className="md:w-2/3 flex w-full">
          <GlassPanel className="w-full flex flex-wrap gap-2 p-6 sm:p-8">
            {sources.map((source, i) => (
              <span
                key={i}
                className="inline-flex py-2 px-4 bg-[var(--background)] border border-[var(--surface-border-solid)] rounded-md text-sm text-foreground/80 tracking-tight"
              >
                {source}
              </span>
            ))}
          </GlassPanel>
        </div>

      </div>
    </section>
  );
}
