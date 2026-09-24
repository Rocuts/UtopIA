/**
 * Formulario del Agente Fiscal → `FiscalAgentStartInput` (lógica pura, sin UI).
 *
 * Cross-dep W3-B (tributario-modulos-02): el hook `useFiscalAgentSSE` ya
 * reenvía `saldoAFavorDeclaradoCents`, pero el panel no tenía dónde
 * escribirlo, así que la devolución (Módulo 6) quedaba siempre N/D. El saldo a
 * favor LIQUIDADO en la declaración de renta (Formulario 110) se teclea en
 * pesos es-CO y viaja en centavos MoneyCop; nunca se sustituye por 0 ni por
 * F04 (estimación contable).
 */

import { parseCOPToCentavos } from '@/lib/format/cop';
import type { FiscalAgentStartInput } from '@/hooks/useFiscalAgentSSE';
import type { FiscalAgentMode } from '@/lib/agents/financial/escudo-survival/fiscal-agent';

/** Modos que ejecutan el Módulo 6 (devoluciones), donde el saldo declarado se usa. */
export const MODOS_CON_DEVOLUCION: readonly FiscalAgentMode[] = ['full', 'devolucion'];

export type SaldoDeclaradoParse =
  | { ok: true; cents: string | null }
  | { ok: false };

/**
 * Pesos tecleados (es-CO: «$ 12.345.678,90», «12345678») → centavos MoneyCop.
 * Vacío → `cents: null` (no declarado). Negativo o ambiguo → inválido: el
 * formulario bloquea el envío en vez de adivinar.
 */
export function parseSaldoDeclarado(input: string): SaldoDeclaradoParse {
  if (!input.trim()) return { ok: true, cents: null };
  const cents = parseCOPToCentavos(input);
  if (cents === null || cents.startsWith('-')) return { ok: false };
  return { ok: true, cents };
}

export interface FiscalAgentFormState {
  rawData: string;
  mode: FiscalAgentMode;
  companyName: string;
  companyNit: string;
  language: 'es' | 'en';
  instructions: string;
  dianText: string;
  saldoDeclarado: string;
}

/**
 * Entrada de `start()` del hook, o `null` si el formulario no se puede enviar
 * (sin balance o con un saldo declarado inválido).
 */
export function buildFiscalAgentStartInput(form: FiscalAgentFormState): FiscalAgentStartInput | null {
  if (!form.rawData.trim()) return null;
  const usaSaldo = MODOS_CON_DEVOLUCION.includes(form.mode);
  const saldo = usaSaldo ? parseSaldoDeclarado(form.saldoDeclarado) : { ok: true as const, cents: null };
  if (!saldo.ok) return null;
  return {
    rawData: form.rawData,
    mode: form.mode,
    company: {
      name: form.companyName.trim() || undefined,
      nit: form.companyNit.trim() || undefined,
    },
    language: form.language,
    instructions: form.instructions.trim() || undefined,
    dianRequirementText: form.dianText.trim() || undefined,
    saldoAFavorDeclaradoCents: saldo.cents,
  };
}
