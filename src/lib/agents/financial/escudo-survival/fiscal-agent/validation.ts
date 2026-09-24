// ---------------------------------------------------------------------------
// Capa 4 — Agente Fiscal — Validación determinista del reporte
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (tributario-modulos-03): `validateFiscalResponse` existía
// pero ninguna ruta lo invocaba. Este adaptador construye el `FiscalResponse`
// que el validador espera a partir del `FiscalAgentReport` y adjunta el
// veredicto al reporte.
//
// Cobertura conectada:
//   - Capa 2 (Motor Normativo): citas y blacklist sobre todo el texto emitido.
//   - M2 (Conciliación): identidades y tope del Art. 258 sobre las cifras ya
//     recalculadas en código.
//   - M7 (Formato): cierre, reservas léxicas, formato es-CO del dictamen.
// No conectado (requiere rediseño del contrato del validador): M3 (factores
// distintos a los de computeRiskScore), M5 (tipos de requerimiento con otra
// taxonomía) y M6 (exige origen del saldo y F04 como saldo a favor, que ya no
// se publica). El Score y las Devoluciones se sobrescriben con el cálculo
// determinista en sus agentes.
// ---------------------------------------------------------------------------

import { MOTOR_NORMATIVO_CATALOG } from '../normative';
import {
  summarizeFiscalChecks,
  validateFiscalResponse,
  type FiscalModuleId,
  type FiscalResponse,
  type Modulo2Conciliacion,
  type ValidationCheck,
} from './validators';
import type { ConciliacionModuleResult, FiscalAgentMode, FiscalAgentReport } from './types';

export interface FiscalAgentValidation {
  veredicto: 'valida' | 'advertencia' | 'bloqueo';
  errores: number;
  advertencias: number;
  checks: ValidationCheck[];
  /** Módulos cuyo validador no se pudo conectar (contrato incompatible). */
  modulosSinValidar: string[];
}

function absSum(values: readonly string[]): bigint {
  return values.reduce((acc, v) => {
    const b = /^-?\d+$/.test(v) ? BigInt(v) : BigInt(0);
    return acc + (b < BigInt(0) ? -b : b);
  }, BigInt(0));
}

function toModulo2(c: ConciliacionModuleResult): Modulo2Conciliacion {
  const l = c.data.lineas;
  const adiciones = l.filter((x) => x.tipo === 'adicion');
  const deducciones = l.filter((x) => x.tipo === 'deduccion' || x.tipo === 'renta_exenta' || x.tipo === 'incrgno');
  const descuentos = l.filter((x) => x.tipo === 'descuento');
  const d258_1 = descuentos.filter((x) => /258-1/.test(x.norma));
  const d254 = descuentos.filter((x) => /\b254\b/.test(x.norma) && !/258-1/.test(x.norma));
  const dOtros = descuentos.filter((x) => !/258-1/.test(x.norma));
  return {
    uaiCents: c.data.uaiContable,
    adicionesCents: absSum(adiciones.map((x) => x.monto)).toString(),
    deduccionesCents: absSum(deducciones.map((x) => x.monto)).toString(),
    rentaLiquidaCents: c.data.rentaLiquidaGravable,
    impuestoBrutoCents: c.data.impuestoBruto,
    descuento258_1Cents: absSum(d258_1.map((x) => x.monto)).toString(),
    descuentos254_256_257Cents: absSum(dOtros.map((x) => x.monto)).toString(),
    descuento254Cents: absSum(d254.map((x) => x.monto)).toString(),
    impuestoNetoCents: c.data.impuestoNeto,
    tarifa: c.data.tarifaPct,
    detallesAdiciones: adiciones.map((x) => ({ concepto: x.concepto, montoCents: absSum([x.monto]).toString(), norma: x.norma })),
    detallesDeducciones: deducciones.map((x) => ({ concepto: x.concepto, montoCents: absSum([x.monto]).toString(), norma: x.norma })),
    closingNote: c.data.disclaimer,
    rentasExentasCents: absSum(l.filter((x) => x.tipo === 'renta_exenta').map((x) => x.monto)).toString(),
  };
}

export function buildFiscalAgentValidation(
  report: Omit<FiscalAgentReport, 'validation'>,
  mode: FiscalAgentMode,
): FiscalAgentValidation {
  const modulos: FiscalModuleId[] = ['M7'];
  if (report.conciliacion) modulos.push('M2');
  const rawText = [
    report.ccv.markdown,
    report.riskScore.markdown,
    report.conciliacion?.markdown,
    report.planeacion?.markdown,
    report.defensaDian?.markdown,
    report.devoluciones?.markdown,
    report.supervivencia?.markdown,
    report.synthesis.markdown,
  ]
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .join('\n\n');
  const response: FiscalResponse = {
    modulos,
    modulo2: report.conciliacion ? toModulo2(report.conciliacion) : null,
    modulo3: null,
    modulo5: null,
    modulo6: null,
    modulo7: { textoSalida: report.synthesis.markdown, modo: mode === 'quick' ? 'quick' : 'full' },
    rawText,
  };
  const checks = validateFiscalResponse(response, { catalogue: MOTOR_NORMATIVO_CATALOG });
  const v = summarizeFiscalChecks(checks);
  const modulosSinValidar = [
    'M3 (Score: se publica el cálculo determinista)',
    ...(report.defensaDian ? ['M5 (Defensa DIAN: taxonomía de requerimientos distinta)'] : []),
    ...(report.devoluciones ? ['M6 (Devoluciones: se publica el análisis determinista)'] : []),
  ];
  return {
    veredicto: v.veredicto,
    errores: v.errores,
    advertencias: v.advertencias,
    checks,
    modulosSinValidar,
  };
}
