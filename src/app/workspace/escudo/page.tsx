'use client';

/**
 * /workspace/escudo — Ventana I: El Escudo (Tributaria / Legal).
 *
 * Capa 5: Auto-lectura del FiscalSnapshot desde lastCompletedReport (localStorage)
 * o GET /api/escudo/fiscal-anchor (multi-dispositivo). El snapshot se pasa a
 * EscudoArea como fiscalAnchor + riskScore + alertas.
 *
 * Decisión de routing: la auto-lectura está en esta página (no sub-ruta) porque:
 * 1. El dueño ya navega aquí para ver El Escudo.
 * 2. No se justifica una sub-ruta solo para mostrar datos que son parte del mismo dashboard.
 * 3. La querystring ?mode=survival existe pero el SurvivalModePanel ya tiene su propia ruta.
 *
 * El ambiente (orbs + max-width container) lo aporta `AreaShell`.
 */

import { useCallback, useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, MessageSquare, Sparkles, FileText } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cn } from '@/lib/utils';
import { EliteButton } from '@/components/ui/EliteButton';
import { EscudoArea } from '@/components/workspace/areas/EscudoArea';
import type { AlertView } from '@/components/workspace/areas/EscudoArea';
import { AreaShell } from '@/components/workspace/layouts/AreaShell';
import type { FiscalSnapshot, FiscalRiskScore } from '@/lib/agents/financial/types';
import type { FiscalAnchorBlock } from '@/lib/agents/financial/escudo-survival/fiscal-anchor/types';

// ─── Tipo de respuesta del GET /api/escudo/fiscal-anchor ─────────────────────

interface FiscalAnchorResponse {
  hasData: boolean;
  fiscalSnapshot: FiscalSnapshot | null;
  alertas: AlertView[];
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function EscudoPage() {
  const { t, language } = useLanguage();
  const router = useRouter();
  const reduced = useReducedMotion();
  const {
    lastCompletedReport,
    setActiveCaseType,
    setActiveMode,
    startNewConsultation,
    setPendingChatSeed,
  } = useWorkspace();

  const [chatSeed, setChatSeed] = useState('');

  // ─── Capa 5 — Auto-lectura del FiscalSnapshot ────────────────────────────
  // Prioridad: 1º lastCompletedReport.report.fiscalSnapshot (instantáneo, sin red)
  //            2º GET /api/escudo/fiscal-anchor (multi-dispositivo + alertas DB)
  const [fiscalAnchor, setFiscalAnchor] = useState<FiscalAnchorBlock | undefined>(undefined);
  const [riskScore, setRiskScore] = useState<FiscalRiskScore | undefined>(undefined);
  const [alertas, setAlertas] = useState<AlertView[]>([]);
  const [isLoadingAnchor, setIsLoadingAnchor] = useState(false);

  // Guarda useRef para evitar re-fetch cuando el effect re-corre (intake-guard memory pattern).
  const anchorFetchedRef = useRef(false);

  useEffect(() => {
    // Fuente 1: localStorage via WorkspaceContext (instantáneo, sin red).
    const snap =
      (lastCompletedReport?.report as { fiscalSnapshot?: FiscalSnapshot } | null)
        ?.fiscalSnapshot ?? null;

    if (snap) {
      setFiscalAnchor(snap.anchor);
      setRiskScore(snap.riskScore);
      // Las alertas de la fuente localStorage no tienen id gestionado por DB;
      // las mostramos como view-models locales sin botón resolver hasta que
      // el GET de DB las enriquezca. Por ahora las omitimos del estado inicial.
      // El GET de abajo las completará si hay workspace.
      anchorFetchedRef.current = true; // marcamos que ya tenemos datos
      return;
    }

    // Fuente 2: GET /api/escudo/fiscal-anchor (una sola vez, con guarda useRef).
    if (anchorFetchedRef.current) return;
    anchorFetchedRef.current = true;

    setIsLoadingAnchor(true);
    void (async () => {
      try {
        const res = await fetch('/api/escudo/fiscal-anchor');
        if (!res.ok) return;
        const data = (await res.json()) as FiscalAnchorResponse;
        if (data.hasData && data.fiscalSnapshot) {
          setFiscalAnchor(data.fiscalSnapshot.anchor);
          setRiskScore(data.fiscalSnapshot.riskScore);
        }
        if (data.alertas?.length) {
          setAlertas(data.alertas);
        }
      } catch {
        // Silencioso: El Escudo muestra mocks si no hay datos.
      } finally {
        setIsLoadingAnchor(false);
      }
    })();
  }, [lastCompletedReport]);

  // Si hay snapshot en localStorage, también intentar el GET para enriquecer alertas
  // con ids gestionados por DB (resolución con PATCH). Lo hacemos en un efecto
  // separado para no bloquear el render inicial.
  useEffect(() => {
    const snap =
      (lastCompletedReport?.report as { fiscalSnapshot?: FiscalSnapshot } | null)
        ?.fiscalSnapshot ?? null;
    if (!snap) return;

    void (async () => {
      try {
        const res = await fetch('/api/escudo/fiscal-anchor');
        if (!res.ok) return;
        const data = (await res.json()) as FiscalAnchorResponse;
        if (data.alertas?.length) {
          setAlertas(data.alertas);
        }
      } catch {
        // Silencioso.
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Solo una vez al montar.

  // ─── Acciones de navegación ───────────────────────────────────────────────

  const handleChatEscudo = useCallback(() => {
    setActiveCaseType('general_chat');
    setActiveMode('chat');
    startNewConsultation('dian-defense');
    router.push('/workspace');
  }, [router, setActiveCaseType, setActiveMode, startNewConsultation]);

  const handleSubmitSeed = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const trimmed = chatSeed.trim();
      if (trimmed) setPendingChatSeed(trimmed);
      setChatSeed('');
      handleChatEscudo();
    },
    [chatSeed, handleChatEscudo, setPendingChatSeed],
  );

  const handleGenerarNiif = useCallback(() => {
    // Navega al workspace principal donde el intake de NIIF está disponible.
    setActiveCaseType('niif_report');
    setActiveMode('pipeline');
    router.push('/workspace');
  }, [router, setActiveCaseType, setActiveMode]);

  const escudo = t.elite.areas.escudo;

  const fade = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 14 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.5, delay: 0.55, ease: [0.16, 1, 0.3, 1] as const },
      };

  const hasNoData = !fiscalAnchor && !isLoadingAnchor;
  const hasNoReport = hasNoData && !lastCompletedReport;

  return (
    <AreaShell areaAccent="escudo">
      {/* Estado vacío: sin reporte NIIF previo */}
      {hasNoReport && (
        <motion.div
          {...(reduced ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4 } })}
          className="mb-10 flex flex-col items-start gap-4 p-6 rounded-xl glass-elite-elevated border border-[rgb(168_56_56_/_0.3)]"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-md bg-[rgb(168_56_56_/_0.16)] text-area-escudo"
            >
              <FileText className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div>
              <p className="font-serif-elite text-xl leading-tight text-n-1000 mb-1">
                {language === 'es'
                  ? 'Sin datos fiscales aún'
                  : 'No fiscal data yet'}
              </p>
              <p className="text-sm text-n-700 leading-relaxed max-w-md">
                {language === 'es'
                  ? 'Genera un Informe NIIF para que El Escudo se pueble automáticamente con las cifras fiscales reales de tu empresa.'
                  : 'Generate an IFRS Report so The Shield auto-populates with your company\'s real tax figures.'}
              </p>
            </div>
          </div>
          <EliteButton
            variant="primary"
            size="md"
            rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={2} />}
            onClick={handleGenerarNiif}
          >
            {language === 'es' ? 'Generar Informe NIIF' : 'Generate IFRS Report'}
          </EliteButton>
        </motion.div>
      )}

