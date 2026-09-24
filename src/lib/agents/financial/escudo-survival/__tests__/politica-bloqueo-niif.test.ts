// ---------------------------------------------------------------------------
// Escudo — misma política de bloqueo del balance que /niif (I4-escudo 2)
// ---------------------------------------------------------------------------
// `leerBalanceEscudo` sólo bloqueaba por `integrityReasons` (unidad sin
// confirmar, importes ilegibles, fuera de rango). /niif (Stage 0.5 de
// `prepareFinancialContext`) bloquea además por la ecuación descuadrada que
// el Bridge de Cuadratura no explica y por los bloqueos del curator
// posteriores a R8 (`curatorBlockingReasons`: CUR-R8, CUR-R5, CUR-R12). El
// Modo Supervivencia y el Agente Fiscal producían cifras fiscales sobre esos
// balances. La prueba compara, balance por balance, la decisión y los motivos
// del Escudo con los del gate real de /niif, y confirma que los fixtures
// honestos no se bloquean.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const llamadas: string[] = [];
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async (opts: { agentName: string }) => {
    llamadas.push(opts.agentName);
    throw new Error(`sin fixture para ${opts.agentName}`);
  }),
}));

import { BalanceValidationError, prepareFinancialContext } from '../../orchestrator';
import { orchestrateEscudoSurvival } from '../orchestrator';
import { orchestrateFiscalAgent } from '../fiscal-agent/orchestrator';
import {
  EscudoBalanceBloqueadoError,
  leerBalanceEscudo,
  motivosBloqueoBalance,
} from '../lib/balance-ingesta';
import { CSV_PERDIDA_COMPARATIVO } from '../../__fixtures__/perdida-comparativo-w4a';
import { csvDosCortes, csvTresCortes } from '../../__fixtures__/tres-cortes-comparativo';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';

const COMPANY = { name: 'Empresa Prueba SAS', nit: '900123456-7', fiscalPeriod: '2025' };

const ELITE = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/preprocessing/__fixtures__/elite-pulido-diamante.csv'),
  'utf8',
);

// Libros abiertos que cuadran con el traslado del resultado (R8 lo explica).
const ABIERTO = [
  'codigo,nombre,Saldo 2025',
  '110505,Caja,1000000000',
  '220505,Proveedores,400000000',
  '310505,Capital,500000000',
  '413505,Ventas,800000000',
  '513505,Gastos,700000000',
].join('\n');

// Descuadre que ningún traslado explica: A 1.000M ≠ P 400M + K 500M, sin P&G.
const DESCUADRADO = [
  'codigo,nombre,Saldo 2025',
  '110505,Caja,1000000000',
  '220505,Proveedores,400000000',
  '310505,Capital,500000000',
].join('\n');

// CUR-R8: con P&G, el traslado deja un residual (A − P − K − resultado = 50M).
const RESIDUAL_R8 = [
  'codigo,nombre,Saldo 2025',
  '110505,Caja,1050000000',
  '220505,Proveedores,400000000',
  '310505,Capital,500000000',
  '413505,Ventas,800000000',
  '513505,Gastos,700000000',
].join('\n');

// CUR-R12: el P&G 2025 trae 2024 + 2025 (2024 nunca se cerró).
const PYG_ACUMULADO = [
  'codigo,nombre,Saldo 2024,Saldo 2025',
  '110505,Caja,1000000000,1500000000',
  '220505,Proveedores,400000000,500000000',
  '310505,Capital,100000000,100000000',
  '413505,Ventas,800000000,1500000000',
  '513505,Gastos,300000000,600000000',
].join('\n');

// Integridad: importe ilegible aunque R8 cuadre la ecuación.
const ILEGIBLE = ABIERTO.replace('220505,', '111005,Bancos,#DIV/0!\n220505,');

async function motivosNiif(rawData: string): Promise<string[]> {
  try {
    await prepareFinancialContext({ rawData, company: COMPANY, language: 'es' });
    return [];
  } catch (err) {
    if (err instanceof BalanceValidationError) return err.reasons;
    throw err;
  }
}

