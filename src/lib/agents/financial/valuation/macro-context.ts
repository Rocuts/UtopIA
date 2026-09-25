// ---------------------------------------------------------------------------
// Bloque <macro_vigente> para los prompts de Valoración y Factibilidad
// ---------------------------------------------------------------------------
// valoracion-18: los prompts fijaban rangos macro sin fecha ni fuente (TES
// 12-13%, EMBI 2-3%, TRM 4.200-4.500, IBR 9-10%, inflación 5-6%) presentados
// como "vigentes 2026". Este módulo reemplaza esas constantes por un bloque
// dinámico: cada parámetro lleva valor, fecha de vigencia y fuente, o N/D.
//
// Quién lo alimenta: el llamador (ruta API / orquestador) con datos que
// tengan procedencia por campo. Mientras el servicio macro no la exponga
// (valoracion-04, fuera de este paquete) el bloque sale en N/D y el agente
// debe declarar cualquier valor que use como SUPUESTO con fuente y fecha.
// ---------------------------------------------------------------------------

export interface MacroDatum {
  /** Valor numérico en la unidad del campo (porcentaje, pb o COP/USD). */
  value: number;
  /** Fecha de vigencia del dato (no la de consulta), p. ej. "2026-08-31". */
  asOf: string;
  /** Fuente, p. ej. "Banco de la República — serie TES 10Y". */
  source: string;
}

export interface MacroSnapshot {
  tes10yCopPercent?: MacroDatum | null;
  sovereignDefaultSpreadPercent?: MacroDatum | null;
  embiColombiaBps?: MacroDatum | null;
  matureEquityRiskPremiumPercent?: MacroDatum | null;
  ust10yPercent?: MacroDatum | null;
  inflationCopYoYPercent?: MacroDatum | null;
  inflationUsdYoYPercent?: MacroDatum | null;
  policyRatePercent?: MacroDatum | null;
  ibrOvernightPercent?: MacroDatum | null;
  trmCopPerUsd?: MacroDatum | null;
}

const FIELDS: Array<{ key: keyof MacroSnapshot; label: string; unit: '%' | 'pb' | 'COP/USD' }> = [
  { key: 'tes10yCopPercent', label: 'TES 10Y COP (rendimiento bruto)', unit: '%' },
  { key: 'sovereignDefaultSpreadPercent', label: 'Diferencial de incumplimiento soberano Colombia', unit: '%' },
  { key: 'embiColombiaBps', label: 'EMBI Colombia', unit: 'pb' },
  { key: 'matureEquityRiskPremiumPercent', label: 'Prima de riesgo de mercado maduro (ERP)', unit: '%' },
  { key: 'ust10yPercent', label: 'UST 10Y (USD)', unit: '%' },
  { key: 'inflationCopYoYPercent', label: 'Inflación anual Colombia (IPC)', unit: '%' },
  { key: 'inflationUsdYoYPercent', label: 'Inflación anual EE. UU.', unit: '%' },
  { key: 'policyRatePercent', label: 'Tasa de política monetaria BanRep', unit: '%' },
  { key: 'ibrOvernightPercent', label: 'IBR overnight', unit: '%' },
  { key: 'trmCopPerUsd', label: 'TRM', unit: 'COP/USD' },
];

function isValidDatum(d: MacroDatum | null | undefined): d is MacroDatum {
  return (
    !!d &&
    Number.isFinite(d.value) &&
    typeof d.asOf === 'string' &&
    d.asOf.trim().length > 0 &&
    typeof d.source === 'string' &&
    d.source.trim().length > 0
  );
}

function formatValue(value: number, unit: '%' | 'pb' | 'COP/USD'): string {
  if (unit === 'COP/USD') {
    return `$${value.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP/USD`;
  }
  if (unit === 'pb') return `${value.toLocaleString('es-CO', { maximumFractionDigits: 0 })} pb`;
  return `${value.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/**
 * Bloque dinámico para el `<context>` del prompt. Un dato sin valor, fecha de
 * vigencia o fuente se publica como N/D — nunca como constante "vigente".
 */
export function buildMacroVigenteBlock(snapshot: MacroSnapshot | null | undefined): string {
  const lines = FIELDS.map(({ key, label, unit }) => {
    const d = snapshot?.[key];
    if (!isValidDatum(d)) return `- ${label}: N/D (sin dato verificado con fecha de vigencia y fuente)`;
    return `- ${label}: ${formatValue(d.value, unit)} (vigencia ${d.asOf}; fuente: ${d.source})`;
  });
  return ['<macro_vigente>', ...lines, '</macro_vigente>'].join('\n');
}
