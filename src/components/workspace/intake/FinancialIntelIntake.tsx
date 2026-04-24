'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  TrendingUp,
  Target,
  BarChart3,
  PieChart,
  Percent,
  Calculator,
  GitMerge,
  Check,
  Upload,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { StepWizard, FileUploadZone } from '@/design-system';
import type { WizardStep } from '@/design-system';
import type { FinancialIntelIntake as FinancialIntelIntakeType } from '@/types/platform';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useIntakePersistence } from './useIntakePersistence';
import { IntakePreview } from './IntakePreview';
import { useDocumentExtraction, type FieldConfidence } from './useDocumentExtraction';

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
    description: 'Análisis y proyección del flujo de efectivo operativo, de inversión y financiamiento.',
    icon: TrendingUp,
  },
  {
    value: 'breakeven',
    label: 'Punto de Equilibrio',
    description: 'Cálculo del volumen de ventas necesario para cubrir costos fijos y variables.',
    icon: Target,
  },
  {
    value: 'dcf_valuation',
    label: 'Valoración DCF',
    description: 'Valoración por flujos de caja descontados con tasa WACC.',
    icon: BarChart3,
  },
  {
    value: 'cost_structure',
    label: 'Estructura de Costos',
    description: 'Desglose y análisis de costos fijos, variables y semi-variables.',
    icon: PieChart,
  },
  {
    value: 'profitability',
    label: 'Rentabilidad',
    description: 'Márgenes, ROE, ROA, EBITDA y otros indicadores de rendimiento.',
    icon: Percent,
  },
  {
    value: 'tax_simulation',
    label: 'Simulación Tributaria',
    description: 'Proyección de carga fiscal y escenarios de planeación tributaria.',
    icon: Calculator,
  },
  {
    value: 'merger_scenario',
    label: 'Escenario de Fusión',
    description: 'Modelado financiero de escenarios de integración empresarial.',
    icon: GitMerge,
  },
];

const DEFAULT_VALUES: FinancialIntelIntakeType = {
  caseType: 'financial_intel',
  analyses: [],
  period: '',
  specificQuestion: '',
};

// ─── Confidence Dot ─────────────────────────────────────────────────────────

