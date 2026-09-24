// auditoria-calidad-19 — un escaneo cuyas reglas fallan no puede quedar como
// "score 100 limpio": la cobertura se declara y el fallo total lanza.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ForensicRule } from '../types';

const rules: ForensicRule[] = [];
vi.mock('../rules/index', () => ({
  get ALL_RULES() {
    return rules;
  },
}));

function failing(kind: ForensicRule['kind']): ForensicRule {
  return { kind, run: async () => { throw new Error('DB caída'); } };
}
function clean(kind: ForensicRule['kind']): ForensicRule {
  return { kind, run: async () => ({ anomalies: [] }) };
}

beforeEach(() => {
  rules.length = 0;
});

describe('runForensicScan — cobertura de reglas', () => {
  it('si TODAS las reglas fallan lanza ForensicScanFailedError (nunca score 100 "limpio")', async () => {
    rules.push(failing('benford_violation'), failing('numeration_gap'), failing('weekend_posting'));
    const { runForensicScan, ForensicScanFailedError } = await import('../orchestrator');
    await expect(runForensicScan({ workspaceId: 'w', periodId: 'p' })).rejects.toBeInstanceOf(ForensicScanFailedError);
  });

  it('con fallas parciales declara coverage "parcial" y lista las reglas no evaluadas', async () => {
    rules.push(clean('benford_violation'), failing('numeration_gap'));
    const { runForensicScan } = await import('../orchestrator');
    const res = await runForensicScan({ workspaceId: 'w', periodId: 'p' });
    expect(res.coverage).toBe('parcial');
    expect(res.rulesFailed).toEqual(['numeration_gap']);
    expect(res.rulesEvaluated).toEqual(['benford_violation']);
    expect(res.warnings.join(' ')).toMatch(/Cobertura PARCIAL/);
  });

  it('con todas las reglas evaluadas la cobertura es "completa"', async () => {
    rules.push(clean('benford_violation'), clean('numeration_gap'));
    const { runForensicScan } = await import('../orchestrator');
    const res = await runForensicScan({ workspaceId: 'w', periodId: 'p' });
    expect(res.coverage).toBe('completa');
    expect(res.score).toBe(100);
  });
});
