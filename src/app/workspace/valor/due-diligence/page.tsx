'use client';

/**
 * /workspace/valor/due-diligence — Submódulo Due Diligence.
 *
 * Estructura:
 *  - Hero + descripción del servicio
 *  - Lista de checklist DD dividida en 5 categorías (financiera, legal,
 *    operativa, comercial, tributaria) con items ready / pending (mock)
 *  - Progreso visual agregado
 *  - CTA "Iniciar Due Diligence" → abre IntakeModal('due_diligence')
 *  - Secondary CTA: chat contextual DD
 */

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'motion/react';
import {
  FileSearch,
  CheckCircle2,
  Circle,
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  Shield,
  Gavel,
  Wrench,
  ShoppingBag,
  Receipt,
  MessageSquare,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cn } from '@/lib/utils';
import { EliteButton } from '@/components/ui/EliteButton';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EliteCard } from '@/components/ui/EliteCard';

// ─── Types ───────────────────────────────────────────────────────────────────

type CheckStatus = 'ready' | 'pending' | 'attention';

interface CheckItem {
  labelEs: string;
  labelEn: string;
  status: CheckStatus;
  /** Nota corta en ES */
  noteEs?: string;
  noteEn?: string;
}

interface CheckCategory {
  key: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  titleEs: string;
  titleEn: string;
  items: CheckItem[];
}

// ─── Checklist (mock) ────────────────────────────────────────────────────────

const CHECKLIST: CheckCategory[] = [
  {
    key: 'financial',
    icon: Shield,
    titleEs: 'Financiero',
    titleEn: 'Financial',
    items: [
      {
        labelEs: 'Balance General (NIIF plenas / PYMEs)',
        labelEn: 'Balance Sheet (full IFRS / IFRS for SMEs)',
        status: 'ready',
        noteEs: 'Cargado y validado',
        noteEn: 'Uploaded and validated',
      },
      {
        labelEs: 'Estado de Resultados',
        labelEn: 'Income Statement',
        status: 'ready',
      },
      {
        labelEs: 'Flujo de Caja Operativo',
        labelEn: 'Operating Cash Flow',
        status: 'ready',
      },
      {
        labelEs: 'Composición del patrimonio y cambios',
        labelEn: 'Equity composition and changes',
        status: 'attention',
        noteEs: 'Diferencia menor detectada',
        noteEn: 'Minor discrepancy detected',
      },
      {
        labelEs: 'Pasivos ocultos / contingencias',
        labelEn: 'Hidden liabilities / contingencies',
        status: 'pending',
      },
      {
        labelEs: 'Conciliaciones bancarias',
        labelEn: 'Bank reconciliations',
        status: 'ready',
      },
    ],
  },
  {
    key: 'legal',
    icon: Gavel,
    titleEs: 'Legal',
    titleEn: 'Legal',
    items: [
      {
        labelEs: 'Cámara de Comercio y certificado de existencia',
        labelEn: 'Chamber of Commerce registration',
        status: 'ready',
      },
      {
        labelEs: 'Demandas activas y pasadas (Rama Judicial)',
        labelEn: 'Active & past lawsuits (Judicial Branch)',
        status: 'pending',
      },
      {
        labelEs: 'Contratos críticos (clientes, proveedores, empleados)',
        labelEn: 'Critical contracts (clients, suppliers, employees)',
        status: 'attention',
        noteEs: '3 de 8 revisados',
        noteEn: '3 of 8 reviewed',
      },
      {
        labelEs: 'Licencias y permisos de operación',
        labelEn: 'Operating licenses and permits',
        status: 'ready',
      },
      {
        labelEs: 'Cláusulas change of control',
        labelEn: 'Change-of-control clauses',
        status: 'pending',
      },
    ],
  },
  {
    key: 'operational',
    icon: Wrench,
    titleEs: 'Operativo',
    titleEn: 'Operational',
    items: [
      {
        labelEs: 'Dependencia de clientes TOP 5',
        labelEn: 'TOP 5 client concentration',
        status: 'ready',
      },
      {
        labelEs: 'Infraestructura tecnológica y continuidad',
        labelEn: 'Tech infrastructure & continuity',
        status: 'attention',
      },
      {
        labelEs: 'Rotación y retención de talento clave',
        labelEn: 'Key talent turnover & retention',
        status: 'pending',
      },
    ],
  },
  {
    key: 'commercial',
    icon: ShoppingBag,
    titleEs: 'Comercial',
    titleEn: 'Commercial',
    items: [
      {
        labelEs: 'Pipeline comercial y churn rate',
        labelEn: 'Sales pipeline & churn rate',
        status: 'ready',
      },
      {
        labelEs: 'Market share y competidores directos',
        labelEn: 'Market share & direct competitors',
        status: 'pending',
      },
      {
        labelEs: 'Estructura de precios y márgenes por producto',
        labelEn: 'Pricing structure & product margins',
        status: 'ready',
      },
    ],
  },
  {
    key: 'tax',
    icon: Receipt,
    titleEs: 'Tributario',
    titleEn: 'Tax',
    items: [
      {
        labelEs: 'Adherencia a NIIF (NIC 12 impuesto diferido)',
        labelEn: 'IFRS compliance (IAS 12 deferred tax)',
        status: 'ready',
      },
      {
        labelEs: 'Declaraciones de renta últimos 4 años',
        labelEn: 'Income tax returns — last 4 years',
        status: 'ready',
      },
      {
        labelEs: 'Procesos ante DIAN (requerimientos, liquidaciones)',
        labelEn: 'DIAN proceedings (notices, assessments)',
        status: 'attention',
        noteEs: '1 requerimiento ordinario abierto',
        noteEn: '1 ordinary notice open',
      },
      {
        labelEs: 'Precios de transferencia (Art. 260-1 E.T.)',
        labelEn: 'Transfer pricing (Art. 260-1 Tax Statute)',
        status: 'pending',
      },
    ],
  },
];

