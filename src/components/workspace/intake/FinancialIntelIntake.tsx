'use client';

import { useState, useCallback } from 'react';
import {
  TrendingUp,
  Target,
  BarChart3,
  PieChart,
  Percent,
  Calculator,
  GitMerge,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { StepWizard, FileUploadZone } from '@/design-system';
import type { WizardStep } from '@/design-system';
import type { FinancialIntelIntake as FinancialIntelIntakeType } from '@/types/platform';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useIntakePersistence } from './useIntakePersistence';
import { IntakePreview } from './IntakePreview';

// ─── Constants ───────────────────────────────────────────────────────────────

type AnalysisType = FinancialIntelIntakeType['analyses'][number];

const ANALYSIS_TYPES: Array<{
  value: AnalysisType;
  label: string;
  description: string;
  icon: typeof TrendingUp;
}> = [
  {
    value: 'cash_flow',
    label: 'Flujo de Caja',
    description: 'Analisis y proyeccion del flujo de efectivo operativo, de inversion y financiamiento.',
    icon: TrendingUp,
  },
  {
    value: 'breakeven',
    label: 'Punto de Equilibrio',
    description: 'Calculo del volumen de ventas necesario para cubrir costos fijos y variables.',
    icon: Target,
  },
  {
    value: 'dcf_valuation',
    label: 'Valoracion DCF',
    description: 'Valoracion por flujos de caja descontados con tasa WACC.',
    icon: BarChart3,
  },
  {
    value: 'cost_structure',
    label: 'Estructura de Costos',
    description: 'Desglose y analisis de costos fijos, variables y semi-variables.',
    icon: PieChart,
  },
  {
    value: 'profitability',
    label: 'Rentabilidad',
    description: 'Margenes, ROE, ROA, EBITDA y otros indicadores de rendimiento.',
    icon: Percent,
  },
  {
    value: 'tax_simulation',
    label: 'Simulacion Tributaria',
    description: 'Proyeccion de carga fiscal y escenarios de planeacion tributaria.',
    icon: Calculator,
  },
  {
    value: 'merger_scenario',
    label: 'Escenario de Fusion',
    description: 'Modelado financiero de escenarios de integracion empresarial.',
    icon: GitMerge,
  },
];

const DEFAULT_VALUES: FinancialIntelIntakeType = {
  caseType: 'financial_intel',
  analyses: [],
  period: '',
  specificQuestion: '',
};

// ─── Component ───────────────────────────────────────────────────────────────

