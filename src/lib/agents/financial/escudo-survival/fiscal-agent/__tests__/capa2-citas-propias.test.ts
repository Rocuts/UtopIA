// ---------------------------------------------------------------------------
// Capa 2 no bloquea las citas que exigen los propios módulos del Agente Fiscal
// ---------------------------------------------------------------------------
// Revisión de la fase 2 (pendiente #8). El Motor Normativo (Capa 2) bloquea
// toda cita que no esté en su catálogo. El esqueleto de la carta DIAN, el
// refund-analyzer y los prompts de Defensa y Devoluciones citan (y exigen con
// ALWAYS) los Arts. 684, 686, 703, 707, 716, 651, 857, 860, 807 y 670 E.T. y
// el Art. 261 de la Ley 223 de 1995, que no estaban catalogados: una carta de
// defensa o un análisis de devolución honesto quedaba siempre en «bloqueo», y
// el veredicto de M5/M6 recién conectados no podía ser otro.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';

const llm: Record<string, unknown> = {};
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async (opts: { agentName: string }) => {
    if (!(opts.agentName in llm)) throw new Error(`sin fixture para ${opts.agentName}`);
    return { json: structuredClone(llm[opts.agentName]), meta: {} };
  }),
}));

import { MOTOR_NORMATIVO_CATALOG } from '../../normative';
import { validateNormativeResponse } from '../../normative/validators/normative.validator';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { buildFiscalAnchor } from '../../fiscal-anchor';
import { orchestrateFiscalAgent } from '../orchestrator';
import { computeRiskScore } from '../tools/risk-score-calculator';
import { analyzeRefund, REFUND_NO_DETERMINABLE_MOTIVO } from '../tools/refund-analyzer';
import { classificationFromKind, reduccionesDisponibles } from '../tools/dian-letter-builder';
import type { DianRequirementKind } from '../types';

const CSV = `codigo,nombre,nivel,transaccional,Saldo 2025
110505,Caja general,Auxiliar,1,18000000
135515,Retencion en la fuente,Auxiliar,1,150000000
220505,Proveedores nacionales,Auxiliar,1,310000000
310505,Capital suscrito y pagado,Auxiliar,1,150000000
413550,Comercio al por mayor y al por menor,Auxiliar,1,1240000000
613550,Costo de venta de mercancias,Auxiliar,1,760000000
510506,Sueldos de personal administrativo,Auxiliar,1,158000000
540505,Impuesto de renta y complementarios,Auxiliar,1,30000000
`;
const p = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
const company = { name: 'PYME', nit: '900123456-1' };
const anchor = buildFiscalAnchor({ preprocessed: p, company, hoy: new Date('2026-09-23T12:00:00Z') });

const KINDS: DianRequirementKind[] = [
  'requerimiento_ordinario',
  'requerimiento_especial',
  'emplazamiento_corregir',
  'emplazamiento_no_declarar',
  'pliego_cargos',
  'liquidacion_oficial_revision',
  'desconocido',
];

function bloqueadas(texto: string): string[] {
  const r = validateNormativeResponse(texto, MOTOR_NORMATIVO_CATALOG);
  return [...new Set(r.citations.filter((c) => c.veredicto === 'bloqueo').map((c) => c.citation.normalized))];
}

