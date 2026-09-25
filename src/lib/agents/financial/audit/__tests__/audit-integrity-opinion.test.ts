// ---------------------------------------------------------------------------
// Parte IV — opinión, integridad, cobertura y cifras deterministas
// ---------------------------------------------------------------------------
// auditoria-calidad-04  opinión inventada desde el score cuando falla el RF
// auditoria-calidad-21  score renormalizado sin marca de cobertura parcial
// auditoria-calidad-03  opinión no condicionada a la integridad aritmética
// auditoria-calidad-12  reglas de opinión no conformes a NIA 705
// auditoria-calidad-13  Dictamen 1 sin salvaguarda / stats del LLM
// auditoria-calidad-07  preprocessed / auditFocus no llegaban a los auditores
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NiifAuditReportJson } from '../../contracts/audit-report';
import type { AuditFinding } from '../types';
import { COMPANY, critical, fiscalJson, preprocessed, simpleJson } from './audit-fixtures';

const callMock = vi.fn();
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: (...args: unknown[]) => callMock(...args),
}));

beforeEach(() => {
  callMock.mockReset();
});

describe('Opinión sin Revisor Fiscal (auditoria-calidad-04)', () => {
  it('RF falla y los demás puntúan 95 → opinión NO EMITIDA, nunca favorable', async () => {
    callMock.mockImplementation(async (args: { agentName: string }) => {
      if (args.agentName === 'fiscal-reviewer') throw new Error('timeout');
      return { json: simpleJson(95), meta: {} };
    });
    const { orchestrateAudit } = await import('../orchestrator');
    const res = await orchestrateAudit({ report: { company: COMPANY, consolidatedReport: 'x' } as never, language: 'es' });
    expect(res.opinionType).toBe('no_emitida');
    expect(res.consolidatedReport).toContain('NO EMITIDA');
    expect(res.consolidatedReport).not.toContain('FAVORABLE (Sin Salvedades)');
  });

  it('RF falla con score 30 → no se deriva "abstension" del score', async () => {
    callMock.mockImplementation(async (args: { agentName: string }) => {
      if (args.agentName === 'fiscal-reviewer') throw new Error('timeout');
      return { json: simpleJson(30), meta: {} };
    });
    const { orchestrateAudit } = await import('../orchestrator');
    const res = await orchestrateAudit({ report: { company: COMPANY, consolidatedReport: 'x' } as never, language: 'es' });
    expect(res.opinionType).toBe('no_emitida');
  });
});

describe('Cobertura del score global (auditoria-calidad-21)', () => {
  it('3 de 4 auditores fallan → score marcado PARCIAL (1/4) y opinión no emitida', async () => {
    callMock.mockImplementation(async (args: { agentName: string }) => {
      if (args.agentName !== 'legal-auditor') throw new Error('fail');
      return { json: simpleJson(100), meta: {} };
    });
    const { orchestrateAudit } = await import('../orchestrator');
    const res = await orchestrateAudit({ report: { company: COMPANY, consolidatedReport: 'x' } as never, language: 'es' });
    expect(res.coverage).toEqual({ completed: 1, total: 4, failedDomains: ['niif', 'tributario', 'revisoria'], partial: true });
    expect(res.consolidatedReport).toContain('100/100 — PARCIAL (1/4 dominios)');
    expect(res.consolidatedReport).not.toMatch(/Score Global\*\* \| \*\*100\/100\*\*/);
    expect(res.opinionType).toBe('no_emitida');
  });

  it('con los 4 dominios completos el score no lleva marca parcial', async () => {
    callMock.mockImplementation(async (args: { agentName: string }) => {
      if (args.agentName === 'fiscal-reviewer') return { json: fiscalJson(), meta: {} };
      return { json: simpleJson(90), meta: {} };
    });
    const { orchestrateAudit } = await import('../orchestrator');
    const res = await orchestrateAudit({ report: { company: COMPANY, consolidatedReport: 'x' } as never, language: 'es' });
    expect(res.coverage?.partial).toBe(false);
    expect(res.consolidatedReport).not.toContain('PARCIAL');
  });
});

