'use client';

import { useState, useCallback } from 'react';
import {
  Building2,
  Info,
  FileSpreadsheet,
  CheckCircle,
  AlertTriangle,
  Settings2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { StepWizard, FileUploadZone } from '@/design-system';
import type { WizardStep } from '@/design-system';
import type {
  NiifReportIntake as NiifReportIntakeType,
  CompanyMetadata,
  NiifOutputOptions,
} from '@/types/platform';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useIntakePersistence } from './useIntakePersistence';
import { IntakePreview } from './IntakePreview';

// ─── Constants ───────────────────────────────────────────────────────────────

const ENTITY_TYPES: Array<{ value: CompanyMetadata['entityType']; label: string }> = [
  { value: 'SAS', label: 'SAS' },
  { value: 'SA', label: 'SA' },
  { value: 'LTDA', label: 'LTDA' },
  { value: 'SCS', label: 'SCS' },
  { value: 'otro', label: 'Otro' },
];

const SECTORS = [
  'Comercio',
  'Servicios',
  'Manufactura',
  'Tecnologia',
  'Construccion',
  'Salud',
  'Educacion',
  'Agropecuario',
  'Transporte',
  'Financiero',
  'Minero-energetico',
  'Inmobiliario',
  'Otro',
];

const NIIF_GROUPS = [
  {
    value: 1 as const,
    label: 'Grupo 1 -- NIIF Plenas',
    description:
      'Emisores de valores, entidades de interes publico, entidades con activos > 30.000 SMLMV o empleados > 200.',
    badge: null,
  },
  {
    value: 2 as const,
    label: 'Grupo 2 -- NIIF para PYMES',
    description:
      'Empresas que no son emisores ni de interes publico, con activos entre 500 y 30.000 SMLMV o 11-200 empleados.',
    badge: 'RECOMENDADO',
  },
  {
    value: 3 as const,
    label: 'Grupo 3 -- Microempresas',
    description:
      'Microempresas con activos < 500 SMLMV y empleados <= 10. Contabilidad simplificada.',
    badge: null,
  },
];

const OUTPUT_OPTIONS: Array<{
  key: keyof NiifOutputOptions;
  label: string;
  description: string;
}> = [
  { key: 'financialStatements', label: 'Estados Financieros NIIF', description: 'Balance, P&L, Cambios en patrimonio, Flujo de efectivo' },
  { key: 'kpiDashboard', label: 'Dashboard Estrategico', description: 'KPIs clave: liquidez, rentabilidad, endeudamiento' },
  { key: 'cashFlowProjection', label: 'Flujo de Caja Proyectado', description: 'Proyeccion a 12 meses con escenarios' },
  { key: 'breakevenAnalysis', label: 'Punto de Equilibrio', description: 'Calculo de punto de equilibrio operativo' },
  { key: 'notesToFinancialStatements', label: '13 Notas a los EEFF', description: 'Notas completas segun NIIF/NIC 1' },
  { key: 'shareholdersMinutes', label: 'Acta de Asamblea', description: 'Borrador del acta para aprobacion de estados financieros' },
  { key: 'auditPipeline', label: 'Auditoria Especializada', description: '4 auditores paralelos: NIIF, Tributario, Legal, Fiscal' },
  { key: 'metaAudit', label: 'Meta-auditoria de Calidad', description: '12 dimensiones: ISO 25012, ISO 42001, IASB' },
  { key: 'excelExport', label: 'Exportacion Excel', description: 'Archivo .xlsx con multiples hojas y formato corporativo' },
  { key: 'comparativeAnalysis', label: 'Analisis Comparativo', description: 'Variaciones interperiodo con analisis de tendencias' },
];

const DEFAULT_COMPANY: CompanyMetadata = {
  name: '',
  nit: '',
  entityType: 'SAS',
  sector: '',
  city: '',
  legalRepresentative: '',
  accountant: '',
  fiscalAuditor: '',
};

const DEFAULT_OUTPUT_OPTIONS: NiifOutputOptions = {
  financialStatements: true,
  kpiDashboard: true,
  cashFlowProjection: true,
  breakevenAnalysis: true,
  notesToFinancialStatements: true,
  shareholdersMinutes: true,
  auditPipeline: true,
  metaAudit: true,
  excelExport: true,
  comparativeAnalysis: true,
};

