/**
 * N/D con motivo para los calculadores de KPI (valoracion-25).
 *
 * `KpiResult.value` es numérico; cuando falta una entrada verificable el
 * calculador NO publica un 0 ni un supuesto por defecto: lanza este error y el
 * llamador lo presenta como N/D con `motivo` (mismo contrato que live.ts).
 */
import type { KpiResult } from '@/types/kpis';

export class KpiNoCalculableError extends Error {
  readonly kpi: KpiResult['kind'];
  readonly motivo: string;

  constructor(kpi: KpiResult['kind'], motivo: string) {
    super(`KPI ${kpi} N/D: ${motivo}`);
    this.name = 'KpiNoCalculableError';
    this.kpi = kpi;
    this.motivo = motivo;
  }
}
