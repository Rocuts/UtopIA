'use client';

import { motion } from 'motion/react';
import { Bot, User, ArrowRight, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { useLanguage } from '@/context/LanguageContext';
import Link from 'next/link';

const NOVA_SPRING = { stiffness: 400, damping: 25 };

const PREVIEW_MESSAGES = {
  es: [
    {
      role: 'assistant' as const,
      content:
        'Bienvenido a 1+1. Soy su asistente especializado en consultoria contable y tributaria colombiana.',
    },
    {
      role: 'user' as const,
      content:
        'Recibi un requerimiento ordinario de la DIAN por inconsistencias en mi declaracion de renta 2024.',
    },
    {
      role: 'assistant' as const,
      content:
        'He analizado su caso. Segun el Art. 684 del E.T., tiene 30 dias habiles para responder. Identifico un nivel de riesgo **MEDIO** con 3 factores clave. Abra el workspace completo para ver el analisis detallado...',
    },
  ],
  en: [
    {
      role: 'assistant' as const,
      content:
        'Welcome to 1+1. I am your assistant specialized in Colombian accounting and tax consulting.',
    },
    {
      role: 'user' as const,
      content:
        'I received an ordinary requirement from DIAN for inconsistencies in my 2024 income tax return.',
    },
    {
      role: 'assistant' as const,
      content:
        'I have analyzed your case. According to Art. 684 of the Tax Statute, you have 30 business days to respond. I identified a **MEDIUM** risk level with 3 key factors. Open the full workspace for a detailed analysis...',
    },
  ],
};

export function ChatWidget() {
  const { language, t } = useLanguage();
  const messages = PREVIEW_MESSAGES[language];

  return (
    <section
      id="ai-consult"
      className="py-16 md:py-24 relative container mx-auto px-4 sm:px-6 lg:px-8 max-w-4xl"
    >
      <div className="text-center mb-10">
        <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4 text-[#0a0a0a]">
          {t.chat.title}
        </h2>
        <p className="text-lg text-[#525252] mb-4">{t.chat.confidential}</p>
        <div className="flex items-center justify-center gap-2 text-sm text-[#525252] bg-[#fafafa] w-fit mx-auto px-4 py-2 rounded-sm border border-[#e5e5e5]">
          <ShieldAlert className="w-4 h-4" />
          <span>{t.chat.demoTag}</span>
        </div>
      </div>

      <GlassPanel className="relative overflow-hidden rounded-sm bg-white">
        {/* Chat header */}
        <div className="p-4 border-b border-[#e5e5e5] flex items-center gap-3">
          <div className="w-8 h-8 rounded-sm bg-[#0a0a0a] flex items-center justify-center">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="font-medium text-[#0a0a0a] text-sm">1+1</h3>
            <p className="text-xs text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">
              {t.chatAi.status}
            </p>
          </div>
        </div>

        {/* Preview messages */}
        <div className="p-4 sm:p-6 space-y-4 max-h-[320px] overflow-hidden">
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ type: 'spring', ...NOVA_SPRING, delay: i * 0.15 }}
              className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
            >
              <div
                className={`w-7 h-7 rounded-sm flex items-center justify-center shrink-0 mt-0.5 ${
                  msg.role === 'user'
                    ? 'bg-[#fafafa] border border-[#e5e5e5] text-[#525252]'
                    : 'bg-[#0a0a0a] text-white'
                }`}
              >
                {msg.role === 'user' ? (
                  <User className="w-3.5 h-3.5" />
                ) : (
                  <Bot className="w-3.5 h-3.5" />
                )}
              </div>
              <div
                className={`max-w-[85%] sm:max-w-[80%] rounded-sm px-4 py-3 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-[#0a0a0a] text-white'
                    : 'bg-[#fafafa] border border-[#e5e5e5] text-[#0a0a0a]'
                }`}
              >
                {msg.content}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Frosted overlay with CTA */}
        <div className="absolute inset-0 bg-gradient-to-t from-white via-white/95 to-transparent flex flex-col items-center justify-end pb-10 px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ type: 'spring', ...NOVA_SPRING, delay: 0.4 }}
            className="text-center"
          >
            <Link href="/workspace">
              <Button size="lg" className="gap-2 text-base">
                {language === 'es' ? 'Abrir Workspace Completo' : 'Open Full Workspace'}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <p className="text-xs text-[#a3a3a3] mt-3 font-[family-name:var(--font-geist-mono)]">
              {t.chat.disclaimer}
            </p>
          </motion.div>
        </div>
      </GlassPanel>
    </section>
  );
}
