// ─── WS1 — Smart-Tax Engine: motor de evaluación de reglas ──────────────────
//
// Algoritmo:
//   1. Cargar reglas activas para (workspaceId, transactionDate).
//   2. Si el mismo `code` aparece en built-in Y workspace, preferir workspace.
//   3. Filtrar por transactionType (applicable_triggers.transactionTypes).
//   4. Filtrar por `requiresTreatments` (calificaciones declaradas por el caller).
//   5. Si la regla filtra por regímenes, cargar perfil tributario del tercero:
//      5a. `excludeSupplierRegimes` — sujetos NO sometidos a retención
//          (Art. 369 E.T., Art. 911 E.T., autorretenedores). GANA sobre 5b.
//      5b. `supplierRegimes` / `customerRegimes` — activación inclusiva.
//      5c. `verifySupplierRegimes` — no excluye pero exige verificación manual.
//   6. Si la regla tiene applyThresholdUvt / Cop, comparar contra el subtotal.
//   7. Si la regla tiene cityCode, comparar con perfil del tercero.
//   8. Excluir taxTypes en input.excludeTaxTypes.
//   9. Resolver EXCLUSIÓN MUTUA por (taxType, exclusionGroup): una operación se
//      grava con UNA sola tarifa. Gana la especificidad mayor; en empate no
//      gana ninguna y las empatadas quedan marcadas `ambiguous` para que el
//      generador de líneas NO las contabilice y lo reporte.
//  10. Devolver lista de reglas matched con su contexto de evaluación.

