// ---------------------------------------------------------------------------
// Agente Fiscal — plazos procedimentales, constantes y rótulos normativos
// ---------------------------------------------------------------------------
// Auditoría 2026-09:
//   - tributario-modulos-13: pliego de cargos 1 mes (no 3); requerimiento
//     especial como tipo propio (3 meses, Art. 707; reducción Art. 709 sólo
//     para inexactitud); requerimiento ordinario ≥ 15 días CALENDARIO;
//     devolución con garantía = Art. 860 (entidad bancaria o aseguradora).
//   - tributario-modulos-14: 100 UVT por PAGO individual, no por NIT.
//   - tributario-calc-04: constantes del Motor Normativo (Res. 000238/2025,
//     Art. 641 vs 642, par. 4 hidroeléctricas, bases 2/10 UVT, $524.000).
//   - tributario-calc-05: dígito de calendario sin DV.
//   - tributario-calc-17: N/D no es «0».
//   - tributario-modulos-15: F09 no se presenta como la TTD.
//   - tributario-calc-01: el Art. 36-3 no se exige ni se cita como vigente.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  buildDianLetterSkeleton,
  classifyDianRequirement,
  reduccionesDisponibles,
} from '../tools/dian-letter-builder';
import { buildFiscalAgentHeader } from '../prompts/fiscal-agent.prompt';
import { buildRiskScorePrompt } from '../prompts/risk-score.prompt';
import { buildSupervivenciaPrompt } from '../prompts/supervivencia.prompt';
import { buildDevolucionesPrompt } from '../prompts/devoluciones.prompt';
import { buildMotorNormativoPrompt, renderNITCalendarHint } from '../../normative/prompts/motor-normativo.prompt';
import { MOTOR_NORMATIVO_CATALOG } from '../../normative';

describe('Defensa DIAN — plazos y reducciones', () => {
  it('pliego de cargos: 1 mes, no los 3 meses del Art. 707', () => {
    const c = classifyDianRequirement('Se notifica PLIEGO DE CARGOS por no enviar información exógena');
    expect(c.kind).toBe('pliego_cargos');
    expect(c.plazoRespuesta).toMatch(/1 mes/);
    expect(c.plazoRespuesta).not.toMatch(/3 meses/);
    expect(c.normaPlazo).not.toBe('Art. 707 E.T.');
  });

  it('requerimiento especial: tipo propio, 3 meses (Art. 707) y reducción Art. 709 sólo por inexactitud', () => {
    const c = classifyDianRequirement('Requerimiento especial No. 123 — propuesta de modificación de la declaración');
    expect(c.kind).toBe('requerimiento_especial');
    expect(c.plazoRespuesta).toMatch(/3 meses/);
    expect(c.normaPlazo).toBe('Art. 707 E.T.');
    const r = reduccionesDisponibles('requerimiento_especial').join(' ');
    expect(r).toMatch(/Art\. 709/);
    expect(r).toMatch(/inexactitud/);
  });

  it('el pliego de cargos no ofrece la reducción del Art. 709 como propia ni la línea «50% Art. 644»', () => {
    const r = reduccionesDisponibles('pliego_cargos').join(' ');
    expect(r).not.toMatch(/Reducción al 25% por aceptación del pliego/);
    expect(r).not.toMatch(/50% del valor inicial por corrección/);
  });

  it('requerimiento ordinario: plazo del acto, mínimo 15 días calendario', () => {
    const c = classifyDianRequirement('requerimiento ordinario de información');
    expect(c.plazoRespuesta).toMatch(/15 días calendario/);
    expect(c.plazoRespuesta).not.toMatch(/hábiles/);
    expect(c.normaPlazo).not.toMatch(/752/);
    expect(buildDianLetterSkeleton(undefined, 'requerimiento_ordinario').classification.kind).toBe('requerimiento_ordinario');
  });
});

