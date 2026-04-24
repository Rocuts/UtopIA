'use client';

/**
 * /workspace/futuro/factibilidad — Estudios de Factibilidad.
 *
 * - Hero + descripción (metodología DNP, Ley 2069/2020, VPN/TIR, WACC CO,
 *   incentivos ZOMAC/ZF).
 * - Calculadora VPN/TIR inline (inversión, 1-10 flujos, tasa descuento,
 *   impuestos). Output en vivo: VPN, TIR, payback, IR.
 * - Guardar escenario → localStorage (key `futuro_factibilidad_scenarios`).
 * - CTA: "Generar Estudio Completo" → IntakeModal `feasibility_study`.
 * - Checklist de análisis incluidos (7 dimensiones DNP).
 *
 * NO modifica ningún endpoint. Usa `openIntakeForType('feasibility_study')`
 * del `WorkspaceContext` para lanzar el pipeline existente.
 */

import { useCallback, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  Lightbulb,
  Plus,
  Minus,
  Save,
  Play,
  CheckCircle2,
  Calculator as CalculatorIcon,
  Info,
  Landmark,
  BarChart3,
  Scale,
  Gavel,
  Trees,
  Users,
  Brain,
  AlertTriangle,
  ArrowLeft,
  FileDown,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cn } from '@/lib/utils';
import { EliteButton } from '@/components/ui/EliteButton';
import { EliteCard } from '@/components/ui/EliteCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import Link from 'next/link';

// ─── VPN / TIR puros ─────────────────────────────────────────────────────────

/** VPN dado flujos[0..n-1] (año 1..n), inversión inicial y tasa (0..1). */
function computeNpv(
  initialInvestment: number,
  cashflows: number[],
  discountRate: number,
): number {
  const npvOperating = cashflows.reduce((acc, cf, idx) => {
    const t = idx + 1;
    const den = Math.pow(1 + discountRate, t);
    return acc + cf / den;
  }, 0);
  return npvOperating - initialInvestment;
}

/**
 * TIR por bisección entre [-0.99, 5]. Ret. null si no converge.
 * Usa NPV como función objetivo.
 */
function computeIrr(
  initialInvestment: number,
  cashflows: number[],
  tolerance = 1e-6,
  maxIter = 200,
): number | null {
  let lo = -0.99;
  let hi = 5;
  const f = (r: number) => computeNpv(initialInvestment, cashflows, r);
  const fLo = f(lo);
  const fHi = f(hi);
  if (fLo * fHi > 0) return null; // sin raíz en el rango

  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < tolerance) return mid;
    if (fm * f(lo) < 0) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return (lo + hi) / 2;
}

/** Payback simple (años hasta acumular inversión). ret null si no se recupera. */
function computePayback(
  initialInvestment: number,
  cashflows: number[],
): number | null {
  let cum = 0;
  for (let i = 0; i < cashflows.length; i++) {
    const prev = cum;
    cum += cashflows[i];
    if (cum >= initialInvestment) {
      // interpolar fracción del año i+1
      const needed = initialInvestment - prev;
      const frac = cashflows[i] > 0 ? needed / cashflows[i] : 1;
      return i + frac;
    }
  }
  return null;
}

/** Índice de Rentabilidad (PI) = VP(flujos) / inversión. */
function computeProfitabilityIndex(
  initialInvestment: number,
  cashflows: number[],
  discountRate: number,
): number {
  if (initialInvestment <= 0) return 0;
  const pvFlows = cashflows.reduce((acc, cf, idx) => {
    const t = idx + 1;
    return acc + cf / Math.pow(1 + discountRate, t);
  }, 0);
  return pvFlows / initialInvestment;
}

// ─── Format helpers ──────────────────────────────────────────────────────────

function formatCopShort(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}k`;
  return `${sign}$${Math.round(abs).toLocaleString('es-CO')}`;
}

function formatPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(2)}%`;
}

