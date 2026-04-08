'use client';

import { useState } from 'react';
import { motion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { useLanguage } from '@/context/LanguageContext';
import { Reveal } from '@/components/ui/ParallaxWrapper';

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const { t } = useLanguage();

  const faqs = [
    { question: t.faq.q1, answer: t.faq.a1 },
    { question: t.faq.q2, answer: t.faq.a2 },
    { question: t.faq.q3, answer: t.faq.a3 },
    { question: t.faq.q4, answer: t.faq.a4 },
    { question: t.faq.q5, answer: t.faq.a5 },
  ];

  const toggleFaq = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section id="faq" className="py-24 relative container mx-auto px-4 sm:px-6 lg:px-8 max-w-4xl">
      <Reveal>
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
            {t.faq.title} <span className="text-gradient">{t.faq.titleHighlight}</span>
          </h2>
          <p className="text-lg text-foreground/70">
            {t.faq.desc}
          </p>
        </div>
      </Reveal>

      <div className="flex flex-col gap-4">
        {faqs.map((faq, idx) => (
          <Reveal key={idx} delay={idx * 0.08} distance={20}>
            <GlassPanel
              className="overflow-hidden transition-all duration-300"
            >
              <button
                onClick={() => toggleFaq(idx)}
                className="w-full flex items-center justify-between p-6 text-left focus:outline-none"
                aria-expanded={openIndex === idx}
              >
                <h3 className="text-lg font-semibold pr-8 text-foreground group-hover:text-[#d4a017] transition-colors">{faq.question}</h3>
                <ChevronDown
                  className={cn(
                    "w-5 h-5 text-[#d4a017] transition-transform duration-300 flex-shrink-0",
                    { "rotate-180": openIndex === idx }
                  )}
                />
              </button>
              <motion.div
                initial={false}
                animate={{
                  height: openIndex === idx ? 'auto' : 0,
                  opacity: openIndex === idx ? 1 : 0,
                }}
                transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
                className="overflow-hidden"
              >
                <div className="px-6 pb-6 text-foreground/70 text-base leading-relaxed">
                  <p>{faq.answer}</p>
                </div>
              </motion.div>
            </GlassPanel>
          </Reveal>
        ))}
      </div>

      {/* Semantic SEO JSON-LD for FAQ */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": faqs.map((faq) => ({
              "@type": "Question",
              "name": faq.question,
              "acceptedAnswer": {
                "@type": "Answer",
                "text": faq.answer
              }
            }))
          })
        }}
      />
    </section>
  );
}
