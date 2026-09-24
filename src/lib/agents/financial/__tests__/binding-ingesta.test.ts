// ---------------------------------------------------------------------------
// TOTALES VINCULANTES con unidad confirmada y notas de ingesta (cross-dep P4)
// ---------------------------------------------------------------------------
// Con un balance "en miles de pesos" y la unidad confirmada, el preprocesador
// reexpresa cada importe a pesos, pero los agentes leen además los DATOS
// CONTABLES EN BRUTO, que siguen en miles con sólo la directiva
// `[unidad-confirmada=miles]` delante. El bloque vinculante no lo decía ni
// citaba las notas de ingesta (unidad reexpresada, corte declarado,
// vencimientos): una nota que citara el saldo de una cuenta del texto crudo
// salía 1.000 veces menor. Ahora el bloque declara la unidad de los totales y
// de los datos en bruto y cita las notas de ingesta tal cual.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/macro/prompt-snapshot', () => ({ getMacroSnapshotForPrompts: vi.fn(async () => null) }));

import { prepareFinancialContext } from '../orchestrator';
import { escribirDirectivasIngesta } from '@/lib/upload/ingest-directives';

const COMPANY = { name: 'Demo SAS', nit: '900123456', entityType: 'SAS', niifGroup: 2 as const, fiscalPeriod: '2025' };

const CSV_MILES = [
  'Balance de prueba a junio 30 de 2025',
  'Cifras expresadas en miles de pesos',
  'codigo,nombre,nivel,saldo 2025',
  '110505,Caja,Auxiliar,50000',
  '130505,Clientes,Auxiliar,40000',
  '143505,Mercancias,Auxiliar,60000',
  '152405,Equipo de oficina,Auxiliar,50000',
  '210505,Crédito bancario a 3 años,Auxiliar,30000',
  '230505,Cxp,Auxiliar,30000',
  '240405,Renta,Auxiliar,20000',
  '311505,Capital,Auxiliar,100000',
  '360505,Utilidad del ejercicio,Auxiliar,20000',
  '410505,Ventas,Auxiliar,200000',
  '417505,Devoluciones,Auxiliar,10000',
  '510505,Sueldos,Auxiliar,20000',
  '530505,Intereses,Auxiliar,10000',
  '613505,CMV,Auxiliar,140000',
].join('\n');

async function block(rawData: string): Promise<string> {
  const ctx = await prepareFinancialContext({ rawData, company: COMPANY, language: 'es' });
  return ctx.bindingTotalsBlock;
}

describe('bloque vinculante — unidad confirmada y notas de ingesta (P4)', () => {
  it('con unidad confirmada en miles: los totales están en pesos, el bruto en miles y se citan las notas', async () => {
    const b = await block(
      escribirDirectivasIngesta(CSV_MILES, { unidadConfirmada: 'miles', vencimientos: { '210505': 'no_corriente' } }),
    );
    expect(b).toContain('UNIDAD DE LAS CIFRAS');
    expect(b).toMatch(/TOTALES VINCULANTES están en PESOS colombianos/);
    expect(b).toMatch(/DATOS CONTABLES EN BRUTO .* en MILES de pesos/);
    // Las notas de ingesta tal cual (unidad, corte declarado y vencimiento).
    expect(b).toMatch(/cifras reexpresadas de miles de pesos a pesos/);
    expect(b).toMatch(/Fecha de corte declarada en el archivo/);
    expect(b).toMatch(/210505/);
    // Total Activo en pesos: 200.000 miles.
    expect(b).toMatch(/Total Activo: \$200\.000\.000/);
    // Patrón GPT-5.4: sin numeración procedimental.
    expect(b).not.toMatch(/Paso \d/);
  });

  it('sin unidad declarada ni notas de ingesta el bloque no agrega la sección', async () => {
    const pesos = CSV_MILES.split('\n').filter((l) => !/miles de pesos|junio 30/.test(l)).join('\n');
    const b = await block(pesos);
    expect(b).not.toContain('UNIDAD DE LAS CIFRAS');
    expect(b).not.toContain('NOTAS DE INGESTA');
  });
});
