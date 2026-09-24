// ---------------------------------------------------------------------------
// Agente Fiscal — M3, M5 y M6 validan lo que el agente realmente publica
// ---------------------------------------------------------------------------
// Fase 2 de la auditoría 2026-09-24 (pendiente #8, tributario-modulos-03):
// los validadores de Score (M3), Defensa DIAN (M5) y Devoluciones (M6)
// esperaban un contrato que el agente no produce (factores de otra fórmula,
// otra taxonomía de actuaciones DIAN y F04 como «saldo a favor»), así que
// quedaban en `modulosSinValidar`. Ahora validan la salida real:
//   - M3: score/nivel/factores deterministas y la prosa del modelo que los cita.
//   - M5: tipo/plazo del esqueleto determinista y la carta del modelo.
//   - M6: saldo DECLARADO (Formulario 110), viabilidad y que la prosa no
//         presente F04 (posición de referencia contable) como saldo a favor.
// Cada caso inyecta una salida manipulada del modelo.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

const llm: Record<string, unknown> = {};
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async (opts: { agentName: string }) => {
    if (!(opts.agentName in llm)) throw new Error(`sin fixture para ${opts.agentName}`);
    return { json: structuredClone(llm[opts.agentName]), meta: {} };
  }),
}));

import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { buildFiscalAnchor } from '../../fiscal-anchor';
import { orchestrateFiscalAgent } from '../orchestrator';
import { computeRiskScore } from '../tools/risk-score-calculator';
import { classifyDianRequirement } from '../tools/dian-letter-builder';

// UAI = 1.240M − 760M − 158M = 322M → F02 = 112,7M; F03 (135515) = 150M
// → F04 = −37,3M (posición de referencia contable, NO saldo a favor).
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
const score = computeRiskScore({ anchor, preprocessed: p }).score;
const f04Abs = formatCopFromCents(-BigInt(anchor.f04));

const CIERRE =
  'Este análisis fue generado por El Escudo (1+1 IA). Las cifras y posiciones deben ser validadas por un contador público o asesor tributario antes de su uso oficial o presentación ante la DIAN.';

const ccvJson = {
  markdown: 'ccv', warnings: [],
  data: { f01: '1', f02: '1', f03: '1', f04: '1', f05: '1', f06: '1', f07: '1', f08: '1', f09Pct: 1, f10Pct: 1,
    alertaTasaMinima: { aplica: true, f09Actual: 1, brechaPp: 1, impuestoAdicionalEstimado: '1', norma: 'x' }, eficienciaFiscal: 'alta' },
};
const riskJson = (markdown: string) => ({
  markdown, warnings: [],
  data: { score: 10, nivel: 'bajo', factores: [], interpretacion: 'Riesgo según el desglose determinista.', recomendaciones: [] },
});
const devolJson = (markdown: string, documentos: string[] = []) => ({
  markdown, warnings: [],
  data: { saldoAFavor: '999', viabilidad: 'alta', plazoDian: 'x', plazoConGarantia: 'x', documentosRequeridos: documentos,
    pasosProcedimentales: ['radicar'], riesgosIdentificados: [], normaRef: 'x' },
});
const CARTA_OK = `Señores DIAN — Referencia: requerimiento especial

## Antecedentes
Notificado el requerimiento especial (Art. 703 E.T.); se responde dentro del término del Art. 707 E.T.

## Posición jurídica del contribuyente
La interpretación del Art. 107 E.T. sobre expensas necesarias es razonable.

## Soporte documental
Contratos, facturas y certificaciones del revisor fiscal.

## Defensa diferencia de criterio (parágrafo Art. 647 E.T.)
Conforme al parágrafo del Art. 647 E.T., la diferencia de criterio no constituye inexactitud sancionable.

## Petición
Archivar la actuación.

## Firmas
Representante Legal — Contador Público T.P. 0000-T

Esta respuesta es un borrador para revisión del contador y/o abogado tributarista antes de su envío.`;
const defensaJson = (carta: string, plazo = '15 días hábiles (Art. 752 E.T.)') => ({
  markdown: carta, warnings: [],
  data: {
    tipoRequerimiento: 'requerimiento_ordinario', plazoRespuesta: plazo, normaPlazo: 'Art. 752 E.T.',
    antecedentes: 'a', posicionJuridica: 'p', citasNormativas: [], soportesDocumentales: ['s'],
    defensaArt647: 'Parágrafo del Art. 647 E.T.', reduccionesDisponibles: ['inventada'], cartaCompleta: carta,
  },
});
const synthJson = { markdown: CIERRE, topRecommendations: [], cierre: 'c' };

beforeEach(() => {
  for (const k of Object.keys(llm)) delete llm[k];
  llm['escudo-fiscal:ccv'] = ccvJson;
  llm['escudo-fiscal:synthesizer'] = synthJson;
  llm['escudo-fiscal:risk-score'] = riskJson(`Score ${score}/100 según el desglose determinista.`);
});

const failed = (r: Awaited<ReturnType<typeof orchestrateFiscalAgent>>, name: string) =>
  r.validation.checks.find((c) => c.name === name && !c.passed);

