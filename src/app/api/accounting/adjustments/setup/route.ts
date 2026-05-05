// ─── POST /api/accounting/adjustments/setup ───────────────────────────────────
//
// Siembra las 9 provisions_config estándar Colombia 2026 para el workspace
// actual. Idempotente — ON CONFLICT DO NOTHING en cada row.
// No requiere body.

import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { isAutoAdjustmentsEnabled } from '@/lib/accounting/adjustments';
import { seedProvisionsForWorkspace } from '@/lib/db/seeds/provisions-config-co-2026';
import { errorResponse, ok, disabled503 } from '../_shared';

export async function POST() {
  if (!isAutoAdjustmentsEnabled()) return disabled503();
  try {
    const ws = await getOrCreateWorkspace();
    const result = await seedProvisionsForWorkspace(ws.id);
    return ok(result, result.errors.length > 0 ? 207 : 200);
  } catch (err) {
    return errorResponse(err);
  }
}
