// Balance común de la re-auditoría normativa-metricas (2026-09-24), usado por
// las regresiones W4-C (pilares, Sentinel, PDF, Âncora).
//
// 2025 (cierre anual):
//   41 ventas 2.000 M − 4175 devoluciones 100 M = ingresos operacionales netos 1.900 M
//   42 intereses (4210) 20 M                       → ingresos netos 1.920 M
//   6 costo de ventas 1.200 M + 7 (7205 MOD) 100 M = costos 1.300 M → UB 600 M
//   51/52 = 480 M → EBIT 120 M; 53 = 40 M; UAI 100 M; 54 = 35 M → UN 65 M
//   Balance: 111010 sobregiro −30 M (activo negativo → reclasificación R1);
//   efectivo 11 tras R1 = 200 M; egresos 5 + 6 + 7 = 1.855 M.
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import type { FinancialReport } from '@/lib/agents/financial/types';

export const CSV_NM_ANUAL = [
  'codigo,nombre,nivel,transaccional,Saldo 2024,Saldo 2025',
  '110505,Caja general,Auxiliar,1,50000000,80000000',
  '111005,Bancos cuenta corriente,Auxiliar,1,150000000,120000000',
  '111010,Bancos cuenta sobregirada,Auxiliar,1,0,-30000000',
  '130505,Clientes nacionales,Auxiliar,1,300000000,360000000',
  '139905,Deterioro clientes,Auxiliar,1,-5000000,-10000000',
  '135515,Retencion en la fuente,Auxiliar,1,20000000,25000000',
  '135518,Impuesto de industria y comercio retenido,Auxiliar,1,0,5000000',
  '143505,Mercancias no fabricadas,Auxiliar,1,200000000,250000000',
  '152405,Maquinaria y equipo,Auxiliar,1,500000000,500000000',
  '159205,Depreciacion acumulada maquinaria,Auxiliar,1,-100000000,-150000000',
  '210505,Bancos nacionales,Auxiliar,1,200000000,180000000',
  '220505,Proveedores nacionales,Auxiliar,1,150000000,170000000',
  '240405,Impuesto de renta vigencia corriente,Auxiliar,1,40000000,60000000',
  '240805,IVA por pagar,Auxiliar,1,30000000,35000000',
  '250505,Salarios por pagar,Auxiliar,1,20000000,25000000',
  '310505,Capital suscrito y pagado,Auxiliar,1,300000000,300000000',
  '370505,Resultados de ejercicios anteriores,Auxiliar,1,180000000,315000000',
  '413550,Comercio al por mayor y menor,Auxiliar,1,1800000000,2000000000',
  '417505,Devoluciones en ventas,Auxiliar,1,0,100000000',
  '421005,Intereses financieros,Auxiliar,1,10000000,20000000',
  '510506,Sueldos administracion,Auxiliar,1,300000000,320000000',
  '516005,Depreciacion edificios admin,Auxiliar,1,30000000,30000000',
  '526005,Depreciacion ventas,Auxiliar,1,20000000,20000000',
  '529505,Comisiones ventas,Auxiliar,1,100000000,110000000',
  '530520,Intereses bancarios,Auxiliar,1,25000000,30000000',
  '531520,Gastos extraordinarios,Auxiliar,1,0,10000000',
  '540505,Impuesto de renta y complementarios,Auxiliar,1,40000000,35000000',
  '613550,Costo de venta de mercancias,Auxiliar,1,1100000000,1200000000',
  '720505,Mano de obra directa,Auxiliar,1,0,100000000',
].join('\n');

/** Mismo balance con el periodo actual rotulado con otra etiqueta (p. ej. 'Saldo [2025-Q2]'). */
export function csvNmConPeriodo(actual: string): string {
  return CSV_NM_ANUAL.replace('Saldo 2024,Saldo 2025', `Saldo [2024],Saldo [${actual}]`);
}

export const preNm = (csv: string) => preprocessTrialBalance(parseTrialBalanceCSV(csv));

export function stubReportNm(): FinancialReport {
  return {
    company: { name: 'Demo SAS', nit: '900123456-7', entityType: 'SAS', fiscalPeriod: '2025', niifGroup: 2 },
    niifAnalysis: { balanceSheet: '', incomeStatement: '', cashFlowStatement: '', equityChangesStatement: '', technicalNotes: '', fullContent: '' },
    strategicAnalysis: { kpiDashboard: '', breakEvenAnalysis: '', projectedCashFlow: '', strategicRecommendations: '', fullContent: '' },
    governance: { financialNotes: '', shareholderMinutes: '', fullContent: '' },
    consolidatedReport: '',
    generatedAt: '2026-09-24T00:00:00.000Z',
  } as FinancialReport;
}
