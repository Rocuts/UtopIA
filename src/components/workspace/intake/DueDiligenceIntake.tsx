'use client';

import { useState, useCallback } from 'react';
import {
  CreditCard,
  TrendingUp,
  Store,
  GitMerge,
  HelpCircle,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { StepWizard, FileUploadZone } from '@/design-system';
import type { WizardStep } from '@/design-system';
import type { DueDiligenceIntake as DueDiligenceIntakeType } from '@/types/platform';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useIntakePersistence } from './useIntakePersistence';
import { IntakePreview } from './IntakePreview';

// ─── Constants ───────────────────────────────────────────────────────────────

const PURPOSES = [
  {
    value: 'credito' as const,
    label: 'Solicitud de Credito',
    description: 'Evaluacion financiera para respaldo de solicitud crediticia.',
    icon: CreditCard,
  },
  {
    value: 'inversion' as const,
    label: 'Atraccion de Inversion',
    description: 'Analisis para presentar a inversionistas potenciales.',
    icon: TrendingUp,
  },
  {
    value: 'venta' as const,
    label: 'Venta de Empresa',
    description: 'Due diligence previo a la enajenacion de participaciones.',
    icon: Store,
  },
  {
    value: 'fusion' as const,
    label: 'Fusion / Adquisicion',
    description: 'Evaluacion integral para proceso de integracion empresarial.',
    icon: GitMerge,
  },
  {
    value: 'otro' as const,
    label: 'Otro Proposito',
    description: 'Analisis para otro requerimiento especifico.',
    icon: HelpCircle,
  },
];

const ENTITY_TYPES = ['SAS', 'SA', 'LTDA', 'SCS', 'Otro'] as const;
const ENTITY_VALUES: DueDiligenceIntakeType['entityType'][] = ['SAS', 'SA', 'LTDA', 'SCS', 'otro'];

