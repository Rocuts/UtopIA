'use client';

/**
 * /workspace/futuro — Ventana IV: El Futuro (Proyección Económica y Factibilidad).
 *
 * Overview de la ventana. Renderiza `FuturoArea` y añade un strip contextual
 * abajo que lanza un chat "El Futuro" con contexto de factibilidad / macro /
 * escenarios precargado (aterriza en `financial-intelligence`).
 *
 * Se envuelve en `data-theme="elite"` para que las utilidades `.glass-*`,
 * `.glow-*` y `.border-elite-*` funcionen incluso si el layout padre aún no
 * tiene el token aplicado.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, MessageSquare, Sparkles } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cn } from '@/lib/utils';
import { EliteButton } from '@/components/ui/EliteButton';
import { FuturoArea } from '@/components/workspace/areas/FuturoArea';

export default function FuturoPage() {
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

  const handleChatFuturo = useCallback(() => {
    // Contexto "financial-intelligence" cubre factibilidad / macro / escenarios.
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
      handleChatFuturo();
    },
    [chatSeed, handleChatFuturo, setPendingChatSeed],
  );

  const futuro = t.elite.areas.futuro;
  const isEs = language === 'es';

  const fade = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 14 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.5, delay: 0.55, ease: [0.16, 1, 0.3, 1] as const },
      };

  return (
    <div
      data-theme="elite"
      className={cn(
        'relative w-full min-h-full overflow-y-auto',
        'bg-[#030303] text-[#F5F5F5]',
      )}
    >
      {/* Fondo ambient — orbs dorados (futuro = luz, oportunidad) con un toque wine */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute -top-[20%] -right-[10%] w-[620px] h-[620px] rounded-full blur-[120px] opacity-30"
          style={{
            background:
              'radial-gradient(circle, rgba(212,160,23,0.40) 0%, rgba(212,160,23,0) 70%)',
          }}
        />
        <div
          className="absolute top-[35%] -left-[10%] w-[520px] h-[520px] rounded-full blur-[140px] opacity-20"
          style={{
            background:
              'radial-gradient(circle, rgba(114,47,55,0.30) 0%, rgba(114,47,55,0) 70%)',
          }}
        />
      </div>

      <div className="relative z-[1] max-w-[1240px] mx-auto px-6 md:px-10 pt-8 pb-24">
        <FuturoArea />

        {/* Strip contextual — chat "El Futuro" */}
        <motion.section
          {...fade}
          aria-label={
            isEs ? 'Chat contextual de El Futuro' : 'Future contextual chat'
          }
          className="mt-16"
        >
          <div className="relative overflow-hidden rounded-[16px] glass-elite-elevated border-elite-gold p-6 md:p-8">
            <div
              aria-hidden="true"
              className="absolute -top-20 -right-20 w-[260px] h-[260px] rounded-full blur-[90px] opacity-40"
              style={{
                background:
                  'radial-gradient(circle, rgba(212,160,23,0.35) 0%, rgba(212,160,23,0) 70%)',
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
                    {isEs ? 'Asistente contextual' : 'Contextual assistant'}
                  </div>
                  <h3 className="font-serif-elite text-[22px] leading-tight text-[#F5F5F5] mb-1.5">
                    {isEs ? 'Consulta a El Futuro' : 'Ask The Future'}
                  </h3>
                  <p className="text-[13px] leading-relaxed text-[#A8A8A8]">
                    {isEs
                      ? 'Pregunte sobre VPN, TIR, WACC colombiano, escenarios, incentivos ZOMAC/Zona Franca o cómo las variables macro afectan su proyecto.'
                      : 'Ask about NPV, IRR, Colombian WACC, scenarios, ZOMAC / Free-Zone incentives or how macro variables affect your project.'}
                  </p>
                </div>
              </div>

              <form
                onSubmit={handleSubmitSeed}
                className="flex-1 flex flex-col sm:flex-row items-stretch gap-3"
              >
                <label htmlFor="futuro-chat-seed" className="sr-only">
                  {isEs ? 'Pregunta inicial' : 'Initial question'}
                </label>
                <input
                  id="futuro-chat-seed"
                  type="text"
                  value={chatSeed}
                  onChange={(e) => setChatSeed(e.target.value)}
                  placeholder={
                    isEs
                      ? 'Ej. ¿Es viable abrir una bodega en Cali con $1.200M?'
                      : 'E.g. Is opening a warehouse in Cali viable with $1.2B COP?'
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
                  {futuro.concept}
                </EliteButton>
              </form>
            </div>

            <p className="relative z-[1] mt-4 text-[11px] text-[#6B6B6B] md:text-right">
              {isEs
                ? 'El contexto de proyección y macro se inyecta automáticamente.'
                : 'Projection & macro context is injected automatically.'}
            </p>
          </div>
        </motion.section>
      </div>
    </div>
  );
}
