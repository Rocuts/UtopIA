// ---------------------------------------------------------------------------
// Capa 4 — Módulo 1 — Agente: CCV Fiscal F01-F10
// ---------------------------------------------------------------------------
//
// Toma el Âncora Capa 1 + el snapshot precomputado por `precomputeCcv` y lo
// envía al LLM para producir la narrativa del módulo. Los números F01-F10 son
// VINCULANTES — el LLM solo añade interpretación cualitativa.
// ---------------------------------------------------------------------------

import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import { buildCcvFiscalPrompt } from '../prompts/ccv-fiscal.prompt';
import { ccvModuleSchema } from '../schemas';
import { callFiscalAgent } from '../runtime';
import { precomputeCcv, TTD_UNAVAILABLE_REASON } from '../tools/ccv-calculator';
import type {
  CcvModuleResult,
  FiscalAgentInput,
} from '../types';

export interface CcvFiscalAgentOptions {
  input: FiscalAgentInput;
  signal?: AbortSignal;
}

export async function runCcvFiscalAgent(
  opts: CcvFiscalAgentOptions,
): Promise<CcvModuleResult> {
  const { input } = opts;
  const snapshot = precomputeCcv(input.fiscalAnchor);

  const system = buildCcvFiscalPrompt(input.language, input.company.nit);

  const userContent = `<context>
SNAPSHOT_CCV_PRECOMPUTADO (números vinculantes — no modificar):
  F01 (UAI): ${formatCopFromCents(BigInt(snapshot.f01))}  (MoneyCop: ${snapshot.f01})
  F02 (Impuesto Ref. 35%): ${formatCopFromCents(BigInt(snapshot.f02))}  (MoneyCop: ${snapshot.f02})
  F03 (Retenciones a favor): ${formatCopFromCents(BigInt(snapshot.f03))}  (MoneyCop: ${snapshot.f03})
  F04 (Saldo neto F02-F03): ${formatCopFromCents(BigInt(snapshot.f04))}  (MoneyCop: ${snapshot.f04})
  F05 (IVA por pagar): ${formatCopFromCents(BigInt(snapshot.f05))}  (MoneyCop: ${snapshot.f05})
  F06 (Retefuente por declarar): ${formatCopFromCents(BigInt(snapshot.f06))}  (MoneyCop: ${snapshot.f06})
  F07 (ICA por pagar): ${formatCopFromCents(BigInt(snapshot.f07))}  (MoneyCop: ${snapshot.f07})
  F08 (Total pasivos fiscales): ${formatCopFromCents(BigInt(snapshot.f08))}  (MoneyCop: ${snapshot.f08})
  F09 (% impuesto sobre UAI): ${snapshot.f09Pct}%
  F10 (% cobertura retenciones): ${snapshot.f10Pct}%

ALERTA_TASA_MINIMA (Art. 240 par. 6 E.T. — Ley 2277/2022 Art. 10):
  aplica: ${snapshot.alertaTasaMinima.aplica}
  f09Actual: ${snapshot.alertaTasaMinima.f09Actual}%
  brechaPp: ${snapshot.alertaTasaMinima.brechaPp}
  impuestoAdicional: N/D. ${TTD_UNAVAILABLE_REASON}

EFICIENCIA_FISCAL: ${snapshot.eficienciaFiscal ?? 'N/D: no hay base referencial positiva o cobertura válida; no clasifiques como media o baja'}

PERIODO: ${input.fiscalAnchor.fuente.periodo}
NIT_CLIENTE: ${input.fiscalAnchor.calendarioDian.nit ?? 'no provisto'}

ALERTAS_CAPA_1 (del Bloque Âncora):
${input.fiscalAnchor.alertas.length === 0 ? '  (sin alertas)' : input.fiscalAnchor.alertas.map((a) => `  - [${a.severidad}] ${a.codigo}: ${a.mensaje} (norma: ${a.norma})`).join('\n')}

INSTRUCCIONES_USUARIO:
${input.instructions ?? '(sin instrucciones adicionales)'}
</context>`;

  const { json } = await callFiscalAgent({
    module: 'ccv',
    slot: 'escudoFiscalCcv',
    schema: ccvModuleSchema,
    system,
    userContent,
    signal: opts.signal,
  });

  // Enforce the deterministic snapshot after generation; prompts are not validators.
  return { ...json, data: { ...json.data, ...snapshot },
    warnings: [...json.warnings, TTD_UNAVAILABLE_REASON] };
}
