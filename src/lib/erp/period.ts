// ---------------------------------------------------------------------------
// ERP period resolution
// ---------------------------------------------------------------------------
// Una sola interpretación de los periodos que aceptan los conectores:
//   "2025"                    → año         2025-01-01 .. 2025-12-31
//   "2025-Q3"                 → trimestre   2025-07-01 .. 2025-09-30
//   "2025-06"                 → mes         2025-06-01 .. 2025-06-30
//   "2025-01-01..2025-03-31"  → rango explícito
//
// Los conectores reciben la etiqueta como string (contrato de
// ERPConnectorInterface) y la resuelven aquí. Antes cada uno hacía
// `period.split('-')` suponiendo 'YYYY-MM' y un año o trimestre producía
// fechas como `2025-NaN` o `2025-Q3-01`.
// ---------------------------------------------------------------------------

export type PeriodSpec = string | { from: string; to: string };

export interface ResolvedPeriod {
  from: string;
  to: string;
  label: string;
}

export interface ResolvedERPPeriod extends ResolvedPeriod {
  kind: 'year' | 'quarter' | 'month' | 'range';
  /** Año de la fecha de corte (`to`). */
  cutoffYear: number;
  /** Mes (1-12) de la fecha de corte (`to`). */
  cutoffMonth: number;
}

export class ERPPeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ERPPeriodError';
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isValidIsoDate(value: string): boolean {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= lastDayOfMonth(year, month);
}

function monthRange(year: number, month: number): { from: string; to: string } {
  return {
    from: `${year}-${pad2(month)}-01`,
    to: `${year}-${pad2(month)}-${pad2(lastDayOfMonth(year, month))}`,
  };
}

/**
 * Resuelve un periodo de forma estricta. Lanza `ERPPeriodError` si el formato
 * no es uno de los soportados o si las fechas no existen — nunca devuelve un
 * rango a medias que el ERP pueda interpretar como otro periodo.
 */
export function resolveERPPeriod(spec: PeriodSpec): ResolvedERPPeriod {
  if (typeof spec === 'object' && spec !== null) {
    return resolveERPPeriod(`${spec.from}..${spec.to}`);
  }
  const value = String(spec ?? '').trim();

  const year = value.match(/^(\d{4})$/);
  if (year) {
    const y = Number(year[1]);
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: `${y}`, kind: 'year', cutoffYear: y, cutoffMonth: 12 };
  }

  const quarter = value.match(/^(\d{4})-Q([1-4])$/i);
  if (quarter) {
    const y = Number(quarter[1]);
    const q = Number(quarter[2]);
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    return {
      from: `${y}-${pad2(startMonth)}-01`,
      to: monthRange(y, endMonth).to,
      label: `${y}-Q${q}`,
      kind: 'quarter',
      cutoffYear: y,
      cutoffMonth: endMonth,
    };
  }

  const month = value.match(/^(\d{4})-(\d{1,2})$/);
  if (month) {
    const y = Number(month[1]);
    const m = Number(month[2]);
    if (m < 1 || m > 12) {
      throw new ERPPeriodError(`Periodo ERP inválido: mes ${m} fuera de 1-12.`);
    }
    return { ...monthRange(y, m), label: `${y}-${pad2(m)}`, kind: 'month', cutoffYear: y, cutoffMonth: m };
  }

  const range = value.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (range) {
    const [, from, to] = range;
    if (!isValidIsoDate(from) || !isValidIsoDate(to) || from > to) {
      throw new ERPPeriodError('Periodo ERP inválido: rango de fechas inexistente o invertido.');
    }
    return {
      from,
      to,
      label: `${from}..${to}`,
      kind: 'range',
      cutoffYear: Number(to.slice(0, 4)),
      cutoffMonth: Number(to.slice(5, 7)),
    };
  }

  throw new ERPPeriodError(
    'Periodo ERP no soportado. Use "AAAA", "AAAA-MM", "AAAA-Qn" o "AAAA-MM-DD..AAAA-MM-DD".',
  );
}

/**
 * Versión tolerante usada por ERPAdapter/ERPService para rangos de facturas y
 * comprobantes: resuelve los formatos soportados y, si no reconoce el valor,
 * lo trata como fecha puntual (comportamiento histórico del adapter).
 */
export function resolvePeriod(spec: PeriodSpec): ResolvedPeriod {
  try {
    const { from, to, label } = resolveERPPeriod(spec);
    return { from, to, label };
  } catch {
    if (typeof spec === 'object' && spec !== null) {
      return { from: spec.from, to: spec.to, label: `${spec.from}..${spec.to}` };
    }
    const value = String(spec).trim();
    return { from: value, to: value, label: value };
  }
}
