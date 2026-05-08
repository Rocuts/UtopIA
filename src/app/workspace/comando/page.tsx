// ---------------------------------------------------------------------------
// /workspace/comando — Vista Dueño v2 (P5)
//
// Centro de Mando Financiero con los 4 micro-dashboards de pilares + 5
// widgets ECharts. En MVP renderiza con mock data; cuando el usuario suba
// un balance, el server-side puede pasar los datos reales en `props`.
// ---------------------------------------------------------------------------

import { PillarsCommandCenter } from '@/components/workspace/pillars/PillarsCommandCenter';

export default function ComandoPage() {
  return <PillarsCommandCenter demo />;
}
