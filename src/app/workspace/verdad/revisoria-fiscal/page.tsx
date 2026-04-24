'use client';

/**
 * Submódulo Revisoría Fiscal.
 *
 * - Hero con descripción fundamentada en NIA 700, Ley 43/1990, Art. 207-209 C.Co.,
 *   Ley 222/1995.
 * - Checklist de áreas auditadas.
 * - Previsualización del flujo de 4 auditores en paralelo (NIIF / Tax / Legal /
 *   Fiscal Reviewer) — referencia visual al endpoint `/api/financial-audit`.
 * - CTA "Generar Opinión del Revisor Fiscal" que dispara el flujo `fiscal_audit_opinion`
 *   via IntakeModal (llamando a `openIntakeForType`).
 * - Card de dictamen demo con estado "Con salvedades" para mostrar el layout final.
 *
 * NO llama al backend directamente desde aquí (los endpoints tienen SSE y requieren
 * un flujo de intake + streaming en chat). El CTA abre el IntakeModal existente.
 */

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import {
  ShieldCheck,
  CheckCircle2,
  Scale,
  Users,
  Briefcase,
  FileSearch,
  Gavel,
  ArrowLeft,
  ArrowRight,
  Sparkles,
  FileText,
  AlertTriangle,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { EliteCard } from '@/components/ui/EliteCard';
import { EliteButton } from '@/components/ui/EliteButton';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { cn } from '@/lib/utils';

// ─── Áreas auditadas ─────────────────────────────────────────────────────────

interface AuditedArea {
  label: { es: string; en: string };
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  norm: string;
}

const AUDITED_AREAS: AuditedArea[] = [
  {
    label: { es: 'NIIF / Contabilidad', en: 'IFRS / Accounting' },
    icon: FileSearch,
    norm: 'NIIF plenas · CTCP',
  },
  {
    label: { es: 'Tributario', en: 'Tax' },
    icon: Scale,
    norm: 'Estatuto Tributario · DIAN',
  },
  {
    label: { es: 'Laboral', en: 'Labor' },
    icon: Briefcase,
    norm: 'CST · Ley 50/1990',
  },
  {
    label: { es: 'Seguridad Social', en: 'Social Security' },
    icon: Users,
    norm: 'Ley 100/1993 · PILA',
  },
  {
    label: { es: 'Gobierno Corporativo', en: 'Corporate Governance' },
    icon: Gavel,
    norm: 'Ley 222/1995 · C.Co.',
  },
];

// ─── 4 auditores paralelos (preview) ─────────────────────────────────────────

interface AuditorStage {
  key: string;
  label: { es: string; en: string };
  norm: string;
  accent: 'gold' | 'wine';
}

const AUDITORS: AuditorStage[] = [
  {
    key: 'niif',
    label: { es: 'Auditor NIIF', en: 'IFRS Auditor' },
    norm: 'NIIF 1-17 · NIC 1-41',
    accent: 'gold',
  },
  {
    key: 'tax',
    label: { es: 'Auditor Tributario', en: 'Tax Auditor' },
    norm: 'ET · Decretos reglamentarios',
    accent: 'gold',
  },
  {
    key: 'legal',
    label: { es: 'Auditor Legal', en: 'Legal Auditor' },
    norm: 'C.Co. · Leyes 222/1995, 43/1990',
    accent: 'wine',
  },
  {
    key: 'fiscal',
    label: { es: 'Revisor Fiscal', en: 'Statutory Reviewer' },
    norm: 'NIA 700 · Dictamen formal',
    accent: 'wine',
  },
];

export default function RevisoriaFiscalPage() {
  const { language } = useLanguage();
  const { openIntakeForType } = useWorkspace();
  const shouldReduce = useReducedMotion();

  const launchOpinion = () => {
    openIntakeForType('fiscal_audit_opinion');
  };

  const launchAudit = () => {
    openIntakeForType('niif_report'); // NIIF + audit pipeline via intake
  };

  return (
    <div
      data-lenis-prevent
      className="min-h-full w-full overflow-y-auto bg-n-1000"
    >
      <div className="mx-auto w-full max-w-[1280px] px-5 md:px-8 py-8 md:py-12 flex flex-col gap-8">
        {/* Back link */}
        <Link
          href="/workspace/verdad"
          className="inline-flex items-center gap-2 text-xs uppercase tracking-eyebrow text-n-500 hover:text-gold-600 transition-colors w-fit"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          {language === 'es' ? 'Volver a La Verdad' : 'Back to The Truth'}
        </Link>

        {/* Hero */}
        <SectionHeader
          eyebrow={language === 'es' ? 'Aseguramiento · NIA 700' : 'Assurance · ISA 700'}
          title={language === 'es' ? 'Revisoría Fiscal' : 'Statutory Audit'}
          subtitle={
            language === 'es'
              ? 'Auditoría formal bajo NIA 700 y Ley 43 de 1990'
              : 'Formal audit under ISA 700 and Colombian Law 43 of 1990'
          }
          align="left"
          accent="gold"
          divider
        />

        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr,1fr] gap-6">
          {/* Descripción + marco normativo */}
          <EliteCard variant="glass" padding="lg">
            <EliteCard.Header>
              <span className="flex items-center gap-2">
                <ShieldCheck
                  className="w-4 h-4 text-gold-600"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <span className="font-serif-elite text-xl">
                  {language === 'es'
                    ? 'Responsabilidad del Revisor Fiscal'
                    : 'Statutory Auditor Responsibility'}
                </span>
              </span>
            </EliteCard.Header>
            <EliteCard.Body>
              <p className="text-base leading-relaxed text-n-800 mb-3">
                {language === 'es'
                  ? 'La Revisoría Fiscal es una institución de fe pública que emite dictamen sobre la razonabilidad de los estados financieros y el cumplimiento regulatorio. Su opinión tiene efectos legales y es requerida por socios, bancos, DIAN y entidades regulatorias.'
                  : 'The Statutory Audit (Revisoría Fiscal) is a public trust institution that issues an opinion on the reasonableness of financial statements and regulatory compliance. Its opinion has legal effects and is required by partners, banks, DIAN, and regulators.'}
              </p>
              <ul className="flex flex-col gap-2 text-sm text-n-800 mt-4">
                <li className="flex items-start gap-2">
                  <span className="text-gold-500 mt-1 text-xs">■</span>
                  <span>
                    <strong className="text-n-1000">
                      {language === 'es' ? 'NIA 700:' : 'ISA 700:'}
                    </strong>{' '}
                    {language === 'es'
                      ? 'Formación de la opinión y emisión del dictamen sobre estados financieros.'
                      : 'Forming an opinion and reporting on financial statements.'}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gold-500 mt-1 text-xs">■</span>
                  <span>
                    <strong className="text-n-1000">
                      {language === 'es' ? 'Ley 43/1990:' : 'Law 43/1990:'}
                    </strong>{' '}
                    {language === 'es'
                      ? 'Normativa del Contador Público en Colombia.'
                      : 'Regulations for Public Accountants in Colombia.'}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gold-500 mt-1 text-xs">■</span>
                  <span>
                    <strong className="text-n-1000">
                      {language === 'es' ? 'Art. 207-209 C.Co.:' : 'Art. 207-209 Code of Commerce:'}
                    </strong>{' '}
                    {language === 'es'
                      ? 'Funciones y facultades del Revisor Fiscal.'
                      : 'Functions and powers of the Statutory Auditor.'}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gold-500 mt-1 text-xs">■</span>
                  <span>
                    <strong className="text-n-1000">
                      {language === 'es' ? 'Ley 222/1995:' : 'Law 222/1995:'}
                    </strong>{' '}
                    {language === 'es'
                      ? 'Reformas al régimen de sociedades y gobierno corporativo.'
                      : 'Corporate governance reforms.'}
                  </span>
                </li>
              </ul>
            </EliteCard.Body>
          </EliteCard>

          {/* Checklist de áreas */}
          <EliteCard variant="glass" padding="lg">
            <EliteCard.Header>
              <span className="flex items-center gap-2">
                <CheckCircle2
                  className="w-4 h-4 text-success"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <span className="font-serif-elite text-xl">
                  {language === 'es' ? 'Áreas auditadas' : 'Audited areas'}
                </span>
              </span>
            </EliteCard.Header>
            <EliteCard.Body>
              <ul className="flex flex-col gap-3">
                {AUDITED_AREAS.map((a) => {
                  const Icon = a.icon;
                  return (
                    <li
                      key={a.label.es}
                      className="flex items-center gap-3 py-1.5"
                    >
                      <span
                        aria-hidden="true"
                        className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-md bg-[rgb(var(--color-gold-500-rgb)_/_0.10)] text-gold-600"
                      >
                        <Icon className="w-4 h-4" strokeWidth={1.75} />
                      </span>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium text-n-1000">
                          {language === 'es' ? a.label.es : a.label.en}
                        </span>
                        <span className="text-xs text-n-700 tracking-wide">
                          {a.norm}
                        </span>
                      </div>
                      <CheckCircle2
                        className="ml-auto w-4 h-4 text-success shrink-0"
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    </li>
                  );
                })}
              </ul>
            </EliteCard.Body>
          </EliteCard>
        </div>

        {/* 4 Auditores paralelos */}
        <EliteCard variant="glass" padding="lg">
          <EliteCard.Header>
            <span className="flex items-center gap-2">
              <Sparkles
                className="w-4 h-4 text-gold-600"
                strokeWidth={2}
                aria-hidden="true"
              />
              <span className="font-serif-elite text-xl">
                {language === 'es'
                  ? 'Pipeline de auditoría (4 agentes en paralelo)'
                  : 'Audit pipeline (4 parallel agents)'}
              </span>
            </span>
          </EliteCard.Header>
          <EliteCard.Body>
            <p className="text-sm text-n-800 font-light mb-5 max-w-3xl">
              {language === 'es'
                ? 'Cuatro auditores regulatorios trabajan de forma concurrente sobre el mismo reporte NIIF. Cada uno evalúa un dominio y emite hallazgos estructurados que luego se consolidan en el Compliance Score y en el dictamen del Revisor Fiscal.'
                : 'Four regulatory auditors work concurrently on the same IFRS report. Each evaluates one domain and emits structured findings that are consolidated into the Compliance Score and the Statutory Auditor opinion.'}
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {AUDITORS.map((a, idx) => (
                <motion.div
                  key={a.key}
                  initial={shouldReduce ? undefined : { opacity: 0, y: 10 }}
                  animate={shouldReduce ? undefined : { opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.08, duration: 0.4 }}
                  className={cn(
                    'relative p-4 rounded-md',
                    'border border-[rgb(var(--color-gold-500-rgb)_/_0.18)]',
                    'bg-[rgba(18,18,18,0.4)]',
                  )}
                >
                  <div
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs uppercase tracking-eyebrow font-medium mb-3',
                      a.accent === 'gold'
                        ? 'bg-[rgb(var(--color-gold-500-rgb)_/_0.12)] text-gold-600'
                        : 'bg-[rgba(114,47,55,0.18)] text-area-escudo',
                    )}
                  >
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{
                        backgroundColor: a.accent === 'gold' ? 'var(--gold-400)' : 'var(--color-wine-400)',
                      }}
                      aria-hidden="true"
                    />
                    {language === 'es' ? 'Auditor' : 'Auditor'}
                  </div>
                  <h4 className="font-serif-elite text-lg leading-tight text-n-1000 mb-1">
                    {language === 'es' ? a.label.es : a.label.en}
                  </h4>
                  <p className="text-xs text-n-700 tracking-wide">{a.norm}</p>
                </motion.div>
              ))}
            </div>
          </EliteCard.Body>
        </EliteCard>

        {/* Card de dictamen demo + CTAs */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,auto] gap-6">
          <EliteCard variant="glass" padding="lg">
            <EliteCard.Header>
              <span className="flex items-center gap-2">
                <FileText
                  className="w-4 h-4 text-gold-600"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <span className="font-serif-elite text-xl">
                  {language === 'es' ? 'Dictamen de ejemplo' : 'Sample opinion'}
                </span>
              </span>
            </EliteCard.Header>
            <EliteCard.Body>
              <div
                className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium mb-4"
                style={{ backgroundColor: 'rgba(234,179,8,0.14)', color: 'var(--gold-500)' }}
              >
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                {language === 'es' ? 'Opinión con salvedades' : 'Qualified opinion'}
              </div>

              <h4 className="font-serif-elite text-lg text-n-1000 mb-2">
                {language === 'es' ? 'Considerandos clave' : 'Key considerations'}
              </h4>
              <ul className="flex flex-col gap-2 text-sm text-n-800 mb-4">
                <li className="flex items-start gap-2">
                  <span className="text-gold-500 mt-1 text-xs">■</span>
                  <span>
                    {language === 'es'
                      ? 'Estados financieros presentan razonablemente la situación financiera en sus aspectos materiales.'
                      : 'Financial statements fairly present the financial position in all material aspects.'}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-warning mt-1 text-xs">■</span>
                  <span>
                    {language === 'es'
                      ? 'Salvedad: deterioro de cartera vencida > 180 días no reconocido según NIIF 9.5.5.'
                      : 'Qualification: impairment on AR > 180 days not recognized per IFRS 9.5.5.'}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gold-500 mt-1 text-xs">■</span>
                  <span>
                    {language === 'es'
                      ? 'Párrafo de énfasis: conciliación fiscal pendiente de ajuste en Formato 2516.'
                      : 'Emphasis of matter: tax reconciliation pending adjustment in Form 2516.'}
                  </span>
                </li>
              </ul>
              <p className="text-xs text-n-700 tracking-wide">
                {language === 'es'
                  ? 'Vista previa ilustrativa. El dictamen formal se genera a partir de sus documentos.'
                  : 'Illustrative preview. The formal opinion is generated from your documents.'}
              </p>
            </EliteCard.Body>
          </EliteCard>

          {/* CTAs laterales */}
          <EliteCard
            variant="glass"
            padding="lg"
            className="flex flex-col gap-3 justify-center min-w-[280px]"
          >
            <h4 className="font-serif-elite text-xl leading-tight text-n-1000">
              {language === 'es' ? 'Ejecutar' : 'Execute'}
            </h4>
            <p className="text-sm text-n-700 font-light mb-2">
              {language === 'es'
                ? 'Elija el flujo según la profundidad requerida.'
                : 'Pick the flow based on required depth.'}
            </p>
            <EliteButton
              variant="primary"
              size="lg"
              elevated
              onClick={launchOpinion}
              rightIcon={<ArrowRight className="w-4 h-4" />}
            >
              {language === 'es' ? 'Generar dictamen formal' : 'Generate formal opinion'}
            </EliteButton>
            <EliteButton
              variant="secondary"
              size="md"
              onClick={launchAudit}
              rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
            >
              {language === 'es' ? 'Auditoría NIIF completa' : 'Full IFRS audit'}
            </EliteButton>
          </EliteCard>
        </div>
      </div>
    </div>
  );
}
