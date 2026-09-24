// ---------------------------------------------------------------------------
// Capa 4 — Módulo 4 — Agente: Planeación Tributaria (3 escenarios)
// ---------------------------------------------------------------------------

import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import { buildPlaneacionPrompt } from '../prompts/planeacion.prompt';
import { planeacionModuleSchema } from '../schemas';
import { callFiscalAgent } from '../runtime';
import { aplicarTope258Escenario } from '../tools/planeacion-tope-258';
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
  // Tope conjunto del Art. 258 por escenario aplicado en código sobre el
  // desglose de descuentos (fase 2 de la auditoría 2026-09-24, pendiente #8).
  const base = BigInt(anchor.f02);
  const avisos: string[] = [];
  const fix = (e: PlaneacionEscenario): PlaneacionEscenario => {
    const tope = aplicarTope258Escenario(e.impuestoAntesDescuentos ?? null, e.descuentos, e.impuestoEscenario);
    if (tope.motivo) avisos.push(`Escenario ${e.nombre}: ${tope.motivo}`);
    if (tope.excesoTope258 !== null && BigInt(tope.excesoTope258) > BigInt(0)) {
      avisos.push(
        `Escenario ${e.nombre}: los descuentos de los Arts. 255, 256 y 257 exceden el tope conjunto del 25% del Art. 258 E.T. en ${formatCopFromCents(BigInt(tope.excesoTope258))}; el impuesto del escenario se recalculó con el tope.`,
      );
    }
    const conTope = { ...e, impuestoBase: anchor.f02, tope258: tope.tope258, excesoTope258: tope.excesoTope258 };
    const impuesto = tope.impuestoEscenario;
    if (impuesto === null || !/^-?\d+$/.test(impuesto)) {
      return { ...conTope, impuestoEscenario: null, ahorroEstimado: null, ahorroPct: null };
    }
    const esc = BigInt(impuesto);
    const ahorro = base - esc > BigInt(0) ? base - esc : BigInt(0);
    // Porcentaje con 2 decimales, redondeo half-up (escala ×10⁵ antes de dividir).
    const pct = base > BigInt(0) ? Math.round(Number((ahorro * BigInt(100_000)) / base) / 10) / 100 : null;
    return { ...conTope, impuestoEscenario: impuesto, ahorroEstimado: ahorro.toString(), ahorroPct: pct };
  };
  const { conservador, base: escBase, agresivo } = json.data.escenarios;
  const escenarios = { conservador: fix(conservador), base: fix(escBase), agresivo: fix(agresivo) };
  return {
    ...json,
    data: {
      ...json.data,
      escenarios,
    },
    warnings: [
      ...json.warnings,
      'Escenarios medidos contra F02 (UAI × 35%): estimación contable, no liquidación. Sólo cuentan partidas conciliatorias incrementales no reconocidas ya en la UAI.',
      ...avisos,
    ],
  };
}
