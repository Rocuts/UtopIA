// ---------------------------------------------------------------------------
// Fiscal Anchor — Calendario DIAN por NIT
// ---------------------------------------------------------------------------
// Reescrito en la auditoría normativa 2026-08. Antes este módulo tenía tres
// tablas de "día fijo por último dígito" (DIA_RETENCION_POR_DIGITO,
// DIA_IVA_POR_DIGITO, DIA_RENTA_PJ) que ignoraban los días hábiles y salían
// con estado `pendiente`, es decir, presentadas al cliente como ciertas.
// Ahora las fechas se derivan de la única regla normativa:
//
//   Decreto 2229 de 2023 (arts. 1.6.1.13.2.x del DUR 1625 de 2016): el plazo va
//   del 7º al 16º día hábil del mes, "atendiendo el último dígito del NIT del
//   declarante que conste en el RUT, SIN TENER EN CUENTA EL DÍGITO DE
//   VERIFICACIÓN" — dígito 1 = 7º día hábil … dígito 0 = 16º.
//   https://normograma.dian.gov.co/dian/compilacion/docs/decreto_2229_2023.htm
//
// El cómputo de días hábiles (festivos incluidos) vive en un único lugar:
// `@/lib/scrapers/dian-scraper`. No se reimplementa aquí: la copia divergente
// de esa regla fue el defecto que corrió todo el calendario nacional.
//
// COBERTURA. `nthBusinessDay` sólo acepta períodos con set de festivos
// verificado (2026 completo + enero 2027). Para cualquier otro año este módulo
// NO inventa fechas: emite el mismo conjunto de obligaciones proyectadas con
// `estado='verificar'` y la norma prefijada con "NO VERIFICADO".
// ---------------------------------------------------------------------------

import { serializeMoneyCop } from '@/lib/agents/financial/contracts/money';
import {
  digitToBusinessDay,
  nthBusinessDay,
  tieneFestivosVerificados,
} from '@/lib/scrapers/dian-scraper';
import type {
  CalendarioDian,
  VencimientoBaseCcv,
  VencimientoDian,
  VencimientoEstado,
  VencimientoFrecuencia,
} from './types';
import type { FiscalDerivedMetrics } from './internal-types';

// ---------------------------------------------------------------------------
// NIT helpers
// ---------------------------------------------------------------------------

/**
 * Resultado de leer el dígito de calendario a partir de un NIT.
 *
 * `ambiguo` es true cuando la cadena no permite saber si el último dígito es
 * el de verificación. En ese caso el calendario se marca `verificar` completo:
 * elegir la fila equivocada de la tabla es exactamente lo que produce la
 * sanción por extemporaneidad.
 */
export interface DigitoCalendario {
  /** Dígito 0–9 a usar contra el calendario DIAN, o -1 si no hay NIT. */
  digito: number;
  ambiguo: boolean;
}

/**
 * Extrae el dígito del NIT que indexa el calendario DIAN.
 *
 * ⚠ Auditoría normativa 2026-08. Esta función devolvía el DÍGITO DE
 * VERIFICACIÓN: para "901714014-6" retornaba 6. El Decreto 2229 de 2023
 * (arts. 1.6.1.13.2.x del DUR 1625 de 2016) es explícito: se atiende
 * "el último dígito del Número de Identificación Tributaria -NIT- del
 * declarante que conste en el certificado del Registro Único Tributario -RUT-,
 * SIN TENER EN CUENTA EL DÍGITO DE VERIFICACIÓN". Para 901714014-6 el dígito
 * de calendario es 4, no 6 — renta PJ 2026 el 15-may y no el 20-may.
 * El DV coincide con el último dígito del cuerpo sólo por azar (~10%).
 *
 * Formatos:
 *   "901714014-6"   → 4  (DV identificable por el separador)
 *   "901.714.014-6" → 4
 *   "901714014"     → 4  (sin DV declarado)
 *   "9017140146"    → 6 + ambiguo: no sabemos si el 6 es DV o parte del NIT
 *   ""  | null      → -1 (señal "NIT ausente")
 *
 * https://normograma.dian.gov.co/dian/compilacion/docs/decreto_2229_2023.htm
 */
