'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import {
  CreditCard,
  TrendingUp,
  Store,
  GitMerge,
  HelpCircle,
  Info,
  Upload,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { StepWizard, FileUploadZone } from '@/design-system';
import type { WizardStep } from '@/design-system';
import type { DueDiligenceIntake as DueDiligenceIntakeType } from '@/types/platform';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useLanguage } from '@/context/LanguageContext';
import { dict } from '@/lib/i18n/dictionaries';
import { useIntakePersistence } from './useIntakePersistence';
import { IntakePreview } from './IntakePreview';
import { useDocumentExtraction, type FieldConfidence } from './useDocumentExtraction';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Valor de enum + icono en el componente; etiqueta y descripción en
 * `intake.dueDiligence`. El borrador persiste el valor, nunca la etiqueta.
 */
const PURPOSES = [
  { value: 'credito' as const, icon: CreditCard },
  { value: 'inversion' as const, icon: TrendingUp },
  { value: 'venta' as const, icon: Store },
  { value: 'fusion' as const, icon: GitMerge },
  { value: 'otro' as const, icon: HelpCircle },
];

// 'SAS' | 'SA' | 'LTDA' | 'SCS' son formas societarias colombianas: son el
// valor y a la vez su propia etiqueta. Sólo 'otro' necesita traducción.
const ENTITY_VALUES: DueDiligenceIntakeType['entityType'][] = ['SAS', 'SA', 'LTDA', 'SCS', 'otro'];

const NIIF_GROUPS = [
  { value: 1 as const, key: 'g1' as const },
  { value: 2 as const, key: 'g2' as const },
  { value: 3 as const, key: 'g3' as const },
];

const DEFAULT_VALUES: DueDiligenceIntakeType = {
  caseType: 'due_diligence',
  purpose: 'credito',
  companyName: '',
  nit: '',
  periodStart: '',
  periodEnd: '',
  entityType: 'SAS',
  niifGroup: 2,
};

// ─── NIT Formatter ───────────────────────────────────────────────────────────

