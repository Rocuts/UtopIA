/**
 * /workspace/intake — "Intake · Nuevo caso" (server component shell).
 *
 * Renderiza `<IntakeCasesPage />`: punto único para abrir un caso, con grid
 * de 11 tipos tintados por área, wizard de formulario y etapa de éxito que
 * enruta al módulo real. Diseño del handoff "Intake.html".
 */

import { IntakeCasesPage } from '@/components/workspace/intake/IntakeCasesPage';

export default function IntakePage() {
  return <IntakeCasesPage />;
}
