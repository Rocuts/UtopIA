/**
 * Regresión normativa — Nómina y prestaciones del módulo Pyme (Colombia, 2026).
 *
 * Cada bloque fija un valor contra su norma. Verificación: 7-ago-2026.
 * Fuentes consultadas:
 *  - Ley 2466/2025 art. 14 (mod. Art. 179 CST) — gradualidad del recargo dominical:
 *    https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=260676
 *    https://actualicese.com/liquidador-reforma-laboral-2025-valor-del-trabajo-en-dias-de-descanso-dominicales-y-festivos/
 *  - Ley 2101/2021 — jornada 42 h y divisor 210 desde el 15-jul-2026:
 *    https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=166506
 *    https://actualicese.com/horas-extra-y-recargos-2026-en-colombia/
 *  - Resolución DIAN 000238 del 15-12-2025 — UVT 2026 = $52.374 (Art. 868 E.T.):
 *    https://incp.org.co/publicaciones/infoincp-publicaciones/impuestos/2025/12/dian-fijo-en-52-374-en-valor-de-la-uvt-para-el-ano-gravable-2026/
 *  - Decreto 1772/1994 arts. 12-13 — tarifas ARL (clase I inicial 0,522 %):
 *    https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=8803
 *  - Art. 114-1 E.T. — exoneración conjunta salud empleador + SENA + ICBF:
 *    https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_7163_2019.htm
 *  - Ley 52/1975 art. 1 — intereses del 12 % anual sobre el saldo de cesantías.
 *  - Art. 306 CST mod. Ley 1788/2016 — prima = 30 días de salario por año.
 *  - Art. 64 CST mod. Ley 789/2002 art. 28 — tramos de indemnización.
 */
import { describe, it, expect } from 'vitest';
import {
  NORMATIVA_2026 as N,
  ARL_TARIFAS,
  RECARGO_DOMINICAL_GRADUALIDAD,
  JORNADA_GRADUALIDAD,
  EXONERACION_114_1,
} from '../normativa2026';
import {
  DIEZ_SMMLV,
  divisorHorasMes,
  dominicalDiurnoDia,
  horaOrdinaria,
  horasSemanaVigentes,
  liquidacion,
  pilaEmpleado,
  pilaEmpleador,
  provisionesMensuales,
  recargoDominicalVigente,
  recargosHora,
  recargosVigentes,
} from '../calc';

/** Los valores publicados redondean la hora antes de multiplicar: ±2 pesos. */
function pesosCercanos(actual: number, esperado: number, tol = 2) {
  expect(Math.abs(actual - esperado)).toBeLessThanOrEqual(tol);
}

const HOY = '2026-08-07';

describe('UVT 2026 — Resolución DIAN 000238 del 15-12-2025', () => {
  it('usa $52.374, no la UVT 2025 de $49.799', () => {
    expect(N.UVT).toBe(52_374);
  });
});

describe('Recargo dominical y festivo — Ley 2466/2025 art. 14 (mod. Art. 179 CST)', () => {
  it('reproduce las cuatro franjas de la gradualidad, no un solo número', () => {
    expect(RECARGO_DOMINICAL_GRADUALIDAD.map((f) => f.recargo)).toEqual([0.75, 0.8, 0.9, 1.0]);
  });

  it('hoy (7-ago-2026) el recargo es del 90 %', () => {
    expect(recargoDominicalVigente(HOY)).toBe(0.9);
    expect(recargoDominicalVigente(new Date(2026, 7, 7))).toBe(0.9);
  });

  it('respeta la transición: 75 % hasta 30-jun-2025, 80 % hasta 30-jun-2026, 100 % desde 1-jul-2027', () => {
    expect(recargoDominicalVigente('2025-06-30')).toBe(0.75);
    expect(recargoDominicalVigente('2025-07-01')).toBe(0.8);
    expect(recargoDominicalVigente('2026-06-30')).toBe(0.8);
    expect(recargoDominicalVigente('2026-07-01')).toBe(0.9);
    expect(recargoDominicalVigente('2027-07-01')).toBe(1.0);
  });

  it('el día dominical trabajado se recarga al 90 % del salario diario', () => {
    const esperado = (N.SMMLV / 30) * 0.9;
    expect(dominicalDiurnoDia(N.SMMLV, HOY)).toBeCloseTo(esperado, 6);
    // Con la franja anterior el mismo día vale 80 %: la función no colapsa la norma.
    expect(dominicalDiurnoDia(N.SMMLV, '2026-06-15')).toBeCloseTo((N.SMMLV / 30) * 0.8, 6);
  });
});

