'use client';

/**
 * /workspace/escudo/agente-fiscal — Capa 4: Agente Fiscal El Escudo.
 *
 * Routing decision: dedicated sub-page (not querystring) so the URL is
 * bookmarkable, aligns with the existing pattern of defensa-dian /
 * planeacion-tributaria / supervivencia sub-pages, and keeps browser history
 * clean. The FiscalAgentPanel is stateful (SSE consumer) so it needs 'use client'.
 */

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { ChevronLeft } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { AreaShell } from '@/components/workspace/layouts/AreaShell';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { FiscalAgentPanel } from '@/components/workspace/escudo/FiscalAgentPanel';

export default function AgenteFiscalPage() {
  const { t, language } = useLanguage();
  const reduced = useReducedMotion();
  const fiscal = t.elite.areas.escudo.fiscalAgent;

  const fadeItem = (i: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 12 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.45, delay: 0.05 + i * 0.07, ease: [0.16, 1, 0.3, 1] as const },
        };

  return (
    <AreaShell areaAccent="escudo">
      {/* Breadcrumb */}
      <motion.div {...fadeItem(0)} className="mb-6">
        <Link
          href="/workspace/escudo"
          prefetch={false}
          className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-n-500 hover:text-gold-500 transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          {language === 'es' ? 'El Escudo' : 'The Shield'}
        </Link>
      </motion.div>

      {/* Page header */}
      <motion.div {...fadeItem(1)} className="mb-10">
        <SectionHeader
          eyebrow={t.elite.areas.escudo.concept}
          title={fiscal.title}
          subtitle={fiscal.subtitle}
          align="left"
          accent="wine"
          divider
          titleAs="h1"
        />
      </motion.div>

      {/* Main panel */}
      <motion.div {...fadeItem(2)}>
        <FiscalAgentPanel />
      </motion.div>
    </AreaShell>
  );
}
