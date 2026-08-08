// ---------------------------------------------------------------------------
// Regresión — Auditoría normativa 2026-08, Fiscal Anchor / calendario DIAN
// ---------------------------------------------------------------------------
// Defectos cubiertos:
//   1. `extractLastDigit` devolvía el DÍGITO DE VERIFICACIÓN ("901714014-6" → 6)
//      cuando el Decreto 2229 de 2023 ordena atender el último dígito del NIT
//      "sin tener en cuenta el dígito de verificación" (→ 4).
//   2. El calendario omitía el vencimiento de ENERO (retención del período
//      diciembre anterior; IVA del bimestre nov-dic anterior).
//   3. Renta PJ figuraba en abril y como UNA sola cuota, citando el Art. 240
//      E.T. (que fija la tarifa, no el plazo). Son DOS cuotas: mayo y julio.
//   4. El IVA bimestral generaba 5 de los 6 períodos del Art. 600 num. 1 E.T.
//   5. El ICA de Bogotá se situaba en feb/abr/jun/ago/oct/dic con el día del
//      IVA nacional, dos meses antes del vencimiento real.
//   6. Las fechas heurísticas de día fijo salían con estado `pendiente`, es
//      decir, presentadas al cliente como ciertas.
//
// Fuentes verificadas (2026-08-07):
//   - Decreto 2229 de 2023 (DUR 1625 de 2016, arts. 1.6.1.13.2.x), normograma DIAN:
//     https://normograma.dian.gov.co/dian/compilacion/docs/decreto_2229_2023.htm
//   - Calendario tributario 2026 (renta PJ mayo 12–26 / julio 9–23; retención
//     enero 2027 dígito 6 = 20-ene):
//     https://www.enlegislacion.com/calendario-tributario/13-calendario-tributario-2026
//   - Resolución SDH-000195 del 12-dic-2025 (ICA bimestral Bogotá 2026):
//     https://siemprealdia.co/colombia/impuestos/calendario-tributario-distrital-de-bogota/
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  buildCalendarioDian,
  extractCalendarDigit,
  extractLastDigit,
} from '../dian-calendar';
import type { FiscalDerivedMetrics } from '../internal-types';
import type { VencimientoDian } from '../types';

const ZERO = BigInt(0);

const METRICS: FiscalDerivedMetrics = {
  f01Cents: ZERO,
  f02Cents: ZERO,
  f03Cents: ZERO,
  f04Cents: ZERO,
  f05Cents: ZERO,
  f06Cents: ZERO,
  f07Cents: ZERO,
  f08Cents: ZERO,
  f09Pct: 0,
  f10Pct: 0,
};

function calendario(nit: string | null, hoyIso: string): VencimientoDian[] {
  return buildCalendarioDian({
    nit,
    hoy: new Date(`${hoyIso}T00:00:00Z`),
    periodo: '2025',
    metrics: METRICS,
  }).vencimientos;
}

function buscar(vs: VencimientoDian[], fragmento: string): VencimientoDian {
  const found = vs.filter((v) => v.obligacion.includes(fragmento));
  expect(found.length, `esperaba encontrar "${fragmento}" en ${vs.map((v) => v.obligacion).join(' | ')}`)
    .toBeGreaterThan(0);
  return found[0]!;
}

