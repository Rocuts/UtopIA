/**
 * /workspace/pyme/empleados — "Mis Empleados" (server component shell).
 *
 * Renderiza `<MisEmpleadosView />`: hero verde con métricas de nómina,
 * banner PILA, equipo expandible, alerta de trabajador sin afiliar y
 * desglose del aporte del dueño como independiente.
 * Diseño del handoff "Pyme - Mis Empleados.html". Datos mock — wiring
 * real en una ola posterior (igual que PymeHub).
 */

import { MisEmpleadosView } from '@/components/workspace/pyme/MisEmpleadosView';

export default function MisEmpleadosPage() {
  return <MisEmpleadosView />;
}
