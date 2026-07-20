'use server';
// Server Action de LECTURA para la confirmación pre-reporte ("N hechos se
// incluirán"). Tenancy server-side (cookie/sesión) vía getCurrentWorkspaceId
// (NO-create). Devuelve [] cuando no hay workspace. Sólo narrativos: los
// estructurados (donation) van por el path determinista, no se listan aquí.

import { requireAuthSession } from '@/lib/auth/require-session';
import { getActiveFacts } from '@/lib/db/facts';
import { getCurrentWorkspaceId } from '@/lib/db/workspace';
import { toFactDTO, type FactDTO } from '@/lib/facts/dto';

export async function getActiveNarrativesForReportAction(
  fiscalPeriod: string | null,
): Promise<FactDTO[]> {
  const gate = await requireAuthSession();
  if (!gate.ok) return [];
  const workspaceId = await getCurrentWorkspaceId().catch(() => null);
  if (!workspaceId) return [];
  const year = fiscalPeriod?.match(/\d{4}/)?.[0] ?? null;
  try {
    const facts = await getActiveFacts(workspaceId, year);
    return facts.filter((f) => f.kind === 'narrative').map(toFactDTO);
  } catch (err) {
    console.error(
      '[hechos-empresa] read action fallo (degrada a []):',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
