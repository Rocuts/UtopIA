// ---------------------------------------------------------------------------
// Art. 635 E.T. — tasa de mora = usura certificada DEL MES − 2 pp, o N/D
// ---------------------------------------------------------------------------
// Fase 2 de la auditoría 2026-09-24 (tributario-calc-18): sin `annualRate` la
// calculadora usaba el fallback de AGOSTO de 2026 (27,66% E.A.) en cualquier
// mes; en septiembre publicaba una cifra con la tasa de otro periodo. Ahora la
// tasa por defecto sale de una tabla mensual con fecha y fuente (usura
// certificada − 2 pp) para el mes de liquidación en hora de Colombia; si el mes
// no está registrado, los intereses son N/D con motivo (sin cifra).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  calculateSanction,
  mesColombia,
  SanctionInputError,
  tasaMoratoriaDelMes,
} from '../sanction-calculator';

describe('tasaMoratoriaDelMes', () => {
  it('agosto de 2026: usura 29,66% − 2 pp = 27,66% con su fuente', () => {
    const t = tasaMoratoriaDelMes('2026-08');
    expect(t?.tasaEA).toBe(27.66);
    expect(t?.fuente).toMatch(/1139/);
  });

  it('mes sin tasa certificada registrada ⇒ null (no se reutiliza otro mes)', () => {
    expect(tasaMoratoriaDelMes('2026-09')).toBeNull();
  });
});

describe('mesColombia', () => {
  it('usa America/Bogota, no la zona del servidor', () => {
    // 2026-09-01 03:00 UTC = 2026-08-31 22:00 en Bogotá.
    expect(mesColombia(new Date('2026-09-01T03:00:00Z'))).toBe('2026-08');
    expect(mesColombia(new Date('2026-09-01T06:00:00Z'))).toBe('2026-09');
  });
});

describe('intereses moratorios sin annualRate', () => {
  it('en septiembre de 2026 (sin tasa registrada) no publica cifra: N/D con motivo', () => {
    const run = () =>
      calculateSanction(
        { type: 'intereses_moratorios', principal: 100_000_000, days: 30 },
        { hoy: new Date('2026-09-23T15:00:00Z') },
      );
    expect(run).toThrow(SanctionInputError);
    expect(run).toThrow(/2026-09/);
    expect(run).toThrow(/usura/i);
  });

  it('en agosto de 2026 usa la tasa de agosto y rotula mes y fuente', () => {
    const r = calculateSanction(
      { type: 'intereses_moratorios', principal: 100_000_000, days: 30 },
      { hoy: new Date('2026-08-20T15:00:00Z') },
    );
    expect(r.details.annualRate).toBe(27.66);
    expect(r.details.tasaMes).toBe('2026-08');
    expect(String(r.details.tasaFuente)).toMatch(/1139/);
  });

  it('con annualRate explícita no depende del mes', () => {
    const r = calculateSanction(
      { type: 'intereses_moratorios', principal: 100_000_000, days: 30, annualRate: 27.24 },
      { hoy: new Date('2026-09-23T15:00:00Z') },
    );
    expect(r.details.annualRate).toBe(27.24);
    expect(r.details.tasaPorDefectoUsada).toBe(false);
  });
});
