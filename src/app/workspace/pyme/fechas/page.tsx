/**
 * /workspace/pyme/fechas — "Mis Fechas" (server component shell).
 *
 * Renderiza `<MisFechasView />`: hero verde con contadores y barra de 12
 * meses, obligaciones próximas con acciones y nota de multas.
 * Diseño del handoff "Pyme - Mis Fechas.html". Datos mock — wiring real
 * en una ola posterior (igual que PymeHub).
 */

import { MisFechasView } from '@/components/workspace/pyme/MisFechasView';

export default function MisFechasPage() {
  return <MisFechasView />;
}
