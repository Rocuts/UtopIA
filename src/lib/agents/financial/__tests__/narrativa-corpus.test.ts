// ---------------------------------------------------------------------------
// Corpus del validador de prosa (re-auditoría 2 de la fase 2, 2026-09-24)
// ---------------------------------------------------------------------------
// Criterio rector: ninguna cifra sin respaldo puede salir con sello de
// procedencia verificada, y ningún informe honesto puede quedar sellado. Este
// corpus fija las dos caras sobre los balances de la suite:
//   - frases HONESTAS con la redacción habitual de notas NIIF para las PYMES y
//     de actas de asamblea colombianas (incluidas las de los auditores de la
//     re-auditoría) y las cifras de cada balance → ningún motivo;
//   - frases FALSAS con la misma redacción y una cifra sin respaldo → al menos
//     un motivo en cada Parte que cruza el concepto.
// Balances: informe coherente (sin preprocesado), traza de la pérdida con
// comparativo (traza-cifras-extremo-a-extremo), tres cortes (comparativos del
// EFE/ECP), el export de ERP real de anclas-pyg-y-comparativo y la S.A. con
// aritmética del acta.
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  checkGovernanceNarrative,
  checkNiifNarrative,
  checkStrategyNarrative,
  narrativeSourcesFromPreprocessed,
  type NarrativeAnchorSources,
} from '@/lib/agents/financial/validators/narrative-anchors';
import { buildActaExpectedArithmetic } from '@/lib/agents/financial/prompts/governance-specialist.prompt';
import { buildPeriodAnchors } from '@/lib/agents/financial/contracts/anchors';
import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import { makeCoherentNiifReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { informeHonesto, preprocesarPerdidaComparativo } from '@/lib/agents/financial/__fixtures__/perdida-comparativo-w4a';
import { informeTresCortes, preprocesarTresCortes } from '@/lib/agents/financial/__fixtures__/tres-cortes-comparativo';
import { COMPANY_SA, govJson, ppSA, strategyJson } from '@/lib/agents/financial/__fixtures__/narrativa-corpus';
import { parseTrialBalanceCSV, preprocessTrialBalance, type PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import type { ActaArithmetic } from '@/lib/agents/financial/contracts/base';

// ---------------------------------------------------------------------------
// Escenarios
// ---------------------------------------------------------------------------

interface Scenario {
  name: string;
  pp: PreprocessedBalance | null;
  niif: NiifReportJson | null;
  acta: ActaArithmetic | null;
  year: string;
  compYear: string | null;
  /** Anclas en centavos. */
  un: bigint;
  unComp: bigint | null;
  activo: bigint;
  pasivo: bigint;
  patrimonio: bigint;
  patrimonioComp: bigint | null;
  efectivo: bigint;
  ingresos: bigint | null;
  ebitda: bigint | null;
  roe: number | null;
}

const B = (n: number | string | bigint) => BigInt(n);
const ZERO = B(0);
const absB = (v: bigint) => (v < ZERO ? -v : v);
const cop = (cents: bigint) => formatCopFromCents(absB(cents), false);
/** Cifra sin respaldo: el triple del ancla más $1.234.567,89 (nunca coincide por azar). */
const wrong = (cents: bigint) => cop(absB(cents) * B(3) + B(123456789));
const millions = (cents: bigint) =>
  `$${(Number(absB(cents)) / 100 / 1e6).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} M`;
const pesos = (cents: bigint) => Number(cents) / 100;

function fromPreprocessed(name: string, pp: PreprocessedBalance, niif: NiifReportJson | null, acta: ActaArithmetic | null): Scenario {
  const a = buildPeriodAnchors(pp.primary)!.cents as Record<string, bigint | undefined>;
  const c = pp.comparative ? (buildPeriodAnchors(pp.comparative)?.cents as Record<string, bigint | undefined>) : undefined;
  const ebitda = pp.primary.controlTotals.ebitda;
  const roe = pp.primary.controlTotals.roe;
  return {
    name,
    pp,
    niif,
    acta,
    year: pp.primary.period.match(/\d{4}/)![0],
    compYear: pp.comparative?.period.match(/\d{4}/)?.[0] ?? null,
    un: a.utilidadNeta!,
    unComp: c?.utilidadNeta ?? null,
    activo: a.activo!,
    pasivo: a.pasivo!,
    patrimonio: a.patrimonio!,
    patrimonioComp: c?.patrimonio ?? null,
    efectivo: a.efectivoCuenta11!,
    ingresos: a.ingresosOperacionales ?? a.ingresosNetos ?? null,
    ebitda: typeof ebitda === 'number' ? B(Math.round(ebitda * 100)) : null,
    roe: typeof roe === 'number' ? roe : null,
  };
}

function coherent(): Scenario {
  const niif = makeCoherentNiifReport();
  return {
    name: 'informe coherente (sin preprocesado)',
    pp: null,
    niif,
    acta: null,
    year: '2025',
    compYear: null,
    un: B(niif.incomeStatement.netIncomePrimary),
    unComp: null,
    activo: B(niif.balanceSheet.totalAssetsPrimary),
    pasivo: B(niif.balanceSheet.totalLiabilitiesPrimary),
    patrimonio: B(niif.balanceSheet.totalEquityPrimary),
    patrimonioComp: null,
    efectivo: B(niif.cashFlow.cashClosing),
    ingresos: null,
    ebitda: null,
    roe: null,
  };
}

async function loadRealBalance(): Promise<PreprocessedBalance> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.resolve(process.cwd(), 'src/lib/preprocessing/__fixtures__/grupo-empresarial-2tres-sas.xlsx'));
  const ws = wb.worksheets[0];
  const lines: string[] = [];
  const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  ws.eachRow((row) => {
    const values = row.values as unknown[];
    lines.push(
      values
        .slice(1)
        .map((v) => {
          if (v === null || v === undefined) return '';
          if (typeof v === 'string') return csvCell(v);
          if (typeof v === 'number') return String(v);
          const o = v as { text?: string; result?: unknown };
          return csvCell(o.text ?? (o.result !== undefined ? String(o.result) : String(v)));
        })
        .join(','),
    );
  });
  return preprocessTrialBalance(parseTrialBalanceCSV(lines.slice(7).join('\n')));
}

