// ---------------------------------------------------------------------------
// auditoria-calidad-31 (cross-dep de P6) — el régimen tributario llega al gate
// ---------------------------------------------------------------------------
// P6 hizo que `auditReportEmittable` no exija V10 (TTD, par. 6 del Art. 240
// E.T.) al Régimen Simple (Art. 903 E.T.: "sustituye el impuesto sobre la
// renta"), pero ningún llamador pasaba `regimenTributario`: el SIMPLE seguía
// bloqueado por V10. El consolidado partido (y el orquestador legacy) lo leen
// ahora de la empresa, con la misma lectura defensiva que
// `estatutosRequierenReservaLegal`.
//
// El intake NIIF y `companyInfoSchema` capturan el régimen desde I3-intake
// (prueba de punta a punta en
// src/components/workspace/intake/__tests__/regimen-tributario-intake.test.tsx);
// sin dato, V10 se sigue evaluando como régimen ordinario: conservador.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { consolidateSplitReport, regimenTributarioParaGate } from '../split-consolidation';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';

const CSV = [
  'codigo,nombre,nivel,transaccional,saldo 2024,saldo 2025',
  '110505,Caja,Auxiliar,1,50000000,80000000',
  '130505,Clientes,Auxiliar,1,40000000,60000000',
  '220505,Proveedores,Auxiliar,1,30000000,40000000',
  '311505,Capital,Auxiliar,1,40000000,40000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,20000000,40000000',
  '370505,Utilidades acumuladas,Auxiliar,1,0,20000000',
  '410505,Ventas,Auxiliar,1,100000000,150000000',
  '510505,Sueldos,Auxiliar,1,80000000,110000000',
].join('\n');

const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV));

/** Consolidado SIN mención de la TTD: V10 bloquea salvo en el Régimen Simple. */
function run(regimenTributario?: unknown) {
  return consolidateSplitReport({
    company: {
      name: 'Demo SAS', nit: '900123456-8', fiscalPeriod: '2025', niifGroup: 2, entityType: 'SAS',
      ...(regimenTributario !== undefined ? { regimenTributario } : {}),
    } as never,
    preprocessed: pp,
    rawData: 'NIT 900123456-8\nDEMO SAS',
    niifContent: 'Estados financieros 2025.',
    strategyContent: 'Estrategia.',
    governanceContent: 'Acta de asamblea.',
    language: 'es',
    now: new Date('2026-03-01T00:00:00Z'),
  });
}

const hasV10 = (r: ReturnType<typeof run>) => r.emittability.blockers.some((b) => b.code === 'V10');

describe('regimenTributario en el gate del consolidado partido (auditoria-calidad-31)', () => {
  it('Régimen Simple declarado: V10 no se exige', () => {
    expect(hasV10(run('simple'))).toBe(false);
  });

  it('ordinario, no informado o un valor desconocido: V10 se sigue exigiendo', () => {
    expect(hasV10(run('ordinario'))).toBe(true);
    expect(hasV10(run())).toBe(true);
    expect(hasV10(run('zomac'))).toBe(true);
  });

  it('lectura defensiva: sólo "simple" / "ordinario" (sin distinguir mayúsculas)', () => {
    expect(regimenTributarioParaGate({ regimenTributario: ' SIMPLE ' })).toBe('simple');
    expect(regimenTributarioParaGate({ regimenTributario: 'Ordinario' })).toBe('ordinario');
    expect(regimenTributarioParaGate({ regimenTributario: 3 })).toBeUndefined();
    expect(regimenTributarioParaGate({})).toBeUndefined();
  });
});
