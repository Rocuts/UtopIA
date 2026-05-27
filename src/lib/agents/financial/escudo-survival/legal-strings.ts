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
// Alerta A5 — Impuesto sin provisionar (UAI > 0 ∧ Clase 54 = $0)
// Fundamento doble: NIIF PYMES §29.4 + Art. 647 E.T.
// Crea trazabilidad para invocar doctrina de "diferencia de criterio" (par. 2
// Art. 647) cuando el contribuyente decide informadamente no provisionar.
// ---------------------------------------------------------------------------

export const A5_SIN_PROVISION_BODY_ES = [
  'Detectamos que su empresa registra Utilidad Antes de Impuestos por {{UAI}} pero el saldo de la Clase 54 (Impuesto de Renta y Complementarios) es $0.',
  'Bajo NIIF para PYMES Sección 29.4 (o NIC 12 §80 para Grupo 1) la empresa está obligada a reconocer un pasivo por impuesto corriente equivalente al impuesto causado del período.',
  'Provisión estimada (referencia): {{PROVISION}}',
  'Riesgo si se omite: observación material en revisoría fiscal (NIA 700), sanción por inexactitud del 100% del impuesto omitido (Art. 647 E.T.) si la declaración refleja la omisión, y posible sanción al contador firmante (Art. 658-1 E.T.).',
  'Acción recomendada: provisionar el impuesto causado antes del cierre del período (Dt. Cta. 5405 / Ct. Cta. 2404 o 2408) conforme NIIF Sección 29 / NIC 12.',
  'Esta alerta queda registrada en su módulo Defensa DIAN como evidencia de advertencia preventiva (doctrina de diferencia de criterio, par. 2 Art. 647 E.T.).',
].join('\n');

export const A5_SIN_PROVISION_BODY_EN = [
  'We detected that your company reports Pre-tax Income of {{UAI}} but the Class 54 balance (Income Tax) is $0.',
  'Under IFRS for SMEs Section 29.4 (or IAS 12 §80 for Group 1) the entity is required to recognize a current tax liability equal to the period’s tax expense.',
  'Estimated provision (reference): {{PROVISION}}',
  'Risk if omitted: material observation in statutory audit (ISA 700), 100% inaccuracy penalty on the omitted tax (Art. 647 Tax Statute) if the tax return reflects the omission, and possible sanction on the signing accountant (Art. 658-1 Tax Statute).',
  'Recommended action: book the current tax expense before period close (Dr. Acct. 5405 / Cr. Acct. 2404 or 2408) per IFRS Section 29 / IAS 12.',
  'This alert is logged in your DIAN Defense module as evidence of preventive warning (criterion-difference doctrine, par. 2 Art. 647 Tax Statute).',
].join('\n');

export type LegalLanguage = 'es' | 'en';

export function legalDisclaimerF02(lang: LegalLanguage): string {
  return lang === 'en' ? LEGAL_DISCLAIMER_F02_EN : LEGAL_DISCLAIMER_F02_ES;
}

export function a5SinProvisionBody(
  lang: LegalLanguage,
  vars: { uai: string; provision: string },
): string {
  const template = lang === 'en' ? A5_SIN_PROVISION_BODY_EN : A5_SIN_PROVISION_BODY_ES;
  return template
    .replaceAll('{{UAI}}', vars.uai)
    .replaceAll('{{PROVISION}}', vars.provision);
}