// ---------------------------------------------------------------------------
// Cruce por Parte
// ---------------------------------------------------------------------------

type Part = 'I' | 'II' | 'III-notas' | 'III-acta';

function sources(s: Scenario, withActa: boolean): NarrativeAnchorSources {
  if (!s.pp) return { niif: s.niif, ...(withActa ? { acta: s.acta } : {}) };
  return narrativeSourcesFromPreprocessed(s.pp, s.niif, withActa ? { acta: s.acta } : {});
}

function motivosIn(part: Part, s: Scenario, text: string): string[] {
  switch (part) {
    case 'I': {
      if (!s.niif) return [];
      const json: NiifReportJson = { ...s.niif, technicalNotes: [...s.niif.technicalNotes, { ref: 'Nota C', norma: null, body: text }] };
      return checkNiifNarrative(json, sources(s, false)).motivos;
    }
    case 'II':
      return checkStrategyNarrative(strategyJson(text), sources(s, false)).motivos;
    case 'III-notas':
      return checkGovernanceNarrative(govJson({ notes: [text], acta: s.acta }), sources(s, true)).motivos;
    case 'III-acta':
      return checkGovernanceNarrative(govJson({ developments: [text], acta: s.acta }), sources(s, true)).motivos;
  }
}

/** Partes donde se cruza el concepto: estados → todas; ratios → II/III; acta → III. */
type Scope = 'estados' | 'ratios' | 'acta';
const PARTS: Record<Scope, Part[]> = {
  estados: ['I', 'II', 'III-notas', 'III-acta'],
  ratios: ['II', 'III-notas', 'III-acta'],
  acta: ['III-notas', 'III-acta'],
};