export function extractCalendarDigit(nit: string | null | undefined): DigitoCalendario {
  if (!nit) return { digito: -1, ambiguo: false };
  const trimmed = nit.trim();
  if (trimmed.length === 0) return { digito: -1, ambiguo: false };

  // DV declarado por separador: "…-D", "… D", "…/D". El cuerpo es lo de antes.
  const dvMatch = trimmed.match(/^(.*\d)\s*[-/\s]\s*(\d)\s*$/);
  if (dvMatch) {
    const cuerpo = dvMatch[1].replace(/\D+/g, '');
    if (cuerpo.length > 0) {
      return { digito: parseInt(cuerpo.charAt(cuerpo.length - 1), 10), ambiguo: false };
    }
  }

  const digitsOnly = trimmed.replace(/\D+/g, '');
  if (digitsOnly.length === 0) return { digito: -1, ambiguo: false };

  // Sin separador no hay forma de saber si el último dígito es el DV. No
  // adivinamos: devolvemos el último y marcamos ambigüedad para que el
  // calendario salga como `verificar` en vez de como fecha cierta.
  return {
    digito: parseInt(digitsOnly.charAt(digitsOnly.length - 1), 10),
    ambiguo: digitsOnly.length >= 10,
  };
}

/**
 * @deprecated Usa `extractCalendarDigit`, que además señala la ambigüedad.
 * Se conserva porque `fiscal-anchor/index.ts` la reexporta.
 */
export function extractLastDigit(nit: string | null | undefined): number {
  return extractCalendarDigit(nit).digito;
}

// ---------------------------------------------------------------------------
// Tabla de vencimientos 2026 — indexada por último dígito (0..9)
// ---------------------------------------------------------------------------

interface VencimientoTemplate {
  obligacion: string;
  frecuencia: VencimientoFrecuencia;
  baseCcv: VencimientoBaseCcv;
  norma: string;
  /** Fechas ISO YYYY-MM-DD, en orden ascendente. */
  fechasMesDia: string[];
  /**
   * Fuerza `estado='verificar'` aunque la fecha esté en el futuro. Se usa donde
   * la fecha es correcta pero la OBLIGACIÓN puede no aplicarle al contribuyente
   * (periodicidad de IVA, municipio del ICA) o donde el dígito es ambiguo.
   */
  requiereVerificacion?: boolean;
}

/**
 * Único año con calendario de vencimientos verificado (festivos + resolución).
 * Coincide con la cobertura de `nthBusinessDay` en el scraper.
 */
const AÑO_CALENDARIO_VERIFICADO = 2026;

/**
 * Meses de vencimiento de la retención en la fuente durante un año calendario.
 * Son DOCE: el de enero corresponde al período diciembre del año anterior.
 *
 * ⚠ Auditoría 2026-08: el repo arrancaba en febrero (`MESES_RETENCION = [2..12]`),
 * así que durante todo enero el módulo respondía que el próximo vencimiento era
 * en febrero y ocultaba el de enero. Presentar tarde una retención no sólo
 * acarrea el Art. 641 E.T.: la declaración se tiene por NO PRESENTADA si no se
 * paga dentro de los dos meses siguientes (Art. 580-1 E.T.), con el riesgo
 * penal del Art. 402 C.P. por no consignar lo retenido.
 * Arts. 376 y 382 E.T.
 */
const MESES_RETENCION = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/**
 * Meses de vencimiento del IVA bimestral. Art. 600 num. 1 E.T. define SEIS
 * períodos (ene-feb, mar-abr, may-jun, jul-ago, sep-oct, nov-dic); el sexto
 * vence en enero del año siguiente. El repo generaba cinco y el bimestre
 * nov-dic no se alertaba nunca.
 */
const MESES_IVA_BIMESTRAL = [1, 3, 5, 7, 9, 11] as const;

/**
 * Renta de personas jurídicas: DOS cuotas, no una.
 * Art. 1.6.1.13.2.12 del DUR 1625 de 2016 modificado por el Decreto 2229 de
 * 2023 — declaración y pago de la 1ª cuota en mayo (12 a 26 de mayo de 2026),
 * pago de la 2ª cuota en julio (9 a 23 de julio de 2026), ambas por el 7º al
 * 16º día hábil según el último dígito del NIT.
 *
 * ⚠ Auditoría 2026-08: el repo publicaba UNA sola obligación en abril y citaba
 * el Art. 240 E.T., que fija la TARIFA y no el plazo. El contribuyente nunca
 * veía la segunda cuota.
 */
