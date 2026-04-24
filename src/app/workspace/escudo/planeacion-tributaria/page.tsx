'use client';

/**
 * /workspace/escudo/planeacion-tributaria — Submódulo Planeación Tributaria.
 *
 * Portada de producto para `/api/tax-planning` (pipeline 3 agentes:
 * Optimizador → Analista NIIF → Validador). El CTA abre el IntakeModal
 * con `caseType='tax_planning'` que renderiza el `GenericPipelineIntake`.
 */

import { useCallback } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import {
  Calculator,
  ChevronLeft,
  TrendingDown,
  Layers,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Gauge,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cn } from '@/lib/utils';
import { EliteButton } from '@/components/ui/EliteButton';
import { EliteCard } from '@/components/ui/EliteCard';
import { SectionHeader } from '@/components/ui/SectionHeader';

export default function PlaneacionTributariaPage() {
  const { t, language } = useLanguage();
  const reduced = useReducedMotion();
  const { openIntakeForType, setActiveCaseType, setActiveMode, startNewConsultation } =
    useWorkspace();

  const copy = t.elite.areas.escudo.submodules.planeacionTributaria;

  const handleGeneratePlan = useCallback(() => {
    openIntakeForType('tax_planning');
  }, [openIntakeForType]);

  const handleQuickChat = useCallback(() => {
    setActiveCaseType('general_chat');
    setActiveMode('chat');
    startNewConsultation('tax-planning');
  }, [setActiveCaseType, setActiveMode, startNewConsultation]);

  const agents =
    language === 'es'
      ? [
          {
            num: '01',
            icon: TrendingDown,
            title: 'Optimizador Tributario',
            body:
              'Identifica oportunidades bajo E.T. 2026: Art. 240 (35%), SIMPLE (Arts. 903–916), Zonas Francas, ZOMAC, descuentos Arts. 256/255, dividendos (Art. 242) y holdings CHC.',
          },
          {
            num: '02',
            icon: Layers,
            title: 'Analista Impacto NIIF',
            body:
              'Evalúa impacto contable de cada estrategia bajo NIIF/NIC, incluyendo impuesto diferido (NIC 12) y tratamiento de activos intangibles relacionados con la planeación.',
          },
          {
            num: '03',
            icon: CheckCircle2,
            title: 'Validador de Cumplimiento',
            body:
              'Verifica que ninguna estrategia infrinja la cláusula general antiabuso (Art. 869 E.T.) ni normas de precios de transferencia. Marca riesgos reputacionales y sancionatorios.',
          },
        ]
      : [
          {
            num: '01',
            icon: TrendingDown,
            title: 'Tax Optimizer',
            body:
              'Identifies opportunities under the 2026 Tax Statute: Art. 240 (35%), SIMPLE (Arts. 903–916), Free Trade Zones, ZOMAC, discounts (Arts. 256/255), dividends (Art. 242), and CHC holdings.',
          },
          {
            num: '02',
            icon: Layers,
            title: 'IFRS Impact Analyst',
            body:
              'Evaluates the accounting impact of each strategy under IFRS/IAS, including deferred tax (IAS 12) and treatment of intangibles tied to the plan.',
          },
          {
            num: '03',
            icon: CheckCircle2,
            title: 'Compliance Validator',
            body:
              'Verifies no strategy breaches the general anti-abuse clause (Art. 869 T.S.) nor transfer-pricing rules. Flags reputational and penalty risks.',
          },
        ];

  const benefits =
    language === 'es'
      ? [
          'Reducción promedio de 15–25% en tasa efectiva.',
          'Justificación técnica trazable por cada ahorro.',
          'Diagnóstico por régimen, sector y tamaño.',
        ]
      : [
          'Average 15–25% reduction in effective tax rate.',
          'Technical traceable justification for each saving.',
          'Diagnosis by regime, sector, and size.',
        ];

  const fadeItem = (i: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 12 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.45,
            delay: 0.05 + i * 0.07,
            ease: [0.16, 1, 0.3, 1] as const,
          },
        };

  return (
    <div
      className="relative w-full min-h-full overflow-y-auto bg-n-1000 text-n-100"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute -top-[15%] right-[5%] w-[500px] h-[500px] rounded-full blur-[130px] opacity-25"
          style={{
            background:
              'radial-gradient(circle, rgb(var(--color-gold-500-rgb) / 0.38) 0%, rgb(var(--color-gold-500-rgb) / 0) 70%)',
          }}
        />
      </div>

      <div className="relative z-[1] max-w-[1240px] mx-auto px-6 md:px-10 pt-6 pb-24">
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

        {/* Hero */}
        <motion.div {...fadeItem(1)} className="mb-10 flex items-start gap-5">
          <div
            aria-hidden="true"
            className="shrink-0 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-[rgb(var(--color-gold-500-rgb)_/_0.14)] text-gold-600 glow-gold-soft"
          >
            <Calculator className="h-7 w-7" strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
            <SectionHeader
              eyebrow={language === 'es' ? 'Estrategia Fiscal' : 'Fiscal Strategy'}
              title={copy.title}
              subtitle={copy.description}
              align="left"
              accent="gold"
            />
          </div>
        </motion.div>

        {/* Narrativa larga */}
        <motion.div
          {...fadeItem(2)}
          className="max-w-3xl space-y-5 text-md leading-relaxed text-n-300 mb-12"
        >
          <p>
            {language === 'es'
              ? 'La planeación tributaria no es una operación mecánica — es una disciplina. Combinar regímenes, descuentos, rentas exentas y estructura corporativa para obtener la menor carga fiscal posible sin cruzar la línea del abuso es un arte técnico que hasta hoy requería equipos especializados y costos elevados.'
              : 'Tax planning is not a mechanical operation — it is a discipline. Combining regimes, discounts, exempt income, and corporate structure to achieve the lowest possible tax burden without crossing into abuse is a technical craft that until today demanded specialized teams and high costs.'}
          </p>
          <p>
            {language === 'es'
              ? 'Nuestro motor corre tres agentes en secuencia: el Optimizador busca todas las oportunidades aplicables a su empresa; el Analista NIIF evalúa cómo cada una impacta sus estados financieros (incluyendo impuesto diferido); el Validador de Cumplimiento verifica que nada cruce la cláusula general antiabuso (Art. 869 E.T.) ni los regímenes especiales de la DIAN.'
              : 'Our engine runs three agents sequentially: the Optimizer scans every opportunity applicable to your company; the IFRS Analyst assesses how each one impacts the financial statements (including deferred tax); the Compliance Validator verifies that nothing crosses the general anti-abuse clause (Art. 869 T.S.) or the DIANʼs special regimes.'}
          </p>
          <p>
            {language === 'es'
              ? 'El resultado es un plan tributario ejecutable — con cuantificación, marco normativo citado y hoja de ruta de implementación. No le decimos qué pagar; le mostramos cuánto puede ahorrar legalmente y cómo.'
              : 'The output is an executable tax plan — quantified, with cited regulatory framework and an implementation roadmap. We donʼt tell you what to pay; we show you how much you can legally save and how.'}
          </p>
        </motion.div>

        {/* Benefit row */}
        <motion.ul {...fadeItem(3)} className="flex flex-wrap gap-3 mb-10">
          {benefits.map((b) => (
            <li
              key={b}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[rgb(var(--color-gold-500-rgb)_/_0.08)] border border-[rgb(var(--color-gold-500-rgb)_/_0.25)] text-xs text-gold-600"
            >
              <Sparkles className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              {b}
            </li>
          ))}
        </motion.ul>

        {/* Pipeline agents */}
        <motion.div {...fadeItem(4)} className="grid gap-4 md:grid-cols-3 mb-12">
          {agents.map((agent) => (
            <EliteCard key={agent.num} variant="glass" padding="md" hover="none">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span
                    aria-hidden="true"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[rgb(var(--color-gold-500-rgb)_/_0.14)] text-gold-600"
                  >
                    <agent.icon className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <span className="font-serif-elite text-xl text-n-600 tabular-nums">
                    {agent.num}
                  </span>
                </div>
                <h3 className="font-serif-elite text-lg leading-tight font-normal text-n-1000">
                  {agent.title}
                </h3>
                <p className="text-sm leading-relaxed text-n-700">{agent.body}</p>
              </div>
            </EliteCard>
          ))}
        </motion.div>

        {/* CTAs */}
        <motion.div
          {...fadeItem(5)}
          className={cn(
            'relative overflow-hidden rounded-[16px] p-6 md:p-8',
            'glass-elite-elevated border-elite-gold glow-gold-soft',
          )}
        >
          <div
            aria-hidden="true"
            className="absolute -right-24 -top-24 w-[320px] h-[320px] rounded-full blur-[110px] opacity-40"
            style={{
              background:
                'radial-gradient(circle, rgb(var(--color-gold-500-rgb) / 0.45) 0%, rgb(var(--color-gold-500-rgb) / 0) 70%)',
            }}
          />
          <div className="relative z-[1] flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="flex items-start gap-3 md:max-w-xl">
              <span
                aria-hidden="true"
                className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-md bg-[rgb(var(--color-gold-500-rgb)_/_0.16)] text-gold-600"
              >
                <Gauge className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <div>
                <h3 className="font-serif-elite text-xl leading-tight text-n-1000 mb-1.5">
                  {language === 'es'
                    ? 'Genere su plan tributario 2026'
                    : 'Generate your 2026 tax plan'}
                </h3>
                <p className="text-sm leading-relaxed text-n-700">
                  {language === 'es'
                    ? 'Complete el intake (2 min) con metadatos de la empresa y su régimen. El pipeline entrega un reporte SSE en vivo.'
                    : 'Complete the intake (2 min) with company metadata and regime. The pipeline delivers a live SSE report.'}
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch gap-3 shrink-0">
              <EliteButton
                variant="ghost"
                size="md"
                onClick={handleQuickChat}
                rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={2} />}
              >
                {language === 'es' ? 'Chat rápido' : 'Quick chat'}
              </EliteButton>
              <EliteButton
                variant="primary"
                size="lg"
                onClick={handleGeneratePlan}
                rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={2} />}
                glow
              >
                {language === 'es' ? 'Generar plan tributario' : 'Generate tax plan'}
              </EliteButton>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
