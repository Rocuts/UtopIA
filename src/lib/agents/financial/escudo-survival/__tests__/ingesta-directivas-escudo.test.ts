// ---------------------------------------------------------------------------
// Escudo — el balance se lee con la regla común de ingesta (P4 cross-dep)
// ---------------------------------------------------------------------------
// El Modo Supervivencia y el Agente Fiscal parseaban `rawData` con
// `parseTrialBalanceCSV` directo: ignoraban la directiva de unidad confirmada
// (un balance "en miles" confirmado se leía 1.000 veces menor), sumaban las
// hojas de un XLSX en un solo periodo y corrían con una unidad declarada SIN
// confirmar, que /niif bloquea con motivo (recalculo-final-03). Ahora usan
// `preprocessUploadedTrialBalanceText` y el mismo bloqueo de integridad.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

const llm: Record<string, unknown> = {};
const llamadas: string[] = [];
const userContents: Record<string, string> = {};
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async (opts: { agentName: string; userContent: string }) => {
    llamadas.push(opts.agentName);
    userContents[opts.agentName] = opts.userContent;
    if (!(opts.agentName in llm)) throw new Error(`sin fixture para ${opts.agentName}`);
    return { json: structuredClone(llm[opts.agentName]), meta: {} };
  }),
}));

import { orchestrateEscudoSurvival } from '../orchestrator';
import { orchestrateFiscalAgent } from '../fiscal-agent/orchestrator';
import {
  EscudoBalanceBloqueadoError,
  leerBalanceEscudo,
} from '../lib/balance-ingesta';

// Balance en MILES: A = 570.000 (miles) = P 220.000 + K 350.000; UAI 100.000;
// impuesto de renta (5405) 30.000 miles = $30.000.000.
const CUERPO = [
  '110505,Caja general,Auxiliar,570000',
  '220505,Proveedores nacionales,Auxiliar,220000',
  '310505,Capital suscrito y pagado,Auxiliar,280000',
  '360505,Utilidad del ejercicio,Auxiliar,70000',
  '413550,Comercio al por mayor,Auxiliar,1000000',
  '613550,Costo de venta,Auxiliar,900000',
  '540505,Impuesto de renta y complementarios,Auxiliar,30000',
];
const CSV_MILES = ['codigo,nombre,nivel,Saldo 2025 (miles de pesos)', ...CUERPO].join('\n');
const CSV_MILES_CONFIRMADO = `[unidad-confirmada=miles]\n${CSV_MILES}`;

// XLSX con dos hojas: 2025 y 2024. Leído como CSV plano, las filas de ambas
// hojas caían en el mismo periodo `current` y se sumaban.
const hoja = (anio: string, caja: number) =>
  [
    `[period=${anio}]`,
    'codigo,nombre,nivel,Saldo',
    `110505,Caja general,Auxiliar,${caja}`,
    `310505,Capital suscrito y pagado,Auxiliar,${caja}`,
    '[/period]',
  ].join('\n');
const XLSX_DOS_HOJAS = `${hoja('2025', 100_000_000)}\n${hoja('2024', 80_000_000)}`;

beforeEach(() => {
  for (const k of Object.keys(llm)) delete llm[k];
  for (const k of Object.keys(userContents)) delete userContents[k];
  llamadas.length = 0;
});

