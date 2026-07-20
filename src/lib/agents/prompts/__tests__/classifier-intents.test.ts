import { describe, expect, it } from 'vitest';
import { buildClassifierPrompt } from '../classifier.prompt';

// Contrato classifier↔chip de navegación (Ola 1B): computeSuggestedRoute
// (src/lib/agents/navigation/suggested-route.ts) enruta por substring del
// `intent`. Este test bloquea que el classifier documente los intents que
// cada regla de ruta necesita — si se borran, la ruta deja de dispararse.
describe('classifier prompt documents nav-chip intents', () => {
  const prompt = buildClassifierPrompt(false);
  it.each([
    'transfer_pricing',       // → precios-transferencia
    'company_valuation',      // → valor
    'due_diligence',          // → valor
    'revisoria_fiscal',       // → verdad
    'feasibility_study',      // → futuro
    'scenario_analysis',      // → futuro
    'tax_planning',           // → planeacion-tributaria (ya existía)
    'requerimiento_response', // → defensa-dian (ya existía)
  ])('documenta el intent "%s"', (intent) => {
    expect(prompt).toContain(intent);
  });
});