import type { TaxRuleRow, ThirdPartyTaxProfileRow } from '@/lib/db/schema-tax';
import type { TaxEvaluationInput } from './types';
import { readTriggers } from './types';
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
  /**
   * true = empató en especificidad con otra regla de su mismo grupo de
   * exclusión mutua. La regla NO debe contabilizarse: el generador de líneas
   * emite la propuesta con confianza 0 y sin `JournalLineInput`, para que el
   * conflicto sea visible en lugar de resolverse arbitrariamente. Un dictamen
   * que el cliente firma ante la DIAN no puede llevar una tarifa elegida al azar.
   */
  ambiguous?: boolean;
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

  const declaredTreatments = new Set(input.taxTreatments ?? []);

  for (const rule of deduped) {
    const warnings: string[] = [];
    const triggers = readTriggers(rule);

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

    // Filtro 4b-bis: calificaciones declaradas por el caller.
    // Sin la etiqueta, la regla no entra. Esto es lo que impide que una compra
    // dispare a la vez IVA 19% (Art. 468), IVA 5% (Art. 468-1) e IVA exento
    // (Art. 477): el motor no puede saber si el bien está en la lista taxativa,
    // así que las tarifas diferenciales sólo entran cuando alguien las afirma.
    if (
      triggers.requiresTreatments &&
      triggers.requiresTreatments.length > 0 &&
      !triggers.requiresTreatments.every((t) => declaredTreatments.has(t))
    ) {
      continue;
    }

    // Filtro 4c: regímenes del proveedor/cliente
    const needsProfile =
      (triggers.supplierRegimes?.length ?? 0) > 0 ||
      (triggers.customerRegimes?.length ?? 0) > 0 ||
      (triggers.excludeSupplierRegimes?.length ?? 0) > 0 ||
      (triggers.verifySupplierRegimes?.length ?? 0) > 0;

    if (needsProfile) {
      const profile = await ensureProfile();
      if (!profile) {
        // Sin perfil → asumimos regimen_comun para no retener en exceso
        // (comportamiento conservador). Emitimos warning.
        warnings.push(
          'Tercero sin perfil tributario registrado. Se asume régimen común ' +
            'no autorretenedor para esta evaluación.',
        );
        if ((triggers.excludeSupplierRegimes?.length ?? 0) > 0) {
          warnings.push(
            `Regla ${rule.code}: tercero sin perfil tributario — no se pudo ` +
              'verificar si está entre los sujetos no sometidos a retención ' +
              '(Art. 369 E.T.; Art. 911 E.T. para el SIMPLE; autorretenedores ' +
              'del concepto, Art. 368 par. 1 E.T. y DUR 1625/2016 Arts. 1.2.6.1 ' +
              'y 1.2.6.2). Se asume NO excluido: confirme antes de contabilizar.',
          );
        }
        // Si la regla requiere que el proveedor sea de un régimen específico
        // que excluya a "regimen_comun", la saltamos.
        if (triggers.supplierRegimes && triggers.supplierRegimes.length > 0) {
          // Regla aplica si regimen_comun está en la lista de triggers
          const coversComun = triggers.supplierRegimes.includes('regimen_comun');
          if (!coversComun) {
            // La regla solo aplica a regímenes específicos que no incluyen
            // el asumido — saltar con warning documentado.
            continue;
          }
        }
      } else {
        const profileRegimes = supplierRegimeTags(profile);

        // Filtro 4c-0: EXCLUSIÓN — gana sobre la activación inclusiva.
        // Art. 369 E.T. (pagos no sometidos a retención), Art. 911 E.T. (los
        // contribuyentes del SIMPLE no están sujetos a retención en la fuente),
        // y traslado de la obligación al autorretenedor del concepto.
        // Sin este filtro, un proveedor con regime='regimen_comun' y
        // isAutorretenedor=true seguía matcheando por 'regimen_comun' y el
        // motor le practicaba retención improcedente.
        const excluded = triggers.excludeSupplierRegimes?.find((r) =>
          profileRegimes.includes(r),
        );
        if (excluded) continue;

        // Filtro 4c-1: régimen del proveedor (activación inclusiva)
        if (triggers.supplierRegimes && triggers.supplierRegimes.length > 0) {
          const matches = triggers.supplierRegimes.some((r) =>
            profileRegimes.includes(r),
          );
          if (!matches) continue;
        }

        // Filtro 4c-2: régimen que exige verificación manual (no excluye).
        const toVerify = triggers.verifySupplierRegimes?.find((r) =>
          profileRegimes.includes(r),
        );
        if (toVerify) {
          warnings.push(
            triggers.verifyMessage ??
              `Regla ${rule.code}: el tercero es "${toVerify}". Verifique si ` +
                'está autorizado como autorretenedor del concepto (resolución ' +
                'DIAN / responsabilidad 15 del RUT): de estarlo, NO procede la ' +
                'retención (Art. 369 E.T. y DUR 1625/2016 Art. 1.2.6.2).',
          );
        }

        if (triggers.customerRegimes && triggers.customerRegimes.length > 0) {
          const matches = triggers.customerRegimes.some((r) =>
            profileRegimes.includes(r),
          );
          if (!matches) continue;
        }
      }
    }

    // Advertencia normativa permanente de la regla (p. ej. el acumulado de
    // 3.300 UVT del DUR 1625/2016 Art. 1.2.4.3.1, que el motor no lleva).
    if (triggers.advisory) warnings.push(triggers.advisory);

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
      warnings: dedupe(warnings),
    });
  }

  // ── Paso 9: exclusión mutua por (taxType, exclusionGroup) ────────────────
  return resolveExclusionGroups(matched);
}

// ---------------------------------------------------------------------------
// Exclusión mutua
// ---------------------------------------------------------------------------