describe('Agente Fiscal — M3/M6 conectados (modo devolucion)', () => {
  it('ningún módulo queda sin validar y corren checks M3.* y M6.*', async () => {
    llm['escudo-fiscal:devoluciones'] = devolJson(
      `Sin la declaración (Formulario 110) el saldo a favor no es determinable. F04 = ${f04Abs} es una estimación contable, no un saldo a favor (Arts. 26, 807 y 850 E.T.).`,
    );
    const r = await orchestrateFiscalAgent({ rawData: '', preprocessed: p, fiscalAnchor: anchor, company, mode: 'devolucion' });
    expect(r.validation.modulosSinValidar).toEqual([]);
    expect(r.validation.checks.some((c) => c.name.startsWith('M3.'))).toBe(true);
    expect(r.validation.checks.some((c) => c.name.startsWith('M6.'))).toBe(true);
    const m3m6Fallidos = r.validation.checks.filter((c) => /^M[36]\./.test(c.name) && !c.passed);
    expect(m3m6Fallidos).toEqual([]);
  });

  it('M3: la prosa del modelo no puede publicar un score distinto al determinista', async () => {
    llm['escudo-fiscal:risk-score'] = riskJson(`Score ${score + 40}/100 — riesgo crítico.`);
    llm['escudo-fiscal:devoluciones'] = devolJson('Devolución no determinable sin declaración.');
    const r = await orchestrateFiscalAgent({ rawData: '', preprocessed: p, fiscalAnchor: anchor, company, mode: 'devolucion' });
    expect(r.riskScore.data.score).toBe(score);
    expect(failed(r, 'M3.L2.3_narrativa_cita_score_determinista')).toBeDefined();
    expect(r.validation.veredicto).toBe('bloqueo');
  });

  it('M6: sin declaración, la prosa no puede presentar |F04| como saldo a favor a devolver', async () => {
    llm['escudo-fiscal:devoluciones'] = devolJson(
      `Recomendamos solicitar la devolución del saldo a favor de ${f04Abs} ante la DIAN.`,
    );
    const r = await orchestrateFiscalAgent({ rawData: '', preprocessed: p, fiscalAnchor: anchor, company, mode: 'devolucion' });
    expect(r.devoluciones?.data.saldoAFavor).toBeNull();
    expect(failed(r, 'M6.L2.1_f04_no_presentado_como_saldo_a_favor')).toBeDefined();
    expect(r.validation.veredicto).toBe('bloqueo');
  });

  it('M6: con saldo declarado exige citas 850/854/855; los requisitos los fija el análisis determinista', async () => {
    llm['escudo-fiscal:devoluciones'] = devolJson('Solicitar la devolución del saldo declarado.', ['Carta']);
    const r = await orchestrateFiscalAgent({
      rawData: '', preprocessed: p, fiscalAnchor: anchor, company, mode: 'devolucion',
      saldoAFavorDeclaradoCents: '2500000000',
    });
    expect(r.devoluciones?.data.saldoAFavor).toBe('2500000000');
    expect(failed(r, 'M6.L2.2_citas_850_854_855')).toBeDefined();
    // Revisión de la fase 2: una lista incompleta del modelo ya no llega al
    // cliente — el agente publica los documentos base del refund-analyzer y
    // añade los del modelo; M6.L3.1 verifica esa lista publicada.
    expect(r.devoluciones?.data.documentosRequeridos).toContain('Carta');
    expect(failed(r, 'M6.L3.1_requisitos_completos')).toBeUndefined();
  });
});

describe('Agente Fiscal — M5 conectado (modo defensa_dian)', () => {
  it('tipo y plazo salen del esqueleto determinista y la carta completa pasa M5', async () => {
    llm['escudo-fiscal:defensa-dian'] = defensaJson(CARTA_OK);
    const r = await orchestrateFiscalAgent({
      rawData: '', preprocessed: p, fiscalAnchor: anchor, company, mode: 'defensa_dian',
      dianRequirementText: 'Requerimiento especial No. 123 por renta 2025',
    });
    const esperado = classifyDianRequirement('requerimiento especial');
    expect(r.defensaDian?.data.tipoRequerimiento).toBe('requerimiento_especial');
    expect(r.defensaDian?.data.plazoRespuesta).toBe(esperado.plazoRespuesta);
    expect(r.defensaDian?.data.normaPlazo).toBe(esperado.normaPlazo);
    expect(r.validation.modulosSinValidar).toEqual([]);
    const m5Fallidos = r.validation.checks.filter((c) => c.name.startsWith('M5.') && !c.passed);
    expect(m5Fallidos).toEqual([]);
  });

  it('M5: carta sin la declaración de borrador ni sección de petición bloquea', async () => {
    const mala = CARTA_OK.replace(/## Petición[\s\S]*?## Firmas/, '## Firmas').replace(/Esta respuesta es un borrador[^\n]*/, '');
    llm['escudo-fiscal:defensa-dian'] = defensaJson(mala);
    const r = await orchestrateFiscalAgent({
      rawData: '', preprocessed: p, fiscalAnchor: anchor, company, mode: 'defensa_dian',
      dianRequirementText: 'Requerimiento especial No. 123',
    });
    expect(failed(r, 'M5.L1.1_secciones_presentes')).toBeDefined();
    expect(failed(r, 'M5.L3.1_cierre_borrador_revision')).toBeDefined();
    expect(r.validation.veredicto).toBe('bloqueo');
  });
});
