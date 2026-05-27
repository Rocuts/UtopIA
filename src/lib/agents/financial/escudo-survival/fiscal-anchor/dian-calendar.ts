// ---------------------------------------------------------------------------
// Fiscal Anchor — Calendario DIAN por NIT (2026)
// ---------------------------------------------------------------------------
// Tabla estática indexada por último dígito del NIT. Cubre:
//   - Retención en la fuente mensual (Dec 1778 / Dec 2229; calendario tributario
//     2026 publicado vía resolución DIAN — fechas tipo entre el día 8 y 17 del
//     mes siguiente según último dígito).
//   - IVA bimestral grandes contribuyentes / régimen común (Mar, May, Jul, Sep,
//     Nov, Ene+1 del año siguiente).
//   - Renta personas jurídicas (Abril–Mayo del año siguiente al cierre).
//   - ICA Bogotá bimestral (calendario SDH análogo a IVA).
//
// Las fechas aquí son APROXIMACIONES anuales por último dígito: los días
// efectivos varían cada año según la resolución DIAN. El frontend pintará una
// nota "Verificar calendario DIAN oficial" cuando el estado sea `verificar`.
// La regla de avance es siempre la SIGUIENTE fecha mayor a `hoy`; si todas las
// fechas del año ya pasaron, se proyecta la primera del año siguiente con
// `estado='verificar'` (no podemos garantizar fechas exactas del próximo año
// sin la resolución oficial).
// ---------------------------------------------------------------------------

import { serializeMoneyCop } from '@/lib/agents/financial/contracts/money';
import type {
  CalendarioDian,
  VencimientoBaseCcv,
  VencimientoDian,
  VencimientoEstado,
  VencimientoFrecuencia,
} from './types';
import type { FiscalDerivedMetrics } from './internal-types';

// ---------------------------------------------------------------------------
// NIT helpers
// ---------------------------------------------------------------------------

/**
 * Extrae el último dígito del NIT. Tolera formatos:
 *   "901714014-6"   → 6
 *   "901.714.014-6" → 6
 *   "9017140146"    → 6 (último dígito de la cadena)
 *   "901714014"     → 4 (sin DV — devolvemos el último del cuerpo)
 *   ""  | null      → -1 (señal "NIT ausente")
 *
 * Cuando el NIT trae DV explícito (un guión seguido de un solo dígito), ese
 * dígito ES el último dígito a usar contra el calendario DIAN. Cuando el NIT
 * llega sólo como cadena de dígitos, asumimos que el último ya es el DV (caso
 * Excel sin formato).
 */
export function extractLastDigit(nit: string | null | undefined): number {
  if (!nit) return -1;
  const trimmed = nit.trim();
  if (trimmed.length === 0) return -1;

  // Caso explícito con guión: ".....-D"
  const dashMatch = trimmed.match(/-\s*(\d)\s*$/);
  if (dashMatch) {
    return parseInt(dashMatch[1], 10);
  }

  // Caída a "último dígito de toda la cadena"
  const digitsOnly = trimmed.replace(/\D+/g, '');
  if (digitsOnly.length === 0) return -1;
  return parseInt(digitsOnly.charAt(digitsOnly.length - 1), 10);
}

// ---------------------------------------------------------------------------
// Tabla de vencimientos 2026 — indexada por último dígito (0..9)
// ---------------------------------------------------------------------------

interface VencimientoTemplate {
  obligacion: string;
  frecuencia: VencimientoFrecuencia;
  baseCcv: VencimientoBaseCcv;
  norma: string;
  /** Fechas ISO YYYY-MM-DD del calendario 2026 (excluye día). */
  fechasMesDia: string[];
}

/**
 * Día de vencimiento de la retención en la fuente mensual por último dígito.
 * Patrón DIAN: empieza en 8 (dígito 0) y crece de a 1 hasta 17 (dígito 9).
 */
const DIA_RETENCION_POR_DIGITO: readonly number[] = [
  8, 9, 10, 11, 14, 15, 16, 17, 21, 22,
];

