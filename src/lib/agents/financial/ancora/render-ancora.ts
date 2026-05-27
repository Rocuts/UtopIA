// ---------------------------------------------------------------------------
// Bloque Âncora — renderer markdown para inyección en prompts downstream
// ---------------------------------------------------------------------------
// Emite el bloque visual con delimitadores ═══ que los agentes 2 (Strategy),
// 3 (Governance) y Escudo citan literalmente en sus prompts.
//
// Formato: todas las cifras se muestran en formato colombiano $X.XXX.XXX,XX
// (NO centavos) — cumple Regla 3 de las Reglas Absolutas del Agente 1. Los
// centavos string del schema NiifAncora se dividen por 100 al renderizar.
// ---------------------------------------------------------------------------

import type { NiifAncora } from './types';

/**
 * Formatea centavos string a pesos colombianos con 2 decimales.
 * Ej. "150000000" → "$1.500.000,00". Negativos → "-$X,XX".
 */
function fmtCop(cents: string): string {
  const big = BigInt(cents);
  const negative = big < BigInt(0);
  const abs = negative ? -big : big;
  const pesos = Number(abs) / 100;
  const formatted = pesos.toLocaleString('es-CO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${negative ? '-' : ''}$${formatted}`;
}

/**
 * Renderiza el Bloque Âncora completo en formato markdown con delimitadores
 * visuales. Listo para inyectar en el `<context>` de prompts downstream.
 *
 * Lenguaje: español (Colombia) — el Âncora es contexto fiscal colombiano
 * por construcción; no se traduce.
 */
export function renderNiifAncoraBlock(ancora: NiifAncora): string {
  const { ccvNiif: a, ccvFiscal: f, checks: c, periodos, nitDigito } = ancora;
  const periodoActual = periodos.actual;
  const periodoComp = periodos.comparativo ?? 'n/d';

  return [
    '═══════════════════════════════════════════════════',
    'BLOQUE ÂNCORA — AGENTES 2, 3 Y EL ESCUDO',
    `Periodo actual: ${periodoActual} | comparativo: ${periodoComp}`,
    '═══════════════════════════════════════════════════',
    '',
    '## CCV NIIF (cifras vinculantes contables)',
    `A01 (Total Activo ${periodoActual})         = ${fmtCop(a.A01)}`,
    `A02 (Total Activo ${periodoComp})           = ${fmtCop(a.A02)}`,
    `A03 (Total Pasivo ${periodoActual})         = ${fmtCop(a.A03)}`,
    `A04 (Total Pasivo ${periodoComp})           = ${fmtCop(a.A04)}`,
    `A05 (Patrimonio ${periodoActual})           = ${fmtCop(a.A05)}`,
    `A06 (Patrimonio ${periodoComp})             = ${fmtCop(a.A06)}`,
    `A07 (Ingresos ${periodoActual})             = ${fmtCop(a.A07)}`,
    `A08 (Ingresos ${periodoComp})               = ${fmtCop(a.A08)}`,
    `A09 (Ganancia Operacional ${periodoActual}) = ${fmtCop(a.A09)}`,
    `A10 (Ganancia Operacional ${periodoComp})   = ${fmtCop(a.A10)}`,
    `A11 (Utilidad Neta ${periodoActual})        = ${fmtCop(a.A11)}`,
    `A12 (Utilidad Neta ${periodoComp})          = ${fmtCop(a.A12)}`,
    `A13 (Efectivo ${periodoActual})             = ${fmtCop(a.A13)}`,
    `A14 (Efectivo ${periodoComp})               = ${fmtCop(a.A14)}`,
    `A15 (Pasivo Corriente ${periodoActual})     = ${fmtCop(a.A15)}`,
    `A16 (Inventarios ${periodoActual})          = ${fmtCop(a.A16)}`,
    `A17 (Cartera ${periodoActual})              = ${fmtCop(a.A17)}`,
    `A18 (Proveedores ${periodoActual})          = ${fmtCop(a.A18)}`,
    `A19 (Flujo de Caja ${periodoActual})        = ${fmtCop(a.A19)}`,
    `X01 (Ganancia Bruta ${periodoActual})       = ${fmtCop(a.X01)}`,
    `X02 (Ganancia Bruta ${periodoComp})         = ${fmtCop(a.X02)}`,
    `X03 (Activo Corriente ${periodoActual})     = ${fmtCop(a.X03)}`,
    `X04 (Activo No Corriente ${periodoActual})  = ${fmtCop(a.X04)}`,
    '─────────────────────────────────────────────────',
    '',
    '## CCV Fiscal (cifras vinculantes tributarias)',
    `F01 (UAI = utilidad antes de impuesto)      = ${fmtCop(f.F01)}`,
    `F02 (Impuesto referencial 35% Art.240 ET)   = ${fmtCop(f.F02)}`,
    `F03 (Retenciones a favor — Cta.1355+1805)   = ${fmtCop(f.F03)}`,
    `F04 (Saldo neto a pagar = F02 − F03)        = ${fmtCop(f.F04)}`,
    `F05 (IVA neto — |Cta.2408|)                 = ${fmtCop(f.F05)}`,
    `F06 (Retención por declarar — |Cta.2365|)   = ${fmtCop(f.F06)}`,
    `F07 (ICA — |Cta.2368|)                      = ${fmtCop(f.F07)}`,
    `F08 (Total pasivos fiscales — |Cta.24|)     = ${fmtCop(f.F08)}`,
    `F09 (Tasa efectiva del impuesto)            = ${f.F09}%`,
    `F10 (Eficiencia fiscal = F03/F02 × 100)     = ${f.F10}%`,
    '─────────────────────────────────────────────────',
    '',
    '## Verificaciones determinísticas',
    `CHECK A = P + C ${periodoActual}: diferencia ${fmtCop(c.patrimonioDelta2025)}`,
    `CHECK A = P + C ${periodoComp}:   diferencia ${fmtCop(c.patrimonioDelta2024)}`,
    `CHECK EFE: A14 + A19 == A13 → ${c.efeReconcilia.toUpperCase()}`,
    `CHECK A5 (brecha impuesto contable vs teórico): ${c.alertaA5}`,
    `CHECK DEV (devoluciones materiales > 1% ingresos): ${c.alertaDev}`,
    `NIT_digito (calendario DIAN) = ${nitDigito}`,
    '═══════════════════════════════════════════════════',
  ].join('\n');
}

/**
 * Renderiza una versión compacta del Âncora (1 línea por sub-bloque) para
 * usos donde el bloque visual completo es demasiado verboso (e.g. SSE event
 * payload preview, telemetría).
 */
export function renderNiifAncoraInline(ancora: NiifAncora): string {
  const { ccvNiif: a, ccvFiscal: f } = ancora;
  return [
    `A01=${a.A01} A03=${a.A03} A05=${a.A05} A07=${a.A07} A11=${a.A11} A13=${a.A13}`,
    `F01=${f.F01} F02=${f.F02} F03=${f.F03} F04=${f.F04} F09=${f.F09}% F10=${f.F10}%`,
  ].join(' | ');
}
