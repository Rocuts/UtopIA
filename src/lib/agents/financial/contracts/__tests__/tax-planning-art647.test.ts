// Integración W3-B (auditoría 2026-09): el contrato de planeación tributaria
// describía `art647DefenseAvailable` como «el argumento para anular la sanción
// de inexactitud (100 %)» que «DEBE invocarse». El Art. 647 E.T. (parágrafo)
// sólo excluye la inexactitud cuando el menor valor a pagar proviene de una
// interpretación razonable del derecho aplicable y los hechos y cifras
// declarados son completos y verdaderos. Los prompts del módulo ya lo decían
// así; el contrato (JSDoc y `.describe`, que viaja al LLM) lo contradecía.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { RegulatoryRiskAssessmentSchema } from '../tax-planning';

const SRC = fs.readFileSync(
  path.resolve(process.cwd(), 'src/lib/agents/financial/contracts/tax-planning.ts'),
  'utf8',
);

describe('RegulatoryRiskAssessmentSchema — Art. 647 E.T. sin «anular la sanción»', () => {
  it('el JSDoc no presenta el Art. 647 como argumento para anular la sanción', () => {
    expect(SRC).not.toMatch(/argumento para anular la sanci[oó]n/);
    expect(SRC).not.toMatch(/DEBE invocarse cuando hay base doctrinal/);
  });

  it('la descripción que viaja al LLM exige interpretación razonable y hechos y cifras completos y verdaderos', () => {
    const d = RegulatoryRiskAssessmentSchema.shape.art647DefenseAvailable.description ?? '';
    expect(d).toMatch(/interpretaci[oó]n razonable/);
    expect(d).toMatch(/completos y verdaderos/);
    expect(SRC).toMatch(/no anula la sanci[oó]n/);
  });
});