const MESES_RENTA_PJ = [
  { mes: 5, etiqueta: 'Declaración de Renta PJ — Declaración y 1ª cuota' },
  { mes: 7, etiqueta: 'Declaración de Renta PJ — 2ª cuota' },
] as const;

/**
 * ICA bimestral y ReteICA de Bogotá 2026 — Resolución SDH-000195 del
 * 12-dic-2025 (Secretaría Distrital de Hacienda). Fechas ÚNICAS: el distrito no
 * las escalona por dígito de NIT, a diferencia de la DIAN.
 *
 * ⚠ Auditoría 2026-08: el repo las generaba en feb/abr/jun/ago/oct/dic con el
 * día del IVA nacional — dos meses antes del vencimiento real y con norma
 * citada, lo que las hacía parecer verificadas.
 *
 * https://siemprealdia.co/colombia/impuestos/calendario-tributario-distrital-de-bogota/
 */
const ICA_BOGOTA_BIMESTRAL_2026: readonly string[] = [
  '2026-04-10', // B1 ene-feb
  '2026-06-12', // B2 mar-abr
  '2026-08-21', // B3 may-jun
  '2026-10-09', // B4 jul-ago
  '2026-12-11', // B5 sep-oct
  '2027-02-12', // B6 nov-dic
];

/**
 * Fecha del 7º–16º día hábil según el dígito, o `null` si no tenemos festivos
 * verificados para ese período. Nunca se adivina.
 */
function fechaPorDigito(year: number, month: number, digito: number): string | null {
  if (!tieneFestivosVerificados(year, month)) return null;
  return nthBusinessDay(year, month, digitToBusinessDay(digito));
}

/** Vencimientos mensuales de un año calendario + el arrastre a enero siguiente. */
function fechasMensuales(
  year: number,
  meses: readonly number[],
  digito: number,
): string[] {
  const fechas: string[] = [];
  for (const mes of meses) {
    const iso = fechaPorDigito(year, mes, digito);
    if (iso) fechas.push(iso);
  }
  // El vencimiento de enero del año siguiente cierra el ciclo (período
  // diciembre / bimestre nov-dic). Sin él, en diciembre no hay "próxima fecha".
  const eneroSiguiente = fechaPorDigito(year + 1, 1, digito);
  if (eneroSiguiente) fechas.push(eneroSiguiente);
  return fechas;
}

const NORMA_NO_VERIFICADA = 'NO VERIFICADO — ';

function buildTemplatesForDigit(
  ultimoDigito: number,
  year: number,
): VencimientoTemplate[] {
  // Fuera del año con calendario verificado no publicamos fechas calculadas:
  // el set de festivos no existe y `nthBusinessDay` lanzaría. Devolvemos las
  // obligaciones sin fecha para que el caller las proyecte como `verificar`.
  const verificable = year === AÑO_CALENDARIO_VERIFICADO;
  const marca = (norma: string) => (verificable ? norma : NORMA_NO_VERIFICADA + norma);

  const templates: VencimientoTemplate[] = [
    {
      obligacion: 'Retención en la fuente',
      frecuencia: 'mensual',
      baseCcv: 'F06',
      norma: marca(
        'Arts. 376 y 382 E.T.; plazo del 7º al 16º día hábil del mes siguiente ' +
          'según el último dígito del NIT sin DV (Decreto 2229 de 2023).',
      ),
      fechasMesDia: fechasMensuales(year, MESES_RETENCION, ultimoDigito),
      requiereVerificacion: !verificable,
    },
    {
      obligacion: 'IVA bimestral',
      frecuencia: 'bimestral',
      baseCcv: 'F05',
      norma: marca(
        'Art. 600 num. 1 E.T. (seis bimestres); plazo del 7º al 16º día hábil ' +
          'del mes siguiente al cierre (Decreto 2229 de 2023). Si sus ingresos ' +
          'brutos a 31-dic del año anterior fueron inferiores a 92.000 UVT, su ' +
          'periodicidad es CUATRIMESTRAL (Art. 600 num. 2 E.T.) y estas fechas ' +
          'no le aplican.',
      ),
      fechasMesDia: fechasMensuales(year, MESES_IVA_BIMESTRAL, ultimoDigito),
      // La FECHA es exacta para un declarante bimestral; lo que no sabemos es
      // si esa es su periodicidad (no tenemos sus ingresos brutos). La salvedad
      // viaja en `norma`, no en el estado: silenciar la alerta de 15 días sobre
      // un IVA que sí vence sería peor que mostrarla con la advertencia.
      requiereVerificacion: !verificable,
    },
    {
      obligacion: 'ICA bimestral — Bogotá D.C.',
      frecuencia: 'bimestral',
      baseCcv: 'F07',
      norma: marca(
        'Resolución SDH-000195 del 12-dic-2025 (Secretaría Distrital de Hacienda ' +
          'de Bogotá); Acuerdo Distrital 65 de 2002. Fecha única, sin escalonamiento ' +
          'por NIT. Aplica solo a Bogotá y solo a régimen común con impuesto a cargo ' +
          '2025 superior a 391 UVT: verifique el calendario de su municipio.',
      ),
      fechasMesDia: verificable ? ICA_BOGOTA_BIMESTRAL_2026.slice() : [],
      // El municipio del contribuyente no se conoce en este módulo.
      requiereVerificacion: true,
    },
  ];

  for (const { mes, etiqueta } of MESES_RENTA_PJ) {
    const iso = fechaPorDigito(year, mes, ultimoDigito);
    templates.push({
      obligacion: etiqueta,
      frecuencia: 'anual',
      baseCcv: 'F04',
      norma: marca(
        'Art. 1.6.1.13.2.12 del DUR 1625 de 2016 (modif. Decreto 2229 de 2023); ' +
          'art. 591 E.T. Declaración y 1ª cuota en mayo, 2ª cuota en julio.',
      ),
      fechasMesDia: iso ? [iso] : [],
      requiereVerificacion: !verificable,
    });
  }

  return templates;
}

