'use client';
/**
 * PymeShell — contenedor mobile-first (≤480px, columna única) del módulo
 * Contabilidad Pyme, pensado para embeberse en el Centro de Comando desktop
 * (patrón WhatsApp Web / Spotify Web).
 *
 * Compone: barra superior oscura · área de contenido lima scrolleable · footer
 * de marca · tab bar inferior de 4 destinos. Carga Nunito + DM Mono dentro del
 * módulo (sin tocar el layout global) y las cascadea a todo el subárbol.
 *
 * Navegación: estado `view`. Las 4 pestañas mapean a 4 vistas; "Liquidar
 * contrato" es una sub-vista empujada desde "Mi equipo" (con botón Atrás).
 *
 * ASUNCIÓN: el cap del contenedor se fija en 430px (dentro del máximo de 480)
 * para dar sensación de teléfono; el ancho es 100% para adaptarse al panel.
 */
import React, { useState } from 'react';
import { PYME, RADIUS, WHITE, FONT, rgba } from '../design/tokens';
import { pymeFontVars } from '../design/fonts';
import { uiFont, monoFont } from '../design/primitives';
import { MiEquipoNomina } from './MiEquipoNomina';
import { Cifras2026 } from './Cifras2026';
import { LiquidarMes } from './LiquidarMes';
import { Prestaciones } from './Prestaciones';
import { LiquidarContrato } from './LiquidarContrato';

export type PymeView = 'equipo' | 'pagos' | 'prestaciones' | 'fechas' | 'liquidarContrato';

export interface ScreenProps {
  go: (view: PymeView) => void;
}

/* Caja-logo "1+1" reutilizable (barra superior + footer). */
export function Logo11({ size = 26 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 7,
        background: rgba(PYME.gold, 0.12),
        border: `1px solid ${rgba(PYME.gold, 0.55)}`,
        color: PYME.gold,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.42,
        fontWeight: 800,
        flexShrink: 0,
        fontFamily: FONT.ui,
      }}
    >
      1+1
    </div>
  );
}

const TABS: { view: PymeView; icon: string; label: string }[] = [
  { view: 'equipo', icon: '🏠', label: 'Inicio' },
  { view: 'pagos', icon: '📋', label: 'Pagos' },
  { view: 'prestaciones', icon: '👷', label: 'Nómina' },
  { view: 'fechas', icon: '📅', label: 'Fechas' },
];

export function PymeShell() {
  const [view, setView] = useState<PymeView>('equipo');
  const go = (v: PymeView) => setView(v);

  const screen = (() => {
    switch (view) {
      case 'equipo':
        return <MiEquipoNomina go={go} />;
      case 'pagos':
        return <LiquidarMes go={go} />;
      case 'prestaciones':
        return <Prestaciones go={go} />;
      case 'fechas':
        return <Cifras2026 go={go} />;
      case 'liquidarContrato':
        return <LiquidarContrato go={go} />;
      default:
        return null;
    }
  })();

  return (
    <div
      className={pymeFontVars}
      style={{
        width: '100%',
        maxWidth: 430,
        margin: '0 auto',
        height: '100%',
        minHeight: 560,
        display: 'flex',
        flexDirection: 'column',
        background: PYME.bg,
        borderRadius: RADIUS.xl,
        overflow: 'hidden',
        boxShadow: `0 18px 60px ${rgba(PYME.greenDark, 0.18)}`,
        ...uiFont,
      }}
    >
      {/* ── Barra superior ── */}
      <header
        style={{
          flexShrink: 0,
          background: PYME.ink,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '10px 12px',
        }}
      >
        <Logo11 />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: rgba(PYME.gold, 0.7), fontSize: 12.5, fontWeight: 800, lineHeight: 1.1 }}>
            Contabilidad Pyme
          </div>
          <div style={{ color: rgba(WHITE, 0.4), fontSize: 9, marginTop: 1 }}>
            1+1 Financial Orchestrator
          </div>
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: rgba(PYME.success, 0.16),
            color: PYME.success,
            fontSize: 10.5,
            fontWeight: 800,
            padding: '4px 9px',
            borderRadius: 999,
          }}
        >
          ✅ 2026
        </span>
      </header>

      {/* ── Contenido (scroll propio: data-lenis-prevent evita que Lenis mate la rueda) ── */}
      <main
        data-lenis-prevent
        style={{
          flex: 1,
          overflowY: 'auto',
          background: PYME.bg,
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {screen}

        {/* ── Footer de marca ── */}
        <footer
          style={{
            marginTop: 6,
            background: PYME.ink,
            borderRadius: RADIUS.md,
            padding: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: 9,
          }}
        >
          <Logo11 size={22} />
          <div style={{ color: rgba(PYME.gold, 0.6), fontSize: 10, fontWeight: 600, lineHeight: 1.3 }}>
            1+1 Financial Orchestrator · Colombia 2026
          </div>
        </footer>
      </main>

      {/* ── Tab bar inferior ── */}
      <nav
        style={{
          flexShrink: 0,
          background: PYME.card,
          borderTop: `1px solid ${rgba(PYME.greenDark, 0.1)}`,
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          padding: '6px 4px',
        }}
      >
        {TABS.map((t) => {
          const active = view === t.view || (view === 'liquidarContrato' && t.view === 'equipo');
          return (
            <button
              key={t.view}
              type="button"
              onClick={() => go(t.view)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '4px 0',
                color: active ? PYME.greenDark : PYME.textHint,
                fontWeight: active ? 800 : 600,
                ...uiFont,
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>{t.icon}</span>
              <span style={{ fontSize: 10 }}>{t.label}</span>
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  marginTop: 1,
                  background: active ? PYME.green : 'transparent',
                }}
              />
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/** Texto técnico reutilizable (no usado fuera, exportado por simetría). */
export const shellMono = monoFont;

export default PymeShell;
