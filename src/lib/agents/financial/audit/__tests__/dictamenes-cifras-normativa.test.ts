// ---------------------------------------------------------------------------
// Dictámenes 2, 3 y 4 — signos, cifras deterministas y normativa
// ---------------------------------------------------------------------------
// auditoria-calidad-02  signo perdido en brecha / posición fiscal / utilidad / IVA
// prompts-normativa-03  TTD calculada como impuesto contable / UAI
// auditoria-calidad-22  1805 como "impuesto diferido" + grupo 24 completo
// prompts-normativa-07  reserva legal SAS, Art. 5 Ley 1258, Art. 36-3 E.T.
// prompts-normativa-08  Art. 155/454 mal enunciado, "S.A." como SAS, plazo Art. 446
// prompts-normativa-13  convocatoria Art. 424 para todos los tipos (Dictamen 3)
// auditoria-calidad-20  anticipo Art. 807 al 75% sin retenciones; "mora" del Art. 641
// auditoria-calidad-23  indicadores DIAN distintos al spec y agregación contradictoria
// prompts-normativa-20  empresa en marcha automática / causal derogada (Dictamen 4)
// auditoria-calidad-17  Arts. 207-209 atribuidos a la Ley 43/1990
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import type {
  LegalAuditReportJson,
  TaxAuditReportJson,
} from '../../contracts/audit-report';
import type { AuditFinding } from '../types';
import type { CompanyInfo } from '../../types';
import { renderTaxDictamenMarkdown, toLegacyTaxAuditorResult } from '../agents/tax-auditor';
import { renderLegalAuditorMarkdown, toLegacyLegalAuditorResult } from '../agents/legal-auditor';
import { renderFiscalReviewerMarkdown, toLegacyFiscalReviewerResult } from '../agents/fiscal-reviewer';
import { buildTaxAuditorPrompt } from '../prompts/tax-auditor.prompt';
import { buildLegalAuditorPrompt } from '../prompts/legal-auditor.prompt';
import { buildFiscalReviewerPrompt } from '../prompts/fiscal-reviewer.prompt';
import { aggregateDianRisk, computeDianRiskIndicators, computeRentaPosition, DIAN_SPEC_INDICATORS } from '../bindings';
import { COMPANY, fiscalJson, preprocessed, simpleJson } from './audit-fixtures';

function taxJson(over: Partial<TaxAuditReportJson> = {}): TaxAuditReportJson {
  return {
    ...(simpleJson(80) as unknown as TaxAuditReportJson),
    rentaAnalysis: {
      tarifaGeneralPct: 35,
      utilidadAntesImpuestosCop: '100000000000',
      provisionTeoricaCop: '1',
      impuestoRegistradoCop: '45000000000',
      brechaCop: '1',
      evaluacion: 'observacion',
      accion: 'a',
      reference: 'Art. 240 E.T.',
    },
    retencionesAnalysis: {
      saldo1355Cop: '1000000000', saldo1805Cop: '99900000', saldo24Cop: '6000000000',
      posicionFiscalNetaCop: '-5000000000', evaluacion: 'e', reference: 'Art. 850 E.T.',
    },
    ivaIcaAnalysis: { pasivoIvaNetoCop: '-300000000', regimenIva: 'responsable', icaComment: 'i', reference: 'r' },
    tmtAnalysis: { tasaMinimaExigidaPct: 15, tasaEfectivaPct: 12, status: 'no_cumple', reference: 'r' },
    riesgosTributarios: [], calendario2026: [],
    auditOpinion: { type: 'con_observaciones', text: 't', exposicionTotalCop: null },
    requiredActions: [],
    ...over,
  };
}

describe('Dictamen 2 — signos (auditoria-calidad-02)', () => {
  it('brecha negativa, posición a pagar e IVA a favor conservan el signo y se rotulan', () => {
    const md = renderTaxDictamenMarkdown(
      taxJson({
        rentaAnalysis: { ...taxJson().rentaAnalysis!, brechaCop: '-10000000000' },
      }),
      [],
    );
    const brecha = md.split('\n').find((l) => l.includes('Diferencia de conciliacion'));
    expect(brecha).toContain('($100.000.000,00)');
    const pos = md.split('\n').find((l) => l.includes('Posicion fiscal neta'));
    expect(pos).toContain('($50.000.000,00) (saldo a pagar)');
    const iva = md.split('\n').find((l) => l.includes('Pasivo IVA neto'));
    expect(iva).toContain('($3.000.000,00) (saldo a favor)');
  });

  it('una UAI negativa se rotula como pérdida', () => {
    const md = renderTaxDictamenMarkdown(
      taxJson({ rentaAnalysis: { ...taxJson().rentaAnalysis!, utilidadAntesImpuestosCop: '-2500000000' } }),
      [],
    );
    expect(md).toContain('Utilidad antes de impuestos: ($25.000.000,00) (pérdida)');
  });
});

