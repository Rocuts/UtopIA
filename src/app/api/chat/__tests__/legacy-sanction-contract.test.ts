// ---------------------------------------------------------------------------
// La tool legacy `calculate_sanction` usa el contrato compartido
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (tributario-calc-02, integración IW5b). El handler legacy
// (UTOPIA_AGENT_MODE=legacy) declaraba su propio inputSchema sin saldoAFavor,
// netEquityPriorYear, correccionStage, reduccion640 ni
// extemporaneidad_post_emplazamiento, y describía annualRate con un
// «Default: 27.44%» que no es la tasa de mora del Art. 635 E.T. Además no
// capturaba SanctionInputError: una entrada contradictoria tumbaba el turno en
// vez de devolverse al modelo. El camino orquestado (tools/registry.ts) ya usa
// el contrato de sanction-contract; los dos no pueden divergir.
//
// Route handlers de Next no admiten exports arbitrarios, así que se verifica
// el código fuente del bloque de la tool.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';

const ROUTE = path.resolve(process.cwd(), 'src/app/api/chat/route.ts');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function sanctionToolBlock(): string {
  const src = stripComments(fs.readFileSync(ROUTE, 'utf8'));
  const start = src.indexOf('calculate_sanction: tool({');
  expect(start, 'la tool legacy calculate_sanction existe').toBeGreaterThan(-1);
  const end = src.indexOf('analyze_document: tool({', start);
  return src.slice(start, end);
}

describe('chat legacy — calculate_sanction', () => {
  it('usa el inputSchema y la descripción del contrato compartido', () => {
    const block = sanctionToolBlock();
    expect(block).toMatch(/inputSchema:\s*sanctionToolInputSchema/);
    expect(block).toMatch(/description:\s*SANCTION_TOOL_DESCRIPTION/);
    expect(block).not.toMatch(/z\.object\(/);
  });

  it('no anuncia una tasa de mora por defecto', () => {
    expect(sanctionToolBlock()).not.toMatch(/27[.,]44/);
  });

  it('devuelve al modelo las entradas contradictorias (SanctionInputError) en vez de fallar', () => {
    const block = sanctionToolBlock();
    expect(block).toMatch(/instanceof SanctionInputError/);
    expect(block).not.toMatch(/as unknown as SanctionCalculation\b/);
  });
});
