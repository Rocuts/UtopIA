// ---------------------------------------------------------------------------
// /workspace/contabilidad/periodos — Gestión de Periodos Fiscales
//
// Server wrapper. La vista es client-side porque hace fetch directo a
// /api/accounting/periods (cookie-based tenancy via proxy.ts) y orquesta
// modales + workflow durable de cierre. Mismo patrón que el resto del
// módulo de contabilidad.
// ---------------------------------------------------------------------------

import { PeriodsManagementView } from '@/components/workspace/accounting/PeriodsManagementView';

export default function PeriodosPage() {
  return <PeriodsManagementView />;
}
