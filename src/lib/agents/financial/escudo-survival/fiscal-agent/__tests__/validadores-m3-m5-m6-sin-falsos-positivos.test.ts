// ---------------------------------------------------------------------------
// Agente Fiscal — M3, M5 y M6 no bloquean salidas honestas
// ---------------------------------------------------------------------------
// Revisión adversarial de la fase 2 (pendiente #8). Con M3/M5/M6 conectados,
// un error de estos validadores deja el veredicto en «bloqueo». Casos honestos
// que bloqueaban:
//   - M6.L2.1 con language = 'en': «F04 = $X is an accounting estimate» no
//     cumplía el rótulo (sólo había patrones en español), y una mención neutra
//     del monto en otra oración («Su valor es $X.») contaba como «saldo a favor».
//   - M6.L3.1: documentos parafraseados por el modelo («Formato 010», «Relación
//     de agentes retenedores con NIT», «Declaración de renta … (Formulario
//     110)») no cumplían los patrones, aunque el análisis determinista ya
//     conoce la lista de requisitos.
//   - M5.L2.4: cualquier «reducción» (p. ej. «la reducción de los ingresos»)
//     exigía una norma de reducción de SANCIÓN.
//   - M5 con language = 'en': encabezados y cierre en inglés.
//   - M3.L2.3: «30.000 de 100.000 UVT» se leía como un score 30/100.
//   - M3.L3.1: «Survival Mode» en inglés no contaba como recomendación.
// Cada caso fija también que la violación real sigue detectándose.
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
import { analyzeRefund } from '../tools/refund-analyzer';
import { classificationFromKind } from '../tools/dian-letter-builder';
import { validateDevolucionesL2 } from '../validators/devoluciones.validator';
import { validateDefensaDian } from '../validators/defensa-dian.validator';
import { scoresCitadosEnProsa, validateRiskScoreL3 } from '../validators/risk-score.validator';
import type { Modulo3RiskScore, Modulo5DefensaDian, Modulo6Devoluciones } from '../validators/types';

