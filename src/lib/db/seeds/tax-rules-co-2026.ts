// ─── WS1 — Seed: reglas tributarias Colombia 2026 ────────────────────────────
//
// Inserta (o actualiza idempotente) las 6 reglas built-in + UVT 2025/2026.
// Las reglas built-in tienen workspace_id = NULL.
//
// Idempotencia: usa ON CONFLICT (workspace_id, code) DO UPDATE para que
// re-ejecutar no duplique ni falle.
//
// Bases legales:
//   - IVA 19%:        Art. 468 ET.
//   - IVA 5%:         Art. 468-1 ET (bienes y servicios tarifa diferencial).
//   - IVA 0%:         Art. 468-1 / Art. 476 ET (bienes/servicios exentos y excluidos).
//   - ReteFuente svc: Art. 392 ET + Decreto 2418/2013 (servicios 4%).
//   - ReteFuente hon: Art. 392 ET (honorarios y comisiones 11%).
//   - ICA Bogotá:     Ley 14/1983 + Acuerdo 65/2002 (11/1000 = 0.0011).
//
// NOTA: applicable_triggers usa Drizzle JSONB. El upsert es SQL raw via
// `db.execute(sql`...`)` porque Drizzle no soporta ON CONFLICT con SET
// en su query builder para versiones anteriores a 0.31 (aún en uso en el repo).
// Se construye con el tagged-template `sql` de drizzle-orm.

import { sql } from 'drizzle-orm';
import { getDb } from '../client';

// ---------------------------------------------------------------------------
// Definición de las 6 reglas + 2 constantes UVT
// ---------------------------------------------------------------------------

const BUILT_IN_RULES = [
  {
    code: 'IVA_19_PURCHASE',
    taxType: 'IVA',
    description: 'IVA descontable 19% en compras de bienes/servicios',
    rate: '0.190000',
    taxAccountCode: '240810',
    accountSide: 'debit',
    isDeductible: true,
    applyThresholdUvt: null,
    applicableTriggers: {
      transactionTypes: ['purchase', 'service_purchase'],
    },
  },
  {
    code: 'IVA_19_SALE',
    taxType: 'IVA',
    description: 'IVA generado 19% en ventas',
    rate: '0.190000',
    taxAccountCode: '240805',
    accountSide: 'credit',
    isDeductible: false,
    applyThresholdUvt: null,
    applicableTriggers: {
      transactionTypes: ['sale', 'service_sale'],
    },
  },
  {
    code: 'IVA_5_PURCHASE',
    taxType: 'IVA',
    description: 'IVA descontable tarifa diferencial 5% (Art. 468-1 ET)',
    rate: '0.050000',
    taxAccountCode: '240810',
    accountSide: 'debit',
    isDeductible: true,
    applyThresholdUvt: null,
    applicableTriggers: {
      transactionTypes: ['purchase', 'service_purchase'],
    },
  },
  {
    // Operación excluida/exenta — rate=0, NO genera línea contable.
    // Cuando matched, line-generator emite proposal con taxAmount=0 y omite JournalLineInput.
    code: 'IVA_0_EXEMPT',
    taxType: 'IVA',
    description: 'Operación excluida/exenta de IVA — no genera contabilización (Art. 476 ET)',
    rate: '0.000000',
    taxAccountCode: null,
    accountSide: 'debit', // irrelevante, nunca se usa (rate=0)
    isDeductible: false,
    applyThresholdUvt: null,
    applicableTriggers: {
      transactionTypes: ['purchase', 'sale', 'service_purchase', 'service_sale'],
    },
  },
  {
    // ReteFuente servicios: aplica cuando proveedor es régimen común (responsable IVA)
    // y NO es gran contribuyente NI autorretenedor.
    // Umbral: 4 UVT = $209.496 COP 2026 (Art. 401 ET).
    code: 'RTF_SVC_4',
    taxType: 'RETEFUENTE',
    description: 'ReteFuente servicios generales 4% (Art. 392 ET)',
    rate: '0.040000',
    taxAccountCode: '236525',
    accountSide: 'credit',
    isDeductible: false,
    applyThresholdUvt: '4.0000',
    applicableTriggers: {
      transactionTypes: ['service_purchase'],
      // Aplica cuando el proveedor es régimen común (responsable IVA)
      // y NO es autorretenedor ni gran contribuyente.
      // MVP: incluimos regimen_comun y persona_natural como casos a retener.
      supplierRegimes: ['regimen_comun', 'persona_natural'],
    },
  },
  {
    // ReteFuente honorarios: sin umbral mínimo (desde el primer peso).
    code: 'RTF_HONO_11',
    taxType: 'RETEFUENTE',
    description: 'ReteFuente honorarios y comisiones 11% (Art. 392 ET)',
    rate: '0.110000',
    taxAccountCode: '236525',
    accountSide: 'credit',
    isDeductible: false,
    applyThresholdUvt: null,
    applicableTriggers: {
      transactionTypes: ['service_purchase'],
      supplierRegimes: ['regimen_comun', 'persona_natural'],
    },
  },
  {
    // ICA Bogotá: 11/1000 = 0.0011. Solo aplica si la ciudad del tercero es 11001.
    code: 'ICA_BOG_11',
    taxType: 'ICA',
    description: 'ICA Bogotá 11/1000 (Acuerdo 65/2002)',
    rate: '0.001100',
    taxAccountCode: '236805',
    accountSide: 'credit',
    isDeductible: false,
    applyThresholdUvt: null,
    applicableTriggers: {
      transactionTypes: ['purchase', 'service_purchase'],
      cityCode: '11001',
    },
  },
] as const;

