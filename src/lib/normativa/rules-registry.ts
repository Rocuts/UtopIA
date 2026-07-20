// Registro normativo versionado (Rules as Code) — FUENTE ÚNICA DE VERDAD
// determinista para cálculos estructurados. Versionado por git: el propio
// historial del repo ES el audit trail de definiciones.
//
// Actualización manual: ante una reforma se AGREGA una versión nueva con
// `vigencia.desde` y se cierra la anterior con `vigencia.hasta`. NUNCA se
// edita una versión en su lugar (rompería la reconstrucción histórica).
//
// El binding es uni-temporal (eje vigencia). El eje "tiempo de conocimiento"
// lo aporta fact_decision_records (auditabilidad bitemporal sin store bitemporal).

export interface NormativeRuleVersion {
  vigencia: { desde: string; hasta: string | null }; // ISO date; hasta null = abierta
  version: string;
  params: Record<string, unknown>;
  fuente: string;
  revisadoPara: string; // año para el que se verificó vigencia por última vez
}

export const RULES_REGISTRY: Record<string, NormativeRuleVersion[]> = {
  descuento_donaciones_257: [
    {
      vigencia: { desde: '2023-01-01', hasta: null },
      version: '2023',
      params: { articulo: '257 E.T.', limitePctImpuesto: 25, uvt2026: 52374 },
      fuente: 'Estatuto Tributario Art. 257 (descuento por donaciones).',
      revisadoPara: '2026',
    },
  ],
};

/**
 * ¿El `fiscalPeriod` (año 'YYYY') está VIGENTE para esta versión? Resolución por
 * SUPERSESSION (vigencia abierta): una versión rige desde `vigencia.desde` y sigue
 * vigente indefinidamente hasta que un `vigencia.hasta` explícito la cierre o una
 * versión más nueva la sustituya. Con `hasta: null` la regla aplica para cualquier
 * año >= desde (incluye años futuros). `revisadoPara` es METADATA ASESORA (freshness
 * para tooling/avisos futuros) — NO acota la resolución. El FAIL-LOUD lo dispara sólo
 * un período ANTERIOR a todo `desde` o una ruleKey desconocida (ver resolveRule).
 */
function periodEnVigencia(period: string, v: NormativeRuleVersion): boolean {
  const year = Number.parseInt(period, 10);
  const desdeYear = Number.parseInt(v.vigencia.desde.slice(0, 4), 10);
  const hastaYear = v.vigencia.hasta ? Number.parseInt(v.vigencia.hasta.slice(0, 4), 10) : null;
  return year >= desdeYear && (hastaYear === null || year <= hastaYear);
}

/**
 * Resuelve la versión de regla vigente para un período fiscal. FAIL-LOUD: si
 * la ruleKey no existe o no hay versión vigente para el período, LANZA — nunca
 * cae silenciosamente a una regla vieja (esto es lo que impide la deriva).
 */
export function resolveRule(
  ruleKey: string,
  fiscalPeriod: string,
  registry: Record<string, NormativeRuleVersion[]> = RULES_REGISTRY,
): NormativeRuleVersion {
  const versions = registry[ruleKey];
  if (!versions) {
    throw new Error(
      `Regla normativa desconocida: "${ruleKey}" (ver src/lib/normativa/rules-registry.ts).`,
    );
  }
  const matches = versions.filter((v) => periodEnVigencia(fiscalPeriod, v));
  if (matches.length === 0) {
    throw new Error(
      `No hay regla vigente de "${ruleKey}" para el período ${fiscalPeriod} — actualiza el registro normativo (src/lib/normativa/rules-registry.ts).`,
    );
  }
  // Newest-wins: ante solapamientos (un mantenedor agrega una versión más nueva
  // sin cerrar el `hasta` de la anterior) gana la de mayor `desde`. Robusto al
  // orden del array. Comparación lexicográfica de ISO 'YYYY-MM-DD' == cronológica.
  return matches.reduce((a, b) => (b.vigencia.desde > a.vigencia.desde ? b : a));
}
