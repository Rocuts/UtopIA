// ---------------------------------------------------------------------------
// R3 — Atribución de brecha de cuadratura
// ---------------------------------------------------------------------------
// El preprocessor ya detecta el descuadre de la ecuación patrimonial
// (Activo − Pasivo − Patrimonio). R3 va un paso más allá: identifica la
// cuenta leaf con mayor variación atípica T vs T-1 mediante z-score sobre
// la distribución de Δ% de la misma clase PUC. La idea es darle al usuario
// UN punto de partida concreto para investigar, en vez de un mensaje genérico.
//
// Heurística:
//   1. Para cada cuenta leaf con saldo en T y T-1, calcular Δ% = (T − T-1) / |T-1|.
//   2. Por cada clase, calcular media y desviación estándar de Δ%.
//   3. z = (Δ% − media) / stddev.
//   4. Filtrar candidatos cuyo Δ_absoluto sea ≥ 30% del descuadre (la cuenta
//      atípica debe ser materialmente comparable a la brecha).
//   5. Retornar la de mayor |z|.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot, ValidatedAccount } from '../trial-balance';

import type { BalanceGapAttribution, CuratorFinding } from './types';

const GAP_TOLERANCE_PCT = 0.0001; // 0.01% del activo
const COMPARATIVE_FRACTION = 0.30; // candidato ≥ 30% del gap

export interface R3Result {
  balanceGapAttribution?: BalanceGapAttribution;
  findings: CuratorFinding[];
}

