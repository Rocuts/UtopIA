// Integración W3-B (auditoría 2026-09). La tabla de indicadores del chat
// contable enseñaba ROE = Utilidad neta / Patrimonio (saldo final) y Cobertura
// de intereses = EBITDA / Gastos financieros, mientras el preprocesador y los
// entregables calculan ROE sobre el patrimonio PROMEDIO (utilidad anualizada) y
// la cobertura como EBIT / |5305| (N/D sin gasto financiero). El chat daba otra
// cifra que el informe para el mismo balance.
import { describe, expect, it } from 'vitest';

import type { NITContext } from '@/lib/security/pii-filter';
import { buildAccountingPrompt } from '../accounting-agent.prompt';

const PJ: NITContext = {
  lastDigit: 7,
  lastTwoDigits: 17,
  checkDigit: 4,
  presumedType: 'persona_juridica',
};

describe('chat contable — fórmulas de ROE y cobertura iguales a las del preprocesador', () => {
  const prompt = buildAccountingPrompt('es', 'financial-intelligence', PJ);

  it('ROE sobre el patrimonio promedio, N/D si es ≤ 0', () => {
    expect(prompt).not.toMatch(/\| ROE \| Utilidad Neta \/ Patrimonio \|/);
    expect(prompt).toMatch(/\| ROE \|[^\n]*Patrimonio promedio/);
    expect(prompt).toMatch(/\| ROE \|[^\n]*N\/D/);
  });

  it('cobertura de intereses = EBIT / |5305|, N/D sin gasto financiero', () => {
    expect(prompt).not.toMatch(/\| Cobertura de Intereses \| EBITDA \/ Gastos Financieros \|/);
    expect(prompt).toMatch(/\| Cobertura de Intereses \|[^\n]*EBIT[^D][^\n]*5305/);
    expect(prompt).toMatch(/\| Cobertura de Intereses \|[^\n]*N\/D/);
  });
});
