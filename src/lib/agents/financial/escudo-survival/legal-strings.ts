// ---------------------------------------------------------------------------
// Escudo Fiscal — Legal disclaimers (Wave 8 dictamen §6 + §7)
// ---------------------------------------------------------------------------
// Constantes textuales blindadas para defensa Art. 647 E.T. NUNCA editar sin
// re-validar con `docs/wave-notes/wave-8-capa-1-escudo-fiscal-dictamen.md`.
// Origen normativo: Arts. 26, 240 (par. 6), 254-260, 647 (par. 2) E.T. +
// Ley 2277 de 2022 + NIIF para PYMES Sección 29 + NIC 12 §80.
//
// Estas cadenas se inyectan en:
//   - Markdown del bloque (`block-builder.ts`)
//   - Exportes PDF/HTML del bloque fiscal
//   - Validator L3 que rechaza el bloque si la cadena no está presente
// El UI consume las mismas ideas vía i18n (`escudo.fiscalAnchor.disclaimer`)
// con la misma sustancia normativa.
// ---------------------------------------------------------------------------

export const LEGAL_DISCLAIMER_F02_ES = [
  'Referencia antes de depuraciones fiscales.',
  'El valor mostrado es una proyección bruta calculada como UAI × tarifa nominal (Art. 240 E.T.). NO constituye liquidación oficial del Impuesto de Renta y Complementarios. El impuesto definitivo requiere:',
  '(a) Conciliación contable → fiscal conforme al Art. 26 E.T. (depuraciones permanentes y temporales).',
  '(b) Aplicación de descuentos tributarios procedentes (Arts. 254 a 260 E.T.).',
  '(c) Verificación de la Tasa de Tributación Depurada del 15% (parágrafo 6 Art. 240 E.T., adicionado por Ley 2277 de 2022).',
  '(d) Validación del régimen tarifario aplicable (general, zona franca, ZESE, ZOMAC, hotelero, etc.).',
  'La determinación final del impuesto requiere intervención de contador público y/o revisor fiscal.',
].join('\n');

export const LEGAL_DISCLAIMER_F02_EN = [
  'Reference figures before tax adjustments.',
  'The value shown is a gross projection calculated as Pre-tax Income × nominal rate (Art. 240 Tax Statute). It does NOT constitute an official Income Tax liquidation. Final tax liability requires:',
  '(a) Book-to-tax reconciliation per Art. 26 Tax Statute (permanent and temporary adjustments).',
  '(b) Application of available tax credits (Arts. 254 to 260 Tax Statute).',
  '(c) Verification of the 15% Depurated Tax Rate (paragraph 6 Art. 240 Tax Statute, added by Law 2277 of 2022).',
  '(d) Validation of the applicable tariff regime (general, free zone, ZESE, ZOMAC, hospitality, etc.).',
  'Final tax determination requires intervention by a certified public accountant and/or statutory auditor.',
].join('\n');

// ---------------------------------------------------------------------------
// Alerta A5 — Utilidad contable sin gasto de renta (UAI > 0 ∧ Clase 54 = $0)
// Re-auditoría 2026-09 (NM-05): el texto anterior publicaba una «provisión
// estimada» (F02 = 35 % × UAI), ordenaba provisionarla y presentaba la alerta
// como evidencia de «diferencia de criterio». La UAI no es base fiscal: si hay
// impuesto por causar lo determina la depuración de la renta (Art. 26 E.T.).
// Hallazgo informativo sin cifra, alineado con CUR-R4 del curator.
// ---------------------------------------------------------------------------

export const A5_SIN_PROVISION_BODY_ES = [
  'El periodo registra una Utilidad Antes de Impuestos contable de {{UAI}} y el grupo 54 (Impuesto de Renta y Complementarios) está en $0.',
  'La utilidad contable no es base fiscal: determinar si existe impuesto de renta por causar exige la depuración de la renta líquida (Art. 26 E.T.: ingresos no gravados, costos y deducciones procedentes, rentas exentas y descuentos). El sistema no estima ese impuesto ni una brecha sin esa base.',
  'Si la depuración arroja impuesto del periodo, NIIF para las PYMES Sección 29 (NIC 12 para el Grupo 1) exige reconocer el gasto y el pasivo por impuesto corriente (Dt. 5405 / Ct. 2404).',
  'Acción recomendada: verificar con el contador si la causación de la renta está pendiente o si la entidad no es contribuyente / no tiene renta líquida gravable, y documentarlo en notas.',
].join('\n');

export const A5_SIN_PROVISION_BODY_EN = [
  'The period reports book Pre-tax Income of {{UAI}} and group 54 (Income Tax) is $0.',
  'Book profit is not the tax base: whether any income tax must be accrued depends on the reconciliation to taxable income (Art. 26 Tax Statute: non-taxable income, allowable costs and deductions, exempt income and credits). The system does not estimate that tax or a gap without that base.',
  'If the reconciliation yields tax for the period, IFRS for SMEs Section 29 (IAS 12 for Group 1) requires recognising the current tax expense and liability (Dr. 5405 / Cr. 2404).',
  'Recommended action: confirm with the accountant whether the income tax accrual is pending or the entity is not a taxpayer / has no taxable income, and disclose it in the notes.',
].join('\n');

export type LegalLanguage = 'es' | 'en';

export function legalDisclaimerF02(lang: LegalLanguage): string {
  return lang === 'en' ? LEGAL_DISCLAIMER_F02_EN : LEGAL_DISCLAIMER_F02_ES;
}

/** Texto de la alerta A5 con la UAI contable (única cifra: no hay impuesto estimado). */
export function a5SinProvisionBody(lang: LegalLanguage, vars: { uai: string }): string {
  const template = lang === 'en' ? A5_SIN_PROVISION_BODY_EN : A5_SIN_PROVISION_BODY_ES;
  return template.replaceAll('{{UAI}}', vars.uai);
}
