/**
 * Validación pura del intake NIIF.
 *
 * POR QUÉ existe este módulo: la resolución de `rawData` y la lista de campos
 * requeridos vivían duplicadas dentro del componente — `handleSubmit` calculaba
 * `resolvedRawData` por un camino y el wizard decidía `isValid` por otro. Ese
 * desfase permitía terminar los 4 pasos sin ningún dato contable y reventar al
 * final con HTTP 400 (`financialReportRequestSchema.rawData` exige `min(1)`).
 * Al unificar aquí, la vista previa y el submit comparten una sola verdad y el
 * bloqueo aparece en el paso donde el usuario todavía puede corregirlo.
 */

import type { NiifReportIntake } from '@/types/platform';

/** Etiqueta del balance en la lista de faltantes (compartida con el banner). */
export const RAW_DATA_LABEL = 'Balance de prueba / datos contables';

/**
 * Datos contables efectivos de la corrida: gana lo extraído por OCR y, si no
 * hubo extracción (ruta "Llenar manualmente"), lo que el usuario pegó a mano.
 */
export function resolveNiifRawData(
  extractedRawText: string | null | undefined,
  typedRawData: string | null | undefined,
): string {
  return (extractedRawText || typedRawData || '').trim();
}

type RequiredSubset = Pick<NiifReportIntake, 'company' | 'fiscalPeriod' | 'niifGroup'>;

/**
 * Campos bloqueantes del paso "Revisar". Incluye el balance porque sin él el
 * pipeline NIIF no arranca: el backend lo rechaza antes de llamar a ningún
 * agente, y hasta ahora ese rechazo llegaba después de 4 pasos de trabajo.
 */
export function collectMissingRequired(
  values: RequiredSubset,
  resolvedRawData: string,
): string[] {
  const missing: string[] = [];
  if (!values.company?.name?.trim()) missing.push('Razón Social');
  if (!values.company?.nit?.trim()) missing.push('NIT');
  if (!values.fiscalPeriod) missing.push('Periodo Fiscal');
  if (!values.niifGroup) missing.push('Grupo NIIF');
  if (!resolvedRawData) missing.push(RAW_DATA_LABEL);
  return missing;
}

/** El paso "Revisar" solo deja avanzar cuando no queda ningún bloqueante. */
export function isReviewStepValid(
  values: RequiredSubset,
  resolvedRawData: string,
): boolean {
  return collectMissingRequired(values, resolvedRawData).length === 0;
}
