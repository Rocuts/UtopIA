'use client';

// ---------------------------------------------------------------------------
// CapabilityZones — zonas temáticas de capacidades con chips coloreados por la
// fuente de datos que las habilita. Reutilizada por las 4 áreas. Presentacional:
// el contenido viaja resuelto por i18n; los colores son decorativos (identidad
// de fuente, regla de polaridad #5).
// ---------------------------------------------------------------------------

import { cn } from '@/lib/utils';
import { SOURCE_STYLE, ZONE_ACCENT } from './source-style';
import type { CapabilityZoneItem, SourceKey } from './types';

interface CapabilityZonesProps {
  /** Texto-leyenda superior (ej. "31 capacidades · estado según fuente"). */
  legendTitle: string;
  zones: CapabilityZoneItem[];
  /** Labels de cada fuente, resueltos por i18n (para chips + leyenda). */
  sourceLabels: Record<SourceKey, string>;
}

/** Orden canónico de fuentes en la leyenda. */
const LEGEND_ORDER: SourceKey[] = ['balance', 'auxiliares', 'erp', 'apiDIAN', 'apiBanco'];

export function CapabilityZones({
  legendTitle,
  zones,
  sourceLabels,
}: CapabilityZonesProps) {
  return (
    <div className="flex flex-col gap-3">
      {/* Leyenda */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <span className="uppercase tracking-eyebrow text-xs font-medium text-n-600">
          {legendTitle}
        </span>
        <div className="flex items-center gap-3 flex-wrap">
          {LEGEND_ORDER.map((key) => (
            <span
              key={key}
              className="inline-flex items-center gap-1.5 text-[11px] text-n-600"
            >
              <span
                aria-hidden="true"
                className={cn('inline-block h-1.5 w-1.5 rounded-full', SOURCE_STYLE[key].dot)}
              />
              {sourceLabels[key]}
            </span>
          ))}
        </div>
      </div>

      {/* Zonas */}
      {zones.map((zone, zi) => {
        const ZoneIcon = zone.icon;
        const accent = ZONE_ACCENT[zone.accent];
        return (
          <div
            key={`${zone.name}-${zi}`}
            className="rounded-lg border border-n-200/70 overflow-hidden"
          >
            {/* Header de zona */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 bg-n-50 border-b border-n-200/70">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-flex h-7 w-7 items-center justify-center rounded-md shrink-0',
                    accent.bg,
                    accent.text,
                  )}
                >
                  <ZoneIcon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-n-1000 leading-tight truncate">
                    {zone.name}
                  </div>
                  <div className="text-xs text-n-600 leading-tight truncate">
                    {zone.subtitle}
                  </div>
                </div>
              </div>
              <span className="text-xs text-n-600 shrink-0">{zone.count}</span>
            </div>

            {/* Grid de capacidades */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {zone.capabilities.map((cap, ci) => {
                const style = SOURCE_STYLE[cap.source];
                const cols = 3;
                const isLastRow =
                  Math.floor(ci / cols) === Math.floor((zone.capabilities.length - 1) / cols);
                return (
                  <div
                    key={`${cap.name}-${ci}`}
                    className={cn(
                      'flex gap-2.5 items-start p-3',
                      'border-n-200/70',
                      // separadores internos sutiles
                      'border-b lg:border-r',
                      isLastRow && 'lg:border-b-0',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn('mt-1 h-2 w-2 rounded-full shrink-0', style.dot)}
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-n-1000 leading-snug">
                        {cap.name}
                      </div>
                      <div className="text-[11px] text-n-600 leading-snug mt-0.5">
                        {cap.desc}
                      </div>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 mt-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium border',
                          style.chipBg,
                          style.chipBorder,
                          style.text,
                        )}
                      >
                        {sourceLabels[cap.source]}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default CapabilityZones;
