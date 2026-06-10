/**
 * /workspace/pyme/pagos — "Mis Pagos" (server component shell).
 *
 * Renderiza `<MisPagosView />`: hero rojo de deuda, estado de pagos,
 * balanza RST vs Ordinario con slider en vivo (useTaxCalculator) y
 * borradores de formularios listos.
 * Diseño del handoff "Pyme - Mis Pagos.html". Montos mock — la balanza
 * calcula en vivo con src/lib/tax/taxCalculator (tarifas ilustrativas).
 */

import { MisPagosView } from '@/components/workspace/pyme/MisPagosView';

export default function MisPagosPage() {
  return <MisPagosView />;
}
