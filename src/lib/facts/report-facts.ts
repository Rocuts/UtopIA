import 'server-only';
// src/lib/facts/report-facts.ts
import { getActiveFacts } from '@/lib/db/facts';
import { selectNarrativeContents, renderHechosEmpresaBlock } from './hechos-empresa';

/** Extrae el año 'YYYY' de un fiscalPeriod de texto libre (patrón Team C). */
function normalizeFiscalYear(fiscalPeriod: string | null): string | null {
  if (!fiscalPeriod) return null;
  return fiscalPeriod.match(/\d{4}/)?.[0] ?? null;
}

/**
 * Bloque <hechos_empresa> listo para inyectar en el <context> de un prompt de
 * reporte. Degrada SEGURO: sin workspaceId o ante CUALQUIER error → '' (nunca
 * tumba un reporte por los hechos). Los narrativos son atemporales (período
 * null) → matchean cualquier período de todas formas.
 */
export async function getHechosEmpresaBlock(
  workspaceId: string | null | undefined,
  fiscalPeriod: string | null,
  language: 'es' | 'en',
  options?: { excludedFactIds?: readonly string[] | null },
): Promise<string> {
  if (!workspaceId) return '';
  try {
    const facts = await getActiveFacts(workspaceId, normalizeFiscalYear(fiscalPeriod));
    const narratives = selectNarrativeContents(facts, options?.excludedFactIds ?? null);
    return renderHechosEmpresaBlock(narratives, language);
  } catch (err) {
    console.error(
      '[hechos-empresa] fallo cargando hechos (degrada a sin bloque):',
      err instanceof Error ? err.message : err,
    );
    return '';
  }
}