describe('Dictamen 2 — TTD y posición de renta (prompts-normativa-03 / auditoria-calidad-22)', () => {
  it('la TTD sale N/D (no_determinable) aunque el LLM haya calculado impuesto/UAI', () => {
    const res = toLegacyTaxAuditorResult(taxJson(), '2025');
    expect(res.fullContent).not.toContain('Tasa efectiva calculada: 12%');
    expect(res.fullContent).not.toContain('NO CUMPLE');
    expect(res.fullContent).toContain('NO DETERMINABLE');
    expect(res.fullContent).toContain('TTD = ID / UD');
  });

  it('el impuesto teórico y la diferencia se recalculan en código (35% × UAI, referencia NIC 12)', () => {
    const res = toLegacyTaxAuditorResult(taxJson(), '2025');
    // 35% × $1.000.000.000 = $350.000.000; − $450.000.000 registrado = ($100.000.000)
    expect(res.fullContent).toContain('$350.000.000,00');
    expect(res.fullContent).toContain('Diferencia de conciliacion (teorico - registrado): ($100.000.000,00)');
    expect(res.fullContent).toContain('no renta liquida');
  });

  it('el prompt ya no ordena TTD = impuestoRegistrado / UAI ni la posición (1355 + 1805) − 24', () => {
    const p = buildTaxAuditorPrompt(COMPANY as never, 'es');
    expect(p).not.toContain('tasaEfectiva = impuestoRegistrado / utilidadAntesImpuestos');
    expect(p).not.toContain('posicionFiscalNeta = (1355 + 1805) - 24');
    expect(p).not.toContain('Cta.1805 (impuesto diferido activo)');
    expect(p).toContain('no_determinable');
  });

  it('posición de renta = (135505 + 135515) − 2404; excluye IVA/ICA y la 1805 "Bienes de arte y cultura"', () => {
    const pos = computeRentaPosition(preprocessed().primary);
    expect(pos.saldo1355RentaCop).toBe('15000000'); // 100.000 + 50.000 pesos
    expect(pos.saldo1805FiscalCop).toBeNull();
    expect(pos.saldo2404Cop).toBe('40000000');
    expect(pos.posicionFiscalNetaCop).toBe('-25000000');
  });

  it('una 1805 cuyo nombre es fiscal sí suma a la posición', () => {
    const pp = preprocessed();
    pp.primary.classes[0].accounts.push({ code: '180510', name: 'Impuesto corriente activo', level: 'aux', balance: 80_000, isLeaf: true });
    expect(computeRentaPosition(pp.primary).posicionFiscalNetaCop).toBe('-17000000');
  });

  it('el adapter reemplaza la posición del LLM por la determinista; sin preprocesador queda N/D', () => {
    const withPp = toLegacyTaxAuditorResult(taxJson(), '2025', preprocessed());
    expect(withPp.fullContent).toContain('Posicion fiscal neta de renta: ($250.000,00) (saldo a pagar)');
    const without = toLegacyTaxAuditorResult(taxJson(), '2025');
    expect(without.fullContent).toContain('Posicion fiscal neta de renta: — Dato no suministrado');
  });
});

function legalJson(over: Partial<LegalAuditReportJson> = {}): LegalAuditReportJson {
  return {
    ...(simpleJson(80) as unknown as LegalAuditReportJson),
    patrimonyDistribution: {
      utilidadNetaCop: '-25000000000',
      reservaLegalObligatoria: true,
      montoReserva10pctCop: '999',
      utilidadDisponibleCop: '-25000000000',
      tipoDividendoPosible: 'no_aplica',
      impuestoDividendosComment: 'Art. 242 E.T.',
    },
    capitalizacionAnalysis: {
      proposed: true,
      baseLegal: 'Ley 1258/2008 Art. 5',
      documentoRequerido: 'Acta',
      beneficioFiscal: 'Art. 36-3 E.T. — exento',
      procedimiento: ['Acta'],
    },
    auditOpinion: null,
    requiredActions: null,
    ...over,
  };
}

