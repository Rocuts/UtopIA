// ---------------------------------------------------------------------------
// Capa 4 — Agente Fiscal — Sintetizador (dictamen ejecutivo)
// ---------------------------------------------------------------------------
//
// Consolida los outputs de los módulos ejecutados en un dictamen ejecutivo de
// 1 página: top recomendaciones + cierre obligatorio del agente.
// ---------------------------------------------------------------------------

import { buildFiscalAgentHeader, buildLanguageLine } from '../prompts/fiscal-agent.prompt';
import { synthesisSchema } from '../schemas';
import { callFiscalAgent } from '../runtime';
import type {
  CcvModuleResult,
  ConciliacionModuleResult,
  DefensaDianModuleResult,
  DevolucionesModuleResult,
  FiscalAgentInput,
  FiscalSynthesisResult,
  PlaneacionModuleResult,
  RiskScoreModuleResult,
  SupervivenciaModuleResult,
} from '../types';

export interface FiscalSynthesizerInput {
  input: FiscalAgentInput;
  modules: {
    ccv: CcvModuleResult;
    riskScore: RiskScoreModuleResult;
    conciliacion: ConciliacionModuleResult | null;
    planeacion: PlaneacionModuleResult | null;
    defensaDian: DefensaDianModuleResult | null;
    devoluciones: DevolucionesModuleResult | null;
    supervivencia: SupervivenciaModuleResult | null;
  };
  signal?: AbortSignal;
}

function buildSystem(input: FiscalAgentInput): string {
  const header = buildFiscalAgentHeader({
    language: input.language,
    useCase: 'analisis_completo',
    nitContext: input.company.nit,
  });

  return `${header}

<task>
Consolidar los outputs de los módulos del Agente Fiscal en un dictamen ejecutivo de 1 página: situación fiscal, top 3-5 recomendaciones priorizadas con impacto cuantificado y cita normativa, y cierre obligatorio.
</task>

<success_criteria>
- \`markdown\` cabe en una página A4: secciones "Situación fiscal", "Top recomendaciones", "Próximos pasos", cierre obligatorio.
- \`topRecommendations\` lista entre 3 y 5 acciones priorizadas (orden 1 = más importante), cada una con norma, impacto estimado MoneyCop y prioridad.
- \`cierre\` contiene EXACTAMENTE: "Este análisis fue generado por El Escudo (1+1 IA). Las cifras y posiciones deben ser validadas por un contador público o asesor tributario antes de su uso oficial o presentación ante la DIAN."
</success_criteria>

<constraints>
ALWAYS reusa las citas normativas que ya aparecieron en los módulos — no inventes nuevas.
NEVER uses §, "centavos" en texto visible.
NEVER cites Conceptos DIAN no whitelisted.
</constraints>

<context>
{outputs_de_modulos_ejecutados}
</context>

${buildLanguageLine(input.language)}`;
}

export async function runSynthesizer(
  inp: FiscalSynthesizerInput,
): Promise<FiscalSynthesisResult> {
  const system = buildSystem(inp.input);

  const m = inp.modules;
  const userContent = `<context>
MODULO_1_CCV (resumen):
  F09 TET: ${m.ccv.data.f09Pct}% | F10 cobertura: ${m.ccv.data.f10Pct}% | eficiencia: ${m.ccv.data.eficienciaFiscal ?? 'N/D (base insuficiente; no es media ni baja)'}
  alerta tasa mínima aplica: ${m.ccv.data.alertaTasaMinima.aplica}
  ${m.ccv.markdown.slice(0, 500)}

MODULO_3_RISK_SCORE:
  Score: ${m.riskScore.data.score}/100 | Nivel: ${m.riskScore.data.nivel}
  ${m.riskScore.markdown.slice(0, 500)}

${m.conciliacion ? `MODULO_2_CONCILIACION:
  Saldo final: ${m.conciliacion.data.saldoFinal}  | Renta líquida: ${m.conciliacion.data.rentaLiquidaGravable}
  ${m.conciliacion.markdown.slice(0, 500)}` : 'MODULO_2_CONCILIACION: no ejecutado'}

${m.planeacion ? `MODULO_4_PLANEACION:
  Recomendación: ${m.planeacion.data.recomendacion}
  ${m.planeacion.markdown.slice(0, 500)}` : 'MODULO_4_PLANEACION: no ejecutado'}

${m.defensaDian ? `MODULO_5_DEFENSA_DIAN:
  Tipo: ${m.defensaDian.data.tipoRequerimiento} | Plazo: ${m.defensaDian.data.plazoRespuesta}
  ${m.defensaDian.markdown.slice(0, 500)}` : 'MODULO_5_DEFENSA_DIAN: no ejecutado'}

${m.devoluciones ? `MODULO_6_DEVOLUCIONES:
  Viabilidad: ${m.devoluciones.data.viabilidad} | Saldo: ${m.devoluciones.data.saldoAFavor}
  ${m.devoluciones.markdown.slice(0, 500)}` : 'MODULO_6_DEVOLUCIONES: no ejecutado'}

${m.supervivencia ? `MODULO_8_SUPERVIVENCIA:
  Activo: ${m.supervivencia.data.activo} | Exposición: ${m.supervivencia.data.exposicionFiscalEstimada} | Mitigada: ${m.supervivencia.data.exposicionMitigada}
  ${m.supervivencia.markdown.slice(0, 500)}` : 'MODULO_8_SUPERVIVENCIA: no ejecutado'}
</context>`;

  const { json } = await callFiscalAgent({
    module: 'synthesizer',
    slot: 'escudoFiscalSynthesizer',
    schema: synthesisSchema,
    system,
    userContent,
    signal: inp.signal,
  });

  return json;
}
