'use client';

/**
 * NiifEliteButton — CTA premium "Informe NIIF Elite"
 *
 * Botón estrella del Centro de Comando. Gradient dorado animado con shimmer
 * continuo, glow permanente que se intensifica al hover. Al hacer click:
 *   1. setActiveCaseType('niif_report')
 *   2. setActiveMode('pipeline')
 *   3. setIntakeModalOpen(true)   (abre el IntakeModal de NIIF)
 *
 * Respeta useReducedMotion: sin shimmer animado ni entrada resortada.
 *
 * Uses design-system tokens for background, shadow, and ring colors.
 * The gradient stops reference canonical palette values (gold-500/600)
 * as raw rgb() triplets — required inline for background-image composition.
 */
import { useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cn } from '@/lib/utils';

export interface NiifEliteButtonProps {
  /** 'md' (default): compact para header · 'lg': prominente para dashboard */
  size?: 'md' | 'lg';
  /** Usa la versión larga "Informe NIIF Elite en determinado periodo" en vez del label corto */
  long?: boolean;
  /** Override visual — por defecto sólo ícono + label; si true muestra el caption secundario */
  showCaption?: boolean;
  className?: string;
}

export function NiifEliteButton({
  size = 'md',
  long = false,
  showCaption = false,
  className,
}: NiifEliteButtonProps) {
  const { t, language } = useLanguage();
  const { setActiveCaseType, setActiveMode, setIntakeModalOpen } = useWorkspace();
  const prefersReduced = useReducedMotion();
  const router = useRouter();

  const label = long
    ? t.elite.niifEliteCTALong
    : t.elite.niifEliteCTA;

  const handleClick = () => {
    setActiveCaseType('niif_report');
    setActiveMode('pipeline');
    setIntakeModalOpen(true);
    // Garantiza que estamos en /workspace para que el modal + pipeline renderee.
    router.push('/workspace');
  };

  const sizeClasses = useMemo(() => {
    return size === 'lg'
      ? 'px-5 py-2.5 text-sm gap-2.5'
      : 'px-3.5 py-2 text-xs gap-2';
  }, [size]);

  const iconSize = size === 'lg' ? 'w-4 h-4' : 'w-3.5 h-3.5';

  // Shimmer: superposición con gradiente desplazándose. Sin motion en reduced-motion.
  const shimmerAnim = prefersReduced
    ? undefined
    : {
        backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
      };

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      whileHover={prefersReduced ? undefined : { scale: 1.02, y: -1 }}
      whileTap={prefersReduced ? undefined : { scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      aria-label={label}
      title={t.elite.niifEliteCTALong}
      data-testid="niif-elite-cta"
      className={cn(
        'relative inline-flex items-center justify-center shrink-0 rounded-md font-semibold',
        'text-n-1000 tracking-wide whitespace-nowrap overflow-hidden',
        'transition-shadow duration-300 focus:outline-none',
        'focus-visible:ring-2 focus-visible:ring-gold-600 focus-visible:ring-offset-2 focus-visible:ring-offset-n-1000',
        'shadow-glow-gold-soft hover:shadow-glow-gold',
        sizeClasses,
        className,
      )}
      style={{
        // gold-500 → rgb(184 147 74), gold-600 → rgb(232 180 44)
        backgroundImage:
          'linear-gradient(135deg, rgb(184 147 74) 0%, rgb(232 180 44) 35%, rgb(245 208 121) 50%, rgb(232 180 44) 65%, rgb(184 147 74) 100%)',
        backgroundSize: '220% 220%',
      }}
    >
      {/* Animated shimmer overlay (purely decorative) */}
      {!prefersReduced && (
        <motion.span
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          animate={shimmerAnim}
          transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
          style={{
            backgroundImage:
              'linear-gradient(110deg, transparent 20%, rgb(255 255 255 / 0.35) 40%, rgb(255 255 255 / 0.55) 50%, rgb(255 255 255 / 0.35) 60%, transparent 80%)',
            backgroundSize: '250% 100%',
            mixBlendMode: 'overlay',
          }}
        />
      )}

      {/* Inner wine stroke for depth */}
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-md pointer-events-none"
        style={{
          // danger (bordeaux wine) → rgb(168 56 56)
          boxShadow:
            'inset 0 1px 0 rgb(255 255 255 / 0.35), inset 0 -1px 0 rgb(168 56 56 / 0.35)',
        }}
      />

      <Sparkles className={cn('relative z-10 drop-shadow-sm', iconSize)} strokeWidth={2.2} />
      <span className="relative z-10 uppercase tracking-wider">
        {label}
      </span>
      {showCaption && (
        <span
          className="relative z-10 hidden md:inline text-2xs font-normal opacity-80 normal-case tracking-normal"
        >
          · {language === 'es' ? 'Producto estrella' : 'Flagship product'}
        </span>
      )}
    </motion.button>
  );
}

export default NiifEliteButton;
