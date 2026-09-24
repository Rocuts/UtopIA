// ---------------------------------------------------------------------------
// Sanción mínima (Arts. 639 y 868 E.T.) — una sola constante en todas las superficies
// ---------------------------------------------------------------------------
// Fase 2 de la auditoría 2026-09-24 (tributario-calc-19): prompts y catálogos
// escribían la cifra a mano ($523.740 en unos, $524.000 en otros). Ahora la
// derivan de MIN_SANCTION de la calculadora.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { MIN_SANCTION } from '../sanction-calculator';
import { buildTaxPrompt } from '@/lib/agents/prompts/tax-agent.prompt';
import { SANCIONES } from '@/lib/agents/financial/escudo-survival/normative/catalog/sanciones';
import { ARTICULOS_ET } from '@/lib/agents/financial/escudo-survival/normative/catalog/estatuto-tributario';
import { SANCTION_TOOL_DESCRIPTION } from '../sanction-contract';

const TXT = `$${MIN_SANCTION.toLocaleString('es-CO')}`;

describe('sanción mínima desde MIN_SANCTION', () => {
  it('MIN_SANCTION 2026 = $524.000 (10 × $52.374 aproximado, Art. 868)', () => {
    expect(MIN_SANCTION).toBe(524_000);
    expect(TXT).toBe('$524.000');
  });

  it('el prompt del agente tributario y los catálogos citan la misma cifra', () => {
    expect(buildTaxPrompt('es', 'general', null)).toContain(`10 UVT = ${TXT}`);
    const s = SANCIONES.find((x) => /m[ií]nima/i.test(x.nombre));
    expect(s?.tope).toContain(TXT);
    expect(s?.tope).not.toContain('$523.740');
    const a = ARTICULOS_ET.find((x) => x.id === 'ART_639_ET');
    expect(a?.resumen).toContain(TXT);
    expect(a?.resumen).not.toContain('$523.740');
  });

  it('la descripción de la tool (chat y voz) deriva la cifra de MIN_SANCTION', async () => {
    expect(SANCTION_TOOL_DESCRIPTION).toContain(`10 UVT = ${TXT}`);
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../sanction-contract.ts'), 'utf8');
    expect(src).not.toMatch(/\$52[34]\.\d{3}/); // $523.740 / $524.000 escritos a mano
  });
});
