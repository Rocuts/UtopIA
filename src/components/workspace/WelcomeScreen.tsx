'use client';

import { motion, useReducedMotion } from 'motion/react';
import {
  Shield,
  TrendingUp,
  FileSearch,
  BarChart3,
  Sparkles,
  ArrowRight,
  Calculator,
  Globe,
  DollarSign,
  ClipboardCheck,
  GitCompareArrows,
  Lightbulb,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useLanguage } from '@/context/LanguageContext';
import type { CaseType } from '@/types/platform';

const SPRING = { stiffness: 400, damping: 25 };

interface EntryCard {
  id: CaseType;
  icon: React.ComponentType<{ className?: string }>;
  labelEs: string;
  labelEn: string;
  descEs: string;
  descEn: string;
  elite?: boolean;
}

const ENTRY_CARDS: EntryCard[] = [
  {
    id: 'dian_defense',
    icon: Shield,
    labelEs: 'Defensa DIAN',
    labelEn: 'DIAN Defense',
    descEs: 'Analice requerimientos, calcule sanciones y construya su estrategia de defensa con base en doctrina DIAN y E.T.',
    descEn: 'Analyze requirements, calculate sanctions and build your defense strategy based on DIAN doctrine.',
  },
  {
    id: 'tax_refund',
    icon: TrendingUp,
    labelEs: 'Devoluciones de Saldos a Favor',
    labelEn: 'Tax Refund Claims',
    descEs: 'Prepare expedientes tecnicos para IVA y renta con analisis de riesgo de verificacion incluido.',
    descEn: 'Prepare technical files for VAT and income tax with verification risk analysis included.',
  },
  {
    id: 'due_diligence',
    icon: FileSearch,
    labelEs: 'Due Diligence Financiero',
    labelEn: 'Financial Due Diligence',
    descEs: 'Diagnostico integral para credito, inversion o venta con indicadores NIIF y analisis de contingencias.',
    descEn: 'Comprehensive diagnosis for credit, investment or sale with NIIF indicators and contingency analysis.',
  },
  {
    id: 'financial_intel',
    icon: BarChart3,
    labelEs: 'Inteligencia Financiera',
    labelEn: 'Financial Intelligence',
    descEs: 'Flujo de caja, punto de equilibrio, valoracion DCF y simulaciones tributarias para decisiones estrategicas.',
    descEn: 'Cash flow, breakeven, DCF valuation and tax simulations for strategic decisions.',
  },
  {
    id: 'niif_report',
    icon: Sparkles,
    labelEs: 'Reporte NIIF Elite',
    labelEn: 'NIIF Elite Report',
    descEs: 'Reporte financiero corporativo completo: 3 agentes + 4 auditores + meta-auditoria IFRS 18. Excel profesional.',
    descEn: 'Complete corporate financial report: 3 agents + 4 auditors + IFRS 18 meta-audit. Professional Excel.',
    elite: true,
  },
  {
    id: 'tax_planning',
    icon: Calculator,
    labelEs: 'Planeacion Tributaria',
    labelEn: 'Tax Planning',
    descEs: 'Optimizacion fiscal integral: regimen SIMPLE vs ordinario, zonas francas, ZOMAC, dividendos, descuentos I+D+i (Art. 256 E.T.).',
    descEn: 'Comprehensive tax optimization: SIMPLE vs ordinary regime, free zones, ZOMAC, dividends, R&D discounts.',
  },
  {
    id: 'transfer_pricing',
    icon: Globe,
    labelEs: 'Precios de Transferencia',
    labelEn: 'Transfer Pricing',
    descEs: 'Documentacion comprobatoria, analisis de plena competencia y Formato 1125 DIAN (Arts. 260-1 a 260-11 E.T.).',
    descEn: 'Supporting documentation, arm\'s length analysis and DIAN Format 1125 (Arts. 260-1 to 260-11 E.T.).',
  },
  {
    id: 'business_valuation',
    icon: DollarSign,
    labelEs: 'Valoracion Empresarial',
    labelEn: 'Business Valuation',
    descEs: 'DCF con parametros colombianos (TES, EMBI, WACC), multiplos de mercado y activos netos ajustados NIIF 13.',
    descEn: 'DCF with Colombian parameters (TES, EMBI, WACC), market multiples and IFRS 13 adjusted net assets.',
  },
  {
    id: 'fiscal_audit_opinion',
    icon: ClipboardCheck,
    labelEs: 'Dictamen de Revisoria Fiscal',
    labelEn: 'Fiscal Audit Opinion',
    descEs: 'Opinion formal NIA 700: empresa en marcha, errores materiales, cumplimiento Ley 43/1990, carta de gerencia.',
    descEn: 'Formal NIA 700 opinion: going concern, material misstatement, Law 43/1990 compliance, management letter.',
  },
  {
    id: 'tax_reconciliation',
    icon: GitCompareArrows,
    labelEs: 'Conciliacion Fiscal',
    labelEn: 'Tax Reconciliation',
    descEs: 'Puente NIIF-fiscal, impuesto diferido NIC 12, Formato 2516 DIAN listo para transmision electronica.',
    descEn: 'IFRS-to-tax bridge, NIC 12 deferred tax, DIAN Format 2516 ready for electronic submission.',
  },
  {
    id: 'feasibility_study',
    icon: Lightbulb,
    labelEs: 'Estudio de Factibilidad',
    labelEn: 'Feasibility Study',
    descEs: 'Estudio de mercado, modelo financiero (VPN, TIR, WACC colombiano), analisis de riesgo e incentivos ZOMAC/ZF.',
    descEn: 'Market study, financial model (NPV, IRR, Colombian WACC), risk analysis and ZOMAC/FZ incentives.',
  },
];

