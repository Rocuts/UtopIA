'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const FAQS = [
  {
    q: '¿1+1 reemplaza a mi contador?',
    a: 'No. 1+1 potencia a su contador o firma con herramientas de IA para análisis más rápidos y fundamentados. El criterio profesional sigue siendo indispensable.',
  },
  {
    q: '¿Qué requerimientos de la DIAN analizan?',
    a: 'Requerimientos ordinarios y especiales, pliegos de cargos, liquidaciones oficiales y emplazamientos en IVA, renta, retenciones y facturación electrónica.',
  },
  {
    q: '¿Cómo manejan la confidencialidad?',
    a: 'Toda la información se procesa con cifrado de extremo a extremo. Cumplimos con la Ley 1581 de Protección de Datos.',
  },
  {
    q: '¿En qué se diferencia de un software contable?',
    a: 'Un software contable registra. 1+1 analiza, interpreta normativa, identifica riesgos y genera estrategias accionables — la diferencia entre tener datos y tener inteligencia.',
  },
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section
      id="faq"
      className="border-t border-n-200"
      style={{ padding: '84px clamp(22px, 5vw, 56px)' }}
    >
      <div className="max-w-[1180px] mx-auto">
        {/* Section header */}
        <div className="text-center max-w-[60ch] mx-auto mb-12">
          <span className="text-xs uppercase tracking-[0.16em] text-n-500 font-medium block mb-3.5">
            Preguntas frecuentes
          </span>
          <h2
            className="font-serif-elite font-medium text-n-1000"
            style={{
              fontSize: 'clamp(1.9rem, 3.4vw, 2.8rem)',
              letterSpacing: '-0.02em',
              lineHeight: 1.08,
            }}
          >
            Lo que suelen preguntarnos.
          </h2>
        </div>

        {/* Accordion */}
        <div className="max-w-[760px] mx-auto">
          {FAQS.map((faq, idx) => {
            const isOpen = openIndex === idx;
            return (
              <div key={idx} className="border-b border-n-200">
                <button
                  onClick={() => setOpenIndex(isOpen ? null : idx)}
                  className="w-full flex items-center justify-between gap-4 py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2"
                  aria-expanded={isOpen}
                >
                  <span
                    className="font-medium text-n-1000 flex-1"
                    style={{ fontSize: '1.0625rem' }}
                  >
                    {faq.q}
                  </span>
                  <ChevronDown
                    className={cn(
                      'w-[18px] h-[18px] text-gold-600 flex-shrink-0 transition-transform duration-200',
                      isOpen && 'rotate-180',
                    )}
                    aria-hidden="true"
                  />
                </button>
                {isOpen && (
                  <div className="pb-5 text-n-600 leading-[1.65] max-w-[64ch]" style={{ fontSize: '0.9375rem' }}>
                    {faq.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
