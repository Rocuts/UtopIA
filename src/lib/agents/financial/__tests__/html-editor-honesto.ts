// ---------------------------------------------------------------------------
// HTML HONESTO del Editor Jefe para las pruebas del validador (fase 2, F-html)
// ---------------------------------------------------------------------------
// Construye, desde un JSON NIIF ya validado, el documento de 15 páginas que un
// Editor Jefe fiel emitiría: ESF, ERI con ORI y resultado integral total, EFE a
// dos columnas (o a una con su nota de comparativo no presentado), ECP en la
// plantilla v10.1 (6 columnas + ORI cuando lo hay) con el bloque comparativo,
// y la prosa que la Parte II acepta (proyecciones, recomendaciones en
// infinitivo, impactos, incisos y componentes). Español o inglés.
//
// Cada prueba aplica UNA alteración sobre este HTML; sin alteración, ningún
// validador del HTML debe bloquear.
// ---------------------------------------------------------------------------

import type { HtmlEditorMetadata } from '../contracts/html-editor';
import { formatCopFromCents } from '../contracts/money';
import type { NiifReportJson } from '../contracts/niif-report';

export const HONEST_HASH = 'c'.repeat(64);

export type HonestLanguage = 'es' | 'en';

const ZERO = BigInt(0);

/** Celda de estado: negativo entre paréntesis, cero anotado, nulo como raya. */
export function cop(v: string | bigint | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const b = typeof v === 'bigint' ? v : BigInt(v);
  if (b === ZERO) return '<sup class="n">†</sup>$0,00';
  return b < ZERO ? `(${formatCopFromCents(-b, true)})` : formatCopFromCents(b, true);
}

/** Cifra en prosa: la magnitud con paréntesis contable si es negativa. */
const prose = (v: string | bigint) => {
  const b = typeof v === 'bigint' ? v : BigInt(v);
  return b < ZERO ? `(${formatCopFromCents(-b, true)})` : formatCopFromCents(b, true);
};

const abs = (b: bigint) => (b < ZERO ? -b : b);

