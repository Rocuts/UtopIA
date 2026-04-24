'use client';

import { useState } from 'react';
import { motion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
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
    <section id="faq" className="py-20 md:py-28 relative container mx-auto px-4 sm:px-6 lg:px-8 max-w-[var(--content-width-narrow)]">
      {/* Header — asymmetric two-column */}
      <Reveal>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr] gap-6 md:gap-12 mb-16 items-end">
          <div>
            <span className="inline-flex items-center gap-2 text-xs tracking-eyebrow uppercase text-n-400 font-medium mb-4">
              <span className="h-px w-5 bg-n-300" aria-hidden="true" />
              FAQ
            </span>
            <h2 className="font-serif-elite text-4xl md:text-5xl font-medium tracking-tight text-n-900 leading-display"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 0, "WONK" 0, "wght" 500' }}>
              {t.faq.title}{' '}
              {t.faq.titleHighlight}
            </h2>
          </div>
          <p className="text-base text-n-500 md:text-right md:max-w-md md:ml-auto">
            {t.faq.desc}
          </p>
        </div>
      </Reveal>

      {/* Accordion — numbered, separated items */}
      <div className="flex flex-col gap-3">
        {faqs.map((faq, idx) => {
          const isOpen = openIndex === idx;
          return (
            <Reveal key={idx} delay={idx * 0.04} distance={12}>
              <div
                className={cn(
                  "rounded-lg border transition-colors duration-150",
                  isOpen
                    ? "border-n-300 bg-n-50"
                    : "border-n-200 bg-n-0 hover:border-n-300"
                )}
              >
                <button
                  onClick={() => toggleFaq(idx)}
                  className="w-full flex items-center gap-4 p-5 sm:p-6 text-left focus:outline-none"
                  aria-expanded={isOpen}
                >
                  <span className="text-xs font-mono text-n-400 tabular-nums select-none">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <h3 className="flex-1 text-base font-medium text-n-900">{faq.question}</h3>
                  <ChevronDown
                    className={cn(
                      "w-4 h-4 text-n-400 transition-transform duration-150 flex-shrink-0",
                      { "rotate-180": isOpen }
                    )}
                  />
                </button>
                <motion.div
                  initial={false}
                  animate={{
                    height: isOpen ? 'auto' : 0,
                    opacity: isOpen ? 1 : 0,
                  }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  className="overflow-hidden"
                >
                  <div className="px-5 sm:px-6 pb-5 sm:pb-6 pl-[calc(1.25rem+1rem+theme(fontSize.xs))] sm:pl-[calc(1.5rem+1rem+theme(fontSize.xs))]">
                    <p className="text-sm leading-relaxed text-n-600">{faq.answer}</p>
                  </div>
                </motion.div>
              </div>
            </Reveal>
          );
        })}
      </div>

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
