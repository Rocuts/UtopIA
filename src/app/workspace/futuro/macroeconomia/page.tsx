'use client';

/**
 * /workspace/futuro/macroeconomia — indicadores macro con fuente y vigencia.
 *
 * Auditoría valoracion-02: antes mostraba constantes (TRM, IPC, tasa, PIB) y
 * proyecciones atribuidas a BanRep/DANE con una fecha de actualización fija,
 * más una recomendación de ahorro en puntos básicos sin fuente. Ahora consume
 * /api/macro/current (procedencia por campo, valoracion-04) y muestra N/D con
 * motivo cuando no hay dato verificado. Sin proyecciones ni recomendaciones.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Globe } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import {
  MacroIndicatorsView,
  type MacroViewState,
} from '@/components/workspace/areas/shared/MacroIndicatorsView';
import type { MacroFactors } from '@/lib/pillars/types';

export default function MacroeconomiaPage() {
  const { t, language } = useLanguage();
  const ds = t.elite.dataStatus;
  const [state, setState] = useState<MacroViewState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/macro/current')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as MacroFactors;
        if (!cancelled) setState({ status: 'ready', data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="relative w-full min-h-full overflow-y-auto" data-lenis-prevent>
      <div className="max-w-[900px] mx-auto px-4 md:px-8 pt-8 pb-24">
        <Link
          href="/workspace/futuro"
          prefetch={false}
          className="inline-flex items-center gap-1.5 text-xs text-n-600 hover:text-n-1000 transition-colors mb-8"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          {ds.macro.back}
        </Link>

        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-md"
              style={{ background: 'rgba(90,127,122,0.15)' }}
              aria-hidden="true"
            >
              <Globe className="h-4 w-4" style={{ color: '#5A7F7A' }} strokeWidth={1.8} />
            </span>
            <span className="text-xs font-medium text-n-700">{ds.macro.eyebrow}</span>
          </div>
          <h1 className="text-3xl font-semibold text-n-1000 mb-2">{ds.macro.title}</h1>
          <p className="text-sm text-n-700 max-w-xl">{ds.macro.lede}</p>
        </div>

        <section className="mb-8">
          <MacroIndicatorsView state={state} language={language} t={ds} />
        </section>

        <p className="text-xs leading-relaxed text-n-700">{ds.macro.noProjections}</p>
      </div>
    </div>
  );
}
