'use client';

/**
 * /workspace/escudo/devoluciones — Submódulo Devoluciones (saldos a favor).
 *
 * Estado actual: no existe endpoint dedicado, por lo que el CTA redirige al
 * chat general con `caseType='tax_refund'` y contexto precargado (el
 * Specialist de Tax del orquestador conversacional atiende estas consultas).
 *
 * Alternativa: también se puede lanzar el IntakeModal con `tax_refund` que ya
 * está implementado para un flujo estructurado.
 */

import { useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'motion/react';
import {
  PiggyBank,
  ChevronLeft,
  Coins,
  ArrowUpRight,
  FileCheck2,
  Hourglass,
  MessageSquare,
  Sparkles,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cn } from '@/lib/utils';
import { EliteButton } from '@/components/ui/EliteButton';
import { EliteCard } from '@/components/ui/EliteCard';
import { SectionHeader } from '@/components/ui/SectionHeader';

export default function DevolucionesPage() {
  const { t, language } = useLanguage();
  const reduced = useReducedMotion();
  const router = useRouter();
  const {
    openIntakeForType,
    setActiveCaseType,
    setActiveMode,
    startNewConsultation,
  } = useWorkspace();

  const copy = t.elite.areas.escudo.submodules.devoluciones;

  const handleStructured = useCallback(() => {
    // Flujo estructurado con IntakeModal (ya existe TaxRefundIntake).
    openIntakeForType('tax_refund');
  }, [openIntakeForType]);

  const handleConversational = useCallback(() => {
    // Fallback conversacional en el chat general con contexto de refund.
    setActiveCaseType('tax_refund');
    setActiveMode('chat');
    startNewConsultation('tax-refund');
    router.push('/workspace');
  }, [router, setActiveCaseType, setActiveMode, startNewConsultation]);

  const steps =
    language === 'es'
      ? [
          {
            icon: FileCheck2,
            title: 'Diagnóstico del saldo',
            body: 'Identificamos saldos a favor recuperables en IVA, renta y retenciones. Verificamos causales, soportes y vigencia (Art. 850 E.T.).',
          },
          {
            icon: Coins,
            title: 'Ingeniería del expediente',
            body: 'Armamos el expediente técnico con pruebas documentales, cruces contables y el formulario DIAN correspondiente.',
          },
          {
            icon: Hourglass,
            title: 'Seguimiento del trámite',
            body: 'Monitoreo activo de plazos, respuestas a requerimientos, recursos y gestión hasta la resolución favorable.',
          },
        ]
      : [
          {
            icon: FileCheck2,
            title: 'Balance diagnosis',
            body: 'We identify recoverable favorable balances in VAT, income tax, and withholdings. Verify legal grounds, support, and statute (Art. 850 T.S.).',
          },
          {
            icon: Coins,
            title: 'File engineering',
            body: 'We assemble the technical file with documentary evidence, accounting cross-references, and the corresponding DIAN form.',
          },
          {
            icon: Hourglass,
            title: 'Process follow-up',
            body: 'Active monitoring of deadlines, responses to notices, appeals, and case management through to a favorable resolution.',
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
      className="relative w-full min-h-full overflow-y-auto bg-n-1000 text-n-100"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute top-[5%] right-[10%] w-[500px] h-[500px] rounded-full blur-[130px] opacity-25"
          style={{
            background:
              'radial-gradient(circle, rgb(var(--color-gold-500-rgb) / 0.35) 0%, rgb(var(--color-gold-500-rgb) / 0) 70%)',
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
            <PiggyBank className="h-7 w-7" strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
            <SectionHeader
              eyebrow={language === 'es' ? 'Saldos a Favor' : 'Favorable Balances'}
              title={copy.title}
              subtitle={copy.description}
              align="left"
              accent="gold"
            />
          </div>
        </motion.div>

        {/* Próximamente banner */}
        <motion.div
          {...fadeItem(2)}
          className="mb-10 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[rgb(var(--color-gold-500-rgb)_/_0.1)] border border-[rgb(var(--color-gold-500-rgb)_/_0.3)] text-xs text-gold-600"
        >
          <Sparkles className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
          {language === 'es'
            ? 'Fase Beta — atendido por el asistente conversacional'
            : 'Beta phase — handled by the conversational assistant'}
        </motion.div>

        {/* Narrativa */}
        <motion.div
          {...fadeItem(3)}
          className="max-w-3xl space-y-5 text-md leading-relaxed text-n-300 mb-12"
        >
          <p>
            {language === 'es'
              ? 'Muchas empresas colombianas dejan pasar saldos a favor por desconocimiento, temor a la fiscalización o por no contar con el soporte técnico adecuado. En realidad, cada peso reclamable es caja dormida — y la DIAN está obligada a devolverla si el expediente es sólido.'
              : 'Many Colombian companies leave favorable balances unclaimed due to lack of awareness, fear of audits, or insufficient technical backing. In reality, every claimable peso is dormant cash — and DIAN is obligated to refund it if the file is solid.'}
          </p>
          <p>
            {language === 'es'
              ? 'Nuestro módulo de Devoluciones detecta saldos recuperables en IVA (Arts. 481 y 815 E.T.), renta (Art. 850 E.T.) y retenciones, arma el expediente técnico con soportes verificables, y lo prepara en el formato exacto del aplicativo DIAN. Si el trámite se complica, la IA asiste en cada recurso.'
              : 'Our Refunds module detects recoverable balances in VAT (Arts. 481 and 815 T.S.), income tax (Art. 850 T.S.) and withholdings, assembles the technical file with verifiable support, and formats it for DIANʼs filing system. If the process escalates, the AI assists with every appeal.'}
          </p>
          <p>
            {language === 'es'
              ? 'Estamos terminando el pipeline dedicado (similar a Planeación y TP). Mientras tanto, puede iniciar un caso estructurado con el intake o una consulta conversacional directa con nuestro asistente tributario.'
              : 'We are finalizing the dedicated pipeline (similar to Planning and TP). In the meantime, you can open a structured case through the intake or a direct conversation with our tax assistant.'}
          </p>
        </motion.div>

        {/* Steps */}
        <motion.div {...fadeItem(4)} className="grid gap-4 md:grid-cols-3 mb-12">
          {steps.map((step) => (
            <EliteCard key={step.title} variant="glass" padding="md" hover="none">
              <div className="flex flex-col gap-3">
                <span
                  aria-hidden="true"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[rgb(var(--color-gold-500-rgb)_/_0.14)] text-gold-600"
                >
                  <step.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <h3 className="font-serif-elite text-lg leading-tight font-normal text-n-100">
                  {step.title}
                </h3>
                <p className="text-sm leading-relaxed text-n-500">{step.body}</p>
              </div>
            </EliteCard>
          ))}
        </motion.div>

        {/* CTAs dobles */}
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
                'radial-gradient(circle, rgb(var(--color-gold-500-rgb) / 0.4) 0%, rgb(var(--color-gold-500-rgb) / 0) 70%)',
            }}
          />
          <div className="relative z-[1] flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="flex items-start gap-3 md:max-w-xl">
              <span
                aria-hidden="true"
                className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-md bg-[rgb(var(--color-gold-500-rgb)_/_0.16)] text-gold-600"
              >
                <ArrowUpRight className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <div>
                <h3 className="font-serif-elite text-xl leading-tight text-n-100 mb-1.5">
                  {language === 'es'
                    ? 'Recupere sus saldos a favor'
                    : 'Recover your favorable balances'}
                </h3>
                <p className="text-sm leading-relaxed text-n-500">
                  {language === 'es'
                    ? 'Estructurado (intake de 2 min) o conversacional. En ambos casos recibe diagnóstico y expediente listo.'
                    : 'Structured (2-min intake) or conversational. Either way you receive a diagnosis and a ready-to-file package.'}
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch gap-3 shrink-0">
              <EliteButton
                variant="secondary"
                size="md"
                onClick={handleConversational}
                leftIcon={<MessageSquare className="h-4 w-4" strokeWidth={2} />}
              >
                {language === 'es' ? 'Consulta con IA' : 'Ask the AI'}
              </EliteButton>
              <EliteButton
                variant="primary"
                size="lg"
                onClick={handleStructured}
                rightIcon={<ArrowUpRight className="h-4 w-4" strokeWidth={2} />}
                glow
              >
                {language === 'es' ? 'Iniciar devolución' : 'Start a refund'}
              </EliteButton>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
