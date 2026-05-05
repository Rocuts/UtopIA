import 'server-only';
import { NextResponse } from 'next/server';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { getRecentLog } from '@/lib/notifications/repository';

// ---------------------------------------------------------------------------
// GET /api/notifications/log
//
// Returns the last 30 days of notification log entries for the workspace.
// Used by AlertDashboard to display the "Notificaciones recientes" section.
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const workspace = await getOrCreateWorkspace();
    const items = await getRecentLog(workspace.id, 30);
    return NextResponse.json({ items });
  } catch (err) {
    console.error('[api/notifications/log] GET error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
