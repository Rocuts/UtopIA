// ---------------------------------------------------------------------------
// Meta-auditoría v2.1 — sello condicionado, N/D y umbral sin redondeo
// ---------------------------------------------------------------------------
// auditoria-calidad-08  75/100 se aprobaba (redondeo al entero antes del umbral)
// auditoria-calidad-09  dimensiones sin dato puntuadas 7/10
// auditoria-calidad-03  sello "CERTIFICADA" con Exactitud 0 / integridad rota
// auditoria-calidad-11  D14 = 100 por defecto sin comparativo; sin preprocesador
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildQualityV21View } from '../v21-mapping';
import type { QualityReportJson } from '../../contracts/quality-report';

const callMock = vi.fn();
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: (...args: unknown[]) => callMock(...args),
}));

function makeJson(opts: { score: number; overrideD?: Record<number, number>; omitDims?: number[] }): QualityReportJson {
  const dimensions = [];
  for (let n = 1; n <= 14; n++) {
    if (opts.omitDims?.includes(n)) continue;
    dimensions.push({
      name: `D${n} Dimension ${n}`,
      score: opts.overrideD?.[n] ?? opts.score,
      framework: 'ISO 25012',
      findings: [],
      recommendations: [],
    });
  }
  return {
    overallScore: opts.score,
    grade: 'A+',
    executiveSummary: 'Resumen.',
    dimensions,
    dataQuality: { completeness: opts.score, accuracy: opts.score, consistency: opts.score, timeliness: opts.score, validity: opts.score },
    aiGovernance: { traceability: opts.score, explainability: opts.score, antiHallucination: opts.score, humanOversight: opts.score },
    ifrs18Readiness: { ready: false, score: opts.score, gaps: [] },
    priorityRecommendations: [],
    conclusion: 'Conclusión.',
  };
}

describe('Umbral sobre el score sin redondear (auditoria-calidad-08)', () => {
  it('todas las dimensiones en 75 → 7,5 en revisión y sello con observaciones (no certificada)', () => {
    const v = buildQualityV21View(makeJson({ score: 75 }));
    expect(v.dimensions.every((d) => d.score10 === 7.5 && d.status === 'en_revision')).toBe(true);
    expect(v.globalScore10).toBe(7.5);
    expect(v.sello.type).toBe('con_observaciones');
  });

  it('55 → 5,5 requiere corrección (antes 6 → en revisión)', () => {
    const v = buildQualityV21View(makeJson({ score: 55 }));
    expect(v.dimensions[0].status).toBe('requiere_correccion');
  });

  it('el promedio global no se infla por redondeo (7,96 → 7,9)', () => {
    // 11 dims en 80 y una en 75 → promedio 7,958… → 7,9 → con observaciones
    const v = buildQualityV21View(makeJson({ score: 80, overrideD: { 11: 75 } }));
    expect(v.globalScore10).toBe(7.9);
    expect(v.sello.type).toBe('con_observaciones');
  });
});

describe('Dimensiones sin dato → N/D (auditoria-calidad-09)', () => {
  it('JSON sin ninguna D-dim: D4/D11 quedan N/D, nunca 7/10 por defecto', () => {
    const json = makeJson({ score: 90, omitDims: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] });
    const v = buildQualityV21View(json);
    const dim10 = v.dimensions.find((d) => d.num === 10)!;
    const dim11 = v.dimensions.find((d) => d.num === 11)!;
    expect(dim10.score10).toBeNull();
    expect(dim11.score10).toBeNull();
    expect(dim10.status).toBe('no_evaluable');
    expect(v.dimensions.some((d) => d.score10 === 7)).toBe(false);
  });

  it('las dimensiones N/D se excluyen del promedio', () => {
    // Sin D4 ni D11 (sin métrica raw): 10 dims evaluadas en 90 → 9,0 exacto
    const v = buildQualityV21View(makeJson({ score: 90, omitDims: [4, 11] }));
    expect(v.sello.evaluatedCount).toBe(10);
    expect(v.globalScore10).toBe(9);
  });

  it('sin cobertura mínima o sin dimensión crítica el sello es "no evaluable"', () => {
    const json = makeJson({ score: 95, omitDims: [2] });
    // Exactitud (D2) sin D-dim y sin métrica raw finita → N/D
    json.dataQuality.accuracy = Number.NaN;
    const v = buildQualityV21View(json);
    expect(v.dimensions.find((d) => d.num === 1)!.score10).toBeNull();
    expect(v.sello.type).toBe('no_evaluable');
    expect(v.sello.title).toBe('CALIDAD NO EVALUABLE 1+1');
  });
});