interface Phrase {
  id: string;
  scope: Scope;
  /** `null` = no aplica al escenario (p. ej. sin comparativo o sin ingresos). */
  text: (s: Scenario) => string | null;
}

const res = (v: bigint) => (v < ZERO ? 'pérdida' : 'utilidad');
const pct = (cents: bigint, p: number) => (absB(cents) * B(p)) / B(100);

// ---------------------------------------------------------------------------
// Frases HONESTAS
// ---------------------------------------------------------------------------

const HONEST: Phrase[] = [
  // Resultado del ejercicio
  { id: 'H01', scope: 'estados', text: (s) => `La ${res(s.un)} neta del ejercicio ${s.year} asciende a ${cop(s.un)}.` },
  { id: 'H02', scope: 'estados', text: (s) => `El resultado del ejercicio ${s.year} fue una ${res(s.un)} de ${cop(s.un)}.` },
  { id: 'H03', scope: 'estados', text: (s) => `La ${res(s.un)} del ejercicio, por ${cop(s.un)}, se traslada a resultados acumulados.` },
  { id: 'H04', scope: 'estados', text: (s) => `La entidad presenta la ${res(s.un)} neta (${cop(s.un)}) conforme a la Sección 5 de la NIIF para las PYMES.` },
  { id: 'H05', scope: 'estados', text: (s) => (s.un > ZERO ? `La sociedad obtuvo utilidades por ${cop(s.un)} en el ejercicio ${s.year}.` : null) },
  { id: 'H06', scope: 'estados', text: (s) => (s.un < ZERO ? `El resultado neto del ejercicio fue una pérdida de ${cop(s.un)}.` : `El resultado neto del ejercicio fue de ${cop(s.un)}.`) },
  { id: 'H07', scope: 'estados', text: (s) => `La sociedad, identificada con NIT 900.123.456-7, presenta una ${res(s.un)} neta de ${cop(s.un)}.` },
  { id: 'H08', scope: 'estados', text: (s) => `La asamblea aprueba los estados financieros con corte al 31 de diciembre de ${s.year}, que muestran una ${res(s.un)} neta de ${cop(s.un)}.` },
  { id: 'H09', scope: 'estados', text: (s) => (s.unComp === null ? null : `En ${s.compYear} la ${res(s.unComp)} neta fue de ${cop(s.unComp)}.`) },
  {
    id: 'H10', scope: 'estados',
    text: (s) => (s.unComp === null || s.un < ZERO || s.unComp < ZERO ? null : `La utilidad neta pasó de ${cop(s.unComp)} en ${s.compYear} a ${cop(s.un)} en ${s.year}.`),
  },
  {
    id: 'H11', scope: 'estados',
    text: (s) => (s.unComp === null || s.un < ZERO || s.unComp < ZERO ? null : `La utilidad neta, frente a ${cop(s.unComp)} de ${s.compYear}, fue de ${cop(s.un)}.`),
  },
  { id: 'H12', scope: 'estados', text: () => 'La utilidad neta aumentó $5.000.000,00 frente al presupuesto.' },
  { id: 'H13', scope: 'estados', text: () => 'La variación de la utilidad neta fue de $1.000.000,00 frente al periodo anterior.' },
  { id: 'H14', scope: 'estados', text: (s) => `Para ${Number(s.year) + 1} se proyecta una utilidad neta de $30.000.000,00.` },
  { id: 'H15', scope: 'estados', text: () => 'La utilidad neta por acción fue de $500,00.' },
  // Balance
  { id: 'H16', scope: 'estados', text: (s) => `Al 31 de diciembre de ${s.year} el total de activos asciende a ${cop(s.activo)} y el total de pasivos a ${cop(s.pasivo)}.` },
  { id: 'H17', scope: 'estados', text: (s) => `Los activos de la sociedad suman ${cop(s.activo)}, presentados por orden de liquidez.` },
  { id: 'H18', scope: 'estados', text: (s) => `El total de activos, cercano a ${millions(s.activo)}, se presenta por grupo PUC.` },
  { id: 'H19', scope: 'estados', text: (s) => `El total de pasivos y patrimonio asciende a ${cop(s.activo)}, igual al total de activos.` },
  { id: 'H20', scope: 'estados', text: (s) => `Pasivo más patrimonio suma ${cop(s.activo)}.` },
  { id: 'H21', scope: 'estados', text: () => 'El total de activos fijos (propiedad, planta y equipo neto) asciende a $12.345.678,00.' },
  { id: 'H22', scope: 'estados', text: () => 'El total de pasivos laborales asciende a $3.000.000,00 y el de pasivos financieros a $5.000.000,00.' },
  { id: 'H23', scope: 'estados', text: () => 'El total de activos corrientes asciende a $7.654.321,00.' },
  { id: 'H24', scope: 'estados', text: (s) => (s.patrimonio > ZERO ? `El patrimonio al 31 de diciembre de ${s.year} asciende a ${cop(s.patrimonio)}.` : `El patrimonio es negativo en ${cop(s.patrimonio)}.`) },
  { id: 'H25', scope: 'estados', text: (s) => (s.patrimonio > ZERO ? `El patrimonio de la sociedad asciende a ${cop(s.patrimonio)}.` : null) },
  { id: 'H26', scope: 'estados', text: (s) => (s.patrimonioComp === null || s.patrimonioComp < ZERO ? null : `El total del patrimonio del periodo comparativo es de ${cop(s.patrimonioComp)}.`) },
  { id: 'H27', scope: 'estados', text: () => 'El patrimonio disminuyó $1.000.000,00 frente al periodo anterior.' },
  { id: 'H28', scope: 'estados', text: (s) => `El representante legal, C.C. 1.234.567, certifica que el total de activos es de ${cop(s.activo)}.` },
  // Efectivo
  { id: 'H29', scope: 'estados', text: (s) => `El efectivo y equivalentes al cierre del periodo ascienden a ${cop(s.efectivo)}, representados en caja y bancos.` },
  { id: 'H30', scope: 'estados', text: (s) => `El disponible al cierre fue de ${cop(s.efectivo)}.` },
  { id: 'H31', scope: 'estados', text: (s) => `La caja y bancos suman ${cop(s.efectivo)} al cierre del ejercicio.` },
  { id: 'H32', scope: 'estados', text: (s) => `El efectivo de la compañía al 31 de diciembre de ${s.year} era de ${cop(s.efectivo)}.` },
  { id: 'H33', scope: 'estados', text: () => 'El efectivo al cierre se compone de caja general por $2.000.000,00 y bancos por el saldo restante.' },
  { id: 'H34', scope: 'estados', text: () => 'El efectivo al cierre está representado por saldos en bancos de $1.500.000,00 y caja menor.' },
  // Ingresos
  { id: 'H35', scope: 'estados', text: (s) => (s.ingresos === null ? null : `Los ingresos operacionales netos del periodo suman ${cop(s.ingresos)}.`) },
  { id: 'H36', scope: 'estados', text: (s) => (s.ingresos === null ? null : `Los ingresos del ejercicio ascendieron a ${cop(s.ingresos)}.`) },
  { id: 'H37', scope: 'estados', text: (s) => (s.ingresos === null ? null : `Las ventas netas del año fueron de ${cop(s.ingresos)}.`) },
  { id: 'H38', scope: 'estados', text: () => 'Los otros ingresos operacionales por $1.000.000,00 corresponden a arrendamientos.' },
  // Fecha de corte y comparativo
  {
    id: 'H39', scope: 'estados',
    text: (s) => (s.compYear === null ? null : `Los estados financieros al 31 de diciembre de ${s.year} se presentan en forma comparativa con los estados financieros al 31 de diciembre de ${s.compYear}.`),
  },
  // Ratios
  { id: 'H40', scope: 'ratios', text: (s) => (s.roe === null ? null : `El ROE fue de ${s.roe.toFixed(1).replace('.', ',')} %.`) },
  {
    id: 'H41', scope: 'ratios',
    text: (s) => (s.roe === null || s.roe >= 0 ? null : `El ROE negativo de ${Math.abs(s.roe).toFixed(1).replace('.', ',')} % refleja la pérdida del ejercicio.`),
  },
  {
    id: 'H42', scope: 'ratios',
    text: (s) => (s.ebitda === null ? null : s.ebitda < ZERO ? `El EBITDA fue negativo en ${cop(s.ebitda)}.` : `El EBITDA del ejercicio fue de ${cop(s.ebitda)}.`),
  },
  { id: 'H43', scope: 'ratios', text: () => 'El margen EBITDA fue de 12,0 % y el ROE supera la referencia sectorial de 15 %.' },
  // Acta (aritmética determinista)
  { id: 'H44', scope: 'acta', text: (s) => (s.acta?.distributionApplies ? `Se aprueba distribuir entre los accionistas la suma de ${cop(B(s.acta.distribuibleCop))}.` : null) },
  { id: 'H45', scope: 'acta', text: (s) => (s.acta?.distributionApplies ? `El 10 % de la utilidad neta, es decir ${cop(pct(B(s.acta.netIncomeCop), 10))}, se destina a la reserva legal (Art. 452 C.Co.).` : null) },
  { id: 'H46', scope: 'acta', text: (s) => (s.acta?.distributionApplies ? `Se apropia la reserva legal (10 % de la utilidad líquida del ejercicio) por ${cop(B(s.acta.reservaLegalDelEjercicioCop))}.` : null) },
  {
    id: 'H47', scope: 'acta',
    text: (s) => (s.acta?.distributionApplies ? `Apropiada la reserva legal, queda un saldo de ${cop(B(s.acta.saldoDistribuibleCop) - B(s.acta.reservaLegalDelEjercicioCop))} a disposición de la asamblea.` : null),
  },
  { id: 'H48', scope: 'acta', text: (s) => (s.acta?.distributionApplies ? `Se propone una reserva ocasional de ${cop(B(s.acta.reservaOcasionalCop))} (Art. 154 C.Co.).` : null) },
  { id: 'H49', scope: 'acta', text: (s) => (s.acta?.distributionApplies ? `El mínimo legal a repartir asciende a ${cop(B(s.acta.minimoArt155Cop))} (Art. 155 C.Co.).` : null) },
  {
    id: 'H50', scope: 'acta',
    text: (s) => (s.acta?.distributionApplies ? `El 50 % de la utilidad neta, una vez apropiada la reserva legal, es decir ${cop(pct(B(s.acta.saldoDistribuibleCop) - B(s.acta.reservaLegalDelEjercicioCop), 50))}, se pone a disposición de los accionistas.` : null),
  },
  { id: 'H51', scope: 'acta', text: (s) => (s.acta?.capitalizationApplies ? `Se capitalizan ${cop(B(s.acta.capitalizationAmountCop))} con cargo al saldo distribuible.` : null) },
  { id: 'H52', scope: 'acta', text: (s) => (s.acta && B(s.acta.enjugarPerdidasCop) === ZERO ? 'No hay pérdidas de ejercicios anteriores por enjugar.' : null) },
  { id: 'H53', scope: 'acta', text: (s) => (s.acta ? `Las utilidades líquidas del ejercicio ascienden a ${cop(B(s.acta.netIncomeCop))}.` : null) },
  // Otras magnitudes, partidas y partitivos en la misma frase
  { id: 'H54', scope: 'estados', text: () => 'Sobre la utilidad del ejercicio se calculó el impuesto de renta de $6.000.000,00.' },
  { id: 'H55', scope: 'estados', text: (s) => `El resultado del ejercicio ${Number(s.year) - 1} se trasladó a resultados acumulados, cuyo saldo es de $17.500.000,00.` },
  { id: 'H56', scope: 'estados', text: () => 'La pérdida del ejercicio por deterioro de cartera fue de $3.000.000,00.' },
  { id: 'H57', scope: 'estados', text: () => 'La utilidad neta del ejercicio antes de impuestos fue de $25.000.000,00.' },
  { id: 'H58', scope: 'estados', text: () => 'Del total de activos, $5.000.000,00 corresponden a inventarios.' },
  { id: 'H59', scope: 'estados', text: (s) => `El total de pasivos, que incluye obligaciones financieras de $25.000.000,00, asciende a ${cop(s.pasivo)}.` },
  { id: 'H60', scope: 'estados', text: () => 'Las ventas del año fueron de 1.200.000 unidades.' },
  { id: 'H61', scope: 'estados', text: (s) => `El efectivo al cierre de ${Number(s.year) + 1} se estima en $80.000.000,00.` },
  { id: 'H62', scope: 'estados', text: (s) => `La utilidad del ejercicio ${s.year} antes de impuestos fue de $22.000.000,00.` },
  { id: 'H63', scope: 'estados', text: () => 'El total de activos por impuestos diferidos asciende a $1.234.567,00.' },
  { id: 'H64', scope: 'estados', text: () => 'El total de activos supera 5.000 SMMLV (7.117.500.000), por lo que la sociedad está obligada a tener revisor fiscal.' },
  { id: 'H65', scope: 'estados', text: () => 'La utilidad del ejercicio se destinará a reservas por $2.500.000,00.' },
  { id: 'H66', scope: 'estados', text: () => 'El resultado del ejercicio se vio afectado por gastos financieros de $10.000.000,00.' },
];

