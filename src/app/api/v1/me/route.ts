// ─── GET /api/v1/me — introspección de la llave ──────────────────────────────
// Spec: docs/spec/api-clientes-v1.md §1. No expone el id del workspace (en
// fase 1 el UUID del workspace ES el bearer de la app — patrón toPublicWorkspace).

import { eq } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { workspaces } from '@/lib/db/schema';
import { apiJson, withApiV1 } from '@/lib/api/handler';

export const maxDuration = 15;

export const GET = withApiV1(
  { scopes: [], kind: 'read' },
  async ({ key, requestId, workspaceId }) => {
    const db = getDb();
    const rows = await db
      .select({ name: workspaces.name, nit: workspaces.nit })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    const workspace = rows[0] ?? { name: null, nit: null };

    return apiJson(
      200,
      {
        object: 'api_key',
        name: key.name,
        mode: key.mode ?? 'live',
        scopes: key.scopes,
        rate_limits: { read_rpm: key.rpmRead, write_rpm: key.rpmWrite },
        workspace: { name: workspace.name, nit: workspace.nit },
      },
      requestId,
    );
  },
);