describe('Sello condicionado a la integridad y a la Exactitud (auditoria-calidad-03)', () => {
  it('D2 Exactitud = 0 y el resto en 100 ya no produce "CERTIFICADA"', () => {
    const v = buildQualityV21View(makeJson({ score: 100, overrideD: { 2: 0 } }));
    expect(v.sello.type).toBe('requiere_correccion');
    expect(v.selloBlockers.join(' ')).toMatch(/Exactitud 0,0\/10/);
  });

  it('integridad determinista con bloqueantes fuerza Exactitud = 0 y sello "requiere corrección"', () => {
    const v = buildQualityV21View(makeJson({ score: 100 }), {
      integrity: { status: 'con_bloqueantes', motivos: ['Ecuación patrimonial NO CUADRA en el periodo 2025 (preprocesador).'] },
    });
    expect(v.dimensions.find((d) => d.num === 1)!.score10).toBe(0);
    expect(v.sello.type).toBe('requiere_correccion');
  });

  it('el score y el grade del LLM se topan cuando el sello determinista lo bloquea', async () => {
    const { toLegacyQualityAssessment } = await import('../agent');
    const res = toLegacyQualityAssessment(makeJson({ score: 98 }), undefined, {
      integrity: { status: 'con_bloqueantes', motivos: ['V1'] },
    });
    expect(res.overallScore).toBe(59);
    expect(res.grade).toBe('F');
    expect(res.fullReport).toContain('CALIDAD REQUIERE CORRECCIÓN 1+1');
    expect(res.fullReport).not.toContain('CALIDAD CERTIFICADA 1+1');
  });
});

describe('Comparativo y preprocesador (auditoria-calidad-11)', () => {
  it('sin comparativo, Actualidad y Comparabilidad son N/D aunque el LLM ponga D14 = 100', () => {
    const v = buildQualityV21View(makeJson({ score: 100 }), { comparativeAvailable: false });
    const dim4 = v.dimensions.find((d) => d.num === 4)!;
    const dim12 = v.dimensions.find((d) => d.num === 12)!;
    expect(dim4.score10).toBeNull();
    expect(dim12.score10).toBeNull();
    expect(dim12.points.join(' ')).toMatch(/sin periodo comparativo/);
  });

  it('sin D14 la Comparabilidad no se estima desde la preparación IFRS 18 (D12)', () => {
    const v = buildQualityV21View(makeJson({ score: 100, omitDims: [14] }));
    expect(v.dimensions.find((d) => d.num === 12)!.score10).toBeNull();
  });

  it('el prompt ya no fija D14 = 100 por defecto', async () => {
    const { buildQualityAuditorPrompt } = await import('../prompt');
    const p = buildQualityAuditorPrompt({ name: 'X', nit: '1', fiscalPeriod: '2025' } as never, 'es');
    expect(p).not.toContain('D14=100');
    expect(p).toContain('D14 NO se emite');
  });

  it('sin preprocesador el contenido lo declara y el contexto deja el comparativo como desconocido', async () => {
    callMock.mockResolvedValue({ json: makeJson({ score: 90 }), meta: {} });
    const { runQualityAudit, deriveQualityContext } = await import('../agent');
    const report = { company: { name: 'X', nit: '1', fiscalPeriod: '2025' }, consolidatedReport: 'Informe' };
    expect(deriveQualityContext({ report: report as never }).comparativeAvailable).toBeNull();
    await runQualityAudit({ report: report as never, language: 'es' });
    const userContent = (callMock.mock.calls[0][0] as { userContent: string }).userContent;
    expect(userContent).toContain('PREPROCESADOR NO SUMINISTRADO');
    expect(userContent).toContain('INTEGRIDAD ARITMETICA DETERMINISTA');
  });

  it('el reporte con sello de salvedades del pipeline bloquea el sello de calidad', async () => {
    callMock.mockResolvedValue({ json: makeJson({ score: 95 }), meta: {} });
    const { runQualityAudit } = await import('../agent');
    const res = await runQualityAudit({
      report: {
        company: { name: 'X', nit: '1', fiscalPeriod: '2025' },
        consolidatedReport: '> ## REPORTE CON SALVEDADES — INTEGRIDAD ARITMÉTICA\n> - desviación',
      } as never,
      language: 'es',
    });
    expect(res.fullReport).toContain('CALIDAD REQUIERE CORRECCIÓN 1+1');
    expect(res.grade).toBe('F');
  });
});

beforeEach(() => {
  callMock.mockReset();
});
