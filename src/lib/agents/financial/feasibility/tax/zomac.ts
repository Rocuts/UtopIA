// ---------------------------------------------------------------------------
// Régimen ZOMAC — tarifa por año gravable y tamaño (valoracion-17)
// ---------------------------------------------------------------------------
// Fuente (corpus local src/data/tax_docs/ley_1819_2016.md, compilación con
// notas de vigencia hasta la Ley 2478/2025 — sin modificación del Art. 237):
//
//   Art. 237 lit. a) micro y pequeñas empresas: 2017-2021 0%; 2022-2024 25%
//     de la tarifa general; 2025-2027 50%; en adelante tarifa general.
//   Art. 237 lit. b) medianas y grandes: 2017-2021 50%; 2022-2027 75%; en
//     adelante tarifa general.
//   Art. 236: tamaño por ACTIVOS TOTALES en SMMLV — micro ≤ 501; pequeña
//     > 501 y < 5.001; mediana > 5.001 y < 15.000; grande ≥ 15.000 (definición
//     propia del régimen, distinta del Decreto 957/2019).
//   Art. 236 num. 5: nuevas sociedades = inicio de actividad (registro
//     mercantil) a partir de la promulgación de la Ley 1819 (29-dic-2016).
//   Art. 236 par. 1: excluye minería e hidrocarburos por concesión y grandes
//     contribuyentes portuarios por concesión.
//   Reglamentación: DUR 1625/2016, Sección 1.2.1.23.1 (inversión y empleo).
//
// Tarifa general: 35% (Art. 240 E.T., Ley 2277/2022) — se modela sólo para
// años gravables ≥ 2023; años anteriores → N/D. No hay prórroga posterior a
// 2027 en el corpus: desde 2028 tarifa general.
// ---------------------------------------------------------------------------

export type CompanySize = 'micro' | 'pequena' | 'mediana' | 'grande';

export const GENERAL_CORPORATE_RATE_PERCENT = 35;
const FIRST_MODELED_TAX_YEAR = 2023;

/** Fracción de la tarifa general aplicable (0..1); null si el año no se modela. */
export function zomacFractionOfGeneralRate(taxYear: number, size: CompanySize): number | null {
  if (!Number.isInteger(taxYear) || taxYear < FIRST_MODELED_TAX_YEAR) return null;
  const small = size === 'micro' || size === 'pequena';
  if (taxYear >= 2028) return 1;
  if (small) return taxYear <= 2024 ? 0.25 : 0.5;
  return 0.75;
}

export interface ZomacScheduleRow {
  projectYear: number;
  taxYear: number;
  fractionOfGeneral: number | null;
  ratePercent: number | null;
}

export function buildZomacSchedule(size: CompanySize, startYear: number, horizon: number): ZomacScheduleRow[] {
  const rows: ZomacScheduleRow[] = [];
  for (let t = 1; t <= horizon; t++) {
    const taxYear = startYear + t - 1;
    const fraction = zomacFractionOfGeneralRate(taxYear, size);
    rows.push({
      projectYear: t,
      taxYear,
      fractionOfGeneral: fraction,
      ratePercent: fraction === null ? null : Math.round(fraction * GENERAL_CORPORATE_RATE_PERCENT * 100) / 100,
    });
  }
  return rows;
}

const SIZE_LABEL: Record<CompanySize, string> = {
  micro: 'microempresa',
  pequena: 'pequeña empresa',
  mediana: 'mediana empresa',
  grande: 'gran empresa',
};

const pctEs = (v: number) => `${v.toLocaleString('es-CO', { maximumFractionDigits: 2 })}%`;

/**
 * Bloque de contexto ZOMAC para el prompt del Modelador Financiero. `now`
 * fija el año de evaluación (inyectable en pruebas).
 */
export function buildZomacContextBlock(
  opts: { size?: CompanySize; startYear?: number; horizon: number },
  now: Date = new Date(),
): string {
  const evaluationYear = now.getFullYear();
  const startDeclared = typeof opts.startYear === 'number' && Number.isInteger(opts.startYear);
  const startYear = startDeclared ? (opts.startYear as number) : evaluationYear + 1;
  const startLine = startDeclared
    ? `- Año 1 del proyecto = año gravable ${startYear} (declarado).`
    : `- Año 1 del proyecto = año gravable ${startYear} (SUPUESTO: año siguiente a la evaluación ${evaluationYear}; decláralo en los supuestos — si el inicio es posterior, el beneficio disminuye).`;

  const lines = [
    'Incentivo ZOMAC declarado (Art. 237 Ley 1819/2016; DUR 1625/2016, Sección 1.2.1.23.1):',
    '- La tarifa se fija por AÑO GRAVABLE CALENDARIO y por tamaño de la sociedad, no por años del proyecto.',
    '- Tamaño para este régimen (Art. 236 Ley 1819/2016, activos totales): micro ≤ 501 SMMLV; pequeña > 501 y < 5.001 SMMLV; mediana > 5.001 y < 15.000 SMMLV; grande ≥ 15.000 SMMLV.',
    `- Micro y pequeñas: 2025-2027 = 50% de la tarifa general (${pctEs(0.5 * GENERAL_CORPORATE_RATE_PERCENT)}); desde 2028 tarifa general (${pctEs(GENERAL_CORPORATE_RATE_PERCENT)}).`,
    `- Medianas y grandes: 2022-2027 = 75% de la tarifa general (${pctEs(0.75 * GENERAL_CORPORATE_RATE_PERCENT)}); desde 2028 tarifa general (${pctEs(GENERAL_CORPORATE_RATE_PERCENT)}).`,
    '- El corpus normativo no registra prórroga del régimen después de 2027: desde el año gravable 2028 aplica la tarifa general.',
    startLine,
  ];

  if (!opts.size) {
    lines.push(
      '- Tamaño según Art. 236 NO informado: tarifa ZOMAC N/D. Usa la tarifa general (35%) en todos los años (supuesto conservador) y declara que el beneficio depende de acreditar el tamaño por activos.',
    );
  } else {
    const schedule = buildZomacSchedule(opts.size, startYear, opts.horizon);
    lines.push(
      `- Tabla aplicable (${SIZE_LABEL[opts.size]} — verificar con activos totales, Art. 236):`,
      '  | Año proyecto | Año gravable | % de la tarifa general | Tarifa renta |',
      '  |---|---|---|---|',
      ...schedule.map((r) =>
        `  | ${r.projectYear} | ${r.taxYear} | ${r.fractionOfGeneral === null ? 'N/D' : pctEs(r.fractionOfGeneral * 100)} | ${r.ratePercent === null ? 'N/D' : pctEs(r.ratePercent)} |`,
      ),
    );
  }

  lines.push(
    '- Requisitos a verificar antes de aplicar la tarifa reducida: nueva sociedad (inscripción en el registro mercantil a partir del 29-dic-2016, Art. 236 num. 5); domicilio principal y TODA la actividad económica en municipios ZOMAC; montos mínimos de inversión y de generación de empleo definidos por el Gobierno nacional (DUR 1625/2016, Sección 1.2.1.23.1); exclusiones del par. 1 del Art. 236 (minería e hidrocarburos por concesión; grandes contribuyentes portuarios por concesión).',
    '- Riesgos: seguridad, infraestructura limitada, mano de obra calificada.',
  );
  return lines.join('\n');
}