const UVT_VALUES = [
  { year: 2025, valueCop: '49799.00', decreeRef: 'Resolución DIAN 000187/2024-12-19', source: 'seed' },
  { year: 2026, valueCop: '52374.00', decreeRef: 'Resolución DIAN 000187/2025-12-19', source: 'seed' },
] as const;

// ---------------------------------------------------------------------------
// Función de seed idempotente
// ---------------------------------------------------------------------------

export async function seedTaxRulesCo2026(): Promise<void> {
  const db = getDb();

  console.log('[seed] Iniciando seed de reglas tributarias Colombia 2026...');

  // ── UVT constants ──────────────────────────────────────────────────────────
  for (const uvt of UVT_VALUES) {
    await db.execute(
      sql`
        INSERT INTO uvt_constants (year, value_cop, decree_ref, source)
        VALUES (${uvt.year}, ${uvt.valueCop}, ${uvt.decreeRef}, ${uvt.source})
        ON CONFLICT (year) DO UPDATE
          SET value_cop   = EXCLUDED.value_cop,
              decree_ref  = EXCLUDED.decree_ref,
              source      = EXCLUDED.source
      `,
    );
    console.log(`[seed] UVT ${uvt.year} = $${uvt.valueCop} OK`);
  }

  // ── Tax rules ──────────────────────────────────────────────────────────────
  for (const rule of BUILT_IN_RULES) {
    const triggersJson = JSON.stringify(rule.applicableTriggers);

    await db.execute(
      sql`
        INSERT INTO tax_rules (
          workspace_id,
          code,
          tax_type,
          description,
          rate,
          tax_account_code,
          account_side,
          is_deductible,
          apply_threshold_uvt,
          applicable_triggers,
          is_active
        )
        VALUES (
          NULL,
          ${rule.code},
          ${rule.taxType}::tax_type,
          ${rule.description},
          ${rule.rate},
          ${rule.taxAccountCode},
          ${rule.accountSide},
          ${rule.isDeductible},
          ${rule.applyThresholdUvt},
          ${triggersJson}::jsonb,
          true
        )
        ON CONFLICT ON CONSTRAINT tr_ws_code_uniq DO UPDATE
          SET description         = EXCLUDED.description,
              rate                = EXCLUDED.rate,
              tax_account_code    = EXCLUDED.tax_account_code,
              account_side        = EXCLUDED.account_side,
              is_deductible       = EXCLUDED.is_deductible,
              apply_threshold_uvt = EXCLUDED.apply_threshold_uvt,
              applicable_triggers = EXCLUDED.applicable_triggers,
              is_active           = EXCLUDED.is_active,
              updated_at          = now()
      `,
    );
    console.log(`[seed] Regla ${rule.code} OK`);
  }

  console.log('[seed] Seed tax-rules-co-2026 completado.');
}
