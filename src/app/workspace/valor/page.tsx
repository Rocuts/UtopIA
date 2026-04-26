'use client';

/**
 * /workspace/valor — Ventana II: El Valor (Ingeniería Financiera y Valoración).
 *
 * Overview de la ventana. Delega el dashboard a `ValorArea` (KPI hero monumental,
 * sparkline, sub-KPIs, grid 3 submódulos) y agrega el strip contextual
 * "Chat contextual El Valor".
 *
 * El ambiente (orbs + max-width container) lo aporta `AreaShell`. El tema
 * (light/dark/system) lo aplica `ThemeProvider` en <html>.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, MessageSquare, Sparkles } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cn } from '@/lib/utils';
import { EliteButton } from '@/components/ui/EliteButton';
import { ValorArea } from '@/components/workspace/areas/ValorArea';
import { AreaShell } from '@/components/workspace/layouts/AreaShell';

export default function ValorPage() {
  const { t, language } = useLanguage();
  const router = useRouter();
  const reduced = useReducedMotion();
  const {
    setActiveCaseType,
    setActiveMode,
    startNewConsultation,
    setPendingChatSeed,
  } = useWorkspace();

  const [chatSeed, setChatSeed] = useState('');

  const handleChatValor = useCallback(() => {
    // Nueva consulta con contexto financiero/valoración.
    setActiveCaseType('general_chat');
    setActiveMode('chat');
    startNewConsultation('financial-intelligence');
    router.push('/workspace');
  }, [router, setActiveCaseType, setActiveMode, startNewConsultation]);

  const handleSubmitSeed = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      // Seed bus → ChatSidebar.
      const trimmed = chatSeed.trim();
      if (trimmed) setPendingChatSeed(trimmed);
      setChatSeed('');
      handleChatValor();
    },
    [chatSeed, handleChatValor, setPendingChatSeed],
  );

  const valor = t.elite.areas.valor;

  const fade = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 14 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.5, delay: 0.6, ease: [0.16, 1, 0.3, 1] as const },
      };

  return (
    <AreaShell areaAccent="valor">
      <ValorArea />

      {/* Strip contextual — chat "El Valor" */}
      <motion.section
        {...fade}
        aria-label={
          language === 'es' ? 'Chat contextual de El Valor' : 'Value contextual chat'
        }
        className="mt-16"
      >
          <div className="relative overflow-hidden rounded-xl glass-elite-elevated border-elite-gold p-6 md:p-8">
            <div
              aria-hidden="true"
              className="absolute -top-20 -right-20 w-[260px] h-[260px] rounded-full blur-[90px] opacity-45"
              style={{
                background:
                  'radial-gradient(circle, rgb(var(--color-gold-500-rgb) / 0.4) 0%, rgb(var(--color-gold-500-rgb) / 0) 70%)',
              }}
            />

            <div className="relative z-[1] flex flex-col md:flex-row md:items-center gap-6 md:gap-8">
              <div className="flex items-start gap-3 md:max-w-md">
                <span
                  aria-hidden="true"
                  className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-md bg-[rgb(var(--color-gold-500-rgb)_/_0.14)] text-gold-600"
                >
                  <MessageSquare className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div className="flex-1">
                  <div className="uppercase tracking-eyebrow text-xs font-medium text-gold-500 mb-1 inline-flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                    {language === 'es' ? 'Asistente contextual' : 'Contextual assistant'}
                  </div>
                  <h3 className="font-serif-elite text-xl leading-tight text-n-800 mb-1.5">
                    {language === 'es'
                      ? 'Consulta a El Valor'
                      : 'Ask The Value'}
                  </h3>
                  <p className="text-sm leading-relaxed text-n-500">
                    {language === 'es'
                      ? 'Pregunte sobre WACC, múltiplos, DCF, NIIF 13 o estructuración de capital. Respuestas con supuestos y sensibilidades.'
                      : 'Ask about WACC, multiples, DCF, IFRS 13 or capital structure. Answers include assumptions and sensitivities.'}
                  </p>
                </div>
              </div>

              <form
                onSubmit={handleSubmitSeed}
                className="flex-1 flex flex-col sm:flex-row items-stretch gap-3"
              >
                <label htmlFor="valor-chat-seed" className="sr-only">
                  {language === 'es' ? 'Pregunta inicial' : 'Initial question'}
                </label>
                <input
                  id="valor-chat-seed"
                  type="text"
                  value={chatSeed}
                  onChange={(e) => setChatSeed(e.target.value)}
                  placeholder={
                    language === 'es'
                      ? 'Ej. ¿Qué múltiplo aplica a una fintech de 12B?'
                      : 'E.g. What multiple applies to a 12B fintech?'
                  }
                  className={cn(
                    'flex-1 h-11 px-4 rounded-md',
                    'bg-n-50 dark:bg-[rgba(10,10,10,0.6)] border border-[rgb(var(--color-gold-500-rgb)_/_0.25)]',
                    'text-base text-n-800 placeholder:text-n-600',
                    'focus:outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500 focus:ring-offset-2 focus:ring-offset-n-1000',
                    'transition-[border-color,box-shadow]',
                  )}
                />
                <EliteButton
                  type="submit"
                  variant="primary"
                  size="md"
                  rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={2} />}
                  glow
                >
                  {valor.concept}
                </EliteButton>
              </form>
            </div>

            <p className="relative z-[1] mt-4 text-xs text-n-600 md:text-right">
              {language === 'es'
                ? 'El contexto de valoración y finanzas se inyecta en la conversación.'
                : 'Valuation & finance context is injected into the conversation.'}
            </p>
          </div>
        </motion.section>
    </AreaShell>
  );
}