// ---------------------------------------------------------------------------
// Selección de próximo vencimiento + cálculo de estado
// ---------------------------------------------------------------------------

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysBetween(from: Date, to: Date): number {
  // Diferencia en días naturales redondeada (UTC-day-floor para evitar DST).
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / MS_PER_DAY);
}

interface PickedDate {
  iso: string;
  diasRestantes: number;
  /** True si tuvimos que proyectar al año siguiente (estado=verificar). */
  projectedNextYear: boolean;
}

function isoDate(year: number, monthOneBased: number, day: number): string {
  const mm = String(monthOneBased).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function pickNextOrProject(
  candidates: readonly string[],
  hoy: Date,
  baseYear: number,
): PickedDate {
  for (const iso of candidates) {
    const target = new Date(`${iso}T00:00:00Z`);
    const dr = daysBetween(hoy, target);
    if (dr >= 0) {
      return { iso, diasRestantes: dr, projectedNextYear: false };
    }
  }
  // Todas las fechas del año ya pasaron — proyectamos al equivalente del año
  // siguiente. Pintamos `verificar` porque no podemos garantizar el día exacto:
  // el día hábil que corresponde al dígito cambia con los festivos del año.
  const first = candidates[0];
  if (!first) {
    // Sin fechas configuradas (año sin calendario verificado). Devolvemos hoy
    // marcado como proyección para que el estado salga `verificar` y nunca
    // como una fecha cierta.
    const todayIso = isoDate(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, hoy.getUTCDate());
    return { iso: todayIso, diasRestantes: 0, projectedNextYear: true };
  }
  const [, mm, dd] = first.split('-');
  const projectedIso = `${baseYear + 1}-${mm}-${dd}`;
  const target = new Date(`${projectedIso}T00:00:00Z`);
  const dr = daysBetween(hoy, target);
  return { iso: projectedIso, diasRestantes: dr, projectedNextYear: true };
}

function computeEstado(
  diasRestantes: number,
  projectedNextYear: boolean,
  requiereVerificacion: boolean,
): VencimientoEstado {
  // `verificar` gana sobre `pendiente`: una fecha correcta cuya OBLIGACIÓN
  // puede no aplicarle al contribuyente (periodicidad de IVA, municipio del
  // ICA, dígito de NIT ambiguo) no puede presentarse como cierta.
  if (projectedNextYear || requiereVerificacion) return 'verificar';
  if (diasRestantes < 0) return 'vencido';
  if (diasRestantes <= 15) return 'proximo';
  return 'pendiente';
}

// ---------------------------------------------------------------------------
// Valor estimado por base CCV
// ---------------------------------------------------------------------------

const ZERO = BigInt(0);

function absBigInt(value: bigint): bigint {
  return value < ZERO ? -value : value;
}

/**
 * Valor estimado a presentar en el vencimiento según la base CCV declarada
 * por el template. F04 puede ser negativa (saldo a favor); para mostrar el
 * "valor a pagar" devolvemos la magnitud absoluta — el dictamen distingue
 * el signo en F04 directamente.
 */
function valorEstimadoCents(
  baseCcv: VencimientoBaseCcv,
  metrics: FiscalDerivedMetrics,
): bigint {
  switch (baseCcv) {
    case 'F03':
      return metrics.f03Cents;
    case 'F04':
      return absBigInt(metrics.f04Cents);
    case 'F05':
      return metrics.f05Cents;
    case 'F06':
      return metrics.f06Cents;
    case 'F07':
      return metrics.f07Cents;
  }
}

// ---------------------------------------------------------------------------
// Builder principal
// ---------------------------------------------------------------------------

export interface BuildCalendarioDianInput {
  /** NIT formateado del archivo o intake. `null` si no se pudo extraer. */
  nit: string | null;
  /** Fecha de cálculo — el orchestrator pasa `new Date()`. */
  hoy: Date;
  /**
   * Año GRAVABLE del balance (etiqueta, p. ej. "2025"). NO es el año de los
   * vencimientos: esos salen siempre del año calendario de `hoy`.
   */
  periodo?: string;
  /** Métricas derivadas (para `valorEstimado`). */
  metrics: FiscalDerivedMetrics;
}

export function buildCalendarioDian(input: BuildCalendarioDianInput): CalendarioDian {
  const { nit, hoy, metrics } = input;
  const { digito: ultimoDigitoRaw, ambiguo } = extractCalendarDigit(nit);
  const ultimoDigito = ultimoDigitoRaw >= 0 ? ultimoDigitoRaw : 0;

  // `periodo` es el AÑO GRAVABLE del balance (p. ej. "2025"); los vencimientos
  // que hay que anunciar son los del año CALENDARIO en curso. Usar el año
  // gravable como año de vencimientos generaba todo el calendario en el pasado.
  const year = hoy.getUTCFullYear();

  const templates = buildTemplatesForDigit(ultimoDigito, year);

  // Sin NIT no hay fila de calendario: el dígito 0 es el 16º día hábil, la
  // fecha MÁS TARDÍA de la tabla. Presentarla como cierta a quien no dio NIT
  // es precisamente inducir extemporaneidad.
  const sinNit = ultimoDigitoRaw < 0;
  const dudaSobreElDigito = sinNit || ambiguo;

  const vencimientos: VencimientoDian[] = templates.map((tpl) => {
    const picked = pickNextOrProject(tpl.fechasMesDia, hoy, year);
    const norma = dudaSobreElDigito
      ? `${NORMA_NO_VERIFICADA}${
          sinNit
            ? 'no se recibió el NIT'
            : 'el NIT llegó sin separador de dígito de verificación, no se puede saber cuál es el último dígito sin DV'
        }; se muestra una fecha de referencia. ${tpl.norma}`
      : tpl.norma;
    return {
      obligacion: tpl.obligacion,
      frecuencia: tpl.frecuencia,
      proximoVencimiento: picked.iso,
      diasRestantes: picked.diasRestantes,
      estado: computeEstado(
        picked.diasRestantes,
        picked.projectedNextYear,
        Boolean(tpl.requiereVerificacion) || dudaSobreElDigito,
      ),
      baseCcv: tpl.baseCcv,
      valorEstimado: serializeMoneyCop(valorEstimadoCents(tpl.baseCcv, metrics)),
      norma,
    };
  });

  // Re-ordenamos por días restantes ascendente para que el UI muestre primero
  // los inminentes. `verificar` (negativo) cae al final por el sort natural.
  vencimientos.sort((a, b) => {
    if (a.estado === 'verificar' && b.estado !== 'verificar') return 1;
    if (b.estado === 'verificar' && a.estado !== 'verificar') return -1;
    return a.diasRestantes - b.diasRestantes;
  });

  return {
    nit: nit ?? '',
    ultimoDigito: ultimoDigitoRaw,
    periodo: input.periodo ?? String(year),
    vencimientos,
    alertaAnticipacionDias: 15,
  };
}