// ---------------------------------------------------------------------------
// 1. Dígito de verificación
// ---------------------------------------------------------------------------
describe('Decreto 2229 de 2023 — el dígito de calendario excluye el DV', () => {
  it('"901714014-6" indexa el calendario por el 4, no por el 6', () => {
    expect(extractCalendarDigit('901714014-6').digito).toBe(4);
    expect(extractLastDigit('901714014-6')).toBe(4);
  });

  it('tolera puntos de miles: "901.714.014-6" → 4', () => {
    expect(extractCalendarDigit('901.714.014-6').digito).toBe(4);
  });

  it('sin DV declarado devuelve el último dígito del cuerpo', () => {
    expect(extractCalendarDigit('901714014').digito).toBe(4);
    expect(extractCalendarDigit('901714014').ambiguo).toBe(false);
  });

  it('sin separador marca AMBIGUO: no se puede saber si el último es el DV', () => {
    const r = extractCalendarDigit('9017140146');
    expect(r.ambiguo).toBe(true);
  });

  it('NIT ausente → -1', () => {
    expect(extractCalendarDigit(null).digito).toBe(-1);
    expect(extractCalendarDigit('   ').digito).toBe(-1);
  });

  it('el NIT 901714014-6 recibe la renta PJ del dígito 4 (15-may-2026), no del 6 (20-may)', () => {
    const v = calendario('901714014-6', '2026-01-05');
    const cuota1 = buscar(v, 'Renta PJ — Declaración y 1ª cuota');
    expect(cuota1.proximoVencimiento).toBe('2026-05-15');
  });

  it('un NIT ambiguo no presenta el vencimiento como cierto', () => {
    const v = calendario('9017140146', '2026-01-05');
    for (const venc of v) {
      expect(venc.estado, `${venc.obligacion} salió como ${venc.estado}`).toBe('verificar');
      expect(venc.norma).toContain('NO VERIFICADO');
    }
  });

  it('sin NIT tampoco se presenta como cierto', () => {
    for (const venc of calendario(null, '2026-01-05')) {
      expect(venc.estado).toBe('verificar');
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Vencimiento de enero
// ---------------------------------------------------------------------------
describe('el vencimiento de ENERO existe (período diciembre anterior)', () => {
  it('el 5-ene-2026 el próximo vencimiento de retención es en enero, no en febrero', () => {
    // El repo arrancaba el calendario en febrero: durante todo enero ocultaba
    // el vencimiento del período diciembre. Art. 580-1 E.T. / Art. 402 C.P.
    const ret = buscar(calendario('901714014-6', '2026-01-05'), 'Retención en la fuente');
    expect(ret.proximoVencimiento.startsWith('2026-01')).toBe(true);
    // Dígito 4 → 10º día hábil de enero de 2026.
    expect(ret.proximoVencimiento).toBe('2026-01-16');
  });

  it('el IVA bimestral también vence en enero (bimestre nov-dic anterior)', () => {
    const iva = buscar(calendario('901714014-6', '2026-01-05'), 'IVA bimestral');
    expect(iva.proximoVencimiento.startsWith('2026-01')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Renta PJ — dos cuotas, mayo y julio
// ---------------------------------------------------------------------------
describe('Renta personas jurídicas — dos cuotas (art. 1.6.1.13.2.12 DUR 1625/2016)', () => {
  const v = calendario('901714014-6', '2026-01-05');

  it('publica DOS cuotas, no una', () => {
    const cuotas = v.filter((x) => x.obligacion.includes('Renta PJ'));
    expect(cuotas.length).toBe(2);
  });

  it('la declaración y 1ª cuota es en MAYO, no en abril', () => {
    const c1 = buscar(v, 'Renta PJ — Declaración y 1ª cuota');
    expect(c1.proximoVencimiento.startsWith('2026-05')).toBe(true);
  });

  it('la 2ª cuota es en julio', () => {
    const c2 = buscar(v, 'Renta PJ — 2ª cuota');
    expect(c2.proximoVencimiento).toBe('2026-07-14'); // dígito 4 → 10º hábil de julio
  });

  it('no cita el Art. 240 E.T. como fundamento del plazo (es la tarifa)', () => {
    for (const c of v.filter((x) => x.obligacion.includes('Renta PJ'))) {
      expect(c.norma).not.toContain('Art. 240');
      expect(c.norma).toContain('1.6.1.13.2.12');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. IVA bimestral completo + 5. ICA Bogotá
// ---------------------------------------------------------------------------
describe('IVA bimestral e ICA', () => {
  it('el bimestre nov-dic se alerta: en diciembre el próximo IVA es en enero siguiente', () => {
    const iva = buscar(calendario('901714014-6', '2026-12-01'), 'IVA bimestral');
    expect(iva.proximoVencimiento).toBe('2027-01-18'); // dígito 4 → 10º hábil de enero 2027
  });

  it('el IVA advierte que la periodicidad puede ser cuatrimestral (Art. 600 num. 2 E.T.)', () => {
    const iva = buscar(calendario('901714014-6', '2026-03-01'), 'IVA bimestral');
    expect(iva.norma).toContain('92.000 UVT');
    expect(iva.norma).toContain('CUATRIMESTRAL');
  });

  it('el ICA de Bogotá usa las fechas de la Resolución SDH-000195 de 2025', () => {
    const ica = buscar(calendario('901714014-6', '2026-01-05'), 'ICA bimestral');
    // El repo lo situaba en febrero con el día del IVA nacional. El B1 (ene-feb)
    // vence el 10-abr-2026 y no está escalonado por dígito de NIT.
    expect(ica.proximoVencimiento).toBe('2026-04-10');
    expect(ica.norma).toContain('SDH-000195');
  });

  it('el ICA no se presenta como cierto: el módulo no conoce el municipio', () => {
    const ica = buscar(calendario('901714014-6', '2026-01-05'), 'ICA bimestral');
    expect(ica.estado).toBe('verificar');
  });
});

// ---------------------------------------------------------------------------
// 6. Procedencia — nada de días fijos presentados como ciertos
// ---------------------------------------------------------------------------
describe('procedencia de las fechas del Fiscal Anchor', () => {
  it('toda fecha presentada como CIERTA cae en día hábil', () => {
    // Las tablas de día fijo del repo (DIA_RETENCION_POR_DIGITO = [8,9,10,…])
    // ignoraban los días hábiles y salían con estado `pendiente`: p. ej. el
    // dígito 8 recibía "día 21" de cada mes, cayera domingo o no.
    // Las proyecciones al año siguiente se excluyen: van marcadas `verificar`
    // justamente porque no se puede garantizar el día exacto.
    for (const mes of ['01', '03', '06', '09', '12']) {
      const ciertos = calendario('901714014-6', `2026-${mes}-01`).filter(
        (v) => v.estado !== 'verificar',
      );
      expect(ciertos.length).toBeGreaterThan(0);
      for (const venc of ciertos) {
        const dow = new Date(`${venc.proximoVencimiento}T12:00:00Z`).getUTCDay();
        expect(dow, `${venc.obligacion} → ${venc.proximoVencimiento} cae en fin de semana`).not.toBe(0);
        expect(dow, `${venc.obligacion} → ${venc.proximoVencimiento} cae en fin de semana`).not.toBe(6);
      }
    }
  });

  it('un año sin calendario verificado no produce fechas ciertas', () => {
    // 2028 no tiene set de festivos: el módulo no puede calcular días hábiles.
    for (const venc of calendario('901714014-6', '2028-03-01')) {
      expect(venc.estado).toBe('verificar');
      expect(venc.norma).toContain('NO VERIFICADO');
    }
  });
});
