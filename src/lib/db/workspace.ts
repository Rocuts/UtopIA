import 'server-only';
import { cookies, headers } from 'next/headers';
import { eq, and, asc, isNull } from 'drizzle-orm';
import { isAuthConfigured } from '@/lib/auth/enabled';
import { getDb } from './client';
import { workspaces, type Workspace } from './schema';

const COOKIE_NAME = 'utopia_workspace_id';

// ---------------------------------------------------------------------------
// Vida de la cookie: 90 días, no 5 años.
//
// En fase 1 el valor de esta cookie ES el bearer del tenant: quien lo tenga
// opera como ese workspace (no hay password detrás). Con maxAge de 5 años, un
// robo de cookie — equipo compartido, backup del perfil del navegador, un XSS
// que lograra leerla vía un bug de httpOnly — daba acceso prácticamente
// perpetuo, y no existe ningún mecanismo de revocación del lado servidor.
//
// 90 días es el techo habitual de una sesión persistente tipo "recordarme", y
// NO castiga al usuario activo porque la renovamos en cada resolución válida
// (`renewWorkspaceCookie`): la ventana es de INACTIVIDAD, no absoluta. Un
// contribuyente con obligación cuatrimestral (IVA, ~120 días entre
// declaraciones) entra varias veces dentro de cada ciclo, así que el reloj se
// reinicia mucho antes de vencer.
// ---------------------------------------------------------------------------
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 días de inactividad

type CookieJar = Awaited<ReturnType<typeof cookies>>;

function workspaceCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === 'production',
  };
}

/**
 * Renovación deslizante de la cookie del tenant anónimo.
 *
 * Va en try/catch a propósito: `getOrCreateWorkspace()` también se llama desde
 * Server Components (/workspace/contexto, /workspace/comando) y ahí el jar es
 * de SOLO LECTURA — Next lanza "Cookies can only be modified in a Server
 * Action or Route Handler". No renovar en ese caso es aceptable (la siguiente
 * llamada desde un Route Handler o Server Action la renueva); reventar el
 * render de la página, no.
 */
function renewWorkspaceCookie(jar: CookieJar, id: string): void {
  try {
    jar.set(COOKIE_NAME, id, workspaceCookieOptions());
  } catch {
    /* jar de solo lectura (Server Component) — la renovación es best-effort. */
  }
}

// ---------------------------------------------------------------------------
// Auth-aware workspace resolution
//
// La fase la decide `isAuthConfigured()` (src/lib/auth/enabled.ts), la misma
// fuente que usan el proxy, `requireAuthSession()` y /api/auth/[...all]: el
// resolutor nunca puede ser más laxo que la puerta que tiene delante.
//
//   Fase 1 (sin secreto): el tenant es la cookie anónima.
//   Fase 2 (con secreto): el tenant es el workspace del usuario de la sesión
//     (columna user_id). Sin sesión válida NO hay tenant: la cookie anónima
//     deja de ser respaldo y los tres resolutores fallan cerrado.
//
// Los datos de la fase 1 se heredan al registrarse: el hook
// `user.create.after` de src/lib/auth/config.ts lee la cookie por su cuenta y
// llama a `claimAnonymousWorkspace(userId, cookieWorkspaceId)`.
// ---------------------------------------------------------------------------

/** Fase 2 sin sesión válida: no hay tenant que resolver ni que crear. */
export class WorkspaceAuthRequiredError extends Error {
  constructor() {
    super('Authentication required.');
    this.name = 'WorkspaceAuthRequiredError';
  }
}

// Lazy import to avoid pulling pg.Pool into Edge runtimes.
async function getAuthSession(): Promise<{ userId: string } | null> {
  if (!isAuthConfigured()) return null;
  try {
    const { auth } = await import('@/lib/auth/config');
    const h = await headers();
    const session = await auth.api.getSession({ headers: h });
    return session ? { userId: session.user.id } : null;
  } catch {
    return null;
  }
}

export async function getOrCreateWorkspace(): Promise<Workspace> {
  const db = getDb();

  // ── Auth path (isAuthConfigured() + valid session) ─────────────────────
  const session = await getAuthSession();
  if (session) {
    const found = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.userId, session.userId))
      // Determinismo: `user_id` no es UNIQUE en la tabla (el índice parcial
      // que lo haría único está pendiente de aplicarse a mano — ver
      // migrations/0020_workspaces_user_id_uq.sql). Sin ORDER BY, `.limit(1)`
      // sobre dos filas del mismo usuario devuelve la que el planner prefiera
      // ese día: el usuario "cambiaría de empresa" sin tocar nada. El más
      // antiguo es el workspace original.
      .orderBy(asc(workspaces.createdAt))
      .limit(1);
    if (found.length > 0) return found[0];

    // First login — create workspace linked to this user.
    const [created] = await db
      .insert(workspaces)
      .values({ userId: session.userId })
      .returning();
    return created;
  }

  // Fase 2 sin sesión: ni se reutiliza ni se crea un tenant anónimo. Va antes
  // de leer la cookie para que no haya lectura, INSERT ni Set-Cookie.
  if (isAuthConfigured()) throw new WorkspaceAuthRequiredError();

  // ── Anonymous cookie path (fase 1: auth no configurada) ─────────────────
  const jar = await cookies();
  const existingId = jar.get(COOKIE_NAME)?.value;

  if (existingId) {
    const found = await db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.id, existingId), isNullUserId()))
      .limit(1);
    if (found.length > 0) {
      // Ventana deslizante: cada resolución válida reinicia los 90 días.
      renewWorkspaceCookie(jar, found[0].id);
      return found[0];
    }
    // Cookie apunta a workspace ya borrado o reclamado — recreamos.
  }

  const [created] = await db.insert(workspaces).values({}).returning();
  jar.set(COOKIE_NAME, created.id, workspaceCookieOptions());
  return created;
}

