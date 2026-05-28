// ---------------------------------------------------------------------------
// Capa 4 — Módulo 4 — Agente: Planeación Tributaria (3 escenarios)
// ---------------------------------------------------------------------------

import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import { buildPlaneacionPrompt } from '../prompts/planeacion.prompt';
import { planeacionModuleSchema } from '../schemas';
import { callFiscalAgent } from '../runtime';
import type { FiscalAgentInput, PlaneacionModuleResult } from '../types';

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

  const userContent = `<context>
ANCLAS_FISCALES_VINCULANTES (Bloque Âncora Capa 1 — no recalcular):
  F01 UAI: ${formatCopFromCents(BigInt(anchor.f01))}
  F02 Impuesto referencia (tarifa 35%): ${formatCopFromCents(BigInt(anchor.f02))}
  F03 Retenciones a favor: ${formatCopFromCents(BigInt(anchor.f03))}
  F04 Saldo neto: ${formatCopFromCents(BigInt(anchor.f04))}
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
  Ingresos: ${formatCopFromCents(BigInt(pp.controlTotals.cents?.ingresos ?? BigInt(0)))}
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

  return json;
}
