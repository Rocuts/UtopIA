// ---------------------------------------------------------------------------
// Tipos compartidos de las 4 áreas — fuentes de datos + zonas de capacidades
// ---------------------------------------------------------------------------
// Contrato de presentación. El contenido (labels) viaja resuelto por i18n desde
// `dictionaries.ts`; aquí solo la forma estructural que consumen los componentes
// `DataSourceLadder` y `CapabilityZones`.
// ---------------------------------------------------------------------------

import type React from 'react';

export type LucideIconType = React.ComponentType<{
  className?: string;
  strokeWidth?: number;
}>;

/** Identidad de la fuente de datos que habilita una capacidad. */
export type SourceKey =
  | 'balance'
  | 'auxiliares'
  | 'erp'
  | 'apiDIAN'
  | 'apiBanco'
  | 'pronto';

/** Un nivel de la escalera "Fuentes de datos conectadas". */
export interface DataSourceItem {
  key: SourceKey;
  /** Label resuelto por i18n (ej. "Balance de prueba"). */
  name: string;
  icon: LucideIconType;
  /** true = fuente conectada hoy; false = se activa al conectarla. */
  active: boolean;
  /** Nº de capacidades que habilita este nivel. */
  capabilities: number;
  /** Sufijo del badge resuelto por i18n (ej. "activas", "se activan"). */
  badgeSuffix: string;
}

/** Una capacidad dentro de una zona, coloreada por su fuente habilitante. */
export interface CapabilityItem {
  name: string;
  desc: string;
  source: SourceKey;
}

/** Acento cromático del ícono de una zona (rol, no color literal). */
export type ZoneAccent = 'wine' | 'gold' | 'info' | 'success' | 'futuro';

/** Una zona temática de capacidades (ej. "Declaraciones tributarias"). */
export interface CapabilityZoneItem {
  icon: LucideIconType;
  accent: ZoneAccent;
  name: string;
  subtitle: string;
  /** Texto del contador resuelto por i18n (ej. "6 formularios"). */
  count: string;
  capabilities: CapabilityItem[];
}