describe('Jornada y valor de la hora — Ley 2101/2021', () => {
  it('desde el 15-jul-2026 la jornada es de 42 h y el divisor mensual 210', () => {
    expect(horasSemanaVigentes(HOY)).toBe(42);
    expect(divisorHorasMes(HOY)).toBe(210);
    expect(N.HORAS_MES).toBe(210);
    expect(N.JORNADA_SEMANAL).toBe(42);
  });

  it('hasta el 14-jul-2026 el divisor era 220 (44 h)', () => {
    expect(divisorHorasMes('2026-07-14')).toBe(220);
    pesosCercanos(horaOrdinaria(N.SMMLV, '2026-07-14'), 7_959);
  });

  it('la hora ordinaria al mínimo es $8.338 (SMMLV ÷ 210)', () => {
    pesosCercanos(horaOrdinaria(N.SMMLV, HOY), 8_338);
    expect(N.HORA_ORDINARIA).toBe(8_338);
  });

  it('el divisor es (horas/semana ÷ 6) × 30 en toda la tabla', () => {
    for (const f of JORNADA_GRADUALIDAD) {
      expect(f.divisorMes).toBe((f.horasSemana / 6) * 30);
    }
  });
});

describe('Tabla de recargos 2026 (Arts. 168 y 179 CST + Ley 2466/2025)', () => {
  it('los combinados suman el dominical vigente al recargo del Art. 168', () => {
    const r = recargosVigentes(HOY);
    expect(r.dominicalDiurno).toBe(0.9);
    expect(r.recargoNocturno).toBe(0.35);
    expect(r.dominicalNocturno).toBeCloseTo(1.25, 10); // 90 % + 35 %
    expect(r.heDominicalDiurna).toBeCloseTo(1.15, 10); // 90 % + 25 %
    expect(r.heDominicalNocturna).toBeCloseTo(1.65, 10); // 90 % + 75 %
  });

  it('las tarifas por hora al mínimo coinciden con la tabla publicada 2026', () => {
    const h = recargosHora(HOY);
    pesosCercanos(h.extraDiurna, 10_423);
    pesosCercanos(h.extraNocturna, 14_592);
    pesosCercanos(h.nocturna, 11_256);
    pesosCercanos(h.dominicalDiurna, 15_842);
    pesosCercanos(h.dominicalNocturna, 18_761);
    pesosCercanos(h.extraDominicalDiurna, 17_927);
    // El campo declara hora EXTRA nocturna en dominical: 90 % + 75 % = 165 %.
    pesosCercanos(h.extraDominicalNocturna, 22_096);
  });
});

describe('ARL — Decreto 1772/1994 art. 13 (compilado en el Decreto 1072/2015)', () => {
  it('la clase I aplica el valor INICIAL 0,522 %, no el mínimo 0,348 %', () => {
    expect(N.PILA.arlClaseI.empleador).toBe(0.00522);
  });

  it('conserva la tabla completa mínimo / inicial / máximo por clase', () => {
    expect(ARL_TARIFAS.I).toEqual({ minimo: 0.00348, inicial: 0.00522, maximo: 0.00696 });
    expect(ARL_TARIFAS.V).toEqual({ minimo: 0.03219, inicial: 0.0696, maximo: 0.087 });
  });
});

describe('Exoneración de aportes — Art. 114-1 E.T.', () => {
  it('exonera CONJUNTAMENTE salud del empleador, SENA e ICBF', () => {
    expect(EXONERACION_114_1.exonera).toEqual(['salud_empleador', 'sena', 'icbf']);
    const p = pilaEmpleador(N.SMMLV);
    expect(p.salud).toBe(0);
    expect(p.sena).toBe(0);
    expect(p.icbf).toBe(0);
    expect(p.exentoParafiscal).toBe(true);
  });

  it('no exonera pensión, ARL ni caja de compensación', () => {
    const p = pilaEmpleador(N.SMMLV);
    expect(p.pension).toBeCloseTo(N.SMMLV * 0.12, 6);
    expect(p.arl).toBeCloseTo(N.SMMLV * 0.00522, 6);
    expect(p.ccf).toBeCloseTo(N.SMMLV * 0.04, 6);
    pesosCercanos(Math.round(p.total), 289_285, 1);
    expect(N.PILA_AL_SMMLV.empleadorTotal).toBe(289_285);
  });

  it('el empleador NO beneficiario paga salud 8,5 % + SENA 2 % + ICBF 3 %', () => {
    const p = pilaEmpleador(N.SMMLV, 30, { exoneradoArt114_1: false });
    expect(p.salud).toBeCloseTo(N.SMMLV * 0.085, 6);
    pesosCercanos(Math.round(p.total), 525_657, 1);
    expect(N.PILA_AL_SMMLV.empleadorTotalSinExoneracion).toBe(525_657);
  });

  it('el umbral son 10 SMMLV y la comparación es estricta', () => {
    expect(DIEZ_SMMLV).toBe(N.SMMLV * 10);
    expect(pilaEmpleador(DIEZ_SMMLV).exentoParafiscal).toBe(false);
    expect(pilaEmpleador(DIEZ_SMMLV).salud).toBeCloseTo(DIEZ_SMMLV * 0.085, 6);
    expect(pilaEmpleador(DIEZ_SMMLV - 1).exentoParafiscal).toBe(true);
  });

  it('el aporte del empleado no cambia: 8 % del IBC', () => {
    expect(Math.round(pilaEmpleado(N.SMMLV).total)).toBe(140_072);
  });
});

