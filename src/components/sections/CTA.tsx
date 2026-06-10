'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export function CTA() {
  return (
    <section
      className="border-t border-n-200 text-center"
      style={{ padding: '84px clamp(22px, 5vw, 56px)' }}
    >
      <div className="max-w-[48rem] mx-auto">
        <h2
          className="font-serif-elite font-medium text-n-1000 mx-auto"
          style={{
            fontSize: 'clamp(2.2rem, 4.6vw, 3.6rem)',
            letterSpacing: '-0.02em',
            lineHeight: 1.05,
            maxWidth: '18ch',
          }}
        >
          La claridad financiera empieza con una conversación.
        </h2>
        <p className="text-n-600 mt-4 mb-8 mx-auto" style={{ fontSize: '1.0625rem', maxWidth: '50ch' }}>
          Acceda al workspace y deje que la inteligencia financiera trabaje por usted.
        </p>
        <div className="flex gap-3.5 justify-center flex-wrap">
          <Link href="/workspace">
            <button className="inline-flex items-center gap-2 h-12 px-7 rounded-lg text-[0.9375rem] font-semibold bg-gold-500 hover:bg-gold-600 text-n-0 border border-black/10 transition-all duration-200 hover:-translate-y-px hover:shadow-[0_0_22px_rgb(184_147_74_/_0.18)] active:scale-[0.98]">
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
              Acceder al workspace
            </button>
          </Link>
          <Link href="/login">
            <button
              className="inline-flex items-center h-12 px-7 rounded-lg text-[0.9375rem] font-medium bg-transparent text-gold-500 border transition-all duration-200 hover:text-gold-600 hover:bg-gold-500/10 hover:-translate-y-px active:scale-[0.98]"
              style={{ borderColor: 'rgb(212 184 118 / .4)' }}
            >
              Crear cuenta
            </button>
          </Link>
        </div>
      </div>
    </section>
  );
}
