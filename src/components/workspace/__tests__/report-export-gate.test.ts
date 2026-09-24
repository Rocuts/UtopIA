/**
 * Gate de descarga del informe (pipeline-flujo-14 / pipeline-flujo-16).
 */
import { describe, it, expect } from 'vitest';
import {
  resolveReportExportBlock,
  reportExportBlockCopy,
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
