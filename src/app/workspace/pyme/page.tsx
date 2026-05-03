/**
 * Pyme home page (server component).
 *
 * SSR shell delgado: renderiza `<PymeLanding />` que se ocupa del fetch
 * client-side a `/api/pyme/books`. Hacerlo client-side evita tener que
 * reconstruir absolute URLs ni clonar la cookie de tenant en SSR para
 * un endpoint que ya esta detras de middleware. Mantiene el layout del
 * workspace consistente (sticky header + sidebar heredados).
 */

import { PymeLanding } from '@/components/workspace/pyme/PymeLanding';

export default function PymePage() {
  return <PymeLanding />;
}
