// ─── WS1 — Seed: reglas tributarias Colombia 2026 ────────────────────────────
//
// Inserta (o actualiza idempotente) las reglas built-in + UVT 2025/2026.
// Las reglas built-in tienen workspace_id = NULL.
//
// Idempotencia: usa ON CONFLICT (workspace_id, code) DO UPDATE para que
// re-ejecutar no duplique ni falle. Los códigos retirados se desactivan
// (is_active=false) en lugar de borrarse, para no romper las FK de
// `tax_engine_audits.matched_rule_ids` ni el histórico de asientos.
//
// ── Bases legales ───────────────────────────────────────────────────────────
//
// IVA — las tarifas son MUTUAMENTE EXCLUYENTES por bien o servicio:
//   - 19% general: Art. 468 E.T. (Ley 1819/2016). Es el residual.
//   - 5% BIENES:   Art. 468-1 E.T. — lista TAXATIVA de bienes.
//   - 5% SERVICIOS: Art. 468-3 E.T. — lista TAXATIVA de servicios (medicina
//     prepagada y planes complementarios, pólizas de cirugía y hospitalización,
//     vigilancia/aseo/temporales de empleo prestados por las entidades allí
//     señaladas sobre la parte correspondiente al AIU). El Art. 468-1 NO cubre
//     servicios: citarlo para un servicio es indefendible ante la DIAN y
//     debilita la defensa por diferencia de criterio (Art. 647 E.T.).
//   - EXENTOS:  Art. 477 E.T. — tarifa 0% CON derecho a impuestos descontables
//     y a devolución bimestral de saldos a favor (Arts. 481 y 850 E.T.).
//   - EXCLUIDOS: Art. 424 (bienes) y Art. 476 (servicios) E.T. — no se causa el
//     impuesto y el IVA de los insumos NO es descontable: es mayor valor del
//     costo o gasto (Arts. 488 y 490 E.T.). Exento y excluido NO son lo mismo;
//     antes compartían una sola regla `IVA_0_EXEMPT`, hoy retirada.
//   Como el motor no puede saber si un bien está en la lista taxativa del
//   Art. 468-1, las tarifas diferenciales exigen que el caller declare el
//   tratamiento (`taxTreatments`). Sin declaración sólo entra el 19% residual.
//
// ReteFuente a título de renta (Art. 392 E.T. y DUR 1625/2016):
//   - Servicios generales: 4% declarantes / 6% no declarantes.
//     Base mínima: ver ventanas de vigencia más abajo.
//   - Compras de bienes: 2,5% declarantes / 3,5% no declarantes (Art. 401 E.T.;
//     DUR 1625/2016 Art. 1.2.4.9.1). Base mínima 10 UVT (27 UVT antes del
//     Decreto 0572/2025 y durante la suspensión provisional).
//   - Honorarios y comisiones (DUR 1625/2016 Art. 1.2.4.3.1): 11% a personas
//     jurídicas y asimiladas; 10% a personas naturales, salvo que del contrato
//     se desprenda que superarán 3.300 UVT en el año o que los pagos acumulados
//     del mismo agente retenedor los superen (11% desde ese pago). El criterio
//     NO es la condición de declarante. Sin base mínima.
//   - Rentas de trabajo no laborales de persona natural que no solicitó costos
//     y deducciones: tabla del Art. 383 E.T. (par. 2 mod. art. 8 Ley 2277/2022;
//     DUR 1625/2016 Art. 1.2.4.1.17 par. 4 mod. Decreto 2231/2023). El motor no
//     la calcula: la regla queda en revisión manual y desplaza la tarifa plana.
//   - No hay lugar a retención cuando el beneficiario es autorretenedor del
//     concepto ni sobre pagos a los sujetos del Art. 369 E.T.; los
//     contribuyentes del SIMPLE no están sujetos a retención en la fuente
//     (Art. 911 E.T.). Ver `excludeSupplierRegimes`.
//
// ICA Bogotá: Ley 14/1983 + Acuerdo 65/2002 art. 3 (mod. Acuerdos 780/2020 y
//   816/2021) + Decreto Distrital 271/2002 (retención). Las tarifas van de
//   4,14 a 13,8 por mil. "Demás actividades comerciales" = 11,04 x 1.000 =
//   0,01104. La tarifa de ReteICA es la del ICA de la actividad del retenido.
//   Sólo la practica quien sea agente retenedor de ICA en el municipio: la
//   regla queda en revisión manual hasta que el caller declare
//   `agente_retenedor_ica`.
//
// ── Ventanas de vigencia de las bases mínimas de retención ──────────────────
// El Decreto 0572/2025 redujo las bases (servicios 4 → 2 UVT; compras y otros
// ingresos 27 → 10 UVT) con efectos desde el 01-jun-2025. El Consejo de Estado
// suspendió provisionalmente sus arts. 2 a 8 por auto del 07-may-2026 y revocó
// la suspensión por auto 30229 del 02-jun-2026, fijando el restablecimiento a
// partir del primer día del mes siguiente a la ejecutoria: 01-jul-2026.
// Resultan CUATRO ventanas, que el seed reproduce con valid_from/valid_until
// (`getRules` ya filtra por `transactionDate`) en lugar de colapsarlas en un
// solo umbral:
//   W0  …          → 31-may-2025 : servicios 4 UVT / compras 27 UVT (bases anteriores)
//   W1  01-jun-2025 → 07-may-2026 : servicios 2 UVT / compras 10 UVT (Decreto 0572/2025)
//   W2  08-may-2026 → 30-jun-2026 : servicios 4 UVT / compras 27 UVT (suspensión provisional)
//   W3  01-jul-2026 → …           : servicios 2 UVT / compras 10 UVT (auto CE 30229/2026)
// El proceso de nulidad de fondo sigue abierto: revisar al fallo definitivo.
//
// NOTA: applicable_triggers usa Drizzle JSONB. El upsert es SQL raw via
// `db.execute(sql`...`)` porque Drizzle no soporta ON CONFLICT con SET
// en su query builder para versiones anteriores a 0.31 (aún en uso en el repo).
// Se construye con el tagged-template `sql` de drizzle-orm.

