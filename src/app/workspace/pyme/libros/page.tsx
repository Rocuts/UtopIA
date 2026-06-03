/**
 * /workspace/pyme/libros — listado de libros "profesional" (Server Component).
 *
 * SSR shell delgado que renderiza `<PymeBooksClassic />` (el antiguo
 * PymeLanding: lista + creación de libros con fetch client-side a
 * `/api/pyme/books`). Preservado tras el rediseño mobile-first de
 * `/workspace/pyme` (que ahora muestra el cockpit "Don Carlos"). La pantalla
 * "Mi Libro" del cockpit enlaza aquí.
 */
import { PymeBooksClassic } from '@/components/workspace/pyme/PymeBooksClassic';

export default function PymeBooksPage() {
  return <PymeBooksClassic />;
}