// ---------------------------------------------------------------------------
// Frases FALSAS
// ---------------------------------------------------------------------------

const FALSE: Phrase[] = [
  { id: 'F01', scope: 'estados', text: (s) => `La utilidad del ejercicio fue de ${wrong(s.un)}.` },
  { id: 'F02', scope: 'estados', text: (s) => `El resultado del periodo asciende a ${wrong(s.un)}.` },
  { id: 'F03', scope: 'estados', text: (s) => `La ganancia del periodo asciende a ${wrong(s.un)}.` },
  { id: 'F04', scope: 'estados', text: (s) => `La pérdida del ejercicio de ${wrong(s.un)} se cubrirá con reservas.` },
  { id: 'F05', scope: 'estados', text: (s) => `La sociedad obtuvo utilidades por ${wrong(s.un)} en el ejercicio.` },
  { id: 'F06', scope: 'estados', text: (s) => `La ${res(s.un)} neta del ejercicio fue de ${wrong(s.un)}.` },
  { id: 'F07', scope: 'estados', text: (s) => `La ${res(s.un)} neta del ejercicio aumentó a ${wrong(s.un)}.` },
  { id: 'F08', scope: 'estados', text: (s) => `La ${res(s.un)} neta pasó de $1.000.000,00 a ${wrong(s.un)}.` },
  { id: 'F09', scope: 'estados', text: (s) => `La ${res(s.un)} neta del ejercicio, que cambió frente al año anterior, fue de ${wrong(s.un)}.` },
  { id: 'F10', scope: 'estados', text: (s) => `La ${res(s.un)} neta del ejercicio fue de ${Math.round(pesos(absB(s.un) * B(3)) / 1e6) + 7} millones de pesos.` },
  { id: 'F11', scope: 'estados', text: (s) => `La ${res(s.un)} neta del ejercicio fue de ${wrong(s.un).replace('$', '')} COP.` },
  { id: 'F12', scope: 'estados', text: (s) => `La ${res(s.un)} neta del ejercicio fue de ${wrong(s.un).replace('$', '')}.` },
  { id: 'F13', scope: 'estados', text: (s) => `Los activos de la sociedad ascienden a ${wrong(s.activo)}.` },
  { id: 'F14', scope: 'estados', text: (s) => `Los pasivos suman ${wrong(s.pasivo)}.` },
  { id: 'F15', scope: 'estados', text: (s) => `El total de activos de la sociedad asciende a ${wrong(s.activo)}.` },
  { id: 'F16', scope: 'estados', text: (s) => `El total de activos creció hasta ${wrong(s.activo)}.` },
  { id: 'F17', scope: 'estados', text: (s) => `El patrimonio al 31 de diciembre de ${s.year} asciende a ${wrong(s.patrimonio)}.` },
  { id: 'F18', scope: 'estados', text: (s) => `El patrimonio asciende a ${wrong(s.patrimonio).replace('$', 'COP ')}.` },
  { id: 'F19', scope: 'estados', text: (s) => `El efectivo asciende a ${wrong(s.efectivo)}.` },
  { id: 'F20', scope: 'estados', text: (s) => `El disponible cerró en ${wrong(s.efectivo)}.` },
  { id: 'F21', scope: 'estados', text: (s) => `La caja y bancos suman ${wrong(s.efectivo)}.` },
  { id: 'F22', scope: 'estados', text: (s) => `El efectivo de la compañía al 31 de diciembre de ${s.year} era de ${wrong(s.efectivo)}.` },
  { id: 'F23', scope: 'estados', text: (s) => `El efectivo y equivalentes al cierre fue de ${wrong(s.efectivo)}.` },
  { id: 'F24', scope: 'estados', text: (s) => (s.ingresos === null ? null : `Los ingresos del ejercicio ascendieron a ${wrong(s.ingresos)}.`) },
  { id: 'F25', scope: 'estados', text: (s) => (s.ingresos === null ? null : `Las ventas del año fueron de ${wrong(s.ingresos)}.`) },
  { id: 'F26', scope: 'estados', text: (s) => (s.ingresos === null ? null : `Los ingresos operacionales netos ascienden a ${wrong(s.ingresos)}.`) },
  { id: 'F27', scope: 'estados', text: (s) => (s.un < ZERO ? `La utilidad neta positiva del ejercicio es de ${cop(s.un)}.` : `La pérdida neta del ejercicio fue de ${cop(s.un)}.`) },
  { id: 'F28', scope: 'estados', text: (s) => (s.un < ZERO ? `El resultado neto del ejercicio fue de ${cop(s.un)}.` : null) },
  { id: 'F29', scope: 'ratios', text: (s) => (s.ebitda === null ? null : s.ebitda < ZERO ? `El EBITDA del ejercicio fue de ${cop(s.ebitda)}.` : `El EBITDA del ejercicio fue de ${wrong(s.ebitda)}.`) },
  { id: 'F30', scope: 'ratios', text: (s) => (s.roe === null ? null : `El ROE fue de ${(s.roe + 17.3).toFixed(1).replace('.', ',')} %.`) },
  { id: 'F31', scope: 'acta', text: () => 'Se aprueba distribuir entre los accionistas la suma de $987.654.321,00.' },
  { id: 'F32', scope: 'acta', text: () => 'Se capitalizan $876.543,21 de la utilidad del ejercicio.' },
  { id: 'F33', scope: 'acta', text: () => 'Las utilidades líquidas del ejercicio ascienden a $987.654.321,00.' },
  { id: 'F34', scope: 'acta', text: () => 'Se apropia una reserva ocasional de $15.555.555,00.' },
  { id: 'F35', scope: 'acta', text: () => 'Se enjugan pérdidas de ejercicios anteriores por $7.777.777,00.' },
  { id: 'F36', scope: 'acta', text: (s) => (s.acta?.distributionApplies ? `El 10 % de la utilidad neta, es decir ${wrong(pct(B(s.acta.netIncomeCop), 10))}, se destina a la reserva legal.` : null) },
  { id: 'F37', scope: 'acta', text: () => 'Durante el año se pagaron dividendos por $123.456.789,00.' },
  { id: 'F38', scope: 'acta', text: () => 'La utilidad neta a disposición de la asamblea es de $987.654.321,00.' },
  { id: 'F39', scope: 'estados', text: (s) => `La ${res(s.un)} neta del ejercicio, neta del impuesto de renta, fue de ${wrong(s.un)}.` },
  { id: 'F40', scope: 'estados', text: (s) => `El total de pasivos, que incluye obligaciones financieras de $25.000.000,00, asciende a ${wrong(s.pasivo)}.` },
  { id: 'F41', scope: 'estados', text: (s) => `Se registró un total de activos por ${wrong(s.activo)}.` },
  { id: 'F42', scope: 'estados', text: (s) => `La ${res(s.un)} del ejercicio, neta de reservas, fue de ${wrong(s.un)}.` },
  { id: 'F43', scope: 'estados', text: (s) => `De la ${res(s.un)} neta del ejercicio, por ${wrong(s.un)}, se apropia la reserva de ley.` },
];

