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
  'Revisoría Fiscal',
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
      className="py-20 md:py-28 px-6 border-t border-n-200 bg-gradient-to-b from-gold-300/10 to-n-0"
    >
      <div className="max-w-[var(--content-width)] mx-auto">
        {/* Header */}
        <motion.div
          initial={prefersReduced ? {} : { opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ type: 'spring', ...SPRING }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gold-500/10 text-gold-500 text-xs font-semibold mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            {language === 'es' ? 'EXCLUSIVO EN COLOMBIA' : 'EXCLUSIVE IN COLOMBIA'}
          </div>
          <h2 className="font-serif-elite text-3xl md:text-4xl font-medium tracking-tight text-n-900 mb-3 leading-display"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 0, "WONK" 0' }}>
            {language === 'es'
              ? 'Reporte Financiero de Nivel Corporativo'
              : 'Corporate-Grade Financial Report'}
          </h2>
          <p className="text-sm text-n-500 max-w-2xl mx-auto">
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
          className="bg-n-0 border border-n-200 rounded-xl p-6 md:p-8 mb-8"
        >
          {/* Phase 1: Agents */}
          <div className="mb-6">
            <span className="text-xs font-bold text-n-400 uppercase tracking-eyebrow font-mono">
              Fase 1 · Generacion Secuencial
            </span>
            <div className="flex items-center gap-2 mt-3 overflow-x-auto styled-scrollbar pb-2">
              {AGENTS.map((agent, i) => (
                <div key={i} className="flex items-center">
                  <motion.div
                    initial={prefersReduced ? {} : { opacity: 0, scale: 0.9 }}
                    animate={isInView ? { opacity: 1, scale: 1 } : {}}
                    transition={{ delay: prefersReduced ? 0 : 0.2 + i * 0.1 }}
                    className="rounded-lg border-2 border-gold-500/30 bg-gold-300/10 px-4 py-3 min-w-[140px] text-center"
                  >
                    <p className="text-xs font-bold text-gold-500 font-mono mb-0.5">
                      Agente {i + 1}
                    </p>
                    <p className="text-xs font-semibold text-gold-700">{agent.label}</p>
                    <p className="text-xs text-n-400">{agent.sub}</p>
                  </motion.div>
                  {i < AGENTS.length - 1 && (
                    <ArrowRight className="w-4 h-4 text-n-300 mx-1 shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Phase 2: Auditors */}
          <div className="mb-6">
            <span className="text-xs font-bold text-n-400 uppercase tracking-eyebrow font-mono">
              Fase 2 · 4 Auditores en Paralelo
            </span>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {AUDITORS.map((auditor, i) => (
                <motion.div
                  key={i}
                  initial={prefersReduced ? {} : { opacity: 0, y: 8 }}
                  animate={isInView ? { opacity: 1, y: 0 } : {}}
                  transition={{ delay: prefersReduced ? 0 : 0.5 + i * 0.05 }}
                  className="rounded-lg border border-n-200 bg-n-50 px-3 py-2 text-xs font-medium text-n-600"
                >
                  {auditor}
                </motion.div>
              ))}
            </div>
          </div>

          {/* Phase 3: Meta-Auditor */}
          <div>
            <span className="text-xs font-bold text-n-400 uppercase tracking-eyebrow font-mono">
              Fase 3 · Meta-Auditoria de Calidad
            </span>
            <motion.div
              initial={prefersReduced ? {} : { opacity: 0, y: 8 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: prefersReduced ? 0 : 0.7 }}
              className="mt-3 rounded-lg border-2 border-success/30 bg-success/10 px-4 py-3 inline-flex items-center gap-2"
            >
              <CheckCircle className="w-4 h-4 text-success" />
              <span className="text-xs font-semibold text-success">
                IASB \u00B7 IFRS 18 \u00B7 ISO 25012 \u00B7 ISO 42001 \u00B7 CTCP
              </span>
              <span className="text-sm font-bold text-success font-mono">
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
              <CheckCircle className="w-3.5 h-3.5 text-gold-500 shrink-0" />
              <span className="text-sm text-n-600">{output}</span>
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
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-gold-500 hover:bg-gold-700 text-n-0 text-sm font-semibold transition-colors"
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