describe('Intereses a las cesantías — Ley 52/1975 art. 1 (12 % ANUAL sobre el saldo)', () => {
  it('la provisión mensual es el 12 % de la cesantía del mes, no el 1 %', () => {
    const prov = provisionesMensuales(N.SMMLV, N.AUX_TRANSPORTE);
    expect(prov.cesantias).toBe(166_667);
    expect(prov.intereses).toBe(20_000); // 166.667 × 12 %
    expect(prov.intereses * 12).toBe(240_000); // 12 % de un mes de salario+auxilio
  });

  it('las constantes espejo del año siguen la misma fórmula', () => {
    const prov = provisionesMensuales(N.SMMLV, N.AUX_TRANSPORTE);
    expect(N.PRESTACIONES.interesesCesMensual).toBe(20_000);
    expect(N.PRESTACIONES.totalMensual).toBe(426_288);
    expect(prov.total).toBe(N.PRESTACIONES.totalMensual);
  });

  it('el costo real del empleado al mínimo cuadra con PILA + provisiones', () => {
    const prov = provisionesMensuales(N.SMMLV, N.AUX_TRANSPORTE);
    const esperado = N.TOTAL_MINIMO + Math.round(pilaEmpleador(N.SMMLV).total) + prov.total;
    expect(N.COSTO_REAL_EMPLEADO_MES).toBe(esperado);
  });
});

describe('Liquidación definitiva', () => {
  const baseInput = {
    salario: N.SMMLV,
    auxTransporte: N.AUX_TRANSPORTE,
    diasTotales: 360,
    causa: 'renuncia' as const,
  };

  it('prima proporcional = 30 días de salario por año, sin factor 0,5 (Art. 306 CST · Ley 1788/2016)', () => {
    const r = liquidacion(baseInput);
    const base = N.SMMLV + N.AUX_TRANSPORTE;
    expect(r.primaProporcional).toBeCloseTo(base, 6); // 360 días ⇒ un mes completo
    // Misma base anual de 30 días que las cesantías.
    expect(r.primaProporcional).toBeCloseTo(r.cesantias, 6);
  });

  it('un semestre de prima son 15 días de salario', () => {
    const r = liquidacion({ ...baseInput, diasTotales: 180 });
    expect(r.primaProporcional).toBeCloseTo((N.SMMLV + N.AUX_TRANSPORTE) / 2, 6);
  });

  it('los intereses de cesantías del año completo son el 12 % del saldo, base 360', () => {
    const r = liquidacion(baseInput);
    expect(r.interesesCesantias).toBeCloseTo(r.cesantias * 0.12, 6);
  });

  it('los intereses nunca superan el 12 % anual aunque la antigüedad pase de un año', () => {
    const r = liquidacion({ ...baseInput, diasTotales: 720 });
    expect(r.interesesCesantias).toBeCloseTo(r.cesantias * 0.12, 6);
  });

  it('Art. 64 CST: 30 + 20 días para salario < 10 SMMLV', () => {
    const unAnio = liquidacion({ ...baseInput, causa: 'despido_sin_justa_causa' });
    expect(unAnio.indemnizacion).toBeCloseTo((N.SMMLV / 30) * 30, 6);
    const dosAnios = liquidacion({
      ...baseInput,
      diasTotales: 720,
      causa: 'despido_sin_justa_causa',
    });
    expect(dosAnios.indemnizacion).toBeCloseTo((N.SMMLV / 30) * 50, 6);
  });

  it('Art. 64 CST: 20 + 15 días para salario ≥ 10 SMMLV', () => {
    const salario = DIEZ_SMMLV;
    const unAnio = liquidacion({
      salario,
      auxTransporte: 0,
      diasTotales: 360,
      causa: 'despido_sin_justa_causa',
    });
    expect(unAnio.indemnizacion).toBeCloseTo((salario / 30) * 20, 6);
    const dosAnios = liquidacion({
      salario,
      auxTransporte: 0,
      diasTotales: 720,
      causa: 'despido_sin_justa_causa',
    });
    expect(dosAnios.indemnizacion).toBeCloseTo((salario / 30) * 35, 6);
  });

  it('sin despido sin justa causa no hay indemnización', () => {
    expect(liquidacion(baseInput).indemnizacion).toBe(0);
    expect(liquidacion({ ...baseInput, causa: 'justa_causa' }).tieneIndemnizacion).toBe(false);
  });
});