function formatNIT(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9)
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 10)}`;
}

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

export function DueDiligenceIntake() {
  const { startNewConsultation, setIntakeModalOpen, clearIntakeDraft, setActiveMode } =
    useWorkspace();
  const { state: extractionState, uploadAndExtract, reset: resetExtraction } = useDocumentExtraction();
  const { language } = useLanguage();
  const c = dict[language].intake.common;
  const t = dict[language].intake.dueDiligence;
  const [step, setStep] = useState(0);
  const [skippedUpload, setSkippedUpload] = useState(false);
  const [values, setValues] = useIntakePersistence('due_diligence', DEFAULT_VALUES);

  const updateField = useCallback(
    <K extends keyof DueDiligenceIntakeType>(key: K, val: DueDiligenceIntakeType[K]) => {
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
      const ext = extractionState.extracted;

      // Company name
      if (ext.company.name) updateField('companyName', ext.company.name);

      // NIT
      if (ext.company.nit) updateField('nit', ext.company.nit);

      // Entity type
      if (ext.company.entityType) {
        const et = ext.company.entityType.toUpperCase();
        if (et === 'SAS' || et === 'SA' || et === 'LTDA' || et === 'SCS') {
          updateField('entityType', et as DueDiligenceIntakeType['entityType']);
        }
      }

      // NIIF group
      if (ext.niifGroup) updateField('niifGroup', ext.niifGroup);

      // Auto-advance to review step
      const timer = setTimeout(() => setStep(1), 800);
      return () => clearTimeout(timer);
    }
  }, [extractionState.status, extractionState.extracted, updateField]);

  const handleSubmit = useCallback(() => {
    startNewConsultation('due-diligence');
    setActiveMode('chat');
    clearIntakeDraft('due_diligence');
    setIntakeModalOpen(false);
  }, [startNewConsultation, setActiveMode, clearIntakeDraft, setIntakeModalOpen]);

  // Confidence tracking
  const confidence = extractionState.extracted?.confidence ?? {};
  const extractedConfidence: Record<string, FieldConfidence> = {};
  if (extractionState.status === 'done' && extractionState.extracted) {
    if (confidence.name) extractedConfidence.companyName = confidence.name;
    if (confidence.nit) extractedConfidence.nit = confidence.nit;
    if (confidence.entityType) extractedConfidence.entityType = confidence.entityType;
    if (confidence.niifGroup && confidence.niifGroup !== 'none') extractedConfidence.niifGroup = confidence.niifGroup;
  }
  const detected = Object.values(extractedConfidence).filter(c => c === 'high' || c === 'medium').length;
  const totalFields = 4;

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

  // ─── Step 2: Proposito ─────────────────────────────────────────────────────

  const step1 = (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-n-900 mb-1">{t.purposeStepTitle}</h3>
        <p className="text-xs text-n-500">{t.purposeStepDesc}</p>
      </div>
      <div className="space-y-3">
        {PURPOSES.map((purpose) => {
          const selected = values.purpose === purpose.value;
          const Icon = purpose.icon;
          return (
            <button
              key={purpose.value}
              type="button"
              onClick={() => updateField('purpose', purpose.value)}
              className={cn(
                'w-full flex items-start gap-4 p-4 rounded-lg border-2 text-left transition-all',
                selected
                  ? 'border-gold-500 bg-gold-500/10'
                  : 'border-n-200 hover:border-n-300 bg-n-0',
              )}
            >
              <div
                className={cn(
                  'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5',
                  selected ? 'border-gold-500' : 'border-n-300',
                )}
              >
                {selected && <div className="w-2.5 h-2.5 rounded-full bg-gold-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Icon
                    className={cn(
                      'w-4 h-4 shrink-0',
                      selected ? 'text-gold-500' : 'text-n-600',
                    )}
                  />
                  <span className="text-sm font-medium text-n-900">
                    {t.purposes[purpose.value].label}
                  </span>
                </div>
                <p className="text-xs text-n-500">{t.purposes[purpose.value].description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  // ─── Step 3: Datos de la Empresa ───────────────────────────────────────────

  const step2 = (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-n-900 mb-1">{t.companyStepTitle}</h3>
        <p className="text-xs text-n-500">{t.companyStepDesc}</p>
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

      {/* Razon Social */}
      <div>
        <label className="block text-xs font-medium text-n-600 mb-1.5 flex items-center gap-0.5">
          {c.companyName} <ConfidenceDot level={extractedConfidence.companyName} c={c} />{' '}
          <span className="text-danger ml-1">*</span>
        </label>
        <input
          type="text"
          value={values.companyName}
          onChange={(e) => updateField('companyName', e.target.value)}
          placeholder={t.companyPlaceholder}
          className="w-full px-3 py-2 rounded-lg border border-n-200 text-sm text-n-900 focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
        />
      </div>

      {/* NIT */}
      <div>
        <label className="block text-xs font-medium text-n-600 mb-1.5 flex items-center gap-0.5">
          {c.nit} <ConfidenceDot level={extractedConfidence.nit} c={c} />{' '}
          <span className="text-danger ml-1">*</span>
        </label>
        <input
          type="text"
          value={values.nit}
          onChange={(e) => updateField('nit', formatNIT(e.target.value))}
          placeholder={c.nitPlaceholder}
          maxLength={13}
          className="w-full px-3 py-2 rounded-lg border border-n-200 text-sm text-n-900 font-mono focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
        />
      </div>

      {/* Tipo de Entidad */}
      <div>
        <label className="block text-xs font-medium text-n-600 mb-2 flex items-center gap-0.5">
          {c.entityType} <ConfidenceDot level={extractedConfidence.entityType} c={c} />
        </label>
        <div className="flex flex-wrap gap-2">
          {ENTITY_VALUES.map((val) => {
            const active = values.entityType === val;
            return (
              <button
                key={val}
                type="button"
                onClick={() => updateField('entityType', val)}
                className={cn(
                  'px-3.5 py-1.5 rounded-full text-xs font-medium border transition-colors',
                  active
                    ? 'bg-n-900 text-n-0 border-n-900'
                    : 'bg-n-0 text-n-600 border-n-200 hover:border-n-400',
                )}
              >
                {val === 'otro' ? c.other : val}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grupo NIIF */}
      <div>
        <label className="block text-xs font-medium text-n-600 mb-2 flex items-center gap-0.5">
          {c.niifGroup} <ConfidenceDot level={extractedConfidence.niifGroup} c={c} />
        </label>
        <div className="space-y-2">
          {NIIF_GROUPS.map((group) => {
            const selected = values.niifGroup === group.value;
            return (
              <button
                key={group.value}
                type="button"
                onClick={() => updateField('niifGroup', group.value)}
                className={cn(
                  'w-full flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-all',
                  selected
                    ? 'border-gold-500 bg-gold-500/10'
                    : 'border-n-200 hover:border-n-300 bg-n-0',
                )}
              >
                <div
                  className={cn(
                    'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5',
                    selected ? 'border-gold-500' : 'border-n-300',
                  )}
                >
                  {selected && <div className="w-2 h-2 rounded-full bg-gold-500" />}
                </div>
                <div>
                  <span className="text-xs font-medium text-n-900">
                    {t.niifGroups[group.key].label}
                  </span>
                  <p className="text-xs-mono text-n-500">{t.niifGroups[group.key].description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Periodo */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-n-600 mb-1.5">
            {c.periodFrom} <span className="text-danger">*</span>
          </label>
          <input
            type="month"
            value={values.periodStart}
            onChange={(e) => updateField('periodStart', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-n-200 text-sm text-n-900 focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-n-600 mb-1.5">
            {c.periodTo} <span className="text-danger">*</span>
          </label>
          <input
            type="month"
            value={values.periodEnd}
            onChange={(e) => updateField('periodEnd', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-n-200 text-sm text-n-900 focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
          />
        </div>
      </div>
    </div>
  );

  // ─── Step 4: Documentos ────────────────────────────────────────────────────

  const step3 = (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-n-900 mb-1">{c.supportDocsTitle}</h3>
        <p className="text-xs text-n-500">{t.docsDesc}</p>
      </div>

      {/* Document checklist */}
      <div className="rounded-lg border border-n-200 bg-n-50 p-3 space-y-1.5">
        <div className="flex items-center gap-1.5 mb-2">
          <Info className="w-3.5 h-3.5 text-gold-500" />
          <span className="text-xs font-semibold text-n-600">{t.checklistTitle}</span>
        </div>
        {t.checklist.map((doc) => (
          <div key={doc} className="flex items-center gap-2 text-xs-mono text-n-500">
            <div className="w-1 h-1 rounded-full bg-n-300 shrink-0" />
            {doc}
          </div>
        ))}
      </div>

      <FileUploadZone
        onUpload={async (_file: File) => { await new Promise((resolve) => setTimeout(resolve, 800)); }}
        label={t.docsLabel}
        sublabel={c.fileTypesHint}
        accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.jpg,.jpeg,.png"
        maxSizeMB={100}
      />
    </div>
  );

  // ─── Step 5: Preview ───────────────────────────────────────────────────────

  const step4 = (
    <IntakePreview
      caseType="due_diligence"
      data={values}
      onBack={() => setStep(3)}
      onSubmit={handleSubmit}
    />
  );

  // ─── Wizard Steps ──────────────────────────────────────────────────────────

  const steps: WizardStep[] = [
    { id: 'upload', label: c.stepDocument, isValid: extractionState.status === 'done' || skippedUpload, component: stepUpload },
    { id: 'purpose', label: t.stepPurpose, isValid: !!values.purpose, component: step1 },
    {
      id: 'company',
      label: c.stepCompany,
      isValid: !!values.companyName && !!values.nit && !!values.periodStart && !!values.periodEnd,
      component: step2,
    },
    { id: 'documents', label: c.stepDocuments, isValid: true, component: step3 },
    { id: 'preview', label: c.stepPreview, isValid: true, component: step4 },
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