/** "$30 M" desde centavos (magnitud narrativa abreviada, §1.9/L38). */
const millions = (c: bigint) => `$${(Number(abs(c)) / 1e8).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;

export function honestMetadata(niif: NiifReportJson): HtmlEditorMetadata {
  return {
    reportMode: niif.reportMode ?? 'COMPARATIVO_COMPLETO',
    entityNit: niif.company.nit,
    reportHashSha256: HONEST_HASH,
  } as unknown as HtmlEditorMetadata;
}

const T = {
  es: {
    tagline: { LINEA_BASE: 'Primer cierre: la línea base', TRANSICION: 'Lo comparable y lo nuevo', COMPARATIVO_COMPLETO: 'El año en una frase' },
    summaryTitle: { LINEA_BASE: 'El ejercicio en cifras', TRANSICION: 'Lo comparable y lo nuevo del período', COMPARATIVO_COMPLETO: 'Los tres movimientos del año' },
    concept: 'Concepto',
    movement: 'Movimiento',
    esf: 'Estado de Situación Financiera',
    eri: 'Estado de Resultados Integral',
    efe: 'Estado de Flujos de Efectivo',
    ecp: 'Estado de Cambios en el Patrimonio',
    totalAssets: 'Total activos',
    totalLiabilities: 'Total pasivos',
    totalEquity: 'Total patrimonio',
    gross: (neg: boolean) => (neg ? 'Pérdida bruta' : 'Utilidad bruta'),
    operating: (neg: boolean) => (neg ? 'Pérdida operacional' : 'Utilidad operacional'),
    net: (neg: boolean) => (neg ? 'Pérdida neta' : 'Utilidad neta'),
    ori: 'Otro resultado integral',
    rit: 'Resultado integral total',
    section: { operating: 'Flujo neto de actividades de operación', investing: 'Flujo neto de actividades de inversión', financing: 'Flujo neto de actividades de financiación' } as Record<string, string>,
    netChange: 'Aumento (disminución) neto en efectivo',
    opening: 'Efectivo al inicio del período',
    closing: 'Efectivo al final del período',
    ecpCols: ['Capital social', 'Reservas', 'Resultados acumulados', 'Resultado del ejercicio'],
    ecpOri: 'ORI',
    ecpTotal: 'Total patrimonio',
    period: (y: string) => `Periodo ${y}`,
    notes: 'Notas a los estados financieros',
    limits: 'Limitaciones de Información',
    how: 'Cómo se construyó este informe',
    reco: 'Recomendaciones y plan de acción',
    next: 'El próximo cierre',
    urgent: 'Tres acciones urgentes',
  },
  en: {
    tagline: { LINEA_BASE: 'First close: the baseline', TRANSICION: 'What is comparable and what is new', COMPARATIVO_COMPLETO: 'The year in one sentence' },
    summaryTitle: { LINEA_BASE: 'The fiscal year in figures', TRANSICION: 'What is comparable and what is new in the period', COMPARATIVO_COMPLETO: 'Key movements of the year' },
    concept: 'Line item',
    movement: 'Movement',
    esf: 'Statement of Financial Position',
    eri: 'Statement of Comprehensive Income',
    efe: 'Statement of Cash Flows',
    ecp: 'Statement of Changes in Equity',
    totalAssets: 'Total assets',
    totalLiabilities: 'Total liabilities',
    totalEquity: 'Total equity',
    gross: (neg: boolean) => (neg ? 'Gross loss' : 'Gross profit'),
    operating: (neg: boolean) => (neg ? 'Operating loss' : 'Operating profit'),
    net: (neg: boolean) => (neg ? 'Net loss' : 'Net income'),
    ori: 'Other comprehensive income',
    rit: 'Total comprehensive income',
    section: { operating: 'Net cash from operating activities', investing: 'Net cash from investing activities', financing: 'Net cash from financing activities' } as Record<string, string>,
    netChange: 'Net increase (decrease) in cash',
    opening: 'Cash at beginning of period',
    closing: 'Cash at end of period',
    ecpCols: ['Share capital', 'Reserves', 'Retained earnings', 'Profit for the year'],
    ecpOri: 'OCI',
    ecpTotal: 'Total equity',
    period: (y: string) => `Period ${y}`,
    notes: 'Notes to the financial statements',
    limits: 'Information limitations',
    how: 'How this report was built',
    reco: 'Recommendations and action plan',
    next: 'The next close',
    urgent: 'Three urgent actions',
  },
} as const;

type EquityRow = NiifReportJson['equityChanges']['rows'][number];

function ecpLabel(row: EquityRow, language: HonestLanguage, year: string): string {
  if (language === 'es') return row.label;
  switch (row.kind) {
    case 'opening_balance':
      return `Balance at the beginning of ${year}`;
    case 'closing_balance':
      return `Balance at the end of ${year}`;
    case 'profit_for_period':
      return `Profit for the year ${year}`;
    case 'other_comprehensive_income':
      return `Other comprehensive income ${year}`;
    default:
      return `${row.label} (${year})`;
  }
}

export interface HonestHtmlOptions {
  language?: HonestLanguage;
  /**
   * 'plantilla' (por defecto): ECP en las 6 columnas v10.1 con bloques por
   * periodo y EFE a una columna sin comparativo. 'auditor': la maqueta de la
   * re-auditoría (buildHtmlFull) — ERI/EFE siempre a dos columnas con "—" en el
   * comparativo ausente, rótulos "Flujo neto <sección>" y "Variación neta del
   * efectivo", y el ECP en una sola tabla con las claves del JSON como
   * encabezados y sin filas de bloque.
   */
  layout?: 'plantilla' | 'auditor';
  /** Prosa adicional en la página 03 (resumen). */
  extraSummary?: string;
  /** Alteración puntual del HTML ya construido. */
  tweak?: (html: string) => string;
}

export function buildHonestHtml(niif: NiifReportJson, options: HonestHtmlOptions = {}): string {
  const language = options.language ?? 'es';
  const t = T[language];
  const py = niif.company.fiscalPeriod;
  const cy = niif.company.comparativePeriod;
  const mode = niif.reportMode ?? 'COMPARATIVO_COMPLETO';
  const bs = niif.balanceSheet;
  const is = niif.incomeStatement;
  const cf = niif.cashFlow;
  const eq = niif.equityChanges;

  const head = `<thead><tr><th>${t.concept}</th><th>${py}</th>${cy ? `<th>${cy}</th>` : ''}</tr></thead>`;
  const row = (label: string, p: string | null, c: string | null, cls = '') =>
    `<tr${cls ? ` class="${cls}"` : ''}><td>${label}</td><td>${cop(p)}</td>${cy ? `<td>${cop(c)}</td>` : ''}</tr>`;
  const table = (rows: string) => `<table class="ft">${head}<tbody>${rows}</tbody></table>`;

  // ── ESF ───────────────────────────────────────────────────────────────────
  const esf =
    table(
      bs.assets.map((l) => row(`${l.account ?? ''} ${l.label}`.trim(), l.amountPrimary, l.amountComparative)).join('') +
        row(t.totalAssets, bs.totalAssetsPrimary, bs.totalAssetsComparative, 'total'),
    ) +
    table(
      bs.liabilities.map((l) => row(`${l.account ?? ''} ${l.label}`.trim(), l.amountPrimary, l.amountComparative)).join('') +
        row(t.totalLiabilities, bs.totalLiabilitiesPrimary, bs.totalLiabilitiesComparative, 'total'),
    ) +
    table(
      bs.equity.map((l) => row(`${l.account ?? ''} ${l.label}`.trim(), l.amountPrimary, l.amountComparative)).join('') +
        row(t.totalEquity, bs.totalEquityPrimary, bs.totalEquityComparative, 'total'),
    );

  // ── ERI con ORI y resultado integral total ────────────────────────────────
  const neg = (v: string | null) => v !== null && BigInt(v) < ZERO;
  const sum = (a: string | null, b: string | null) => (a === null || b === null ? null : (BigInt(a) + BigInt(b)).toString());
  const eri = table(
    is.lines.map((l) => row(`${l.account ?? ''} ${l.label}`.trim(), l.amountPrimary, l.amountComparative)).join('') +
      row(t.gross(neg(is.grossProfitPrimary)), is.grossProfitPrimary, is.grossProfitComparative) +
      row(t.operating(neg(is.operatingProfitPrimary)), is.operatingProfitPrimary, is.operatingProfitComparative) +
      row(t.net(neg(is.netIncomePrimary)), is.netIncomePrimary, is.netIncomeComparative) +
      row(t.ori, is.oriPrimary, is.oriComparative) +
      row(t.rit, sum(is.netIncomePrimary, is.oriPrimary), sum(is.netIncomeComparative, is.oriComparative)),
  );

  // ── EFE: dos columnas con el comparativo determinista, o una con su nota ──
  const cfComparative =
    cy !== null &&
    cf.netChangeComparative !== null &&
    cf.cashOpeningComparative !== null &&
    cf.cashClosingComparative !== null &&
    cf.sections.every((s) => s.netFlowComparative !== null);
  const efeHead = `<thead><tr><th>${t.concept}</th><th>${py}</th>${cfComparative ? `<th>${cy}</th>` : ''}</tr></thead>`;
  const efeRow = (label: string, p: string | null, c: string | null) =>
    `<tr><td>${label}</td><td>${cop(p)}</td>${cfComparative ? `<td>${cop(c)}</td>` : ''}</tr>`;
  const efe =
    `<table class="ft">${efeHead}<tbody>` +
    cf.sections
      .map(
        (s) =>
          s.lines.map((l) => efeRow(l.label, l.amountPrimary, l.amountComparative)).join('') +
          efeRow(t.section[s.section] ?? s.section, s.netFlow, s.netFlowComparative),
      )
      .join('') +
    efeRow(t.netChange, cf.netChange, cf.netChangeComparative) +
    efeRow(t.opening, cf.cashOpening, cf.cashOpeningComparative) +
    efeRow(t.closing, cf.cashClosing, cf.cashClosingComparative) +
    `</tbody></table>` +
    (!cfComparative && cf.comparativeNote ? `<p class="nota">${cf.comparativeNote}</p>` : '');

  // ── ECP en la plantilla v10.1 (+ columna ORI si el ORI se mueve) ──────────
  const allRows = [...(eq.comparativeRows ?? []), ...eq.rows];
  const withOri = allRows.some((r) => BigInt(r.ori) !== ZERO);
  const ecpHead = `<thead><tr><th>${t.movement}</th>${t.ecpCols.map((c) => `<th>${c}</th>`).join('')}${withOri ? `<th>${t.ecpOri}</th>` : ''}<th>${t.ecpTotal}</th></tr></thead>`;
  const ecpRow = (label: string, r: EquityRow) => {
    const reservas = (BigInt(r.reservaLegal) + BigInt(r.otrasReservas)).toString();
    // Sin columna propia, la prima en colocación va con el capital.
    const capital = (BigInt(r.capitalSocial) + BigInt(r.primaColocacion)).toString();
    const cells = [capital, reservas, r.resultadosAcumulados, r.resultadoEjercicio, ...(withOri ? [r.ori] : []), r.total];
    return `<tr><td>${label}</td>${cells.map((c) => `<td>${cop(c)}</td>`).join('')}</tr>`;
  };
  const blank = (label: string) => `<tr><td>${label}</td>${Array.from({ length: t.ecpCols.length + (withOri ? 2 : 1) }, () => '<td></td>').join('')}</tr>`;
  const ecpBody = eq.comparativeRows && cy
    ? blank(t.period(cy)) +
      eq.comparativeRows.map((r) => ecpRow(ecpLabel(r, language, cy), r)).join('') +
      blank(t.period(py)) +
      eq.rows.map((r) => ecpRow(ecpLabel(r, language, py), r)).join('')
    : eq.rows.map((r) => ecpRow(ecpLabel(r, language, py), r)).join('');
  const ecp =
    `<table class="ft">${ecpHead}<tbody>${ecpBody}</tbody></table>` +
    (!eq.comparativeRows && eq.comparativeNote ? `<p class="nota">${eq.comparativeNote}</p>` : '');

  // ── Prosa: resumen, proyección, recomendaciones (lo que la Parte II acepta) ─
  const ni = BigInt(is.netIncomePrimary);
  const loss = ni < ZERO;
  const summary =
    language === 'es'
      ? `<p>El ejercicio ${py} cerró con una ${loss ? 'pérdida neta' : 'utilidad neta'} de ${prose(ni)}` +
        `${is.netIncomeComparative !== null ? ` frente a ${prose(is.netIncomeComparative)} en ${cy}` : ''}. ` +
        `El total de activos asciende a ${prose(bs.totalAssetsPrimary)} y el patrimonio al cierre es de ${prose(bs.totalEquityPrimary)}.</p>` +
        `<p>El efectivo al cierre de ${py} es de ${prose(cf.cashClosing)}.</p>` +
        `<p>La reserva legal se calcula como el 10 % de la utilidad neta (${prose(abs(ni))}) cuando hay utilidad.</p>` +
        `<p>El total de activos se concentra en el efectivo y la cartera, con ${prose(cf.cashClosing)} en efectivo.</p>`
      : `<p>The ${py} fiscal year closed with a ${loss ? 'net loss' : 'net income'} of ${prose(ni)}. ` +
        `Total assets amount to ${prose(bs.totalAssetsPrimary)} and equity at year end is ${prose(bs.totalEquityPrimary)}.</p>`;
  const target = abs(ni) + BigInt(1_200_000_000);
  const nextYear = String(Number(py) + 1);
  const outlook =
    language === 'es'
      ? `<h2>${t.next}</h2><p>Para ${nextYear} se proyecta una utilidad neta de ${prose(target)}.</p>` +
        `<p>Meta: llevar los ingresos operacionales netos a $150.000.000,00 en ${nextYear}.</p>` +
        `<h2>${t.urgent}</h2><ol><li>Elevar la utilidad neta a ${millions(target)} y el EBITDA en $12 M.</li>` +
        `<li>Documentar el soporte de los aportes y las distribuciones.</li><li>Conciliar la cartera por edades.</li></ol>`
      : `<h2>${t.next}</h2><p>For ${nextYear} net income is projected at ${prose(target)}.</p>` +
        `<h2>${t.urgent}</h2><ol><li>Raise net income to ${millions(target)} and EBITDA by $12 M.</li></ol>`;
  const recommendations =
    language === 'es'
      ? [
          ['Prioridad alta · Sección 3', 'Elevar la utilidad neta', `Elevar la utilidad neta a ${millions(target)} y el EBITDA en $12 M con la revisión de precios.`],
          ['Prioridad alta · Sección 7', 'Fortalecer la caja', `Impacto esperado: efectivo al cierre de ${nextYear} de $40.000.000,00.`],
          ['Prioridad media · Sección 11', 'Reducir la cartera', 'Mayor utilidad neta en $3.000.000,00 por menores provisiones.'],
          ['Prioridad media · Sección 6', 'Soportar los movimientos patrimoniales', 'Documentar aportes y distribuciones con acta y comprobante.'],
          ['Prioridad baja · Sección 4', 'Revisar la clasificación', 'Validar la clasificación corriente y no corriente.'],
          ['Prioridad baja · Sección 8', 'Ampliar las notas', 'Completar las revelaciones de políticas contables.'],
        ]
      : [
          ['High priority · Section 3', 'Raise net income', `Raise net income to ${millions(target)} and EBITDA by $12 M.`],
          ['High priority · Section 7', 'Strengthen cash', `Expected impact: cash at the end of ${nextYear} of $40.000.000,00.`],
          ['Medium priority · Section 11', 'Reduce receivables', 'Validate aging of receivables.'],
          ['Medium priority · Section 6', 'Support equity movements', 'Document contributions and distributions.'],
          ['Low priority · Section 4', 'Review classification', 'Validate current and non-current classification.'],
          ['Low priority · Section 8', 'Expand notes', 'Complete accounting policy disclosures.'],
        ];
  const recoHtml = recommendations
    .map(([eyebrow, title, body], i) => `<div class="rec"><span class="secn">0${i + 1}</span><h3>${eyebrow}</h3><p><strong>${title}</strong></p><p>${body}</p></div>`)
    .join('');

  if ((options.layout ?? 'plantilla') === 'auditor') {
    const dash = (v: string | null) => (v === null ? '—' : cop(v));
    const r2 = (l: string, p: string | null, c: string | null) => `<tr><td>${l}</td><td>${dash(p)}</td>${cy ? `<td>${dash(c)}</td>` : ''}</tr>`;
    const tb = (rows: string) => `<table class="ft">${head}<tbody>${rows}</tbody></table>`;
    const eriA = tb(
      is.lines.map((l) => r2(`${l.account ?? ''} ${l.label}`.trim(), l.amountPrimary, l.amountComparative)).join('') +
        r2(neg(is.grossProfitPrimary) ? 'Pérdida bruta' : 'Utilidad bruta', is.grossProfitPrimary, is.grossProfitComparative) +
        r2(neg(is.operatingProfitPrimary) ? 'Pérdida operacional' : 'Utilidad operacional', is.operatingProfitPrimary, is.operatingProfitComparative) +
        r2(neg(is.netIncomePrimary) ? 'Pérdida neta' : 'Utilidad neta', is.netIncomePrimary, is.netIncomeComparative) +
        r2('Otro resultado integral', is.oriPrimary, is.oriComparative) +
        r2('Resultado integral total', sum(is.netIncomePrimary, is.oriPrimary), sum(is.netIncomeComparative, is.oriComparative)),
    );
    const efeA = tb(
      cf.sections.map((sec) => sec.lines.map((l) => r2(l.label, l.amountPrimary, l.amountComparative)).join('') + r2(`Flujo neto ${sec.section}`, sec.netFlow, sec.netFlowComparative)).join('') +
        r2('Variación neta del efectivo', cf.netChange, cf.netChangeComparative) +
        r2('Efectivo al inicio del período', cf.cashOpening, cf.cashOpeningComparative) +
        r2('Efectivo al final del período', cf.cashClosing, cf.cashClosingComparative),
    );
    const keys = ['capitalSocial', 'primaColocacion', 'reservaLegal', 'otrasReservas', 'resultadosAcumulados', 'resultadoEjercicio', 'ori', 'total'] as const;
    const ecpA =
      `<table class="ft"><thead><tr><th>Movimiento</th>${keys.map((k) => `<th>${k}</th>`).join('')}</tr></thead><tbody>` +
      allRows.map((r) => `<tr><td>${r.label}</td>${keys.map((k) => `<td>${dash(r[k])}</td>`).join('')}</tr>`).join('') +
      '</tbody></table>';
    return buildHonestHtml(niif, {
      ...options,
      layout: 'plantilla',
      tweak: (h) => {
        const swapped = h
          .replace(/(<article class="page" id="page-06">)[\s\S]*?(<\/article>)/, (_m, a: string, b: string) => `${a}<h1>${t.eri}</h1>${eriA}${b}`)
          .replace(/(<article class="page" id="page-07">)[\s\S]*?(<\/article>)/, (_m, a: string, b: string) => `${a}<h1>${t.efe}</h1>${efeA}${b}`)
          .replace(/(<article class="page" id="page-08">)[\s\S]*?(<\/article>)/, (_m, a: string, b: string) => `${a}<h1>${t.ecp}</h1>${ecpA}${b}`);
        return options.tweak ? options.tweak(swapped) : swapped;
      },
    });
  }

  const filler = (id: string, title: string, body = '') => `<article class="page" id="${id}"><h1>${title}</h1>${body}</article>`;
  const html = `<!DOCTYPE html>
