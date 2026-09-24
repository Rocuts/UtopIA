// ---------------------------------------------------------------------------
// Evaluador de riesgo — un fallo no se publica como «riesgo medio / 50»
// ---------------------------------------------------------------------------
// Fase 2 de la auditoría 2026-09-24 (tributario-calc-22): ante cualquier error
// (salida truncada, esquema inválido, red) `assessRisk` devolvía level 'medio'
// y score 50, y el RiskGauge lo mostraba como una evaluación legítima. Ahora
// lanza RiskAssessmentUnavailableError con el motivo: la tool del chat lo
// devuelve al modelo como error (tool-error del AI SDK) y no hay aguja.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

const callStructuredTool = vi.fn();
vi.mock('../structured-tool-call', () => ({
  callStructuredTool: (...args: unknown[]) => callStructuredTool(...args),
}));

import { assessRisk, RiskAssessmentUnavailableError } from '../risk-assessor';

beforeEach(() => {
  callStructuredTool.mockReset();
});

describe('assessRisk — N/D con motivo ante error', () => {
  it('un fallo del modelo no se convierte en «medio / 50»', async () => {
    callStructuredTool.mockRejectedValue(new Error('finishReason=length'));
    await expect(assessRisk('Requerimiento especial por $500M')).rejects.toBeInstanceOf(RiskAssessmentUnavailableError);
    await expect(assessRisk('Requerimiento especial por $500M')).rejects.toThrow(/no disponible[\s\S]*finishReason=length/i);
  });

  it('con salida válida devuelve la evaluación del modelo', async () => {
    callStructuredTool.mockResolvedValue({
      level: 'alto', score: 70, factors: [], recommendations: ['Responder dentro del término.'], timeline: null,
    });
    const r = await assessRisk('caso');
    expect(r).toMatchObject({ level: 'alto', score: 70, timeline: undefined });
  });
});