export function WelcomeScreen() {
  const { language } = useLanguage();
  const { openIntakeForType } = useWorkspace();
  const prefersReduced = useReducedMotion();

  return (
    <div className="h-full overflow-y-auto styled-scrollbar">
      <div className="max-w-3xl mx-auto px-6 py-12 flex flex-col items-center">
        {/* Logo & Headline */}
        <motion.div
          initial={prefersReduced ? {} : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', ...SPRING }}
          className="text-center mb-10"
        >
          <div className="flex items-center justify-center gap-2.5 mb-4">
            <img
              src="/logo-modern.png"
              alt="UtopIA"
              className="w-10 h-10 rounded-lg object-cover invert hue-rotate-180"
            />
            <span className="text-2xl font-bold tracking-tight text-[#0a0a0a]">UtopIA.</span>
          </div>
          <h1 className="text-xl font-semibold text-[#0a0a0a] mb-2">
            {language === 'es' ? 'Seleccione un tipo de consulta para comenzar' : 'Select a consultation type to begin'}
          </h1>
          <p className="text-sm text-[#a3a3a3]">
            {language === 'es' ? 'Su firma contable, potenciada por inteligencia artificial' : 'Your accounting firm, powered by artificial intelligence'}
          </p>
        </motion.div>

        {/* Entry Cards */}
        <div className="w-full space-y-3">
          {ENTRY_CARDS.map((card, i) => {
            const Icon = card.icon;
            return (
              <motion.button
                key={card.id}
                initial={prefersReduced ? {} : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', ...SPRING, delay: prefersReduced ? 0 : 0.05 + i * 0.04 }}
                onClick={() => openIntakeForType(card.id)}
                className={cn(
                  'w-full text-left rounded-lg border p-5 flex items-start gap-4 transition-all group',
                  card.elite
                    ? 'bg-gradient-to-r from-[#FEF9EC] to-[#FDF0C4]/40 border-[#D4A017]/30 hover:border-[#D4A017] hover:shadow-[0_0_0_1px_#D4A017]'
                    : 'bg-white border-[#e5e5e5] hover:border-[#0a0a0a] hover:shadow-sm',
                )}
              >
                <div
                  className={cn(
                    'w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors',
                    card.elite
                      ? 'bg-[#D4A017]/10 text-[#D4A017]'
                      : 'bg-[#fafafa] border border-[#e5e5e5] text-[#525252] group-hover:bg-[#0a0a0a] group-hover:border-[#0a0a0a] group-hover:text-white',
                  )}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-sm font-semibold',
                      card.elite ? 'text-[#7D5B0C]' : 'text-[#0a0a0a]',
                    )}>
                      {language === 'es' ? card.labelEs : card.labelEn}
                    </span>
                    {card.elite && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#D4A017]/15 text-[#D4A017] uppercase tracking-wider">
                        NUEVO
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#737373] mt-1 leading-relaxed">
                    {language === 'es' ? card.descEs : card.descEn}
                  </p>
                </div>
                <ArrowRight className={cn(
                  'w-4 h-4 shrink-0 mt-1 transition-colors',
                  card.elite ? 'text-[#D4A017]/50 group-hover:text-[#D4A017]' : 'text-[#d4d4d4] group-hover:text-[#0a0a0a]',
                )} />
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