function ConfidenceDot({ level }: { level?: FieldConfidence }) {
  if (!level || level === 'none') return null;
  return (
    <span
      className={cn('inline-block w-1.5 h-1.5 rounded-full ml-1', level === 'high' ? 'bg-success' : 'bg-warning')}
      title={level === 'high' ? 'Auto-detectado' : 'Inferido — verificar'}
    />
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function FinancialIntelIntake() {
  const { startNewConsultation, setIntakeModalOpen, clearIntakeDraft, setActiveMode } =
    useWorkspace();
  const { state: extractionState, uploadAndExtract, reset: resetExtraction } = useDocumentExtraction();
  const [step, setStep] = useState(0);
  const [skippedUpload, setSkippedUpload] = useState(false);
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

  // Pre-fill from extraction
  useEffect(() => {
    if (extractionState.status === 'done' && extractionState.extracted) {
      const text = extractionState.extracted.rawText.toLowerCase();

      // Detect period
      const periodMatch = extractionState.extracted.rawText.match(/(?:periodo|ano|vigencia|corte)[:\s]*(\d{4})[-/]?(\d{1,2})?/i);
      if (periodMatch) {
        const year = periodMatch[1];
        const month = periodMatch[2] ? periodMatch[2].padStart(2, '0') : '12';
        updateField('period', `${year}-${month}`);
      }

      // Auto-suggest analyses based on document content
      const suggestedAnalyses: AnalysisType[] = [];
      if (/flujo.*efectivo|flujo.*caja|cash\s*flow/i.test(text)) suggestedAnalyses.push('cash_flow');
      if (/punto.*equilibrio|break\s*even/i.test(text)) suggestedAnalyses.push('breakeven');
      if (/ebitda|margen|rentabilidad|roe|roa/i.test(text)) suggestedAnalyses.push('profitability');
      if (/costos?\s*fijos?|costos?\s*variables?|estructura.*costos?/i.test(text)) suggestedAnalyses.push('cost_structure');
      if (/impuesto|tributari|fiscal|renta/i.test(text)) suggestedAnalyses.push('tax_simulation');
      if (/valoracion|dcf|wacc|descont/i.test(text)) suggestedAnalyses.push('dcf_valuation');
      if (/fusion|adquisicion|merger|integracion/i.test(text)) suggestedAnalyses.push('merger_scenario');

      // If we detected relevant analyses, pre-select them; otherwise default to profitability
      if (suggestedAnalyses.length > 0) {
        setValues(prev => ({ ...prev, analyses: suggestedAnalyses }));
      } else if (extractionState.extracted.isTrialBalance || /balance|estado.*financiero|activo.*pasivo/i.test(text)) {
        setValues(prev => ({ ...prev, analyses: ['profitability', 'cost_structure'] }));
      }

      // Auto-advance to review step
      const timer = setTimeout(() => setStep(1), 800);
      return () => clearTimeout(timer);
    }
  }, [extractionState.status, extractionState.extracted, updateField, setValues]);

  const handleSubmit = useCallback(() => {
    startNewConsultation('financial-intelligence');
    setActiveMode('chat');
    clearIntakeDraft('financial_intel');
    setIntakeModalOpen(false);
  }, [startNewConsultation, setActiveMode, clearIntakeDraft, setIntakeModalOpen]);

  // Confidence tracking
  const extractedConfidence: Record<string, FieldConfidence> = {};
  if (extractionState.status === 'done' && extractionState.extracted) {
    const text = extractionState.extracted.rawText.toLowerCase();
    if (/periodo|ano|vigencia|corte/i.test(text)) extractedConfidence.period = 'medium';
    if (values.analyses.length > 0 && !skippedUpload) extractedConfidence.analyses = 'medium';
  }
  const detected = Object.values(extractedConfidence).filter(c => c === 'high' || c === 'medium').length;
  const totalFields = 2;

  // ─── Step 1: Upload Document ──────────────────────────────────────────────

  const stepUpload = (
    <div className="space-y-4 pb-6">
      <div>
        <h3 className="text-base font-semibold text-n-900 mb-1">Cargue su documento</h3>
        <p className="text-xs text-n-400">
          Cargue estados financieros o datos de soporte
        </p>
      </div>

      {extractionState.status === 'done' && extractionState.extracted ? (
        <div className="space-y-3">
          <div className="border border-success/30 bg-success/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 text-success" />
              <span className="text-sm font-semibold text-success">{extractionState.fileName}</span>
            </div>
            <p className="text-xs text-success/80">
              {detected} de {totalFields} campos detectados automáticamente
            </p>
            {extractionState.extracted.isTrialBalance && (
              <div className="mt-2 pt-2 border-t border-success/20 text-xs text-success/80 space-y-0.5">
                {extractionState.extracted.accountsDetected && <p>Cuentas detectadas: {extractionState.extracted.accountsDetected}</p>}
                {extractionState.extracted.equationValid !== undefined && (
                  <p>Ecuación patrimonial: {extractionState.extracted.equationValid ? 'Válida' : 'Con discrepancias'}</p>
                )}
              </div>
            )}
          </div>
          <button type="button" onClick={resetExtraction} className="text-xs text-n-400 hover:text-n-600 transition-colors">
            Subir otro archivo
          </button>
        </div>
      ) : extractionState.status === 'uploading' || extractionState.status === 'extracting' ? (
        <div className="border border-gold-500/30 bg-gold-500/10 rounded-xl p-6 text-center">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
            <Upload className="w-6 h-6 text-gold-500 mx-auto" />
          </motion.div>
          <p className="text-sm text-gold-700 mt-2 font-medium">
            {extractionState.status === 'uploading' ? 'Subiendo archivo...' : 'Extrayendo datos...'}
          </p>
          <div className="w-48 h-1.5 bg-gold-500/20 rounded-full overflow-hidden mx-auto mt-3">
            <motion.div className="h-full bg-gold-500 rounded-full" animate={{ width: `${extractionState.progress}%` }} />
          </div>
        </div>
      ) : extractionState.status === 'error' ? (
        <div className="border border-danger/30 bg-danger/10 rounded-xl p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-danger" />
            <span className="text-sm text-danger">{extractionState.error}</span>
          </div>
          <button type="button" onClick={resetExtraction} className="text-xs text-danger hover:underline mt-2">Intentar de nuevo</button>
        </div>
      ) : (
        <FileUploadZone
          accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.jpg,.jpeg,.png"
          onUpload={uploadAndExtract}
          maxSizeMB={25}
          label="Arrastre su archivo aquí"
          sublabel="Estados financieros, balances de prueba, datos de soporte"
        />
      )}

      {extractionState.status === 'idle' && (
        <button
          type="button"
          onClick={() => { setSkippedUpload(true); setStep(1); }}
          className="text-xs text-n-400 hover:text-n-600 transition-colors block mx-auto"
        >
          Llenar manualmente sin documento
        </button>
      )}
    </div>
  );

  // ─── Step 2: Tipo de Analisis ──────────────────────────────────────────────

  const step1 = (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-n-900 mb-1">Tipos de Análisis</h3>
        <p className="text-xs text-n-500">
          Seleccione uno o más tipos de análisis financiero. Minimo 1 requerido.
        </p>
        {detected > 0 && !skippedUpload && (
          <div className="flex items-center gap-2 mt-1.5 px-3 py-1.5 bg-success/10 border border-success/30 rounded-lg">
            <CheckCircle className="w-3.5 h-3.5 text-success" />
            <span className="text-xs text-success font-medium">
              {detected} de {totalFields} campos auto-detectados
            </span>
            <span className="text-2xs text-success/60 ml-auto flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-success" /> alta
              <span className="w-1.5 h-1.5 rounded-full bg-warning ml-1" /> inferido
            </span>
          </div>
        )}
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
                  ? 'border-gold-500 bg-gold-500/10'
                  : 'border-n-200 hover:border-n-300 bg-n-0',
              )}
            >
              {selected && (
                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-gold-500 flex items-center justify-center">
                  <Check className="w-3 h-3 text-n-0" />
                </div>
              )}
              <Icon
                className={cn(
                  'w-5 h-5',
                  selected ? 'text-gold-500' : 'text-n-600',
                )}
              />
              <div>
                <span className="text-sm font-medium text-n-900 block">{analysis.label}</span>
                <p className="text-xs-mono text-n-500 leading-relaxed mt-0.5">
                  {analysis.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
      {values.analyses.length > 0 && (
        <p className="text-xs text-gold-500 font-medium">
          {values.analyses.length} análisis seleccionado{values.analyses.length > 1 ? 's' : ''}
          {extractedConfidence.analyses && <ConfidenceDot level={extractedConfidence.analyses} />}
        </p>
      )}
    </div>
  );

  // ─── Step 3: Detalles + Documentos ─────────────────────────────────────────

  const step2 = (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-n-900 mb-1">Detalles y Documentos</h3>
        <p className="text-xs text-n-500">Periodo de análisis, pregunta específica y documentos soporte.</p>
      </div>

      {/* Periodo */}
      <div>
        <label className="block text-xs font-medium text-n-600 mb-1.5 flex items-center gap-0.5">
          Periodo de análisis <ConfidenceDot level={extractedConfidence.period} /> <span className="text-danger ml-1">*</span>
        </label>
        <input
          type="month"
          value={values.period}
          onChange={(e) => updateField('period', e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-n-200 text-sm text-n-900 focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
        />
      </div>

      {/* Pregunta especifica */}
      <div>
        <label className="block text-xs font-medium text-n-600 mb-1.5">
          Pregunta o instrucción específica{' '}
          <span className="text-n-400 font-normal">-- opcional, max 500 caracteres</span>
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
          className="w-full px-3 py-2 rounded-lg border border-n-200 text-sm text-n-900 resize-none focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
        />
        <div className="text-right mt-1">
          <span className="text-2xs text-n-400">
            {(values.specificQuestion ?? '').length}/500
          </span>
        </div>
      </div>

      {/* Documentos */}
      <FileUploadZone
        onUpload={async (_file: File) => { await new Promise((resolve) => setTimeout(resolve, 800)); }}
        label="Estados financieros y datos de soporte"
        sublabel="PDF, DOCX, XLSX, CSV -- Max 25MB"
        accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.jpg,.jpeg,.png"
        maxSizeMB={25}
      />
    </div>
  );

  // ─── Step 4: Preview ───────────────────────────────────────────────────────

  const step3 = (
    <IntakePreview
      caseType="financial_intel"
      data={values}
      onBack={() => setStep(2)}
      onSubmit={handleSubmit}
    />
  );

  // ─── Wizard Steps ──────────────────────────────────────────────────────────

  const steps: WizardStep[] = [
    { id: 'upload', label: 'Documento', isValid: extractionState.status === 'done' || skippedUpload, component: stepUpload },
    {
      id: 'analyses',
      label: 'Análisis',
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
      submitLabel="Iniciar Análisis"
      className="h-full"
    />
  );
}
