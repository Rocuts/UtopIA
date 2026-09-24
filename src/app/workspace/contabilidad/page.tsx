/**
 * /workspace/contabilidad — Hub de Contabilidad.
 *
 * Integración IW5b (auditoría 2026-09-24): la página era una maqueta con
 * asientos y saldos de demostración presentados como del cliente. Monta el
 * landing real (`ContabilidadLanding`), que lee el período abierto y los
 * últimos asientos del workspace desde /api/accounting/*.
 */

import { ContabilidadLanding } from '@/components/workspace/accounting/ContabilidadLanding';

export default function ContabilidadPage() {
  return <ContabilidadLanding />;
}