/**
 * Día de vencimiento del IVA bimestral por último dígito. Patrón análogo a
 * retención pero corrido (típico DIAN: 9..23). Aproximación.
 */
const DIA_IVA_POR_DIGITO: readonly number[] = [
  9, 10, 13, 14, 15, 16, 17, 20, 21, 22,
];

/**
 * Día de vencimiento de renta jurídica por último dígito (Abril-Mayo).
 * Patrón DIAN 2026: del 8 de abril (dígito 0) hasta el 6 de mayo (dígito 9).
 */
const DIA_RENTA_PJ: ReadonlyArray<{ mes: number; dia: number }> = [
  { mes: 4, dia: 8 },
  { mes: 4, dia: 9 },
  { mes: 4, dia: 14 },
  { mes: 4, dia: 15 },
  { mes: 4, dia: 16 },
  { mes: 4, dia: 17 },
  { mes: 4, dia: 22 },
  { mes: 4, dia: 23 },
  { mes: 4, dia: 24 },
  { mes: 5, dia: 6 },
];

const MESES_RETENCION = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const MESES_IVA_BIMESTRAL = [3, 5, 7, 9, 11] as const;
const MESES_ICA_BIMESTRAL = [2, 4, 6, 8, 10, 12] as const;

function isoDate(year: number, monthOneBased: number, day: number): string {
  const mm = String(monthOneBased).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Overrides verificados — Decreto 2229/2023 (Wave 8 dictamen §4)
// ---------------------------------------------------------------------------
// Las fechas heurísticas (DIA_*_POR_DIGITO) son aproximaciones de día fijo.
// Las fechas reales DIAN varían cada mes por días hábiles, festivos, etc.
// Aquí guardamos las tablas exactas confirmadas en el dictamen normativo.
// Cuando (ultimoDigito, año) caen en un override, se usa la lista exacta.
// El operador humano debe cargar tablas adicionales contra el PDF oficial
// DIAN antes de habilitar otros (dígito, año) en producción.

interface OverridesPorDigitoAño {
  retencionMensual: ReadonlyArray<string>;
  ivaBimestral: ReadonlyArray<string>;
  rentaPJCuotas: ReadonlyArray<{ etiqueta: string; iso: string }>;
}

const NIT6_2026: OverridesPorDigitoAño = {
  retencionMensual: [
    '2026-02-17', '2026-03-17', '2026-04-21', '2026-05-20',
    '2026-06-18', '2026-07-16', '2026-08-20', '2026-09-16',
    '2026-10-19', '2026-11-19', '2026-12-17', '2027-01-26',
  ],
  ivaBimestral: [
    '2026-03-17', '2026-05-20', '2026-07-16',
    '2026-09-16', '2026-11-19', '2027-01-26',
  ],
  rentaPJCuotas: [
    { etiqueta: 'Renta PJ 2025 — Primera cuota (50%)', iso: '2026-05-20' },
    { etiqueta: 'Renta PJ 2025 — Segunda cuota (saldo)', iso: '2026-07-16' },
  ],
};

function getOverrides(digito: number, year: number): OverridesPorDigitoAño | null {
  if (digito === 6 && year === 2026) return NIT6_2026;
  return null;
}

function buildTemplatesForDigit(
  ultimoDigito: number,
  year: number,
): VencimientoTemplate[] {
  const overrides = getOverrides(ultimoDigito, year);

  if (overrides) {
    const templates: VencimientoTemplate[] = [
      {
        obligacion: 'Retención en la fuente',
        frecuencia: 'mensual',
        baseCcv: 'F06',
        norma: 'Art. 376 E.T. + Decreto 2229/2023 (calendario DIAN 2026)',
        fechasMesDia: overrides.retencionMensual.slice(),
      },
      {
        obligacion: 'IVA bimestral',
        frecuencia: 'bimestral',
        baseCcv: 'F05',
        norma: 'Art. 600 E.T. + Decreto 2229/2023 (calendario DIAN 2026)',
        fechasMesDia: overrides.ivaBimestral.slice(),
      },
      {
        obligacion: 'ICA Bogotá bimestral',
        frecuencia: 'bimestral',
        baseCcv: 'F07',
        norma: 'Acuerdo Distrital 65 de 2002 + Resolución SDH (verificar PDF)',
        fechasMesDia: MESES_ICA_BIMESTRAL.map((m) =>
          isoDate(year, m, DIA_IVA_POR_DIGITO[ultimoDigito] ?? 17),
        ),
      },
    ];
    for (const cuota of overrides.rentaPJCuotas) {
      templates.push({
        obligacion: cuota.etiqueta,
        frecuencia: 'anual',
        baseCcv: 'F04',
        norma: 'Art. 1.6.1.13.2.12 DUT (Decreto 1625/2016 modif. Decreto 2229/2023)',
        fechasMesDia: [cuota.iso],
      });
    }
    return templates;
  }

  // Fallback heurístico — para dígitos no verificados, mantenemos la aproximación
  // de día fijo. El UI marcará `estado='verificar'` cuando aplique.
  const diaRet = DIA_RETENCION_POR_DIGITO[ultimoDigito] ?? 17;
  const diaIva = DIA_IVA_POR_DIGITO[ultimoDigito] ?? 17;
  const diaIca = DIA_IVA_POR_DIGITO[ultimoDigito] ?? 17;
  const renta = DIA_RENTA_PJ[ultimoDigito] ?? { mes: 5, dia: 6 };

  return [
    {
      obligacion: 'Retención en la fuente',
      frecuencia: 'mensual',
      baseCcv: 'F06',
      norma: 'Art. 376 E.T. + Resolución DIAN calendario tributario (aprox.)',
      fechasMesDia: MESES_RETENCION.map((m) => isoDate(year, m, diaRet)),
    },
    {
      obligacion: 'IVA bimestral',
      frecuencia: 'bimestral',
      baseCcv: 'F05',
      norma: 'Art. 600 E.T. + Decreto 1778 calendario tributario (aprox.)',
      fechasMesDia: MESES_IVA_BIMESTRAL.map((m) => isoDate(year, m, diaIva)),
    },
    {
      obligacion: 'ICA Bogotá bimestral',
      frecuencia: 'bimestral',
      baseCcv: 'F07',
      norma: 'Acuerdo Distrital 65 de 2002 + Resolución SDH',
      fechasMesDia: MESES_ICA_BIMESTRAL.map((m) => isoDate(year, m, diaIca)),
    },
    {
      obligacion: 'Declaración de Renta — Persona Jurídica',
      frecuencia: 'anual',
      baseCcv: 'F04',
      norma: 'Art. 240 E.T. + Decreto calendario tributario (aprox.)',
      fechasMesDia: [isoDate(year, renta.mes, renta.dia)],
    },
  ];
}

// ---------------------------------------------------------------------------
// Selección de próximo vencimiento + cálculo de estado
// ---------------------------------------------------------------------------

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysBetween(from: Date, to: Date): number {
  // Diferencia en días naturales redondeada (UTC-day-floor para evitar DST).
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / MS_PER_DAY);
}

