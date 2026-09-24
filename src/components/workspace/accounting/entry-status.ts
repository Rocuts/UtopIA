/**
 * Estado que se MUESTRA para un asiento.
 *
 * Auditoría 2026-09 (contab-nomina-01): el reverso ya no cambia el estado del
 * original a 'reversed'; el original queda `status = 'posted'` con
 * `reversedByEntryId` apuntando al asiento de reverso (así ambos netean en el
 * mayor). La UI debe derivar el rótulo «Reversado» de `reversedByEntryId`;
 * mirar sólo `status === 'reversed'` dejaba de mostrar el badge.
 */

export type EntryStatus = 'draft' | 'posted' | 'reversed' | 'voided';

export interface EntryStatusSource {
  status: EntryStatus;
  reversedByEntryId?: string | null;
}

export function displayEntryStatus(entry: EntryStatusSource): EntryStatus {
  if (entry.reversedByEntryId != null && entry.reversedByEntryId !== '') return 'reversed';
  return entry.status;
}
