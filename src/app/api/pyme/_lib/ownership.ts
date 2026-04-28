import 'server-only';
import * as repo from '@/lib/db/pyme';
import type { PymeBook } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// Helpers compartidos entre handlers de `/api/pyme/*`.
// ---------------------------------------------------------------------------
// La carpeta `_lib` (con underscore) es ignorada por el router de Next; los
// modulos aqui son utilidades privadas del modulo, no rutas. Centralizamos la
// verificacion de ownership de libros para evitar lecturas redundantes y
// garantizar respuestas 404 consistentes (nunca 403, asi no se filtra
// existencia a callers de otro workspace).
// ---------------------------------------------------------------------------

/**
 * Error con `status` HTTP. Los handlers lo detectan en su `catch` y
 * devuelven `NextResponse.json(...)` con el codigo correspondiente.
 */
export class HttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

/**
 * Verifica que el libro existe y pertenece al workspace actual. Lanza
 * `HttpError(404, 'book_not_found')` si no — uniforme tanto para libros
 * inexistentes como para libros de otro tenant.
 */
export async function assertBookOwned(
  bookId: string,
  workspaceId: string,
): Promise<PymeBook> {
  const book = await repo.getBook(bookId, workspaceId);
  if (!book) {
    throw new HttpError('book_not_found', 404);
  }
  return book;
}
