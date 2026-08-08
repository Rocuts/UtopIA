'use client';

/**
 * useTaxCalculator — hook React sobre src/lib/tax/taxCalculator.
 *
 * Envuelve `compare()` (RST vs Ordinario + semáforo) en un useMemo.
 * Port del archivo de referencia del handoff
 * (handoff/1-1/project/handoff/useTaxCalculator.js).
 *
 * ⚠️ `recommended` puede ser `null`: optar por el SIMPLE es IRREVOCABLE durante
 * el año gravable (Art. 909 E.T.), así que el calculador se niega a recomendar
 * régimen cuando falta un insumo territorial verificado —la tarifa de ICA la
 * fija cada concejo municipal (Ley 14 de 1983, arts. 32-33) y no tiene valor
 * nacional único—. Quien consuma este hook DEBE manejar el caso sin decidir por
 * el usuario. Ver la nota de cabecera de src/lib/tax/taxCalculator.ts.
 */

import { useMemo } from 'react';
import {
  compare,
  type CompareResult,
  type RstGroup,
  type Semaforo,
} from '@/lib/tax/taxCalculator';

export interface UseTaxCalculatorOptions {
  group?: RstGroup;
  margin?: number;
  aportesPension?: number;
}

export interface UseTaxCalculatorReturn {
  result: CompareResult;
  rst: number;
  ordinario: number;
  /** `null` cuando falta un insumo territorial verificado — ver cabecera. */
  recommended: 'RST' | 'Ordinario' | null;
  /** `false` cuando `recommended` es null: la comparación no es concluyente. */
  comparable: boolean;
  savings: number;
  semaforo: Semaforo;
}

/**
 * @param annualSales Ventas anuales en COP.
 * @param opts        { group, margin, aportesPension }
 *
 * Ejemplo:
 *   const { rst, ordinario, savings, semaforo } =
 *     useTaxCalculator(97_992_000, { group: 'tiendas' });
 *   // rst ≈ 1.842.250 · ordinario ≈ 2.612.467 · savings ≈ 770.000
 *   // semaforo.level === 'verde' (97.992.000 de 183.309.000 de tope)
 */
export function useTaxCalculator(
  annualSales: number,
  opts: UseTaxCalculatorOptions = {},
): UseTaxCalculatorReturn {
  const { group, margin, aportesPension } = opts;
  return useMemo(() => {
    const result = compare(annualSales || 0, {
      group: group ?? 'tiendas',
      margin,
      aportesPension,
    });
    return {
      result,
      rst: result.rst,
      ordinario: result.ordinario,
      recommended: result.recommended,
      comparable: result.comparable,
      savings: result.savings,
      semaforo: result.semaforo,
    };
  }, [annualSales, group, margin, aportesPension]);
}

export default useTaxCalculator;
