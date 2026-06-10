/**
 * /workspace/pyme/libro — "Mi Libro" (server component shell).
 *
 * Renderiza `<MiLibroView />`: hero verde con métricas del mes, filtros
 * Todos/Ingresos/Gastos, lista de transacciones y banner de balance.
 * Diseño del handoff "Pyme - Mi Libro.html". Datos mock — wiring real a
 * /api/pyme/entries en una ola posterior (igual que PymeHub).
 *
 * Nota: /workspace/pyme/libros (plural) conserva el listado "profesional"
 * de libros (PymeBooksClassic); esta ruta es la vista simple del handoff.
 */

import { MiLibroView } from '@/components/workspace/pyme/MiLibroView';

export default function MiLibroPage() {
  return <MiLibroView />;
}
