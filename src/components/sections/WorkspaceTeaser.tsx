'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Shield,
  TrendingUp,
  FileSearch,
  BarChart3,
  MessageSquare,
  PanelLeft,
  PanelRight,
} from 'lucide-react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { useLanguage } from '@/context/LanguageContext';

const NOVA_SPRING = { stiffness: 400, damping: 25 };

export function WorkspaceTeaser() {
  const { language, t } = useLanguage();
  const wt = t.workspace;

  return (
    <section id="ai-consult" className="py-20 md:py-28 relative container mx-auto px-4 sm:px-6 lg:px-8 max-w-[var(--content-width)]">
      <div className="text-center mb-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ type: 'spring', ...NOVA_SPRING }}
        >
          <span className="inline-flex items-center gap-2 text-xs tracking-eyebrow uppercase text-n-400 font-medium">
            <span className="h-px w-5 bg-n-300" aria-hidden="true" />
            {language === 'es' ? 'Workspace Profesional' : 'Professional Workspace'}
            <span className="h-px w-5 bg-n-300" aria-hidden="true" />
          </span>
        </motion.div>
        <motion.h2
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ type: 'spring', ...NOVA_SPRING, delay: 0.05 }}
          className="font-serif-elite text-4xl md:text-5xl font-medium tracking-tight mb-4 text-n-900 leading-display"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 0, "WONK" 0' }}
        >
          {t.chat.title}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ type: 'spring', ...NOVA_SPRING, delay: 0.1 }}
          className="text-lg text-n-600 mb-2"
        >
          {wt.workspaceTeaser}
        </motion.p>
      </div>

      {/* Workspace Preview Mockup */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ type: 'spring', ...NOVA_SPRING, delay: 0.15 }}
        className="mb-8"
      >
        <GlassPanel className="overflow-hidden">
          {/* Mock Status Bar */}
          <div className="h-10 border-b border-n-200 flex items-center px-4 gap-3 bg-n-0">
            <div className="w-1.5 h-1.5 rounded-full bg-n-900" />
            <span className="text-xs font-bold text-n-900">1+1</span>
            <div className="h-3 w-px bg-n-200" />
            <span className="text-xs text-n-400 font-mono">
              {language === 'es' ? 'Defensa DIAN' : 'DIAN Defense'}
            </span>
            <div className="flex-1" />
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-success" />
              <span className="text-xs text-n-400 font-mono">BAJO</span>
            </div>
          </div>

          {/* Mock Three-Panel Layout */}
          <div className="flex h-[320px] sm:h-[380px]">
            {/* Mock Sidebar */}
            <div className="w-[180px] border-r border-n-200 bg-n-0 hidden sm:flex flex-col">
              <div className="p-3">
                <div className="w-full h-7 rounded-sm bg-gold-500 flex items-center justify-center gap-1.5">
                  <span className="text-xs text-white font-medium">
                    {wt.newConsultation}
                  </span>
                </div>
              </div>
              <div className="px-3 py-1">
                <div className="w-full h-6 rounded-sm bg-n-50 border border-n-200" />
              </div>
              <div className="flex-1 px-3 py-2 space-y-1">
                {[
                  { icon: Shield, label: 'Req. DIAN #142', color: '#eab308' },
                  { icon: TrendingUp, label: 'Saldo IVA Q3', color: '#22c55e' },
                  { icon: FileSearch, label: 'DD Acme Corp', color: '#f97316' },
                ].map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-n-50 transition-colors"
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <item.icon className="w-3 h-3 text-n-400" />
                    <span className="text-xs text-n-600 truncate">{item.label}</span>
                  </div>
                ))}
              </div>
              <div className="p-3 border-t border-n-200 flex items-center gap-1.5">
                <PanelLeft className="w-3 h-3 text-n-400" />
                <span className="text-xs text-n-400">{wt.collapse}</span>
              </div>
            </div>

            {/* Mock Main Content */}
            <div className="flex-1 bg-n-0 flex flex-col">
              <div className="flex-1 p-4 sm:p-6 space-y-3 overflow-hidden">
                {/* Mock chat messages */}
                <div className="flex gap-2">
                  <div className="w-6 h-6 rounded-sm bg-n-50 border border-n-200 flex items-center justify-center shrink-0">
                    <MessageSquare className="w-3 h-3 text-n-400" />
                  </div>
                  <div className="bg-n-900 rounded-sm px-3 py-2 max-w-[70%]">
                    <p className="text-xs text-white leading-relaxed">
                      {language === 'es'
                        ? 'Recibi un requerimiento ordinario de la DIAN...'
                        : 'I received an ordinary requirement from DIAN...'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="w-6 h-6 rounded-sm bg-n-900 flex items-center justify-center shrink-0">
                    <MessageSquare className="w-3 h-3 text-white" />
                  </div>
                  <div className="bg-n-50 border border-n-200 rounded-sm px-3 py-2 max-w-[80%]">
                    <p className="text-xs text-n-600 leading-relaxed">
                      {language === 'es'
                        ? 'He analizado su requerimiento. Segun el Art. 744 E.T., identifico 3 factores de riesgo clave...'
                        : 'I have analyzed your requirement. Under Art. 744 E.T., I identify 3 key risk factors...'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="w-6 h-6 rounded-sm bg-n-900 flex items-center justify-center shrink-0">
                    <MessageSquare className="w-3 h-3 text-white" />
                  </div>
                  <div className="bg-n-50 border border-n-200 rounded-sm px-3 py-2 max-w-[80%]">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-2 h-2 rounded-full bg-warning" />
                      <span className="text-xs font-medium text-n-900 font-mono">
                        MEDIO — 45/100
                      </span>
                    </div>
                    <div className="w-full h-1 bg-n-200 rounded-sm overflow-hidden">
                      <div className="h-full w-[45%] bg-warning rounded-sm" />
                    </div>
                  </div>
                </div>
              </div>
              {/* Mock Input */}
              <div className="p-3 border-t border-n-200">
                <div className="border border-n-200 rounded-sm h-8 flex items-center px-3">
                  <span className="text-xs text-n-400">{t.chat.inputPlaceholder}</span>
                </div>
              </div>
            </div>

            {/* Mock Analysis Panel */}
            <div className="w-[200px] border-l border-n-200 bg-n-0 hidden md:flex flex-col">
              <div className="p-3 border-b border-n-200 flex items-center justify-between">
                <span className="text-xs font-bold text-n-900">{wt.overview}</span>
                <PanelRight className="w-3 h-3 text-n-400" />
              </div>
              <div className="p-3 space-y-3">
                <div>
                  <span className="text-xs text-n-400 uppercase tracking-wider font-mono">
                    {language === 'es' ? 'Riesgo' : 'Risk'}
                  </span>
                  <div className="flex items-center gap-1.5 mt-1">
                    <div className="w-2 h-2 rounded-full bg-warning" />
                    <span className="text-xs font-medium font-mono">MEDIO</span>
                  </div>
                  <div className="w-full h-1 bg-n-200 rounded-sm mt-1.5 overflow-hidden">
                    <div className="h-full w-[45%] bg-warning rounded-sm" />
                  </div>
                </div>
                <div className="h-px bg-n-200" />
                <div>
                  <span className="text-xs text-n-400 uppercase tracking-wider font-mono">
                    {wt.documents}
                  </span>
                  <div className="mt-1.5 space-y-1">
                    <div className="flex items-center gap-1.5 p-1 rounded-sm bg-n-50 border border-n-200">
                      <div className="w-1 h-1 rounded-full bg-success" />
                      <span className="text-xs text-n-600 truncate">declaracion_2024.pdf</span>
                    </div>
                    <div className="flex items-center gap-1.5 p-1 rounded-sm bg-n-50 border border-n-200">
                      <div className="w-1 h-1 rounded-full bg-success" />
                      <span className="text-xs text-n-600 truncate">req_ordinario.pdf</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </GlassPanel>
      </motion.div>

      {/* CTA */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ type: 'spring', ...NOVA_SPRING, delay: 0.2 }}
        className="text-center"
      >
        <Link
          href="/workspace"
          className="inline-flex items-center gap-2 px-8 py-3 rounded-sm text-base font-medium bg-gold-500 hover:bg-gold-600 text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2"
        >
          {wt.openWorkspace}
          <ArrowRight className="w-4 h-4" />
        </Link>
        <p className="text-xs text-n-400 mt-4">
          {t.chat.confidential}
        </p>
      </motion.div>
    </section>
  );
}
