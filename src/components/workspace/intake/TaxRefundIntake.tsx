'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion } from 'motion/react';
import { Receipt, Landmark, Banknote, Upload, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StepWizard, FileUploadZone } from '@/design-system';
import type { WizardStep } from '@/design-system';
import type { TaxRefundIntake as TaxRefundIntakeType } from '@/types/platform';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useIntakePersistence } from './useIntakePersistence';
import { IntakePreview } from './IntakePreview';
import { useDocumentExtraction, type FieldConfidence } from './useDocumentExtraction';

// ─── Constants ───────────────────────────────────────────────────────────────

const TAX_TYPES = [
  {
    value: 'iva' as const,
    label: 'IVA Saldo a Favor',
    description: 'Devolución o compensación de saldos a favor en IVA.',
    reference: 'Arts. 850-865 E.T. / Decreto 1625 de 2016 (DUR) / Res. DIAN 000151/2012',
    icon: Receipt,
  },
  {
    value: 'renta' as const,
    label: 'Renta Saldo a Favor',
    description: 'Devolución de saldos originados en declaración de renta.',
    reference: 'Arts. 850-865 E.T. / Art. 854 E.T.',
    icon: Landmark,
  },
  {
    value: 'retencion' as const,
    label: 'Retención en la Fuente',
    description: 'Devolución por exceso de retenciones practicadas.',
    reference: 'Arts. 850-865 E.T. / Art. 861 E.T.',
    icon: Banknote,
  },
];

const DEFAULT_VALUES: TaxRefundIntakeType = {
  caseType: 'tax_refund',
  taxType: 'iva',
  period: '',
  approximateAmount: undefined,
  alreadyFiled: false,
  filingNumber: '',
};

// ─── Confidence Dot ─────────────────────────────────────────────────────────

