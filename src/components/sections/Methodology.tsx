'use client';

import { useRef } from 'react';
import { motion, useScroll, useSpring } from 'motion/react';
import { Badge } from "@/components/ui/Badge";
import { Search, FileSearch, Target, FileCheck, ArrowRight } from "lucide-react";
import { useLanguage } from '@/context/LanguageContext';
import { Reveal } from '@/components/ui/ParallaxWrapper';

const NOVA_SPRING = { stiffness: 400, damping: 25 };

function ProgressLine() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.8', 'end 0.5'],
  });

  const scaleX = useSpring(scrollYProgress, NOVA_SPRING);

  return (
    <div ref={ref} className="absolute top-[3.5rem] left-0 w-full h-px hidden lg:block overflow-hidden">
      <div className="absolute inset-0 bg-n-200" />
      <motion.div
        className="absolute inset-0 bg-n-900"
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
      icon: <Search className="w-5 h-5" />,
      title: t.methodology.step1,
      description: t.methodology.step1_desc,
    },
    {
      icon: <FileSearch className="w-5 h-5" />,
      title: t.methodology.step2,
      description: t.methodology.step2_desc,
    },
    {
      icon: <Target className="w-5 h-5" />,
      title: t.methodology.step3,
      description: t.methodology.step3_desc,
    },
    {
      icon: <FileCheck className="w-5 h-5" />,
      title: t.methodology.step4,
      description: t.methodology.step4_desc,
    },
  ];

  return (
    <section id="methodology" className="py-20 md:py-28 relative border-t border-n-200">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-[var(--content-width)] relative z-10">

        <Reveal>
          <div className="text-center max-w-3xl mx-auto mb-20">
            <Badge variant="outline" className="mb-4">{t.methodology.badge}</Badge>
            <h2 className="font-serif-elite text-4xl md:text-5xl font-medium tracking-tight mb-6 mt-2 text-n-900 leading-display"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 0, "WONK" 0, "wght" 500' }}>
              {t.methodology.title}
            </h2>
            <p className="text-lg text-n-600">
              {t.methodology.desc}
            </p>
          </div>
        </Reveal>

        <div className="relative">
          <ProgressLine />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {stepsList.map((step, index) => (
              <Reveal
                key={index}
                delay={index * 0.08}
                direction={index % 2 === 0 ? 'left' : 'right'}
                distance={20}
              >
                <div className="relative flex flex-col group">
                  <div className="flex items-center mb-6">
                    <div className="w-12 h-12 rounded-sm flex items-center justify-center border border-n-200 bg-n-0 z-10 text-n-900 transition-colors group-hover:bg-n-900 group-hover:text-white group-hover:border-n-900">
                      {step.icon}
                    </div>
                    <div className="hidden lg:flex flex-1 items-center justify-end pr-4 opacity-20 group-hover:opacity-100 transition-opacity">
                      {index < stepsList.length - 1 && <ArrowRight className="w-4 h-4 text-n-900" />}
                    </div>
                  </div>

                  <h3 className="text-lg font-semibold mb-3 flex items-baseline gap-3 text-n-900">
                    <span className="text-xs text-n-400 font-mono num">0{index + 1}</span>
                    {step.title}
                  </h3>
                  <p className="text-n-600 leading-relaxed text-sm lg:text-base">
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