<html lang="${language}">
<head>
<meta charset="UTF-8">
<title>${niif.company.name} ${py}</title>
<!-- REPORT_MODE: ${mode} -->
<!-- ENTITY: ${niif.company.nit} -->
<!-- PERIOD: ${py} -->
<!-- AGENT_VERSION: 1+1 v10.1 -->
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4&family=Inter&family=IBM+Plex+Mono&display=swap" rel="stylesheet">
<style>:root{--accent:#1E3A5F;} @page{size:A4 portrait;} .page{width:210mm;} .ft{font-variant-numeric:tabular-nums;}</style>
</head>
<body>
<article class="page" id="portada"><h1>${niif.company.name}</h1><p class="tagline">${t.tagline[mode]}</p><p>SHA-256: ${HONEST_HASH}</p></article>
${filler('toc', language === 'es' ? 'Tabla de contenido' : 'Contents')}
${filler('page-02', language === 'es' ? 'Mensaje del representante legal' : 'Message from the legal representative', '<p>—</p>')}
<article class="page" id="page-03"><h1>${t.summaryTitle[mode]}</h1>${summary}${options.extraSummary ?? ''}</article>
<article class="page" id="page-04"><h1>${t.esf}</h1>${esf}</article>
${filler('page-05', language === 'es' ? 'Cascada de utilidad operacional' : 'Operating profit bridge')}
<article class="page" id="page-06"><h1>${t.eri}</h1>${eri}</article>
<article class="page" id="page-07"><h1>${t.efe}</h1>${efe}</article>
<article class="page" id="page-08"><h1>${t.ecp}</h1>${ecp}</article>
${filler('page-09', t.notes, `<p>${language === 'es' ? 'Narrativa generada por IA — no auditada.' : 'AI-generated narrative — not audited.'}</p>`)}
${filler('page-10', t.notes, `<h2>${t.limits}</h2><p>—</p>`)}
${filler('page-11', language === 'es' ? 'Indicadores y benchmarks sectoriales' : 'Ratios and sector benchmarks', '<p>△ Confianza media · conciliar.</p>')}
${filler('page-12', language === 'es' ? 'Análisis editorial del ejercicio' : 'Editorial analysis', outlook)}
<article class="page" id="page-13"><h1>${t.reco}</h1>${recoHtml}</article>
<article class="page" id="page-14"><h1>${language === 'es' ? 'Aprobación de los estados financieros' : 'Approval of the financial statements'}</h1><h2>${t.how}</h2><p>SHA-256: ${HONEST_HASH}</p><div class="logo">1+1</div></article>
</body>
</html>`;
  return options.tweak ? options.tweak(html) : html;
}
