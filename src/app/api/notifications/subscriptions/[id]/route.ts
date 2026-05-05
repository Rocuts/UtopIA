import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import * as repo from '@/lib/notifications/repository';

// ---------------------------------------------------------------------------
// DELETE /api/notifications/subscriptions/[id]
//
// Soft-deletes a subscription (sets active=false). NEVER hard-deletes because
// notification_log rows reference subscription_id for audit integrity.
// Ownership is verified: subscription.workspace_id must match the cookie workspace.
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  }

  try {
    const workspace = await getOrCreateWorkspace();

    // Verify ownership before mutating.
    const sub = await repo.findSubscriptionById(id);
    if (!sub) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (sub.workspaceId !== workspace.id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // Soft delete — audit log integrity preserved.
    await repo.updateSubscriptionActive(id, workspace.id, false);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/notifications/subscriptions/[id]] DELETE error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
