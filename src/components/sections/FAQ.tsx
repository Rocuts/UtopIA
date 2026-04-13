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
    <section id="faq" className="py-24 relative container mx-auto px-4 sm:px-6 lg:px-8 max-w-4xl">
      <Reveal>
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4 text-[#0a0a0a]">
            {t.faq.title} {t.faq.titleHighlight}
          </h2>
          <p className="text-lg text-[#525252]">
            {t.faq.desc}
          </p>
        </div>
      </Reveal>

      <div className="flex flex-col border border-[#e5e5e5] rounded-sm overflow-hidden divide-y divide-[#e5e5e5]">
        {faqs.map((faq, idx) => (
          <Reveal key={idx} delay={idx * 0.04} distance={12}>
            <div className="bg-white">
              <button
                onClick={() => toggleFaq(idx)}
                className="w-full flex items-center justify-between p-6 text-left focus:outline-none hover:bg-[#fafafa] transition-colors"
                aria-expanded={openIndex === idx}
              >
                <h3 className="text-base font-medium pr-8 text-[#0a0a0a]">{faq.question}</h3>
                <ChevronDown
                  className={cn(
                    "w-4 h-4 text-[#a3a3a3] transition-transform duration-100 flex-shrink-0",
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
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
                className="overflow-hidden"
              >
                <div className="px-6 pb-6 text-[#525252] text-sm leading-relaxed">
                  <p>{faq.answer}</p>
                </div>
              </motion.div>
            </div>
          </Reveal>
        ))}
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