// Drizzle helper: workspaces with no user_id (anonymous).
function isNullUserId() {
  // drizzle-orm SQL: `user_id IS NULL`
  return isNull(workspaces.userId);
}

export async function getCurrentWorkspaceId(): Promise<string | null> {
  const session = await getAuthSession();
  if (session) {
    const db = getDb();
    const found = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.userId, session.userId))
      // Mismo criterio que getOrCreateWorkspace(): el más antiguo gana, para
      // que las tres funciones resuelvan SIEMPRE el mismo workspace.
      .orderBy(asc(workspaces.createdAt))
      .limit(1);
    return found[0]?.id ?? null;
  }
  // Camino cookie: mismas dos guardas que `requireWorkspace()` — el formato y
  // `user_id IS NULL` — en vez de devolver el valor crudo de la cookie.
  //
  // Nueve rutas resuelven su tenant por aquí (chat, rag, tax-planning, los
  // cuatro tramos de financial-report, escudo/fiscal-anchor —que ESCRIBE en
  // `reports`— y pyme/uploads), así que devolver lo que venga en el header
  // significaba dos cosas: un valor no-UUID llegaba tal cual al WHERE y
  // Postgres respondía 500 filtrando su mensaje de error, y un id válido pero
  // ajeno alcanzaba incluso un workspace YA reclamado por una cuenta, porque
  // faltaba el filtro que su hermana sí aplica. Resolver contra la DB también
  // cierra el fail-open del `catch` de `getAuthSession()`: si la lectura de
  // sesión falla de forma transitoria en fase 2, el camino cookie ya no alcanza
  // un workspace con dueño — falla cerrado.
  //
  // En fase 2 el camino cookie ni siquiera se consulta: sin sesión válida (o si
  // su lectura falla) no hay tenant, tampoco uno anónimo sin reclamar.
  if (isAuthConfigured()) return null;
  const jar = await cookies();
  const id = jar.get(COOKIE_NAME)?.value;
  if (!id || !UUID_V4_RE.test(id)) return null;
  const db = getDb();
  const found = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, id), isNullUserId()))
    .limit(1);
  return found[0]?.id ?? null;
}

// UUID v4 format guard — prevents forged/malformed cookie values from hitting the DB.
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Returns the workspace for the current request, or null if unauthenticated.
 * Auth path: resolves via BetterAuth session (isAuthConfigured()); without a
 * valid session it returns null and never falls back to the cookie.
 * Cookie path: resolves via httpOnly cookie (fase 1 only).
 */
export async function requireWorkspace(): Promise<Workspace | null> {
  const db = getDb();

  const session = await getAuthSession();
  if (session) {
    const found = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.userId, session.userId))
      // Mismo criterio que getOrCreateWorkspace(): el más antiguo gana.
      .orderBy(asc(workspaces.createdAt))
      .limit(1);
    return found[0] ?? null;
  }

  if (isAuthConfigured()) return null;
  const jar = await cookies();
  const id = jar.get(COOKIE_NAME)?.value;
  if (!id || !UUID_V4_RE.test(id)) return null;
  const found = await db
    .select()
    .from(workspaces)
    // `isNullUserId()` alinea este camino con el de getOrCreateWorkspace().
    // Sin él, una cookie anónima seguía alcanzando un workspace YA reclamado
    // por un usuario autenticado (claimAnonymousWorkspace le puso user_id):
    // el día del flip a auth eso sería acceso cruzado de tenant desde una
    // cookie que el dueño de la cuenta creía haber dejado atrás.
    .where(and(eq(workspaces.id, id), isNullUserId()))
    .limit(1);
  return found[0] ?? null;
}

/**
 * Link an anonymous workspace to a newly-authenticated user.
 * Called from the BetterAuth `user.create.after` hook (src/lib/auth/config.ts),
 * which reads the anonymous cookie itself.
 * No-op if the workspace is already claimed or doesn't exist.
 */
export async function claimAnonymousWorkspace(
  userId: string,
  cookieWorkspaceId: string,
): Promise<void> {
  if (!UUID_V4_RE.test(cookieWorkspaceId)) return;
  await getDb()
    .update(workspaces)
    .set({ userId })
    .where(
      and(
        eq(workspaces.id, cookieWorkspaceId),
        isNullUserId(),
      ),
    );
}