describe('Dictamen 3 — signo y cifras deterministas (auditoria-calidad-02 / prompts-normativa-07)', () => {
  it('pérdida neta se rotula y conserva el signo', () => {
    const md = renderLegalAuditorMarkdown(legalJson(), [], COMPANY as never);
    const line = md.split('\n').find((l) => l.includes('Perdida neta del ejercicio'));
    expect(line).toContain('($250.000.000,00)');
  });

  it('SAS sin estatutos → reserva "NO DETERMINABLE"; sin cifras vinculantes el LLM no aporta montos', () => {
    const res = toLegacyLegalAuditorResult(legalJson(), COMPANY as CompanyInfo, '2025');
    expect(res.fullContent).toContain('NO DETERMINABLE');
    expect(res.fullContent).not.toContain('SI (Art. 452 C.Co.)');
    expect(res.fullContent).not.toContain('$9,99');
  });

  it('con preprocesador copia la aritmética del acta (misma que Governance)', () => {
    const res = toLegacyLegalAuditorResult(
      legalJson(),
      { ...(COMPANY as CompanyInfo), entityType: 'S.A.' },
      '2025',
      preprocessed(),
    );
    // Utilidad $10.000.000 → reserva legal 10% = $1.000.000; techo 50% de $1.000.000 = $500.000 → $500.000.
    expect(res.fullContent).toContain('Utilidad neta del ejercicio    : $10.000.000,00');
    expect(res.fullContent).toContain('SI (Art. 452 C.Co.)');
    expect(res.fullContent).toContain('Monto reserva 10%              : $500.000,00');
    expect(res.fullContent).toContain('Utilidad disponible            : $9.500.000,00');
  });

  it('capitalización: sin Art. 5 Ley 1258 ni Art. 36-3 E.T. como beneficio', () => {
    const res = toLegacyLegalAuditorResult(legalJson(), COMPANY as CompanyInfo, '2025');
    expect(res.fullContent).toContain('Art. 29 Ley 1258/2008');
    expect(res.fullContent).toContain('Art. 30 E.T.');
    expect(res.fullContent).not.toContain('Ley 1258/2008 Art. 5');
    expect(res.fullContent).not.toContain('Art. 36-3 E.T. — exento');
  });
});

describe('Dictamen 3 — prompt normativo (prompts-normativa-07/08/13)', () => {
  it('SAS: sin reserva obligatoria por remisión, con régimen tri-estado y convocatoria Art. 20 Ley 1258', () => {
    const p = buildLegalAuditorPrompt(COMPANY as never, 'es');
    expect(p).not.toContain('Reserva legal 10% por remision del Art. 45 Ley 1258/2008');
    expect(p).toContain('NO DETERMINABLE');
    expect(p).toContain('Art. 20 de la Ley 1258 de 2008');
    expect(p).not.toContain('beneficioFiscal cita "Art. 36-3 E.T."');
    expect(p).not.toContain('baseLegal="Ley 1258/2008 Art. 5"');
  });

  it('"S.A." con puntos se audita como S.A. (Art. 203, Art. 424), no como SAS supletoria', () => {
    const p = buildLegalAuditorPrompt({ ...COMPANY, entityType: 'S.A.' } as never, 'es');
    expect(p).not.toContain('SAS, supletorio');
    expect(p).toContain('Revisor fiscal SIEMPRE obligatorio (Art. 203 C.Co.)');
    expect(p).toContain('Art. 424 C.Co.');
  });

  it('Art. 155/454 bien enunciados y sin el plazo inventado del Art. 446', () => {
    const p = buildLegalAuditorPrompt({ ...COMPANY, entityType: 'SA' } as never, 'es');
    expect(p).not.toContain('Dividendos minimo 50% si reservas>=capital');
    expect(p).toContain('al menos el 50% de las utilidades liquidas');
    expect(p).toContain('70% cuando las reservas legal, estatutaria y ocasionales exceden el 100% del capital suscrito (Art. 454 C.Co.)');
    expect(p).not.toContain('30 dias desde el cierre');
  });
});