interface PickedDate {
  iso: string;
  diasRestantes: number;
  /** True si tuvimos que proyectar al año siguiente (estado=verificar). */
  projectedNextYear: boolean;
}

function pickNextOrProject(
  candidates: readonly string[],
  hoy: Date,
  baseYear: number,
): PickedDate {
  for (const iso of candidates) {
    const target = new Date(`${iso}T00:00:00Z`);
    const dr = daysBetween(hoy, target);
    if (dr >= 0) {
      return { iso, diasRestantes: dr, projectedNextYear: false };
    }
  }
  // Todas las fechas del año ya pasaron — proyectamos al equivalente del año
  // siguiente. Pintamos `verificar` porque no podemos garantizar el día exacto.
  const first = candidates[0];
  if (!first) {
    // Edge case: no hay fechas configuradas (no debería pasar). Devolvemos hoy.
    const todayIso = isoDate(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, hoy.getUTCDate());
    return { iso: todayIso, diasRestantes: 0, projectedNextYear: true };
  }
  const [, mm, dd] = first.split('-');
  const projectedIso = `${baseYear + 1}-${mm}-${dd}`;
  const target = new Date(`${projectedIso}T00:00:00Z`);
  const dr = daysBetween(hoy, target);
  return { iso: projectedIso, diasRestantes: dr, projectedNextYear: true };
}

