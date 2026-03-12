'use client';

import { GlassPanel } from "@/components/ui/GlassPanel";
import { TrendingUp, Clock, Zap, ShieldCheck } from "lucide-react";
import { useLanguage } from '@/context/LanguageContext';

export function Metrics() {
  const { t } = useLanguage();

  return (
    <section id="metrics" className="py-24 relative container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">

        <div>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-6">
            {t.metrics.headline} <br /> <span className="text-gradient">{t.metrics.headlineHighlight}</span>
          </h2>
          <p className="text-lg text-foreground/70 mb-8 max-w-xl leading-relaxed">
            {t.metrics.headlineDesc}
          </p>

          <div className="flex gap-4 items-center pl-4 border-l-2 border-[#00e5ff]/50">
            <p className="text-sm text-foreground/60 italic max-w-md">
              {t.metrics.quote}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 h-full">
          <GlassPanel hoverEffect className="p-6 flex flex-col justify-between">
            <div className="mb-4 text-[#00e5ff] bg-[#00e5ff]/10 w-fit p-3 rounded-xl">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <div className="text-4xl font-bold mb-1 text-foreground">0 min</div>
              <p className="text-sm font-semibold text-foreground/80 mb-2">{t.metrics.waitTime}</p>
              <p className="text-xs text-foreground/50">{t.metrics.waitTimeDesc}</p>
            </div>
          </GlassPanel>

          <GlassPanel hoverEffect className="p-6 flex flex-col justify-between">
            <div className="mb-4 text-[#00e5ff] bg-[#00e5ff]/10 w-fit p-3 rounded-xl">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <div className="text-4xl font-bold mb-1 text-foreground">10M+</div>
              <p className="text-sm font-semibold text-foreground/80 mb-2">{t.metrics.m3}</p>
              <p className="text-xs text-foreground/50">{t.metrics.legalBriefsDesc}</p>
            </div>
          </GlassPanel>

          <GlassPanel hoverEffect className="p-6 flex flex-col justify-between">
            <div className="mb-4 text-[#00e5ff] bg-[#00e5ff]/10 w-fit p-3 rounded-xl">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <div className="text-4xl font-bold mb-1 text-foreground">&lt; 1s</div>
              <p className="text-sm font-semibold text-foreground/80 mb-2">{t.metrics.m2}</p>
              <p className="text-xs text-foreground/50">{t.metrics.voiceDesc}</p>
            </div>
          </GlassPanel>

          <GlassPanel hoverEffect className="p-6 flex flex-col justify-between">
            <div className="mb-4 text-[#00e5ff] bg-[#00e5ff]/10 w-fit p-3 rounded-xl">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="text-4xl font-bold mb-1 text-foreground">100%</div>
              <p className="text-sm font-semibold text-foreground/80 mb-2">{t.metrics.privacy}</p>
              <p className="text-xs text-foreground/50">{t.metrics.privacyDesc}</p>
            </div>
          </GlassPanel>
        </div>

      </div>
    </section>
  );
}
