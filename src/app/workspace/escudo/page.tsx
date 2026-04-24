'use client';

/**
 * /workspace/escudo — Ventana I: El Escudo (Tributaria / Legal).
 *
 * Overview de la ventana. Delega el dashboard a `EscudoArea` y añade un strip
 * contextual abajo que lanza un chat "El Escudo" con contexto precargado.
 *
 * Se envuelve en `data-theme="elite"` para que las utilities `.glass-*`,
 * `.glow-*` y `.border-elite-*` funcionen incluso si el layout padre aún
 * no tiene el token aplicado (Agente B lo añade al shell del workspace).
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, MessageSquare, Sparkles } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cn } from '@/lib/utils';
import { EliteButton } from '@/components/ui/EliteButton';
import { EscudoArea } from '@/components/workspace/areas/EscudoArea';

export default function EscudoPage() {
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

  const handleChatEscudo = useCallback(() => {
    // Crea una nueva consulta con contexto tributario/legal y navega al workspace.
    setActiveCaseType('general_chat');
    setActiveMode('chat');
    startNewConsultation('dian-defense');
    router.push('/workspace');
  }, [router, setActiveCaseType, setActiveMode, startNewConsultation]);

  const handleSubmitSeed = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      // Seed bus → ChatSidebar: pre-fill the input. If empty, the area
      // strip still acts as a quick-entry to the tax/legal chat context.
      const trimmed = chatSeed.trim();
      if (trimmed) setPendingChatSeed(trimmed);
      setChatSeed('');
      handleChatEscudo();
    },
    [chatSeed, handleChatEscudo, setPendingChatSeed],
  );

  const escudo = t.elite.areas.escudo;

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
      {/* Fondo ambient con orb wine sutil */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute -top-[20%] -left-[10%] w-[600px] h-[600px] rounded-full blur-[120px] opacity-30"
          style={{
            background:
              'radial-gradient(circle, rgba(114,47,55,0.4) 0%, rgba(114,47,55,0) 70%)',
          }}
        />
        <div
          className="absolute top-[30%] -right-[10%] w-[500px] h-[500px] rounded-full blur-[140px] opacity-20"
          style={{
            background:
              'radial-gradient(circle, rgba(212,160,23,0.3) 0%, rgba(212,160,23,0) 70%)',
          }}
        />
      </div>

      <div className="relative z-[1] max-w-[1240px] mx-auto px-6 md:px-10 pt-8 pb-24">
        <EscudoArea />

        {/* Strip contextual — chat "El Escudo" */}
        <motion.section
          {...fade}
          aria-label={language === 'es' ? 'Chat contextual de El Escudo' : 'Shield contextual chat'}
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
                    {language === 'es' ? 'Asistente contextual' : 'Contextual assistant'}
                  </div>
                  <h3 className="font-serif-elite text-[22px] leading-tight text-[#F5F5F5] mb-1.5">
                    {language === 'es'
                      ? 'Consulta a El Escudo'
                      : 'Ask The Shield'}
                  </h3>
                  <p className="text-[13px] leading-relaxed text-[#A8A8A8]">
                    {language === 'es'
                      ? 'Pregunte sobre E.T., doctrina DIAN, NIIF o estrategia tributaria. Respuesta con citas normativas.'
                      : 'Ask about the Tax Statute, DIAN doctrine, IFRS or tax strategy. Answers come with legal citations.'}
                  </p>
                </div>
              </div>

              <form
                onSubmit={handleSubmitSeed}
                className="flex-1 flex flex-col sm:flex-row items-stretch gap-3"
              >
                <label htmlFor="escudo-chat-seed" className="sr-only">
                  {language === 'es' ? 'Pregunta inicial' : 'Initial question'}
                </label>
                <input
                  id="escudo-chat-seed"
                  type="text"
                  value={chatSeed}
                  onChange={(e) => setChatSeed(e.target.value)}
                  placeholder={
                    language === 'es'
                      ? 'Ej. ¿Cómo respondo a un requerimiento ordinario DIAN?'
                      : 'E.g. How do I respond to an ordinary DIAN notice?'
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
                  {escudo.concept}
                </EliteButton>
              </form>
            </div>

            <p className="relative z-[1] mt-4 text-[11px] text-[#6B6B6B] md:text-right">
              {language === 'es'
                ? 'El contexto tributario se inyecta automáticamente en la conversación.'
                : 'Tax context is injected into the conversation automatically.'}
            </p>
          </div>
        </motion.section>
      </div>
    </div>
  );
}