describe('Dictamen 4 — anticipo, sanción e indicadores (auditoria-calidad-20 / -23)', () => {
  const v21 = () =>
    fiscalJson({
      criticalSaldos: {
        retenciones2365Cop: null, retenciones1355Cop: null, ivaPorPagarNetoCop: '-300000000',
        anticipoRentaSiguienteCop: '835686296', sancionPotencialMoraCop: null,
      },
      dianRiskIndicators: [
        { indicator: 'Margen neto vs banda sectorial CIIU', level: 'alto', observation: '2σ' },
        { indicator: 'Cumplimiento Beneficiario Final UIAF', level: 'alto', observation: null },
      ],
      riesgoFiscalizacionGlobal: 'medio',
      obligations2026: { anticipoRenta2026Cop: '835686296', baseAnticipo: '75% del impuesto causado 2025', icaEstimado2026Cop: null, baseIca: null },
      fiscalAuditOpinion: { type: 'riesgo_alto', text: 'Texto.' },
    });

  it('el anticipo del Art. 807 sale N/D con su fórmula completa; nunca 75% del impuesto', () => {
    const res = toLegacyFiscalReviewerResult(v21(), COMPANY as CompanyInfo, '2025');
    expect(res.fullContent).toContain('Anticipo de renta (Art. 807 E.T.):** N/D');
    expect(res.fullContent).toContain('retenciones en la fuente del año');
    expect(res.fullContent).not.toContain('75% del impuesto causado 2025');
    expect(res.fullContent).not.toContain('$8.356.862,96');
  });

  it('la sanción del Art. 641 se rotula por extemporaneidad y la mora como intereses (Arts. 634-635)', () => {
    const md = renderFiscalReviewerMarkdown(v21(), [], 'favorable', COMPANY as never);
    expect(md).toContain('Sancion por extemporaneidad (Art. 641 E.T.)');
    expect(md).toContain('Intereses moratorios (Arts. 634-635 E.T.)');
    expect(md).not.toContain('Sancion potencial por mora');
    expect(md).toContain('($3.000.000,00) (saldo a favor)');
  });

  it('los 6 indicadores son los del spec, calculados en código; sin preprocesador son N/D', () => {
    const res = toLegacyFiscalReviewerResult(v21(), COMPANY as CompanyInfo, '2025');
    for (const name of DIAN_SPEC_INDICATORS) expect(res.fullContent).toContain(name);
    expect(res.fullContent).not.toContain('UIAF');
    expect(res.fullContent).not.toContain('banda sectorial CIIU** ');
    expect(res.fullContent).toContain('RIESGO DE FISCALIZACION DIAN NO DETERMINABLE');
  });

  it('con preprocesador: costo < 1% (alto), proveedores > 90% (alto), efectivo > 50% (alto) → global ALTO y opinión RIESGO ALTO', () => {
    const indicators = computeDianRiskIndicators(preprocessed());
    expect(indicators.map((i) => i.level)).toEqual([
      'no_determinable', // margen vs sector: sin benchmark
      'alto', // costo 100.000 / 50.000.000 = 0,2%
      'no_determinable', // brecha: el spec no fija umbral
      'no_determinable', // sin comparativo
      'alto', // proveedores 950.000 / 1.000.000 = 95%
      'alto', // efectivo 6.000.000 / 10.000.000 = 60%
    ]);
    const res = toLegacyFiscalReviewerResult(v21(), COMPANY as CompanyInfo, '2025', { preprocessed: preprocessed() });
    expect(res.fullContent).toContain('Nivel agregado: [❌ ALTO]');
    expect(res.fullContent).toContain('RIESGO ALTO DE FISCALIZACION DIAN');
  });

  it('agregación única: el nivel global y la opinión nunca se contradicen', () => {
    const tresAltos = [{ level: 'alto' }, { level: 'alto' }, { level: 'alto' }, { level: 'bajo' }, { level: 'bajo' }, { level: 'bajo' }] as const;
    expect(aggregateDianRisk([...tresAltos], false)).toEqual({ global: 'alto', opinionType: 'riesgo_alto' });
    const unAlto = [{ level: 'alto' }, { level: 'bajo' }] as const;
    expect(aggregateDianRisk([...unAlto], false)).toEqual({ global: 'medio', opinionType: 'riesgo_medio' });
    expect(aggregateDianRisk([{ level: 'bajo' }], true)).toEqual({ global: 'alto', opinionType: 'riesgo_alto' });
  });
});

describe('Dictamen 4 — prompt NIA 570 / citas (prompts-normativa-20 / auditoria-calidad-17)', () => {
  const p = buildFiscalReviewerPrompt(COMPANY as never, 'es');
  it('los indicadores de empresa en marcha no son incertidumbre material automática', () => {
    expect(p).not.toContain('Then goingConcern.hasMaterialUncertainty=true y emite parrafo de enfasis');
    expect(p).toContain('NIA 570 par. 16');
    expect(p).toContain('Incertidumbre material relacionada con empresa en funcionamiento');
  });

  it('cita los Arts. 207-209 del C.Co. (no de la Ley 43) y la derogatoria del Art. 457 num. 2', () => {
    expect(p).not.toContain('Ley 43/1990 Art. 207-209');
    expect(p).toContain('Arts. 207-209 C.Co.');
    expect(p).toContain('Ley 2069/2020');
  });

  it('el prompt ya no define el anticipo como 75% del impuesto causado ni pide los indicadores UIAF/banda sectorial', () => {
    expect(p).not.toContain('75% del impuesto causado para el ano siguiente');
    expect(p).not.toContain('Cumplimiento Beneficiario Final UIAF');
    expect(p).not.toContain('sancionPotencialMoraCop=calculo Art. 641 E.T. (5% por mes)');
  });

  it('hallazgo con signo en materialidad no se imprime en valor absoluto', () => {
    const md = renderFiscalReviewerMarkdown(
      fiscalJson({ materiality: { benchmarkLabel: 'x', materialityAmountCop: '-100000', performanceMateriality: '75000', comment: 'c' } }),
      [] as AuditFinding[],
      'favorable',
      COMPANY as never,
    );
    expect(md).toContain('**Materialidad:** ($1.000,00)');
  });
});
