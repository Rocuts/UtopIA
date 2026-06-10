import 'server-only';
import { cookies, headers } from 'next/headers';
import { eq, and } from 'drizzle-orm';
import { getDb } from './client';
import { workspaces, type Workspace } from './schema';

const COOKIE_NAME = 'utopia_workspace_id';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 5; // 5 años

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
  if (!process.env.BETTER_AUTH_SECRET) return null;
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
      .limit(1);
    if (found.length > 0) return found[0];

    // First login — create workspace linked to this user.
    const [created] = await db
      .insert(workspaces)
      .values({ userId: session.userId })
      .returning();
    return created;
  }

  // ── Anonymous cookie path (dev / no auth configured) ────────────────────
  const jar = await cookies();
  const existingId = jar.get(COOKIE_NAME)?.value;

  if (existingId) {
    const found = await db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.id, existingId), isNullUserId()))
      .limit(1);
    if (found.length > 0) return found[0];
    // Cookie apunta a workspace ya borrado o reclamado — recreamos.
  }

  const [created] = await db.insert(workspaces).values({}).returning();
  jar.set(COOKIE_NAME, created.id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === 'production',
  });
  return created;
}

// Drizzle helper: workspaces with no user_id (anonymous).
function isNullUserId() {
  // drizzle-orm SQL: `user_id IS NULL`
  const { isNull } = require('drizzle-orm') as typeof import('drizzle-orm');
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
      .limit(1);
    return found[0]?.id ?? null;
  }
  const jar = await cookies();
  return jar.get(COOKIE_NAME)?.value ?? null;
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
      .limit(1);
    return found[0] ?? null;
  }

  const jar = await cookies();
  const id = jar.get(COOKIE_NAME)?.value;
  if (!id || !UUID_V4_RE.test(id)) return null;
  const found = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, id))
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
