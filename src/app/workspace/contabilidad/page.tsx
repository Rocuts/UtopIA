/**
 * /workspace/contabilidad — landing del núcleo contable (Server Component).
 *
 * SSR shell delgado: el contenido vivo (acciones primarias + lista de
 * "Últimos asientos") lo aporta `<ContabilidadLanding />`, un Client
 * Component que hace fetch a `/api/accounting/*`. Ese fetch viaja con la
 * cookie httpOnly `utopia_workspace_id` que ya setea
 * `getOrCreateWorkspace()` desde los route handlers.
 *
 * El patrón es idéntico al usado en `/workspace/pyme/page.tsx` y evita
 * tener que reconstruir absolute URLs ni clonar la cookie en SSR para
 * un endpoint que ya está detrás de proxy.ts (rate-limit, CSRF, headers).
 */
import { ContabilidadLanding } from '@/components/workspace/accounting/ContabilidadLanding';

export const dynamic = 'force-dynamic';

export default function ContabilidadPage() {
  return <ContabilidadLanding />;
}
