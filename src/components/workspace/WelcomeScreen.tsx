'use client';

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
  color: string;
  items: ServiceItem[];
}

const CATEGORIES: ServiceCategory[] = [
  {
    roleEs: 'Tributarista',
    roleEn: 'Tax Specialist',
    icon: Shield,
    color: '#6366F1',
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
    color: '#0EA5E9',
    items: [
      { id: 'fiscal_audit_opinion', icon: ClipboardCheck, labelEs: 'Dictamen Rev. Fiscal', labelEn: 'Fiscal Audit Opinion', descEs: 'NIA 700, Ley 43/1990', descEn: 'NIA 700, Law 43/1990' },
      { id: 'tax_reconciliation', icon: GitCompareArrows, labelEs: 'Conciliación Fiscal', labelEn: 'Tax Reconciliation', descEs: 'NIIF-fiscal + NIC 12', descEn: 'IFRS-tax + IAS 12' },
    ],
  },
  {
    roleEs: 'Analista Financiero',
    roleEn: 'Financial Analyst',
    icon: BarChart3,
    color: '#10B981',
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
    color: '#F59E0B',
    items: [
      { id: 'feasibility_study', icon: Lightbulb, labelEs: 'Estudio Factibilidad', labelEn: 'Feasibility Study', descEs: 'VPN, TIR, riesgo', descEn: 'NPV, IRR, risk' },
    ],
  },
];

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
    <div className="h-full overflow-y-auto styled-scrollbar">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-5">
        <h1 className="sr-only">
          {es ? 'UtopIA — Consultoría Contable y Tributaria' : 'UtopIA — Accounting & Tax Consulting'}
        </h1>

        {/* Header */}
        <motion.div {...fadeUp(0)} className="flex items-center gap-2.5">
          <img src="/logo-modern.png" alt="UtopIA" className="w-8 h-8 rounded-lg object-cover invert hue-rotate-180" />
          <span className="text-lg font-bold tracking-tight text-[#0a0a0a]">UtopIA.</span>
          <span className="text-xs text-[#a3a3a3] ml-1 hidden sm:inline">
            {es ? 'Su firma contable, potenciada por IA' : 'Your accounting firm, powered by AI'}
          </span>
          <button
            onClick={() => router.push('/workspace/settings')}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-[#525252] border border-[#e5e5e5] hover:border-[#D4A017] hover:text-[#D4A017] transition-colors"
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
            className="rounded-xl border border-[#e5e5e5] bg-white p-5 text-left transition-all group hover:border-[#0a0a0a] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a0a0a]/20"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#0a0a0a] flex items-center justify-center shrink-0">
                <MessageSquare className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-[#0a0a0a]">Chat General</span>
                <p className="text-[11px] text-[#a3a3a3] mt-0.5">
                  {es ? 'Consultas libres sobre contabilidad, tributaria y NIIF' : 'Open queries on accounting, tax, and IFRS'}
                </p>
              </div>
              <ArrowRight className="w-4 h-4 text-[#d4d4d4] group-hover:text-[#0a0a0a] transition-colors shrink-0" />
            </div>
          </motion.button>

          {/* NIIF Elite */}
          <motion.button
            {...fadeUp(0.06)}
            type="button"
            onClick={() => openIntakeForType('niif_report')}
            className="rounded-xl border border-[#D4A017]/30 bg-gradient-to-r from-[#FEF9EC] to-[#FDF0C4]/40 p-5 text-left transition-all group hover:border-[#D4A017] hover:shadow-[0_0_12px_rgba(212,160,23,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A017]/30"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#D4A017]/15 flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 text-[#D4A017]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-[#7D5B0C]">Reporte NIIF Elite</span>
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#D4A017]/15 text-[#D4A017] uppercase tracking-wider">ELITE</span>
                </div>
                <p className="text-[10px] text-[#D4A017]/70 font-[family-name:var(--font-geist-mono)] mt-0.5">
                  3 agentes + 4 auditores + meta-auditor
                </p>
              </div>
              <ArrowRight className="w-4 h-4 text-[#D4A017]/40 group-hover:text-[#D4A017] transition-colors shrink-0" />
            </div>
          </motion.button>
        </div>

        {/* Category Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CATEGORIES.map((cat, catIdx) => {
            const CatIcon = cat.icon;
            return (
              <motion.div
                key={cat.roleEs}
                {...fadeUp(0.1 + catIdx * 0.04)}
                className="rounded-xl border border-[#e5e5e5] bg-white overflow-hidden"
              >
                {/* Category header */}
                <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#f5f5f5]">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${cat.color}12`, color: cat.color }}
                  >
                    <CatIcon className="w-3.5 h-3.5" />
                  </div>
                  <h2 className="text-xs font-bold text-[#0a0a0a] uppercase tracking-wide">
                    {es ? cat.roleEs : cat.roleEn}
                  </h2>
                  <span className="text-[10px] text-[#a3a3a3] font-[family-name:var(--font-geist-mono)] ml-auto">
                    {cat.items.length} {cat.items.length === 1 ? 'módulo' : 'módulos'}
                  </span>
                </div>

                {/* Items */}
                <div className="divide-y divide-[#f5f5f5]">
                  {cat.items.map(item => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => openIntakeForType(item.id)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#fafafa] transition-colors group focus-visible:outline-none focus-visible:bg-[#fafafa]"
                      >
                        <Icon className="w-3.5 h-3.5 text-[#a3a3a3] shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium text-[#0a0a0a]">
                            {es ? item.labelEs : item.labelEn}
                          </span>
                          <span className="text-[10px] text-[#a3a3a3] ml-2">
                            {es ? item.descEs : item.descEn}
                          </span>
                        </div>
                        <ChevronRight className="w-3 h-3 text-[#e5e5e5] group-hover:text-[#a3a3a3] transition-colors shrink-0" />
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
