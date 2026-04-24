'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import { Button } from "@/components/ui/Button";
import { useLanguage } from '@/context/LanguageContext';

const NOVA_SPRING = { stiffness: 400, damping: 25 };

export function CTA() {
  const { t } = useLanguage();

  return (
    <section className="py-20 md:py-28 relative border-t border-n-200">
      <div className="relative z-10 container mx-auto px-4 sm:px-6 lg:px-8 max-w-[var(--content-width-narrow)] text-center">
        <motion.h2
          className="font-serif-elite text-4xl md:text-5xl font-medium tracking-tight mb-6 text-n-900 leading-display"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 0, "WONK" 0, "wght" 500' }}
          initial={{ opacity: 0, y: -16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ type: "spring", ...NOVA_SPRING }}
        >
          {t.cta.title1} <br className="hidden md:block" />
          {t.cta.title2} {t.cta.titleHighlight}?
        </motion.h2>

        <motion.p
          className="text-xl text-n-600 mb-10 max-w-2xl mx-auto"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ type: "spring", ...NOVA_SPRING, delay: 0.05 }}
        >
          {t.cta.desc}
        </motion.p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ type: "spring", ...NOVA_SPRING, delay: 0.1 }}
          >
            <Link href="/workspace">
              <Button size="lg" className="w-full sm:w-auto text-base px-10">
                {t.cta.btn1}
              </Button>
            </Link>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ type: "spring", ...NOVA_SPRING, delay: 0.1 }}
          >
            <Button
              size="lg"
              variant="secondary"
              className="w-full sm:w-auto text-base px-10"
              onClick={() => document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' })}
            >
              {t.cta.btn2}
            </Button>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
