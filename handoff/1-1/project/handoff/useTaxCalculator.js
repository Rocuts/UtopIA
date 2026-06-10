// ============================================================
// 1+1 · useTaxCalculator — hook React (REFERENCIA)
// Envuelve taxCalculator.js. Carga UVT/tarifas desde Supabase
// (con fallback al módulo) y devuelve { result, semaforo, loading }.
//
// ⚠️ ARCHIVO DE REFERENCIA para su repo Next.js + Supabase.
// No fue ejecutado/probado por el diseñador. Ajuste imports a su
// estructura (@/lib/...) y valide tasas con DIAN antes de producción.
// ============================================================
'use client';

import { useMemo } from 'react';
import * as TaxCalc from './taxCalculator';
// import { createClient } from '@/lib/supabase/client'; // su cliente

/**
 * @param {number} annualSales  Ventas anuales en COP
 * @param {object} [opts]        { group, margin, aportesPension }
 * @returns {{ result, semaforo, recommended, savings }}
 */
export function useTaxCalculator(annualSales, opts = {}) {
  return useMemo(() => {
    const result = TaxCalc.compare(annualSales || 0, {
      group: opts.group || 'tiendas',
      margin: opts.margin,
      aportesPension: opts.aportesPension,
    });
    return {
      result,                       // { rst, ordinario, recommended, savings, semaforo }
      rst: result.rst,
      ordinario: result.ordinario,
      recommended: result.recommended,
      savings: result.savings,
      semaforo: result.semaforo,    // { level, pct, tope, sales, message }
    };
  }, [annualSales, opts.group, opts.margin, opts.aportesPension]);
}

// Ejemplo de uso:
//
//   const { rst, ordinario, savings, semaforo } = useTaxCalculator(97_992_000, { group: 'tiendas' });
//   // rst ≈ 1.842.250 · ordinario ≈ 2.612.467 · savings ≈ 770.000
//   // semaforo.level === 'verde'  (97.992.000 de 183.309.000 de tope)
//
// Para persistir el cálculo:
//   await supabase.from('tax_calculations').insert({
//     business_id, user_id, periodo: '2026', annual_sales: annualSales,
//     rst, ordinario, recommended, savings, semaforo: semaforo.level,
//   });

export default useTaxCalculator;
