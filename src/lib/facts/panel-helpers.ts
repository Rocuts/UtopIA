// Helpers PUROS y client-safe del panel Contexto (sin imports de DB/server).
// Dinero en MoneyCop (centavos, string), form↔input tipado, cadena de versiones.

import type { RegistrarHechoInput } from '@/lib/facts/contracts';
import type { FactDTO } from './dto';

/** Pesos (enteros; tolera separadores) → centavos MoneyCop (BigInt, sin overflow). */
export function pesosToCentavos(pesos: string): string {
  const digits = pesos.replace(/[^\d]/g, '');
  if (digits === '') return '0';
  return (BigInt(digits) * BigInt(100)).toString();
}

/** Centavos → pesos (parte entera; trunca los 2 dígitos de centavos). */
export function centavosToPesos(centavos: string): string {
  const digits = centavos.replace(/[^\d]/g, '');
  if (digits === '') return '0';
  return (BigInt(digits) / BigInt(100)).toString();
}

/** Centavos → "$50.000.000,00" (formato COP: punto miles, coma decimales). */
export function centavosToDisplay(centavos: string): string {
  const digits = centavos.replace(/[^\d]/g, '') || '0';
  const cents = BigInt(digits);
  const whole = (cents / BigInt(100)).toString();
  const frac = (cents % BigInt(100)).toString().padStart(2, '0');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `$${grouped},${frac}`;
}

/** Resumen legible de una donación, o null si no hay structured. */
export function donationSummary(
  structured: Record<string, unknown> | null,
  language: 'es' | 'en',
): string | null {
  if (!structured) return null;
  const monto = typeof structured.montoCentavos === 'string' ? structured.montoCentavos : null;
  const articulo = typeof structured.articulo === 'string' ? structured.articulo : null;
  if (!monto) return null;
  const money = centavosToDisplay(monto);
  const art = articulo ? ` · Art. ${articulo} E.T.` : '';
  return language === 'es' ? `Donación ${money}${art}` : `Donation ${money}${art}`;
}

export interface FactFormState {
  kind: 'narrative' | 'donation';
  title: string;
  body: string;
  fiscalPeriod: string;
  montoPesos: string;
  articulo: string;
}

/** Form → input tipado de la tool (mismo contrato Zod que la captura por chat). */
export function buildRegistrarInput(form: FactFormState): RegistrarHechoInput {
  const period = form.fiscalPeriod.trim() === '' ? null : form.fiscalPeriod.trim();
  if (form.kind === 'donation') {
    return {
      kind: 'donation',
      title: form.title,
      body: form.body,
      fiscalPeriod: period,
      structured: {
        montoCentavos: pesosToCentavos(form.montoPesos),
        articulo: form.articulo.trim() === '' ? '257' : form.articulo.trim(),
        fiscalYear: period ?? '',
      },
    };
  }
  return { kind: 'narrative', title: form.title, body: form.body, fiscalPeriod: period, structured: null };
}

/** Hecho → estado de form (prefill para editar). Kinds no-piloto caen a narrative. */
export function factToFormState(fact: FactDTO): FactFormState {
  const kind: 'narrative' | 'donation' = fact.kind === 'donation' ? 'donation' : 'narrative';
  const s = fact.structured ?? {};
  const monto = typeof s.montoCentavos === 'string' ? s.montoCentavos : null;
  const articulo = typeof s.articulo === 'string' ? s.articulo : '257';
  return {
    kind,
    title: fact.title,
    body: fact.body,
    fiscalPeriod: fact.fiscalPeriod ?? '',
    montoPesos: monto ? centavosToPesos(monto) : '',
    articulo,
  };
}

/**
 * Predecesores de un hecho activo, más reciente primero. La fila revocada
 * apunta con `supersededById` a la fila que la reemplazó (contrato de
 * reconcileFact), así que caminamos hacia atrás: quién tiene supersededById
 * === el id actual.
 */
export function versionHistoryFor(active: FactDTO, all: FactDTO[]): FactDTO[] {
  const chain: FactDTO[] = [];
  let currentId = active.id;
  const bySuperseded = new Map<string, FactDTO>();
  for (const f of all) {
    if (f.supersededById) bySuperseded.set(f.supersededById, f);
  }
  // Evita ciclos: limita a all.length iteraciones.
  for (let i = 0; i < all.length; i++) {
    const predecessor = bySuperseded.get(currentId);
    if (!predecessor) break;
    chain.push(predecessor);
    currentId = predecessor.id;
  }
  return chain;
}
