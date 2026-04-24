'use client';

/**
 * Ventana III — La Verdad (Aseguramiento y Dictamen).
 *
 * Overview page delegating to `VerdadArea`. El tema (light/dark/system) lo
 * aplica `ThemeProvider` en <html>; el ambiente (orbs + contenedor) lo aporta
 * `AreaShell`. El workspace shell ya agrega `data-lenis-prevent` — no hace
 * falta repetirlo aquí.
 */

import { VerdadArea } from '@/components/workspace/areas/VerdadArea';
import { AreaShell } from '@/components/workspace/layouts/AreaShell';
import { mockCompliance } from '@/lib/kpis/mocks';

export default function VerdadOverviewPage() {
  return (
    <AreaShell areaAccent="verdad">
      <VerdadArea kpi={mockCompliance} lastOpinion="favorable" />
    </AreaShell>
  );
}
