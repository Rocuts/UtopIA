// ---------------------------------------------------------------------------
// Capa 4 — Módulo 2 — Agente: Conciliación Fiscal Borrador
// ---------------------------------------------------------------------------

import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import { buildConciliacionPrompt } from '../prompts/conciliacion.prompt';
import { conciliacionModuleSchema } from '../schemas';
import { callFiscalAgent } from '../runtime';
import { buildConciliacionSkeleton } from '../tools/conciliacion-builder';
import type { ConciliacionModuleResult, FiscalAgentInput } from '../types';

export interface ConciliacionAgentOptions {
  input: FiscalAgentInput;
  signal?: AbortSignal;
}

export async function runConciliacionAgent(
  opts: ConciliacionAgentOptions,
): Promise<ConciliacionModuleResult> {
  const { input } = opts;
  const skeleton = buildConciliacionSkeleton(input.fiscalAnchor);

  const system = buildConciliacionPrompt(input.language, input.company.nit);

  const userContent = `<context>
ESQUELETO_CONCILIACION_PRECOMPUTADO (números base — NO modificar UAI ni F03):
  UAI contable (= F01): ${formatCopFromCents(BigInt(skeleton.uaiContable))}  (MoneyCop: ${skeleton.uaiContable})
  Renta líquida gravable BASE (sin ajustes): ${formatCopFromCents(BigInt(skeleton.rentaLiquidaGravableBase))}  (MoneyCop: ${skeleton.rentaLiquidaGravableBase})
  Tarifa por defecto: ${skeleton.tarifaPct}%
  Impuesto bruto BASE (UAI × tarifa): ${formatCopFromCents(BigInt(skeleton.impuestoBrutoBase))}  (MoneyCop: ${skeleton.impuestoBrutoBase})
  Retenciones y anticipos (= F03): ${formatCopFromCents(BigInt(skeleton.retencionesYAnticipos))}  (MoneyCop: ${skeleton.retencionesYAnticipos})
  Saldo final BASE (sin descuentos): ${formatCopFromCents(BigInt(skeleton.saldoFinalBase))}  (MoneyCop: ${skeleton.saldoFinalBase})

DISCLAIMER_OBLIGATORIO:
${skeleton.disclaimer}

DATOS_EMPRESA:
  Sector: ${input.company.sector ?? 'no provisto'}
  CIIU: ${input.company.ciiu ?? 'no provisto'}
  NIT: ${input.company.nit ?? 'no provisto'}

PERIODO: ${input.fiscalAnchor.fuente.periodo}

ALERTAS_CAPA_1:
${input.fiscalAnchor.alertas.length === 0 ? '  (sin alertas)' : input.fiscalAnchor.alertas.map((a) => `  - [${a.severidad}] ${a.codigo}: ${a.mensaje}`).join('\n')}

INSTRUCCIONES_USUARIO:
${input.instructions ?? '(sin instrucciones adicionales)'}
</context>`;

  const { json } = await callFiscalAgent({
    module: 'conciliacion',
    slot: 'escudoFiscalConciliacion',
    schema: conciliacionModuleSchema,
    system,
    userContent,
    signal: opts.signal,
  });

  return json;
}