describe('Opinión condicionada a la integridad determinista (auditoria-calidad-03)', () => {
  it('informe con sello "GATE DE EMISIÓN" y RF sin hallazgos → CON SALVEDADES, no favorable', async () => {
    callMock.mockImplementation(async (args: { agentName: string }) => {
      if (args.agentName === 'fiscal-reviewer') return { json: fiscalJson(), meta: {} };
      return { json: simpleJson(95), meta: {} };
    });
    const { orchestrateAudit } = await import('../orchestrator');
    const report = {
      company: COMPANY,
      consolidatedReport:
        '> ## REPORTE CON SALVEDADES — GATE DE EMISIÓN\n> - V1: ecuación patrimonial rota (Activo − Pasivo − Patrimonio = $12345678.00 COP).',
    };
    const res = await orchestrateAudit({ report: report as never, language: 'es' });
    expect(res.integrity?.status).toBe('con_bloqueantes');
    expect(res.opinionType).toBe('con_salvedades');
    expect(res.consolidatedReport).not.toContain('FAVORABLE (Sin Salvedades)');
  });

  it('preprocesador con ecuación que no cuadra → CON SALVEDADES aunque el texto no traiga sello', async () => {
    callMock.mockImplementation(async (args: { agentName: string }) => {
      if (args.agentName === 'fiscal-reviewer') return { json: fiscalJson(), meta: {} };
      return { json: simpleJson(95), meta: {} };
    });
    const { orchestrateAudit } = await import('../orchestrator');
    const res = await orchestrateAudit(
      { report: { company: COMPANY, consolidatedReport: 'x' } as never, language: 'es' },
      { preprocessed: preprocessed({ equationBalanced: false }) },
    );
    expect(res.opinionType).toBe('con_salvedades');
  });

  it('el Dictamen 1 NIIF "sin salvedades" se ajusta cuando la integridad está rota', async () => {
    const { toLegacyNiifAuditorResult } = await import('../agents/niif-auditor');
    const json: NiifAuditReportJson = {
      complianceScore: 95, executiveSummary: 'alcance', findings: [], conclusion: 'c',
      niifSectionChecks: [
        { section: 'Seccion 4', sectionTitle: 'ESF', status: 'conforme', finding: 'Sin observaciones', reference: 'Sección 4', action: '—' },
      ],
      summaryStats: { conformes: 1, observaciones: 0, incumplimientos: 0 },
      auditOpinion: { type: 'sin_salvedades', text: 'Presentan razonablemente' },
      requiredActions: [],
    };
    const res = toLegacyNiifAuditorResult(json, '2025', { status: 'con_bloqueantes', motivos: ['V1'] });
    expect(res.fullContent).toContain('OPINION CON SALVEDADES');
    expect(res.fullContent).not.toContain('OPINION SIN SALVEDADES');
  });
});

