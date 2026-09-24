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
//   - M3 (Score): invariantes del cálculo determinista y prosa del modelo que
//     lo cita (fase 2, pendiente #8).
//   - M5 (Defensa DIAN): tipo/plazo del esqueleto determinista y estructura,
//     citas y cierre de la carta (fase 2, pendiente #8).
//   - M6 (Devoluciones): saldo DECLARADO, viabilidad y que la prosa no
//     presente F04 como saldo a favor (fase 2, pendiente #8).
//   - M7 (Formato): cierre, reservas léxicas, formato es-CO del dictamen.
// ---------------------------------------------------------------------------

import { MOTOR_NORMATIVO_CATALOG } from '../normative';
import {
  summarizeFiscalChecks,
  validateFiscalResponse,
  type FiscalModuleId,
  type FiscalResponse,
  type Modulo2Conciliacion,
  type Modulo3RiskScore,
  type Modulo5DefensaDian,
  type Modulo6Devoluciones,
  type ValidationCheck,
} from './validators';
import type { FiscalAnchorBlock } from '../fiscal-anchor/types';
import type {
  ConciliacionModuleResult,
  DefensaDianModuleResult,
  DevolucionesModuleResult,
  FiscalAgentMode,
  FiscalAgentReport,
  RiskScoreModuleResult,
  SupervivenciaModuleResult,
} from './types';

export interface FiscalAgentValidation {
  veredicto: 'valida' | 'advertencia' | 'bloqueo';
  errores: number;
  advertencias: number;
  checks: ValidationCheck[];
  /** Módulos cuyo validador no se pudo conectar (contrato incompatible). */
  modulosSinValidar: string[];
}

/** Insumos deterministas que el reporte no repite y que M3/M6 necesitan. */
export interface FiscalAgentValidationContext {
  fiscalAnchor: Pick<FiscalAnchorBlock, 'f01' | 'f04'>;
  /** Saldo a favor liquidado en el Formulario 110 que recibió el agente. */
  saldoAFavorDeclaradoCents: string | null;
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

function toModulo3(
  r: RiskScoreModuleResult,
  supervivencia: SupervivenciaModuleResult | null,
  mode: FiscalAgentMode,
  ctx: FiscalAgentValidationContext,
): Modulo3RiskScore {
  return {
    score: r.data.score,
    nivel: r.data.nivel,
    factores: r.data.factores.map((f) => ({ factor: f.factor, puntos: f.puntos })),
    publicable: r.data.publicable,
    noPublicableMotivo: r.data.noPublicableMotivo,
    f01Cents: ctx.fiscalAnchor.f01,
    narrativa: [r.markdown, r.data.interpretacion].join('\n\n'),
    recomendaciones: r.data.recomendaciones,
    modoSupervivenciaActivo: mode === 'supervivencia' ? (supervivencia?.data.activo ?? false) : null,
  };
}

function toModulo5(d: DefensaDianModuleResult): Modulo5DefensaDian {
  return {
    tipoRequerimiento: d.data.tipoRequerimiento,
    plazoRespuesta: d.data.plazoRespuesta,
    normaPlazo: d.data.normaPlazo,
    cartaTexto: d.data.cartaCompleta,
    defensaArt647: d.data.defensaArt647,
  };
}

function toModulo6(d: DevolucionesModuleResult, ctx: FiscalAgentValidationContext): Modulo6Devoluciones {
  return {
    saldoDeclaradoCents: ctx.saldoAFavorDeclaradoCents,
    saldoAFavorCents: d.data.saldoAFavor,
    viabilidad: d.data.viabilidad,
    f04Cents: ctx.fiscalAnchor.f04,
    textoAnalisis: [d.markdown, ...d.data.riesgosIdentificados].join('\n\n'),
    documentosRequeridos: d.data.documentosRequeridos,
    pasosProcedimentales: d.data.pasosProcedimentales,
  };
}

export function buildFiscalAgentValidation(
  report: Omit<FiscalAgentReport, 'validation'>,
  mode: FiscalAgentMode,
  ctx: FiscalAgentValidationContext,
): FiscalAgentValidation {
  const modulos: FiscalModuleId[] = ['M3', 'M7'];
  if (report.conciliacion) modulos.push('M2');
  if (report.defensaDian) modulos.push('M5');
  if (report.devoluciones) modulos.push('M6');
  const rawText = [
    report.ccv.markdown,
    report.riskScore.markdown,
    report.conciliacion?.markdown,
    report.planeacion?.markdown,
    report.defensaDian?.markdown,
    report.defensaDian?.data.cartaCompleta,
    report.devoluciones?.markdown,
    report.supervivencia?.markdown,
    report.synthesis.markdown,
  ]
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .join('\n\n');
  const response: FiscalResponse = {
    modulos,
    modulo2: report.conciliacion ? toModulo2(report.conciliacion) : null,
    modulo3: toModulo3(report.riskScore, report.supervivencia, mode, ctx),
    modulo5: report.defensaDian ? toModulo5(report.defensaDian) : null,
    modulo6: report.devoluciones ? toModulo6(report.devoluciones, ctx) : null,
    modulo7: { textoSalida: report.synthesis.markdown, modo: mode === 'quick' ? 'quick' : 'full' },
    rawText,
  };
  const checks = validateFiscalResponse(response, { catalogue: MOTOR_NORMATIVO_CATALOG });
  const v = summarizeFiscalChecks(checks);
  return {
    veredicto: v.veredicto,
    errores: v.errores,
    advertencias: v.advertencias,
    checks,
    modulosSinValidar: [],
  };
}