export function runR3(snapshot: PeriodSnapshot, prev: PeriodSnapshot | null): R3Result {
  const totalActivo = snapshot.controlTotals.activo;
  const equationDiff =
    snapshot.controlTotals.activo -
    (snapshot.controlTotals.pasivo + snapshot.controlTotals.patrimonio);

  // Si no hay descuadre material, no aplica.
  const tolerance = Math.max(Math.abs(totalActivo) * GAP_TOLERANCE_PCT, 1000);
  if (Math.abs(equationDiff) <= tolerance) return { findings: [] };

  // Sin comparativo no podemos calcular variaciones; igual emitimos finding
  // descriptivo.
  if (!prev) {
    return {
      findings: [
        {
          code: 'CUR-R3',
          severity: 'critico',
          title: 'Brecha de cuadratura sin comparativo para atribución',
          description:
            `Activo $${formatCOP(snapshot.controlTotals.activo)} ≠ Pasivo + Patrimonio ` +
            `($${formatCOP(snapshot.controlTotals.pasivo)} + $${formatCOP(snapshot.controlTotals.patrimonio)}). ` +
            `Diferencia: $${formatCOP(equationDiff)}. No se puede atribuir a una cuenta atípica sin periodo comparativo.`,
          normReference: 'NIC 1, párrafo 54 (presentación del estado de situación financiera)',
          recommendation:
            'Cargar el balance de prueba del periodo anterior para que el curator identifique la cuenta de mayor variación atípica.',
          impact: 'Imposibilidad de generar estados financieros oficiales hasta resolver el descuadre.',
          period: snapshot.period,
        },
      ],
    };
  }

  // Construir mapa T-1 por código.
  const prevMap = new Map<string, ValidatedAccount>();
  for (const cl of prev.classes) {
    for (const acc of cl.accounts) prevMap.set(acc.code, acc);
  }

  // Calcular Δ% por cuenta leaf de T (que también exista en T-1).
  type Candidate = {
    account: ValidatedAccount;
    classCode: number;
    deltaAbs: number;
    deltaPct: number;
  };
  const allCandidates: Candidate[] = [];
  for (const cl of snapshot.classes) {
    for (const acc of cl.accounts) {
      const prevAcc = prevMap.get(acc.code);
      if (!prevAcc) continue;
      const prevBal = prevAcc.balance;
      const currBal = acc.balance;
      if (Math.abs(prevBal) < 1) continue; // evitamos div/0
      const deltaAbs = currBal - prevBal;
      const deltaPct = deltaAbs / Math.abs(prevBal);
      allCandidates.push({
        account: acc,
        classCode: cl.code,
        deltaAbs,
        deltaPct,
      });
    }
  }

  if (allCandidates.length === 0) {
    return {
      findings: [
        buildGenericGapFinding(snapshot, equationDiff, totalActivo),
      ],
    };
  }

  // Calcular media y stddev de Δ% por clase, computar z-score.
  const byClass = new Map<number, Candidate[]>();
  for (const c of allCandidates) {
    if (!byClass.has(c.classCode)) byClass.set(c.classCode, []);
    byClass.get(c.classCode)!.push(c);
  }

  type Scored = Candidate & { zScore: number };
  const scored: Scored[] = [];
  for (const [, list] of byClass) {
    const mean = list.reduce((s, x) => s + x.deltaPct, 0) / list.length;
    const variance =
      list.reduce((s, x) => s + Math.pow(x.deltaPct - mean, 2), 0) / Math.max(1, list.length - 1);
    const stddev = Math.sqrt(variance) || 1; // evitamos div/0 si todos iguales
    for (const c of list) {
      scored.push({ ...c, zScore: (c.deltaPct - mean) / stddev });
    }
  }

  // Filtrar candidatos materialmente comparables al gap (Δ_absoluto ≥ 30% gap).
  const minMaterial = Math.abs(equationDiff) * COMPARATIVE_FRACTION;
  const material = scored.filter((c) => Math.abs(c.deltaAbs) >= minMaterial);

  const pool = material.length > 0 ? material : scored;
  pool.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
  const top = pool[0];

  const attribution: BalanceGapAttribution = {
    amountCop: equationDiff,
    accountCode: top.account.code,
    accountName: top.account.name,
    classCode: top.classCode,
    zScore: top.zScore,
    varianceVsT1Pct: top.deltaPct,
    balanceTMinus1: prevMap.get(top.account.code)!.balance,
    balanceT: top.account.balance,
    suggestedAction:
      `Revisar movimientos de la cuenta ${top.account.code} (${top.account.name}) en ${snapshot.period}. ` +
      `Variación: ${(top.deltaPct * 100).toFixed(1)}% vs media de su clase (z-score ${top.zScore.toFixed(2)}). ` +
      `${material.length === 0 ? 'Atribución por z-score sin filtro de materialidad — confirmar manualmente.' : ''}`.trim(),
  };

  const finding: CuratorFinding = {
    code: 'CUR-R3',
    severity: 'critico',
    title: `Brecha de cuadratura atribuida a cuenta ${top.account.code}`,
    description:
      `Activo $${formatCOP(snapshot.controlTotals.activo)} ≠ Pasivo + Patrimonio. ` +
      `Diferencia: $${formatCOP(equationDiff)}. ` +
      `Cuenta con mayor variación atípica T vs T-1: ${top.account.code} (${top.account.name}), ` +
      `z-score ${top.zScore.toFixed(2)}, Δ ${(top.deltaPct * 100).toFixed(1)}%, monto absoluto $${formatCOP(top.deltaAbs)}.`,
    normReference: 'NIC 1, párrafo 54',
    recommendation: attribution.suggestedAction,
    impact:
      `Sin resolver el descuadre los estados financieros oficiales no son emitibles. ` +
      `La cuenta señalada concentra ${(Math.abs(top.deltaAbs) / Math.max(1, Math.abs(equationDiff)) * 100).toFixed(0)}% del descuadre.`,
    period: snapshot.period,
  };

  return { balanceGapAttribution: attribution, findings: [finding] };
}

function buildGenericGapFinding(
  snapshot: PeriodSnapshot,
  equationDiff: number,
  totalActivo: number,
): CuratorFinding {
  return {
    code: 'CUR-R3',
    severity: 'critico',
    title: 'Brecha de cuadratura sin candidatos para atribución',
    description:
      `Activo $${formatCOP(snapshot.controlTotals.activo)} ≠ Pasivo + Patrimonio ` +
      `($${formatCOP(snapshot.controlTotals.pasivo)} + $${formatCOP(snapshot.controlTotals.patrimonio)}). ` +
      `Diferencia: $${formatCOP(equationDiff)} (${(Math.abs(equationDiff) / Math.max(1, Math.abs(totalActivo)) * 100).toFixed(2)}% del activo). ` +
      `No hay cuentas comunes con T-1 para atribuir.`,
    normReference: 'NIC 1, párrafo 54',
    recommendation:
      'Validar la consistencia del plan de cuentas entre periodos. Las cuentas leaf de T deben tener su contraparte en T-1.',
    impact: 'Imposibilidad de generar estados financieros oficiales hasta resolver el descuadre.',
    period: snapshot.period,
  };
}

function formatCOP(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return amount < 0 ? `-${formatted}` : formatted;
}