// ---------------------------------------------------------------------------

let SCENARIOS: Scenario[] = [];

beforeAll(async () => {
  const perdida = preprocesarPerdidaComparativo();
  const tres = preprocesarTresCortes();
  const real = await loadRealBalance();
  SCENARIOS = [
    coherent(),
    fromPreprocessed(
      'traza de la pérdida con comparativo',
      perdida,
      informeHonesto(perdida),
      buildActaExpectedArithmetic({ name: 'Demo Perdidas SAS', nit: '900123456-8', fiscalPeriod: '2025', entityType: 'SAS' }, perdida),
    ),
    fromPreprocessed(
      'tres cortes (comparativos EFE/ECP)',
      tres,
      informeTresCortes(tres),
      buildActaExpectedArithmetic({ name: 'Demo Tres Cortes SAS', nit: '900765432-6', fiscalPeriod: '2025', entityType: 'SAS' }, tres),
    ),
    fromPreprocessed(
      'balance real (grupo-empresarial-2tres-sas)',
      real,
      null,
      buildActaExpectedArithmetic({ name: 'Grupo Empresarial 2 Tres SAS', nit: '901714014', fiscalPeriod: '2025', entityType: 'SAS' }, real),
    ),
    fromPreprocessed('S.A. con aritmética del acta', ppSA, null, buildActaExpectedArithmetic(COMPANY_SA, ppSA)),
  ];
});

