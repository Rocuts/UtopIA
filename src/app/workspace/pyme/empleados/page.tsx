/**
 * /workspace/pyme/empleados — "Mis Empleados" (server component shell).
 *
 * Renderiza `<MisEmpleadosView />` sobre la nómina REAL del workspace
 * (Ola 8): GET/POST /api/pyme/empleados + desglose de costo laboral
 * calculado en runtime (src/lib/payroll/prestaciones — factores legales
 * 2026 con citas). Alta inline, retiro lógico, banner PILA con el total
 * del registro y sección del dueño como independiente (base 40%).
 */

import { MisEmpleadosView } from '@/components/workspace/pyme/MisEmpleadosView';

export default function MisEmpleadosPage() {
  return <MisEmpleadosView />;
}
