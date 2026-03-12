'use client';

import { Badge } from "@/components/ui/Badge";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Mic, Database, Scale, ShieldCheck, ArrowRight } from "lucide-react";
import { useLanguage } from '@/context/LanguageContext';

export function Methodology() {
  const { t } = useLanguage();

  const stepsList = [
    {
      icon: <Mic className="w-6 h-6" />,
      title: t.methodology.step1,
      description: t.methodology.step1_desc,
    },
    {
      icon: <Database className="w-6 h-6" />,
      title: t.methodology.step2,
      description: t.methodology.step2_desc,
    },
    {
      icon: <Scale className="w-6 h-6" />,
      title: t.methodology.step3,
      description: t.methodology.step3_desc,
    },
    {
      icon: <ShieldCheck className="w-6 h-6" />,
      title: t.methodology.step4,
      description: t.methodology.step4_desc,
    },
  ];

  return (
    <section id="methodology" className="py-24 relative overflow-hidden bg-gradient-to-b from-transparent to-[rgba(15,23,42,0.2)]">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl relative z-10">
        
        <div className="text-center max-w-3xl mx-auto mb-20">
          <Badge variant="outline" className="mb-4">{t.methodology.badge}</Badge>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-6 mt-2 text-foreground">
            {t.methodology.title}
          </h2>
          <p className="text-lg text-foreground/70">
            {t.methodology.desc}
          </p>
        </div>

        <div className="relative">
          {/* Connector Line */}
          <div className="absolute top-[3.5rem] left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[var(--surface-border)] to-transparent hidden lg:block" />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {stepsList.map((step, index) => (
              <div key={index} className="relative flex flex-col group">
                {/* Step Num & Icon */}
                <div className="flex items-center mb-6">
                  <GlassPanel className="w-14 h-14 rounded-2xl flex items-center justify-center border-[var(--surface-border-solid)] z-10 bg-[var(--background)] shadow-xl relative text-[#00e5ff] transition-transform group-hover:scale-105">
                    {step.icon}
                  </GlassPanel>
                  <div className="hidden lg:flex flex-1 items-center justify-end pr-4 opacity-30 group-hover:opacity-100 transition-opacity">
                    {index < stepsList.length - 1 && <ArrowRight className="w-5 h-5 text-[#00e5ff]" />}
                  </div>
                </div>
                
                {/* Content */}
                <h3 className="text-xl font-semibold mb-3 flex items-baseline gap-3">
                  <span className="text-sm text-foreground/30 font-mono">0{index + 1}</span>
                  {step.title}
                </h3>
                <p className="text-foreground/70 leading-relaxed text-sm lg:text-base">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}