function computeEstado(
  diasRestantes: number,
  projectedNextYear: boolean,
): VencimientoEstado {
  if (projectedNextYear) return 'verificar';
  if (diasRestantes < 0) return 'vencido';
  if (diasRestantes <= 15) return 'proximo';
  return 'pendiente';
}

// ---------------------------------------------------------------------------
// Valor estimado por base CCV
// ---------------------------------------------------------------------------

const ZERO = BigInt(0);

function absBigInt(value: bigint): bigint {
  return value < ZERO ? -value : value;
}

/**
 * Valor estimado a presentar en el vencimiento según la base CCV declarada
 * por el template. F04 puede ser negativa (saldo a favor); para mostrar el
 * "valor a pagar" devolvemos la magnitud absoluta — el dictamen distingue
 * el signo en F04 directamente.
 */
function valorEstimadoCents(
  baseCcv: VencimientoBaseCcv,
  metrics: FiscalDerivedMetrics,
): bigint {
  switch (baseCcv) {
    case 'F03':
      return metrics.f03Cents;
    case 'F04':
      return absBigInt(metrics.f04Cents);
    case 'F05':
      return metrics.f05Cents;
    case 'F06':
      return metrics.f06Cents;
    case 'F07':
      return metrics.f07Cents;
  }
}

// ---------------------------------------------------------------------------
// Builder principal
// ---------------------------------------------------------------------------

export interface BuildCalendarioDianInput {
  /** NIT formateado del archivo o intake. `null` si no se pudo extraer. */
  nit: string | null;
  /** Fecha de cálculo — el orchestrator pasa `new Date()`. */
  hoy: Date;
  /** Año fiscal del calendario (default: año de `hoy`). */
  periodo?: string;
  /** Métricas derivadas (para `valorEstimado`). */
  metrics: FiscalDerivedMetrics;
}

export function buildCalendarioDian(input: BuildCalendarioDianInput): CalendarioDian {
  const { nit, hoy, metrics } = input;
  const ultimoDigitoRaw = extractLastDigit(nit);
  const ultimoDigito = ultimoDigitoRaw >= 0 ? ultimoDigitoRaw : 0;
  const year = parseInt(input.periodo ?? String(hoy.getUTCFullYear()), 10);

  const templates = buildTemplatesForDigit(ultimoDigito, year);

  const vencimientos: VencimientoDian[] = templates.map((tpl) => {
    const picked = pickNextOrProject(tpl.fechasMesDia, hoy, year);
    return {
      obligacion: tpl.obligacion,
      frecuencia: tpl.frecuencia,
      proximoVencimiento: picked.iso,
      diasRestantes: picked.diasRestantes,
      estado: computeEstado(picked.diasRestantes, picked.projectedNextYear),
      baseCcv: tpl.baseCcv,
      valorEstimado: serializeMoneyCop(valorEstimadoCents(tpl.baseCcv, metrics)),
      norma: tpl.norma,
    };
  });

  // Re-ordenamos por días restantes ascendente para que el UI muestre primero
  // los inminentes. `verificar` (negativo) cae al final por el sort natural.
  vencimientos.sort((a, b) => {
    if (a.estado === 'verificar' && b.estado !== 'verificar') return 1;
    if (b.estado === 'verificar' && a.estado !== 'verificar') return -1;
    return a.diasRestantes - b.diasRestantes;
  });

  return {
    nit: nit ?? '',
    ultimoDigito: ultimoDigitoRaw,
    periodo: String(year),
    vencimientos,
    alertaAnticipacionDias: 15,
  };
}
