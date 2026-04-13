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
import { Badge } from '@/components/ui/Badge';
import { useLanguage } from '@/context/LanguageContext';

const NOVA_SPRING = { stiffness: 400, damping: 25 };

export function WorkspaceTeaser() {
  const { language, t } = useLanguage();
  const wt = t.workspace;

  return (
    <section id="ai-consult" className="py-16 md:py-24 relative container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl">
      <div className="text-center mb-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ type: 'spring', ...NOVA_SPRING }}
        >
          <Badge variant="solid" className="mb-4">
            {language === 'es' ? 'Workspace Profesional' : 'Professional Workspace'}
          </Badge>
        </motion.div>
        <motion.h2
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ type: 'spring', ...NOVA_SPRING, delay: 0.05 }}
          className="text-3xl md:text-5xl font-bold tracking-tight mb-4 text-[#0a0a0a]"
        >
          {t.chat.title}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ type: 'spring', ...NOVA_SPRING, delay: 0.1 }}
          className="text-lg text-[#525252] mb-2"
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
          <div className="h-10 border-b border-[#e5e5e5] flex items-center px-4 gap-3 bg-white">
            <div className="w-1.5 h-1.5 rounded-full bg-[#0a0a0a]" />
            <span className="text-xs font-bold text-[#0a0a0a]">UtopIA</span>
            <div className="h-3 w-px bg-[#e5e5e5]" />
            <span className="text-[10px] text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">
              {language === 'es' ? 'Defensa DIAN' : 'DIAN Defense'}
            </span>
            <div className="flex-1" />
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[#22c55e]" />
              <span className="text-[10px] text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">BAJO</span>
            </div>
          </div>

          {/* Mock Three-Panel Layout */}
          <div className="flex h-[320px] sm:h-[380px]">
            {/* Mock Sidebar */}
            <div className="w-[180px] border-r border-[#e5e5e5] bg-white hidden sm:flex flex-col">
              <div className="p-3">
                <div className="w-full h-7 rounded-sm bg-[#d4a017] flex items-center justify-center gap-1.5">
                  <span className="text-[10px] text-white font-medium">
                    {wt.newConsultation}
                  </span>
                </div>
              </div>
              <div className="px-3 py-1">
                <div className="w-full h-6 rounded-sm bg-[#fafafa] border border-[#e5e5e5]" />
              </div>
              <div className="flex-1 px-3 py-2 space-y-1">
                {[
                  { icon: Shield, label: 'Req. DIAN #142', color: '#eab308' },
                  { icon: TrendingUp, label: 'Saldo IVA Q3', color: '#22c55e' },
                  { icon: FileSearch, label: 'DD Acme Corp', color: '#f97316' },
                ].map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-[#fafafa] transition-colors"
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <item.icon className="w-3 h-3 text-[#a3a3a3]" />
                    <span className="text-[10px] text-[#525252] truncate">{item.label}</span>
                  </div>
                ))}
              </div>
              <div className="p-3 border-t border-[#e5e5e5] flex items-center gap-1.5">
                <PanelLeft className="w-3 h-3 text-[#a3a3a3]" />
                <span className="text-[10px] text-[#a3a3a3]">{wt.collapse}</span>
              </div>
            </div>

            {/* Mock Main Content */}
            <div className="flex-1 bg-white flex flex-col">
              <div className="flex-1 p-4 sm:p-6 space-y-3 overflow-hidden">
                {/* Mock chat messages */}
                <div className="flex gap-2">
                  <div className="w-6 h-6 rounded-sm bg-[#fafafa] border border-[#e5e5e5] flex items-center justify-center shrink-0">
                    <MessageSquare className="w-3 h-3 text-[#a3a3a3]" />
                  </div>
                  <div className="bg-[#0a0a0a] rounded-sm px-3 py-2 max-w-[70%]">
                    <p className="text-[10px] text-white leading-relaxed">
                      {language === 'es'
                        ? 'Recibi un requerimiento ordinario de la DIAN...'
                        : 'I received an ordinary requirement from DIAN...'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="w-6 h-6 rounded-sm bg-[#0a0a0a] flex items-center justify-center shrink-0">
                    <MessageSquare className="w-3 h-3 text-white" />
                  </div>
                  <div className="bg-[#fafafa] border border-[#e5e5e5] rounded-sm px-3 py-2 max-w-[80%]">
                    <p className="text-[10px] text-[#525252] leading-relaxed">
                      {language === 'es'
                        ? 'He analizado su requerimiento. Segun el Art. 744 E.T., identifico 3 factores de riesgo clave...'
                        : 'I have analyzed your requirement. Under Art. 744 E.T., I identify 3 key risk factors...'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="w-6 h-6 rounded-sm bg-[#0a0a0a] flex items-center justify-center shrink-0">
                    <MessageSquare className="w-3 h-3 text-white" />
                  </div>
                  <div className="bg-[#fafafa] border border-[#e5e5e5] rounded-sm px-3 py-2 max-w-[80%]">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-2 h-2 rounded-full bg-[#eab308]" />
                      <span className="text-[10px] font-medium text-[#0a0a0a] font-[family-name:var(--font-geist-mono)]">
                        MEDIO — 45/100
                      </span>
                    </div>
                    <div className="w-full h-1 bg-[#e5e5e5] rounded-sm overflow-hidden">
                      <div className="h-full w-[45%] bg-[#eab308] rounded-sm" />
                    </div>
                  </div>
                </div>
              </div>
              {/* Mock Input */}
              <div className="p-3 border-t border-[#e5e5e5]">
                <div className="border border-[#e5e5e5] rounded-sm h-8 flex items-center px-3">
                  <span className="text-[10px] text-[#a3a3a3]">{t.chat.inputPlaceholder}</span>
                </div>
              </div>
            </div>

            {/* Mock Analysis Panel */}
            <div className="w-[200px] border-l border-[#e5e5e5] bg-white hidden md:flex flex-col">
              <div className="p-3 border-b border-[#e5e5e5] flex items-center justify-between">
                <span className="text-[10px] font-bold text-[#0a0a0a]">{wt.overview}</span>
                <PanelRight className="w-3 h-3 text-[#a3a3a3]" />
              </div>
              <div className="p-3 space-y-3">
                <div>
                  <span className="text-[9px] text-[#a3a3a3] uppercase tracking-wider font-[family-name:var(--font-geist-mono)]">
                    {language === 'es' ? 'Riesgo' : 'Risk'}
                  </span>
                  <div className="flex items-center gap-1.5 mt-1">
                    <div className="w-2 h-2 rounded-full bg-[#eab308]" />
                    <span className="text-[10px] font-medium font-[family-name:var(--font-geist-mono)]">MEDIO</span>
                  </div>
                  <div className="w-full h-1 bg-[#e5e5e5] rounded-sm mt-1.5 overflow-hidden">
                    <div className="h-full w-[45%] bg-[#eab308] rounded-sm" />
                  </div>
                </div>
                <div className="h-px bg-[#e5e5e5]" />
                <div>
                  <span className="text-[9px] text-[#a3a3a3] uppercase tracking-wider font-[family-name:var(--font-geist-mono)]">
                    {wt.documents}
                  </span>
                  <div className="mt-1.5 space-y-1">
                    <div className="flex items-center gap-1.5 p-1 rounded-sm bg-[#fafafa] border border-[#e5e5e5]">
                      <div className="w-1 h-1 rounded-full bg-[#22c55e]" />
                      <span className="text-[9px] text-[#525252] truncate">declaracion_2024.pdf</span>
                    </div>
                    <div className="flex items-center gap-1.5 p-1 rounded-sm bg-[#fafafa] border border-[#e5e5e5]">
                      <div className="w-1 h-1 rounded-full bg-[#22c55e]" />
                      <span className="text-[9px] text-[#525252] truncate">req_ordinario.pdf</span>
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
          className="inline-flex items-center gap-2 px-8 py-3 rounded-sm text-base font-medium bg-[#d4a017] hover:bg-[#b8901a] text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a017] focus-visible:ring-offset-2"
        >
          {wt.openWorkspace}
          <ArrowRight className="w-4 h-4" />
        </Link>
        <p className="text-xs text-[#a3a3a3] mt-4">
          {t.chat.confidential}
        </p>
      </motion.div>
    </section>
  );
}
