'use client';

import { Button } from "@/components/ui/Button";
import { useLanguage } from '@/context/LanguageContext';

export function CTA() {
  const { t } = useLanguage();

  return (
    <section className="py-24 relative overflow-hidden">
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--background)] to-[#0A192F] opacity-80" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[var(--cyan-glow)] rounded-full blur-[100px] pointer-events-none" />
      </div>

      <div className="relative z-10 container mx-auto px-4 sm:px-6 lg:px-8 max-w-4xl text-center">
        <h2 className="text-4xl md:text-6xl font-bold tracking-tighter mb-6 text-foreground">
          {t.cta.title1} <br className="hidden md:block" />
          {t.cta.title2} <span className="text-[#00e5ff]">{t.cta.titleHighlight}</span>.
        </h2>

        <p className="text-xl text-foreground/70 mb-10 max-w-2xl mx-auto">
          {t.cta.desc}
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button size="lg" className="shadow-[0_0_20px_rgba(0,229,255,0.3)] hover:shadow-[0_0_30px_rgba(0,229,255,0.6)] w-full sm:w-auto text-lg font-semibold px-10">
            {t.cta.btn1}
          </Button>
          <Button size="lg" variant="secondary" className="w-full sm:w-auto text-lg font-semibold px-10">
            {t.cta.btn2}
          </Button>
        </div>
      </div>
    </section>
  );
}
