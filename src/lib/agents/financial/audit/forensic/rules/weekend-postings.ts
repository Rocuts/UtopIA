// ─── Regla: Asientos posteados en fin de semana / festivos ───────────────────
//
// Detecta journal_entries cuya entry_date cae en:
//   - sábado o domingo
//   - festivos colombianos DEL AÑO del asiento (calculados, no una lista fija)
//
// Día calendario (auditoria-calidad-26): entry_date es timestamptz. El día se
// evalúa en hora de Colombia (America/Bogota), no en UTC: un asiento del
// viernes 19:30 en Bogotá (sábado 00:30 UTC) es de viernes. Excepción: un
// instante exactamente a las 00:00:00.000 UTC es una FECHA sin hora (el
// formulario de asientos envía 'YYYY-MM-DD' y `new Date('YYYY-MM-DD')` lo
// fija a medianoche UTC); convertirlo a Bogotá lo correría al día anterior.
//
// Severidad:
//   - Algunos asientos en fin de semana → low
//   - > 30% de los asientos del período en fin de semana → high

import type { ForensicRule, RuleInput, RuleResult, Anomaly } from '../types';
import { getPostedEntriesForPeriod } from '../repository';

// ---------------------------------------------------------------------------
// Festivos colombianos por año
// ---------------------------------------------------------------------------
// Ley 51 de 1983 (traslado al lunes siguiente) + festivos fijos y religiosos
// de la Ley 35 de 1939 (misma fuente que el calendario de días hábiles de
// `src/lib/scrapers/dian-scraper.ts`, que sólo cubre 2026 y enero de 2027).
//   - Fijos, no se trasladan: 1-ene, 1-may, 20-jul, 7-ago, 8-dic, 25-dic.
//   - Se trasladan al lunes siguiente si no caen en lunes: 6-ene, 19-mar,
//     29-jun, 15-ago, 12-oct, 1-nov, 11-nov.
//   - Según la Pascua: Jueves y Viernes Santo (no se trasladan); Ascensión
//     (+39 días), Corpus Christi (+60) y Sagrado Corazón (+68), trasladados
//     al lunes siguiente (+43, +64 y +71).
// El Día Cívico del Decreto 500 de 2024 no es festivo de la Ley 51/1983: el
// calendario DIAN lo descuenta sólo para contar plazos en días hábiles.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function isoUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY);
}

/** Domingo de Pascua (calendario gregoriano, algoritmo de Meeus/Jones/Butcher). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(year, month, day);
}

/** Ley 51/1983: si la fecha no cae en lunes, el festivo pasa al lunes siguiente. */
function nextMondayIfNeeded(d: Date): Date {
  const dow = d.getUTCDay(); // 0=domingo, 1=lunes
  if (dow === 1) return d;
  return addDays(d, (8 - dow) % 7);
}

const holidayCache = new Map<number, Set<string>>();

/** Festivos nacionales de Colombia del año, como 'YYYY-MM-DD'. */
export function colombianHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const fixed: Array<[number, number]> = [
    [1, 1], [5, 1], [7, 20], [8, 7], [12, 8], [12, 25],
  ];
  const movable: Array<[number, number]> = [
    [1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11],
  ];
  const easter = easterSunday(year);

  const days: Date[] = [
    ...fixed.map(([m, d]) => utcDate(year, m, d)),
    ...movable.map(([m, d]) => nextMondayIfNeeded(utcDate(year, m, d))),
    addDays(easter, -3), // Jueves Santo
    addDays(easter, -2), // Viernes Santo
    addDays(easter, 43), // Ascensión (lunes)
    addDays(easter, 64), // Corpus Christi (lunes)
    addDays(easter, 71), // Sagrado Corazón (lunes)
  ];

  const set = new Set(days.map(isoUtc));
  holidayCache.set(year, set);
  return set;
}

// ---------------------------------------------------------------------------
// Día calendario en Colombia
// ---------------------------------------------------------------------------

const BOGOTA_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** ¿El instante es una fecha sin hora (medianoche UTC exacta)? */
function isDateOnly(date: Date): boolean {
  return (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

/**
 * Fecha contable 'YYYY-MM-DD' del asiento en Colombia: medianoche UTC exacta
 * se lee como fecha sin hora; cualquier otro instante, en America/Bogota.
 */
export function toISODateLocal(date: Date): string {
  if (isDateOnly(date)) return isoUtc(date);
  const parts = BOGOTA_PARTS.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Determina si una fecha es fin de semana o festivo colombiano. `holidays`
 * reemplaza el calendario calculado (útil en pruebas); por defecto se usan
 * los festivos del año del asiento.
 */
export function isNonWorkday(date: Date, holidays?: Set<string>): boolean {
  const iso = toISODateLocal(date);
  const [y, m, d] = iso.split('-').map(Number);
  const dayOfWeek = utcDate(y, m, d).getUTCDay(); // 0=domingo, 6=sábado
  if (dayOfWeek === 0 || dayOfWeek === 6) return true;
  return (holidays ?? colombianHolidays(y)).has(iso);
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
        `(${(pct * 100).toFixed(1).replace('.', ',')} % del período). ` +
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
        timeZone: 'America/Bogota',
      },
    };

    return { anomalies: [anomaly] };
  },
};

export default weekendPostingsRule;
