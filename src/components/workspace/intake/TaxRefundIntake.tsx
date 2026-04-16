'use client';

import { useState, useCallback } from 'react';
import { Receipt, Landmark, Banknote } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StepWizard, FileUploadZone } from '@/design-system';
import type { WizardStep } from '@/design-system';
import type { TaxRefundIntake as TaxRefundIntakeType } from '@/types/platform';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useIntakePersistence } from './useIntakePersistence';
import { IntakePreview } from './IntakePreview';

// ─── Constants ───────────────────────────────────────────────────────────────

const TAX_TYPES = [
  {
    value: 'iva' as const,
    label: 'IVA Saldo a Favor',
    description: 'Devolucion o compensacion de saldos a favor en IVA.',
    reference: 'Arts. 850-865 E.T. / Decreto 963 de 2024',
    icon: Receipt,
  },
  {
    value: 'renta' as const,
    label: 'Renta Saldo a Favor',
    description: 'Devolucion de saldos originados en declaracion de renta.',
    reference: 'Arts. 850-865 E.T. / Art. 854 E.T.',
    icon: Landmark,
  },
  {
    value: 'retencion' as const,
    label: 'Retencion en la Fuente',
    description: 'Devolucion por exceso de retenciones practicadas.',
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

// ─── Component ───────────────────────────────────────────────────────────────

export function TaxRefundIntake() {
  const { startNewConsultation, setIntakeModalOpen, clearIntakeDraft, setActiveMode } =
    useWorkspace();
  const [step, setStep] = useState(0);
  const [values, setValues] = useIntakePersistence('tax_refund', DEFAULT_VALUES);

  const updateField = useCallback(
    <K extends keyof TaxRefundIntakeType>(key: K, val: TaxRefundIntakeType[K]) => {
      setValues((prev) => ({ ...prev, [key]: val }));
    },
    [setValues],
  );

  const formatCOPInput = (raw: string): number | undefined => {
    const digits = raw.replace(/\D/g, '');
    return digits ? parseInt(digits, 10) : undefined;
  };

  const displayCOP = (amount: number | undefined): string => {
    if (!amount) return '';
    return amount.toLocaleString('es-CO');
  };

  const handleUpload = useCallback(async (_file: File) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
  }, []);

  const handleSubmit = useCallback(() => {
    startNewConsultation('tax-refund');
    setActiveMode('chat');
    clearIntakeDraft('tax_refund');
    setIntakeModalOpen(false);
  }, [startNewConsultation, setActiveMode, clearIntakeDraft, setIntakeModalOpen]);

  // ─── Step 1: Tipo de Devolucion ────────────────────────────────────────────

  const step1 = (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-[#0a0a0a] mb-1">Tipo de Devolucion</h3>
        <p className="text-xs text-[#737373]">Seleccione el tipo de saldo a favor que desea solicitar.</p>
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

  // ─── Step 2: Detalles ──────────────────────────────────────────────────────

  const step2 = (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-[#0a0a0a] mb-1">Detalles de la Solicitud</h3>
        <p className="text-xs text-[#737373]">Informacion del periodo y monto a solicitar.</p>
      </div>

      {/* Periodo */}
      <div>
        <label className="block text-xs font-medium text-[#525252] mb-1.5">
          Periodo gravable <span className="text-[#DC2626]">*</span>
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
        <label className="block text-xs font-medium text-[#525252] mb-1.5">
          Monto aproximado (COP) <span className="text-[#a3a3a3] font-normal">-- opcional</span>
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
          Ya radico la solicitud ante la DIAN?
        </label>
        <div className="flex gap-3">
          {[
            { value: true, label: 'Si, ya radique' },
            { value: false, label: 'No, aun no' },
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
          <label className="block text-xs font-medium text-[#525252] mb-1.5">
            Numero de radicado
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

  // ─── Step 3: Documentos ────────────────────────────────────────────────────

  const step3 = (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-[#0a0a0a] mb-1">Documentos de Soporte</h3>
        <p className="text-xs text-[#737373]">
          Adjunte las declaraciones tributarias y documentos soporte de la solicitud.
        </p>
      </div>
      <FileUploadZone
        onUpload={handleUpload}
        label="Declaraciones tributarias y soportes"
        sublabel="PDF, DOCX, XLSX, imagenes -- Max 25MB"
        accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.jpg,.jpeg,.png"
        maxSizeMB={25}
      />
    </div>
  );

  // ─── Step 4: Preview ───────────────────────────────────────────────────────

  const step4 = (
    <IntakePreview
      caseType="tax_refund"
      data={values}
      onBack={() => setStep(2)}
      onSubmit={handleSubmit}
    />
  );

  // ─── Wizard Steps ──────────────────────────────────────────────────────────

  const steps: WizardStep[] = [
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