import { sql } from 'drizzle-orm';
import { getDb } from '../client';
import type { TaxRuleTriggers } from '@/lib/accounting/tax-engine/types';
import { TAX_TREATMENT } from '@/lib/accounting/tax-engine/types';

// ---------------------------------------------------------------------------
// Marcas temporales de las ventanas (hora legal de Colombia, UTC-05:00)
// ---------------------------------------------------------------------------

/** Entrada en vigor del Decreto 0572/2025 (art. 9: mes siguiente a su publicación). */
const D572_INICIO = '2025-06-01T00:00:00-05:00';
/** Último instante antes de la suspensión provisional (auto CE del 07-may-2026). */
const D572_FIN_W1 = '2026-05-07T23:59:59-05:00';
/** Primer instante de la suspensión provisional. */
const SUSPENSION_INICIO = '2026-05-08T00:00:00-05:00';
/** Último instante de la suspensión (auto CE 30229 del 02-jun-2026). */
const SUSPENSION_FIN = '2026-06-30T23:59:59-05:00';
/** Restablecimiento pleno del Decreto 0572/2025. */
const D572_RESTABLECIMIENTO = '2026-07-01T00:00:00-05:00';

// ---------------------------------------------------------------------------
// Exclusiones de régimen comunes a la retención en la fuente a título de renta
// ---------------------------------------------------------------------------

/**
 * Sujetos a los que NO se les practica retención en la fuente a título de renta:
 *   - `autorretenedor`: la obligación se traslada al beneficiario del pago
 *     (Art. 369 E.T.; Art. 368 par. 1 E.T.; DUR 1625/2016 Arts. 1.2.6.1-1.2.6.2).
 *   - `regimen_simple`: "los contribuyentes del SIMPLE no estarán sujetos a
 *     retención en la fuente", salvo pagos laborales (Art. 911 E.T.).
 * Nota: la exclusión NO cubre la retención de IVA ni la de ICA.
 */
const RTF_REGIMENES_EXCLUIDOS = ['autorretenedor', 'regimen_simple'] as const;

/**
 * Ser gran contribuyente NO excluye por sí solo de retención: sólo excluye si
 * además está autorizado como autorretenedor del concepto. Se conserva la regla
 * y se exige verificación manual en vez de asumir cualquiera de los dos extremos.
 */
const RTF_REGIMENES_A_VERIFICAR = ['gran_contribuyente'] as const;

const RTF_VERIFY_MSG =
  'El proveedor está marcado como gran contribuyente. Verifique en el RUT ' +
  '(responsabilidad 15) o en la resolución DIAN si es autorretenedor del ' +
  'concepto: de serlo NO procede la retención (Art. 369 E.T. y DUR 1625/2016 ' +
  'Art. 1.2.6.2) y practicarla obliga al reintegro.';

