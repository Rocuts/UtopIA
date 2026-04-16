'use client';

import { useState, useCallback } from 'react';
import {
  FileWarning,
  FileSearch,
  AlertTriangle,
  FileCheck,
  Clock,
  HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { StepWizard, FileUploadZone } from '@/design-system';
import type { WizardStep } from '@/design-system';
import type { DianDefenseIntake as DianDefenseIntakeType } from '@/types/platform';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useIntakePersistence } from './useIntakePersistence';
import { IntakePreview } from './IntakePreview';

// ─── Constants ───────────────────────────────────────────────────────────────

const ACT_TYPES = [
  {
    value: 'requerimiento_ordinario' as const,
    label: 'Requerimiento Ordinario',
    description: 'Solicitud de informacion o aclaracion por parte de la DIAN.',
    icon: FileSearch,
  },
  {
    value: 'requerimiento_especial' as const,
    label: 'Requerimiento Especial',
    description: 'Propuesta de modificacion de la declaracion tributaria.',
    icon: FileWarning,
  },
  {
    value: 'pliego_cargos' as const,
    label: 'Pliego de Cargos',
    description: 'Formulacion de cargos por presunta infraccion tributaria.',
    icon: AlertTriangle,
  },
  {
    value: 'liquidacion_oficial' as const,
    label: 'Liquidacion Oficial',
    description: 'Determinacion oficial del impuesto por parte de la DIAN.',
    icon: FileCheck,
  },
  {
    value: 'emplazamiento' as const,
    label: 'Emplazamiento',
    description: 'Citacion previa al requerimiento especial para corregir.',
    icon: Clock,
  },
  {
    value: 'otro' as const,
    label: 'Otro Acto Administrativo',
    description: 'Resolucion sancion, auto de archivo u otro acto DIAN.',
    icon: HelpCircle,
  },
];

const TAX_OPTIONS = ['IVA', 'Renta', 'Retencion', 'ICA', 'Otro'] as const;
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

// ─── Component ───────────────────────────────────────────────────────────────

export function DianDefenseIntake() {
  const { startNewConsultation, setIntakeModalOpen, clearIntakeDraft, setActiveMode } =
    useWorkspace();
  const [step, setStep] = useState(0);
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

  const formatCOPInput = (raw: string): number | undefined => {
    const digits = raw.replace(/\D/g, '');
    return digits ? parseInt(digits, 10) : undefined;
  };

  const displayCOP = (amount: number | undefined): string => {
    if (!amount) return '';
    return amount.toLocaleString('es-CO');
  };

  const handleUpload = useCallback(async (_file: File) => {
    // Upload is handled by the existing /api/upload route in production.
    // Here we just register the file reference.
    await new Promise((resolve) => setTimeout(resolve, 800));
  }, []);

  const handleSubmit = useCallback(() => {
    startNewConsultation('dian-defense');
    setActiveMode('chat');
    clearIntakeDraft('dian_defense');
    setIntakeModalOpen(false);
  }, [startNewConsultation, setActiveMode, clearIntakeDraft, setIntakeModalOpen]);

  // ─── Step 1: Tipo de Acto ──────────────────────────────────────────────────

  const step1 = (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-[#0a0a0a] mb-1">Tipo de Acto Administrativo</h3>
        <p className="text-xs text-[#737373]">Seleccione el tipo de acto que desea controvertir.</p>
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
                      'w-4 h-4 shrink-0',
                      selected ? 'text-[#D4A017]' : 'text-[#a3a3a3]',
                    )}
                  />
                  <span className="text-sm font-medium text-[#0a0a0a]">{act.label}</span>
                </div>
                <p className="text-[11px] text-[#737373] leading-relaxed">{act.description}</p>
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
        <h3 className="text-sm font-semibold text-[#0a0a0a] mb-1">Detalles del Caso</h3>
        <p className="text-xs text-[#737373]">Proporcione la informacion relevante del acto administrativo.</p>
      </div>

      {/* Impuestos involucrados */}
      <div>
        <label className="block text-xs font-medium text-[#525252] mb-2">
          Impuestos involucrados
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
                    ? 'bg-[#D4A017] text-white border-[#D4A017]'
                    : 'bg-white text-[#525252] border-[#e5e5e5] hover:border-[#D4A017]',
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
          <label className="block text-xs font-medium text-[#525252] mb-1.5">Periodo desde</label>
          <input
            type="month"
            value={values.periodStart}
            onChange={(e) => updateField('periodStart', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#525252] mb-1.5">Periodo hasta</label>
          <input
            type="month"
            value={values.periodEnd}
            onChange={(e) => updateField('periodEnd', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
          />
        </div>
      </div>

      {/* Monto en disputa */}
      <div>
        <label className="block text-xs font-medium text-[#525252] mb-1.5">
          Monto en disputa (COP) <span className="text-[#a3a3a3] font-normal">-- opcional</span>
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#737373]">$</span>
          <input
            type="text"
            inputMode="numeric"
            value={displayCOP(values.disputedAmount)}
            onChange={(e) => updateField('disputedAmount', formatCOPInput(e.target.value))}
            placeholder="0"
            className="w-full pl-7 pr-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
          />
        </div>
      </div>

      {/* Fecha limite de respuesta */}
      <div>
        <label className="block text-xs font-medium text-[#525252] mb-1.5">
          Fecha limite de respuesta <span className="text-[#DC2626]">*</span>
        </label>
        <input
          type="date"
          value={values.responseDeadline}
          onChange={(e) => updateField('responseDeadline', e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
        />
      </div>

      {/* Numero de expediente */}
      <div>
        <label className="block text-xs font-medium text-[#525252] mb-1.5">
          Numero de expediente <span className="text-[#a3a3a3] font-normal">-- opcional</span>
        </label>
        <input
          type="text"
          value={values.expedienteNumber ?? ''}
          onChange={(e) => updateField('expedienteNumber', e.target.value)}
          placeholder="Ej: 2024-00001234"
          className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
        />
      </div>
    </div>
  );

  // ─── Step 3: Documentos ────────────────────────────────────────────────────

  const step3 = (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-[#0a0a0a] mb-1">Documentos de Soporte</h3>
        <p className="text-xs text-[#737373]">
          Adjunte los actos administrativos, declaraciones tributarias y documentos soporte.
        </p>
      </div>
      <FileUploadZone
        onUpload={handleUpload}
        label="Actos administrativos, declaraciones y soportes"
        sublabel="PDF, DOCX, XLSX, imagenes -- Max 25MB"
        accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.jpg,.jpeg,.png"
        maxSizeMB={25}
      />
    </div>
  );

  // ─── Step 4: Preview ───────────────────────────────────────────────────────

  const step4 = (
    <IntakePreview
      caseType="dian_defense"
      data={values}
      onBack={() => setStep(2)}
      onSubmit={handleSubmit}
    />
  );

  // ─── Wizard Steps ──────────────────────────────────────────────────────────

  const steps: WizardStep[] = [
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
