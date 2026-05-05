// ─── Regla: Asientos posteados en fin de semana / festivos ───────────────────
//
// Detecta journal_entries cuya entry_date cae en:
//   - sábado (día 6) o domingo (día 0)
//   - festivos colombianos 2026 (hardcoded)
//
// Severidad:
//   - Algunos asientos en fin de semana → low
//   - > 30% de los asientos del período en fin de semana → high

import type { ForensicRule, RuleInput, RuleResult, Anomaly } from '../types';
import { getPostedEntriesForPeriod } from '../repository';

// ---------------------------------------------------------------------------
// Festivos colombianos 2026
// Ley 51/1983 (lunes siguiente a festivos "puente") + festivos fijos.
// ---------------------------------------------------------------------------

const HOLIDAYS_2026: Set<string> = new Set([
  '2026-01-01', // Año nuevo
  '2026-01-12', // Reyes Magos (puente, primer lunes siguiente al 6)
  '2026-03-23', // San José (puente, lunes siguiente al 19)
  '2026-04-02', // Jueves Santo
  '2026-04-03', // Viernes Santo
  '2026-05-01', // Día del Trabajo
  '2026-05-18', // Ascensión del Señor (puente)
  '2026-06-08', // Corpus Christi (puente)
  '2026-06-15', // Sagrado Corazón (puente)
  '2026-06-29', // San Pedro y San Pablo (puente, lunes siguiente al 29)
  '2026-07-20', // Independencia de Colombia
  '2026-08-07', // Batalla de Boyacá
  '2026-08-17', // Asunción de la Virgen (puente)
  '2026-10-12', // Día de la Raza (puente)
  '2026-11-02', // Todos los Santos (puente)
  '2026-11-16', // Independencia de Cartagena (puente)
  '2026-12-08', // Inmaculada Concepción
  '2026-12-25', // Navidad
]);

/** Formatea Date como 'YYYY-MM-DD' en zona local del servidor. */
export function toISODateLocal(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Determina si una fecha es fin de semana o festivo colombiano. */
export function isNonWorkday(date: Date, holidays: Set<string> = HOLIDAYS_2026): boolean {
  const dayOfWeek = date.getUTCDay(); // 0=domingo, 6=sábado
  if (dayOfWeek === 0 || dayOfWeek === 6) return true;
  return holidays.has(toISODateLocal(date));
}

const weekendPostingsRule: ForensicRule = {
  kind: 'weekend_posting',

  async run(input: RuleInput): Promise<RuleResult> {
    const entries = await getPostedEntriesForPeriod(
      input.workspaceId,
      input.periodId,
    );

    if (entries.length === 0) return { anomalies: [] };

    const nonWorkdayEntries = entries.filter((e) =>
      isNonWorkday(new Date(e.entryDate)),
    );

    if (nonWorkdayEntries.length === 0) return { anomalies: [] };

    const pct = nonWorkdayEntries.length / entries.length;
    const severity = pct > 0.30 ? 'high' : 'low';

    const affectedIds = nonWorkdayEntries.map((e) => e.id);
    const byDate = new Map<string, number>();
    for (const e of nonWorkdayEntries) {
      const dk = toISODateLocal(new Date(e.entryDate));
      byDate.set(dk, (byDate.get(dk) ?? 0) + 1);
    }

    const anomaly: Anomaly = {
      kind: 'weekend_posting',
      severity,
      description:
        `${nonWorkdayEntries.length} asiento${nonWorkdayEntries.length > 1 ? 's' : ''} ` +
        `posteado${nonWorkdayEntries.length > 1 ? 's' : ''} en fin de semana o festivo ` +
        `(${(pct * 100).toFixed(1)}% del período). ` +
        (severity === 'high'
          ? 'Porcentaje muy alto — revisar autorización de posteos fuera de horario.'
          : 'Revisar si corresponden a ajustes de cierre autorizados.'),
      affectedEntryIds: affectedIds,
      affectedAmountCop: '0',
      reviewUrl: `/workspace/contabilidad/asientos?period=${input.periodId}&ids=${affectedIds.join(',')}`,
      evidence: {
        nonWorkdayCount: nonWorkdayEntries.length,
        totalEntries: entries.length,
        percentage: parseFloat((pct * 100).toFixed(2)),
        byDate: Object.fromEntries(byDate),
      },
    };

    return { anomalies: [anomaly] };
  },
};

export default weekendPostingsRule;
