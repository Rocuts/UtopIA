'use client';

import { useRef, useEffect, useState } from 'react';
import { motion, useScroll, useTransform, useSpring, useInView } from 'motion/react';
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Briefcase, DollarSign, Target, Clock } from "lucide-react";
import { useLanguage } from '@/context/LanguageContext';
import { Reveal } from '@/components/ui/ParallaxWrapper';

function AnimatedCounter({ value, duration = 2000 }: { value: string; duration?: number }) {
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
      // Ease out cubic
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
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });

  // Gold accent elements move at different speeds
  const accentY = useSpring(
    useTransform(scrollYProgress, [0, 1], [(index % 2 === 0 ? 20 : -20), (index % 2 === 0 ? -20 : 20)]),
    { stiffness: 100, damping: 30 }
  );

  return (
    <Reveal delay={index * 0.1}>
      <div ref={ref}>
        <GlassPanel hoverEffect className="p-6 flex flex-col justify-between relative overflow-hidden">
          {/* Subtle parallax gold accent */}
          <motion.div
            className="absolute -top-6 -right-6 w-24 h-24 bg-[#d4a017]/5 rounded-full blur-2xl pointer-events-none"
            style={{ y: accentY, willChange: 'transform' }}
          />

          <div className="mb-4 text-[#d4a017] bg-[#d4a017]/10 w-fit p-3 rounded-xl relative z-10">
            {icon}
          </div>
          <div className="relative z-10">
            <div className="text-4xl font-bold mb-1 text-foreground">
              <AnimatedCounter value={value} />
            </div>
            <p className="text-sm font-semibold text-foreground/80 mb-2">{label}</p>
            <p className="text-xs text-foreground/50">{description}</p>
          </div>
        </GlassPanel>
      </div>
    </Reveal>
  );
}

export function Metrics() {
  const { t } = useLanguage();
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'end start'],
  });

  // Subtle background parallax shift
  const bgY = useSpring(
    useTransform(scrollYProgress, [0, 1], [30, -30]),
    { stiffness: 100, damping: 30 }
  );

  return (
    <section id="metrics" ref={sectionRef} className="py-24 relative container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl overflow-hidden">
      {/* Parallax background accent */}
      <motion.div
        className="absolute top-0 right-0 w-96 h-96 bg-[#d4a017]/3 rounded-full blur-[120px] pointer-events-none"
        style={{ y: bgY, willChange: 'transform' }}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center relative z-10">

        <Reveal direction="left">
          <div>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-6">
              {t.metrics.headline} <br /> <span className="text-gradient">{t.metrics.headlineHighlight}</span>
            </h2>
            <p className="text-lg text-foreground/70 mb-8 max-w-xl leading-relaxed">
              {t.metrics.headlineDesc}
            </p>

            <div className="flex gap-4 items-center pl-4 border-l-2 border-[#d4a017]/50">
              <p className="text-sm text-foreground/60 italic max-w-md">
                {t.metrics.quote}
              </p>
            </div>
          </div>
        </Reveal>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 h-full">
          <MetricCard
            index={0}
            icon={<Briefcase className="w-6 h-6" />}
            value="+500"
            label={t.metrics.waitTime}
            description={t.metrics.waitTimeDesc}
          />

          <MetricCard
            index={1}
            icon={<DollarSign className="w-6 h-6" />}
            value="$2.4B"
            label={t.metrics.m3}
            description={t.metrics.legalBriefsDesc}
          />

          <MetricCard
            index={2}
            icon={<Target className="w-6 h-6" />}
            value="98.7%"
            label={t.metrics.privacy}
            description={t.metrics.privacyDesc}
          />

          <MetricCard
            index={3}
            icon={<Clock className="w-6 h-6" />}
            value="<24h"
            label={t.metrics.m2}
            description={t.metrics.voiceDesc}
          />
        </div>

      </div>
    </section>
  );
}
