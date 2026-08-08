// ---------------------------------------------------------------------------
// Synthesizer — merges outputs from multiple specialist agents (T3 only)
// ---------------------------------------------------------------------------

import { generateText, streamText } from 'ai';
import { buildSynthesizerPrompt } from '@/lib/agents/prompts/synthesizer.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import { assertFinishedCleanly } from '@/lib/agents/financial/utils/finish-reason-check';
import { MODELS } from '@/lib/config/models';
import type { SpecialistResult } from '@/lib/agents/types';

/**
 * Marcador que el orquestador escribe en `result.content` cuando un
 * especialista revienta dentro de T3
 * (`[<displayName> no pudo completar el analisis por un error tecnico.]`).
 *
 * Se exporta para que el productor (orchestrator.ts) y el consumidor (este
 * archivo) dejen de depender de dos literales sueltos que pueden divergir.
 */
export const SPECIALIST_FAILURE_MARKER = 'no pudo completar el analisis';

/** True si el bloque es un fallo del especialista, no contenido analitico. */
export function isFailedSpecialistOutput(content: string): boolean {
  return content.includes(SPECIALIST_FAILURE_MARKER);
}

/**
 * Aviso de degradacion antepuesto a la respuesta cuando uno o mas
 * especialistas no respondieron.
 *
 * Why: sin esto, una consulta T3 "analiza el requerimiento y dime el riesgo
 * tributario y contable" en la que fallan 2 de 3 agentes se entregaba como
 * respuesta final sin ninguna senal — el usuario decidia creyendo que tuvo
 * cobertura multi-dominio. Es preferible declarar el hueco que redactar con
 * aplomo sobre media consulta.
 */
export function buildDegradedNotice(
  failedAgents: string[],
  okAgents: string[],
  language: 'es' | 'en',
): string {
  if (failedAgents.length === 0) return '';
  const failed = failedAgents.join(', ');
  const ok = okAgents.join(', ');
  if (language === 'en') {
    return okAgents.length > 0
      ? `> ⚠️ **Partial analysis.** ${failed} could not complete the analysis due to a technical error. This answer covers ONLY: ${ok}. Retry the query before acting on it.\n\n`
      : `> ⚠️ **Partial analysis.** ${failed} could not complete the analysis due to a technical error.\n\n`;
  }
  return okAgents.length > 0
    ? `> ⚠️ **Análisis parcial.** ${failed} no pudo completar el análisis por un error técnico. Esta respuesta cubre ÚNICAMENTE: ${ok}. Reintente la consulta antes de actuar sobre ella.\n\n`
    : `> ⚠️ **Análisis parcial.** ${failed} no pudo completar el análisis por un error técnico.\n\n`;
}

interface SynthesisInput {
  originalQuery: string;
  specialistOutputs: { agent: string; result: SpecialistResult }[];
  language: 'es' | 'en';
  /** Callback for streaming partial content tokens */
  onStreamToken?: (delta: string) => void;
  /** Abort signal to cancel the call */
  abortSignal?: AbortSignal;
}

// El sintetizador corre sobre un reasoning model: los reasoning tokens se
// descuentan del MISMO presupuesto que el texto visible. Con 4096 un merge
// extenso (3+ agentes, tabla de plan de accion) se cortaba a mitad de la
// tabla sin que nada lo detectara.
const SYNTHESIZER_MAX_OUTPUT_TOKENS = 12_000;

export async function synthesizeResponses(input: SynthesisInput): Promise<string> {
  const { originalQuery, specialistOutputs, language, onStreamToken, abortSignal } = input;

  const validOutputs = specialistOutputs.filter((so) => !isFailedSpecialistOutput(so.result.content));
  const failedAgents = specialistOutputs
    .filter((so) => isFailedSpecialistOutput(so.result.content))
    .map((so) => so.agent);
  const notice = buildDegradedNotice(
    failedAgents,
    validOutputs.map((so) => so.agent),
    language,
  );

  // Cero sobrevivientes: el orquestador ya cubre el caso "todos fallaron", pero
  // si llegara aqui NO se puede devolver texto vacio como si fuera respuesta.
  if (validOutputs.length === 0) {
    if (onStreamToken && notice) onStreamToken(notice);
    return notice;
  }

  // Un solo sobreviviente: no hay nada que sintetizar. Se emite su contenido
  // tal cual, pero PRECEDIDO del aviso de degradacion si hubo caidos.
  if (validOutputs.length === 1) {
    const single = `${notice}${validOutputs[0].result.content}`;
    if (onStreamToken && single) onStreamToken(single);
    return single;
  }

  // Solo los bloques con contenido real llegan al modelo: un bloque de fallo no
  // es un hallazgo y alimentarlo invita a que el sintetizador lo parafrasee.
  const blocks = validOutputs
    .map((so) => `[${so.agent.toUpperCase()}]:\n${so.result.content}`)
    .join('\n\n---\n\n');

  const messages = [
    { role: 'system' as const, content: buildSynthesizerPrompt(language) },
    {
      role: 'user' as const,
      content: `Original user query: ${originalQuery}\n\nSpecialist outputs:\n\n${blocks}`,
    },
  ];

  // El aviso se emite UNA sola vez aunque el stream falle y caigamos al fallback.
  let noticeEmitted = false;
  const emitNoticeOnce = () => {
    if (!onStreamToken || !notice || noticeEmitted) return;
    noticeEmitted = true;
    onStreamToken(notice);
  };

  try {
    if (onStreamToken) {
      // withRetry solo protege la conexion inicial — si el stream falla a medio
      // camino no reintentamos para no duplicar tokens al cliente. Mismo
      // comportamiento que el codigo OpenAI SDK previo.
      const stream = await withRetry(
        () =>
          Promise.resolve(
            streamText({
              model: MODELS.SYNTHESIZER,
              messages,
              temperature: 0.1,
              maxOutputTokens: SYNTHESIZER_MAX_OUTPUT_TOKENS,
              abortSignal,
            }),
          ),
        { label: 'synthesizer_stream', maxAttempts: 2, signal: abortSignal },
      );
      emitNoticeOnce();
      let acc = '';
      for await (const delta of stream.textStream) {
        abortSignal?.throwIfAborted?.();
        if (delta) {
          acc += delta;
          onStreamToken(delta);
        }
      }
      // El corte por `length` no lanza: sin este chequeo un merge truncado se
      // entregaba como respuesta terminada.
      try {
        assertFinishedCleanly({ finishReason: await stream.finishReason, text: acc }, 'synthesizer_stream');
      } catch { /* telemetria best-effort: nunca romper la respuesta ya emitida */ }
      return `${notice}${acc}`;
    }

    const result = await withRetry(
      () =>
        generateText({
          model: MODELS.SYNTHESIZER,
          messages,
          temperature: 0.1,
          maxOutputTokens: SYNTHESIZER_MAX_OUTPUT_TOKENS,
          abortSignal,
        }),
      { label: 'synthesizer', maxAttempts: 2, signal: abortSignal },
    );
    assertFinishedCleanly(result, 'synthesizer');

    return `${notice}${result.text || ''}`;
  } catch (error) {
    console.warn('[synthesizer] Failed after retries:', error instanceof Error ? error.message : error);
    // Fallback: concatenate outputs with headers instead of failing entirely
    const body = validOutputs
      .map((so) => `## ${so.agent}\n\n${so.result.content}`)
      .join('\n\n---\n\n');
    if (onStreamToken) {
      emitNoticeOnce();
      onStreamToken(body);
    }
    return `${notice}${body}`;
  }
}