const DEFAULT_VALUES: NiifReportIntakeType = {
  caseType: 'niif_report',
  company: DEFAULT_COMPANY,
  niifGroup: 2,
  fiscalPeriod: '',
  comparativePeriod: '',
  rawData: '',
  outputOptions: DEFAULT_OUTPUT_OPTIONS,
  specialInstructions: '',
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

// ─── Preprocessing Result Display ────────────────────────────────────────────

interface PreprocessingCardProps {
  accountsDetected: number;
  pucClasses: number;
  equationValid: boolean;
  assets: number;
  liabilities: number;
  equity: number;
  discrepancies: number;
}

function PreprocessingCard({
  accountsDetected,
  pucClasses,
  equationValid,
  assets,
  liabilities,
  equity,
  discrepancies,
}: PreprocessingCardProps) {
  const formatCOP = (n: number) => `$${n.toLocaleString('es-CO')}`;

  return (
    <div className="rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CheckCircle className="w-4 h-4 text-[#22C55E]" />
        <span className="text-sm font-semibold text-[#0a0a0a]">Balance de Prueba Validado</span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <div className="text-lg font-bold text-[#0a0a0a]">{accountsDetected}</div>
          <div className="text-[10px] text-[#737373]">Cuentas detectadas</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-[#0a0a0a]">{pucClasses}</div>
          <div className="text-[10px] text-[#737373]">Clases PUC</div>
        </div>
        <div className="text-center">
          <div
            className={cn(
              'text-lg font-bold',
              equationValid ? 'text-[#22C55E]' : 'text-[#EF4444]',
            )}
          >
            {equationValid ? 'OK' : 'ERROR'}
          </div>
          <div className="text-[10px] text-[#737373]">Ecuacion Patrimonial</div>
        </div>
      </div>

      {/* Ecuacion patrimonial */}
      <div className="rounded border border-[#e5e5e5] bg-white p-2.5">
        <div className="flex items-center justify-between text-xs">
          <div className="text-center flex-1">
            <div className="text-[10px] text-[#737373]">Activos</div>
            <div className="font-semibold text-[#0a0a0a]">{formatCOP(assets)}</div>
          </div>
          <span className="text-[#a3a3a3] font-bold">=</span>
          <div className="text-center flex-1">
            <div className="text-[10px] text-[#737373]">Pasivos</div>
            <div className="font-semibold text-[#0a0a0a]">{formatCOP(liabilities)}</div>
          </div>
          <span className="text-[#a3a3a3] font-bold">+</span>
          <div className="text-center flex-1">
            <div className="text-[10px] text-[#737373]">Patrimonio</div>
            <div className="font-semibold text-[#0a0a0a]">{formatCOP(equity)}</div>
          </div>
        </div>
      </div>

      {discrepancies > 0 && (
        <div className="flex items-center gap-2 text-xs text-[#D97706]">
          <AlertTriangle className="w-3.5 h-3.5" />
          {discrepancies} discrepancia{discrepancies > 1 ? 's' : ''} detectada
          {discrepancies > 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function NiifReportIntake() {
  const { startNewConsultation, setIntakeModalOpen, clearIntakeDraft, setActiveMode } =
    useWorkspace();
  const [step, setStep] = useState(0);
  const [values, setValues] = useIntakePersistence('niif_report', DEFAULT_VALUES);
  const [sectorOpen, setSectorOpen] = useState(false);
  const [preprocessingResult, setPreprocessingResult] = useState<PreprocessingCardProps | null>(
    null,
  );

  const updateCompany = useCallback(
    <K extends keyof CompanyMetadata>(key: K, val: CompanyMetadata[K]) => {
      setValues((prev) => ({
        ...prev,
        company: { ...prev.company, [key]: val },
      }));
    },
    [setValues],
  );

  const updateField = useCallback(
    <K extends keyof NiifReportIntakeType>(key: K, val: NiifReportIntakeType[K]) => {
      setValues((prev) => ({ ...prev, [key]: val }));
    },
    [setValues],
  );

  const toggleOutput = useCallback(
    (key: keyof NiifOutputOptions) => {
      setValues((prev) => ({
        ...prev,
        outputOptions: {
          ...prev.outputOptions,
          [key]: !prev.outputOptions[key],
        },
      }));
    },
    [setValues],
  );

  const handleTrialBalanceUpload = useCallback(
    async (_file: File) => {
      // In production this calls /api/upload which auto-detects trial balance CSV/XLSX
      // and runs the preprocessor. For now, simulate a successful preprocessing.
      await new Promise((resolve) => setTimeout(resolve, 1200));

      // Simulated preprocessing result
      const result: PreprocessingCardProps = {
        accountsDetected: 156,
        pucClasses: 6,
        equationValid: true,
        assets: 2_450_000_000,
        liabilities: 890_000_000,
        equity: 1_560_000_000,
        discrepancies: 0,
      };
      setPreprocessingResult(result);
      setValues((prev) => ({ ...prev, rawData: 'trial_balance_uploaded' }));
    },
    [setValues],
  );

  const handleSubmit = useCallback(() => {
    startNewConsultation('financial-report');
    setActiveMode('pipeline');
    clearIntakeDraft('niif_report');
    setIntakeModalOpen(false);
  }, [startNewConsultation, setActiveMode, clearIntakeDraft, setIntakeModalOpen]);

  // Generate year options
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => currentYear - i);

  // ─── Step 1: Datos de la Empresa ───────────────────────────────────────────

  const step1 = (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Building2 className="w-4 h-4 text-[#D4A017]" />
          <h3 className="text-sm font-semibold text-[#0a0a0a]">Datos de la Empresa</h3>
        </div>
        <p className="text-xs text-[#737373]">Informacion de la entidad reportante.</p>
      </div>

      {/* Razon Social -- full width */}
      <div>
        <label className="block text-xs font-medium text-[#525252] mb-1.5">
          Razon Social <span className="text-[#DC2626]">*</span>
        </label>
        <input
          type="text"
          value={values.company.name}
          onChange={(e) => updateCompany('name', e.target.value)}
          placeholder="Ej: Inversiones Colombia S.A.S."
          className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
        />
      </div>

      {/* 2-column grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* NIT */}
        <div>
          <label className="block text-xs font-medium text-[#525252] mb-1.5">
            NIT <span className="text-[#DC2626]">*</span>
          </label>
          <input
            type="text"
            value={values.company.nit}
            onChange={(e) => updateCompany('nit', formatNIT(e.target.value))}
            placeholder="XXX.XXX.XXX-X"
            maxLength={13}
            className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] font-mono focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
          />
        </div>

        {/* Sector */}
        <div className="relative">
          <label className="block text-xs font-medium text-[#525252] mb-1.5">Sector</label>
          <button
            type="button"
            onClick={() => setSectorOpen(!sectorOpen)}
            className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-left bg-white focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
          >
            <span className={values.company.sector ? 'text-[#0a0a0a]' : 'text-[#a3a3a3]'}>
              {values.company.sector || 'Seleccionar sector'}
            </span>
          </button>
          {sectorOpen && (
            <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-[#e5e5e5] rounded-lg shadow-lg max-h-48 overflow-y-auto styled-scrollbar">
              {SECTORS.map((sector) => (
                <button
                  key={sector}
                  type="button"
                  onClick={() => {
                    updateCompany('sector', sector);
                    setSectorOpen(false);
                  }}
                  className={cn(
                    'w-full text-left px-3 py-1.5 text-xs hover:bg-[#FEF9EC] transition-colors',
                    values.company.sector === sector
                      ? 'bg-[#FEF9EC] text-[#D4A017] font-medium'
                      : 'text-[#525252]',
                  )}
                >
                  {sector}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Entity Type */}
      <div>
        <label className="block text-xs font-medium text-[#525252] mb-2">Tipo de Sociedad</label>
        <div className="flex flex-wrap gap-2">
          {ENTITY_TYPES.map((et) => {
            const active = values.company.entityType === et.value;
            return (
              <button
                key={et.value}
                type="button"
                onClick={() => updateCompany('entityType', et.value)}
                className={cn(
                  'px-3.5 py-1.5 rounded-full text-xs font-medium border transition-colors',
                  active
                    ? 'bg-[#D4A017] text-white border-[#D4A017]'
                    : 'bg-white text-[#525252] border-[#e5e5e5] hover:border-[#D4A017]',
                )}
              >
                {et.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 2-column: city + representante legal */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-[#525252] mb-1.5">Ciudad</label>
          <input
            type="text"
            value={values.company.city ?? ''}
            onChange={(e) => updateCompany('city', e.target.value)}
            placeholder="Ej: Bogota D.C."
            className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#525252] mb-1.5">
            Representante Legal
          </label>
          <input
            type="text"
            value={values.company.legalRepresentative ?? ''}
            onChange={(e) => updateCompany('legalRepresentative', e.target.value)}
            placeholder="Nombre completo"
            className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
          />
        </div>
      </div>

      {/* Contador + Revisor Fiscal */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-[#525252] mb-1.5">Contador</label>
          <input
            type="text"
            value={values.company.accountant ?? ''}
            onChange={(e) => updateCompany('accountant', e.target.value)}
            placeholder="Nombre completo"
            className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#525252] mb-1.5">
            Revisor Fiscal{' '}
            <span className="text-[#a3a3a3] font-normal">-- opcional</span>
            <span className="inline-block ml-1 relative group">
              <Info className="w-3 h-3 text-[#a3a3a3] inline" />
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-[#0a0a0a] text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                Obligatorio para sociedades con activos brutos &gt; 5.000 SMLMV o ingresos &gt;
                3.000 SMLMV (Art. 203 Cod. Comercio)
              </span>
            </span>
          </label>
          <input
            type="text"
            value={values.company.fiscalAuditor ?? ''}
            onChange={(e) => updateCompany('fiscalAuditor', e.target.value)}
            placeholder="Nombre completo"
            className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
          />
        </div>
      </div>
    </div>
  );

  // ─── Step 2: Periodo y Normas ──────────────────────────────────────────────

  const step2 = (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-[#0a0a0a] mb-1">Periodo y Estandares</h3>
        <p className="text-xs text-[#737373]">Periodo fiscal y marco normativo aplicable.</p>
      </div>

      {/* Periodo Fiscal */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-[#525252] mb-1.5">
            Periodo Fiscal <span className="text-[#DC2626]">*</span>
          </label>
          <select
            value={values.fiscalPeriod}
            onChange={(e) => updateField('fiscalPeriod', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] bg-white focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
          >
            <option value="">Seleccionar ano</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[#525252] mb-1.5">
            Periodo Comparativo <span className="text-[#a3a3a3] font-normal">-- opcional</span>
          </label>
          <select
            value={values.comparativePeriod ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              updateField('comparativePeriod', val || undefined);
              // Auto-enable comparative analysis if period is set
              if (val && !values.outputOptions.comparativeAnalysis) {
                toggleOutput('comparativeAnalysis');
              }
            }}
            className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] bg-white focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
          >
            <option value="">Sin comparativo</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Grupo NIIF */}
      <div>
        <label className="block text-xs font-medium text-[#525252] mb-2">
          Grupo NIIF <span className="text-[#DC2626]">*</span>
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
                  'w-full text-left p-4 rounded-lg border-l-4 transition-all',
                  selected
                    ? 'border-l-[#D4A017] bg-[#FEF9EC] border border-[#D4A017]'
                    : 'border-l-[#e5e5e5] bg-white border border-[#e5e5e5] hover:border-[#d4d4d4]',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-[#0a0a0a]">{group.label}</span>
                  {group.badge && (
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-[#D4A017] text-white rounded-full">
                      {group.badge}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#737373] leading-relaxed">{group.description}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  // ─── Step 3: Balance de Prueba ─────────────────────────────────────────────

  const step3 = (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <FileSpreadsheet className="w-4 h-4 text-[#D4A017]" />
          <h3 className="text-sm font-semibold text-[#0a0a0a]">Balance de Prueba</h3>
        </div>
        <p className="text-xs text-[#737373]">
          Cargue el balance de prueba en formato CSV o Excel. El sistema detectara automaticamente
          las cuentas PUC y validara la ecuacion patrimonial.
        </p>
      </div>

      <FileUploadZone
        onUpload={handleTrialBalanceUpload}
        label="Arrastre su balance de prueba aqui"
        sublabel="CSV, XLSX, XLS -- Max 25MB"
        accept=".csv,.xlsx,.xls"
        maxSizeMB={25}
        className="min-h-[220px]"
      />

      {preprocessingResult && <PreprocessingCard {...preprocessingResult} />}
    </div>
  );

  // ─── Step 4: Configuracion del Reporte ─────────────────────────────────────

  const step4 = (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Settings2 className="w-4 h-4 text-[#D4A017]" />
          <h3 className="text-sm font-semibold text-[#0a0a0a]">Configuracion del Reporte</h3>
        </div>
        <p className="text-xs text-[#737373]">
          Seleccione los entregables que desea generar. Todos estan habilitados por defecto.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {OUTPUT_OPTIONS.map((opt) => {
          const enabled = values.outputOptions[opt.key];
          const isComparative = opt.key === 'comparativeAnalysis';
          const hasComparativePeriod = !!values.comparativePeriod;

          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => toggleOutput(opt.key)}
              disabled={isComparative && !hasComparativePeriod}
              className={cn(
                'flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-all',
                enabled
                  ? 'border-[#D4A017] bg-[#FEF9EC]'
                  : 'border-[#e5e5e5] bg-white',
                isComparative && !hasComparativePeriod && 'opacity-40 cursor-not-allowed',
                !isComparative && !enabled && 'hover:border-[#d4d4d4]',
              )}
            >
              <div
                className={cn(
                  'w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors',
                  enabled ? 'bg-[#D4A017] border-[#D4A017]' : 'border-[#d4d4d4]',
                )}
              >
                {enabled && <CheckCircle className="w-3.5 h-3.5 text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-[#0a0a0a] block">{opt.label}</span>
                <p className="text-[10px] text-[#737373] leading-relaxed">{opt.description}</p>
                {isComparative && !hasComparativePeriod && (
                  <p className="text-[10px] text-[#D97706] mt-0.5">
                    Requiere periodo comparativo en paso 2
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Instrucciones especiales */}
      <div>
        <label className="block text-xs font-medium text-[#525252] mb-1.5">
          Instrucciones especiales{' '}
          <span className="text-[#a3a3a3] font-normal">-- opcional</span>
        </label>
        <textarea
          value={values.specialInstructions ?? ''}
          onChange={(e) => updateField('specialInstructions', e.target.value)}
          placeholder="Ej: Enfatizar el analisis de cartera morosa, incluir simulacion de provision..."
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-[#e5e5e5] text-sm text-[#0a0a0a] resize-none focus:outline-none focus:border-[#D4A017] focus:ring-1 focus:ring-[#D4A017]"
        />
      </div>
    </div>
  );

  // ─── Step 5: Preview ───────────────────────────────────────────────────────

  const step5 = (
    <IntakePreview
      caseType="niif_report"
      data={values}
      onBack={() => setStep(3)}
      onSubmit={handleSubmit}
    />
  );

  // ─── Wizard Steps ──────────────────────────────────────────────────────────

  const steps: WizardStep[] = [
    {
      id: 'company',
      label: 'Empresa',
      isValid: !!values.company.name && !!values.company.nit,
      component: step1,
    },
    {
      id: 'period',
      label: 'Periodo',
      isValid: !!values.fiscalPeriod && !!values.niifGroup,
      component: step2,
    },
    {
      id: 'trial-balance',
      label: 'Balance',
      isValid: !!values.rawData,
      component: step3,
    },
    {
      id: 'config',
      label: 'Configuracion',
      isValid: Object.values(values.outputOptions).some(Boolean),
      component: step4,
    },
    { id: 'preview', label: 'Vista Previa', isValid: true, component: step5 },
  ];

  return (
    <StepWizard
      steps={steps}
      currentStep={step}
      onNext={() => setStep((s) => Math.min(s + 1, steps.length - 1))}
      onBack={() => setStep((s) => Math.max(s - 1, 0))}
      onSubmit={handleSubmit}
      submitLabel="Generar Reporte NIIF"
      className="h-full"
    />
  );
}
