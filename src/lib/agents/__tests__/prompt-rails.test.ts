// ---------------------------------------------------------------------------
// Regresion — rails de honestidad en los prompts de synthesizer y enhancer
// ---------------------------------------------------------------------------
//
// Hallazgos cubiertos:
//   - synthesizer-sin-rail-antialucinacion: el autor final de TODA respuesta T3
//     no tenia seccion anti-alucinacion y su propio prompt le ofrecia articulos
//     concretos (Art. 685, Art. 26, Art. 730) como ejemplos copiables; ademas
//     anunciaba etiquetas de entrada [TAX AGENT] mientras recibe
//     [AGENTE TRIBUTARIO], y solo conocia 4 agentes (sin el Litigante).
//   - enhancer-inyecta-citas-inventadas: el enhancer (sin retrieval, sin tools)
//     tenia la instruccion de mapear frases a articulos del E.T. y su salida
//     REEMPLAZA el mensaje del usuario, asi que la cita entraba en el turno del
//     usuario y ningun rail del especialista podia bloquearla.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { buildSynthesizerPrompt } from '../prompts/synthesizer.prompt';
import { ENHANCER_PROMPT } from '../prompts/enhancer.prompt';

describe('buildSynthesizerPrompt', () => {
  const prompt = buildSynthesizerPrompt('es');

  it('lleva rail anti-alucinacion explicito', () => {
    expect(prompt).toMatch(/ANTI-HALUCINACION|ANTI-ALUCINACION/i);
    expect(prompt).toMatch(/NEVER introduce an article/i);
  });

  it('obliga a declarar contradicciones en vez de resolverlas', () => {
    expect(prompt).toMatch(/contradict/i);
    expect(prompt).toMatch(/DECLARE the contradiction/i);
  });

  it('no ofrece articulos concretos como ejemplo copiable', () => {
    // El prompt viejo traia "Art. 685 E.T.", "Art. 26 E.T." y "Art. 730 E.T."
    // dentro de sus ejemplos de conexion cross-domain.
    expect(prompt).not.toMatch(/Art\.\s*\d+\s*E\.T\./);
  });

  it('conoce a los 5 especialistas, incluido el Agente Litigante', () => {
    expect(prompt).toContain('Agente Litigante');
    expect(prompt).toMatch(/up to 5/);
  });

  it('anuncia las etiquetas de entrada que realmente recibe (displayName en mayusculas)', () => {
    expect(prompt).toContain('[AGENTE TRIBUTARIO]');
    expect(prompt).toContain('[AGENTE CONTABLE]');
    expect(prompt).not.toContain('[TAX AGENT]');
  });
});

describe('ENHANCER_PROMPT', () => {
  it('prohibe agregar referencias normativas que el usuario no escribio', () => {
    expect(ENHANCER_PROMPT).toMatch(/NEVER add a normative reference the user did not write/i);
    expect(ENHANCER_PROMPT).toMatch(/no law, decree, resolution/i);
  });

  it('ya no instruye a mapear frases coloquiales a articulos del E.T.', () => {
    // Regla 3 vieja: "sancion por declarar tarde" → "... (Art. 641 E.T.)".
    expect(ENHANCER_PROMPT).not.toMatch(/Add legal\/accounting framework hints/i);
    expect(ENHANCER_PROMPT).not.toMatch(/Add specific E\.T\. article references/i);
    expect(ENHANCER_PROMPT).not.toMatch(/→\s*"[^"]*Art\.\s*\d+/);
  });

  it('preserva las referencias que el propio usuario escribio', () => {
    expect(ENHANCER_PROMPT).toMatch(/Preserve the user's own references/i);
  });

  it('conoce el dominio litigation en los 5 dominios enrutables', () => {
    expect(ENHANCER_PROMPT).toContain('"litigation"');
    expect(ENHANCER_PROMPT).toMatch(/5 specialist agents/);
  });
});
