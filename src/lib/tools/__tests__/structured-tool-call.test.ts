// ---------------------------------------------------------------------------
// Regresion: las tools LLM de chat no pueden entregar output truncado ni
// invalido, y deben quedar medidas.
// ---------------------------------------------------------------------------
// ESTADO ANTERIOR (auditoria 2026-08): `document-analyzer`, `risk-assessor` y
// `dian-response-generator` llamaban a `generateText` y hacian
// `JSON.parse(result.text)`. Nadie miraba `finishReason`, nadie validaba el
// contrato del output y ninguna de las tres dejaba fila en `agent_telemetry`.
//
// El caso que rompe: el modelo corta por `length` JUSTO despues de cerrar el
// objeto JSON (o devuelve un objeto valido pero con secciones vacias). El parse
// tiene exito, el codigo antiguo lo trata como una respuesta completa y el
// usuario descarga un borrador para radicar ante la DIAN sin fundamento legal
// ni bloque de firma — sin un solo aviso.
//
// Contrato que fijan estos tests:
//   - finishReason != 'stop'  -> NO se entrega; se cae al fallback avisado.
//   - output que no cumple el schema -> NO se entrega.
//   - TODA llamada (incluida la que corto) deja fila de telemetria.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from 'vitest';

const generateTextMock = vi.hoisted(() => vi.fn());
const persistMock = vi.hoisted(() => vi.fn(async (_row: Record<string, unknown>) => true));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateText: generateTextMock };
});

vi.mock('@/lib/db/telemetry', () => ({
  persistAgentTelemetry: persistMock,
  getTelemetryContext: () => undefined,
  runWithTelemetryContext: <T>(_ctx: unknown, fn: () => T) => fn(),
}));

import { analyzeDocument } from '../document-analyzer';
import { assessRisk } from '../risk-assessor';
import { generateDianResponse } from '../dian-response-generator';

/**
 * Resultado del SDK. Se llenan `text` Y `experimental_output` a proposito: el
 * codigo viejo leia `text`, el nuevo lee `experimental_output`. Asi el mismo
 * fixture sirve para comprobar que el test falla contra el codigo viejo.
 */
function sdkResult(obj: unknown, finishReason = 'stop') {
  return {
    finishReason,
    text: JSON.stringify(obj),
    experimental_output: obj,
    usage: { inputTokens: 900, outputTokens: 300, reasoningTokens: 120, cachedInputTokens: 64 },
  };
}

const ANALISIS_COMPLETO = {
  documentType: 'Declaracion de renta persona juridica',
  documentTypeCode: 'declaracion_renta',
  keyFigures: [{ label: 'Total ingresos brutos', value: '$1.250.000.000', category: 'ingreso' }],
  riskIndicators: [],
  relevantArticles: [],
  recommendedActions: ['Verificar la conciliacion fiscal.'],
  summary: 'Declaracion de renta del periodo 2025 con ingresos brutos de $1.250 millones.',
};

const RIESGO_COMPLETO = {
  level: 'alto',
  score: 68,
  factors: [
    { description: 'Termino de respuesta a punto de vencer', severity: 'alto', category: 'procesal' },
  ],
  recommendations: ['Radicar la respuesta antes del vencimiento.'],
  timeline: null,
};

const BORRADOR_COMPLETO = {
  sections: {
    header: 'Bogota D.C., 8 de agosto de 2026\n\nSenores DIAN',
    opening: 'Respetados senores:',
    body: '1. Respecto al punto A: se aporta la factura electronica.',
    evidenceList: 'Anexo 1: Factura electronica FE-1024',
    legalBasis: 'Art. 771-2 E.T.',
    closing: 'Cordialmente,\n\nComercializadora Andina SAS',
  },
  citedArticles: ['Art. 771-2 E.T.'],
  warnings: [],
};