/**
 * Una operación se grava con UNA sola tarifa: las tarifas de IVA son
 * excluyentes por bien o servicio (19% Art. 468, 5% Arts. 468-1 y 468-3,
 * exentos Art. 477, excluidos Arts. 424 y 476) y un pago se somete a UN solo
 * concepto de retención en la fuente (Art. 392 E.T.: honorarios O servicios
 * generales, no ambos).
 *
 * Antes de esta resolución `matchRules` devolvía TODAS las reglas que pasaran
 * los filtros, de modo que una compra acumulaba IVA 19% + 5% (= 24% sobre la
 * misma base, descontable improcedente → sanción por inexactitud Art. 648 E.T.)
 * y un servicio acumulaba ReteFuente 4% + 11%.
 *
 * Resolución dentro de cada grupo:
 *   - gana la `specificity` mayor;
 *   - las de menor especificidad se descartan y se deja constancia en los
 *     warnings de la ganadora (rastro para el audit log);
 *   - si hay EMPATE en la especificidad máxima, no gana ninguna: las empatadas
 *     se devuelven marcadas `ambiguous` para que el generador no las
 *     contabilice y el conflicto quede visible. Elegir una al azar produciría
 *     un asiento con la tarifa equivocada en un dictamen firmado ante la DIAN.
 */
export function resolveExclusionGroups(matched: MatchedRule[]): MatchedRule[] {
  const groups = new Map<string, MatchedRule[]>();
  const ungrouped: MatchedRule[] = [];

  for (const m of matched) {
    const group = readTriggers(m.rule).exclusionGroup;
    if (!group) {
      ungrouped.push(m);
      continue;
    }
    const key = `${m.rule.taxType}::${group}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(m);
    else groups.set(key, [m]);
  }

  const kept: MatchedRule[] = [...ungrouped];

  for (const [key, bucket] of groups) {
    if (bucket.length === 1) {
      kept.push(bucket[0]);
      continue;
    }

    const maxSpec = Math.max(...bucket.map((m) => specificityOf(m)));
    const winners = bucket.filter((m) => specificityOf(m) === maxSpec);
    const losers = bucket.filter((m) => specificityOf(m) !== maxSpec);

    if (winners.length > 1) {
      // Empate → ninguna se contabiliza.
      const codes = bucket.map((m) => m.rule.code).join(', ');
      for (const w of winners) {
        kept.push({
          ...w,
          ambiguous: true,
          warnings: dedupe([
            ...w.warnings,
            `Conflicto de reglas en el grupo de exclusión mutua "${key}": ` +
              `${codes} empatan en especificidad (${maxSpec}). Una operación se ` +
              'grava con una sola tarifa, así que NO se contabiliza ninguna. ' +
              'Determine el tratamiento aplicable y declárelo en `taxTreatments`.',
          ]),
        });
      }
      continue;
    }

    const winner = winners[0];
    const displaced = losers.map((m) => m.rule.code).join(', ');
    kept.push({
      ...winner,
      warnings: dedupe([
        ...winner.warnings,
        `Regla ${winner.rule.code} aplicada con exclusión de ${displaced} ` +
          `(grupo "${key}", especificidad ${maxSpec}).`,
      ]),
    });
  }

  // Preservar el orden original de evaluación para que el resultado sea
  // determinista y comparable entre corridas.
  const order = new Map(matched.map((m, i) => [m.rule.id, i] as const));
  return kept.sort(
    (a, b) => (order.get(a.rule.id) ?? 0) - (order.get(b.rule.id) ?? 0),
  );
}

function specificityOf(m: MatchedRule): number {
  const spec = readTriggers(m.rule).specificity;
  return typeof spec === 'number' && Number.isFinite(spec) ? spec : 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Etiquetas de régimen que "es" un tercero. `regime` y los flags `is_*`
 * coexisten (una jurídica del régimen común puede además ser gran
 * contribuyente autorretenedor), así que se aplanan a una sola lista contra
 * la que se evalúan tanto `supplierRegimes` como `excludeSupplierRegimes`.
 */
function supplierRegimeTags(profile: ThirdPartyTaxProfileRow): string[] {
  const tags: string[] = [profile.regime];
  if (profile.isGranContribuyente) tags.push('gran_contribuyente');
  if (profile.isAutorretenedor) tags.push('autorretenedor');
  if (profile.isRegimenSimple) tags.push('regimen_simple');
  if (!profile.isResponsableIva) tags.push('no_responsable_iva');
  return tags;
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items));
}

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