const NIIF_GROUPS = [
  {
    value: 1 as const,
    label: 'Grupo 1 -- NIIF Plenas',
    description: 'Emisores de valores, entidades de interes publico, empresas grandes.',
  },
  {
    value: 2 as const,
    label: 'Grupo 2 -- NIIF para PYMES',
    description: 'Mediana y pequena empresa que no cumplan requisitos de Grupo 1.',
  },
  {
    value: 3 as const,
    label: 'Grupo 3 -- Microempresas',
    description: 'Contabilidad simplificada para microempresas.',
  },
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

// ─── Component ───────────────────────────────────────────────────────────────

export function DueDiligenceIntake() {
  const { startNewConsultation, setIntakeModalOpen, clearIntakeDraft, setActiveMode } =
    useWorkspace();
  const [step, setStep] = useState(0);
  const [values, setValues] = useIntakePersistence('due_diligence', DEFAULT_VALUES);

  const updateField = useCallback(
    <K extends keyof DueDiligenceIntakeType>(key: K, val: DueDiligenceIntakeType[K]) => {
      setValues((prev) => ({ ...prev, [key]: val }));
    },
    [setValues],
  );

  const handleUpload = useCallback(async (_file: File) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
  }, []);

  const handleSubmit = useCallback(() => {
    startNewConsultation('due-diligence');
    setActiveMode('chat');
    clearIntakeDraft('due_diligence');
    setIntakeModalOpen(false);
  }, [startNewConsultation, setActiveMode, clearIntakeDraft, setIntakeModalOpen]);

  // ─── Step 1: Proposito ─────────────────────────────────────────────────────

  const step1 = (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-[#0a0a0a] mb-1">Proposito del Due Diligence</h3>
        <p className="text-xs text-[#737373]">Seleccione la razon principal de la evaluacion.</p>
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
                  <span className="text-sm font-medium text-[#0a0a0a]">{purpose.label}</span>
                </div>
                <p className="text-xs text-[#737373]">{purpose.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  // ─── Step 2: Datos de la Empresa ───────────────────────────────────────────

  const step2 = (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-[#0a0a0a] mb-1">Datos de la Empresa</h3>
        <p className="text-xs text-[#737373]">Informacion basica de la entidad a evaluar.</p>
      </div>

      {/* Razon Social */}
      <div>
        <label className="block text-xs font-medium text-[#525252] mb-1.5">
          Razon Social <span className="text-[#DC2626]">*</span>
        </label>
        <input
          type="text"
          value={values.companyName}
          onChange={(e) => updateField('companyName', e.target.value)}
          placeholder="Ej: Empresa Ejemplo S.A.S."
          className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
        />
      </div>

      {/* NIT */}
      <div>
        <label className="block text-xs font-medium text-[#525252] mb-1.5">
          NIT <span className="text-[#DC2626]">*</span>
        </label>
        <input
          type="text"
          value={values.nit}
          onChange={(e) => updateField('nit', formatNIT(e.target.value))}
          placeholder="XXX.XXX.XXX-X"
          maxLength={13}
          className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] font-mono focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
        />
      </div>

      {/* Tipo de Entidad */}
      <div>
        <label className="block text-xs font-medium text-[#525252] mb-2">Tipo de Sociedad</label>
        <div className="flex flex-wrap gap-2">
          {ENTITY_TYPES.map((label, i) => {
            const val = ENTITY_VALUES[i];
            const active = values.entityType === val;
            return (
              <button
                key={val}
                type="button"
                onClick={() => updateField('entityType', val)}
                className={cn(
                  'px-3.5 py-1.5 rounded-full text-xs font-medium border transition-colors',
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

      {/* Grupo NIIF */}
      <div>
        <label className="block text-xs font-medium text-[#525252] mb-2">Grupo NIIF</label>
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
                    ? 'border-[#D4A017] bg-[#FEF9EC]'
                    : 'border-[#e5e5e5] hover:border-[#d4d4d4] bg-white',
                )}
              >
                <div
                  className={cn(
                    'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5',
                    selected ? 'border-[#D4A017]' : 'border-[#d4d4d4]',
                  )}
                >
                  {selected && <div className="w-2 h-2 rounded-full bg-[#D4A017]" />}
                </div>
                <div>
                  <span className="text-xs font-medium text-[#0a0a0a]">{group.label}</span>
                  <p className="text-[11px] text-[#737373]">{group.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Periodo */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-[#525252] mb-1.5">
            Periodo desde <span className="text-[#DC2626]">*</span>
          </label>
          <input
            type="month"
            value={values.periodStart}
            onChange={(e) => updateField('periodStart', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#525252] mb-1.5">
            Periodo hasta <span className="text-[#DC2626]">*</span>
          </label>
          <input
            type="month"
            value={values.periodEnd}
            onChange={(e) => updateField('periodEnd', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
          />
        </div>
      </div>
    </div>
  );

  // ─── Step 3: Documentos ────────────────────────────────────────────────────

  const step3 = (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-[#0a0a0a] mb-1">Documentos de Soporte</h3>
        <p className="text-xs text-[#737373]">
          Adjunte los documentos disponibles para el analisis.
        </p>
      </div>

      {/* Document checklist */}
      <div className="rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-3 space-y-1.5">
        <div className="flex items-center gap-1.5 mb-2">
          <Info className="w-3.5 h-3.5 text-[#D4A017]" />
          <span className="text-xs font-semibold text-[#525252]">Documentos recomendados</span>
        </div>
        {[
          'Estados financieros (ultimo periodo)',
          'Balances de prueba',
          'Declaraciones de renta',
          'Certificado de existencia y representacion',
          'RUT actualizado',
          'Certificado de composicion accionaria',
          'Contratos relevantes',
        ].map((doc) => (
          <div key={doc} className="flex items-center gap-2 text-[11px] text-[#737373]">
            <div className="w-1 h-1 rounded-full bg-[#d4d4d4] shrink-0" />
            {doc}
          </div>
        ))}
      </div>

      <FileUploadZone
        onUpload={handleUpload}
        label="Estados financieros y documentos corporativos"
        sublabel="PDF, DOCX, XLSX, imagenes -- Max 25MB"
        accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.jpg,.jpeg,.png"
        maxSizeMB={25}
      />
    </div>
  );

  // ─── Step 4: Preview ───────────────────────────────────────────────────────

  const step4 = (
    <IntakePreview
      caseType="due_diligence"
      data={values}
      onBack={() => setStep(2)}
      onSubmit={handleSubmit}
    />
  );

  // ─── Wizard Steps ──────────────────────────────────────────────────────────

  const steps: WizardStep[] = [
    { id: 'purpose', label: 'Proposito', isValid: !!values.purpose, component: step1 },
    {
      id: 'company',
      label: 'Empresa',
      isValid: !!values.companyName && !!values.nit && !!values.periodStart && !!values.periodEnd,
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
      submitLabel="Iniciar Due Diligence"
      className="h-full"
    />
  );
}
