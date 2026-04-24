'use client';

/**
 * WelcomeScreen — onboarding surface for first-time visitors inside the chat
 * flow (not the main `/workspace` dashboard — that one is ExecutiveDashboard).
 *
 * Re-themed to the dark token system so it doesn't ship a light-mode 2019-ish
 * relic while sitting inside the Elite shell. The category grid is now the
 * same compact-AreaCard visual language — one consistent design, not two.
 */
import { motion, useReducedMotion } from 'motion/react';
import {
  Shield,
  TrendingUp,
  FileSearch,
  BarChart3,
  Sparkles,
  Calculator,
  Globe,
  DollarSign,
  ClipboardCheck,
  GitCompareArrows,
  Lightbulb,
  ArrowRight,
  ChevronRight,
  MessageSquare,
  Plug,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useLanguage } from '@/context/LanguageContext';
import type { CaseType } from '@/types/platform';

const SPRING = { stiffness: 400, damping: 25 };

interface ServiceItem {
  id: CaseType;
  icon: React.ComponentType<{ className?: string }>;
  labelEs: string;
  labelEn: string;
  descEs: string;
  descEn: string;
}

interface ServiceCategory {
  roleEs: string;
  roleEn: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Tailwind accent key used to drive the category palette. */
  accent: 'escudo' | 'verdad' | 'futuro' | 'valor';
  items: ServiceItem[];
}

const CATEGORIES: ServiceCategory[] = [
  {
    roleEs: 'Tributarista',
    roleEn: 'Tax Specialist',
    icon: Shield,
    accent: 'escudo',
    items: [
      { id: 'dian_defense', icon: Shield, labelEs: 'Defensa DIAN', labelEn: 'DIAN Defense', descEs: 'Requerimientos y sanciones', descEn: 'Requirements & sanctions' },
      { id: 'tax_refund', icon: TrendingUp, labelEs: 'Devoluciones', labelEn: 'Tax Refunds', descEs: 'Saldos a favor IVA/Renta', descEn: 'IVA/Income refunds' },
      { id: 'tax_planning', icon: Calculator, labelEs: 'Planeación Tributaria', labelEn: 'Tax Planning', descEs: 'Optimización fiscal legal', descEn: 'Legal tax optimization' },
      { id: 'transfer_pricing', icon: Globe, labelEs: 'Precios Transferencia', labelEn: 'Transfer Pricing', descEs: 'Arts. 260-1 a 260-11 E.T.', descEn: 'Arts. 260-1 to 260-11 E.T.' },
    ],
  },
  {
    roleEs: 'Contador',
    roleEn: 'Accountant',
    icon: ClipboardCheck,
    accent: 'verdad',
    items: [
      { id: 'fiscal_audit_opinion', icon: ClipboardCheck, labelEs: 'Dictamen Rev. Fiscal', labelEn: 'Fiscal Audit Opinion', descEs: 'NIA 700, Ley 43/1990', descEn: 'NIA 700, Law 43/1990' },
      { id: 'tax_reconciliation', icon: GitCompareArrows, labelEs: 'Conciliación Fiscal', labelEn: 'Tax Reconciliation', descEs: 'NIIF-fiscal + NIC 12', descEn: 'IFRS-tax + IAS 12' },
    ],
  },
  {
    roleEs: 'Analista Financiero',
    roleEn: 'Financial Analyst',
    icon: BarChart3,
    accent: 'valor',
    items: [
      { id: 'financial_intel', icon: BarChart3, labelEs: 'Inteligencia Financiera', labelEn: 'Financial Intelligence', descEs: 'Flujo de caja, DCF, breakeven', descEn: 'Cash flow, DCF, breakeven' },
      { id: 'business_valuation', icon: DollarSign, labelEs: 'Valoración Empresarial', labelEn: 'Business Valuation', descEs: 'WACC, múltiplos, NIIF 13', descEn: 'WACC, multiples, IFRS 13' },
      { id: 'due_diligence', icon: FileSearch, labelEs: 'Due Diligence', labelEn: 'Due Diligence', descEs: 'Crédito, inversión, venta', descEn: 'Credit, investment, sale' },
    ],
  },
  {
    roleEs: 'Economista',
    roleEn: 'Economist',
    icon: Lightbulb,
    accent: 'futuro',
    items: [
      { id: 'feasibility_study', icon: Lightbulb, labelEs: 'Estudio Factibilidad', labelEn: 'Feasibility Study', descEs: 'VPN, TIR, riesgo', descEn: 'NPV, IRR, risk' },
    ],
  },
];

// Accent-class map kept local so we stay off styles like `bg-[${hex}]`.
const ACCENT_CLASSES: Record<ServiceCategory['accent'], {
  tint: string;
  text: string;
  border: string;
}> = {
  escudo: {
    tint: 'bg-area-escudo/10',
    text: 'text-area-escudo',
    border: 'border-area-escudo/30',
  },
  valor: {
    tint: 'bg-gold-500/10',
    text: 'text-gold-500',
    border: 'border-gold-500/30',
  },
  verdad: {
    tint: 'bg-area-verdad/10',
    text: 'text-area-verdad',
    border: 'border-area-verdad/30',
  },
  futuro: {
    tint: 'bg-area-futuro/10',
    text: 'text-area-futuro',
    border: 'border-area-futuro/30',
  },
};

