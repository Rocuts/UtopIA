import 'server-only';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { workspaces } from '@/lib/db/schema';
import { authSubscriptions } from '@/lib/db/schema-auth';

// ---------------------------------------------------------------------------
// Plan resolution + gating (@better-auth/stripe).
//
// Phase-gated like the rest of the platform:
//   - Billing NOT configured (no STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET) →
//     every caller sees 'enterprise' (unrestricted). This preserves today's
//     behavior: shipping this module must not lock a single existing feature.
//   - Billing configured → plan comes from the `subscription` table written
//     by the Stripe webhook. No active/trialing row → 'free'.
//
// Subscriptions are keyed by BetterAuth user id (subscription.reference_id).
// Workspaces are 1:1 with users (ADR-05 Opción A), so the workspace plan is
// its owner's plan. Anonymous workspaces (no user_id) are 'free'.
// ---------------------------------------------------------------------------

export type PlanId = 'free' | 'pro' | 'enterprise';

const PLAN_RANK: Record<PlanId, number> = { free: 0, pro: 1, enterprise: 2 };

/** Subscription states that grant the plan's entitlements. */
const ENTITLED_STATUSES = ['active', 'trialing'] as const;

export function isBillingEnabled(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET,
  );
}

function asPlanId(plan: string): PlanId {
  return plan === 'pro' || plan === 'enterprise' ? plan : 'free';
}

/** Highest entitled plan for a BetterAuth user id. */
export async function getUserPlan(userId: string): Promise<PlanId> {
  if (!isBillingEnabled()) return 'enterprise';
  const db = getDb();
  const rows = await db
    .select({ plan: authSubscriptions.plan, status: authSubscriptions.status })
    .from(authSubscriptions)
    .where(eq(authSubscriptions.referenceId, userId));
  let best: PlanId = 'free';
  for (const row of rows) {
    if (!ENTITLED_STATUSES.includes(row.status as (typeof ENTITLED_STATUSES)[number])) {
      continue;
    }
    const plan = asPlanId(row.plan);
    if (PLAN_RANK[plan] > PLAN_RANK[best]) best = plan;
  }
  return best;
}

/** Plan of a workspace — resolves through its owning user. */
export async function getWorkspacePlan(workspaceId: string): Promise<PlanId> {
  if (!isBillingEnabled()) return 'enterprise';
  const db = getDb();
  const found = await db
    .select({ userId: workspaces.userId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  const userId = found[0]?.userId;
  if (!userId) return 'free';
  return getUserPlan(userId);
}

// Lazy session resolution — same pattern as src/lib/db/workspace.ts (dynamic
// import keeps pg.Pool/betterAuth out of any non-Node bundle).
async function getSessionUserId(): Promise<string | null> {
  if (!process.env.BETTER_AUTH_SECRET) return null;
  try {
    const { auth } = await import('@/lib/auth/config');
    const h = await headers();
    const session = await auth.api.getSession({ headers: h });
    return session?.user.id ?? null;
  } catch {
    return null;
  }
}

/** Plan of the user behind the current request. */
export async function getCurrentUserPlan(): Promise<PlanId> {
  if (!isBillingEnabled()) return 'enterprise';
  const userId = await getSessionUserId();
  if (!userId) return 'free';
  return getUserPlan(userId);
}

/**
 * Route-handler gate, mirroring `requireAuthSession()`:
 *
 *   const planGate = await requirePlan('pro');
 *   if (!planGate.ok) return planGate.response;
 *
 * 402 with a stable slug so the client can render an upgrade CTA. Generic by
 * design — no err.message leaves the server (commit a7e55e53 convention).
 */
export async function requirePlan(
  minimum: PlanId,
): Promise<{ ok: true; plan: PlanId } | { ok: false; response: NextResponse }> {
  const plan = await getCurrentUserPlan();
  if (PLAN_RANK[plan] >= PLAN_RANK[minimum]) {
    return { ok: true, plan };
  }
  return {
    ok: false,
    response: NextResponse.json(
      { error: 'plan_required', requiredPlan: minimum, currentPlan: plan },
      { status: 402 },
    ),
  };
}

// Re-exported for tests (pure helpers, no I/O).
export const _internal = { asPlanId, PLAN_RANK, ENTITLED_STATUSES };
