'use client';

// ---------------------------------------------------------------------------
// DataSourceLadder — "Fuentes de datos conectadas · cada nivel activa más
// capacidades". Escalera de fuentes (balance → auxiliares → ERP → API DIAN →
// API banco). Reutilizada por las 4 áreas. Presentacional: el contenido viaja
// resuelto por i18n. Tokens UtopIA + lucide + polaridad correcta.
// ---------------------------------------------------------------------------

import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import { SOURCE_STYLE } from './source-style';
import type { DataSourceItem } from './types';

interface DataSourceLadderProps {
  /** Título de la sección (resuelto por i18n). */
  title: string;
  sources: DataSourceItem[];
}

export function DataSourceLadder({ title, sources }: DataSourceLadderProps) {
  return (
    <div className="rounded-lg glass-elite border border-n-200/70 p-4 md:p-5">
      <p className="uppercase tracking-eyebrow text-xs font-medium text-n-600 mb-3">
        {title}
      </p>
      <div
        className="grid gap-2.5"
        style={{
          gridTemplateColumns: `repeat(${sources.length}, minmax(0, 1fr))`,
        }}
      >
        {sources.map((s) => {
          const style = SOURCE_STYLE[s.key];
          const Icon = s.icon;
          return (
            <div
              key={s.key}
              className={cn(
                'rounded-lg p-3 bg-n-0 border border-n-200/70 flex flex-col gap-2.5',
                !s.active && 'opacity-60',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-flex h-7 w-7 items-center justify-center rounded-md shrink-0',
                    style.iconBg,
                    style.text,
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 inline-block h-1.5 w-1.5 rounded-full shrink-0',
                    s.active ? 'bg-success' : 'bg-n-400',
                  )}
                />
              </div>
              <span className="text-xs font-medium text-n-1000 leading-snug">
                {s.name}
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1 self-start px-2 py-0.5 rounded-full text-[10px] font-medium border',
                  style.chipBg,
                  style.chipBorder,
                  style.text,
                )}
              >
                {s.active && <Check className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden="true" />}
                {s.active ? '' : '+'}
                {s.capabilities} {s.badgeSuffix}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default DataSourceLadder;
