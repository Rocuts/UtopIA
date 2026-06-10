/**
 * /workspace/pyme — Contabilidad Pyme hub (server component shell).
 *
 * Renders `<PymeHub />`, the "1+1 · Contabilidad Pyme" hub page:
 * - Hero card with dynamic greeting, company name, and KPI north-star
 * - Quick-access grid (6 cards; "Foto de factura" is the primary green CTA)
 * - Semáforo de impuestos (IVA threshold progress)
 * - Two-column layout: upcoming payments + "Consejo del día" tip
 *
 * Data is mocked client-side; real wiring to /api/pyme/summary arrives in a
 * later wave. The original PymeCockpit is preserved at
 * src/components/workspace/pyme/cockpit/PymeCockpit.tsx for reference.
 */

import { PymeHub } from '@/components/workspace/pyme/PymeHub';

export default function PymePage() {
  return <PymeHub />;
}
