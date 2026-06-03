'use client';

/**
 * PymeLanding — home del módulo Contabilidad Pyme.
 *
 * Reexporta `PymeCockpit`, el panel ejecutivo del propietario de escritorio para
 * `/workspace/pyme` (nativo del Centro de Comando: SectionHeader + PremiumKpiCard,
 * acento gold, tokens `--n-*` dark-mode aware, íconos lucide). Datos MOCK por ahora.
 *
 * El listado de libros "profesional" se preserva como `PymeBooksClassic` en
 * `/workspace/pyme/libros` (enlazado desde la tarjeta "Mis libros") — sin pérdida
 * de funcionalidad. Lo consume `/workspace/pyme/page.tsx` (server component, shell
 * SSR fino).
 */
export { PymeCockpit as PymeLanding } from './cockpit/PymeCockpit';
