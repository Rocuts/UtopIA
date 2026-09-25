'use client';

/**
 * useTaxCalculator — hook React sobre src/lib/tax/taxCalculator.
 *
 * Envuelve `compare()` (SIMPLE vs Ordinario + semáforos) en un useMemo.
 * Port del archivo de referencia del handoff
 * (handoff/1-1/project/handoff/useTaxCalculator.js).
 *
 * ⚠️ `recommended` puede ser `null`: optar por el SIMPLE es IRREVOCABLE durante
 * el año gravable (Art. 909 E.T.), así que el calculador se niega a recomendar
 * régimen cuando falta un dato del usuario —el margen de utilidad, o la tarifa
 * de ICA que fija cada concejo municipal (Ley 14 de 1983, arts. 32-33) y que no
 * tiene valor nacional único—. En ese caso `ordinarioDisponible` es false y la
 * UI debe mostrar N/D con `ordinarioMotivoND` en lugar de la cifra ordinaria
 * (auditoría 2026-09, tributario-calc-11). Ver la cabecera de
 * src/lib/tax/taxCalculator.ts.
 */

import { useMemo } from 'react';
import {
  compare,
  type CompareResult,
  type RstGroup,
  type Semaforo,
  type TipoContribuyenteRenta,
} from '@/lib/tax/taxCalculator';

export interface UseTaxCalculatorOptions {
  group?: RstGroup;
  /** Utilidad / ventas (fracción), dato del usuario. Sin él: N/D. */
  margin?: number;
  aportesPension?: number;
  /** Tarifa de ICA municipal como fracción de los ingresos. Sin ella: N/D. */
  icaRate?: number;
  /** Persona natural (Art. 241 E.T.) o jurídica (Art. 240 E.T.). */
  tipoContribuyente?: TipoContribuyenteRenta;
}

export interface UseTaxCalculatorReturn {
  result: CompareResult;
  rst: number;
  ordinario: number;
  /** `null` cuando falta un dato verificado del usuario — ver cabecera. */
  recommended: 'RST' | 'Ordinario' | null;
  /** `false` cuando `recommended` es null: la comparación no es concluyente. */
  comparable: boolean;
  savings: number;
  /** Semáforo de pertenencia al SIMPLE (tope 100.000 UVT, Art. 905 E.T.). */
  semaforo: Semaforo;
  /** false ⇒ mostrar N/D con `ordinarioMotivoND` en lugar de `ordinario`. */
  ordinarioDisponible: boolean;
  ordinarioMotivoND: string | null;
  /** Rótulo de la tarifa de renta aplicada (Art. 241 PN / Art. 240 PJ). */
  ordinarioBaseLegal: string;
  advertencias: string[];
}

/**
 * @param annualSales Ventas anuales en COP.
 * @param opts        { group, margin, aportesPension, icaRate, tipoContribuyente }
 *
 * Ejemplo:
 *   const { rst, ordinarioDisponible, ordinarioMotivoND, semaforo } =
 *     useTaxCalculator(97_992_000, { group: 'tiendas' });
 *   // Sin margen ni tarifa de ICA → ordinarioDisponible === false: la UI
 *   // muestra N/D con ordinarioMotivoND y no recomienda régimen.
 *   // semaforo mide el TOPE del SIMPLE (100.000 UVT = $5.237.400.000); los
 *   // 3.500 UVT ($183.309.000) son el umbral de responsabilidad de IVA
 *   // (`result.semaforoIvaInc`), no el tope del régimen.
 */
export function useTaxCalculator(
  annualSales: number,
  opts: UseTaxCalculatorOptions = {},
): UseTaxCalculatorReturn {
  const { group, margin, aportesPension, icaRate, tipoContribuyente } = opts;
  return useMemo(() => {
    const result = compare(annualSales || 0, {
      group: group ?? 'tiendas',
      margin,
      aportesPension,
      icaRate,
      tipoContribuyente,
    });
    return {
      result,
      rst: result.rst,
      ordinario: result.ordinario,
      recommended: result.recommended,
      comparable: result.comparable,
      savings: result.savings,
      semaforo: result.semaforo,
      ordinarioDisponible: result.ordinarioDisponible,
      ordinarioMotivoND: result.ordinarioMotivoND,
      ordinarioBaseLegal: result.ordinarioBaseLegal,
      advertencias: result.advertencias,
    };
  }, [annualSales, group, margin, aportesPension, icaRate, tipoContribuyente]);
}

export default useTaxCalculator;
