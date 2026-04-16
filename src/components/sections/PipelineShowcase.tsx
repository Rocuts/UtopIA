'use client';

import { useRef } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import {
  FileSpreadsheet,
  CheckCircle,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

const SPRING = { stiffness: 400, damping: 25 };

const AGENTS = [
  { label: 'Analista NIIF', sub: 'Estados Financieros' },
  { label: 'Director Estrategia', sub: 'KPIs & Proyecciones' },
  { label: 'Gobierno Corp.', sub: 'Acta & Cumplimiento' },
];

const AUDITORS = [
  'Auditor NIIF',
  'Auditor Tributario',
  'Auditor Legal',
  'Revisoria Fiscal',
];

const OUTPUTS = [
  '4 Estados Financieros NIIF',
  'Dashboard 4 KPIs Estrategicos',
  'Flujo de Caja Proyectado (3 trim)',
  'Punto de Equilibrio Operativo',
  '13 Notas (NIC 1 \u00A7112-138)',
  'Acta de Asamblea (lista para firma)',
  'Opinion Formal tipo NIA 700',
  'Grade A+ a F (IASB + ISO 25012)',
  'Excel Profesional 5 pestanas',
  'Preparado para IFRS 18 (2027)',
];

export function PipelineShowcase() {
  const { language } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });
  const prefersReduced = useReducedMotion();

  return (
    <section
      ref={ref}
      className="py-20 px-6 border-t border-[#e5e5e5] bg-gradient-to-b from-[#FEF9EC]/30 to-white"
    >
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <motion.div
          initial={prefersReduced ? {} : { opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ type: 'spring', ...SPRING }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#D4A017]/10 text-[#D4A017] text-xs font-semibold mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            {language === 'es' ? 'EXCLUSIVO EN COLOMBIA' : 'EXCLUSIVE IN COLOMBIA'}
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-[#0a0a0a] mb-3">
            {language === 'es'
              ? 'Reporte Financiero de Nivel Corporativo'
              : 'Corporate-Grade Financial Report'}
          </h2>
          <p className="text-sm text-[#737373] max-w-2xl mx-auto">
            {language === 'es'
              ? 'El unico sistema en Colombia que combina 3 agentes NIIF + 4 auditores especializados + meta-auditoria IFRS 18 en un solo pipeline.'
              : 'The only system in Colombia that combines 3 NIIF agents + 4 specialized auditors + IFRS 18 meta-audit in a single pipeline.'}
          </p>
        </motion.div>

        {/* Pipeline Visualization */}
        <motion.div
          initial={prefersReduced ? {} : { opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ type: 'spring', ...SPRING, delay: prefersReduced ? 0 : 0.1 }}
          className="bg-white border border-[#e5e5e5] rounded-xl p-6 md:p-8 mb-8"
        >
          {/* Phase 1: Agents */}
          <div className="mb-6">
            <span className="text-[10px] font-bold text-[#a3a3a3] uppercase tracking-wider font-[family-name:var(--font-geist-mono)]">
              Fase 1 · Generacion Secuencial
            </span>
            <div className="flex items-center gap-2 mt-3 overflow-x-auto styled-scrollbar pb-2">
              {AGENTS.map((agent, i) => (
                <div key={i} className="flex items-center">
                  <motion.div
                    initial={prefersReduced ? {} : { opacity: 0, scale: 0.9 }}
                    animate={isInView ? { opacity: 1, scale: 1 } : {}}
                    transition={{ delay: prefersReduced ? 0 : 0.2 + i * 0.1 }}
                    className="rounded-lg border-2 border-[#D4A017]/30 bg-[#FEF9EC] px-4 py-3 min-w-[140px] text-center"
                  >
                    <p className="text-[10px] font-bold text-[#D4A017] font-[family-name:var(--font-geist-mono)] mb-0.5">
                      Agente {i + 1}
                    </p>
                    <p className="text-xs font-semibold text-[#7D5B0C]">{agent.label}</p>
                    <p className="text-[10px] text-[#a3a3a3]">{agent.sub}</p>
                  </motion.div>
                  {i < AGENTS.length - 1 && (
                    <ArrowRight className="w-4 h-4 text-[#d4d4d4] mx-1 shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Phase 2: Auditors */}
          <div className="mb-6">
            <span className="text-[10px] font-bold text-[#a3a3a3] uppercase tracking-wider font-[family-name:var(--font-geist-mono)]">
              Fase 2 · 4 Auditores en Paralelo
            </span>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {AUDITORS.map((auditor, i) => (
                <motion.div
                  key={i}
                  initial={prefersReduced ? {} : { opacity: 0, y: 8 }}
                  animate={isInView ? { opacity: 1, y: 0 } : {}}
                  transition={{ delay: prefersReduced ? 0 : 0.5 + i * 0.05 }}
                  className="rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-xs font-medium text-[#525252]"
                >
                  {auditor}
                </motion.div>
              ))}
            </div>
          </div>

          {/* Phase 3: Meta-Auditor */}
          <div>
            <span className="text-[10px] font-bold text-[#a3a3a3] uppercase tracking-wider font-[family-name:var(--font-geist-mono)]">
              Fase 3 · Meta-Auditoria de Calidad
            </span>
            <motion.div
              initial={prefersReduced ? {} : { opacity: 0, y: 8 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: prefersReduced ? 0 : 0.7 }}
              className="mt-3 rounded-lg border-2 border-[#059669]/30 bg-[#F0FDF4] px-4 py-3 inline-flex items-center gap-2"
            >
              <CheckCircle className="w-4 h-4 text-[#059669]" />
              <span className="text-xs font-semibold text-[#059669]">
                IASB \u00B7 IFRS 18 \u00B7 ISO 25012 \u00B7 ISO 42001 \u00B7 CTCP
              </span>
              <span className="text-sm font-bold text-[#059669] font-[family-name:var(--font-geist-mono)]">
                Grade A+
              </span>
            </motion.div>
          </div>
        </motion.div>

        {/* Output Grid */}
        <motion.div
          initial={prefersReduced ? {} : { opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ type: 'spring', ...SPRING, delay: prefersReduced ? 0 : 0.3 }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 mb-10"
        >
          {OUTPUTS.map((output, i) => (
            <div key={i} className="flex items-center gap-2 py-1.5">
              <CheckCircle className="w-3.5 h-3.5 text-[#D4A017] shrink-0" />
              <span className="text-sm text-[#525252]">{output}</span>
            </div>
          ))}
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={prefersReduced ? {} : { opacity: 0, y: 12 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: prefersReduced ? 0 : 0.5 }}
          className="text-center"
        >
          <a
            href="/workspace"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#D4A017] hover:bg-[#A87C10] text-white text-sm font-semibold transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4" />
            {language === 'es' ? 'Generar mi primer reporte' : 'Generate my first report'}
            <ArrowRight className="w-4 h-4" />
          </a>
        </motion.div>
      </div>
    </section>
  );
}
