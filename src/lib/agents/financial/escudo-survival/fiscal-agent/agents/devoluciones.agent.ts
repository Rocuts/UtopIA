// ---------------------------------------------------------------------------
// Capa 4 — Módulo 6 — Agente: Devoluciones Saldos a Favor
// ---------------------------------------------------------------------------

import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import { buildDevolucionesPrompt } from '../prompts/devoluciones.prompt';
import { devolucionesModuleSchema } from '../schemas';
import { callFiscalAgent } from '../runtime';
import { analyzeRefund, REFUND_NO_DETERMINABLE_MOTIVO } from '../tools/refund-analyzer';
import type { DevolucionesModuleResult, FiscalAgentInput } from '../types';

export interface DevolucionesAgentOptions {
  input: FiscalAgentInput;
  signal?: AbortSignal;
}

export async function runDevolucionesAgent(
  opts: DevolucionesAgentOptions,
): Promise<DevolucionesModuleResult> {
  const { input } = opts;
  const analysis = analyzeRefund(input.fiscalAnchor, {
    saldoAFavorDeclaradoCents: input.saldoAFavorDeclaradoCents ?? null,
  });

  const system = buildDevolucionesPrompt(input.language, input.company.nit);

  const userContent = `<context>
REFUND_ANALYSIS_PRECOMPUTADO (vinculante):
  saldoAFavor declarado (MoneyCop): ${analysis.saldoAFavor === null ? 'null — N/D' : `${analysis.saldoAFavor}  (= ${formatCopFromCents(BigInt(analysis.saldoAFavor))})`}
  posible saldo según estimación contable |F04| (NO es base de devolución): ${analysis.posibleSaldoContable === null ? 'no aplica' : formatCopFromCents(BigInt(analysis.posibleSaldoContable))}
  viabilidad: ${analysis.viabilidad}
  plazoDian: ${analysis.plazoDian}
  plazoConGarantia: ${analysis.plazoConGarantia}
  normaRef: ${analysis.normaRef}

DOCUMENTOS_BASE_PRECOMPUTADOS:
${analysis.documentosBase.map((d) => `  - ${d}`).join('\n')}

PASOS_BASE_PRECOMPUTADOS:
${analysis.pasosBase.map((p) => `  - ${p}`).join('\n')}

RIESGOS_BASE_PRECOMPUTADOS:
${analysis.riesgosBase.map((r) => `  - ${r}`).join('\n')}

ANCLAS_FISCALES_REFERENCIA:
  F02 Imp. ref.: ${formatCopFromCents(BigInt(input.fiscalAnchor.f02))}
  F03 Retenciones: ${formatCopFromCents(BigInt(input.fiscalAnchor.f03))}
  F04 Posición de referencia contable (estimación, no liquidación): ${formatCopFromCents(BigInt(input.fiscalAnchor.f04))}
  F10 Cobertura retenciones: ${input.fiscalAnchor.f10}%

PERIODO: ${input.fiscalAnchor.fuente.periodo}

INSTRUCCIONES_USUARIO:
${input.instructions ?? '(sin instrucciones adicionales)'}
</context>`;

  const { json } = await callFiscalAgent({
    module: 'devoluciones',
    slot: 'escudoFiscalDevoluciones',
    schema: devolucionesModuleSchema,
    system,
    userContent,
    signal: opts.signal,
  });

  // Saldo, viabilidad, plazos y norma: siempre los del análisis determinista.
  // Los documentos base (requisitos de la solicitud) también: el modelo sólo
  // los amplía; si los parafrasea u omite, el validador M6.L3.1 bloqueaba una
  // lista que el código ya conoce (revisión de la fase 2, pendiente #8).
  const warnings = [...json.warnings];
  const vistos = new Set(analysis.documentosBase.map((d) => d.trim().toLowerCase()));
  const documentosRequeridos = [
    ...analysis.documentosBase,
    ...json.data.documentosRequeridos.filter((d) => !vistos.has(d.trim().toLowerCase())),
  ].slice(0, 20); // tope del esquema; los documentos base van primero
  if (analysis.viabilidad === 'no_determinable') warnings.push(REFUND_NO_DETERMINABLE_MOTIVO);
  return {
    ...json,
    data: {
      ...json.data,
      saldoAFavor: analysis.saldoAFavor,
      viabilidad: analysis.viabilidad,
      plazoDian: analysis.plazoDian,
      plazoConGarantia: analysis.plazoConGarantia,
      normaRef: analysis.normaRef,
      documentosRequeridos,
      pasosProcedimentales:
        analysis.viabilidad === 'no_determinable' || analysis.viabilidad === 'no_aplica'
          ? analysis.pasosBase
          : json.data.pasosProcedimentales,
    },
    warnings,
  };
}
