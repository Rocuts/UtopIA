// ---------------------------------------------------------------------------
// Capa 4 — Módulo 8 — Agente: Modo Supervivencia Élite
// ---------------------------------------------------------------------------

import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import { buildSupervivenciaPrompt } from '../prompts/supervivencia.prompt';
import { supervivenciaModuleSchema } from '../schemas';
import { callFiscalAgent } from '../runtime';
import { precomputeCcv, TTD_UNAVAILABLE_REASON } from '../tools/ccv-calculator';
import { computeRiskScore } from '../tools/risk-score-calculator';
import type { FiscalAgentInput, SupervivenciaModuleResult } from '../types';

export interface SupervivenciaAgentOptions {
  input: FiscalAgentInput;
  /** Si true, el modo se fuerza activo independiente del score. */
  forceActive?: boolean;
  signal?: AbortSignal;
}

export async function runSupervivenciaAgent(
  opts: SupervivenciaAgentOptions,
): Promise<SupervivenciaModuleResult> {
  const { input } = opts;
  const ccv = precomputeCcv(input.fiscalAnchor);
  const risk = computeRiskScore({
    anchor: input.fiscalAnchor,
    preprocessed: input.preprocessed,
  });

  const activacionForzada = opts.forceActive === true;
  // Un score no publicable (sin base gravable) no activa el modo.
  const activacionPorScore = risk.publicable && risk.score > 60;
  const activo = activacionForzada || activacionPorScore;

  const system = buildSupervivenciaPrompt(input.language, input.company.nit);

  const userContent = `<context>
CRITERIO_ACTIVACION:
  Score DIAN: ${risk.score}/100 (nivel: ${risk.nivel})
  Forzado por caller: ${activacionForzada ? 'sí' : 'no'}
  Modo Supervivencia ACTIVO: ${activo ? 'sí' : 'no'}

ANCLAS_FISCALES (Bloque Âncora):
  F01 UAI: ${formatCopFromCents(BigInt(input.fiscalAnchor.f01))}
  F02 Imp. ref. 35%: ${formatCopFromCents(BigInt(input.fiscalAnchor.f02))}
  F03 Retenciones: ${formatCopFromCents(BigInt(input.fiscalAnchor.f03))}
  F04 Posición de referencia contable (estimación, no liquidación): ${formatCopFromCents(BigInt(input.fiscalAnchor.f04))}
  F09 TET: ${input.fiscalAnchor.f09}%
  F10 Cobertura: ${input.fiscalAnchor.f10}%

ALERTA_TASA_MINIMA (Art. 240 par. 6 E.T.):
  aplica: ${ccv.alertaTasaMinima.aplica}
  brechaPp vs 15%: ${ccv.alertaTasaMinima.brechaPp}
  impuestoAdicional: N/D. ${TTD_UNAVAILABLE_REASON}

SCORE_FACTORES:
${risk.factores.map((f) => `  - ${f.factor} → ${f.puntos} pts | ${f.detalle}`).join('\n')}

DATOS_EMPRESA:
  Razón social: ${input.company.name ?? 'no provista'}
  NIT: ${input.company.nit ?? 'no provisto'}
  Sector: ${input.company.sector ?? 'no provisto'}

ALERTAS_CAPA_1:
${input.fiscalAnchor.alertas.length === 0 ? '  (sin alertas)' : input.fiscalAnchor.alertas.map((a) => `  - [${a.severidad}] ${a.codigo}: ${a.mensaje}`).join('\n')}

PROXIMOS_VENCIMIENTOS_DIAN (15 días anticipación):
${input.fiscalAnchor.calendarioDian.vencimientos
  .filter((v) => v.estado === 'proximo' || v.estado === 'verificar')
  .slice(0, 5)
  .map((v) => `  - ${v.obligacion} (${v.frecuencia}) → ${v.proximoVencimiento} | ${v.diasRestantes} días | est. ${v.valorEstimado === null ? 'N/D' : formatCopFromCents(BigInt(v.valorEstimado))}`)
  .join('\n') || '  (sin vencimientos próximos)'}

PERIODO: ${input.fiscalAnchor.fuente.periodo}

INSTRUCCIONES_USUARIO:
${input.instructions ?? '(sin instrucciones adicionales)'}
</context>`;

  const { json } = await callFiscalAgent({
    module: 'supervivencia',
    slot: 'escudoFiscalSupervivencia',
    schema: supervivenciaModuleSchema,
    system,
    userContent,
    signal: opts.signal,
  });

  // Cifras derivables del Âncora / del score: deterministas. Exposiciones sin
  // cálculo verificable: N/D. Reserva: 10% de la utilidad neta (heurística
  // interna declarada, igual que el módulo legacy). Art. 36-3 derogado: la
  // norma de dividendos se reemplaza (auditoría 2026-09, tributario-modulos-04,
  // tributario-calc-01).
  const utilidadNeta = input.preprocessed?.primary?.controlTotals?.cents?.utilidadNeta ?? BigInt(0);
  const reserva = utilidadNeta > BigInt(0) ? utilidadNeta / BigInt(10) : BigInt(0);
  const dividendos = json.data.dividendos;
  const normaDividendos =
    dividendos && /36-3/.test(dividendos.norma)
      ? 'Arts. 48-49, 242 y 242-1 E.T. (Art. 36-3 derogado por Ley 2277/2022 art. 96)'
      : dividendos?.norma;
  return {
    ...json,
    data: {
      ...json.data,
      activo,
      exposicionFiscalEstimada: null,
      exposicionMitigada: null,
      tet: { tetActual: ccv.f09Pct, brecha15Pct: null, impuestoAdicional: null },
      escudoRetenciones: {
        ...json.data.escudoRetenciones,
        f03: input.fiscalAnchor.f03,
        ratioF10: input.fiscalAnchor.f10,
      },
      reservaContingencia: { sugerida: reserva.toString(), pctUtilidad: 0.1 },
      ...(dividendos && normaDividendos ? { dividendos: { ...dividendos, norma: normaDividendos } } : {}),
    },
    warnings: [
      ...json.warnings,
      TTD_UNAVAILABLE_REASON,
      'Exposición fiscal estimada y mitigada: N/D — no hay cálculo verificable con los datos del balance.',
    ],
  };
}