// UAI = 1.240M − 760M − 158M = 322M → F02 = 112,7M; F03 = 150M → F04 = −37,3M.
// 111005 Bancos cuadra la ecuación con el resultado del ejercicio sin trasladar
// (A = P + K + resultado: 752.000.000 = 310.000.000 + 150.000.000 + 292.000.000).
// Sin ella el balance estaba descuadrado y el Escudo lo bloquea como /niif
// (I4-escudo 2). No cambia la UAI, F02, F03 ni F04.
const CSV = `codigo,nombre,nivel,transaccional,Saldo 2025
110505,Caja general,Auxiliar,1,18000000
111005,Bancos nacionales,Auxiliar,1,584000000
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
const devolJson = (markdown: string, documentos: string[], riesgos: string[] = []) => ({
  markdown, warnings: [],
  data: { saldoAFavor: '999', viabilidad: 'alta', plazoDian: 'x', plazoConGarantia: 'x', documentosRequeridos: documentos,
    pasosProcedimentales: ['Presentar la solicitud dentro del término del Art. 854 E.T.'], riesgosIdentificados: riesgos, normaRef: 'x' },
});

beforeEach(() => {
  for (const k of Object.keys(llm)) delete llm[k];
  llm['escudo-fiscal:ccv'] = ccvJson;
  llm['escudo-fiscal:synthesizer'] = { markdown: CIERRE, topRecommendations: [], cierre: 'c' };
  llm['escudo-fiscal:risk-score'] = riskJson(`Score ${score}/100 según el desglose determinista.`);
});

const m36 = (r: Awaited<ReturnType<typeof orchestrateFiscalAgent>>) =>
  r.validation.checks.filter((c) => /^M[356]\./.test(c.name) && !c.passed && c.severity === 'error');

// ── M6 ──────────────────────────────────────────────────────────────────────

describe('M6 — prosa honesta sobre F04', () => {
  const base: Modulo6Devoluciones = {
    saldoDeclaradoCents: null,
    saldoAFavorCents: null,
    viabilidad: 'no_determinable',
    f04Cents: '-3730000000',
    textoAnalisis: '',
    documentosRequeridos: [],
    pasosProcedimentales: [],
  };
  const l21 = (texto: string) =>
    validateDevolucionesL2({ ...base, textoAnalisis: texto }).find(
      (c) => c.name === 'M6.L2.1_f04_no_presentado_como_saldo_a_favor',
    );

  it('en inglés, F04 rotulado como estimación contable no bloquea', () => {
    expect(l21('F04 = $37.300.000,00 is an accounting estimate, not a refundable balance (Art. 850 E.T.).')?.passed).toBe(true);
  });

  it('una mención neutra del monto en otra oración no es «saldo a favor»', () => {
    expect(l21('F04 es una estimación contable, no un saldo liquidado. Su valor es $37.300.000,00.')?.passed).toBe(true);
  });

  it('presentar |F04| como saldo a favor o devolución sigue fallando (es y en)', () => {
    expect(l21('Recomendamos solicitar la devolución del saldo a favor de $37.300.000,00 ante la DIAN.')?.passed).toBe(false);
    expect(l21('We recommend requesting a refund of the $37.300.000,00 balance in favor of the company.')?.passed).toBe(false);
  });
});

describe('M6 — requisitos de la solicitud con saldo declarado (orquestador, modo devolucion)', () => {
  const PROSA_OK =
    'La declaración liquida un saldo a favor. Derecho a devolución o compensación (Art. 850 E.T.), término de 2 años (Art. 854 E.T.) y 50 días hábiles para resolver (Art. 855 E.T.); con garantía, 20 días (Art. 860 E.T.).';

  it('documentos parafraseados por el modelo: los requisitos base se publican y no hay bloqueo de M6', async () => {
    llm['escudo-fiscal:devoluciones'] = devolJson(PROSA_OK, [
      'Formato 010 de solicitud de devolución y/o compensación',
      'Certificado del revisor fiscal sobre la procedencia del saldo',
      'Relación de agentes retenedores con NIT y valores retenidos',
      'Declaración de renta del año gravable 2025 (Formulario 110)',
    ]);
    const r = await orchestrateFiscalAgent({
      rawData: '', preprocessed: p, fiscalAnchor: anchor, company, mode: 'devolucion',
      saldoAFavorDeclaradoCents: '2500000000',
    });
    const base = analyzeRefund(anchor, { saldoAFavorDeclaradoCents: '2500000000' }).documentosBase;
    expect(r.devoluciones?.data.documentosRequeridos.slice(0, base.length)).toEqual(base);
    expect(r.devoluciones?.data.documentosRequeridos).toContain('Formato 010 de solicitud de devolución y/o compensación');
    expect(m36(r)).toEqual([]);
  });

  it('las citas 850/854/855 siguen siendo exigibles en la prosa del modelo', async () => {
    llm['escudo-fiscal:devoluciones'] = devolJson('Solicitar la devolución del saldo declarado.', ['Carta']);
    const r = await orchestrateFiscalAgent({
      rawData: '', preprocessed: p, fiscalAnchor: anchor, company, mode: 'devolucion',
      saldoAFavorDeclaradoCents: '2500000000',
    });
    expect(r.validation.checks.find((c) => c.name === 'M6.L2.2_citas_850_854_855')?.passed).toBe(false);
    expect(r.validation.veredicto).toBe('bloqueo');
  });

  it('en inglés sin declaración: la prosa honesta no bloquea', async () => {
    llm['escudo-fiscal:devoluciones'] = devolJson(
      `Without the filed return (Form 110) the refundable balance cannot be determined. F04 = ${f04Abs} is an accounting reference estimate, not a refundable balance (Arts. 26, 807 and 850 E.T.).`,
      [],
    );
    const r = await orchestrateFiscalAgent({
      rawData: '', preprocessed: p, fiscalAnchor: anchor, company, mode: 'devolucion', language: 'en',
    });
    expect(m36(r)).toEqual([]);
  });
});

// ── M5 ──────────────────────────────────────────────────────────────────────

function m5(tipo: Modulo5DefensaDian['tipoRequerimiento'], carta: string): Modulo5DefensaDian {
  const c = classificationFromKind(tipo);
  return { tipoRequerimiento: tipo, plazoRespuesta: c.plazoRespuesta, normaPlazo: c.normaPlazo, cartaTexto: carta, defensaArt647: null };
}

const CARTA_ORDINARIO = (posicion: string) => `## Antecedentes
Requerimiento ordinario notificado; se responde conforme a los Arts. 684 y 686 E.T.

