import 'server-only';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { getDb } from './client';
import { workspaces, type Workspace } from './schema';

const COOKIE_NAME = 'utopia_workspace_id';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 5; // 5 años

// MVP — sin auth. El navegador es el "tenant".
// `getOrCreateWorkspace` setea cookie httpOnly la primera vez. Solo
// debe invocarse desde Route Handlers o Server Actions (cookies().set
// no es válido en Server Components).
//
// Cuando se agregue auth real:
// - vincular `workspaces.id` a `user_id` en `workspace_members`.
// - migrar la cookie anónima al usuario logueado en el primer login.

export async function getOrCreateWorkspace(): Promise<Workspace> {
  const jar = await cookies();
  const existingId = jar.get(COOKIE_NAME)?.value;
  const db = getDb();

  if (existingId) {
    const found = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, existingId))
      .limit(1);
    if (found.length > 0) return found[0];
    // Cookie apunta a workspace ya borrado — recreamos.
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

export async function getCurrentWorkspaceId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COOKIE_NAME)?.value ?? null;
}

// UUID v4 format guard — prevents forged/malformed cookie values from hitting the DB.
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Returns the workspace for the current request's cookie, or null if:
 *   - cookie is absent
 *   - value is not a valid UUID v4
 *   - UUID doesn't match any workspace row in the DB
 *
 * Unlike getOrCreateWorkspace(), this never creates a new workspace.
 * Use this to gate sensitive endpoints (realtime, ERP sync, etc.) so that
 * anonymous requests receive 401 instead of a new workspace being created.
 */
export async function requireWorkspace(): Promise<Workspace | null> {
  const jar = await cookies();
  const id = jar.get(COOKIE_NAME)?.value;
  if (!id || !UUID_V4_RE.test(id)) return null;
  const found = await getDb()
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, id))
    .limit(1);
  return found[0] ?? null;
}
