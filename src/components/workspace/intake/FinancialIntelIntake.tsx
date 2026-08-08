'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
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
import { useLanguage } from '@/context/LanguageContext';
import { dict } from '@/lib/i18n/dictionaries';
import { useIntakePersistence } from './useIntakePersistence';
import { IntakePreview } from './IntakePreview';
import { useDocumentExtraction, type FieldConfidence } from './useDocumentExtraction';

// ─── Constants ───────────────────────────────────────────────────────────────

type AnalysisType = FinancialIntelIntakeType['analyses'][number];

/**
 * Valor de enum + icono en el componente; etiqueta y descripción en
 * `intake.financialIntel.analyses`. El valor es lo que se persiste y lo que
 * viaja al pipeline, así que no puede depender del idioma de la interfaz.
 */
const ANALYSIS_TYPES: Array<{ value: AnalysisType; icon: typeof TrendingUp }> = [
  { value: 'cash_flow', icon: TrendingUp },
  { value: 'breakeven', icon: Target },
  { value: 'dcf_valuation', icon: BarChart3 },
  { value: 'cost_structure', icon: PieChart },
  { value: 'profitability', icon: Percent },
  { value: 'tax_simulation', icon: Calculator },
  { value: 'merger_scenario', icon: GitMerge },
];

const DEFAULT_VALUES: FinancialIntelIntakeType = {
  caseType: 'financial_intel',
  analyses: [],
  period: '',
  specificQuestion: '',
};

// ─── Confidence Dot ─────────────────────────────────────────────────────────

type IntakeCommon = (typeof dict)['es']['intake']['common'];

