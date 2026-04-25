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