describe('Capa 2 — citas de los módulos deterministas del Agente Fiscal', () => {
  it('plazos, normas y reducciones del esqueleto de la carta DIAN están catalogados', () => {
    const texto = KINDS.map((k) => {
      const c = classificationFromKind(k);
      return [c.plazoRespuesta, c.normaPlazo, ...reduccionesDisponibles(k)].join('\n');
    }).join('\n');
    expect(bloqueadas(texto)).toEqual([]);
  });

  it('el refund-analyzer (con y sin saldo declarado) sólo cita normas catalogadas', () => {
    const textos = [null, '0', '2500000000'].map((s) => {
      const a = analyzeRefund(anchor, { saldoAFavorDeclaradoCents: s });
      return [a.plazoDian, a.plazoConGarantia, a.normaRef, ...a.documentosBase, ...a.pasosBase, ...a.riesgosBase].join('\n');
    });
    expect(bloqueadas([...textos, REFUND_NO_DETERMINABLE_MOTIVO].join('\n'))).toEqual([]);
  });

  it('las citas que los prompts de Defensa y Devoluciones exigen con ALWAYS están catalogadas', () => {
    const texto = [
      'Art. 684 E.T.', 'Art. 686 E.T.', 'Art. 261 Ley 223/1995', 'Art. 703 E.T.', 'Art. 707 E.T.',
      'Art. 685 E.T.', 'Art. 715 E.T.', 'Art. 716 E.T.', 'Art. 651 E.T.', 'Art. 702 E.T.', 'Art. 720 E.T.',
      'Art. 709 E.T.', 'Art. 713 E.T.', 'Art. 640 E.T.', 'Art. 850 E.T.', 'Art. 854 E.T.', 'Art. 855 E.T.',
      'Art. 857 E.T.', 'Art. 860 E.T.', 'Art. 807 E.T.', 'Art. 670 E.T.', 'Art. 147 E.T.',
    ].join('. ');
    expect(bloqueadas(texto)).toEqual([]);
  });

  it('el detalle de los factores del Score no cita normas fuera del catálogo', () => {
    const b = computeRiskScore({ anchor, preprocessed: p });
    expect(bloqueadas(b.factores.map((f) => `${f.descripcion} ${f.detalle}`).join('\n'))).toEqual([]);
  });

  it('una norma no catalogada sigue bloqueando', () => {
    expect(bloqueadas('Art. 158-3 E.T.')).toContain('Art. 158-3 E.T.');
  });
});

describe('Agente Fiscal — carta de defensa honesta (requerimiento especial)', () => {
  it('no queda en bloqueo por la Capa 2', async () => {
    const carta = `Señores DIAN — Referencia: respuesta al requerimiento especial

## Antecedentes
Notificado el requerimiento especial (Art. 703 E.T.); se responde dentro de los 3 meses del Art. 707 E.T.

## Posición jurídica del contribuyente
La deducción cumple el Art. 107 E.T.

## Soporte documental
Contratos, facturas y certificación del revisor fiscal.

## Petición
Archivar la actuación.

## Firmas
Representante Legal — Contador Público T.P. 0000-T

Esta respuesta es un borrador para revisión del contador y/o abogado tributarista antes de su envío.`;
    const score = computeRiskScore({ anchor, preprocessed: p }).score;
    llm['escudo-fiscal:ccv'] = {
      markdown: 'ccv', warnings: [],
      data: { f01: '1', f02: '1', f03: '1', f04: '1', f05: '1', f06: '1', f07: '1', f08: '1', f09Pct: 1, f10Pct: 1,
        alertaTasaMinima: { aplica: true, f09Actual: 1, brechaPp: 1, impuestoAdicionalEstimado: '1', norma: 'Art. 240 E.T.' }, eficienciaFiscal: 'alta' },
    };
    llm['escudo-fiscal:risk-score'] = {
      markdown: `Score ${score}/100 según el desglose determinista.`, warnings: [],
      data: { score: 0, nivel: 'bajo', factores: [], interpretacion: 'Riesgo según el desglose determinista.', recomendaciones: [] },
    };
    llm['escudo-fiscal:defensa-dian'] = {
      markdown: carta, warnings: [],
      data: {
        tipoRequerimiento: 'requerimiento_especial', plazoRespuesta: 'x', normaPlazo: 'x',
        antecedentes: 'a', posicionJuridica: 'p', citasNormativas: [], soportesDocumentales: ['s'],
        defensaArt647: null, reduccionesDisponibles: [], cartaCompleta: carta,
      },
    };
    llm['escudo-fiscal:synthesizer'] = {
      markdown:
        'Este análisis fue generado por El Escudo (1+1 IA). Las cifras y posiciones deben ser validadas por un contador público o asesor tributario antes de su uso oficial o presentación ante la DIAN.',
      topRecommendations: [], cierre: 'c',
    };
    const r = await orchestrateFiscalAgent({
      rawData: '', preprocessed: p, fiscalAnchor: anchor, company, mode: 'defensa_dian',
      dianRequirementText: 'Requerimiento especial No. 123 por renta 2025',
    });
    const cn = r.validation.checks.filter((c) => c.name.startsWith('CN.') && !c.passed && c.severity === 'error');
    expect(cn).toEqual([]);
  });
});
