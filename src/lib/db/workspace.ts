import 'server-only';
import { cookies, headers } from 'next/headers';
import { isAuthConfigured } from '@/lib/auth/enabled';
import { eq, and, asc, isNull } from 'drizzle-orm';
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
// When BETTER_AUTH_SECRET is set, we resolve the workspace via the
// authenticated user (user_id column on workspaces). Otherwise we fall back
// to the anonymous cookie tenant. Both paths remain supported so the app
// works in dev without auth configured.
//
// Migration path for existing anonymous users:
//   On first login, call `claimAnonymousWorkspace(userId, cookieWorkspaceId)`
//   to link the anonymous workspace to the real user.
// ---------------------------------------------------------------------------

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

  // ── Auth path (BETTER_AUTH_SECRET set + valid session) ──────────────────
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

  if (isAuthConfigured()) throw new Error('Authentication required.');

  // ── Anonymous cookie path (dev / no auth configured) ────────────────────
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
  if (isAuthConfigured()) return null;
  // Cookie resolution is limited to deployments with no authentication configured.
  // Validate both the UUID and anonymous ownership against storage.
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
 * Auth path: resolves via BetterAuth session (BETTER_AUTH_SECRET set).
 * Cookie path: resolves via httpOnly cookie (legacy / dev).
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
 * Call this from the post-login redirect handler.
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
