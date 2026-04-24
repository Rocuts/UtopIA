'use client';

/**
 * /workspace/escudo/defensa-dian — Submódulo Defensa DIAN.
 *
 * Portada de producto + CTA que abre el `IntakeModal` con `caseType='dian_defense'`.
 * Sidebar derecho con tips del experto y artículos destacados del E.T. 2026.
 *
 * Integra con el flujo existente via `openIntakeForType` del WorkspaceContext —
 * el modal renderiza `<DianDefenseIntake />` y al completar redirige al
 * ChatWorkspace con el contexto del caso.
 */

import { useCallback } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import {
  Shield,
  ChevronLeft,
  ShieldCheck,
  ScrollText,
  Scale,
  AlertOctagon,
  Search,
  FileText,
  Gavel,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cn } from '@/lib/utils';
import { EliteButton } from '@/components/ui/EliteButton';
import { EliteCard } from '@/components/ui/EliteCard';
import { SectionHeader } from '@/components/ui/SectionHeader';

export default function DefensaDianPage() {
  const { t, language } = useLanguage();
  const reduced = useReducedMotion();
  const { openIntakeForType } = useWorkspace();

  const copy = t.elite.areas.escudo.submodules.defensaDian;

  const handleStart = useCallback(() => {
    openIntakeForType('dian_defense');
  }, [openIntakeForType]);

  const capabilities =
    language === 'es'
      ? [
          {
            icon: Search,
            title: 'Detección automática de fallas',
            body: 'Análisis inmediato del requerimiento: identificamos defectos de forma, caducidad, prescripción y errores de procedimiento que debilitan la posición de la DIAN.',
          },
          {
            icon: FileText,
            title: 'Armado técnico de respuesta',
            body: 'Construcción estructurada de la respuesta con marco normativo (E.T. 2026), doctrina DIAN y jurisprudencia aplicable, optimizada para reducir sanciones.',
          },
          {
            icon: Gavel,
            title: 'Estrategia jurisprudencial',
            body: 'Cruce automático con sentencias del Consejo de Estado y conceptos DIAN recientes. El sistema sugiere los precedentes más fuertes para cada alegato.',
          },
        ]
      : [
          {
            icon: Search,
            title: 'Automated weakness detection',
            body: 'Instant analysis of the notice: we identify procedural defects, statute of limitations, and administrative errors that weaken DIANʼs position.',
          },
          {
            icon: FileText,
            title: 'Technical response drafting',
            body: 'Structured response construction with regulatory framework (Tax Statute 2026), DIAN doctrine, and applicable case law, optimized to reduce penalties.',
          },
          {
            icon: Gavel,
            title: 'Case-law strategy',
            body: 'Automatic cross-reference with Council of State rulings and recent DIAN concepts. The system surfaces the strongest precedents for each argument.',
          },
        ];

  const articles =
    language === 'es'
      ? [
          {
            code: 'Art. 641 E.T.',
            title: 'Extemporaneidad',
            summary: 'Sanción por presentar declaración fuera de plazo. 5% mensual, tope 100%.',
          },
          {
            code: 'Art. 647 E.T.',
            title: 'Inexactitud',
            summary: '100% de la diferencia entre el saldo a pagar correcto y el declarado.',
          },
          {
            code: 'Art. 651 E.T.',
            title: 'No enviar información',
            summary: 'Hasta 15.000 UVT. Gradualidad por entrega tardía o incorrecta.',
          },
          {
            code: 'Art. 744 E.T.',
            title: 'Requerimiento ordinario',
            summary: 'Plazo de respuesta: 15 días hábiles. Silencio = aceptación.',
          },
        ]
      : [
          {
            code: 'Art. 641 T.S.',
            title: 'Late filing',
            summary: 'Penalty for filing a late return. 5% per month, capped at 100%.',
          },
          {
            code: 'Art. 647 T.S.',
            title: 'Inaccuracy',
            summary: '100% of the difference between the correct tax payable and the declared one.',
          },
          {
            code: 'Art. 651 T.S.',
            title: 'Failure to report',
            summary: 'Up to 15,000 UVT. Graduated penalty for late or incorrect submission.',
          },
          {
            code: 'Art. 744 T.S.',
            title: 'Ordinary notice',
            summary: 'Response window: 15 business days. Silence implies acceptance.',
          },
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
      data-theme="elite"
      className="relative w-full min-h-full overflow-y-auto bg-[#030303] text-[#F5F5F5]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute -top-[15%] left-[15%] w-[500px] h-[500px] rounded-full blur-[120px] opacity-25"
          style={{
            background: 'radial-gradient(circle, rgba(114,47,55,0.4) 0%, rgba(114,47,55,0) 70%)',
          }}
        />
      </div>

      <div className="relative z-[1] max-w-[1240px] mx-auto px-6 md:px-10 pt-6 pb-24">
        {/* Breadcrumb */}
        <motion.div {...fadeItem(0)} className="mb-6">
          <Link
            href="/workspace/escudo"
            prefetch={false}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wider text-[#A8A8A8] hover:text-[#D4A017] transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            {language === 'es' ? 'El Escudo' : 'The Shield'}
          </Link>
        </motion.div>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* Columna principal */}
          <div className="min-w-0">
            {/* Hero */}
            <motion.div {...fadeItem(1)} className="mb-10 flex items-start gap-5">
              <div
                aria-hidden="true"
                className="shrink-0 inline-flex h-14 w-14 items-center justify-center rounded-[14px] bg-[rgba(114,47,55,0.18)] text-[#C46A76] glow-wine"
              >
                <Shield className="h-7 w-7" strokeWidth={1.75} />
              </div>
              <div className="flex-1 min-w-0">
                <SectionHeader
                  eyebrow={language === 'es' ? 'Defensa Contenciosa' : 'Litigation Defense'}
                  title={copy.title}
                  subtitle={copy.description}
                  align="left"
                  accent="wine"
                />
              </div>
            </motion.div>

            {/* Narrativa larga */}
            <motion.div
              {...fadeItem(2)}
              className="prose prose-invert max-w-none mb-10 space-y-5 text-[15px] leading-relaxed text-[#D4D4D4]"
            >
              <p>
                {language === 'es'
                  ? 'Un requerimiento DIAN no es una sentencia. Es una oportunidad — si se responde con precisión técnica y en el plazo exacto. Nuestro motor de Defensa DIAN convierte cada acto administrativo en una batalla estructurada: analizamos el expediente, identificamos las vulnerabilidades procesales y construimos la respuesta más sólida posible.'
                  : 'A DIAN notice is not a verdict. It is an opportunity — if it is answered with technical precision and within the exact deadline. Our DIAN Defense engine turns every administrative act into a structured battle: we analyze the file, identify procedural vulnerabilities, and build the strongest possible response.'}
              </p>
              <p>
                {language === 'es'
                  ? 'El sistema cruza automáticamente el Estatuto Tributario vigente, la doctrina DIAN aplicable y la jurisprudencia reciente del Consejo de Estado para detectar argumentos que normalmente pasan desapercibidos: caducidades no invocadas, cargas probatorias mal asignadas, interpretaciones jurisprudenciales favorables y precedentes que refuerzan la posición del contribuyente.'
                  : 'The system automatically cross-references the current Tax Statute, applicable DIAN doctrine, and recent Council of State rulings to surface arguments that normally go unnoticed: unclaimed statutes of limitations, misallocated burdens of proof, favorable judicial interpretations, and precedents that strengthen the taxpayerʼs position.'}
              </p>
              <p>
                {language === 'es'
                  ? 'El resultado es un borrador técnico profesional: estructurado bajo los estándares de la jurisdicción contenciosa, con citas verificables, cálculo de sanciones, y una estrategia de defensa escalonada — administrativa primero, contenciosa si es necesaria. Usted revisa, ajusta y firma. El tiempo que antes tomaba semanas, ahora se resuelve en horas.'
                  : 'The output is a professional technical draft: structured under contentious-jurisdiction standards, with verifiable citations, penalty calculations, and a layered defense strategy — administrative first, litigation if necessary. You review, adjust, and sign. What used to take weeks now resolves in hours.'}
              </p>
            </motion.div>

            {/* Capabilities grid */}
            <motion.div {...fadeItem(3)} className="grid gap-4 md:grid-cols-3 mb-10">
              {capabilities.map((cap) => (
                <EliteCard key={cap.title} variant="glass" padding="md" hover="none">
                  <div className="flex flex-col gap-3">
                    <span
                      aria-hidden="true"
                      className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-[rgba(212,160,23,0.14)] text-[#E8B42C]"
                    >
                      <cap.icon className="h-5 w-5" strokeWidth={1.75} />
                    </span>
                    <h3 className="font-serif-elite text-[18px] leading-tight font-normal text-[#F5F5F5]">
                      {cap.title}
                    </h3>
                    <p className="text-[13px] leading-relaxed text-[#A8A8A8]">{cap.body}</p>
                  </div>
                </EliteCard>
              ))}
            </motion.div>

            {/* CTA */}
            <motion.div
              {...fadeItem(4)}
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
                    'radial-gradient(circle, rgba(114,47,55,0.4) 0%, rgba(114,47,55,0) 70%)',
                }}
              />
              <div className="relative z-[1] flex flex-col md:flex-row md:items-center md:justify-between gap-5">
                <div className="flex items-start gap-3 md:max-w-xl">
                  <span
                    aria-hidden="true"
                    className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-[rgba(114,47,55,0.2)] text-[#C46A76]"
                  >
                    <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <div>
                    <h3 className="font-serif-elite text-[22px] leading-tight text-[#F5F5F5] mb-1.5">
                      {language === 'es'
                        ? 'Inicie un caso de defensa DIAN'
                        : 'Open a DIAN defense case'}
                    </h3>
                    <p className="text-[13px] leading-relaxed text-[#A8A8A8]">
                      {language === 'es'
                        ? 'Cargue el requerimiento, indique el plazo y el tributo. El motor preparará el primer borrador en minutos.'
                        : 'Upload the notice, indicate the deadline and tax type. The engine prepares the first draft in minutes.'}
                    </p>
                  </div>
                </div>
                <EliteButton
                  variant="wine"
                  size="lg"
                  onClick={handleStart}
                  rightIcon={<ShieldCheck className="h-4 w-4" strokeWidth={2} />}
                  glow
                >
                  {language === 'es' ? 'Iniciar caso de defensa' : 'Start defense case'}
                </EliteButton>
              </div>
            </motion.div>
          </div>

          {/* Sidebar derecho — tips del experto */}
          <aside className="lg:sticky lg:top-6 self-start space-y-5">
            <motion.div {...fadeItem(5)}>
              <EliteCard variant="bordered" padding="md" hover="none">
                <div className="flex items-center gap-2 mb-4">
                  <Scale className="h-4 w-4 text-[#D4A017]" strokeWidth={2} aria-hidden="true" />
                  <span className="uppercase tracking-[0.18em] text-[11px] font-medium text-[#D4A017]">
                    {language === 'es' ? 'Tips del experto' : 'Expert tips'}
                  </span>
                </div>
                <ul role="list" className="space-y-3 text-[13px] leading-relaxed text-[#D4D4D4]">
                  <li className="flex gap-2">
                    <span
                      aria-hidden="true"
                      className="shrink-0 mt-1.5 h-1 w-1 rounded-full bg-[#D4A017]"
                    />
                    <span>
                      {language === 'es'
                        ? 'Nunca responda sin verificar la caducidad del acto (Art. 714 E.T.).'
                        : 'Never respond without checking the statute of limitations (Art. 714 T.S.).'}
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span
                      aria-hidden="true"
                      className="shrink-0 mt-1.5 h-1 w-1 rounded-full bg-[#D4A017]"
                    />
                    <span>
                      {language === 'es'
                        ? 'Toda argumentación se refuerza con doctrina DIAN y precedente del C. de E.'
                        : 'Every argument is stronger when backed by DIAN doctrine and Council of State precedent.'}
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span
                      aria-hidden="true"
                      className="shrink-0 mt-1.5 h-1 w-1 rounded-full bg-[#D4A017]"
                    />
                    <span>
                      {language === 'es'
                        ? 'Si el requerimiento omite la motivación, pídala por derecho de petición.'
                        : 'If the notice lacks reasoning, request it via right of petition.'}
                    </span>
                  </li>
                </ul>
              </EliteCard>
            </motion.div>

            <motion.div {...fadeItem(6)}>
              <EliteCard variant="glass" padding="md" hover="none">
                <div className="flex items-center gap-2 mb-4">
                  <ScrollText
                    className="h-4 w-4 text-[#C46A76]"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  <span className="uppercase tracking-[0.18em] text-[11px] font-medium text-[#C46A76]">
                    {language === 'es'
                      ? 'Artículos destacados'
                      : 'Key articles'}
                  </span>
                </div>
                <ul role="list" className="space-y-3">
                  {articles.map((a) => (
                    <li key={a.code} className="flex flex-col gap-0.5">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#D4A017] tabular-nums">
                          {a.code}
                        </span>
                        <span className="text-[12px] font-medium text-[#F5F5F5]">
                          {a.title}
                        </span>
                      </div>
                      <p className="text-[12px] text-[#A8A8A8] leading-snug">{a.summary}</p>
                    </li>
                  ))}
                </ul>
              </EliteCard>
            </motion.div>

            <motion.div {...fadeItem(7)}>
              <EliteCard variant="glass" padding="md" hover="none">
                <div className="flex items-center gap-2 mb-3">
                  <AlertOctagon
                    className="h-4 w-4 text-[#EAB308]"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  <span className="uppercase tracking-[0.18em] text-[11px] font-medium text-[#EAB308]">
                    {language === 'es' ? 'Plazos críticos' : 'Critical deadlines'}
                  </span>
                </div>
                <p className="text-[12px] leading-relaxed text-[#A8A8A8]">
                  {language === 'es'
                    ? 'Requerimiento ordinario: 15 días hábiles. Especial: 3 meses. Liquidación oficial: recurso de reconsideración 2 meses.'
                    : 'Ordinary notice: 15 business days. Special: 3 months. Official assessment: reconsideration appeal within 2 months.'}
                </p>
              </EliteCard>
            </motion.div>
          </aside>
        </div>
      </div>
    </div>
  );
}
