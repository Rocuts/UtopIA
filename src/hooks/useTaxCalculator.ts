'use client';

/**
 * useTaxCalculator — hook React sobre src/lib/tax/taxCalculator.
 *
 * Envuelve `compare()` (RST vs Ordinario + semáforo) en un useMemo.
 * Port del archivo de referencia del handoff
 * (handoff/1-1/project/handoff/useTaxCalculator.js).
 *
 * ⚠️ Las tarifas del módulo son ilustrativas — ver nota en
 * src/lib/tax/taxCalculator.ts antes de usar en producción.
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
  recommended: 'RST' | 'Ordinario';
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
      savings: result.savings,
      semaforo: result.semaforo,
    };
  }, [annualSales, group, margin, aportesPension]);
}

export default useTaxCalculator;