describe('Cabecera del Agente Fiscal', () => {
  const header = buildFiscalAgentHeader({ language: 'es', useCase: 'analisis_completo', nitContext: '901714014-6' });

  it('bancarización: 100 UVT por pago individual, no por NIT', () => {
    expect(header).not.toMatch(/100 UVT por NIT/);
    expect(header).toMatch(/100 UVT por PAGO individual/);
  });

  it('plazos: ordinario 15 días calendario; devolución con garantía Art. 860', () => {
    expect(header).not.toMatch(/15 días hábiles \(Art\. 752/);
    expect(header).toMatch(/15 días calendario/);
    expect(header).toMatch(/Art\. 860/);
    expect(header).not.toMatch(/garantía bancaria \(Art\. 855/);
  });

  it('N/D no es cero: la instrucción ya no ordena emitir "0" para datos desconocidos', () => {
    expect(header).not.toMatch(/emite el campo como cadena "0"/);
    expect(header).toMatch(/emite null/);
  });

  it('sobretasa hidroeléctricas en el parágrafo 4 con umbral de renta gravable', () => {
    expect(header).toMatch(/par\. 4/);
    expect(header).toMatch(/30\.000 UVT/);
  });
});

describe('Motor Normativo — constantes y dígito de calendario', () => {
  const p = buildMotorNormativoPrompt({ language: 'es', includeBlacklist: false, nitContext: '901714014-6' }, MOTOR_NORMATIVO_CATALOG);

  it('dígito de calendario sin DV (Decreto 2229/2023): 901714014-6 → 4', () => {
    expect(renderNITCalendarHint('901714014-6')).toMatch(/último dígito sin DV = 4/);
    expect(renderNITCalendarHint('9017140146')).toMatch(/no determinable/);
    expect(p).toMatch(/último dígito sin DV = 4/);
    expect(p).not.toMatch(/último dígito 6/);
  });

  it('constantes 2026 citadas con su fuente correcta', () => {
    expect(p).toMatch(/Resolución DIAN 000238/);
    expect(p).not.toMatch(/000187/);
    expect(p).toMatch(/Art\. 642/);
    expect(p).not.toMatch(/5%\/10% mensual/);
    expect(p).toMatch(/\$524\.000/);
    expect(p).not.toMatch(/servicios\/compras\): 4 UVT/);
    expect(p).toMatch(/servicios 2 UVT; compras y otros ingresos 10 UVT/);
    expect(p).toMatch(/Art\. 240 par\. 4/);
  });
});

describe('Prompts: F09, F04 y Art. 36-3', () => {
  it('el Score no presenta F09 como la TTD ni recomienda devolución desde F04', () => {
    const p = buildRiskScorePrompt('es', '900123456-1');
    expect(p).not.toMatch(/ALWAYS cita "Art\. 240 par\. 6 E\.T\." al hablar de F09/);
    expect(p).not.toMatch(/iniciar trámite de devolución/);
  });

  it('Supervivencia no exige citar el Art. 36-3 ni lo presenta como sustento', () => {
    const p = buildSupervivenciaPrompt('es', '900123456-1');
    expect(p).not.toMatch(/ALWAYS cita "Art\. 36-3 E\.T\."/);
    expect(p).toMatch(/derogado/);
  });

  it('Devoluciones: F04 no es base de devolución y la garantía es del Art. 860', () => {
    const p = buildDevolucionesPrompt('es', '900123456-1');
    expect(p).toMatch(/estimación contable/);
    expect(p).toMatch(/Art\. 860/);
  });

  it('el catálogo normativo marca el Art. 36-3 y el Oficio 0348/2020 como derogados', () => {
    const art = MOTOR_NORMATIVO_CATALOG.articulosET.find((a) => a.cita === 'Art. 36-3 E.T.');
    expect(art?.estado).toBe('DEROGADO');
    const oficio = MOTOR_NORMATIVO_CATALOG.conceptosDian.find((d) => d.id === 'OFICIO_DIAN_0348_005875_2020');
    expect(oficio?.estado).toBe('DEROGADO');
  });
});
