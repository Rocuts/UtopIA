'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import {
  FileWarning,
  FileSearch,
  AlertTriangle,
  FileCheck,
  Clock,
  HelpCircle,
  Upload,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { StepWizard, FileUploadZone } from '@/design-system';
import type { WizardStep } from '@/design-system';
import type { DianDefenseIntake as DianDefenseIntakeType } from '@/types/platform';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useIntakePersistence } from './useIntakePersistence';
import { IntakePreview } from './IntakePreview';
import { useDocumentExtraction, type FieldConfidence } from './useDocumentExtraction';

// ─── Constants ───────────────────────────────────────────────────────────────

const ACT_TYPES = [
  {
    value: 'requerimiento_ordinario' as const,
    label: 'Requerimiento Ordinario',
    description: 'Solicitud de información o aclaración por parte de la DIAN.',
    icon: FileSearch,
  },
  {
    value: 'requerimiento_especial' as const,
    label: 'Requerimiento Especial',
    description: 'Propuesta de modificación de la declaración tributaria.',
    icon: FileWarning,
  },
  {
    value: 'pliego_cargos' as const,
    label: 'Pliego de Cargos',
    description: 'Formulación de cargos por presunta infracción tributaria.',
    icon: AlertTriangle,
  },
  {
    value: 'liquidacion_oficial' as const,
    label: 'Liquidación Oficial',
    description: 'Determinación oficial del impuesto por parte de la DIAN.',
    icon: FileCheck,
  },
  {
    value: 'emplazamiento' as const,
    label: 'Emplazamiento',
    description: 'Citación previa al requerimiento especial para corregir.',
    icon: Clock,
  },
  {
    value: 'otro' as const,
    label: 'Otro Acto Administrativo',
    description: 'Resolución sanción, auto de archivo u otro acto DIAN.',
    icon: HelpCircle,
  },
];

const TAX_OPTIONS = ['IVA', 'Renta', 'Retención', 'ICA', 'Otro'] as const;
const TAX_VALUES = ['iva', 'renta', 'retencion', 'ica', 'otro'] as const;

