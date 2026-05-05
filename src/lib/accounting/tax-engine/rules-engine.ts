// ─── WS1 — Smart-Tax Engine: motor de evaluación de reglas ──────────────────
//
// Algoritmo:
//   1. Cargar reglas activas para (workspaceId, transactionDate).
//   2. Si el mismo `code` aparece en built-in Y workspace, preferir workspace.
//   3. Filtrar por transactionType (applicable_triggers.transactionTypes).
//   4. Si la regla filtra por regímenes, cargar perfil tributario del tercero.
//   5. Si la regla tiene applyThresholdUvt, comparar subtotal >= threshold*UVT.
//   6. Si la regla tiene cityCode, comparar con perfil del tercero.
//   7. Excluir taxTypes en input.excludeTaxTypes.
//   8. Devolver lista de reglas matched con su contexto de evaluación.

import type { TaxRuleRow, ThirdPartyTaxProfileRow } from '@/lib/db/schema-tax';
import type { TaxEvaluationInput } from './types';
import { uvtToCopByYear } from './constants';
import { getRules, getTaxProfile } from './repository';

// ---------------------------------------------------------------------------
// Resultado intermedio (no expuesto fuera del módulo)
// ---------------------------------------------------------------------------

export interface MatchedRule {
  rule: TaxRuleRow;
  /** Perfil del tercero si se cargó (puede ser null si no existe). */
  taxProfile: ThirdPartyTaxProfileRow | null;
  /** Warnings generados durante la evaluación de esta regla. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Evaluador principal
// ---------------------------------------------------------------------------

/**
 * Evalúa qué reglas aplican para la transacción dada.
 * Puro en lógica pero hace I/O (lecturas BD).
 * Retorna las reglas matched en el orden de prioridad (workspace antes built-in).
 */
export async function matchRules(
  input: TaxEvaluationInput,
): Promise<MatchedRule[]> {
  const transactionDate = input.transactionDate ?? new Date();
  const year = transactionDate.getFullYear();

  // ── Paso 1: cargar reglas activas ─────────────────────────────────────────
  const allRules = await getRules(input.workspaceId, transactionDate);

  // ── Paso 2: resolver precedencia workspace > built-in por `code` ──────────
  const deduped = deduplicateByCode(allRules);

  // ── Paso 3: cargar perfil del tercero (si aplica) ─────────────────────────
  // Hacemos una sola consulta aunque múltiples reglas puedan necesitarla.
  let taxProfile: ThirdPartyTaxProfileRow | null = null;
  let profileLoaded = false;

  async function ensureProfile(): Promise<ThirdPartyTaxProfileRow | null> {
    if (profileLoaded) return taxProfile;
    profileLoaded = true;
    if (input.thirdPartyId) {
      taxProfile = await getTaxProfile(input.workspaceId, input.thirdPartyId);
    }
    return taxProfile;
  }

  // ── Pasos 4-7: aplicar filtros por regla ──────────────────────────────────
  const matched: MatchedRule[] = [];

  for (const rule of deduped) {
    const warnings: string[] = [];
    const triggers = rule.applicableTriggers ?? {};

    // Filtro 4a: transactionType
    if (
      triggers.transactionTypes &&
      triggers.transactionTypes.length > 0 &&
      !triggers.transactionTypes.includes(input.transactionType)
    ) {
      continue;
    }

    // Filtro 4b: excludeTaxTypes
    if (input.excludeTaxTypes?.includes(rule.taxType)) {
      continue;
    }

    // Filtro 4c: regímenes del proveedor/cliente
    if (
      (triggers.supplierRegimes && triggers.supplierRegimes.length > 0) ||
      (triggers.customerRegimes && triggers.customerRegimes.length > 0)
    ) {
      const profile = await ensureProfile();
      if (!profile) {
        // Sin perfil → asumimos regimen_comun para no retener en exceso
        // (comportamiento conservador). Emitimos warning.
        warnings.push(
          'Tercero sin perfil tributario registrado. Se asume régimen común ' +
            'no autorretenedor para esta evaluación.',
        );
        // Si la regla requiere que el proveedor sea de un régimen específico
        // que excluya a "regimen_comun", la saltamos.
        // Caso RTF: regimes que NO deben retener incluye gran_contribuyente y
        // autorretenedor. Sin perfil, asumimos que SÍ debemos retener.
        if (triggers.supplierRegimes) {
          // Regla aplica si regimen_comun está en la lista de triggers
          const coversComun = triggers.supplierRegimes.includes('regimen_comun');
          if (!coversComun) {
            // La regla solo aplica a regímenes específicos que no incluyen
            // el asumido — saltar con warning documentado.
            continue;
          }
        }
      } else {
        // Verificar régimen del proveedor
        if (triggers.supplierRegimes && triggers.supplierRegimes.length > 0) {
          const profileRegimes: string[] = [profile.regime];
          if (profile.isGranContribuyente) profileRegimes.push('gran_contribuyente');
          if (profile.isAutorretenedor) profileRegimes.push('autorretenedor');
          if (profile.isRegimenSimple) profileRegimes.push('regimen_simple');
          if (!profile.isResponsableIva) profileRegimes.push('no_responsable_iva');

          const matches = triggers.supplierRegimes.some((r) =>
            profileRegimes.includes(r),
          );
          if (!matches) continue;
        }
        if (triggers.customerRegimes && triggers.customerRegimes.length > 0) {
          const profileRegimes: string[] = [profile.regime];
          const matches = triggers.customerRegimes.some((r) =>
            profileRegimes.includes(r),
          );
          if (!matches) continue;
        }
      }
    }

    // Filtro 4d: cityCode (ICA municipal)
    if (triggers.cityCode) {
      const profile = await ensureProfile();
      if (!profile || profile.cityCode !== triggers.cityCode) {
        // Si no sabemos la ciudad del tercero, no aplicamos ICA municipal.
        if (!profile) {
          warnings.push(
            `Regla ICA (${rule.code}) no aplicada: tercero sin perfil tributario ` +
              `(no se pudo confirmar ciudad ${triggers.cityCode}).`,
          );
        }
        continue;
      }
    }

    // Filtro 5: umbral mínimo en UVT (Art. 401 ET)
    if (rule.applyThresholdUvt) {
      const thresholdUvt = parseFloat(rule.applyThresholdUvt);
      const thresholdCop = uvtToCopByYear(thresholdUvt, year);
      const subtotal = parseFloat(input.subtotalCop);
      if (subtotal < thresholdCop) {
        // No supera el mínimo — no aplica retención.
        continue;
      }
    }

    // Filtro 5b: umbral en COP directo
    if (rule.applyThresholdCop) {
      const thresholdCop = parseFloat(rule.applyThresholdCop);
      const subtotal = parseFloat(input.subtotalCop);
      if (subtotal < thresholdCop) {
        continue;
      }
    }

    // La regla pasó todos los filtros.
    matched.push({
      rule,
      taxProfile: profileLoaded ? taxProfile : null,
      warnings,
    });
  }

  return matched;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Dado un listado de reglas (built-in + workspace mezcladas), elimina duplicados
 * de `code` prefiriendo la del workspace (workspaceId != null) sobre la built-in.
 */
function deduplicateByCode(rules: TaxRuleRow[]): TaxRuleRow[] {
  const map = new Map<string, TaxRuleRow>();
  for (const rule of rules) {
    const existing = map.get(rule.code);
    if (!existing) {
      map.set(rule.code, rule);
    } else {
      // Preferir la del workspace si la actual no es built-in
      if (rule.workspaceId !== null && existing.workspaceId === null) {
        map.set(rule.code, rule);
      }
    }
  }
  return Array.from(map.values());
}