function motivosEscudo(rawData: string): string[] {
  try {
    leerBalanceEscudo(rawData);
    return [];
  } catch (err) {
    if (err instanceof EscudoBalanceBloqueadoError) return err.reasons;
    throw err;
  }
}

beforeEach(() => {
  llamadas.length = 0;
});

describe('leerBalanceEscudo — mismo gate que /niif', () => {
  const HONESTOS: Array<[string, string]> = [
    ['tres-cortes-comparativo', csvTresCortes()],
    ['tres-cortes (dos cortes)', csvDosCortes()],
    ['perdida-comparativo-w4a', CSV_PERDIDA_COMPARATIVO],
    ['libros abiertos que R8 explica', ABIERTO],
  ];

  it.each(HONESTOS)('%s: ni /niif ni el Escudo lo bloquean', async (_n, csv) => {
    expect(await motivosNiif(csv)).toEqual([]);
    expect(motivosEscudo(csv)).toEqual([]);
  });

  // `elite-pulido-diamante.csv` NO es un balance honesto: se diseñó con un
  // descuadre deliberado (379505) que R8 no absorbe (elite-pulido-diamante.test.ts:
  // residual $1.574.500.000,00 en 2025) y /niif lo rechaza con 422
  // (pipeline-e2e.test.ts). Bloquearlo en el Escudo no es un falso bloqueo.
  const BLOQUEADOS: Array<[string, string, RegExp]> = [
    ['elite-pulido-diamante (descuadre deliberado, CUR-R8)', ELITE, /CUR-R8[\s\S]*1\.574\.500\.000,00/],
    ['ecuación descuadrada sin P&G', DESCUADRADO, /ecuacion contable no cuadra/i],
    ['residual que R8 no explica (CUR-R8)', RESIDUAL_R8, /CUR-R8/],
    ['P&G posiblemente acumulado (CUR-R12)', PYG_ACUMULADO, /CUR-R12/],
    ['importe ilegible (integridad)', ILEGIBLE, /111005/],
  ];

  it.each(BLOQUEADOS)('%s: el Escudo bloquea con los mismos motivos que /niif', async (_n, csv, re) => {
    const niif = await motivosNiif(csv);
    expect(niif.length).toBeGreaterThan(0);
    expect(niif.join('\n')).toMatch(re);
    expect(motivosEscudo(csv)).toEqual(niif);
  });

  it('motivosBloqueoBalance es vacío para un balance que /niif acepta', () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(ABIERTO));
    expect(pp.primary.validation.blocking).toBe(true); // razones pre-R8
    expect(motivosBloqueoBalance(pp)).toEqual([]);
  });
});

describe('Supervivencia y Agente Fiscal no producen cifras sobre un balance que /niif bloquea', () => {
  it('Modo Supervivencia: CUR-R8 ⇒ bloqueo antes de llamar a ningún agente', async () => {
    await expect(orchestrateEscudoSurvival({ rawData: RESIDUAL_R8 })).rejects.toBeInstanceOf(
      EscudoBalanceBloqueadoError,
    );
    expect(llamadas).toEqual([]);
  });

  it('Agente Fiscal: ecuación descuadrada ⇒ bloqueo antes de correr módulos', async () => {
    await expect(
      orchestrateFiscalAgent({ rawData: DESCUADRADO, mode: 'full' }),
    ).rejects.toBeInstanceOf(EscudoBalanceBloqueadoError);
    expect(llamadas).toEqual([]);
  });

  it('Agente Fiscal: un preprocesado recibido con CUR-R12 también se bloquea', async () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(PYG_ACUMULADO));
    await expect(
      orchestrateFiscalAgent({ rawData: '', preprocessed: pp, mode: 'quick' }),
    ).rejects.toBeInstanceOf(EscudoBalanceBloqueadoError);
    expect(llamadas).toEqual([]);
  });
});