// ─── Status visuals ──────────────────────────────────────────────────────────

const STATUS_ICON: Record<CheckStatus, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  ready: CheckCircle2,
  pending: Circle,
  attention: AlertTriangle,
};

const STATUS_COLOR: Record<CheckStatus, string> = {
  ready: 'text-success-light',
  pending: 'text-n-600',
  attention: 'text-gold-500',
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DueDiligencePage() {
  const { t, language } = useLanguage();
  const reduced = useReducedMotion();
  const router = useRouter();
  const { openIntakeForType, setActiveCaseType, setActiveMode, startNewConsultation } =
    useWorkspace();
  const valor = t.elite.areas.valor;

  const handleStartDD = useCallback(() => {
    openIntakeForType('due_diligence');
  }, [openIntakeForType]);

  const handleChatDD = useCallback(() => {
    setActiveCaseType('general_chat');
    setActiveMode('chat');
    startNewConsultation('due-diligence');
    router.push('/workspace');
  }, [router, setActiveCaseType, setActiveMode, startNewConsultation]);

  // Aggregate progress
  const stats = useMemo(() => {
    let ready = 0;
    let pending = 0;
    let attention = 0;
    let total = 0;
    for (const cat of CHECKLIST) {
      for (const item of cat.items) {
        total += 1;
        if (item.status === 'ready') ready += 1;
        else if (item.status === 'attention') attention += 1;
        else pending += 1;
      }
    }
    const pct = total === 0 ? 0 : Math.round((ready / total) * 100);
    return { ready, pending, attention, total, pct };
  }, []);

  const fade = (i: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.45, delay: 0.06 + i * 0.06, ease: [0.16, 1, 0.3, 1] as const },
        };

  return (
    <div
      className={cn(
        'relative w-full min-h-full overflow-y-auto',
        'bg-n-1000 text-n-100',
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute -top-[15%] -right-[10%] w-[520px] h-[520px] rounded-full blur-[130px] opacity-30"
          style={{
            background:
              'radial-gradient(circle, rgb(var(--color-gold-500-rgb) / 0.4) 0%, rgb(var(--color-gold-500-rgb) / 0) 70%)',
          }}
        />
      </div>

      <div className="relative z-[1] max-w-[1240px] mx-auto px-6 md:px-10 pt-8 pb-24">
        <motion.nav {...fade(0)} aria-label="breadcrumb" className="mb-6">
          <Link
            href="/workspace/valor"
            prefetch={false}
            className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-n-500 hover:text-gold-600 transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
            {language === 'es' ? 'Volver a El Valor' : 'Back to The Value'}
          </Link>
        </motion.nav>

        <motion.div {...fade(1)} className="mb-8">
          <SectionHeader
            eyebrow={language === 'es' ? 'II. Valor — Due Diligence' : 'II. Value — Due Diligence'}
            title={valor.submodules.dueDiligence.title}
            subtitle={language === 'es'
              ? 'Auditoría preventiva para inversión, fusión o venta — financiera, legal, operativa, comercial y tributaria.'
              : 'Preventive audit for investment, M&A or sale — financial, legal, operational, commercial and tax.'}
            align="left"
            accent="gold"
            divider
          />
        </motion.div>

        {/* Descripción */}
        <motion.div {...fade(2)} className="mb-10 max-w-3xl">
          <p className={cn(
            'font-serif-elite font-normal',
            'text-xl sm:text-xl leading-[1.6]',
            'text-n-300',
          )}>
            {language === 'es'
              ? 'Un due diligence riguroso revela el valor oculto y los riesgos antes de que se conviertan en sorpresas costosas. Cruzamos la contabilidad con los contratos, los procesos judiciales y las declaraciones fiscales para entregar un reporte que blinda la transacción.'
              : 'A rigorous due diligence surfaces hidden value and risks before they become costly surprises. We cross accounting with contracts, lawsuits and tax filings to deliver a report that shields the transaction.'}
          </p>
        </motion.div>

        {/* Progreso agregado */}
        <motion.section {...fade(3)} className="mb-10">
          <div className="relative overflow-hidden rounded-[16px] glass-elite-elevated border-elite-gold p-6 md:p-8">
            <div className="flex flex-col md:flex-row md:items-center gap-6">
              {/* Círculo de progreso */}
              <div className="relative shrink-0 w-[140px] h-[140px]">
                <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90">
                  <circle
                    cx="70"
                    cy="70"
                    r="60"
                    stroke="rgb(var(--color-gold-500-rgb) / 0.14)"
                    strokeWidth="10"
                    fill="none"
                  />
                  <motion.circle
                    cx="70"
                    cy="70"
                    r="60"
                    stroke="url(#dd-progress-gradient)"
                    strokeWidth="10"
                    strokeLinecap="round"
                    fill="none"
                    initial={reduced ? false : { strokeDasharray: '0 376.99' }}
                    animate={
                      reduced
                        ? { strokeDasharray: `${(stats.pct / 100) * 376.99} 376.99` }
                        : { strokeDasharray: `${(stats.pct / 100) * 376.99} 376.99` }
                    }
                    transition={reduced ? undefined : { duration: 1.1, ease: 'easeOut' }}
                  />
                  <defs>
                    <linearGradient id="dd-progress-gradient" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="var(--gold-500)" />
                      <stop offset="100%" stopColor="var(--gold-300)" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center rotate-0">
                  <span className="font-serif-elite text-4xl text-n-1000 tabular-nums leading-none">
                    {stats.pct}%
                  </span>
                  <span className="text-2xs uppercase tracking-eyebrow text-n-700 mt-1">
                    {language === 'es' ? 'Completado' : 'Complete'}
                  </span>
                </div>
              </div>

              {/* Stats */}
              <div className="flex-1 grid grid-cols-3 gap-4">
                <StatPill
                  label={language === 'es' ? 'Listos' : 'Ready'}
                  value={stats.ready}
                  tone="good"
                />
                <StatPill
                  label={language === 'es' ? 'Atención' : 'Attention'}
                  value={stats.attention}
                  tone="warn"
                />
                <StatPill
                  label={language === 'es' ? 'Pendientes' : 'Pending'}
                  value={stats.pending}
                  tone="neutral"
                />
              </div>

              {/* CTA primario */}
              <div className="shrink-0 flex flex-col gap-2">
                <EliteButton
                  type="button"
                  variant="primary"
                  size="lg"
                  onClick={handleStartDD}
                  rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={2} />}
                  glow
                >
                  {language === 'es' ? 'Iniciar Due Diligence' : 'Start Due Diligence'}
                </EliteButton>
                <p className="text-xs text-n-600 text-right">
                  {language === 'es' ? 'Flujo guiado con IA' : 'AI-guided flow'}
                </p>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Checklist por categorías */}
        <motion.section {...fade(4)} className="mb-10" aria-label={language === 'es' ? 'Checklist Due Diligence' : 'Due Diligence checklist'}>
          <h2 className="font-serif-elite text-2xl md:text-3xl text-n-100 mb-5">
            {language === 'es' ? 'Checklist estructurado' : 'Structured checklist'}
          </h2>
          <div className="grid gap-5 md:grid-cols-2">
            {CHECKLIST.map((cat, idx) => {
              const Icon = cat.icon;
              const catReady = cat.items.filter((i) => i.status === 'ready').length;
              const catTotal = cat.items.length;
              const catPct = Math.round((catReady / catTotal) * 100);

              return (
                <motion.div
                  key={cat.key}
                  initial={reduced ? false : { opacity: 0, y: 14 }}
                  animate={reduced ? {} : { opacity: 1, y: 0 }}
                  transition={
                    reduced
                      ? undefined
                      : {
                          duration: 0.45,
                          delay: 0.3 + idx * 0.06,
                          ease: [0.16, 1, 0.3, 1] as const,
                        }
                  }
                >
                  <EliteCard variant="glass" padding="md" className="h-full">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[rgb(var(--color-gold-500-rgb)_/_0.14)] text-gold-600"
                        >
                          <Icon className="h-5 w-5" strokeWidth={1.75} />
                        </span>
                        <div>
                          <h3 className="font-serif-elite text-xl text-n-1000 leading-tight">
                            {language === 'es' ? cat.titleEs : cat.titleEn}
                          </h3>
                          <p className="text-xs text-n-700 mt-0.5 tabular-nums">
                            {catReady} / {catTotal} ·{' '}
                            <span className="text-gold-600">{catPct}%</span>
                          </p>
                        </div>
                      </div>
                    </div>

                    <ul role="list" className="flex flex-col gap-2">
                      {cat.items.map((item) => {
                        const StatusIcon = STATUS_ICON[item.status];
                        return (
                          <li
                            key={item.labelEs}
                            className="flex items-start gap-2.5 text-sm leading-snug"
                          >
                            <StatusIcon
                              className={cn(
                                'h-4 w-4 mt-0.5 shrink-0',
                                STATUS_COLOR[item.status],
                              )}
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                            <div className="flex-1 min-w-0">
                              <p
                                className={cn(
                                  'text-n-300',
                                  item.status === 'pending' && 'text-n-500',
                                )}
                              >
                                {language === 'es' ? item.labelEs : item.labelEn}
                              </p>
                              {(item.noteEs || item.noteEn) && (
                                <p
                                  className={cn(
                                    'text-xs mt-0.5',
                                    item.status === 'attention'
                                      ? 'text-gold-500'
                                      : 'text-n-600',
                                  )}
                                >
                                  {language === 'es' ? item.noteEs : item.noteEn}
                                </p>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </EliteCard>
                </motion.div>
              );
            })}
          </div>
        </motion.section>

        {/* Secondary CTA — chat */}
        <motion.section {...fade(5)}>
          <div className="relative overflow-hidden rounded-[16px] glass-elite border border-[rgb(var(--color-gold-500-rgb)_/_0.2)] p-5 md:p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-start gap-3 flex-1">
                <span
                  aria-hidden="true"
                  className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-md bg-[rgb(var(--color-gold-500-rgb)_/_0.14)] text-gold-600"
                >
                  <MessageSquare className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div>
                  <h3 className="font-serif-elite text-lg text-n-1000 leading-tight">
                    {language === 'es'
                      ? '¿Preguntas puntuales sobre un hallazgo?'
                      : 'Specific questions about a finding?'}
                  </h3>
                  <p className="text-sm text-n-700 mt-1 max-w-xl">
                    {language === 'es'
                      ? 'Abra una consulta con el asistente DD y comparta contratos, balances o procesos para un análisis dirigido.'
                      : 'Open a conversation with the DD assistant and share contracts, balances or proceedings for a targeted analysis.'}
                  </p>
                </div>
              </div>
              <EliteButton
                type="button"
                variant="secondary"
                size="md"
                onClick={handleChatDD}
                rightIcon={<FileSearch className="h-4 w-4" strokeWidth={2} />}
              >
                {language === 'es' ? 'Abrir chat DD' : 'Open DD chat'}
              </EliteButton>
            </div>
          </div>
        </motion.section>
      </div>
    </div>
  );
}

// ─── Stat pill ───────────────────────────────────────────────────────────────

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'good' | 'warn' | 'neutral';
}) {
  const toneStyle =
    tone === 'good'
      ? 'bg-[rgba(34,197,94,0.1)] border-[rgba(34,197,94,0.3)] text-success-light'
      : tone === 'warn'
        ? 'bg-[rgba(234,179,8,0.1)] border-[rgba(234,179,8,0.3)] text-gold-500'
        : 'bg-[rgba(255,255,255,0.04)] border-[rgb(var(--color-gold-500-rgb)_/_0.18)] text-n-300';

  return (
    <div
      className={cn(
        'flex flex-col items-start gap-1 p-3 rounded-md border',
        toneStyle,
      )}
    >
      <span className="text-2xs uppercase tracking-eyebrow font-medium opacity-80">
        {label}
      </span>
      <span className="font-serif-elite text-3xl leading-none tabular-nums">
        {value}
      </span>
    </div>
  );
}