/** Proveedores a los que sí se les practica ReteFuente cuando no están excluidos. */
const RTF_REGIMENES_SUJETOS = [
  'regimen_comun',
  'regimen_simplificado',
  'persona_natural',
  'no_responsable_iva',
] as const;

function retefuenteTriggers(extra: Partial<TaxRuleTriggers>): TaxRuleTriggers {
  return {
    transactionTypes: ['service_purchase'],
    supplierRegimes: [...RTF_REGIMENES_SUJETOS],
    excludeSupplierRegimes: [...RTF_REGIMENES_EXCLUIDOS],
    verifySupplierRegimes: [...RTF_REGIMENES_A_VERIFICAR],
    verifyMessage: RTF_VERIFY_MSG,
    // Un pago se somete a UN solo concepto de retención en la fuente: honorarios
    // O servicios generales, nunca ambos (Art. 392 E.T.).
    exclusionGroup: 'retefuente_renta',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Definición de las reglas built-in + constantes UVT
// ---------------------------------------------------------------------------

interface BuiltInRule {
  code: string;
  taxType: 'IVA' | 'RETEFUENTE' | 'RETEIVA' | 'ICA' | 'CREE' | 'INC';
  description: string;
  rate: string;
  taxAccountCode: string | null;
  accountSide: 'debit' | 'credit';
  isDeductible: boolean;
  applyThresholdUvt: string | null;
  applicableTriggers: TaxRuleTriggers;
  /** ISO-8601 con offset. null = sin fecha de inicio. */
  validFrom: string | null;
  /** ISO-8601 con offset. null = sin fecha de fin. */
  validUntil: string | null;
}

// ---------------------------------------------------------------------------
// ReteFuente renta — grupo de exclusión mutua "retefuente_renta"
// ---------------------------------------------------------------------------
//
// Especificidades (gana la mayor; un pago se somete a UN solo concepto):
//   0  servicios generales 4 % / compras 2,5 %  (residuales, declarantes)
//   5  servicios 6 % / compras 3,5 %            (beneficiario NO declarante)
//   10 honorarios y comisiones 11 %             (personas jurídicas; PN > 3.300 UVT)
//   20 honorarios y comisiones 10 %             (PN con contrato/pagos ≤ 3.300 UVT)
//   30 renta de trabajo no laboral por tabla del Art. 383 (revisión manual)

/**
 * Ventanas de vigencia de las bases mínimas (ver cabecera del archivo).
 * Servicios: DUR 1625/2016 Art. 1.2.4.4.1 (mod. Decreto 0572/2025 art. 2).
 * Compras y demás "otros ingresos tributarios": Art. 1.2.4.9.1 lit. i)
 * (mod. Decreto 0572/2025 art. 6) — 10 UVT; antes 27 UVT.
 */
interface VentanaBaseMinima {
  sufijo: '' | '_D572_W1' | '_SUSPENSION' | '_PRE_D572';
  validFrom: string | null;
  validUntil: string | null;
  serviciosUvt: string;
  comprasUvt: string;
  etiqueta: string;
}

const VENTANAS_BASE_MINIMA: VentanaBaseMinima[] = [
  {
    // W3 — restablecimiento pleno del Decreto 0572/2025.
    sufijo: '',
    validFrom: D572_RESTABLECIMIENTO,
    validUntil: null,
    serviciosUvt: '2.0000',
    comprasUvt: '10.0000',
    etiqueta:
      'desde el 01-jul-2026 (mod. Decreto 0572/2025, restablecido por auto CE 30229 del 02-jun-2026)',
  },
  {
    // W1 — Decreto 0572/2025 vigente antes de la suspensión provisional.
    sufijo: '_D572_W1',
    validFrom: D572_INICIO,
    validUntil: D572_FIN_W1,
    serviciosUvt: '2.0000',
    comprasUvt: '10.0000',
    etiqueta: 'vigente entre el 01-jun-2025 y el 07-may-2026 (Decreto 0572/2025 arts. 2 y 6)',
  },
  {
    // W2 — suspensión provisional: reviven las bases anteriores (4 / 27 UVT).
    sufijo: '_SUSPENSION',
    validFrom: SUSPENSION_INICIO,
    validUntil: SUSPENSION_FIN,
    serviciosUvt: '4.0000',
    comprasUvt: '27.0000',
    etiqueta:
      'entre el 08-may-2026 y el 30-jun-2026 (suspensión provisional de los arts. 2 a 8 del ' +
      'Decreto 0572/2025 por auto del Consejo de Estado del 07-may-2026)',
  },
  {
    // W0 — bases anteriores al Decreto 0572/2025.
    sufijo: '_PRE_D572',
    validFrom: null,
    validUntil: '2025-05-31T23:59:59-05:00',
    serviciosUvt: '4.0000',
    comprasUvt: '27.0000',
    etiqueta:
      'vigente hasta el 31-may-2025 (DUR 1625/2016 en su redacción anterior al Decreto 0572/2025)',
  },
];

const ADVISORY_NO_DECLARANTE =
  'Si el beneficiario NO está obligado a declarar renta la tarifa es mayor ' +
  '(servicios 6 %, compras 3,5 %): el motor no infiere esa condición, declárela ' +
  'con `beneficiario_no_declarante`.';

const ADVISORY_TABLA_383 =
  'Si el beneficiario es persona natural con rentas de trabajo no laborales y NO ' +
  'solicitó al agente retenedor la aplicación de costos y deducciones, la retención ' +
  'se liquida con la tabla del Art. 383 E.T. (par. 2 mod. art. 8 Ley 2277/2022; ' +
  'DUR 1625/2016 Art. 1.2.4.1.17 par. 4 mod. Decreto 2231/2023), no con la tarifa ' +
  'plana: declárelo con `renta_trabajo_tabla_383`.';

const ADVISORY_3300_UVT =
  'Honorarios y comisiones (DUR 1625/2016 Art. 1.2.4.3.1): 11 % a personas jurídicas ' +
  'y asimiladas; a personas naturales 10 %, salvo que del contrato se desprenda que sus ' +
  'ingresos superarán 3.300 UVT en el año ($172.834.200 con UVT 2026) o que los pagos ' +
  'acumulados del mismo agente retenedor los superen (11 % desde ese pago). El motor ' +
  'no lleva el acumulado por tercero: declare `honorarios_pn_hasta_3300_uvt` cuando ' +
  'el beneficiario sea persona natural dentro del límite.';

function reglasServicios(): BuiltInRule[] {
  return VENTANAS_BASE_MINIMA.flatMap((v) => [
    {
      code: `RTF_SVC_4${v.sufijo}`,
      taxType: 'RETEFUENTE' as const,
      description:
        `ReteFuente servicios generales 4% — beneficiario declarante (Art. 392 E.T.). ` +
        `Base mínima ${parseFloat(v.serviciosUvt)} UVT ${v.etiqueta} (DUR 1625/2016 Art. 1.2.4.4.1)`,
      rate: '0.040000',
      taxAccountCode: '236525',
      accountSide: 'credit' as const,
      isDeductible: false,
      applyThresholdUvt: v.serviciosUvt,
      applicableTriggers: retefuenteTriggers({
        specificity: 0,
        advisory: `${ADVISORY_NO_DECLARANTE} ${ADVISORY_TABLA_383}`,
      }),
      validFrom: v.validFrom,
      validUntil: v.validUntil,
    },
    {
      code: `RTF_SVC_6${v.sufijo}`,
      taxType: 'RETEFUENTE' as const,
      description:
        `ReteFuente servicios generales 6% — beneficiario NO obligado a declarar renta ` +
        `(Art. 392 E.T.; DUR 1625/2016). Base mínima ${parseFloat(v.serviciosUvt)} UVT ${v.etiqueta}`,
      rate: '0.060000',
      taxAccountCode: '236525',
      accountSide: 'credit' as const,
      isDeductible: false,
      applyThresholdUvt: v.serviciosUvt,
      applicableTriggers: retefuenteTriggers({
        requiresTreatments: [TAX_TREATMENT.BENEFICIARIO_NO_DECLARANTE],
        specificity: 5,
        advisory: ADVISORY_TABLA_383,
      }),
      validFrom: v.validFrom,
      validUntil: v.validUntil,
    },
  ]);
}

function reglasCompras(): BuiltInRule[] {
  const compraTriggers = (extra: Partial<TaxRuleTriggers>) =>
    retefuenteTriggers({ transactionTypes: ['purchase'], ...extra });
  const advisoryTarifasEspeciales =
    'Tarifa general de compras de bienes. Hay tarifas especiales que el motor no ' +
    'distingue (productos agropecuarios sin procesamiento, café, combustibles, ' +
    'vehículos, bienes raíces, oro): confirme el bien antes de contabilizar.';
  return VENTANAS_BASE_MINIMA.flatMap((v) => [
    {
      code: `RTF_COMPRAS_2_5${v.sufijo}`,
      taxType: 'RETEFUENTE' as const,
      description:
        `ReteFuente compras 2,5% — beneficiario declarante (Art. 401 E.T.; DUR 1625/2016 ` +
        `Art. 1.2.4.9.1). Base mínima ${parseFloat(v.comprasUvt)} UVT ${v.etiqueta}`,
      rate: '0.025000',
      taxAccountCode: '236540',
      accountSide: 'credit' as const,
      isDeductible: false,
      applyThresholdUvt: v.comprasUvt,
      applicableTriggers: compraTriggers({
        specificity: 0,
        advisory: `${ADVISORY_NO_DECLARANTE} ${advisoryTarifasEspeciales}`,
      }),
      validFrom: v.validFrom,
      validUntil: v.validUntil,
    },
    {
      code: `RTF_COMPRAS_3_5${v.sufijo}`,
      taxType: 'RETEFUENTE' as const,
      description:
        `ReteFuente compras 3,5% — beneficiario NO obligado a declarar renta (Art. 401 E.T.; ` +
        `DUR 1625/2016). Base mínima ${parseFloat(v.comprasUvt)} UVT ${v.etiqueta}`,
      rate: '0.035000',
      taxAccountCode: '236540',
      accountSide: 'credit' as const,
      isDeductible: false,
      applyThresholdUvt: v.comprasUvt,
      applicableTriggers: compraTriggers({
        requiresTreatments: [TAX_TREATMENT.BENEFICIARIO_NO_DECLARANTE],
        specificity: 5,
        advisory: advisoryTarifasEspeciales,
      }),
      validFrom: v.validFrom,
      validUntil: v.validUntil,
    },
  ]);
}

const REGLAS_HONORARIOS: BuiltInRule[] = [
  {
    // 11% — residual de honorarios: personas jurídicas y personas naturales
    // por encima de 3.300 UVT (DUR 1625/2016 Art. 1.2.4.3.1). El criterio NO es
    // la condición de declarante.
    code: 'RTF_HONO_11',
    taxType: 'RETEFUENTE',
    description:
      'ReteFuente honorarios y comisiones 11% — personas jurídicas y asimiladas, y personas ' +
      'naturales cuyo contrato o pagos acumulados del año con el mismo agente superen ' +
      '3.300 UVT (Art. 392 E.T.; DUR 1625/2016 Art. 1.2.4.3.1). Sin base mínima',
    rate: '0.110000',
    taxAccountCode: '236525',
    accountSide: 'credit',
    isDeductible: false,
    applyThresholdUvt: null,
    applicableTriggers: retefuenteTriggers({
      requiresTreatments: [TAX_TREATMENT.HONORARIOS],
      specificity: 10,
      advisory: `${ADVISORY_3300_UVT} ${ADVISORY_TABLA_383}`,
    }),
    validFrom: null,
    validUntil: null,
  },
  {
    // 10% — personas naturales dentro del límite de 3.300 UVT.
    code: 'RTF_HONO_10',
    taxType: 'RETEFUENTE',
    description:
      'ReteFuente honorarios y comisiones 10% — persona natural cuyo contrato y pagos ' +
      'acumulados del año con el mismo agente retenedor no superan 3.300 UVT ' +
      '(DUR 1625/2016 Art. 1.2.4.3.1). Sin base mínima',
    rate: '0.100000',
    taxAccountCode: '236525',
    accountSide: 'credit',
    isDeductible: false,
    applyThresholdUvt: null,
    applicableTriggers: retefuenteTriggers({
      requiresTreatments: [
        TAX_TREATMENT.HONORARIOS,
        TAX_TREATMENT.HONORARIOS_PN_HASTA_3300_UVT,
      ],
      specificity: 20,
      advisory:
        'Tarifa del 10% condicionada: el motor NO lleva el acumulado anual por ' +
        'tercero. Si los pagos o abonos en cuenta de este agente retenedor al ' +
        'mismo beneficiario superan 3.300 UVT en el año gravable ($172.834.200 ' +
        'con UVT 2026), o si del contrato se desprende que los superarán, la ' +
        'tarifa es del 11% desde ese pago (DUR 1625/2016 Art. 1.2.4.3.1). ' +
        ADVISORY_TABLA_383,
    }),
    validFrom: null,
    validUntil: null,
  },
  {
    // Rentas de trabajo no laborales de persona natural sin costos y
    // deducciones: tabla del Art. 383 — no se contabiliza tarifa plana.
    code: 'RTF_RENTA_TRABAJO_TABLA_383',
    taxType: 'RETEFUENTE',
    description:
      'ReteFuente rentas de trabajo no laborales de persona natural sin solicitud de costos ' +
      'y deducciones — tabla del Art. 383 E.T. (par. 2 mod. art. 8 Ley 2277/2022; DUR ' +
      '1625/2016 Art. 1.2.4.1.17 par. 4 mod. Decreto 2231/2023). Requiere liquidación manual',
    rate: '0.000000',
    taxAccountCode: '236525',
    accountSide: 'credit',
    isDeductible: false,
    applyThresholdUvt: null,
    applicableTriggers: retefuenteTriggers({
      requiresTreatments: [TAX_TREATMENT.RENTA_TRABAJO_TABLA_383],
      specificity: 30,
      manualReview: {
        message:
          'La retención de rentas de trabajo no laborales de persona natural que no ' +
          'solicitó costos y deducciones se liquida con la tabla del Art. 383 E.T. sobre el ' +
          'pago mensualizado depurado (aportes, rentas exentas y deducciones). El motor no ' +
          'calcula esa depuración: no se contabiliza una tarifa plana del Art. 392.',
      },
    }),
    validFrom: null,
    validUntil: null,
  },
];

const RETEFUENTE_RULES: BuiltInRule[] = [
  ...reglasServicios(),
  ...REGLAS_HONORARIOS,
  ...reglasCompras(),
];

const ICA_RULES: BuiltInRule[] = [
  {
    // Corrección aritmética: 11,04 por mil = 0,01104. La constante anterior
    // (0.001100) equivalía a 1,1 por mil — diez veces menos de lo debido, y
    // fuera del rango legal de Bogotá (4,14 a 13,8 por mil).
    code: 'ICA_BOG_11',
    taxType: 'ICA',
    description:
      'ReteICA Bogotá 11,04 x 1.000 — "demás actividades comerciales" ' +
      '(Acuerdo 65/2002 art. 3, mod. Acuerdos 780/2020 y 816/2021; ' +
      'Decreto Distrital 271/2002)',
    rate: '0.011040',
    taxAccountCode: '236805',
    accountSide: 'credit',
    isDeductible: false,
    applyThresholdUvt: null,
    applicableTriggers: {
      transactionTypes: ['purchase', 'service_purchase'],
      cityCode: '11001',
      exclusionGroup: 'ica_municipal',
      specificity: 0,
      advisory:
        'La tarifa de ReteICA es la del ICA de la actividad económica del ' +
        'retenido: en Bogotá va de 4,14 a 13,8 por mil (Acuerdo 65/2002 art. 3). ' +
        'El 11,04 x 1.000 aquí sembrado es sólo el residual de "demás actividades ' +
        'comerciales"; confirme el CIIU del tercero antes de contabilizar ' +
        '(p. ej. "demás actividades de servicios" 9,66 x 1.000, financieras 14 x 1.000).',
      // La ciudad del proveedor no basta: sólo practica ReteICA quien sea
      // agente retenedor de ICA en ese municipio.
      manualReview: {
        message:
          'Practique ReteICA sólo si el comprador (este workspace) es agente retenedor ' +
          'de ICA en Bogotá (Decreto Distrital 271/2002). Declare `agente_retenedor_ica` ' +
          'para contabilizarla.',
        unlessTreatments: [TAX_TREATMENT.AGENTE_RETENEDOR_ICA],
      },
    },
    validFrom: null,
    validUntil: null,
  },
];

const BUILT_IN_RULES: BuiltInRule[] = [
  // ── IVA — grupo de exclusión mutua "iva" ──────────────────────────────────
  // El transactionType ya separa compras de ventas; dentro de cada lado sólo
  // puede ganar una tarifa. La residual (19%) lleva especificidad 0.
  {
    code: 'IVA_19_PURCHASE',
    taxType: 'IVA',
    description: 'IVA descontable tarifa general 19% en compras (Art. 468 E.T.)',
    rate: '0.190000',
    taxAccountCode: '240810',
    accountSide: 'debit',
    isDeductible: true,
    applyThresholdUvt: null,
    applicableTriggers: {
      transactionTypes: ['purchase', 'service_purchase'],
      exclusionGroup: 'iva',
      specificity: 0,
    },
    validFrom: null,
    validUntil: null,
  },
  {
    code: 'IVA_19_SALE',
    taxType: 'IVA',
    description: 'IVA generado tarifa general 19% en ventas (Art. 468 E.T.)',
    rate: '0.190000',
    taxAccountCode: '240805',
    accountSide: 'credit',
    isDeductible: false,
    applyThresholdUvt: null,
    applicableTriggers: {
      transactionTypes: ['sale', 'service_sale'],
      exclusionGroup: 'iva',
      specificity: 0,
    },
    validFrom: null,
    validUntil: null,
  },
  {
    // Art. 468-1 E.T. — lista TAXATIVA de BIENES al 5%.
    code: 'IVA_5_PURCHASE_BIENES',
    taxType: 'IVA',
    description:
      'IVA descontable 5% en compra de bienes de la lista taxativa del Art. 468-1 E.T.',
    rate: '0.050000',
    taxAccountCode: '240810',
    accountSide: 'debit',
    isDeductible: true,
    applyThresholdUvt: null,
    applicableTriggers: {
      transactionTypes: ['purchase'],
      requiresTreatments: [TAX_TREATMENT.IVA_5_BIENES],
      exclusionGroup: 'iva',
      specificity: 10,
      advisory:
        'Tarifa diferencial del 5%: confirme que el bien está en la lista ' +
        'taxativa del Art. 468-1 E.T. Si no lo está, la tarifa es la general ' +
        'del 19% (Art. 468 E.T.).',
    },
    validFrom: null,
    validUntil: null,
  },
  {
    // Art. 468-3 E.T. — lista TAXATIVA de SERVICIOS al 5%.
    code: 'IVA_5_PURCHASE_SERVICIOS',
    taxType: 'IVA',
    description:
      'IVA descontable 5% en compra de servicios de la lista taxativa del Art. 468-3 E.T.',
    rate: '0.050000',
    taxAccountCode: '240810',
    accountSide: 'debit',
    isDeductible: true,
    applyThresholdUvt: null,
    applicableTriggers: {
      transactionTypes: ['service_purchase'],
      requiresTreatments: [TAX_TREATMENT.IVA_5_SERVICIOS],
      exclusionGroup: 'iva',
      specificity: 10,
      advisory:
        'Servicios gravados al 5%: el fundamento es el Art. 468-3 E.T., NO el ' +
        'Art. 468-1 (que sólo lista bienes). En vigilancia, aseo y servicios ' +
        'temporales de empleo la base es la parte correspondiente al AIU.',
    },
    validFrom: null,
    validUntil: null,
  },
  {
    code: 'IVA_5_SALE_BIENES',
    taxType: 'IVA',
    description:
      'IVA generado 5% en venta de bienes de la lista taxativa del Art. 468-1 E.T.',
    rate: '0.050000',
    taxAccountCode: '240805',
    accountSide: 'credit',
    isDeductible: false,
    applyThresholdUvt: null,
    applicableTriggers: {
      transactionTypes: ['sale'],
      requiresTreatments: [TAX_TREATMENT.IVA_5_BIENES],
      exclusionGroup: 'iva',
      specificity: 10,
    },
    validFrom: null,
    validUntil: null,
  },
  {
    code: 'IVA_5_SALE_SERVICIOS',
    taxType: 'IVA',
    description:
      'IVA generado 5% en venta de servicios de la lista taxativa del Art. 468-3 E.T.',
    rate: '0.050000',
    taxAccountCode: '240805',
    accountSide: 'credit',
    isDeductible: false,
    applyThresholdUvt: null,
    applicableTriggers: {
      transactionTypes: ['service_sale'],
      requiresTreatments: [TAX_TREATMENT.IVA_5_SERVICIOS],
      exclusionGroup: 'iva',
      specificity: 10,
    },
    validFrom: null,
    validUntil: null,
  },
  {
    // EXENTO ≠ EXCLUIDO. Art. 477 E.T.: tarifa 0% y el responsable CONSERVA el
    // derecho a impuestos descontables y a la devolución bimestral de saldos a
    // favor (Arts. 481 y 850 E.T.). Por eso is_deductible = true.
    code: 'IVA_EXENTO',
    taxType: 'IVA',
    description:
      'Operación EXENTA de IVA — tarifa 0% con derecho a impuestos descontables ' +
      'y devolución bimestral (Art. 477 E.T.)',
    rate: '0.000000',
    taxAccountCode: null,
    accountSide: 'debit', // irrelevante: rate=0 no genera línea
    isDeductible: true,
    applyThresholdUvt: null,
    applicableTriggers: {
      transactionTypes: ['purchase', 'sale', 'service_purchase', 'service_sale'],
      requiresTreatments: [TAX_TREATMENT.IVA_EXENTO],
      exclusionGroup: 'iva',
      specificity: 20,
      advisory:
        'Bien o servicio EXENTO (Art. 477 E.T.): no se causa IVA a la tarifa ' +
        'general, pero el responsable conserva el derecho a descontables y a ' +
        'solicitar la devolución bimestral del saldo a favor (Arts. 481 y 850 E.T.).',
    },
    validFrom: null,
    validUntil: null,
  },
  {
    // Art. 424 (bienes) y Art. 476 (servicios) E.T.: no se causa el impuesto y
    // el IVA pagado en los insumos NO es descontable — es mayor valor del costo
    // o gasto (Arts. 488 y 490 E.T.). is_deductible = false.
    code: 'IVA_EXCLUIDO',
    taxType: 'IVA',
    description:
      'Operación EXCLUIDA de IVA — no se causa el impuesto; el IVA de los insumos ' +
      'no es descontable y es mayor valor del costo o gasto (Arts. 424 y 476 E.T.)',
    rate: '0.000000',
    taxAccountCode: null,
    accountSide: 'debit', // irrelevante: rate=0 no genera línea
    isDeductible: false,
    applyThresholdUvt: null,
    applicableTriggers: {
      transactionTypes: ['purchase', 'sale', 'service_purchase', 'service_sale'],
      requiresTreatments: [TAX_TREATMENT.IVA_EXCLUIDO],
      exclusionGroup: 'iva',
      specificity: 20,
      advisory:
        'Operación EXCLUIDA (Art. 424 bienes / Art. 476 servicios E.T.): el IVA ' +
        'pagado en los insumos destinados a ella NO es descontable y debe llevarse ' +
        'como mayor valor del costo o gasto (Arts. 488 y 490 E.T.). Si el ' +
        'responsable realiza además operaciones gravadas, aplique la ' +
        'proporcionalidad del Art. 490 E.T. — el motor no la calcula.',
    },
    validFrom: null,
    validUntil: null,
  },

  // ── ReteFuente renta (servicios, honorarios, compras) e ICA ───────────────
  ...RETEFUENTE_RULES,
  ...ICA_RULES,
];

/**
 * Códigos retirados: se desactivan, no se borran.
 *  - IVA_5_PURCHASE: disparaba con los MISMOS triggers que IVA_19_PURCHASE
 *    (una compra generaba 19% + 5% = 24% de descontable sobre la misma base) y
 *    citaba el Art. 468-1 para servicios, que ese artículo no regula.
 *    Reemplazada por IVA_5_PURCHASE_BIENES (Art. 468-1) e
 *    IVA_5_PURCHASE_SERVICIOS (Art. 468-3).
 *  - IVA_0_EXEMPT: colapsaba exentos (Art. 477) y excluidos (Arts. 424/476),
 *    que tienen efectos opuestos sobre el derecho a descontables.
 *    Reemplazada por IVA_EXENTO e IVA_EXCLUIDO.
 */
const RETIRED_RULE_CODES = ['IVA_5_PURCHASE', 'IVA_0_EXEMPT'] as const;

const UVT_VALUES = [
  // UVT 2025: Resolución DIAN 000193 del 04-dic-2024 (ver tax-engine/constants.ts).
  // UVT 2026: Resolución DIAN 000238 del 15-dic-2025
  // (src/data/tax_docs/resolucion_dian_238_2025_uvt_2026.md).
  { year: 2025, valueCop: '49799.00', decreeRef: 'Resolución DIAN 000193/2024-12-04', source: 'seed' },
  { year: 2026, valueCop: '52374.00', decreeRef: 'Resolución DIAN 000238/2025-12-15', source: 'seed' },
] as const;

// Export para las regresiones — el seed es la fuente única de estos valores.
export { BUILT_IN_RULES, RETIRED_RULE_CODES, UVT_VALUES };

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
          valid_from,
          valid_until,
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
          ${rule.validFrom}::timestamptz,
          ${rule.validUntil}::timestamptz,
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
              valid_from          = EXCLUDED.valid_from,
              valid_until         = EXCLUDED.valid_until,
              is_active           = EXCLUDED.is_active,
              updated_at          = now()
      `,
    );
    console.log(`[seed] Regla ${rule.code} OK`);
  }

  // ── Retiro de reglas superadas ─────────────────────────────────────────────
  for (const code of RETIRED_RULE_CODES) {
    await db.execute(
      sql`
        UPDATE tax_rules
           SET is_active  = false,
               updated_at = now()
         WHERE workspace_id IS NULL
           AND code = ${code}
           AND is_active = true
      `,
    );
    console.log(`[seed] Regla ${code} DESACTIVADA (superada)`);
  }

  console.log('[seed] Seed tax-rules-co-2026 completado.');
}
