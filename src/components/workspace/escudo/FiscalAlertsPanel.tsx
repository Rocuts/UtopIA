'use client';

/**
 * FiscalAlertsPanel — Capa 5: Panel de alertas fiscales accionables.
 *
 * Renderiza las alertas del FiscalSnapshot como tarjetas accionables.
 * El usuario puede resolver una alerta via PATCH /api/escudo/fiscal-anchor/alerts/[id].
 * La resolución es optimista — la alerta desaparece del panel inmediatamente.
 *
 * Polaridad de tokens: texto primario text-n-1000, secundario text-n-700/800.
 * NUNCA usa text-n-100..n-400 como tinta legible.
 */

import { useState, useCallback } from 'react';
import { AlertTriangle, Info, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AlertView } from '@/components/workspace/areas/EscudoArea';

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface FiscalAlertsPanelProps {
  alertas: AlertView[];
  language: 'es' | 'en';
}

// ─── Colores por severidad ────────────────────────────────────────────────────

const SEVERITY_ICON: Record<AlertView['severidad'], React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  error: AlertTriangle,
  warning: AlertTriangle,
  info: Info,
};

const SEVERITY_COLORS: Record<AlertView['severidad'], { border: string; icon: string; badge: string; badgeText: string }> = {
  error: {
    border: 'border-[rgb(239_68_68_/_0.45)]',
    icon: 'bg-[rgb(239_68_68_/_0.12)] text-danger',
    badge: 'bg-[rgb(239_68_68_/_0.12)] border-[rgb(239_68_68_/_0.3)] text-danger',
    badgeText: 'ERROR',
  },
  warning: {
    border: 'border-[rgb(234_179_8_/_0.45)]',
    icon: 'bg-[rgb(234_179_8_/_0.12)] text-warning',
    badge: 'bg-[rgb(234_179_8_/_0.12)] border-[rgb(234_179_8_/_0.3)] text-warning',
    badgeText: 'ADVERTENCIA',
  },
  info: {
    border: 'border-[rgb(99_102_241_/_0.35)]',
    icon: 'bg-[rgb(99_102_241_/_0.12)] text-[rgb(129_140_248)]',
    badge: 'bg-[rgb(99_102_241_/_0.12)] border-[rgb(99_102_241_/_0.3)] text-[rgb(129_140_248)]',
    badgeText: 'INFO',
  },
};

const SEVERITY_COLORS_EN: Record<AlertView['severidad'], string> = {
  error: 'ERROR',
  warning: 'WARNING',
  info: 'INFO',
};

// ─── Componente ───────────────────────────────────────────────────────────────

export function FiscalAlertsPanel({ alertas, language }: FiscalAlertsPanelProps) {
  // Optimistic: ocultamos las alertas resueltas inmediatamente.
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());

  const handleResolve = useCallback(
    async (id: string) => {
      // Marcar como "resolviendo" para deshabilitar el botón.
      setResolvingIds((prev) => new Set(prev).add(id));
      try {
        await fetch(`/api/escudo/fiscal-anchor/alerts/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'resolve' }),
        });
      } catch {
        // Best-effort: si falla, igual ocultamos optimisticamente.
      } finally {
        // Optimistic: quitar de la UI independientemente del resultado.
        setResolvedIds((prev) => new Set(prev).add(id));
        setResolvingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [],
  );

  const visibleAlertas = alertas.filter(
    (a) => !resolvedIds.has(a.id) && a.status !== 'resolved',
  );

  if (visibleAlertas.length === 0) return null;

  return (
    <section
      aria-label={language === 'es' ? 'Alertas fiscales accionables' : 'Actionable fiscal alerts'}
      className="flex flex-col gap-3"
    >
      <div className="flex items-center gap-2">
        <span className="uppercase tracking-eyebrow text-xs font-medium text-n-500">
          {language === 'es' ? 'Alertas fiscales' : 'Fiscal alerts'}
        </span>
        <span className="inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-[rgb(168_56_56_/_0.18)] text-area-escudo text-[10px] font-bold">
          {visibleAlertas.length}
        </span>
      </div>

      <ul role="list" className="flex flex-col gap-3">
        {visibleAlertas.map((alerta) => (
          <AlertCard
            key={alerta.id}
            alerta={alerta}
            language={language}
            isResolving={resolvingIds.has(alerta.id)}
            onResolve={handleResolve}
          />
        ))}
      </ul>
    </section>
  );
}

// ─── Tarjeta de alerta individual ────────────────────────────────────────────

interface AlertCardProps {
  alerta: AlertView;
  language: 'es' | 'en';
  isResolving: boolean;
  onResolve: (id: string) => void;
}

function AlertCard({ alerta, language, isResolving, onResolve }: AlertCardProps) {
  const colors = SEVERITY_COLORS[alerta.severidad];
  const Icon = SEVERITY_ICON[alerta.severidad];
  const badgeText = language === 'es'
    ? colors.badgeText
    : SEVERITY_COLORS_EN[alerta.severidad];

  return (
    <li
      role="listitem"
      className={cn(
        'relative flex flex-col gap-3 p-4 rounded-xl glass-elite-elevated border',
        colors.border,
      )}
    >
      <div className="flex items-start gap-3">
        {/* Icono de severidad */}
        <span
          aria-hidden="true"
          className={cn(
            'shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-md',
            colors.icon,
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>

        {/* Contenido */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={cn(
                  'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border',
                  colors.badge,
                )}
              >
                {badgeText}
              </span>
              <span className="text-xs font-mono text-n-500">{alerta.codigo}</span>
            </div>

            {/* Botón resolver */}
            <button
              type="button"
              onClick={() => onResolve(alerta.id)}
              disabled={isResolving}
              aria-label={
                language === 'es'
                  ? `Marcar como resuelta: ${alerta.titulo}`
                  : `Mark as resolved: ${alerta.titulo}`
              }
              className={cn(
                'shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md',
                'text-xs font-medium',
                'bg-n-50 dark:bg-n-900 border border-n-200 dark:border-n-700',
                'text-n-700 hover:text-n-1000 hover:border-n-400 dark:hover:border-n-500',
                'transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:text-n-600',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-1',
              )}
            >
              {isResolving ? (
                <span className="inline-block h-3 w-3 rounded-full border-2 border-n-500 border-t-transparent animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              )}
              {language === 'es' ? 'Resolver' : 'Resolve'}
            </button>
          </div>

          <p className="mt-1.5 text-sm font-medium text-n-1000 leading-snug">
            {alerta.titulo}
          </p>
          <p className="mt-0.5 text-sm text-n-700 leading-relaxed">
            {alerta.mensaje}
          </p>

          {alerta.accion && (
            <p className="mt-1.5 text-xs text-n-700 italic leading-relaxed">
              {language === 'es' ? 'Acción: ' : 'Action: '}
              <span className="not-italic text-n-800">{alerta.accion}</span>
            </p>
          )}
        </div>
      </div>

      {/* Footer — norma citada */}
      <div className="border-t border-n-200 dark:border-n-800 pt-2 flex items-center gap-2">
        <span className="text-xs text-n-500">
          {language === 'es' ? 'Norma:' : 'Rule:'}
        </span>
        <span className="text-xs font-mono font-medium text-n-700">
          {alerta.norma}
        </span>
      </div>
    </li>
  );
}