function ConfidenceDot({ level, c }: { level?: FieldConfidence; c: IntakeCommon }) {
  if (!level || level === 'none') return null;
  return (
    <span
      className={cn('inline-block w-1.5 h-1.5 rounded-full ml-1', level === 'high' ? 'bg-success' : 'bg-warning')}
      title={level === 'high' ? c.confHigh : c.confMedium}
    />
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function FinancialIntelIntake() {
  const { startNewConsultation, setIntakeModalOpen, clearIntakeDraft, setActiveMode } =
    useWorkspace();
  const { state: extractionState, uploadAndExtract, reset: resetExtraction } = useDocumentExtraction();
  const { language } = useLanguage();
  const c = dict[language].intake.common;
  const t = dict[language].intake.financialIntel;
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

  // Pre-fill from extraction — guarded by a ref so debounced re-renders
  // (e.g. autosave from useIntakePersistence) can't re-trigger prefill and
  // yank the user back to step 0 mid-edit.
  const hasAutoAdvancedRef = useRef(false);
  useEffect(() => {
    if (extractionState.status === 'idle') {
      hasAutoAdvancedRef.current = false;
      return;
    }
    if (
      extractionState.status === 'done' &&
      extractionState.extracted &&
      !hasAutoAdvancedRef.current
    ) {
      hasAutoAdvancedRef.current = true;
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
        <h3 className="text-base font-semibold text-n-900 mb-1">{c.uploadTitle}</h3>
        <p className="text-xs text-n-600">{t.uploadSubtitle}</p>
      </div>

      {extractionState.status === 'done' && extractionState.extracted ? (
        <div className="space-y-3">
          <div className="border border-success/30 bg-success/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 text-success" />
              <span className="text-sm font-semibold text-success">{extractionState.fileName}</span>
            </div>
            <p className="text-xs text-success/80">
              {c.fieldsDetected.replace('{n}', String(detected)).replace('{total}', String(totalFields))}
            </p>
            {extractionState.extracted.isTrialBalance && (
              <div className="mt-2 pt-2 border-t border-success/20 text-xs text-success/80 space-y-0.5">
                {extractionState.extracted.accountsDetected && (
                  <p>
                    {c.accountsDetected} {extractionState.extracted.accountsDetected}
                  </p>
                )}
                {extractionState.extracted.equationValid !== undefined && (
                  <p>
                    {c.equationLabel}{' '}
                    {extractionState.extracted.equationValid ? c.equationValid : c.equationInvalid}
                  </p>
                )}
              </div>
            )}
          </div>
          <button type="button" onClick={resetExtraction} className="text-xs text-n-400 hover:text-n-600 transition-colors">
            {c.uploadAnother}
          </button>
        </div>
      ) : extractionState.status === 'uploading' || extractionState.status === 'extracting' ? (
        <div className="border border-gold-500/30 bg-gold-500/10 rounded-xl p-6 text-center">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
            <Upload className="w-6 h-6 text-gold-500 mx-auto" />
          </motion.div>
          <p className="text-sm text-gold-700 mt-2 font-medium">
            {extractionState.status === 'uploading' ? c.uploading : c.extracting}
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
          <button type="button" onClick={resetExtraction} className="text-xs text-danger hover:underline mt-2">{c.retry}</button>
        </div>
      ) : (
        <FileUploadZone
          accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.jpg,.jpeg,.png"
          onUpload={uploadAndExtract}
          maxSizeMB={100}
          label={c.dropzoneLabel}
          sublabel={t.dropzoneSublabel}
        />
      )}

      {extractionState.status === 'idle' && (
        <button
          type="button"
          onClick={() => { setSkippedUpload(true); setStep(1); }}
          className="text-xs text-n-400 hover:text-n-600 transition-colors block mx-auto"
        >
          {c.manualFill}
        </button>
      )}
    </div>
  );

  // ─── Step 2: Tipo de Analisis ──────────────────────────────────────────────

  const step1 = (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-n-900 mb-1">{t.analysesStepTitle}</h3>
        <p className="text-xs text-n-500">{t.analysesStepDesc}</p>
        {detected > 0 && !skippedUpload && (
          <div className="flex items-center gap-2 mt-1.5 px-3 py-1.5 bg-success/10 border border-success/30 rounded-lg">
            <CheckCircle className="w-3.5 h-3.5 text-success" />
            <span className="text-xs text-success font-medium">
              {c.fieldsAutoDetected.replace('{n}', String(detected)).replace('{total}', String(totalFields))}
            </span>
            <span className="text-2xs text-success/60 ml-auto flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-success" /> {c.confHighShort}
              <span className="w-1.5 h-1.5 rounded-full bg-warning ml-1" /> {c.confMediumShort}
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
                <span className="text-sm font-medium text-n-900 block">
                  {t.analyses[analysis.value].label}
                </span>
                <p className="text-xs-mono text-n-500 leading-relaxed mt-0.5">
                  {t.analyses[analysis.value].description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
      {values.analyses.length > 0 && (
        <p className="text-xs text-gold-500 font-medium">
          {/* El plural va como cadena completa, no como sufijo 's': en inglés
              "analysis" → "analyses" cambia la raíz, no sólo la terminación. */}
          {(values.analyses.length === 1 ? t.selectedOne : t.selectedMany).replace(
            '{n}',
            String(values.analyses.length),
          )}
          {extractedConfidence.analyses && (
            <ConfidenceDot level={extractedConfidence.analyses} c={c} />
          )}
        </p>
      )}
    </div>
  );

  // ─── Step 3: Detalles + Documentos ─────────────────────────────────────────

  const step2 = (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-n-900 mb-1">{t.detailsTitle}</h3>
        <p className="text-xs text-n-500">{t.detailsDesc}</p>
      </div>

      {/* Periodo */}
      <div>
        <label className="block text-xs font-medium text-n-600 mb-1.5 flex items-center gap-0.5">
          {t.periodLabel} <ConfidenceDot level={extractedConfidence.period} c={c} />{' '}
          <span className="text-danger ml-1">*</span>
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
          {t.questionLabel} <span className="text-n-600 font-normal">{t.questionOptional}</span>
        </label>
        <textarea
          value={values.specificQuestion ?? ''}
          onChange={(e) => {
            if (e.target.value.length <= 500) {
              updateField('specificQuestion', e.target.value);
            }
          }}
          placeholder={t.questionPlaceholder}
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-n-200 text-sm text-n-900 resize-none focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
        />
        <div className="text-right mt-1">
          <span className="text-2xs text-n-600">
            {(values.specificQuestion ?? '').length}/500
          </span>
        </div>
      </div>

      {/* Documentos */}
      <FileUploadZone
        onUpload={async (_file: File) => { await new Promise((resolve) => setTimeout(resolve, 800)); }}
        label={t.docsLabel}
        sublabel={t.docsSublabel}
        accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.jpg,.jpeg,.png"
        maxSizeMB={100}
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
    { id: 'upload', label: c.stepDocument, isValid: extractionState.status === 'done' || skippedUpload, component: stepUpload },
    {
      id: 'analyses',
      label: t.stepAnalyses,
      isValid: values.analyses.length >= 1,
      component: step1,
    },
    {
      id: 'details',
      label: c.stepDetails,
      isValid: !!values.period,
      component: step2,
    },
    { id: 'preview', label: c.stepPreview, isValid: true, component: step3 },
  ];

  return (
    <StepWizard
      steps={steps}
      currentStep={step}
      onNext={() => setStep((s) => Math.min(s + 1, steps.length - 1))}
      onBack={() => setStep((s) => Math.max(s - 1, 0))}
      onSubmit={handleSubmit}
      submitLabel={t.submitLabel}
      className="h-full"
    />
  );
}