export function WelcomeScreen() {
  const { language } = useLanguage();
  const { openIntakeForType, startNewConsultation, setActiveCaseType } = useWorkspace();
  const router = useRouter();
  const prefersReduced = useReducedMotion();
  const es = language === 'es';

  const fadeUp = (delay: number) => ({
    initial: prefersReduced ? {} : { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { type: 'spring' as const, ...SPRING, delay: prefersReduced ? 0 : delay },
  });

  return (
    <div className="h-full overflow-y-auto styled-scrollbar bg-n-0 text-n-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-5">
        <h1 className="sr-only">
          {es ? '1+1 — Directorio Ejecutivo Digital' : '1+1 — Digital Executive Board'}
        </h1>

        {/* Header */}
        <motion.div {...fadeUp(0)} className="flex items-center gap-2.5">
          <img src="/logo-modern.png" alt="1+1" className="w-8 h-8 rounded-lg object-cover" />
          <span className="text-lg font-serif-elite font-normal tracking-tight text-n-900">1+1</span>
          <span className="font-mono text-xs-mono text-n-500 ml-1 hidden sm:inline">
            {es ? 'Su firma contable, potenciada por IA' : 'Your accounting firm, powered by AI'}
          </span>
          <button
            type="button"
            onClick={() => router.push('/workspace/settings')}
            aria-label={es ? 'Conectar un ERP' : 'Connect an ERP'}
            className={cn(
              'ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md',
              'font-mono text-xs-mono font-medium text-n-600',
              'border border-n-200 hover:border-gold-500/40 hover:text-gold-500 transition-colors',
            )}
          >
            <Plug className="w-3.5 h-3.5" />
            {es ? 'Conectar ERP' : 'Connect ERP'}
          </button>
        </motion.div>

        {/* Top row: Chat General + NIIF Elite */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Chat General */}
          <motion.button
            {...fadeUp(0.04)}
            type="button"
            onClick={() => { setActiveCaseType('general_chat'); startNewConsultation('general'); }}
            className={cn(
              'rounded-xl border border-n-200 bg-n-50 p-5 text-left transition-all group',
              'hover:border-n-300 hover:shadow-e3',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/30',
            )}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-area-verdad/15 text-area-verdad flex items-center justify-center shrink-0">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-n-900">Chat General</span>
                <p className="text-xs text-n-500 mt-0.5">
                  {es ? 'Consultas libres sobre contabilidad, tributaria y NIIF' : 'Open queries on accounting, tax, and IFRS'}
                </p>
              </div>
              <ArrowRight className="w-4 h-4 text-n-400 group-hover:text-n-900 transition-colors shrink-0" />
            </div>
          </motion.button>

          {/* NIIF Elite */}
          <motion.button
            {...fadeUp(0.06)}
            type="button"
            onClick={() => openIntakeForType('niif_report')}
            className={cn(
              'rounded-xl border border-gold-500/30 bg-gold-500/8 p-5 text-left transition-all group',
              'hover:border-gold-500 hover:shadow-glow-gold-soft',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/30',
            )}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gold-500/15 text-gold-500 flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-n-900">Reporte NIIF Elite</span>
                  <span className="font-mono text-2xs font-bold px-1.5 py-0.5 rounded-xs bg-gold-500/15 text-gold-600 uppercase tracking-eyebrow">ELITE</span>
                </div>
                <p className="font-mono text-xs-mono text-gold-600 mt-0.5">
                  3 agentes + 4 auditores + meta-auditor
                </p>
              </div>
              <ArrowRight className="w-4 h-4 text-gold-500/50 group-hover:text-gold-500 transition-colors shrink-0" />
            </div>
          </motion.button>
        </div>

        {/* Category Grid — compact AreaCard language */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CATEGORIES.map((cat, catIdx) => {
            const CatIcon = cat.icon;
            const accent = ACCENT_CLASSES[cat.accent];
            return (
              <motion.div
                key={cat.roleEs}
                {...fadeUp(0.1 + catIdx * 0.04)}
                className={cn(
                  'rounded-xl border bg-n-50 overflow-hidden min-h-[120px]',
                  accent.border,
                )}
              >
                {/* Category header */}
                <div className="flex items-center gap-2.5 px-4 py-3 border-b border-n-200">
                  <div className={cn('w-7 h-7 rounded-md flex items-center justify-center shrink-0', accent.tint, accent.text)}>
                    <CatIcon className="w-3.5 h-3.5" />
                  </div>
                  <h2 className="font-mono text-xs-mono font-bold text-n-900 uppercase tracking-eyebrow">
                    {es ? cat.roleEs : cat.roleEn}
                  </h2>
                  <span className="font-mono text-xs-mono text-n-500 ml-auto tabular-nums">
                    {cat.items.length} {cat.items.length === 1 ? 'módulo' : 'módulos'}
                  </span>
                </div>

                {/* Items */}
                <div className="divide-y divide-n-200">
                  {cat.items.map(item => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => openIntakeForType(item.id)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-n-100 transition-colors group focus-visible:outline-none focus-visible:bg-n-100"
                      >
                        <Icon className="w-3.5 h-3.5 text-n-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium text-n-900">
                            {es ? item.labelEs : item.labelEn}
                          </span>
                          <span className="text-2xs text-n-500 ml-2">
                            {es ? item.descEs : item.descEn}
                          </span>
                        </div>
                        <ChevronRight className="w-3 h-3 text-n-300 group-hover:text-n-500 transition-colors shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
