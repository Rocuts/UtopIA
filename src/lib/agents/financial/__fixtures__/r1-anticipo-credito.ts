// ---------------------------------------------------------------------------
// Escenario R1 (I5-niif): el de perdida-comparativo-w4a con un anticipo
// (133005) de saldo crédito material en 2025. El curator R1 lo publica como
// pasivo `2810ZZ-133005`, CORRIENTE por su origen (grupo 13).
// ---------------------------------------------------------------------------

import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import type { NiifReportJson } from '../contracts/niif-report';
import { informeHonesto, linea } from './perdida-comparativo-w4a';

// 2025 antes de R1: A 100M = P 70M + K 30M; tras R1: A 105M = P 75M + K 30M.
// 2024 sin reclasificación: A 140M = P 70M + K 70M.
export const CSV_R1 = [
  'Razón social: DEMO PERDIDAS SAS',
  'NIT: 900.123.456-8',
  'codigo,nombre,nivel,transaccional,saldo 2024,saldo 2025',
  '110505,Caja general,Auxiliar,1,30000000,10000000',
  '130505,Clientes nacionales,Auxiliar,1,20000000,15000000',
  '133005,Anticipos a proveedores,Auxiliar,1,0,-5000000',
  '152410,Maquinaria,Auxiliar,1,50000000,50000000',
  '152405,Equipo de oficina,Auxiliar,1,50000000,50000000',
  '159205,Depreciacion acumulada equipo,Auxiliar,1,-10000000,-20000000',
  '210505,Bancos nacionales,Auxiliar,1,40000000,45000000',
  '220505,Proveedores nacionales,Auxiliar,1,30000000,25000000',
  '311505,Capital suscrito y pagado,Auxiliar,1,100000000,100000000',
  '360505,Perdida del ejercicio,Auxiliar,1,-30000000,-40000000',
  '370505,Perdidas acumuladas,Auxiliar,1,0,-30000000',
  '410505,Ventas,Auxiliar,1,100000000,80000000',
  '510506,Sueldos,Auxiliar,1,40000000,30000000',
  '516015,Depreciacion equipo,Auxiliar,1,0,10000000',
  '530505,Intereses bancarios,Auxiliar,1,10000000,10000000',
  '613505,Costo de ventas,Auxiliar,1,80000000,70000000',
].join('\n');

export const preprocesarR1 = (): PreprocessedBalance => preprocessTrialBalance(parseTrialBalanceCSV(CSV_R1));

export const M = (millones: number) => String(BigInt(millones) * BigInt(100_000_000));
export const sub = (label: string, p: number, cmp: number) =>
  linea(null, label, M(p), M(cmp), { level: 3, isAbsolute: true });
export const det = (account: string, label: string, p: number, cmp: number | null) =>
  linea(account, label, M(p), cmp === null ? null : M(cmp), { isAbsolute: true, confidence: 'high' });

/**
 * ESF que escribe un modelo que sigue el prompt: activo sin renglón negativo
 * (133005 quedó en $0 tras R1), el saldo reclasificado en el renglón del grupo
 * 28 dentro del pasivo CORRIENTE (origen 13) y la Nota R1 en `notes`.
 */
export function esfQueSigueElPrompt(pp: PreprocessedBalance): NiifReportJson {
  const json = informeHonesto(pp);
  json.balanceSheet = {
    ...json.balanceSheet,
    assets: [
      det('11', 'Efectivo y equivalentes al efectivo', 10, 30),
      det('13', 'Deudores comerciales y otras cuentas por cobrar', 15, 20),
      sub('Total activo corriente', 25, 50),
      det('15', 'Propiedades, planta y equipo (neto)', 80, 90),
      sub('Total activo no corriente', 80, 90),
    ],
    liabilities: [
      det('21', 'Obligaciones financieras', 45, 40),
      det('22', 'Proveedores', 25, 30),
      det('28', 'Otros pasivos — saldo acreedor reclasificado de la cuenta 133005 (ver Nota R1)', 5, null),
      sub('Total pasivo corriente', 75, 70),
    ],
    notes: [
      {
        ref: 'R1',
        norma: 'NIC 1, párrafo 32',
        body:
          'La cuenta 133005 presentaba saldo contrario a su naturaleza por $5.000.000,00; se presenta como ' +
          'pasivo corriente en otros pasivos (grupo 28). Se requiere revisión documental del origen del saldo.',
      },
    ],
  };
  return json;
}
