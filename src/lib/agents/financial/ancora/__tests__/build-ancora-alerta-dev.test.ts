// ---------------------------------------------------------------------------
// Âncora — alerta DEV con la misma base en cualquier convención de signos
// ---------------------------------------------------------------------------
// Re-auditoría 2026-09-24 (recalculo-final2-05): la alerta de devoluciones
// materiales dividía por controlTotals.ingresos, cuyo valor cambia con la
// convención de signos del ERP (para las mismas ventas: $550M en la exportación
// natural y $450M en la algebraica). En el umbral del 1 % la alerta dependía
// del ERP. La base es ahora ingresos netos + devoluciones (ingresos brutos).
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { buildNiifAncora } from '../build-ancora';

const DIR = path.resolve(__dirname, '../../../../preprocessing/__fixtures__/devoluciones-4175');
const COMPANY = { name: 'PYME SAS', nit: '900123456-1' } as never;

function alertaDev(csv: string) {
  return buildNiifAncora(preprocessTrialBalance(parseTrialBalanceCSV(csv)), COMPANY).checks.alertaDev;
}

/**
 * Devoluciones de $5.000.000 sobre ventas brutas de $500.000.000 (1,0 %, justo
 * en el umbral «> 1 %»), con utilidad y caja ajustadas para cuadrar. Con la
 * base anterior la exportación natural daba 5/505 (inactiva) y la algebraica
 * 5/495 (activa).
 */
function enElUmbral(csv: string): string {
  return csv
    .replace(/^110505,(.*),400000000$/m, '110505,$1,445000000')
    .replace(/^417505,(.*),50000000$/m, '417505,$1,5000000')
    .replace(/^360505,(.*),190000000$/m, '360505,$1,235000000')
    .replace(/^360505,(.*),-190000000$/m, '360505,$1,-235000000');
}

describe('buildNiifAncora — alerta DEV independiente de la convención del ERP', () => {
  const natural = readFileSync(path.join(DIR, 'natural.csv'), 'utf8');
  const algebraica = readFileSync(path.join(DIR, 'algebraica.csv'), 'utf8');

  it('devoluciones del 10 % de las ventas: activa en ambas convenciones', () => {
    expect(alertaDev(natural)).toBe('activa');
    expect(alertaDev(algebraica)).toBe('activa');
  });

  it('devoluciones del 1,0 % de las ventas brutas: la misma decisión en ambas convenciones', () => {
    const nat = enElUmbral(natural);
    const alg = enElUmbral(algebraica);
    expect(nat).not.toBe(natural);
    expect(alg).not.toBe(algebraica);
    expect(alertaDev(nat)).toBe('inactiva');
    expect(alertaDev(alg)).toBe('inactiva');
  });
});
