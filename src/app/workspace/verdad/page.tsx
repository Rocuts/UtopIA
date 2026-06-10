/**
 * Ventana III — La Verdad (Aseguramiento y Dictamen).
 *
 * Server Component. Fetches real KPI data via getCachedPillarKpis, falls back
 * to mockCompliance when the DB is unavailable so the page always renders.
 *
 * NOTE: getOrCreateWorkspace() is not safe in Server Components (it calls
 * cookies().set() which is only valid in Route Handlers / Server Actions).
 * We use requireWorkspace() instead — a read-only cookie check that returns
 * null when no workspace exists yet. In that case we fall through to mocks.
 *
 * El tema (light/dark/system) lo aplica `ThemeProvider` en <html>; el ambiente
 * (orbs + contenedor) lo aporta `AreaShell`. El workspace shell ya agrega
 * `data-lenis-prevent` — no hace falta repetirlo aquí.
 */

import { VerdadArea } from '@/components/workspace/areas/VerdadArea';
import { AreaShell } from '@/components/workspace/layouts/AreaShell';
import { getCachedPillarKpis } from '@/lib/kpis/cache';
import type { PillarKpis } from '@/lib/kpis/pillar-view';
import { requireWorkspace } from '@/lib/db/workspace';
import { calculateComplianceScore } from '@/lib/kpis/compliance-score';
import type { KpiResult } from '@/types/kpis';

// ---------------------------------------------------------------------------
// Period helper
// ---------------------------------------------------------------------------

function currentPeriodId(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// PillarKpis → KpiResult mapper
//
// TYPE COMPATIBILITY NOTES:
//   PillarKpis.verdad only exposes `{ documentsVerifiedPct: number }` — a
//   single 0-100 integer representing the ratio of confirmed pyme_entries.
//
//   KpiResult (compliance kind) is produced by calculateComplianceScore()
//   which expects niifCompliance / taxCompliance / legalCompliance / audit
//   findings / lastAuditOpinion — NONE of which exist in PillarKpis.
//
//   GAP: The DB pillar query is a data-quality proxy only (confirmed entries %),
//   not a multi-axis compliance breakdown. The sub-scores (NIIF, Tax, Legal,
//   Audit findings) are unavailable here and would require dedicated queries.
//
//   CURRENT MAPPING:
//   - documentsVerifiedPct used as a single "overall signal" for all three
//     compliance axes (niifCompliance, taxCompliance, legalCompliance). This
//     means the weighted score equals documentsVerifiedPct directly (all
//     weights sum to 1.0, axes are equal). Audit finding counts default to 0.
//   - lastAuditOpinion is not stored in PillarKpis — omitted (no penalty).
//   - trend / periodPrevious: unavailable from PillarKpis — omitted.
//
//   TODO (WS6.1+): replace with a proper compliance query that returns
//   per-axis scores and audit finding counts for the period.
// ---------------------------------------------------------------------------

function buildKpiFromPillar(pillar: PillarKpis): KpiResult {
  const pct = Math.min(100, Math.max(0, Math.round(pillar.verdad.documentsVerifiedPct)));

  return calculateComplianceScore({
    // All three axes proxied from the single documents-verified signal.
    niifCompliance: pct,
    taxCompliance: pct,
    legalCompliance: pct,
    // No audit-finding data available from the pillar query — default to zero.
    auditFindingsCritical: 0,
    auditFindingsHigh: 0,
    auditFindingsMedium: 0,
    // lastAuditOpinion not in PillarKpis — omitted (no RF penalty applied).
    // declarationsOnTime not available — omitted.
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function VerdadOverviewPage() {
  let kpi: KpiResult;

  try {
    const workspace = await requireWorkspace();

    if (!workspace) {
      // No workspace cookie yet (first visit before workspace creation).
      // Fall through to mocks — workspace is created lazily on first API call.
      const { mockCompliance } = await import('@/lib/kpis/mocks');
      kpi = mockCompliance;
    } else {
      const pillar = await getCachedPillarKpis(workspace.id, currentPeriodId());
      kpi = buildKpiFromPillar(pillar);
    }
  } catch {
    // DB unavailable — fallback to mocks so page still renders.
    const { mockCompliance } = await import('@/lib/kpis/mocks');
    kpi = mockCompliance;
  }

  return (
    <AreaShell areaAccent="verdad">
      <VerdadArea kpi={kpi} lastOpinion="favorable" />
    </AreaShell>
  );
}
