'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform, useSpring } from 'motion/react';
import { Badge } from "@/components/ui/Badge";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Search, FileSearch, Target, FileCheck, ArrowRight } from "lucide-react";
import { useLanguage } from '@/context/LanguageContext';
import { Reveal } from '@/components/ui/ParallaxWrapper';

function ProgressLine() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.8', 'end 0.5'],
  });

  const scaleX = useSpring(scrollYProgress, { stiffness: 80, damping: 30 });

  return (
    <div ref={ref} className="absolute top-[3.5rem] left-0 w-full h-[2px] hidden lg:block overflow-hidden">
      {/* Static background line */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[var(--surface-border)] to-transparent" />
      {/* Animated gold progress line */}
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-[#d4a017]/60 via-[#d4a017] to-[#d4a017]/60"
        style={{
          scaleX,
          transformOrigin: 'left',
          willChange: 'transform',
        }}
      />
    </div>
  );
}

export function Methodology() {
  const { t } = useLanguage();

  const stepsList = [
    {
      icon: <Search className="w-6 h-6" />,
      title: t.methodology.step1,
      description: t.methodology.step1_desc,
    },
    {
      icon: <FileSearch className="w-6 h-6" />,
      title: t.methodology.step2,
      description: t.methodology.step2_desc,
    },
    {
      icon: <Target className="w-6 h-6" />,
      title: t.methodology.step3,
      description: t.methodology.step3_desc,
    },
    {
      icon: <FileCheck className="w-6 h-6" />,
      title: t.methodology.step4,
      description: t.methodology.step4_desc,
    },
  ];

  return (
    <section id="methodology" className="py-24 relative overflow-hidden bg-gradient-to-b from-transparent to-[rgba(10,15,26,0.3)]">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl relative z-10">

        <Reveal>
          <div className="text-center max-w-3xl mx-auto mb-20">
            <Badge variant="outline" className="mb-4">{t.methodology.badge}</Badge>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-6 mt-2 text-foreground">
              {t.methodology.title}
            </h2>
            <p className="text-lg text-foreground/70">
              {t.methodology.desc}
            </p>
          </div>
        </Reveal>

        <div className="relative">
          {/* Animated Connector Line */}
          <ProgressLine />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {stepsList.map((step, index) => (
              <Reveal
                key={index}
                delay={index * 0.15}
                direction={index % 2 === 0 ? 'left' : 'right'}
                distance={30}
              >
                <div className="relative flex flex-col group">
                  {/* Step Num & Icon */}
                  <div className="flex items-center mb-6">
                    <GlassPanel className="w-14 h-14 rounded-2xl flex items-center justify-center border-[var(--surface-border-solid)] z-10 bg-[var(--background)] shadow-xl relative text-[#d4a017] transition-transform group-hover:scale-105">
                      {step.icon}
                    </GlassPanel>
                    <div className="hidden lg:flex flex-1 items-center justify-end pr-4 opacity-30 group-hover:opacity-100 transition-opacity">
                      {index < stepsList.length - 1 && <ArrowRight className="w-5 h-5 text-[#d4a017]" />}
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
              </Reveal>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}