describe('leerBalanceEscudo — misma lectura que /niif', () => {
  it('unidad declarada sin confirmar ⇒ bloqueo con el motivo del preprocesador', () => {
    let err: unknown;
    try {
      leerBalanceEscudo(CSV_MILES);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EscudoBalanceBloqueadoError);
    const e = err as EscudoBalanceBloqueadoError;
    expect(e.code).toBe('BALANCE_VALIDATION_FAILED');
    expect(e.reasons.join(' ')).toMatch(/declara las cifras en miles de pesos/);
  });

  it('con la directiva de unidad confirmada reexpresa a pesos (× 1.000) sin motivo de integridad', () => {
    const pp = leerBalanceEscudo(CSV_MILES_CONFIRMADO);
    expect(pp.primary.controlTotals.activo).toBe(570_000_000);
    expect(pp.primary.controlTotals.cents!.activo).toBe(BigInt(57_000_000_000));
    expect(pp.primary.validation.integrityReasons ?? []).toEqual([]);
  });

  it('XLSX por hojas: cada hoja es su periodo, no se suman', () => {
    const pp = leerBalanceEscudo(XLSX_DOS_HOJAS);
    expect(pp.primary.period).toBe('2025');
    expect(pp.primary.controlTotals.activo).toBe(100_000_000);
    expect(pp.comparative?.period).toBe('2024');
    expect(pp.comparative?.controlTotals.activo).toBe(80_000_000);
  });

  it('texto tabular sin filas legibles ⇒ bloqueo; texto libre sólo si el llamador lo admite', () => {
    const tabularSinEncabezado = Array.from(
      { length: 12 },
      (_, i) => `${110505 + i},Cuenta ${i},x,${1000 + i}`,
    ).join('\n');
    expect(() => leerBalanceEscudo(`titulo sin columnas\n${tabularSinEncabezado}`)).toThrow(
      EscudoBalanceBloqueadoError,
    );
    expect(() => leerBalanceEscudo('texto OCR libre sin tabla')).toThrow(EscudoBalanceBloqueadoError);
    const vacio = leerBalanceEscudo('texto OCR libre sin tabla', { sinFilas: 'vacio' });
    expect(vacio.primary.controlTotals.activo).toBe(0);
  });
});

describe('Modo Supervivencia — lectura del rawData', () => {
  it('unidad sin confirmar: no llama a ningún agente y lanza el bloqueo con motivo', async () => {
    const eventos: Array<{ stage: string; status: string; message?: string }> = [];
    await expect(
      orchestrateEscudoSurvival({ rawData: CSV_MILES }, { onProgress: (ev) => eventos.push(ev) }),
    ).rejects.toBeInstanceOf(EscudoBalanceBloqueadoError);
    expect(llamadas).toEqual([]);
    const fallo = eventos.find((ev) => ev.stage === 'preprocessing' && ev.status === 'failed');
    expect(fallo?.message ?? '').toMatch(/miles de pesos/);
  });

  it('unidad confirmada: las cifras deterministas quedan en pesos', async () => {
    const r = await orchestrateEscudoSurvival({ rawData: CSV_MILES_CONFIRMADO });
    // El impuesto de renta (5405) es 30.000 miles = $30.000.000, no $30.000.
    expect(r.tet.data.impuestoProyectado).toBe(30_000_000);
    expect(r.metadata.period).toBe('2025');
  });

  it('XLSX por hojas: periodo 2025, no la suma de las dos hojas', async () => {
    const r = await orchestrateEscudoSurvival({ rawData: XLSX_DOS_HOJAS });
    expect(r.metadata.period).toBe('2025');
  });
});

describe('Agente Fiscal — lectura del rawData', () => {
  it('unidad sin confirmar: bloqueo con motivo antes de correr módulos', async () => {
    await expect(
      orchestrateFiscalAgent({ rawData: CSV_MILES, mode: 'devolucion' }),
    ).rejects.toBeInstanceOf(EscudoBalanceBloqueadoError);
    expect(llamadas).toEqual([]);
  });

  it('preprocesado recibido con motivo de integridad también se bloquea', async () => {
    const { parseTrialBalanceCSV, preprocessTrialBalance } = await import(
      '@/lib/preprocessing/trial-balance'
    );
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV_MILES));
    await expect(
      orchestrateFiscalAgent({ rawData: '', preprocessed: pp, mode: 'devolucion' }),
    ).rejects.toBeInstanceOf(EscudoBalanceBloqueadoError);
  });

  it('unidad confirmada: el Âncora fiscal se construye sobre las cifras en pesos', async () => {
    const eventos: Array<{ stage: string; status: string }> = [];
    await orchestrateFiscalAgent(
      { rawData: CSV_MILES_CONFIRMADO, mode: 'devolucion', language: 'es' },
      { onProgress: (ev) => eventos.push(ev) },
    ).catch(() => undefined); // sin fixtures de LLM los módulos fallan después
    expect(eventos.some((ev) => ev.stage === 'preprocessing' && ev.status === 'completed')).toBe(true);
    // F01 (UAI) = 100.000 miles = $100.000.000 = 10.000.000.000 centavos.
    expect(userContents['escudo-fiscal:ccv']).toMatch(/F01 \(UAI\):[^\n]*MoneyCop: 10000000000\)/);
  });
});
