// contab-nomina-23 — categorías de activos fijos: la tasa fiscal sale del Art.
// 137 E.T. vigente (Ley 1819/2016) del corpus del repo, separada de la vida
// útil contable, y cada categoría usa su propia cuenta PUC.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { FIXED_ASSET_CATEGORIES_CO_2026 } from '../fixed-asset-categories-co-2026';

const ET = fs.readFileSync(
  path.resolve(process.cwd(), 'src/data/tax_docs/estatuto_tributario_completo.md'),
  'utf8',
);
const PUC = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'src/data/tax_docs/puc_pymes_2026.json'), 'utf8'),
) as unknown;

function pucCodes(node: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((n) => pucCodes(n, acc));
  else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o.code === 'string') acc.add(o.code);
    Object.values(o).forEach((v) => pucCodes(v, acc));
  }
  return acc;
}
const CODES = pucCodes(PUC);

/** Tabla del parágrafo 1 del Art. 137 (texto de la Ley 1819/2016). */
function art137Table(): Map<string, number> {
  const start = ET.indexOf('ARTÍCULO 137. LIMITACIÓN A LA DEDUCCIÓN POR DEPRECIACIÓN');
  const end = ET.indexOf('PARÁGRAFO 2o.', start);
  const block = ET.slice(start, end).replace(/-- \d+ of \d+ --/g, '');
  const table = new Map<string, number>();
  const re = /([A-ZÁÉÍÓÚÑ ,\n]+?)\s*(\d{1,2},\d{2})%/g;
  for (const m of block.matchAll(re)) {
    const concept = m[1].replace(/\s+/g, ' ').replace(/^.*ANUAL %\s*/, '').trim();
    table.set(concept, Number(m[2].replace(',', '.')));
  }
  return table;
}

describe('contab-nomina-23 — categorías de activos fijos', () => {
  const table = art137Table();

  it('la tabla del Art. 137 par. 1 se lee del corpus (Ley 1819/2016)', () => {
    expect(table.get('CONSTRUCCIONES Y EDIFICACIONES')).toBe(2.22);
    expect(table.get('EQUIPO DE COMPUTACIÓN')).toBe(20);
    expect(table.get('FLOTA Y EQUIPO DE TRANSPORTE TERRESTRE')).toBe(10);
  });

  it('cada tasa fiscal coincide con su concepto del Art. 137 y la vida contable va aparte', () => {
    for (const c of FIXED_ASSET_CATEGORIES_CO_2026) {
      expect(table.get(c.fiscalConcept), c.key).toBe(c.fiscalMaxAnnualRatePct);
    }
    const byKey = new Map(FIXED_ASSET_CATEGORIES_CO_2026.map((c) => [c.key, c]));
    expect(byKey.get('edificios')!.fiscalMaxAnnualRatePct).toBe(2.22);
    expect(byKey.get('vehiculos')!.fiscalMaxAnnualRatePct).toBe(10);
    expect(byKey.get('equipo_computo')!.fiscalMaxAnnualRatePct).toBe(20);
  });

  it('el seed no atribuye al Art. 137 las vidas anteriores a la Ley 1819/2016', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/db/seeds/fixed-asset-categories-co-2026.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/5 años Art\. 137/);
    expect(src).not.toMatch(/20 años = 240 meses/);
  });

  it('cuentas: activo del PUC, depreciación 1592xx propia y gasto 5160xx espejo', () => {
    for (const c of FIXED_ASSET_CATEGORIES_CO_2026) {
      expect(CODES.has(c.assetAccountCode), `${c.key} activo ${c.assetAccountCode}`).toBe(true);
      expect(CODES.has(c.depreciationAccountCode), `${c.key} dep ${c.depreciationAccountCode}`).toBe(true);
      expect(c.depreciationAccountCode.startsWith('1592')).toBe(true);
      expect(c.expenseAccountCode.startsWith('5160')).toBe(true);
      expect(c.expenseAccountCode.slice(4)).toBe(c.depreciationAccountCode.slice(4));
    }
    const comp = FIXED_ASSET_CATEGORIES_CO_2026.find((c) => c.key === 'equipo_computo')!;
    expect(comp.assetAccountCode.startsWith('1528')).toBe(true);
    // Antes todas usaban 159205 (construcciones): ahora cada clase tiene la suya.
    const deps = new Set(FIXED_ASSET_CATEGORIES_CO_2026.map((c) => c.depreciationAccountCode));
    expect(deps.size).toBe(5);
  });
});
