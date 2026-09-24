// ---------------------------------------------------------------------------
// "Ingresos" en los entregables = ingresos OPERACIONALES netos
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (ratios-kpis-04): el KPI "Ingresos", la barra inicial de la
// cascada del PDF y "Total Ingresos" del Excel usaban `controlTotals.ingresos`,
// que es la Σ de la clase 4: bruto + devoluciones 4175 (cuando el ERP exporta la
// 4175 con el mismo signo que las ventas) + ingresos no operacionales (grupo
// 42). Ni es el ingreso de la operación ni cierra la cascada contra la utilidad
// neta, que el preprocesador calcula sobre `ingresosNetos`.
//
// Decisión de negocio (coordinador): la utilidad bruta parte de los ingresos
// operacionales netos = grupo 41 menos devoluciones 4175; el grupo 42 va debajo
// de la utilidad operacional. Mientras las anclas del preprocesador no exponen
// ese campo por separado, se recompone aquí de forma determinista desde las
// cuentas hoja de la clase 4 del snapshot, con la misma fórmula del
// preprocesador (magnitud del total firmado por grupo, nunca cuenta por cuenta).
// ---------------------------------------------------------------------------

import type { ControlTotals, PUCClass } from '@/lib/preprocessing/trial-balance';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import { parseMoneyCop } from '@/lib/agents/financial/contracts/money';

const ZERO = BigInt(0);
const absBig = (v: bigint): bigint => (v < ZERO ? -v : v);
const toCents = (pesos: number): bigint => BigInt(Math.round(pesos * 100));
const toPesos = (cents: bigint): number => Number(cents) / 100;

export interface RevenueBreakdown {
  /** Grupo 41 (sin 4175) menos devoluciones 4175, en pesos. null = sin detalle PUC verificable. */
  operacionalesNetos: number | null;
  /** Clase 4 neta de devoluciones (base de la utilidad neta del preprocesador), en pesos. */
  netosTotales: number | null;
  /** netosTotales − operacionalesNetos: grupo 42 y demás no operacionales. */
  noOperacionales: number | null;
  /** De dónde salió `operacionalesNetos`. */
  source: 'puc-detail' | 'niif-json' | null;
}

interface SnapshotLike {
  controlTotals?: ControlTotals | null;
  classes?: PUCClass[] | null;
}

/** Ingresos operacionales netos desde las hojas de la clase 4 del snapshot. */
function fromPucDetail(classes: PUCClass[] | null | undefined): {
  operacionales: bigint;
  netosTotales: bigint;
} | null {
  const clase4 = classes?.find((c) => c.code === 4);
  const leaves = (clase4?.accounts ?? []).filter((a) => a.isLeaf);
  if (leaves.length === 0) return null;
  let g41 = ZERO;
  let dev = ZERO;
  let restoOrdinarias = ZERO;
  for (const a of leaves) {
    const code = String(a.code).replace(/\D/g, '');
    const cents = toCents(a.balance);
    if (code.startsWith('4175')) dev += cents;
    else if (code.startsWith('41')) g41 += cents;
    else restoOrdinarias += cents;
  }
  const devoluciones = absBig(dev);
  return {
    operacionales: absBig(g41) - devoluciones,
    netosTotales: absBig(g41 + restoOrdinarias) - devoluciones,
  };
}

/** Ingresos operacionales netos desde los renglones codificados del ERI validado. */
function fromNiifJson(json: NiifReportJson | null | undefined): bigint | null {
  if (!json) return null;
  let g41 = ZERO;
  let dev = ZERO;
  let found = false;
  for (const line of json.incomeStatement.lines) {
    const code = String(line.account ?? '').replace(/\D/g, '');
    if (!code.startsWith('41')) continue;
    found = true;
    const v = absBig(parseMoneyCop(line.amountPrimary));
    if (code.startsWith('4175')) dev += v;
    else g41 += v;
  }
  return found ? g41 - dev : null;
}

/**
 * Descompone los ingresos del periodo para los entregables.
 *
 * Prioridad de `operacionalesNetos`: detalle PUC del snapshot (misma fuente que
 * el resto de KPIs) → renglones 41xx del ERI validado → `null` (N/D). Nunca cae
 * a la Σ de la clase 4.
 */
export function revenueBreakdown(
  snapshot: SnapshotLike | null | undefined,
  json?: NiifReportJson | null,
): RevenueBreakdown {
  const ct = snapshot?.controlTotals ?? null;
  const detail = fromPucDetail(snapshot?.classes);

  let netos: bigint | null = null;
  if (ct?.cents?.ingresosNetos !== undefined) netos = ct.cents.ingresosNetos;
  else if (typeof ct?.ingresosNetos === 'number') netos = toCents(ct.ingresosNetos);
  else if (detail) netos = detail.netosTotales;

  let op: bigint | null = null;
  let source: RevenueBreakdown['source'] = null;
  if (detail) {
    op = detail.operacionales;
    source = 'puc-detail';
  } else {
    const fromJson = fromNiifJson(json);
    if (fromJson !== null) {
      op = fromJson;
      source = 'niif-json';
    }
  }

  return {
    operacionalesNetos: op === null ? null : toPesos(op),
    netosTotales: netos === null ? null : toPesos(netos),
    noOperacionales: op !== null && netos !== null ? toPesos(netos - op) : null,
    source,
  };
}
