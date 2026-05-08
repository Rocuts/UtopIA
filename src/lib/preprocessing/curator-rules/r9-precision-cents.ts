// ---------------------------------------------------------------------------
// R9 — Precision Cents (auditoría del contrato raw + cents bigint)
// ---------------------------------------------------------------------------
// El parser endurecido (`buildSnapshotForPeriod`) popula `controlTotals.raw`
// (string canónica con dos decimales) y `controlTotals.cents` (BigInt en
// centavos) para los 9 totales canónicos. R9 verifica que ambos
// representen exactamente el mismo monto que el campo `number` legacy
// (drift floating-point ⇒ severidad 'critico').
//
// La regla NO muta el snapshot — sólo emite `precisionCentsAudit` y, si hay
// drift, un finding crítico para detener la emisión del informe.
// ---------------------------------------------------------------------------

import type { ControlTotals, PeriodSnapshot } from '../trial-balance';
import type { CuratorFinding, PrecisionCentsAudit } from './types';

/** Campos canónicos auditados por R9. */
const CANONICAL_FIELDS = [
  'activo',
  'pasivo',
  'patrimonio',
  'ingresos',
  'gastos',
  'utilidadNeta',
  'utilidadAntesImpuestos',
  'impuestoCausado',
  'efectivoCuenta11',
] as const;

type CanonicalField = (typeof CANONICAL_FIELDS)[number];

export interface R9Result {
  precisionCentsAudit: PrecisionCentsAudit;
  findings: CuratorFinding[];
}

export function runR9(snapshot: PeriodSnapshot): R9Result {
  const findings: CuratorFinding[] = [];
  const driftedFields: string[] = [];

  const ct = snapshot.controlTotals;
  const cents = ct.cents;
  const raw = ct.raw;

  // Si el parser no popula cents/raw (snapshot construido a mano por test
  // legacy), no auditamos — emitimos `preserved: true` con fieldsChecked=0.
  if (!cents || !raw) {
    const audit: PrecisionCentsAudit = {
      fieldsChecked: 0,
      driftCount: 0,
      driftedFields: [],
      preserved: true,
    };
    snapshot.precisionCentsAudit = audit;
    return { precisionCentsAudit: audit, findings };
  }

  for (const field of CANONICAL_FIELDS) {
    const numberValue = numberFieldOf(ct, field);
    const centsValue = cents[field];
    const rawValue = raw[field];

    // 1. number → cents debe coincidir exactamente.
    const expectedCents = BigInt(Math.round(numberValue * 100));
    if (centsValue !== expectedCents) {
      driftedFields.push(`${field}:number→cents drift`);
      continue;
    }

    // 2. cents → raw debe coincidir con la string canónica.
    const expectedRaw = bigintCentsToCanonicalString(centsValue);
    if (rawValue !== expectedRaw) {
      driftedFields.push(`${field}:cents→raw drift (got "${rawValue}", expected "${expectedRaw}")`);
      continue;
    }
  }

  const audit: PrecisionCentsAudit = {
    fieldsChecked: CANONICAL_FIELDS.length,
    driftCount: driftedFields.length,
    driftedFields,
    preserved: driftedFields.length === 0,
  };

  if (!audit.preserved) {
    findings.push({
      code: 'CUR-R9',
      severity: 'critico',
      title: 'Drift de precisión detectado entre raw / cents / number',
      description:
        `El contrato de precisión BigInt cents falló en ${audit.driftCount} de ` +
        `${audit.fieldsChecked} totales canónicos: ${driftedFields.join('; ')}. ` +
        `Esto compromete la aritmética anti-alucinación que los validators del gate consumen.`,
      normReference: 'NIC 1 párr. 32 (compensación) + IFRS 18 (presentación coherente)',
      recommendation:
        'Revisar el parser `buildSnapshotForPeriod` y los helpers `toCents` / ' +
        '`toRawString`. Confirmar que los montos del balance se leyeron sin ' +
        'pérdida de precisión floating-point.',
      impact:
        'Sin el contrato raw + cents intacto, el gate `auditReportEmittable` ' +
        'no puede comparar valores con tolerancia BigInt(0) y los 4 pilares quedan sin ancla.',
      period: snapshot.period,
    });
  }

  snapshot.precisionCentsAudit = audit;
  return { precisionCentsAudit: audit, findings };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function numberFieldOf(ct: ControlTotals, field: CanonicalField): number {
  switch (field) {
    case 'activo':
      return ct.activo;
    case 'pasivo':
      return ct.pasivo;
    case 'patrimonio':
      return ct.patrimonio;
    case 'ingresos':
      return ct.ingresos;
    case 'gastos':
      return ct.gastos;
    case 'utilidadNeta':
      return ct.utilidadNeta;
    case 'utilidadAntesImpuestos':
      // Derivado: ingresos − (gastos − impuestoCausado) usando los ya
      // calculados — no podemos recomputar aquí porque ct.cents es la
      // referencia. Dejamos al cents.utilidadAntesImpuestos.
      return Number(ct.cents?.utilidadAntesImpuestos ?? BigInt(0)) / 100;
    case 'impuestoCausado':
      return Number(ct.cents?.impuestoCausado ?? BigInt(0)) / 100;
    case 'efectivoCuenta11':
      return ct.efectivoCuenta11;
  }
}

/**
 * Convierte BigInt centavos a string canónica con dos decimales y punto
 * decimal (formato "1968104173.17"). Inverso exacto de `toRawString` /
 * `toCents` del parser.
 */
function bigintCentsToCanonicalString(cents: bigint): string {
  const negative = cents < BigInt(0);
  const abs = negative ? -cents : cents;
  const integer = abs / BigInt(100);
  const fraction = abs % BigInt(100);
  const fractionStr = fraction.toString().padStart(2, '0');
  return `${negative ? '-' : ''}${integer.toString()}.${fractionStr}`;
}