describe('corpus del validador de prosa', () => {
  it('tamaño: ≥ 40 frases honestas y ≥ 30 falsas', () => {
    expect(HONEST.length).toBeGreaterThanOrEqual(40);
    expect(FALSE.length).toBeGreaterThanOrEqual(30);
  });

  it('las frases honestas no sellan ninguna Parte en ningún balance', () => {
    const failures: string[] = [];
    let evaluated = 0;
    for (const s of SCENARIOS) {
      for (const p of HONEST) {
        const text = p.text(s);
        if (text === null) continue;
        for (const part of PARTS[p.scope]) {
          evaluated += 1;
          const m = motivosIn(part, s, text);
          if (m.length > 0) failures.push(`${s.name} · ${p.id} · Parte ${part} · "${text}" → ${m.join(' | ')}`);
        }
      }
    }
    expect(failures).toEqual([]);
    expect(evaluated).toBeGreaterThan(300);
  });

  it('las frases falsas sellan cada Parte que cruza el concepto en todos los balances', () => {
    const escapes: string[] = [];
    const covered = new Set<string>();
    for (const s of SCENARIOS) {
      for (const p of FALSE) {
        const text = p.text(s);
        if (text === null) continue;
        // Sin preprocesado no hay EBITDA/ROE/ingresos; sin JSON NIIF la Parte I no aplica.
        const parts = PARTS[p.scope].filter((part) => (part === 'I' ? s.niif !== null : true));
        for (const part of parts) {
          if (motivosIn(part, s, text).length === 0) escapes.push(`${s.name} · ${p.id} · Parte ${part} · "${text}"`);
          else covered.add(p.id);
        }
      }
    }
    expect(escapes).toEqual([]);
    // Cada frase falsa se probó en al menos un balance.
    expect(FALSE.filter((p) => !covered.has(p.id)).map((p) => p.id)).toEqual([]);
  });
});
