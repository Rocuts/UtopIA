import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks declarados antes de cualquier import de módulos reales.
// Vitest hoistea vi.mock() al tope del módulo compilado.
// ---------------------------------------------------------------------------

vi.mock('ai', async (importActual) => {
  const actual = await importActual<typeof import('ai')>();
  return { ...actual, generateText: vi.fn() };
});

vi.mock('@/lib/agents/utils/retry', () => ({
  withRetry: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('@/lib/agents/prompts/classifier.prompt', () => ({
  buildClassifierPrompt: vi.fn(() => 'mock system prompt'),
}));

vi.mock('@/lib/config/models', () => ({
  MODELS: { CLASSIFIER: 'mock-classifier-model' },
}));

// ---------------------------------------------------------------------------
// Imports reales (después de mocks para que Vitest los intercepte).
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { withRetry } from '@/lib/agents/utils/retry';
import { buildClassifierPrompt } from '@/lib/agents/prompts/classifier.prompt';
import { classifyQuery } from '../classifier';

const mockGenerate = vi.mocked(generateText);
const mockWithRetry = vi.mocked(withRetry);
const mockBuildPrompt = vi.mocked(buildClassifierPrompt);

// ---------------------------------------------------------------------------
// Helper para simular una respuesta exitosa del LLM
// ---------------------------------------------------------------------------

function mockLlmResponse(output: {
  tier: 'T1' | 'T2' | 'T3';
  domains: string[];
  intent: string;
  confidence: number;
}) {
  mockGenerate.mockResolvedValueOnce({
    experimental_output: output,
  } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('classifyQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default withRetry implementation: call fn directly
    mockWithRetry.mockImplementation((fn: () => unknown) => fn() as never);
  });

  // ─── T1 fast path (regex pre-filter, sin llamada al LLM) ──────────────────

  describe('T1 fast path — regex pre-filter', () => {
    it.each([
      ['hola'],
      ['buenas tardes'],
      ['buenas noches'],
      ['hello'],
      ['hi'],
      ['hey'],
      ['gracias'],
      ['muchas gracias'],
      ['ok'],
      ['okay'],
      ['entendido'],
      ['perfecto'],
      ['listo'],
      ['claro'],
      ['de acuerdo'],
      ['dale'],
      ['si'],
      ['sí'],
      ['no'],
      ['correcto'],
      ['exacto'],
      ['bye'],
      ['adios'],
      ['hasta luego'],
      ['chao'],
    ])('clasifica "%s" como T1 sin invocar el LLM', async (message) => {
      const result = await classifyQuery(message, [], 'general');

      expect(result.tier).toBe('T1');
      expect(result.domains).toHaveLength(0);
      expect(result.intent).toBe('greeting_or_confirmation');
      expect(result.confidence).toBe(0.99);
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('no aplica el fast path a mensajes de más de 80 caracteres aunque empiecen con saludo', async () => {
      mockLlmResponse({ tier: 'T2', domains: ['tax'], intent: 'iva_query', confidence: 0.9 });

      const longMessage = 'hola ' + 'a'.repeat(77); // 82 chars
      const result = await classifyQuery(longMessage, [], 'general');

      expect(result.tier).toBe('T2');
      expect(mockGenerate).toHaveBeenCalledOnce();
    });

    it('no aplica el fast path a mensajes con contenido semántico real', async () => {
      mockLlmResponse({ tier: 'T2', domains: ['tax'], intent: 'iva_query', confidence: 0.88 });

      const result = await classifyQuery('¿Cuál es la tarifa del IVA para servicios?', [], 'tax');

      expect(result.tier).toBe('T2');
      expect(mockGenerate).toHaveBeenCalledOnce();
    });
  });

  // ─── Clasificación basada en LLM ──────────────────────────────────────────

  describe('clasificación LLM', () => {
    it('devuelve T2 con un único dominio', async () => {
      mockLlmResponse({ tier: 'T2', domains: ['tax'], intent: 'renta_query', confidence: 0.85 });

      const result = await classifyQuery('¿Cuándo vence la declaración de renta?', [], 'tax');

      expect(result.tier).toBe('T2');
      expect(result.domains).toEqual(['tax']);
      expect(result.intent).toBe('renta_query');
      expect(result.confidence).toBe(0.85);
    });

    it('devuelve T3 con múltiples dominios', async () => {
      mockLlmResponse({
        tier: 'T3',
        domains: ['tax', 'accounting'],
        intent: 'multi_domain',
        confidence: 0.78,
      });

      const result = await classifyQuery(
        'Analiza el impacto tributario y contable de este balance',
        [],
        'financial-report',
      );

      expect(result.tier).toBe('T3');
      expect(result.domains).toEqual(['tax', 'accounting']);
    });

    it('aplica el safety net: T2 con domains=[] recibe ["tax"]', async () => {
      mockLlmResponse({ tier: 'T2', domains: [], intent: 'unclear', confidence: 0.6 });

      const result = await classifyQuery('esto es ambiguo', [], 'general');

      expect(result.tier).toBe('T2');
      expect(result.domains).toEqual(['tax']);
    });

    it('pasa hasDocument=true a buildClassifierPrompt cuando hay documento', async () => {
      mockLlmResponse({ tier: 'T2', domains: ['documents'], intent: 'doc_analysis', confidence: 0.9 });

      await classifyQuery('Analiza este documento', [], 'general', true);

      expect(mockBuildPrompt).toHaveBeenCalledWith(true);
    });

    it('pasa hasDocument=false a buildClassifierPrompt cuando no hay documento', async () => {
      mockLlmResponse({ tier: 'T2', domains: ['tax'], intent: 'iva_query', confidence: 0.8 });

      await classifyQuery('¿Cuánto es el IVA?', [], 'general');

      expect(mockBuildPrompt).toHaveBeenCalledWith(false);
    });

    it('incluye el historial reciente (últimas 4 entradas) en el prompt', async () => {
      mockLlmResponse({ tier: 'T2', domains: ['tax'], intent: 'follow_up', confidence: 0.75 });

      const history = [
        { role: 'user', content: 'mensaje 1' },
        { role: 'assistant', content: 'respuesta 1' },
        { role: 'user', content: 'mensaje 2' },
        { role: 'assistant', content: 'respuesta 2' },
        { role: 'user', content: 'mensaje 3' },
        { role: 'assistant', content: 'respuesta 3' },
      ];

      await classifyQuery('pregunta de seguimiento', history, 'tax');

      // generateText fue llamado con mensajes que incluyen el contexto reciente
      expect(mockGenerate).toHaveBeenCalledOnce();
      const callArgs = mockGenerate.mock.calls[0][0] as { messages: { role: string; content: string }[] };
      const userMsg = callArgs.messages.find((m) => m.role === 'user');
      // El contexto reciente se serializa en el content del mensaje usuario
      expect(userMsg?.content).toContain('Recent conversation');
    });
  });

  // ─── Fallback por error ────────────────────────────────────────────────────

  describe('fallback por error', () => {
    it('devuelve T2 + tax + confidence=0.3 cuando withRetry falla', async () => {
      mockWithRetry.mockImplementationOnce(() => Promise.reject(new Error('LLM timeout')));

      const result = await classifyQuery('¿Cuándo vence el IVA?', [], 'tax');

      expect(result.tier).toBe('T2');
      expect(result.domains).toEqual(['tax']);
      expect(result.intent).toBe('classifier_error_fallback');
      expect(result.confidence).toBe(0.3);
    });

    it('no lanza excepción hacia el caller cuando el LLM falla', async () => {
      mockWithRetry.mockImplementationOnce(() => Promise.reject(new Error('network error')));

      await expect(
        classifyQuery('consulta tributaria', [], 'general'),
      ).resolves.not.toThrow();
    });
  });
});
