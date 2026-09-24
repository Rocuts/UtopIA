/**
 * Gate de descarga del informe (pipeline-flujo-14 / pipeline-flujo-16).
 */
import { describe, it, expect } from 'vitest';
import {
  resolveReportExportBlock,
  reportExportBlockCopy,
  reportExportDegradedNotice,
  type ReportExportBlock,
} from '../report-export-gate';

const FULL = {
  niifAnalysis: { fullContent: 'NIIF', reconciliation: { clean: true } },
  strategicAnalysis: { fullContent: 'Estrategia' },
  governance: { fullContent: 'Acta' },
};

describe('resolveReportExportBlock', () => {
  it('informe completo y limpio: descargable', () => {
    expect(resolveReportExportBlock(FULL)).toBeNull();
    expect(resolveReportExportBlock(null)).toBeNull();
  });

  it('pipeline-flujo-14: Estrategia/Gobierno vacíos (checkpoint rehidratado) bloquean la descarga', () => {
    const partial = {
      ...FULL,
      strategicAnalysis: { fullContent: '' },
      governance: { fullContent: '   ' },
    };
    expect(resolveReportExportBlock(partial)).toEqual({
      reason: 'incomplete',
      missing: ['strategy', 'governance'],
    });
    expect(resolveReportExportBlock({ ...FULL, governance: { fullContent: '' } })).toEqual({
      reason: 'incomplete',
      missing: ['governance'],
    });
  });

  it('salvedades de reconciliación', () => {
    expect(
      resolveReportExportBlock({ ...FULL, niifAnalysis: { reconciliation: { clean: false } } }),
    ).toEqual({ reason: 'qualifications' });
  });

  it('pipeline-flujo-16: emitibilidad y validación post-render del servidor bloquean', () => {
    expect(
      resolveReportExportBlock({
        ...FULL,
        emittability: { kind: 'no-emitible', blockers: [{ message: 'V8: IFRS 18 en Grupo 2' }] },
      }),
    ).toEqual({ reason: 'not-emittable', details: ['V8: IFRS 18 en Grupo 2'] });
    expect(
      resolveReportExportBlock({
        ...FULL,
        validation: { ok: false, errors: ['Placeholders sin reemplazar'] },
      }),
    ).toEqual({ reason: 'validation-failed', details: ['Placeholders sin reemplazar'] });
    expect(
      resolveReportExportBlock({ ...FULL, validation: { ok: true, errors: [] }, emittability: { kind: 'emittable', blockers: [] } }),
    ).toBeNull();
  });
});

describe('reportExportBlockCopy', () => {
  it('el informe incompleto nombra las partes faltantes (es/en)', () => {
    const block: ReportExportBlock = { reason: 'incomplete', missing: ['governance'] };
    expect(reportExportBlockCopy(block, 'es', 'download').ariaLabel).toMatch(/INCOMPLETO/);
    expect(reportExportBlockCopy(block, 'es', 'download').title).toMatch(/Gobierno Corporativo/);
    expect(reportExportBlockCopy(block, 'en', 'generate').ariaLabel).toMatch(/^Generation blocked/);
  });

  it('muestra los primeros motivos del servidor', () => {
    const copy = reportExportBlockCopy(
      { reason: 'not-emittable', details: ['V8', 'V10', 'V15', 'V1'] },
      'es',
      'download',
    );
    expect(copy.title).toContain('V8 · V10 · V15');
    expect(copy.title).not.toContain('V1 ');
  });
});

// pipeline-flujo-05 / pipeline-flujo-15 (W3-A): las salvedades de la Parte II
// (`strategyQualifications`) y del acta (`actaQualifications`) tienen motivo
// propio — no "la reconciliación no cerró" — y bloquean aunque el informe se
// haya persistido antes de que la UI las plegara sobre la reconciliación.
describe('resolveReportExportBlock — salvedades de Estrategia y del acta', () => {
  const strategyQualified = {
    ...FULL,
    strategicAnalysis: {
      fullContent: 'Estrategia',
      strategyQualifications: { clean: false, motivos: ['ROE publicado 18 % ≠ ancla 12 %'], noVerificables: [] },
    },
  };

  it('strategyQualifications.clean === false bloquea con motivo propio (lectura directa)', () => {
    expect(resolveReportExportBlock(strategyQualified)).toEqual({
      reason: 'part-qualifications',
      parts: ['strategy'],
      details: ['ROE publicado 18 % ≠ ancla 12 %'],
    });
  });

  it('también cuando la UI ya plegó la salvedad sobre la reconciliación', () => {
    const folded = { ...strategyQualified, niifAnalysis: { reconciliation: { clean: false } } };
    expect(resolveReportExportBlock(folded)).toMatchObject({ reason: 'part-qualifications', parts: ['strategy'] });
  });

  it('actaQualifications.clean === false bloquea nombrando el acta', () => {
    const acta = {
      ...FULL,
      governance: { fullContent: 'Acta', actaQualifications: { clean: false, motivos: ['Reserva legal ≠ 10 %'] } },
    };
    expect(resolveReportExportBlock(acta)).toEqual({
      reason: 'part-qualifications',
      parts: ['acta'],
      details: ['Reserva legal ≠ 10 %'],
    });
  });

  it('la copia no dice que la reconciliación no cerró', () => {
    const block = resolveReportExportBlock(strategyQualified)!;
    const es = reportExportBlockCopy(block, 'es', 'download');
    expect(es.title).toMatch(/Estrategia \(Parte II\)/);
    expect(es.title).toContain('ROE publicado 18 % ≠ ancla 12 %');
    expect(es.title).not.toMatch(/reconciliación/);
    expect(reportExportBlockCopy(block, 'en', 'generate').ariaLabel).toMatch(/^Generation blocked/);
  });

  it('strategyQualifications limpias no bloquean', () => {
    expect(
      resolveReportExportBlock({
        ...FULL,
        strategicAnalysis: { fullContent: 'Estrategia', strategyQualifications: { clean: true, motivos: [] } },
      }),
    ).toBeNull();
  });
});

describe('reportExportDegradedNotice — aviso de pases degradados', () => {
  it('sin pases degradados no hay aviso', () => {
    expect(reportExportDegradedNotice(FULL, 'es')).toBeNull();
  });

  it('nombra las partes completadas con esfuerzo degradado (es/en)', () => {
    const r = {
      ...FULL,
      strategicAnalysis: { fullContent: 'Estrategia', degraded: true },
      governance: { fullContent: 'Acta', degraded: true },
    };
    const es = reportExportDegradedNotice(r, 'es')!;
    expect(es).toMatch(/Estrategia \(Parte II\)/);
    expect(es).toMatch(/Gobierno Corporativo \(Parte III\)/);
    expect(reportExportDegradedNotice(r, 'en')).toMatch(/Strategy \(Part II\)/);
    // Un aviso no bloquea la descarga.
    expect(resolveReportExportBlock(r)).toBeNull();
  });
});
