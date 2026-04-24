'use client';

import { useRef, useEffect, useState } from 'react';
import { motion, useScroll, useTransform, useSpring, useInView } from 'motion/react';
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Briefcase, DollarSign, Target, Clock } from "lucide-react";
import { useLanguage } from '@/context/LanguageContext';
import { Reveal } from '@/components/ui/ParallaxWrapper';

const NOVA_SPRING = { stiffness: 400, damping: 25 };

function AnimatedCounter({ value, duration = 1500 }: { value: string; duration?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.5 });
  const [display, setDisplay] = useState(value.replace(/[\d.]+/, '0'));

  useEffect(() => {
    if (!isInView) return;

    const match = value.match(/^([^\d]*)([\d.]+)(.*)$/);
    if (!match) {
      setDisplay(value);
      return;
    }

    const [, prefix, numStr, suffix] = match;
    const target = parseFloat(numStr);
    const hasDecimal = numStr.includes('.');
    const decimalPlaces = hasDecimal ? numStr.split('.')[1].length : 0;
    const startTime = performance.now();

    function update(currentTime: number) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = target * eased;

      setDisplay(`${prefix}${current.toFixed(decimalPlaces)}${suffix}`);

      if (progress < 1) {
        requestAnimationFrame(update);
      }
    }

    requestAnimationFrame(update);
  }, [isInView, value, duration]);

  return <div ref={ref}>{display}</div>;
}

function MetricCard({
  icon,
  value,
  label,
  description,
  index,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  description: string;
  index: number;
}) {
  return (
    <Reveal delay={index * 0.05}>
      <GlassPanel hoverEffect className="p-6 flex flex-col justify-between">
        <div className="mb-4 text-n-900 bg-n-50 border border-n-200 w-fit p-3 rounded-sm">
          {icon}
        </div>
        <div>
          <div className="text-4xl font-bold mb-1 text-n-900 font-mono num">
            <AnimatedCounter value={value} />
          </div>
          <p className="text-sm font-medium text-n-900 mb-2">{label}</p>
          <p className="text-xs text-n-400">{description}</p>
        </div>
      </GlassPanel>
    </Reveal>
  );
}

export function Metrics() {
  const { t } = useLanguage();
  const sectionRef = useRef<HTMLElement>(null);

  return (
    <section id="metrics" ref={sectionRef} className="py-20 md:py-28 relative container mx-auto px-4 sm:px-6 lg:px-8 max-w-[var(--content-width)]">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center relative z-10">

        <Reveal direction="left">
          <div>
            <h2 className="font-serif-elite text-4xl md:text-5xl font-medium tracking-tight mb-6 text-n-900 leading-display"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 0, "WONK" 0' }}>
              {t.metrics.headline} <br /> {t.metrics.headlineHighlight}
            </h2>
            <p className="text-lg text-n-600 mb-8 max-w-xl leading-relaxed">
              {t.metrics.headlineDesc}
            </p>

            <div className="flex gap-4 items-center pl-4 border-l-2 border-n-900">
              <p className="text-sm text-n-600 italic max-w-md">
                {t.metrics.quote}
              </p>
            </div>
          </div>
        </Reveal>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-n-200 border border-n-200 rounded-sm overflow-hidden">
          <div className="bg-n-0">
            <MetricCard
              index={0}
              icon={<Briefcase className="w-5 h-5" />}
              value="+500"
              label={t.metrics.waitTime}
              description={t.metrics.waitTimeDesc}
            />
          </div>
          <div className="bg-n-0">
            <MetricCard
              index={1}
              icon={<DollarSign className="w-5 h-5" />}
              value="$2.4B"
              label={t.metrics.m3}
              description={t.metrics.legalBriefsDesc}
            />
          </div>
          <div className="bg-n-0">
            <MetricCard
              index={2}
              icon={<Target className="w-5 h-5" />}
              value="98.7%"
              label={t.metrics.privacy}
              description={t.metrics.privacyDesc}
            />
          </div>
          <div className="bg-n-0">
            <MetricCard
              index={3}
              icon={<Clock className="w-5 h-5" />}
              value="<24h"
              label={t.metrics.m2}
              description={t.metrics.voiceDesc}
            />
          </div>
        </div>

      </div>
    </section>
  );
}
