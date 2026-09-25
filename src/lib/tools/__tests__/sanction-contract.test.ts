/**
 * Regresión tributario-calc-02 — contratos de entrada de la calculadora de
 * sanciones (tool LLM del chat orquestado, API REST /api/tools/sanction usada
 * por la voz y definición Realtime).
 *
 * Defecto: los tres contratos descartaban `saldoAFavor`, `netEquityPriorYear`
 * y `correccionStage` aunque `calculateSanction` los usa. Con saldo a favor se
 * aplicaba el tope del 5 % / 2.500 UVT en lugar del doble del saldo a favor
 * (Art. 641 E.T.), y sin ingresos se devolvía la sanción mínima en lugar del 1 %
 * del patrimonio líquido del año anterior. La descripción de `isVoluntary`
 * ponía el hito del 20 % en el requerimiento especial (Art. 644 lo pone en el
 * emplazamiento para corregir, Art. 685 E.T.).
 *
 * Fuente: Art. 641 y Art. 644 E.T. (texto en src/data/tax_docs/estatuto_tributario_completo.md).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { executeTool, getToolsForAgent } from '@/lib/agents/tools/registry';
import { SANCTION_INPUT_FIELDS, calculateSanction } from '../sanction-calculator';
import {
  SANCTION_REALTIME_TOOL,
  sanctionRequestSchema,
  sanctionToolInputSchema,
  toSanctionCalculation,
} from '../sanction-contract';

const CASO_SALDO_A_FAVOR = {
  type: 'extemporaneidad' as const,
  grossIncome: 1_000_000_000,
  saldoAFavor: 10_000_000,
  delayMonths: 12,
};
const CASO_SIN_INGRESOS = {
  type: 'extemporaneidad' as const,
  netEquityPriorYear: 2_000_000_000,
  delayMonths: 3,
};

/** El tool LLM exige todas las claves (strict-compatible): las ausentes van en null. */
function conNulos(parcial: Record<string, unknown>): Record<string, unknown> {
  const full: Record<string, unknown> = {};
  for (const k of SANCTION_INPUT_FIELDS) full[k] = null;
  return { ...full, ...parcial };
}

function toolSchemaKeys(): string[] {
  const tool = getToolsForAgent('tax').calculate_sanction as unknown as {
    inputSchema: { shape: Record<string, unknown> };
  };
  return Object.keys(tool.inputSchema.shape);
}

describe('Contrato: las tres superficies transmiten todos los campos de SanctionCalculation', () => {
  it('tool LLM calculate_sanction (registry) expone todos los campos', () => {
    expect(toolSchemaKeys().sort()).toEqual([...SANCTION_INPUT_FIELDS].sort());
  });

  it('API REST (sanctionRequestSchema) conserva todos los campos tras el parse', () => {
    const todos = Object.fromEntries(
      SANCTION_INPUT_FIELDS.map((k) => [k, k === 'type' ? 'correccion' : null]),
    );
    const parsed = sanctionRequestSchema.parse(todos) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([...SANCTION_INPUT_FIELDS].sort());
  });

  it('definición Realtime declara todos los campos', () => {
    expect(Object.keys(SANCTION_REALTIME_TOOL.parameters.properties).sort()).toEqual(
      [...SANCTION_INPUT_FIELDS].sort(),
    );
  });

  it('la ruta Realtime y el hook de voz usan la definición compartida, no una copia inline', () => {
    const root = process.cwd();
    for (const rel of ['src/app/api/realtime/route.ts', 'src/hooks/useRealtimeAPI.ts']) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src, rel).toContain('SANCTION_REALTIME_TOOL');
      expect(src, rel).not.toMatch(/name:\s*'calculate_sanction'/);
    }
  });

  it("la descripción de isVoluntary fija el hito en el emplazamiento (Art. 644/685), no en el requerimiento especial", () => {
    const desc = sanctionToolInputSchema.shape.isVoluntary.description ?? '';
    expect(desc).toMatch(/emplazamiento/i);
    expect(desc).not.toMatch(/antes de requerimiento especial/i);
    expect(SANCTION_REALTIME_TOOL.parameters.properties.isVoluntary.description).toMatch(
      /emplazamiento/i,
    );
  });
});

describe('Casos del hallazgo por cada superficie', () => {
  it('API REST: $1.000 M de ingresos, saldo a favor $10 M, 12 meses → $20.000.000 (2× saldo a favor)', () => {
    const r = calculateSanction(toSanctionCalculation(sanctionRequestSchema.parse(CASO_SALDO_A_FAVOR)));
    expect(r.amount).toBe(20_000_000);
  });

  it('API REST: sin ingresos, patrimonio líquido $2.000 M, 3 meses → $60.000.000 (1% mensual)', () => {
    const r = calculateSanction(toSanctionCalculation(sanctionRequestSchema.parse(CASO_SIN_INGRESOS)));
    expect(r.amount).toBe(60_000_000);
  });

  it('API REST: acepta null (la voz reenvía los argumentos crudos del modelo)', () => {
    const r = calculateSanction(
      toSanctionCalculation(
        sanctionRequestSchema.parse({ ...CASO_SALDO_A_FAVOR, taxDue: null, difference: null }),
      ),
    );
    expect(r.amount).toBe(20_000_000);
  });

  it('tool LLM: el dispatcher liquida $20.000.000 y $60.000.000', async () => {
    const tool = getToolsForAgent('tax').calculate_sanction as unknown as {
      inputSchema: { parse: (v: unknown) => Record<string, unknown> };
    };
    const a = await executeTool('calculate_sanction', tool.inputSchema.parse(conNulos(CASO_SALDO_A_FAVOR)), {});
    const b = await executeTool('calculate_sanction', tool.inputSchema.parse(conNulos(CASO_SIN_INGRESOS)), {});
    expect(a.meta?.sanctionCalculation?.amount).toBe(20_000_000);
    expect(b.meta?.sanctionCalculation?.amount).toBe(60_000_000);
  });

  it("tool LLM: correccionStage 'despues_emplazamiento' liquida el 20 % aunque isVoluntary venga en true", async () => {
    const tool = getToolsForAgent('tax').calculate_sanction as unknown as {
      inputSchema: { parse: (v: unknown) => Record<string, unknown> };
    };
    const args = tool.inputSchema.parse(
      conNulos({
        type: 'correccion',
        difference: 50_000_000,
        correccionStage: 'despues_emplazamiento',
        isVoluntary: true,
      }),
    );
    const r = await executeTool('calculate_sanction', args, {});
    expect(r.meta?.sanctionCalculation?.amount).toBe(10_000_000);
  });
});