function ConfidenceDot({ level }: { level?: FieldConfidence }) {
  if (!level || level === 'none') return null;
  return (
    <span
      className={cn('inline-block w-1.5 h-1.5 rounded-full ml-1', level === 'high' ? 'bg-[#22C55E]' : 'bg-[#F59E0B]')}
      title={level === 'high' ? 'Auto-detectado' : 'Inferido — verificar'}
    />
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TaxRefundIntake() {
  const { startNewConsultation, setIntakeModalOpen, clearIntakeDraft, setActiveMode } =
    useWorkspace();
  const { state: extractionState, uploadAndExtract, reset: resetExtraction } = useDocumentExtraction();
  const [step, setStep] = useState(0);
  const [skippedUpload, setSkippedUpload] = useState(false);
  const [values, setValues] = useIntakePersistence('tax_refund', DEFAULT_VALUES);

  const updateField = useCallback(
    <K extends keyof TaxRefundIntakeType>(key: K, val: TaxRefundIntakeType[K]) => {
      setValues((prev) => ({ ...prev, [key]: val }));
    },
    [setValues],
  );

  // Pre-fill from extraction
  useEffect(() => {
    if (extractionState.status === 'done' && extractionState.extracted) {
      const text = extractionState.extracted.rawText.toLowerCase();

      // Detect tax type
      if (/\biva\b|impuesto.*valor.*agregado|saldo.*favor.*iva/i.test(text)) {
        updateField('taxType', 'iva');
      } else if (/\brenta\b|impuesto.*renta|saldo.*favor.*renta/i.test(text)) {
        updateField('taxType', 'renta');
      } else if (/\bretencion\b|retencion.*fuente/i.test(text)) {
        updateField('taxType', 'retencion');
      }

      // Detect period (year-month or just year)
      const periodMatch = extractionState.extracted.rawText.match(/(?:periodo|periodo\s*gravable|vigencia|bimestre|ano\s*gravable)[:\s]*(\d{4})[-/]?(\d{1,2})?/i);
      if (periodMatch) {
        const year = periodMatch[1];
        const month = periodMatch[2] ? periodMatch[2].padStart(2, '0') : '01';
        updateField('period', `${year}-${month}`);
      }

      // Detect amount
      const amountMatch = extractionState.extracted.rawText.match(/(?:saldo\s*a?\s*favor|total\s*a?\s*devolver|valor)[:\s]*\$?[\s]*([0-9.,]+)/i);
      if (amountMatch) {
        const digits = amountMatch[1].replace(/\./g, '').replace(',', '');
        const amount = parseInt(digits, 10);
        if (amount > 0) updateField('approximateAmount', amount);
      }

      // Detect filing number
      const filingMatch = extractionState.extracted.rawText.match(/(?:radicado|numero\s*de\s*radicado|formulario)[:\s#]*(\d{8,})/i);
      if (filingMatch) {
        updateField('alreadyFiled', true);
        updateField('filingNumber', filingMatch[1]);
      }

      // Auto-advance to review step
      const timer = setTimeout(() => setStep(1), 800);
      return () => clearTimeout(timer);
    }
  }, [extractionState.status, extractionState.extracted, updateField]);

  const formatCOPInput = (raw: string): number | undefined => {
    const digits = raw.replace(/\D/g, '');
    return digits ? parseInt(digits, 10) : undefined;
  };

  const displayCOP = (amount: number | undefined): string => {
    if (!amount) return '';
    return amount.toLocaleString('es-CO');
  };

  const handleSubmit = useCallback(() => {
    startNewConsultation('tax-refund');
    setActiveMode('chat');
    clearIntakeDraft('tax_refund');
    setIntakeModalOpen(false);
  }, [startNewConsultation, setActiveMode, clearIntakeDraft, setIntakeModalOpen]);

  // Confidence tracking
  const extractedConfidence: Record<string, FieldConfidence> = {};
  if (extractionState.status === 'done' && extractionState.extracted) {
    const text = extractionState.extracted.rawText.toLowerCase();
    if (/\biva\b|\brenta\b|\bretencion\b/.test(text)) extractedConfidence.taxType = 'high';
    if (/periodo|vigencia|ano\s*gravable/i.test(text)) extractedConfidence.period = 'medium';
    if (/saldo.*favor|total.*devolver|valor/i.test(text)) extractedConfidence.approximateAmount = 'medium';
    if (/radicado|formulario/i.test(text)) extractedConfidence.filingNumber = 'medium';
  }
  const detected = Object.values(extractedConfidence).filter(c => c === 'high' || c === 'medium').length;
  const totalFields = 4;

  // ─── Step 1: Upload Document ──────────────────────────────────────────────

  const stepUpload = (
    <div className="space-y-4 pb-6">
      <div>
        <h3 className="text-base font-semibold text-[#0a0a0a] mb-1">Cargue su documento</h3>
        <p className="text-xs text-[#a3a3a3]">
          Cargue la declaración tributaria o solicitud de devolución
        </p>
      </div>

      {extractionState.status === 'done' && extractionState.extracted ? (
        <div className="space-y-3">
          <div className="border border-[#22C55E]/30 bg-[#F0FDF4] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 text-[#22C55E]" />
              <span className="text-sm font-semibold text-[#16A34A]">{extractionState.fileName}</span>
            </div>
            <p className="text-xs text-[#16A34A]/80">
              {detected} de {totalFields} campos detectados automáticamente
            </p>
          </div>
          <button type="button" onClick={resetExtraction} className="text-xs text-[#a3a3a3] hover:text-[#525252] transition-colors">
            Subir otro archivo
          </button>
        </div>
      ) : extractionState.status === 'uploading' || extractionState.status === 'extracting' ? (
        <div className="border border-[#D4A017]/30 bg-[#FEF9EC] rounded-xl p-6 text-center">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
            <Upload className="w-6 h-6 text-[#D4A017] mx-auto" />
          </motion.div>
          <p className="text-sm text-[#7D5B0C] mt-2 font-medium">
            {extractionState.status === 'uploading' ? 'Subiendo archivo...' : 'Extrayendo datos...'}
          </p>
          <div className="w-48 h-1.5 bg-[#D4A017]/20 rounded-full overflow-hidden mx-auto mt-3">
            <motion.div className="h-full bg-[#D4A017] rounded-full" animate={{ width: `${extractionState.progress}%` }} />
          </div>
        </div>
      ) : extractionState.status === 'error' ? (
        <div className="border border-[#EF4444]/30 bg-[#FEF2F2] rounded-xl p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#EF4444]" />
            <span className="text-sm text-[#DC2626]">{extractionState.error}</span>
          </div>
          <button type="button" onClick={resetExtraction} className="text-xs text-[#DC2626] hover:underline mt-2">Intentar de nuevo</button>
        </div>
      ) : (
        <FileUploadZone
          accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.jpg,.jpeg,.png"
          onUpload={uploadAndExtract}
          maxSizeMB={25}
          label="Arrastre su archivo aquí"
          sublabel="Declaraciones tributarias, solicitudes de devolución"
        />
      )}

      {extractionState.status === 'idle' && (
        <button
          type="button"
          onClick={() => { setSkippedUpload(true); setStep(1); }}
          className="text-xs text-[#a3a3a3] hover:text-[#525252] transition-colors block mx-auto"
        >
          Llenar manualmente sin documento
        </button>
      )}
    </div>
  );

  // ─── Step 2: Tipo de Devolucion ────────────────────────────────────────────

  const step1 = (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-[#0a0a0a] mb-1">Tipo de Devolución</h3>
        <p className="text-xs text-[#737373]">Seleccione el tipo de saldo a favor que desea solicitar.</p>
        {detected > 0 && !skippedUpload && (
          <div className="flex items-center gap-2 mt-1.5 px-3 py-1.5 bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg">
            <CheckCircle className="w-3.5 h-3.5 text-[#22C55E]" />
            <span className="text-xs text-[#16A34A] font-medium">
              {detected} de {totalFields} campos auto-detectados
            </span>
            <span className="text-[10px] text-[#16A34A]/60 ml-auto flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" /> alta
              <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] ml-1" /> inferido
            </span>
          </div>
        )}
      </div>
      <div className="space-y-3">
        {TAX_TYPES.map((tax) => {
          const selected = values.taxType === tax.value;
          const Icon = tax.icon;
          return (
            <button
              key={tax.value}
              type="button"
              onClick={() => updateField('taxType', tax.value)}
              className={cn(
                'w-full flex items-start gap-4 p-5 rounded-lg border-2 text-left transition-all',
                selected
                  ? 'border-[#D4A017] bg-[#FEF9EC]'
                  : 'border-[#e5e5e5] hover:border-[#d4d4d4] bg-white',
              )}
            >
              <div
                className={cn(
                  'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5',
                  selected ? 'border-[#D4A017]' : 'border-[#d4d4d4]',
                )}
              >
                {selected && <div className="w-2.5 h-2.5 rounded-full bg-[#D4A017]" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Icon
                    className={cn(
                      'w-5 h-5 shrink-0',
                      selected ? 'text-[#D4A017]' : 'text-[#a3a3a3]',
                    )}
                  />
                  <span className="text-sm font-semibold text-[#0a0a0a]">{tax.label}</span>
                  {selected && <ConfidenceDot level={extractedConfidence.taxType} />}
                </div>
                <p className="text-xs text-[#737373] mb-1.5">{tax.description}</p>
                <span className="text-[10px] font-mono text-[#a3a3a3] bg-[#f5f5f5] px-2 py-0.5 rounded">
                  {tax.reference}
                </span>
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
        <h3 className="text-sm font-semibold text-[#0a0a0a] mb-1">Detalles de la Solicitud</h3>
        <p className="text-xs text-[#737373]">Información del periodo y monto a solicitar.</p>
      </div>

      {/* Periodo */}
      <div>
        <label className="block text-xs font-medium text-[#525252] mb-1.5 flex items-center gap-0.5">
          Periodo gravable <ConfidenceDot level={extractedConfidence.period} /> <span className="text-[#DC2626] ml-1">*</span>
        </label>
        <input
          type="month"
          value={values.period}
          onChange={(e) => updateField('period', e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
        />
      </div>

      {/* Monto aproximado */}
      <div>
        <label className="block text-xs font-medium text-[#525252] mb-1.5 flex items-center gap-0.5">
          Monto aproximado (COP) <ConfidenceDot level={extractedConfidence.approximateAmount} /> <span className="text-[#a3a3a3] font-normal ml-1">-- opcional</span>
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#737373]">$</span>
          <input
            type="text"
            inputMode="numeric"
            value={displayCOP(values.approximateAmount)}
            onChange={(e) => updateField('approximateAmount', formatCOPInput(e.target.value))}
            placeholder="0"
            className="w-full pl-7 pr-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
          />
        </div>
      </div>

      {/* Ya radicado? */}
      <div>
        <label className="block text-xs font-medium text-[#525252] mb-2">
          ¿Ya radicó la solicitud ante la DIAN?
        </label>
        <div className="flex gap-3">
          {[
            { value: true, label: 'Sí, ya radiqué' },
            { value: false, label: 'No, aún no' },
          ].map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => updateField('alreadyFiled', opt.value)}
              className={cn(
                'flex-1 py-2.5 rounded-lg border-2 text-sm font-medium transition-colors',
                values.alreadyFiled === opt.value
                  ? 'border-[#D4A017] bg-[#FEF9EC] text-[#0a0a0a]'
                  : 'border-[#e5e5e5] text-[#525252] hover:border-[#d4d4d4]',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Numero de radicado */}
      {values.alreadyFiled && (
        <div>
          <label className="block text-xs font-medium text-[#525252] mb-1.5 flex items-center gap-0.5">
            Número de radicado <ConfidenceDot level={extractedConfidence.filingNumber} />
          </label>
          <input
            type="text"
            value={values.filingNumber ?? ''}
            onChange={(e) => updateField('filingNumber', e.target.value)}
            placeholder="Ej: 202400123456"
            className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
          />
        </div>
      )}
    </div>
  );

  // ─── Step 4: Documentos ────────────────────────────────────────────────────

  const step3 = (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-[#0a0a0a] mb-1">Documentos de Soporte</h3>
        <p className="text-xs text-[#737373]">
          Adjunte documentos adicionales de soporte de la solicitud.
        </p>
      </div>
      <FileUploadZone
        onUpload={async (_file: File) => { await new Promise((resolve) => setTimeout(resolve, 800)); }}
        label="Declaraciones tributarias y soportes"
        sublabel="PDF, DOCX, XLSX, imágenes -- Max 25MB"
        accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.jpg,.jpeg,.png"
        maxSizeMB={25}
      />
    </div>
  );

  // ─── Step 5: Preview ───────────────────────────────────────────────────────

  const step4 = (
    <IntakePreview
      caseType="tax_refund"
      data={values}
      onBack={() => setStep(3)}
      onSubmit={handleSubmit}
    />
  );

  // ─── Wizard Steps ──────────────────────────────────────────────────────────

  const steps: WizardStep[] = [
    { id: 'upload', label: 'Documento', isValid: extractionState.status === 'done' || skippedUpload, component: stepUpload },
    { id: 'tax-type', label: 'Tipo', isValid: !!values.taxType, component: step1 },
    { id: 'details', label: 'Detalles', isValid: !!values.period, component: step2 },
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
      submitLabel="Iniciar Solicitud"
      className="h-full"
    />
  );
}
