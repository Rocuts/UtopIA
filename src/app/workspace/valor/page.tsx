'use client';

/**
 * /workspace/valor — Ventana II: El Valor (Ingeniería Financiera y Valoración).
 *
 * Overview de la ventana. Delega el dashboard a `ValorArea` (KPI hero monumental,
 * sparkline, sub-KPIs, grid 3 submódulos) y agrega el strip contextual
 * "Chat contextual El Valor".
 *
 * Wrapper `data-theme="elite"` para que `.glass-*` / `.glow-*` funcionen
 * aunque el layout padre aún no aplique el token.
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
    <div
      data-theme="elite"
      className={cn(
        'relative w-full min-h-full overflow-y-auto',
        'bg-[#030303] text-[#F5F5F5]',
      )}
    >
      {/* Fondo ambient — doble glow dorado (el valor brilla) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute -top-[15%] -right-[10%] w-[620px] h-[620px] rounded-full blur-[130px] opacity-35"
          style={{
            background:
              'radial-gradient(circle, rgba(212,160,23,0.45) 0%, rgba(212,160,23,0) 70%)',
          }}
        />
        <div
          className="absolute top-[45%] -left-[12%] w-[500px] h-[500px] rounded-full blur-[140px] opacity-25"
          style={{
            background:
              'radial-gradient(circle, rgba(232,180,44,0.35) 0%, rgba(232,180,44,0) 70%)',
          }}
        />
      </div>

      <div className="relative z-[1] max-w-[1240px] mx-auto px-6 md:px-10 pt-8 pb-24">
        <ValorArea />

        {/* Strip contextual — chat "El Valor" */}
        <motion.section
          {...fade}
          aria-label={
            language === 'es' ? 'Chat contextual de El Valor' : 'Value contextual chat'
          }
          className="mt-16"
        >
          <div className="relative overflow-hidden rounded-[16px] glass-elite-elevated border-elite-gold p-6 md:p-8">
            <div
              aria-hidden="true"
              className="absolute -top-20 -right-20 w-[260px] h-[260px] rounded-full blur-[90px] opacity-45"
              style={{
                background:
                  'radial-gradient(circle, rgba(212,160,23,0.4) 0%, rgba(212,160,23,0) 70%)',
              }}
            />

            <div className="relative z-[1] flex flex-col md:flex-row md:items-center gap-6 md:gap-8">
              <div className="flex items-start gap-3 md:max-w-md">
                <span
                  aria-hidden="true"
                  className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-[rgba(212,160,23,0.14)] text-[#E8B42C]"
                >
                  <MessageSquare className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div className="flex-1">
                  <div className="uppercase tracking-[0.18em] text-[11px] font-medium text-[#D4A017] mb-1 inline-flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                    {language === 'es' ? 'Asistente contextual' : 'Contextual assistant'}
                  </div>
                  <h3 className="font-serif-elite text-[22px] leading-tight text-[#F5F5F5] mb-1.5">
                    {language === 'es'
                      ? 'Consulta a El Valor'
                      : 'Ask The Value'}
                  </h3>
                  <p className="text-[13px] leading-relaxed text-[#A8A8A8]">
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
                    'flex-1 h-11 px-4 rounded-[10px]',
                    'bg-[rgba(10,10,10,0.6)] border border-[rgba(212,160,23,0.25)]',
                    'text-[14px] text-[#F5F5F5] placeholder:text-[#6B6B6B]',
                    'focus:outline-none focus:border-[#D4A017] focus:ring-2 focus:ring-[#D4A017] focus:ring-offset-2 focus:ring-offset-[#030303]',
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

            <p className="relative z-[1] mt-4 text-[11px] text-[#6B6B6B] md:text-right">
              {language === 'es'
                ? 'El contexto de valoración y finanzas se inyecta en la conversación.'
                : 'Valuation & finance context is injected into the conversation.'}
            </p>
          </div>
        </motion.section>
      </div>
    </div>
  );
}