function formatYears(y: number | null): string {
  if (y == null || !Number.isFinite(y)) return '—';
  const years = Math.floor(y);
  const months = Math.round((y - years) * 12);
  if (years === 0) return `${months} mo.`;
  if (months === 0) return `${years} año${years === 1 ? '' : 's'}`;
  return `${years}.${String(months).padStart(2, '0')}`;
}

// ─── Storage keys ────────────────────────────────────────────────────────────

const LS_KEY = 'futuro_factibilidad_scenarios_v1';

interface ScenarioSave {
  id: string;
  label: string;
  savedAt: string;
  investment: number;
  discountRate: number;
  taxRate: number;
  cashflows: number[];
  npv: number;
  irr: number | null;
  payback: number | null;
  pi: number;
}

function loadScenarios(): ScenarioSave[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveScenario(s: ScenarioSave) {
  if (typeof window === 'undefined') return;
  try {
    const current = loadScenarios();
    const next = [s, ...current].slice(0, 20); // cap 20
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    /* noop */
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function FactibilidadPage() {
  const { t, language } = useLanguage();
  const reduced = useReducedMotion();
  const { setActiveCaseType } = useWorkspace();
  const futuro = t.elite.areas.futuro;
  const isEs = language === 'es';

  // Calculator state
  const [investment, setInvestment] = useState<number>(1_200_000_000);
  const [years, setYears] = useState<number>(5);
  const [discountRate, setDiscountRate] = useState<number>(0.135); // 13.5% WACC CO típico
  const [taxRate, setTaxRate] = useState<number>(0.35); // Art. 240 ET
  const [cashflows, setCashflows] = useState<number[]>([
    300_000_000,
    380_000_000,
    460_000_000,
    520_000_000,
    580_000_000,
  ]);
  const [scenarioName, setScenarioName] = useState<string>('');
  const [saved, setSaved] = useState<ScenarioSave[]>(() => loadScenarios());
  const [toast, setToast] = useState<string | null>(null);

  const effectiveCashflows = useMemo(() => {
    // Ajuste por tasa de impuestos (simplified): cashflow * (1 - taxRate).
    // Nota: los flujos que el usuario captura se consideran "ingresos netos antes de
    // impuestos", y aquí aplicamos el factor (1 - t) para aproximar el flujo
    // después de impuestos. Es una simplificación didáctica; el endpoint hace
    // el análisis profesional completo con depreciación, etc.
    return cashflows.map((cf) => cf * (1 - taxRate));
  }, [cashflows, taxRate]);

  const npv = useMemo(
    () => computeNpv(investment, effectiveCashflows, discountRate),
    [investment, effectiveCashflows, discountRate],
  );
  const irr = useMemo(
    () => computeIrr(investment, effectiveCashflows),
    [investment, effectiveCashflows],
  );
  const payback = useMemo(
    () => computePayback(investment, effectiveCashflows),
    [investment, effectiveCashflows],
  );
  const pi = useMemo(
    () => computeProfitabilityIndex(investment, effectiveCashflows, discountRate),
    [investment, effectiveCashflows, discountRate],
  );

  const handleYearsChange = useCallback((next: number) => {
    const clamped = Math.max(1, Math.min(10, Math.round(next)));
    setYears(clamped);
    setCashflows((prev) => {
      if (prev.length === clamped) return prev;
      if (prev.length < clamped) {
        const last = prev[prev.length - 1] ?? 0;
        // Crecimiento asumido +10% por año nuevo
        const additions = Array.from({ length: clamped - prev.length }, (_, i) =>
          Math.round(last * Math.pow(1.1, i + 1)),
        );
        return [...prev, ...additions];
      }
      return prev.slice(0, clamped);
    });
  }, []);

  const handleCashflowChange = useCallback((idx: number, value: number) => {
    setCashflows((prev) => {
      const next = [...prev];
      next[idx] = Number.isFinite(value) ? value : 0;
      return next;
    });
  }, []);

  const handleSaveScenario = useCallback(() => {
    const label =
      scenarioName.trim() ||
      (isEs
        ? `Escenario ${new Date().toLocaleDateString('es-CO')}`
        : `Scenario ${new Date().toLocaleDateString('en-US')}`);
    const s: ScenarioSave = {
      id: `scn-${Date.now()}`,
      label,
      savedAt: new Date().toISOString(),
      investment,
      discountRate,
      taxRate,
      cashflows,
      npv,
      irr,
      payback,
      pi,
    };
    saveScenario(s);
    setSaved(loadScenarios());
    setScenarioName('');
    setToast(isEs ? 'Escenario guardado' : 'Scenario saved');
    setTimeout(() => setToast(null), 2200);
  }, [scenarioName, investment, discountRate, taxRate, cashflows, npv, irr, payback, pi, isEs]);

  const handleLaunchFeasibility = useCallback(() => {
    setActiveCaseType('feasibility_study');
    // setActiveCaseType ya abre el IntakeModal (openIntakeForType).
  }, [setActiveCaseType]);

  const fade = (i: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.45,
            delay: 0.05 + i * 0.06,
            ease: [0.16, 1, 0.3, 1] as const,
          },
        };

  const npvSeverity =
    npv > investment * 0.5
      ? 'good'
      : npv > 0
        ? 'neutral'
        : npv > -investment * 0.1
          ? 'warn'
          : 'critical';
  const npvColor =
    npvSeverity === 'good'
      ? 'text-[#86EFAC]'
      : npvSeverity === 'neutral'
        ? 'text-[#E8B42C]'
        : npvSeverity === 'warn'
          ? 'text-[#EAB308]'
          : 'text-[#FCA5A5]';

  return (
    <div
      data-theme="elite"
      className={cn(
        'relative w-full min-h-full overflow-y-auto',
        'bg-[#030303] text-[#F5F5F5]',
      )}
    >
      {/* Ambient orbs */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute -top-[20%] -right-[10%] w-[580px] h-[580px] rounded-full blur-[120px] opacity-30"
          style={{
            background:
              'radial-gradient(circle, rgba(212,160,23,0.40) 0%, rgba(212,160,23,0) 70%)',
          }}
        />
      </div>

      <div className="relative z-[1] max-w-[1240px] mx-auto px-6 md:px-10 pt-8 pb-24">
        {/* Breadcrumb back */}
        <motion.div {...fade(0)} className="mb-6">
          <Link
            href="/workspace/futuro"
            prefetch={false}
            className="inline-flex items-center gap-1.5 text-[12px] text-[#A8A8A8] hover:text-[#E8B42C] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            <span>{isEs ? 'Volver a El Futuro' : 'Back to The Future'}</span>
          </Link>
        </motion.div>

        {/* Hero */}
        <motion.div {...fade(1)} className="mb-8">
          <SectionHeader
            eyebrow={isEs ? 'Estudios de Factibilidad' : 'Feasibility Studies'}
            title={futuro.submodules.factibilidad.title}
            subtitle={
              isEs
                ? 'Metodología DNP · Ley 2069/2020 · VPN / TIR / IR · WACC Colombia · Incentivos ZOMAC y Zona Franca'
                : 'DNP methodology · Law 2069/2020 · NPV / IRR / PI · Colombian WACC · ZOMAC & Free-Zone incentives'
            }
            align="left"
            accent="gold"
            divider
          />
        </motion.div>

        {/* Narrative */}
        <motion.p
          {...fade(2)}
          className={cn(
            'font-serif-elite font-normal',
            'text-[20px] sm:text-[22px] md:text-[24px] leading-[1.55]',
            'text-[#D4D4D4] max-w-3xl mb-10',
          )}
        >
          {isEs
            ? 'Cada peso que se compromete debe pagar un costo de oportunidad. Modelamos su proyecto contra el WACC real de Colombia 2026, los incentivos tributarios disponibles y los riesgos sectoriales — para que la decisión de invertir deje de ser una intuición y se convierta en un número.'
            : 'Every peso you commit must pay an opportunity cost. We model your project against the real 2026 Colombian WACC, available tax incentives, and sector risks — so the decision to invest stops being a hunch and becomes a number.'}
        </motion.p>

        {/* Calculadora + resultados */}
        <motion.div {...fade(3)} className="grid gap-5 grid-cols-1 lg:grid-cols-5 mb-12">
          {/* Inputs */}
          <EliteCard
            variant="glass"
            padding="lg"
            className="lg:col-span-3 flex flex-col gap-5"
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-[rgba(212,160,23,0.14)] text-[#E8B42C]"
              >
                <CalculatorIcon className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <div className="flex flex-col">
                <span className="uppercase tracking-[0.18em] text-[11px] font-medium text-[#D4A017]">
                  {isEs ? 'Calculadora' : 'Calculator'}
                </span>
                <h2 className="font-serif-elite text-[22px] leading-tight text-[#F5F5F5]">
                  {isEs ? 'VPN · TIR · Payback · IR' : 'NPV · IRR · Payback · PI'}
                </h2>
              </div>
            </div>

            {/* Inversión inicial */}
            <LabeledNumberInput
              label={isEs ? 'Inversión inicial (COP)' : 'Initial investment (COP)'}
              value={investment}
              onChange={setInvestment}
              step={10_000_000}
              min={0}
              helperText={isEs ? formatCopShort(investment) + ' COP' : formatCopShort(investment) + ' COP'}
            />

            {/* Discount rate + tax rate */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <LabeledNumberInput
                label={isEs ? 'Tasa de descuento (WACC, %)' : 'Discount rate (WACC, %)'}
                value={+(discountRate * 100).toFixed(2)}
                onChange={(v) => setDiscountRate(v / 100)}
                step={0.25}
                min={0}
                max={60}
                helperText={isEs ? 'Ref. CO 2026: 12-15%' : 'CO 2026 ref.: 12-15%'}
              />
              <LabeledNumberInput
                label={isEs ? 'Tasa de impuestos (%)' : 'Tax rate (%)'}
                value={+(taxRate * 100).toFixed(2)}
                onChange={(v) => setTaxRate(v / 100)}
                step={1}
                min={0}
                max={50}
                helperText={isEs ? 'Art. 240 E.T.: 35%' : 'Art. 240 TS: 35%'}
              />
            </div>

            {/* Years controls */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col">
                <span className="uppercase tracking-[0.14em] text-[10px] font-medium text-[#A8A8A8]">
                  {isEs ? 'Horizonte de proyección' : 'Projection horizon'}
                </span>
                <span className="text-[14px] text-[#D4D4D4]">
                  {years} {isEs ? 'años' : 'years'}
                </span>
              </div>
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  aria-label={isEs ? 'Quitar año' : 'Remove year'}
                  onClick={() => handleYearsChange(years - 1)}
                  disabled={years <= 1}
                  className={cn(
                    'inline-flex h-9 w-9 items-center justify-center rounded-[10px]',
                    'bg-[rgba(212,160,23,0.1)] text-[#E8B42C] border border-[rgba(212,160,23,0.3)]',
                    'hover:bg-[rgba(212,160,23,0.18)] transition-colors',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A017] focus-visible:ring-offset-2 focus-visible:ring-offset-[#030303]',
                  )}
                >
                  <Minus className="h-4 w-4" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  aria-label={isEs ? 'Agregar año' : 'Add year'}
                  onClick={() => handleYearsChange(years + 1)}
                  disabled={years >= 10}
                  className={cn(
                    'inline-flex h-9 w-9 items-center justify-center rounded-[10px]',
                    'bg-[rgba(212,160,23,0.1)] text-[#E8B42C] border border-[rgba(212,160,23,0.3)]',
                    'hover:bg-[rgba(212,160,23,0.18)] transition-colors',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A017] focus-visible:ring-offset-2 focus-visible:ring-offset-[#030303]',
                  )}
                >
                  <Plus className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
            </div>

            {/* Flujos por año */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {cashflows.map((cf, idx) => (
                <LabeledNumberInput
                  key={`cf-${idx}`}
                  label={isEs ? `Año ${idx + 1} (COP)` : `Year ${idx + 1} (COP)`}
                  value={cf}
                  onChange={(v) => handleCashflowChange(idx, v)}
                  step={10_000_000}
                  helperText={formatCopShort(cf)}
                  dense
                />
              ))}
            </div>

            {/* Save scenario */}
            <div className="flex flex-col sm:flex-row items-stretch gap-3 pt-2 border-t border-[rgba(212,160,23,0.16)]">
              <input
                type="text"
                value={scenarioName}
                onChange={(e) => setScenarioName(e.target.value)}
                placeholder={isEs ? 'Nombre del escenario (opcional)' : 'Scenario name (optional)'}
                className={cn(
                  'flex-1 h-10 px-3 rounded-[10px] text-[13px]',
                  'bg-[rgba(10,10,10,0.6)] border border-[rgba(212,160,23,0.25)]',
                  'text-[#F5F5F5] placeholder:text-[#6B6B6B]',
                  'focus:outline-none focus:border-[#D4A017] focus:ring-2 focus:ring-[#D4A017] focus:ring-offset-2 focus:ring-offset-[#030303]',
                )}
              />
              <EliteButton
                type="button"
                variant="secondary"
                size="md"
                leftIcon={<Save className="h-4 w-4" strokeWidth={1.9} />}
                onClick={handleSaveScenario}
              >
                {isEs ? 'Guardar escenario' : 'Save scenario'}
              </EliteButton>
            </div>

            {toast && (
              <div
                role="status"
                className="flex items-center gap-2 text-[12px] text-[#86EFAC]"
              >
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                {toast}
              </div>
            )}
          </EliteCard>

          {/* Resultados */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            <ResultCard
              label={isEs ? 'VPN' : 'NPV'}
              value={`${formatCopShort(npv)} COP`}
              color={npvColor}
              hint={
                isEs
                  ? npv > 0
                    ? 'Proyecto crea valor'
                    : 'Proyecto destruye valor'
                  : npv > 0
                    ? 'Project creates value'
                    : 'Project destroys value'
              }
              icon={Lightbulb}
            />
            <ResultCard
              label={isEs ? 'TIR' : 'IRR'}
              value={formatPct(irr)}
              color={
                irr == null
                  ? 'text-[#A8A8A8]'
                  : irr >= discountRate + 0.05
                    ? 'text-[#86EFAC]'
                    : irr >= discountRate
                      ? 'text-[#E8B42C]'
                      : 'text-[#FCA5A5]'
              }
              hint={
                isEs
                  ? `vs WACC ${formatPct(discountRate)}`
                  : `vs WACC ${formatPct(discountRate)}`
              }
              icon={BarChart3}
            />
            <ResultCard
              label={isEs ? 'Payback' : 'Payback'}
              value={formatYears(payback)}
              color={
                payback == null
                  ? 'text-[#FCA5A5]'
                  : payback <= years / 2
                    ? 'text-[#86EFAC]'
                    : 'text-[#E8B42C]'
              }
              hint={
                isEs
                  ? payback != null
                    ? `Se recupera en ${formatYears(payback)}`
                    : 'No se recupera en el horizonte'
                  : payback != null
                    ? `Recovers in ${formatYears(payback)}`
                    : 'Does not recover in horizon'
              }
              icon={CalculatorIcon}
            />
            <ResultCard
              label={isEs ? 'Índice Rentabilidad' : 'Profitability Index'}
              value={pi.toFixed(2)}
              color={
                pi >= 1.3
                  ? 'text-[#86EFAC]'
                  : pi >= 1
                    ? 'text-[#E8B42C]'
                    : 'text-[#FCA5A5]'
              }
              hint={
                isEs
                  ? 'PI > 1.0 crea valor'
                  : 'PI > 1.0 creates value'
              }
              icon={Info}
            />
          </div>
        </motion.div>

        {/* Saved scenarios (condensed) */}
        {saved.length > 0 && (
          <motion.div {...fade(4)} className="mb-12">
            <EliteCard variant="glass" padding="md">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <span className="uppercase tracking-[0.18em] text-[11px] font-medium text-[#D4A017]">
                    {isEs ? 'Escenarios guardados' : 'Saved scenarios'}
                  </span>
                  <div className="text-[13px] text-[#A8A8A8] mt-0.5">
                    {isEs
                      ? `${saved.length} escenario${saved.length === 1 ? '' : 's'} en su workspace (local).`
                      : `${saved.length} scenario${saved.length === 1 ? '' : 's'} in your workspace (local).`}
                  </div>
                </div>
                <FileDown className="h-4 w-4 text-[#A8A8A8]" aria-hidden="true" />
              </div>
              <ul role="list" className="flex flex-col gap-2">
                {saved.slice(0, 5).map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-3 text-[12px] p-2 rounded-[10px] bg-[rgba(10,10,10,0.4)] border border-[rgba(212,160,23,0.12)]"
                  >
                    <span className="text-[#D4D4D4] truncate">{s.label}</span>
                    <div className="flex items-center gap-4 shrink-0 tabular-nums">
                      <span className="text-[#A8A8A8]">
                        VPN{' '}
                        <span className={s.npv > 0 ? 'text-[#86EFAC]' : 'text-[#FCA5A5]'}>
                          {formatCopShort(s.npv)}
                        </span>
                      </span>
                      <span className="text-[#A8A8A8]">
                        TIR <span className="text-[#E8B42C]">{formatPct(s.irr)}</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </EliteCard>
          </motion.div>
        )}

        {/* Checklist de dimensiones + CTA */}
        <motion.div {...fade(5)} className="grid gap-5 grid-cols-1 lg:grid-cols-5">
          <EliteCard
            variant="glass"
            padding="lg"
            className="lg:col-span-3 flex flex-col gap-4"
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-[rgba(212,160,23,0.14)] text-[#E8B42C]"
              >
                <CheckCircle2 className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <div>
                <span className="uppercase tracking-[0.18em] text-[11px] font-medium text-[#D4A017]">
                  {isEs ? 'Dimensiones DNP' : 'DNP dimensions'}
                </span>
                <h3 className="font-serif-elite text-[22px] leading-tight text-[#F5F5F5]">
                  {isEs
                    ? '7 análisis que incluye cada estudio'
                    : '7 analyses included in every study'}
                </h3>
              </div>
            </div>
            <ul
              role="list"
              className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[13px] text-[#D4D4D4]"
            >
              <ChecklistItem icon={Users} label={isEs ? 'Mercado' : 'Market'} />
              <ChecklistItem icon={Brain} label={isEs ? 'Técnico' : 'Technical'} />
              <ChecklistItem icon={Gavel} label={isEs ? 'Legal' : 'Legal'} />
              <ChecklistItem icon={Landmark} label={isEs ? 'Financiero' : 'Financial'} />
              <ChecklistItem icon={Trees} label={isEs ? 'Ambiental' : 'Environmental'} />
              <ChecklistItem icon={Scale} label={isEs ? 'Organizacional' : 'Organizational'} />
              <ChecklistItem icon={AlertTriangle} label={isEs ? 'Riesgos' : 'Risk'} />
            </ul>
          </EliteCard>

          <EliteCard
            variant="glass"
            padding="lg"
            className={cn(
              'lg:col-span-2 flex flex-col gap-4 justify-between',
              'glow-gold-soft',
            )}
          >
            <div>
              <span className="uppercase tracking-[0.18em] text-[11px] font-medium text-[#D4A017]">
                {isEs ? 'Estudio profesional' : 'Professional study'}
              </span>
              <h3 className="font-serif-elite text-[24px] leading-tight text-[#F5F5F5] mt-1 mb-2">
                {isEs ? 'Generar estudio completo' : 'Generate full study'}
              </h3>
              <p className="text-[13px] leading-relaxed text-[#A8A8A8]">
                {isEs
                  ? 'Pipeline de 3 agentes: Analista de Mercado → Modelador Financiero → Evaluador de Riesgo. Resultado en SSE streaming.'
                  : '3-agent pipeline: Market Analyst → Financial Modeler → Risk Assessor. Output streams over SSE.'}
              </p>
            </div>
            <EliteButton
              type="button"
              variant="primary"
              size="lg"
              leftIcon={<Play className="h-4 w-4" strokeWidth={2.2} />}
              onClick={handleLaunchFeasibility}
              glow
              className="w-full"
            >
              {isEs ? 'Iniciar estudio de factibilidad' : 'Start feasibility study'}
            </EliteButton>
            <p className="text-[11px] text-[#6B6B6B]">
              {isEs
                ? 'Endpoint: /api/feasibility-study · maxDuration 300s · requiere OPENAI_API_KEY'
                : 'Endpoint: /api/feasibility-study · maxDuration 300s · requires OPENAI_API_KEY'}
            </p>
          </EliteCard>
        </motion.div>
      </div>
    </div>
  );
}

// ─── Small reusable bits ─────────────────────────────────────────────────────

interface LabeledNumberInputProps {
  label: string;
  value: number;
  onChange: (next: number) => void;
  step?: number;
  min?: number;
  max?: number;
  helperText?: string;
  dense?: boolean;
}

function LabeledNumberInput({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  helperText,
  dense = false,
}: LabeledNumberInputProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span
        className={cn(
          'uppercase tracking-[0.14em] text-[10px] font-medium text-[#A8A8A8]',
          dense ? '' : '',
        )}
      >
        {label}
      </span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return;
          onChange(n);
        }}
        step={step}
        min={min}
        max={max}
        className={cn(
          'h-10 px-3 rounded-[10px] text-[14px]',
          'bg-[rgba(10,10,10,0.6)] border border-[rgba(212,160,23,0.25)]',
          'text-[#F5F5F5] placeholder:text-[#6B6B6B] tabular-nums',
          'focus:outline-none focus:border-[#D4A017] focus:ring-2 focus:ring-[#D4A017] focus:ring-offset-2 focus:ring-offset-[#030303]',
          'transition-[border-color,box-shadow]',
        )}
      />
      {helperText && (
        <span className="text-[11px] text-[#6B6B6B] tabular-nums">{helperText}</span>
      )}
    </label>
  );
}

interface ResultCardProps {
  label: string;
  value: string;
  color?: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

function ResultCard({ label, value, color, hint, icon: Icon }: ResultCardProps) {
  return (
    <div className="relative flex items-start justify-between gap-3 p-4 rounded-[12px] glass-elite-elevated border-elite-gold">
      <div className="flex flex-col gap-1 min-w-0">
        <span className="uppercase tracking-[0.18em] text-[10px] font-medium text-[#A8A8A8]">
          {label}
        </span>
        <span
          className={cn(
            'font-serif-elite text-[30px] md:text-[32px] leading-[1.05] tabular-nums',
            color ?? 'text-[#F5F5F5]',
          )}
        >
          {value}
        </span>
        {hint && <span className="text-[11px] text-[#A8A8A8]">{hint}</span>}
      </div>
      {Icon && (
        <span
          aria-hidden="true"
          className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-[rgba(212,160,23,0.12)] text-[#E8B42C]"
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
      )}
    </div>
  );
}

function ChecklistItem({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
}) {
  return (
    <li className="flex items-center gap-2.5 px-3 py-2 rounded-[10px] bg-[rgba(10,10,10,0.4)] border border-[rgba(212,160,23,0.14)]">
      <span
        aria-hidden="true"
        className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-[8px] bg-[rgba(212,160,23,0.14)] text-[#E8B42C]"
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
      </span>
      <span>{label}</span>
    </li>
  );
}
