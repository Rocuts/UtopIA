// ---------------------------------------------------------------------------
// Regresion — T3: fallo parcial silencioso en el sintetizador
// ---------------------------------------------------------------------------
//
// Hallazgo: t3-fallo-parcial-silencioso. Si en T3 mueren todos los
// especialistas menos uno, `synthesizeResponses` devolvia el contenido del
// sobreviviente TAL CUAL y la UI lo presentaba como respuesta completa. Una
// consulta "analiza el requerimiento y dime el riesgo tributario y contable"
// con 2 de 3 agentes caidos se entregaba sin ninguna senal del hueco.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}));
vi.mock('@/lib/config/models', () => ({
  MODELS: { SYNTHESIZER: 'mock-model' },
}));

import { generateText } from 'ai';
import { synthesizeResponses, SPECIALIST_FAILURE_MARKER } from '../synthesizer';
import type { SpecialistResult } from '../types';

const mockGenerateText = vi.mocked(generateText);

function ok(content: string): SpecialistResult {
  return { content, webSearchUsed: false, webSources: [] } as SpecialistResult;
}

function failed(agent: string): SpecialistResult {
  return ok(`[${agent} ${SPECIALIST_FAILURE_MARKER} por un error tecnico.]`);
}

describe('synthesizeResponses — degradacion visible', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('declara el analisis parcial cuando solo sobrevive un especialista', async () => {
    const out = await synthesizeResponses({
      originalQuery: 'analiza el requerimiento y dime el riesgo tributario y contable',
      specialistOutputs: [
        { agent: 'Agente Tributario', result: failed('Agente Tributario') },
        { agent: 'Agente Contable', result: failed('Agente Contable') },
        { agent: 'Agente Documental', result: ok('El documento es un requerimiento especial de 2025.') },
      ],
      language: 'es',
    });

    expect(out).toContain('Análisis parcial');
    expect(out).toContain('Agente Tributario');
    expect(out).toContain('Agente Contable');
    expect(out).toContain('El documento es un requerimiento especial de 2025.');
    // El aviso va ANTES del contenido: el usuario lo ve sin desplazarse.
    expect(out.indexOf('Análisis parcial')).toBeLessThan(
      out.indexOf('El documento es un requerimiento'),
    );
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('emite el aviso tambien por el canal de streaming', async () => {
    const chunks: string[] = [];
    await synthesizeResponses({
      originalQuery: 'q',
      specialistOutputs: [
        { agent: 'Agente Contable', result: failed('Agente Contable') },
        { agent: 'Agente Tributario', result: ok('Sancion aplicable segun el bloque tributario.') },
      ],
      language: 'es',
      onStreamToken: (d) => chunks.push(d),
    });

    expect(chunks.join('')).toContain('Análisis parcial');
  });

  it('antepone el aviso al merge cuando hay 2+ sobrevivientes y no alimenta el bloque caido al modelo', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'Respuesta unificada.',
      finishReason: 'stop',
    } as never);

    const out = await synthesizeResponses({
      originalQuery: 'q',
      specialistOutputs: [
        { agent: 'Agente Tributario', result: ok('Bloque tributario.') },
        { agent: 'Agente Contable', result: ok('Bloque contable.') },
        { agent: 'Agente Documental', result: failed('Agente Documental') },
      ],
      language: 'es',
    });

    expect(out).toContain('Análisis parcial');
    expect(out).toContain('Agente Documental');
    expect(out).toContain('Respuesta unificada.');

    const sentMessages = (mockGenerateText.mock.calls[0][0] as { messages: { content: string }[] })
      .messages;
    const userBlock = sentMessages[1].content;
    expect(userBlock).toContain('Bloque tributario.');
    expect(userBlock).toContain('Bloque contable.');
    // Un bloque de fallo no es un hallazgo: no debe llegar al sintetizador.
    expect(userBlock).not.toContain(SPECIALIST_FAILURE_MARKER);
  });

  it('no agrega ningun aviso cuando todos los especialistas respondieron', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'Respuesta unificada.',
      finishReason: 'stop',
    } as never);

    const out = await synthesizeResponses({
      originalQuery: 'q',
      specialistOutputs: [
        { agent: 'Agente Tributario', result: ok('A') },
        { agent: 'Agente Contable', result: ok('B') },
      ],
      language: 'es',
    });

    expect(out).toBe('Respuesta unificada.');
  });

  it('en ingles el aviso tambien se emite', async () => {
    const out = await synthesizeResponses({
      originalQuery: 'q',
      specialistOutputs: [
        { agent: 'Agente Contable', result: failed('Agente Contable') },
        { agent: 'Agente Tributario', result: ok('Tax block.') },
      ],
      language: 'en',
    });

    expect(out).toContain('Partial analysis');
  });
});