beforeEach(() => {
  generateTextMock.mockReset();
  persistMock.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('finishReason != stop no se entrega como respuesta completa', () => {
  it('document-analyzer: un corte por length cae al fallback, no al analisis', async () => {
    generateTextMock.mockResolvedValue(sdkResult(ANALISIS_COMPLETO, 'length'));

    const res = await analyzeDocument('texto del documento');

    expect(res.documentType).toBe('Documento no identificado');
    expect(res.documentTypeCode).toBe('otro');
    // El usuario tiene que enterarse de que esto NO es el analisis real.
    expect(res.riskIndicators[0].description).toMatch(/finish_reason=length/);
  });

  it('dian-response-generator: un corte por length no produce un escrito radicable', async () => {
    generateTextMock.mockResolvedValue(sdkResult(BORRADOR_COMPLETO, 'length'));

    const res = await generateDianResponse({
      requirementType: 'Requerimiento Ordinario de Informacion',
      taxpayerName: 'Comercializadora Andina SAS',
      keyPoints: ['Soportes de costos'],
      relevantFacts: ['Las facturas estan en el ERP'],
    });

    // El borrador de respaldo SIEMPRE lleva la advertencia; el del modelo no.
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.warnings.join(' ')).toMatch(/borrador basico generado como respaldo/i);
    expect(res.warnings.join(' ')).toMatch(/finish_reason=length/);
  });

  it('risk-assessor: un corte por content-filter no se presenta como evaluacion', async () => {
    generateTextMock.mockResolvedValue(sdkResult(RIESGO_COMPLETO, 'content-filter'));

    const res = await assessRisk('caso tributario');

    expect(res.factors[0].category).toBe('sistema');
    expect(res.factors[0].description).toMatch(/finish_reason=content-filter/);
  });
});

describe('el output se valida contra el contrato Zod', () => {
  it('document-analyzer: una categoria fuera del enum no llega al renderer', async () => {
    generateTextMock.mockResolvedValue(
      sdkResult({
        ...ANALISIS_COMPLETO,
        keyFigures: [{ label: 'Saldo raro', value: '$1', category: 'categoria_inventada' }],
      }),
    );

    const res = await analyzeDocument('texto');

    expect(res.keyFigures).toHaveLength(0);
    expect(res.documentTypeCode).toBe('otro');
  });

  it('dian-response-generator: un escrito sin fundamento legal ni firma se rechaza', async () => {
    generateTextMock.mockResolvedValue(
      sdkResult({
        ...BORRADOR_COMPLETO,
        sections: { ...BORRADOR_COMPLETO.sections, legalBasis: '', closing: '' },
      }),
    );

    const res = await generateDianResponse({
      requirementType: 'Emplazamiento para corregir',
      taxpayerName: 'Comercializadora Andina SAS',
      keyPoints: ['Diferencia en IVA descontable'],
      relevantFacts: ['Se aporta libro auxiliar'],
    });

    expect(res.warnings.join(' ')).toMatch(/borrador basico generado como respaldo/i);
  });

  it('risk-assessor: un score fuera de 0-100 no se presenta al RiskGauge', async () => {
    generateTextMock.mockResolvedValue(sdkResult({ ...RIESGO_COMPLETO, score: 420 }));

    const res = await assessRisk('caso');

    expect(res.factors[0].category).toBe('sistema');
    expect(res.score).toBe(50);
  });
});

describe('telemetria', () => {
  it('cada llamada deja fila, tambien la que corto por length', async () => {
    generateTextMock.mockResolvedValue(sdkResult(RIESGO_COMPLETO, 'length'));

    await assessRisk('caso');
    // La persistencia es fire-and-forget: cedemos el turno al microtask queue.
    await new Promise((r) => setTimeout(r, 0));

    expect(persistMock).toHaveBeenCalledTimes(1);
    const row = persistMock.mock.calls[0][0];
    expect(row.agentName).toBe('tool:risk-assessor');
    expect(row.finishReason).toBe('length');
    expect(row.inputTokens).toBe(900);
    expect(row.outputTokens).toBe(300);
    expect(typeof row.elapsedMs).toBe('number');
  });

  it('el camino feliz tambien queda medido, con el nombre de la tool', async () => {
    generateTextMock.mockResolvedValue(sdkResult(ANALISIS_COMPLETO));

    await analyzeDocument('texto');
    await new Promise((r) => setTimeout(r, 0));

    expect(persistMock).toHaveBeenCalledTimes(1);
    expect(persistMock.mock.calls[0][0].agentName).toBe('tool:document-analyzer');
  });
});

describe('camino feliz — el contrato publico de cada tool no cambio', () => {
  it('document-analyzer devuelve el analisis validado', async () => {
    generateTextMock.mockResolvedValue(sdkResult(ANALISIS_COMPLETO));
    const res = await analyzeDocument('texto', 'renta-2025.pdf');
    expect(res.documentTypeCode).toBe('declaracion_renta');
    expect(res.keyFigures[0].category).toBe('ingreso');
  });

  it('risk-assessor mapea timeline null -> undefined para sus consumidores', async () => {
    generateTextMock.mockResolvedValue(sdkResult(RIESGO_COMPLETO));
    const res = await assessRisk('caso');
    expect(res.level).toBe('alto');
    expect(res.score).toBe(68);
    expect(res.timeline).toBeUndefined();
  });

  it('dian-response-generator arma el fullDraft desde las 6 secciones', async () => {
    generateTextMock.mockResolvedValue(sdkResult(BORRADOR_COMPLETO));
    const res = await generateDianResponse({
      requirementType: 'Requerimiento Ordinario de Informacion',
      taxpayerName: 'Comercializadora Andina SAS',
      keyPoints: ['Soportes de costos'],
      relevantFacts: ['Facturas en el ERP'],
    });
    expect(res.fullDraft).toContain('Anexo 1: Factura electronica FE-1024');
    expect(res.fullDraft).toContain('Art. 771-2 E.T.');
    expect(res.warnings).toHaveLength(0);
  });
});