## Posición jurídica del contribuyente
${posicion}

## Soporte documental
Facturas electrónicas y libros auxiliares.

## Petición
Archivar la actuación.

## Firmas
Representante Legal — Contador Público T.P. 0000-T

Esta respuesta es un borrador para revisión del contador y/o abogado tributarista antes de su envío.`;

describe('M5 — carta honesta', () => {
  const fallos = (m: Modulo5DefensaDian) =>
    validateDefensaDian(m).filter((c) => !c.passed && c.severity === 'error').map((c) => c.name);

  it('«reducción» como hecho del caso (no de sanción) no exige norma de reducción', () => {
    const carta = CARTA_ORDINARIO('La reducción de los ingresos de 2025 obedece a la caída de ventas documentada.');
    expect(fallos(m5('requerimiento_ordinario', carta))).toEqual([]);
  });

  it('una reducción de la sanción sin norma sigue fallando', () => {
    const carta = CARTA_ORDINARIO('Solicitamos la reducción de la sanción propuesta.');
    expect(fallos(m5('requerimiento_ordinario', carta))).toContain('M5.L2.4_reduccion_cita_norma');
    const soportada = CARTA_ORDINARIO('Solicitamos la reducción de la sanción por gradualidad (Art. 640 E.T.).');
    expect(fallos(m5('requerimiento_ordinario', soportada))).toEqual([]);
  });

  it('carta con encabezados y cierre en inglés (language = en) no bloquea', () => {
    const carta = `## Background
Ordinary request answered under Arts. 684 and 686 E.T.

## Legal position of the taxpayer
The deduction complies with Art. 107 E.T.

## Supporting documents
Invoices and ledgers.

## Request
Close the proceeding.

## Signatures
Legal representative — Public accountant

This response is a draft for review by the accountant and/or tax attorney before it is sent.`;
    expect(fallos(m5('requerimiento_ordinario', carta))).toEqual([]);
  });

  it('una carta sin sección de petición sigue fallando', () => {
    const carta = CARTA_ORDINARIO('Posición.').replace(/## Petición[\s\S]*?(?=## Firmas)/, '');
    expect(fallos(m5('requerimiento_ordinario', carta))).toContain('M5.L1.1_secciones_presentes');
  });
});

// ── M3 ──────────────────────────────────────────────────────────────────────

describe('M3 — prosa honesta del score', () => {
  it('«30.000 de 100.000 UVT» no es un score citado', () => {
    expect(scoresCitadosEnProsa('La sobretasa exige 30.000 de 100.000 UVT.')).toEqual([]);
    expect(scoresCitadosEnProsa('Score 45/100 (45 de 100 puntos).')).toEqual([45, 45]);
  });

  it('score > 60 con «Survival Mode» recomendado en inglés pasa L3.1', () => {
    const m3: Modulo3RiskScore = {
      score: 75, nivel: 'muy_alto', factores: [], publicable: true, noPublicableMotivo: null, f01Cents: '100',
      narrativa: 'High DIAN risk.', recomendaciones: ['Activate the Elite Survival Mode (Module 8).'], modoSupervivenciaActivo: null,
    };
    expect(validateRiskScoreL3(m3)[0].passed).toBe(true);
    expect(validateRiskScoreL3({ ...m3, recomendaciones: ['Review the deductions.'] })[0].passed).toBe(false);
  });
});
