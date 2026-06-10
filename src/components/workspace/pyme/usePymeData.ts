'use client';

/**
 * usePymeData — hooks de datos reales del área Pyme.
 *
 * Reemplazan los datasets mock de PymeHub / Mi Libro / Mis Fechas / Mis Pagos:
 *
 *   - usePymeBook()      → primer libro del workspace (GET /api/pyme/books)
 *   - usePymeSummary()   → totales del mes + acumulado anual (GET /api/pyme/summary)
 *   - usePymeEntries()   → movimientos del libro (GET /api/pyme/entries)
 *   - usePymeDeadlines() → vencimientos DIAN verificados (GET /api/calendar/verified)
 *
 * Contrato de honestidad: los hooks NUNCA inventan datos. Sin libro, sin
 * entries o sin calendario → la vista muestra estado vacío/honesto.
 */

import { useEffect, useState } from 'react';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface PymeBookLite {
  id: string;
  name: string;
}

export interface PymeEntryLite {
  id: string;
  entryDate: string;
  description: string;
  kind: 'ingreso' | 'egreso';
  amount: number;
  category: string | null;
  uploadId: string | null;
  status: 'draft' | 'confirmed';
}

export interface PymeMonthTotals {
  ingresos: number;
  egresos: number;
  margen: number;
  margenPct: number;
}

export interface PymeSummaryData {
  totals: PymeMonthTotals;
  previous: { ingresos: number; egresos: number; margen: number } | null;
  entryCount: number;
  /** Ingresos confirmados acumulados del año — semáforo de tope IVA/RST. */
  yearIngresos: number;
}

export interface PymeDeadlineItem {
  obligation: string;
  period: string;
  /** Primera y última fecha del rango de vencimientos (varía por dígito NIT). */
  dueDateMin: string;
  dueDateMax: string;
  /** Días hasta dueDateMin (negativo = vencida). */
  daysUntil: number;
  legalBasis: string;
}

interface NationalDeadlineWire {
  obligation: string;
  period: string;
  nitDigit: number;
  dueDate: string;
  legalBasis: string;
}

// ─── usePymeBook ─────────────────────────────────────────────────────────────

export function usePymeBook(): {
  book: PymeBookLite | null;
  loading: boolean;
} {
  const [book, setBook] = useState<PymeBookLite | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/pyme/books');
        const json = (await res.json()) as {
          ok: boolean;
          books?: PymeBookLite[];
        };
        if (!cancelled) setBook(json.books?.[0] ?? null);
      } catch {
        if (!cancelled) setBook(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { book, loading };
}

// ─── usePymeSummary ──────────────────────────────────────────────────────────

export function usePymeSummary(
  bookId: string | null,
  year: number,
  month: number,
): { summary: PymeSummaryData | null; loading: boolean } {
  const [summary, setSummary] = useState<PymeSummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!bookId) {
      setSummary(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/pyme/summary?bookId=${bookId}&year=${year}&month=${month}`,
        );
        const json = (await res.json()) as {
          ok: boolean;
          summary?: {
            totals: PymeMonthTotals;
            previous: PymeSummaryData['previous'];
            entryCount: number;
          };
          yearIngresos?: number;
        };
        if (!cancelled) {
          setSummary(
            json.ok && json.summary
              ? { ...json.summary, yearIngresos: json.yearIngresos ?? 0 }
              : null,
          );
        }
      } catch {
        if (!cancelled) setSummary(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, year, month]);

  return { summary, loading };
}

// ─── usePymeEntries ──────────────────────────────────────────────────────────

export function usePymeEntries(
  bookId: string | null,
  limit = 100,
): { entries: PymeEntryLite[]; loading: boolean } {
  const [entries, setEntries] = useState<PymeEntryLite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!bookId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/pyme/entries?bookId=${bookId}&limit=${limit}`,
        );
        const json = (await res.json()) as {
          ok: boolean;
          entries?: PymeEntryLite[];
        };
        if (!cancelled) setEntries(json.ok && json.entries ? json.entries : []);
      } catch {
        if (!cancelled) setEntries([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, limit]);

  return { entries, loading };
}

// ─── usePymeDeadlines ────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/**
 * Vencimientos DIAN del año agrupados por obligación+período. El calendario
 * publica una fecha por dígito de NIT; sin NIT configurado mostramos el rango
 * honesto ("entre el primero y el último vencimiento del grupo").
 */
export function usePymeDeadlines(year: number): {
  upcoming: PymeDeadlineItem[];
  pastCount: number;
  loading: boolean;
} {
  const [upcoming, setUpcoming] = useState<PymeDeadlineItem[]>([]);
  const [pastCount, setPastCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/calendar/verified?year=${year}`);
        const json = (await res.json()) as {
          deadlines?: NationalDeadlineWire[];
        };
        if (cancelled) return;

        const groups = new Map<
          string,
          { obligation: string; period: string; legalBasis: string; dates: number[] }
        >();
        for (const d of json.deadlines ?? []) {
          if (d.dueDate === 'pendiente') continue;
          const ms = Date.parse(d.dueDate);
          if (Number.isNaN(ms)) continue;
          const key = `${d.obligation}::${d.period}`;
          const g = groups.get(key);
          if (g) g.dates.push(ms);
          else
            groups.set(key, {
              obligation: d.obligation,
              period: d.period,
              legalBasis: d.legalBasis,
              dates: [ms],
            });
        }

        const now = Date.now();
        const items: PymeDeadlineItem[] = [];
        let past = 0;
        for (const g of groups.values()) {
          const min = Math.min(...g.dates);
          const max = Math.max(...g.dates);
          if (max < now - MS_PER_DAY) {
            past += 1;
            continue;
          }
          items.push({
            obligation: g.obligation,
            period: g.period,
            dueDateMin: new Date(min).toISOString().slice(0, 10),
            dueDateMax: new Date(max).toISOString().slice(0, 10),
            daysUntil: Math.ceil((min - now) / MS_PER_DAY),
            legalBasis: g.legalBasis,
          });
        }
        items.sort((a, b) => a.dueDateMin.localeCompare(b.dueDateMin));

        setUpcoming(items);
        setPastCount(past);
      } catch {
        if (!cancelled) {
          setUpcoming([]);
          setPastCount(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [year]);

  return { upcoming, pastCount, loading };
}