const DEFAULT_VALUES: DianDefenseIntakeType = {
  caseType: 'dian_defense',
  actType: 'requerimiento_ordinario',
  taxes: [],
  periodStart: '',
  periodEnd: '',
  disputedAmount: undefined,
  responseDeadline: '',
  expedienteNumber: '',
  additionalContext: '',
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

export function DianDefenseIntake() {
  const { startNewConsultation, setIntakeModalOpen, clearIntakeDraft, setActiveMode } =
    useWorkspace();
  const { state: extractionState, uploadAndExtract, reset: resetExtraction } = useDocumentExtraction();
  const [step, setStep] = useState(0);
  const [skippedUpload, setSkippedUpload] = useState(false);
  const [values, setValues] = useIntakePersistence('dian_defense', DEFAULT_VALUES);

  const updateField = useCallback(
    <K extends keyof DianDefenseIntakeType>(key: K, val: DianDefenseIntakeType[K]) => {
      setValues((prev) => ({ ...prev, [key]: val }));
    },
    [setValues],
  );

  const toggleTax = useCallback(
    (tax: DianDefenseIntakeType['taxes'][number]) => {
      setValues((prev) => ({
        ...prev,
        taxes: prev.taxes.includes(tax)
          ? prev.taxes.filter((t) => t !== tax)
          : [...prev.taxes, tax],
      }));
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

      // Detect act type from keywords
      if (text.includes('requerimiento especial')) {
        updateField('actType', 'requerimiento_especial');
      } else if (text.includes('requerimiento ordinario') || text.includes('requerimiento')) {
        updateField('actType', 'requerimiento_ordinario');
      } else if (text.includes('pliego de cargos')) {
        updateField('actType', 'pliego_cargos');
      } else if (text.includes('liquidacion oficial') || text.includes('liquidacion de revision')) {
        updateField('actType', 'liquidacion_oficial');
      } else if (text.includes('emplazamiento')) {
        updateField('actType', 'emplazamiento');
      }

      // Detect taxes involved
      const detectedTaxes: DianDefenseIntakeType['taxes'] = [];
      if (/\biva\b|impuesto.*valor.*agregado/i.test(text)) detectedTaxes.push('iva');
      if (/\brenta\b|impuesto.*renta/i.test(text)) detectedTaxes.push('renta');
      if (/\bretencion\b|retencion.*fuente/i.test(text)) detectedTaxes.push('retencion');
      if (/\bica\b|industria.*comercio/i.test(text)) detectedTaxes.push('ica');
      if (detectedTaxes.length > 0) {
        setValues(prev => ({ ...prev, taxes: detectedTaxes }));
      }

      // Detect amounts (COP patterns)
      const amountMatch = extractionState.extracted.rawText.match(/\$[\s]*([0-9.,]+)/);
      if (amountMatch) {
        const digits = amountMatch[1].replace(/\./g, '').replace(',', '');
        const amount = parseInt(digits, 10);
        if (amount > 0) updateField('disputedAmount', amount);
      }

      // Detect expediente number
      const expedienteMatch = extractionState.extracted.rawText.match(/(?:expediente|radicado|auto)[:\s#]*([0-9-]{6,})/i);
      if (expedienteMatch) {
        updateField('expedienteNumber', expedienteMatch[1]);
      }

      // Detect deadlines (date patterns like DD/MM/YYYY or YYYY-MM-DD)
      const dateMatch = extractionState.extracted.rawText.match(/(?:plazo|termino|vence|fecha\s*limite|responder\s*antes)[:\s]*(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})/i);
      if (dateMatch) {
        const [, d, m, y] = dateMatch;
        updateField('responseDeadline', `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
      }

      // Auto-advance to review step
      const timer = setTimeout(() => setStep(1), 800);
      return () => clearTimeout(timer);
    }
  }, [extractionState.status, extractionState.extracted, updateField, setValues]);

  const formatCOPInput = (raw: string): number | undefined => {
    const digits = raw.replace(/\D/g, '');
    return digits ? parseInt(digits, 10) : undefined;
  };

  const displayCOP = (amount: number | undefined): string => {
    if (!amount) return '';
    return amount.toLocaleString('es-CO');
  };

  const handleSubmit = useCallback(() => {
    startNewConsultation('dian-defense');
    setActiveMode('chat');
    clearIntakeDraft('dian_defense');
    setIntakeModalOpen(false);
  }, [startNewConsultation, setActiveMode, clearIntakeDraft, setIntakeModalOpen]);

  // Confidence tracking for extracted fields
  const extractedConfidence: Record<string, FieldConfidence> = {};
  if (extractionState.status === 'done' && extractionState.extracted) {
    const text = extractionState.extracted.rawText.toLowerCase();
    if (/requerimiento|pliego|liquidacion|emplazamiento/.test(text)) extractedConfidence.actType = 'high';
    if (/\biva\b|\brenta\b|\bretencion\b|\bica\b/.test(text)) extractedConfidence.taxes = 'high';
    if (/\$[\s]*[0-9.,]+/.test(extractionState.extracted.rawText)) extractedConfidence.disputedAmount = 'medium';
    if (/expediente|radicado/.test(text)) extractedConfidence.expedienteNumber = 'medium';
    if (/plazo|termino|vence|fecha\s*limite/.test(text)) extractedConfidence.responseDeadline = 'medium';
  }
  const detected = Object.values(extractedConfidence).filter(c => c === 'high' || c === 'medium').length;
  const totalFields = 5;

  // ─── Step 1: Upload Document ──────────────────────────────────────────────

  const stepUpload = (
    <div className="space-y-4 pb-6">
      <div>
        <h3 className="text-base font-semibold text-n-900 mb-1">Cargue su documento</h3>
        <p className="text-xs text-n-400">
          Cargue el requerimiento, liquidación o acto administrativo de la DIAN
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
          sublabel="Requerimientos, liquidaciones, actos administrativos DIAN"
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

  // ─── Step 2: Tipo de Acto (review) ────────────────────────────────────────

  const step1 = (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-n-900 mb-1">Tipo de Acto Administrativo</h3>
        <p className="text-xs text-n-500">Seleccione el tipo de acto que desea controvertir.</p>
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
        {ACT_TYPES.map((act) => {
          const selected = values.actType === act.value;
          const Icon = act.icon;
          return (
            <button
              key={act.value}
              type="button"
              onClick={() => updateField('actType', act.value)}
              className={cn(
                'flex items-start gap-3 p-4 rounded-lg border-2 text-left transition-all',
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
                  <span className="text-sm font-medium text-n-900">{act.label}</span>
                  {selected && <ConfidenceDot level={extractedConfidence.actType} />}
                </div>
                <p className="text-xs-mono text-n-500 leading-relaxed">{act.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  // ─── Step 3: Detalles ──────────────────────────────────────────────────────

  const step2 = (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-n-900 mb-1">Detalles del Caso</h3>
        <p className="text-xs text-n-500">Proporcione la información relevante del acto administrativo.</p>
      </div>

      {/* Impuestos involucrados */}
      <div>
        <label className="block text-xs font-medium text-n-600 mb-2 flex items-center gap-0.5">
          Impuestos involucrados <ConfidenceDot level={extractedConfidence.taxes} />
        </label>
        <div className="flex flex-wrap gap-2">
          {TAX_OPTIONS.map((label, i) => {
            const val = TAX_VALUES[i];
            const active = values.taxes.includes(val);
            return (
              <button
                key={val}
                type="button"
                onClick={() => toggleTax(val)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                  active
                    ? 'bg-n-900 text-n-0 border-n-900'
                    : 'bg-n-0 text-n-600 border-n-200 hover:border-n-400',
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Periodo */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-n-600 mb-1.5">Periodo desde</label>
          <input
            type="month"
            value={values.periodStart}
            onChange={(e) => updateField('periodStart', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-n-200 text-sm text-n-900 focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-n-600 mb-1.5">Periodo hasta</label>
          <input
            type="month"
            value={values.periodEnd}
            onChange={(e) => updateField('periodEnd', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-n-200 text-sm text-n-900 focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
          />
        </div>
      </div>

      {/* Monto en disputa */}
      <div>
        <label className="block text-xs font-medium text-n-600 mb-1.5 flex items-center gap-0.5">
          Monto en disputa (COP) <ConfidenceDot level={extractedConfidence.disputedAmount} /> <span className="text-n-400 font-normal ml-1">-- opcional</span>
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-n-500">$</span>
          <input
            type="text"
            inputMode="numeric"
            value={displayCOP(values.disputedAmount)}
            onChange={(e) => updateField('disputedAmount', formatCOPInput(e.target.value))}
            placeholder="0"
            className="w-full pl-7 pr-3 py-2 rounded-lg border border-n-200 text-sm text-n-900 focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
          />
        </div>
      </div>

      {/* Fecha limite de respuesta */}
      <div>
        <label className="block text-xs font-medium text-n-600 mb-1.5 flex items-center gap-0.5">
          Fecha límite de respuesta <ConfidenceDot level={extractedConfidence.responseDeadline} /> <span className="text-danger ml-1">*</span>
        </label>
        <input
          type="date"
          value={values.responseDeadline}
          onChange={(e) => updateField('responseDeadline', e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-n-200 text-sm text-n-900 focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
        />
      </div>

      {/* Numero de expediente */}
      <div>
        <label className="block text-xs font-medium text-n-600 mb-1.5 flex items-center gap-0.5">
          Número de expediente <ConfidenceDot level={extractedConfidence.expedienteNumber} /> <span className="text-n-400 font-normal ml-1">-- opcional</span>
        </label>
        <input
          type="text"
          value={values.expedienteNumber ?? ''}
          onChange={(e) => updateField('expedienteNumber', e.target.value)}
          placeholder="Ej: 2024-00001234"
          className="w-full px-3 py-2 rounded-lg border border-n-200 text-sm text-n-900 focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
        />
      </div>
    </div>
  );

  // ─── Step 4: Documentos ────────────────────────────────────────────────────

  const step3 = (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-n-900 mb-1">Documentos de Soporte</h3>
        <p className="text-xs text-n-500">
          Adjunte documentos adicionales de soporte (declaraciones, soportes contables).
        </p>
      </div>
      <FileUploadZone
        onUpload={async (_file: File) => { await new Promise((resolve) => setTimeout(resolve, 800)); }}
        label="Actos administrativos, declaraciones y soportes"
        sublabel="PDF, DOCX, XLSX, imágenes -- Max 25MB"
        accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.jpg,.jpeg,.png"
        maxSizeMB={25}
      />
    </div>
  );

  // ─── Step 5: Preview ───────────────────────────────────────────────────────

  const step4 = (
    <IntakePreview
      caseType="dian_defense"
      data={values}
      onBack={() => setStep(3)}
      onSubmit={handleSubmit}
    />
  );

  // ─── Wizard Steps ──────────────────────────────────────────────────────────

  const steps: WizardStep[] = [
    { id: 'upload', label: 'Documento', isValid: extractionState.status === 'done' || skippedUpload, component: stepUpload },
    { id: 'act-type', label: 'Tipo de Acto', isValid: !!values.actType, component: step1 },
    {
      id: 'details',
      label: 'Detalles',
      isValid: !!values.responseDeadline && values.taxes.length > 0,
      component: step2,
    },
    { id: 'documents', label: 'Documentos', isValid: true, component: step3 },
    { id: 'preview', label: 'Vista Previa', isValid: true, component: step4 },
  ];

  return (
    <StepWizard
      steps={steps}
      currentStep={step}
      onNext={() => setStep((s) => Math.min(s + 1, steps.length - 1))}
      onBack={() => setStep((s) => Math.max(s - 1, 0))}
      onSubmit={handleSubmit}
      submitLabel="Iniciar Defensa"
      className="h-full"
    />
  );
}
