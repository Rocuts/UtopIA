// ---------------------------------------------------------------------------
// Capa 4 — Módulo 4 — Agente: Planeación Tributaria (3 escenarios)
// ---------------------------------------------------------------------------

import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import { buildPlaneacionPrompt } from '../prompts/planeacion.prompt';
import { planeacionModuleSchema } from '../schemas';
import { callFiscalAgent } from '../runtime';
import type { FiscalAgentInput, PlaneacionEscenario, PlaneacionModuleResult } from '../types';

export interface PlaneacionAgentOptions {
  input: FiscalAgentInput;
  signal?: AbortSignal;
}

export async function runPlaneacionAgent(
  opts: PlaneacionAgentOptions,
): Promise<PlaneacionModuleResult> {
  const { input } = opts;
  const anchor = input.fiscalAnchor;
  const pp = input.preprocessed.primary;

  const system = buildPlaneacionPrompt(input.language, input.company.nit);
  // Ingresos NETOS de devoluciones 4175, no la Σ firmada de la clase 4
  // (`cents.ingresos` cambia con la convención de signos del ERP;
  // recalculo-final-01). Sin el ancla ⇒ N/D, nunca $0.
  const ingresosNetosCents = pp.controlTotals.cents?.ingresosNetos;

  const userContent = `<context>
ANCLAS_FISCALES_VINCULANTES (Bloque Âncora Capa 1 — no recalcular):
  F01 UAI: ${formatCopFromCents(BigInt(anchor.f01))}
  F02 Impuesto referencia (tarifa 35%): ${formatCopFromCents(BigInt(anchor.f02))}
  F03 Retenciones a favor: ${formatCopFromCents(BigInt(anchor.f03))}
  F04 Posición de referencia contable (estimación, no liquidación): ${formatCopFromCents(BigInt(anchor.f04))}
  F09 TET actual: ${anchor.f09}%

DATOS_EMPRESA:
  Razón social: ${input.company.name ?? 'no provista'}
  NIT: ${input.company.nit ?? 'no provisto'}
  Sector: ${input.company.sector ?? 'no provisto'}
  CIIU: ${input.company.ciiu ?? 'no provisto'}

RESUMEN_BALANCE (controlTotals):
  Activo total: ${formatCopFromCents(BigInt(pp.controlTotals.cents?.activo ?? BigInt(0)))}
  Pasivo total: ${formatCopFromCents(BigInt(pp.controlTotals.cents?.pasivo ?? BigInt(0)))}
  Patrimonio: ${formatCopFromCents(BigInt(pp.controlTotals.cents?.patrimonio ?? BigInt(0)))}
  Ingresos netos (neto de devoluciones 4175): ${ingresosNetosCents === undefined ? 'N/D' : formatCopFromCents(BigInt(ingresosNetosCents))}
  Utilidad neta: ${formatCopFromCents(BigInt(pp.controlTotals.cents?.utilidadNeta ?? BigInt(0)))}

PERIODO: ${anchor.fuente.periodo}

INSTRUCCIONES_USUARIO:
${input.instructions ?? '(sin instrucciones adicionales)'}
</context>`;

  const { json } = await callFiscalAgent({
    module: 'planeacion',
    slot: 'escudoFiscalPlaneacion',
    schema: planeacionModuleSchema,
    system,
    userContent,
    signal: opts.signal,
  });

  // impuestoBase = F02; ahorro = base − escenario y % en BigInt (auditoría
  // 2026-09, tributario-modulos-16). Escenario N/D ⇒ ahorro N/D.
  const base = BigInt(anchor.f02);
  const fix = (e: PlaneacionEscenario): PlaneacionEscenario => {
    if (e.impuestoEscenario === null || !/^-?\d+$/.test(e.impuestoEscenario)) {
      return { ...e, impuestoBase: anchor.f02, impuestoEscenario: null, ahorroEstimado: null, ahorroPct: null };
    }
    const esc = BigInt(e.impuestoEscenario);
    const ahorro = base - esc > BigInt(0) ? base - esc : BigInt(0);
    // Porcentaje con 2 decimales, redondeo half-up (escala ×10⁵ antes de dividir).
    const pct = base > BigInt(0) ? Math.round(Number((ahorro * BigInt(100_000)) / base) / 10) / 100 : null;
    return { ...e, impuestoBase: anchor.f02, ahorroEstimado: ahorro.toString(), ahorroPct: pct };
  };
  const { conservador, base: escBase, agresivo } = json.data.escenarios;
  return {
    ...json,
    data: {
      ...json.data,
      escenarios: { conservador: fix(conservador), base: fix(escBase), agresivo: fix(agresivo) },
    },
    warnings: [
      ...json.warnings,
      'Escenarios medidos contra F02 (UAI × 35%): estimación contable, no liquidación. Sólo cuentan partidas conciliatorias incrementales no reconocidas ya en la UAI.',
    ],
  };
}
