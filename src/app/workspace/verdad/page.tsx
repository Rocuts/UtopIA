/**
 * Ventana III — La Verdad (Aseguramiento y Dictamen).
 *
 * Server Component mínimo: el área (`VerdadArea`) obtiene sus cifras del
 * Âncora NIIF del último informe (`useAncoraView`) o, en su defecto, de una
 * auditoría completa persistida (`getRegulatoryHealth`). Si no hay ninguna de
 * las dos, muestra N/D con el motivo.
 *
 * Auditoría ratios-kpis-12: esta página ya no usa KPIs de demostración ni el
 * proxy "asientos pyme confirmados" copiado a los ejes NIIF/tributario/legal
 * (daba 95/100 'favorable' sin workspace y 25/100 sin asientos). Tampoco fija
 * una opinión de auditoría.
 *
 * El tema lo aplica `ThemeProvider`; el ambiente lo aporta `AreaShell`. El
 * workspace shell ya agrega `data-lenis-prevent`.
 */

import { VerdadArea } from '@/components/workspace/areas/VerdadArea';
import { AreaShell } from '@/components/workspace/layouts/AreaShell';

export default function VerdadOverviewPage() {
  return (
    <AreaShell areaAccent="verdad">
      <VerdadArea />
    </AreaShell>
  );
}