describe('Reglas de opinión NIA 705 (auditoria-calidad-12)', () => {
  it('un hallazgo crítico aislado (no generalizado) → CON SALVEDADES, no desfavorable', async () => {
    const { enforceOpinionCoherence } = await import('../agents/fiscal-reviewer');
    const f = [critical('RF-001') as unknown as AuditFinding];
    expect(enforceOpinionCoherence('con_salvedades', f)).toBe('con_salvedades');
    expect(enforceOpinionCoherence('favorable', f)).toBe('con_salvedades');
  });

  it('adversa sólo con pervasive=true; abstención sólo con limitación al alcance generalizada', async () => {
    const { enforceOpinionCoherence } = await import('../agents/fiscal-reviewer');
    expect(enforceOpinionCoherence('con_salvedades', [critical('RF-001', { pervasive: true }) as unknown as AuditFinding])).toBe('desfavorable');
    expect(
      enforceOpinionCoherence('con_salvedades', [critical('RF-001', { pervasive: true, scopeLimitation: true }) as unknown as AuditFinding]),
    ).toBe('abstension');
    expect(enforceOpinionCoherence('desfavorable', [critical('RF-001') as unknown as AuditFinding])).toBe('con_salvedades');
  });

  it('el prompt NIIF ya no fija "adversa" por conteo de incumplimientos', async () => {
    const { buildNiifAuditorPrompt } = await import('../prompts/niif-auditor.prompt');
    const p = buildNiifAuditorPrompt(COMPANY as never, 'es');
    expect(p).not.toContain('adversa cuando hay >=3 incumplimientos');
    expect(p).toContain('materiales Y generalizadas');
  });

  it('el orquestador propaga pervasive: hallazgo crítico generalizado → desfavorable', async () => {
    callMock.mockImplementation(async (args: { agentName: string }) => {
      if (args.agentName === 'fiscal-reviewer') {
        return { json: fiscalJson({ opinionType: 'con_salvedades', findings: [critical('RF-001', { pervasive: true })] }), meta: {} };
      }
      return { json: simpleJson(90), meta: {} };
    });
    const { orchestrateAudit } = await import('../orchestrator');
    const res = await orchestrateAudit({ report: { company: COMPANY, consolidatedReport: 'x' } as never, language: 'es' });
    expect(res.opinionType).toBe('desfavorable');
  });
});

describe('Dictamen 1 NIIF — salvaguarda y resumen (auditoria-calidad-13)', () => {
  const json: NiifAuditReportJson = {
    complianceScore: 95, executiveSummary: 'alcance', findings: [], conclusion: 'c',
    niifSectionChecks: [
      { section: 'Seccion 4', sectionTitle: 'ESF', status: 'incumplimiento', finding: 'Activo ≠ Pasivo + Patrimonio', reference: 'Sección 4', action: 'corregir' },
    ],
    summaryStats: { conformes: 13, observaciones: 0, incumplimientos: 0 },
    auditOpinion: { type: 'sin_salvedades', text: 'Presentan razonablemente' },
    requiredActions: [],
  };

  it('resumen estadístico derivado de los checks y opinión ajustada con incumplimientos', async () => {
    const { toLegacyNiifAuditorResult } = await import('../agents/niif-auditor');
    const res = toLegacyNiifAuditorResult(json, '2025');
    expect(res.fullContent).toContain('❌ Incumplimientos: 1');
    expect(res.fullContent).toContain('✅ Conformes: 0');
    expect(res.fullContent).toContain('OPINION CON SALVEDADES');
    expect(res.fullContent).toContain('Lista mínima incompleta: 1 de 13');
  });

  it('estructura v2.1 incompleta se declara en vez de caer al legacy en silencio', async () => {
    const { renderNiifDictamenMarkdown } = await import('../agents/niif-auditor');
    const md = renderNiifDictamenMarkdown({ ...json, auditOpinion: null }, []);
    expect(md).toContain('ESTRUCTURA v2.1 INCOMPLETA');
    expect(md).toContain('opinión formal');
  });
});

describe('Contexto de la auditoría (auditoria-calidad-07)', () => {
  it('auditFocus y el contexto del preprocesador llegan a los cuatro auditores', async () => {
    callMock.mockImplementation(async (args: { agentName: string }) => {
      if (args.agentName === 'fiscal-reviewer') return { json: fiscalJson(), meta: {} };
      return { json: simpleJson(90), meta: {} };
    });
    const { orchestrateAudit } = await import('../orchestrator');
    await orchestrateAudit(
      { report: { company: COMPANY, consolidatedReport: 'x' } as never, language: 'es', auditFocus: 'Revisar reserva legal' },
      { preprocessed: preprocessed() },
    );
    expect(callMock).toHaveBeenCalledTimes(4);
    for (const call of callMock.mock.calls) {
      const args = call[0] as { userContent: string };
      expect(args.userContent).toContain('Revisar reserva legal');
      expect(args.userContent).toContain('CONTEXTO MULTIPERIODO');
      expect(args.userContent).toContain('Ecuacion patrimonial CUADRA');
    }
  });
});