      <EscudoArea
        fiscalAnchor={fiscalAnchor}
        riskScore={riskScore}
        alertas={alertas.length > 0 ? alertas : undefined}
      />

      {/* Strip contextual — chat "El Escudo" */}
      <motion.section
        {...fade}
        aria-label={language === 'es' ? 'Chat contextual de El Escudo' : 'Shield contextual chat'}
        className="mt-16"
      >
        <div className="relative overflow-hidden rounded-xl glass-elite-elevated border-elite-gold p-6 md:p-8">
          <div
            aria-hidden="true"
            className="absolute -top-20 -right-20 w-[260px] h-[260px] rounded-full blur-[90px] opacity-40"
            style={{
              background:
                'radial-gradient(circle, rgb(var(--color-gold-500-rgb) / 0.35) 0%, rgb(var(--color-gold-500-rgb) / 0) 70%)',
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
                <div className="uppercase tracking-eyebrow text-xs font-medium text-n-700 dark:text-gold-500 mb-1 inline-flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3 text-gold-500" strokeWidth={2} aria-hidden="true" />
                  {language === 'es' ? 'Asistente contextual' : 'Contextual assistant'}
                </div>
                <h3 className="font-serif-elite text-xl leading-tight text-n-800 mb-1.5">
                  {language === 'es'
                    ? 'Consulta a El Escudo'
                    : 'Ask The Shield'}
                </h3>
                <p className="text-sm leading-relaxed text-n-500">
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
                  'flex-1 h-11 px-4 rounded-md',
                  'bg-n-50 dark:bg-[rgba(10,10,10,0.6)]',
                  'border border-[rgb(var(--color-gold-500-rgb)_/_0.35)] dark:border-[rgb(var(--color-gold-500-rgb)_/_0.25)]',
                  'text-base text-n-800 placeholder:text-n-600',
                  'focus:outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500 focus:ring-offset-2 focus:ring-offset-n-50',
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

          <p className="relative z-[1] mt-4 text-xs text-n-600 md:text-right">
            {language === 'es'
              ? 'El contexto tributario se inyecta automáticamente en la conversación.'
              : 'Tax context is injected into the conversation automatically.'}
          </p>
        </div>
      </motion.section>
    </AreaShell>
  );
}