export function FinancialIntelIntake() {
  const { startNewConsultation, setIntakeModalOpen, clearIntakeDraft, setActiveMode } =
    useWorkspace();
  const [step, setStep] = useState(0);
  const [values, setValues] = useIntakePersistence('financial_intel', DEFAULT_VALUES);

  const toggleAnalysis = useCallback(
    (analysis: AnalysisType) => {
      setValues((prev) => ({
        ...prev,
        analyses: prev.analyses.includes(analysis)
          ? prev.analyses.filter((a) => a !== analysis)
          : [...prev.analyses, analysis],
      }));
    },
    [setValues],
  );

  const updateField = useCallback(
    <K extends keyof FinancialIntelIntakeType>(key: K, val: FinancialIntelIntakeType[K]) => {
      setValues((prev) => ({ ...prev, [key]: val }));
    },
    [setValues],
  );

  const handleUpload = useCallback(async (_file: File) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
  }, []);

  const handleSubmit = useCallback(() => {
    startNewConsultation('financial-intelligence');
    setActiveMode('chat');
    clearIntakeDraft('financial_intel');
    setIntakeModalOpen(false);
  }, [startNewConsultation, setActiveMode, clearIntakeDraft, setIntakeModalOpen]);

  // ─── Step 1: Tipo de Analisis ──────────────────────────────────────────────

  const step1 = (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-[#0a0a0a] mb-1">Tipos de Analisis</h3>
        <p className="text-xs text-[#737373]">
          Seleccione uno o mas tipos de analisis financiero. Minimo 1 requerido.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {ANALYSIS_TYPES.map((analysis) => {
          const selected = values.analyses.includes(analysis.value);
          const Icon = analysis.icon;
          return (
            <button
              key={analysis.value}
              type="button"
              onClick={() => toggleAnalysis(analysis.value)}
              className={cn(
                'relative flex flex-col items-start gap-2 p-4 rounded-lg border-2 text-left transition-all',
                selected
                  ? 'border-[#D4A017] bg-[#FEF9EC]'
                  : 'border-[#e5e5e5] hover:border-[#d4d4d4] bg-white',
              )}
            >
              {selected && (
                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#D4A017] flex items-center justify-center">
                  <Check className="w-3 h-3 text-white" />
                </div>
              )}
              <Icon
                className={cn(
                  'w-5 h-5',
                  selected ? 'text-[#D4A017]' : 'text-[#a3a3a3]',
                )}
              />
              <div>
                <span className="text-sm font-medium text-[#0a0a0a] block">{analysis.label}</span>
                <p className="text-[11px] text-[#737373] leading-relaxed mt-0.5">
                  {analysis.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
      {values.analyses.length > 0 && (
        <p className="text-xs text-[#D4A017] font-medium">
          {values.analyses.length} analisis seleccionado{values.analyses.length > 1 ? 's' : ''}
        </p>
      )}
    </div>
  );

  // ─── Step 2: Detalles + Documentos ─────────────────────────────────────────

  const step2 = (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-[#0a0a0a] mb-1">Detalles y Documentos</h3>
        <p className="text-xs text-[#737373]">Periodo de analisis, pregunta especifica y documentos soporte.</p>
      </div>

      {/* Periodo */}
      <div>
        <label className="block text-xs font-medium text-[#525252] mb-1.5">
          Periodo de analisis <span className="text-[#DC2626]">*</span>
        </label>
        <input
          type="month"
          value={values.period}
          onChange={(e) => updateField('period', e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
        />
      </div>

      {/* Pregunta especifica */}
      <div>
        <label className="block text-xs font-medium text-[#525252] mb-1.5">
          Pregunta o instruccion especifica{' '}
          <span className="text-[#a3a3a3] font-normal">-- opcional, max 500 caracteres</span>
        </label>
        <textarea
          value={values.specificQuestion ?? ''}
          onChange={(e) => {
            if (e.target.value.length <= 500) {
              updateField('specificQuestion', e.target.value);
            }
          }}
          placeholder="Ej: Necesito comparar el margen EBITDA con el sector retail en Colombia..."
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] resize-none focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
        />
        <div className="text-right mt-1">
          <span className="text-[10px] text-[#a3a3a3]">
            {(values.specificQuestion ?? '').length}/500
          </span>
        </div>
      </div>

      {/* Documentos */}
      <FileUploadZone
        onUpload={handleUpload}
        label="Estados financieros y datos de soporte"
        sublabel="PDF, DOCX, XLSX, CSV -- Max 25MB"
        accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.jpg,.jpeg,.png"
        maxSizeMB={25}
      />
    </div>
  );

  // ─── Step 3: Preview ───────────────────────────────────────────────────────

  const step3 = (
    <IntakePreview
      caseType="financial_intel"
      data={values}
      onBack={() => setStep(1)}
      onSubmit={handleSubmit}
    />
  );

  // ─── Wizard Steps ──────────────────────────────────────────────────────────

  const steps: WizardStep[] = [
    {
      id: 'analyses',
      label: 'Analisis',
      isValid: values.analyses.length >= 1,
      component: step1,
    },
    {
      id: 'details',
      label: 'Detalles',
      isValid: !!values.period,
      component: step2,
    },
    { id: 'preview', label: 'Vista Previa', isValid: true, component: step3 },
  ];

  return (
    <StepWizard
      steps={steps}
      currentStep={step}
      onNext={() => setStep((s) => Math.min(s + 1, steps.length - 1))}
      onBack={() => setStep((s) => Math.max(s - 1, 0))}
      onSubmit={handleSubmit}
      submitLabel="Iniciar Analisis"
      className="h-full"
    />
  );
}
