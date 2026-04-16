'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Building2,
  Info,
  FileSpreadsheet,
  CheckCircle,
  AlertTriangle,
  Settings2,
  Upload,
  Sparkles,
  SkipForward,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
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
import { useDocumentExtraction } from './useDocumentExtraction';
import type { FieldConfidence } from './useDocumentExtraction';
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

// ─── Field label mapping for confidence tracking ────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  name: 'Razon Social',
  nit: 'NIT',
  entityType: 'Tipo de Sociedad',
  sector: 'Sector',
  city: 'Ciudad',
  legalRepresentative: 'Representante Legal',
  accountant: 'Contador',
  fiscalAuditor: 'Revisor Fiscal',
  fiscalPeriod: 'Periodo Fiscal',
  niifGroup: 'Grupo NIIF',
};

const ALL_TRACKED_FIELDS = Object.keys(FIELD_LABELS);

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

function ConfidenceDot({ level }: { level: FieldConfidence }) {
  if (level === 'high') {
    return (
      <span
        className="inline-block w-2 h-2 rounded-full bg-[#22C55E] shrink-0"
        title="Auto-detectado (alta confianza)"
      />
    );
  }
  if (level === 'medium') {
    return (
      <span
        className="inline-block w-2 h-2 rounded-full bg-[#F59E0B] shrink-0"
        title="Inferido (confianza media)"
      />
    );
  }
  return null;
}

// ─── Extraction Progress Display ────────────────────────────────────────────

function ExtractionProgress({
  progress,
  status,
  fileName,
}: {
  progress: number;
  status: string;
  fileName: string;
}) {
  const stages = [
    { label: 'Subiendo archivo', threshold: 30 },
    { label: 'Extrayendo texto', threshold: 60 },
    { label: 'Detectando campos', threshold: 85 },
    { label: 'Validando datos', threshold: 100 },
  ];

  const currentStage = stages.find((s) => progress <= s.threshold) ?? stages[stages.length - 1];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
        >
          <Sparkles className="w-5 h-5 text-[#D4A017]" />
        </motion.div>
        <div>
          <div className="text-sm font-medium text-[#0a0a0a]">{currentStage.label}...</div>
          <div className="text-xs text-[#737373]">{fileName}</div>
        </div>
      </div>

      <div className="w-full h-2 bg-[#f5f5f5] rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-[#D4A017] rounded-full"
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>

      {/* Animated field reveal */}
      <div className="grid grid-cols-2 gap-1.5">
        {stages.map((stage, i) => {
          const reached = progress >= stage.threshold;
          const active = currentStage === stage;
          return (
            <motion.div
              key={stage.label}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.15 }}
              className={cn(
                'flex items-center gap-1.5 text-xs px-2 py-1 rounded',
                reached
                  ? 'text-[#22C55E]'
                  : active
                    ? 'text-[#D4A017]'
                    : 'text-[#a3a3a3]',
              )}
            >
              {reached ? (
                <CheckCircle className="w-3 h-3" />
              ) : active ? (
                <motion.div
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                  className="w-3 h-3 rounded-full bg-[#D4A017]"
                />
              ) : (
                <div className="w-3 h-3 rounded-full border border-[#e5e5e5]" />
              )}
              {stage.label}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Validation Card (Trial Balance) ────────────────────────────────────────

function ValidationCard({
  accountsDetected,
  pucClasses,
  equationValid,
}: {
  accountsDetected: number;
  pucClasses: number;
  equationValid: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-3"
    >
      <div className="flex items-center gap-2">
        <CheckCircle className="w-4 h-4 text-[#22C55E]" />
        <span className="text-sm font-semibold text-[#0a0a0a]">Balance de Prueba Detectado</span>
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
    </motion.div>
  );
}

// ─── Detection Summary Banner ───────────────────────────────────────────────

function DetectionSummary({
  confidence,
}: {
  confidence: Record<string, FieldConfidence>;
}) {
  const detected = ALL_TRACKED_FIELDS.filter(
    (f) => confidence[f] === 'high' || confidence[f] === 'medium',
  ).length;
  const total = ALL_TRACKED_FIELDS.length;

  return (
    <div className="rounded-lg border border-[#e5e5e5] bg-[#FEF9EC] px-4 py-3 flex items-center gap-3">
      <Sparkles className="w-4 h-4 text-[#D4A017] shrink-0" />
      <div>
        <span className="text-sm font-semibold text-[#0a0a0a]">
          {detected} de {total} campos auto-detectados
        </span>
        <p className="text-xs text-[#737373]">
          Revise y complete los campos faltantes marcados en rojo.
        </p>
      </div>
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
  const [skippedUpload, setSkippedUpload] = useState(false);
  const { state: extractionState, uploadAndExtract, reset: resetExtraction } = useDocumentExtraction();

  // Derive confidence map: when extraction is done, use it; otherwise all 'none'
  const confidenceMap: Record<string, FieldConfidence> =
    extractionState.status === 'done' && extractionState.extracted
      ? extractionState.extracted.confidence
      : {};

  const getFieldConfidence = useCallback(
    (field: string): FieldConfidence => {
      if (skippedUpload || extractionState.status !== 'done') return 'none';
      return confidenceMap[field] ?? 'none';
    },
    [skippedUpload, extractionState.status, confidenceMap],
  );

  // Auto-advance to step 2 when extraction completes
  useEffect(() => {
    if (extractionState.status === 'done' && extractionState.extracted && step === 0) {
      const { extracted } = extractionState;

      // Pre-fill values from extraction
      setValues((prev) => {
        const updatedCompany = { ...prev.company };

        // Apply extracted company fields
        if (extracted.company.name) updatedCompany.name = extracted.company.name;
        if (extracted.company.nit) updatedCompany.nit = extracted.company.nit;
        if (extracted.company.entityType) updatedCompany.entityType = extracted.company.entityType;
        if (extracted.company.sector) updatedCompany.sector = extracted.company.sector;
        if (extracted.company.city) updatedCompany.city = extracted.company.city;
        if (extracted.company.legalRepresentative)
          updatedCompany.legalRepresentative = extracted.company.legalRepresentative;
        if (extracted.company.accountant)
          updatedCompany.accountant = extracted.company.accountant;
        if (extracted.company.fiscalAuditor)
          updatedCompany.fiscalAuditor = extracted.company.fiscalAuditor;

        return {
          ...prev,
          company: updatedCompany,
          fiscalPeriod: extracted.fiscalPeriod ?? prev.fiscalPeriod,
          niifGroup: extracted.niifGroup ?? prev.niifGroup,
          rawData: extracted.isTrialBalance ? 'trial_balance_uploaded' : extracted.rawText || prev.rawData,
        };
      });

      // Auto-advance after a brief delay to show the completed state
      const timer = setTimeout(() => setStep(1), 800);
      return () => clearTimeout(timer);
    }
  }, [extractionState.status, extractionState.extracted, step, setValues]);

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

  const handleUpload = useCallback(
    async (file: File) => {
      await uploadAndExtract(file);
    },
    [uploadAndExtract],
  );

  const handleSkipUpload = useCallback(() => {
    setSkippedUpload(true);
    setStep(1);
  }, []);

  const handleSubmit = useCallback(() => {
    startNewConsultation('financial-report');
    setActiveMode('pipeline');
    clearIntakeDraft('niif_report');
    setIntakeModalOpen(false);
  }, [startNewConsultation, setActiveMode, clearIntakeDraft, setIntakeModalOpen]);

  // Generate year options
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => currentYear - i);

  // Helper: border class based on confidence
  const fieldBorderClass = useCallback(
    (field: string, hasValue: boolean): string => {
      const conf = getFieldConfidence(field);
      if (conf === 'none' && !hasValue && extractionState.status === 'done' && !skippedUpload) {
        return 'border-[#EF4444] focus:border-[#EF4444] focus:ring-[#EF4444]';
      }
      return 'border-[#e5e5e5] focus:border-[#D4A017] focus:ring-[#D4A017]';
    },
    [getFieldConfidence, extractionState.status, skippedUpload],
  );

  // ─── Step 1: Upload Document ──────────────────────────────────────────────

  const step1Upload = (
    <div className="space-y-5">
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Upload className="w-5 h-5 text-[#D4A017]" />
          <h3 className="text-base font-semibold text-[#0a0a0a]">
            Cargue su balance de prueba o estados financieros
          </h3>
        </div>
        <p className="text-sm text-[#737373]">
          UtopIA extrae automaticamente los datos de su archivo
        </p>
      </div>

      {extractionState.status === 'idle' || extractionState.status === 'error' ? (
        <>
          <FileUploadZone
            onUpload={handleUpload}
            label="Arrastre su archivo aqui o haga clic para seleccionar"
            sublabel="CSV, XLSX, XLS, PDF, DOCX -- Max 25MB"
            accept=".csv,.xlsx,.xls,.pdf,.docx"
            maxSizeMB={25}
            className="min-h-[260px]"
          />

          {extractionState.status === 'error' && extractionState.error && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-lg border border-[#EF4444] bg-[#FEF2F2] px-4 py-3 flex items-center gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-[#EF4444] shrink-0" />
              <div>
                <span className="text-sm font-medium text-[#DC2626]">Error al procesar</span>
                <p className="text-xs text-[#737373]">{extractionState.error}</p>
              </div>
            </motion.div>
          )}
        </>
      ) : (
        <div className="min-h-[260px] rounded-lg border-2 border-dashed border-[#D4A017] bg-[#FEF9EC]/30 p-8 flex items-center justify-center">
          <ExtractionProgress
            progress={extractionState.progress}
            status={extractionState.status}
            fileName={extractionState.fileName}
          />
        </div>
      )}

      {/* Extraction complete: show validation card for trial balances */}
      {extractionState.status === 'done' &&
        extractionState.extracted?.isTrialBalance &&
        extractionState.extracted.accountsDetected != null &&
        extractionState.extracted.pucClasses != null && (
          <ValidationCard
            accountsDetected={extractionState.extracted.accountsDetected}
            pucClasses={extractionState.extracted.pucClasses}
            equationValid={extractionState.extracted.equationValid ?? false}
          />
        )}

      {/* Skip link */}
      {(extractionState.status === 'idle' || extractionState.status === 'error') && (
        <div className="text-center">
          <button
            type="button"
            onClick={handleSkipUpload}
            className="inline-flex items-center gap-1.5 text-xs text-[#737373] hover:text-[#525252] transition-colors"
          >
            <SkipForward className="w-3.5 h-3.5" />
            Llenar manualmente
          </button>
        </div>
      )}
    </div>
  );

  // ─── Step 2: Review Extracted Data + Complete Manual Fields ─────────────────

  const hasExtraction = extractionState.status === 'done' && extractionState.extracted && !skippedUpload;

  const step2Review = (
    <div className="space-y-5">
      {/* Detection summary banner */}
      {hasExtraction && (
        <DetectionSummary confidence={confidenceMap} />
      )}

      {/* Company data section */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Building2 className="w-4 h-4 text-[#D4A017]" />
          <h3 className="text-sm font-semibold text-[#0a0a0a]">Datos de la Empresa</h3>
        </div>
        <p className="text-xs text-[#737373]">Informacion de la entidad reportante.</p>
      </div>

      {/* Razon Social -- full width */}
      <div>
        <label className="flex items-center gap-1.5 text-xs font-medium text-[#525252] mb-1.5">
          Razon Social <span className="text-[#DC2626]">*</span>
          <ConfidenceDot level={getFieldConfidence('name')} />
        </label>
        <input
          type="text"
          value={values.company.name}
          onChange={(e) => updateCompany('name', e.target.value)}
          placeholder="Ej: Inversiones Colombia S.A.S."
          className={cn(
            'w-full px-3 py-2 rounded-lg border text-sm text-[#0a0a0a] focus:outline-none focus:ring-1',
            fieldBorderClass('name', !!values.company.name),
          )}
        />
      </div>

      {/* 2-column grid: NIT + Sector */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-[#525252] mb-1.5">
            NIT <span className="text-[#DC2626]">*</span>
            <ConfidenceDot level={getFieldConfidence('nit')} />
          </label>
          <input
            type="text"
            value={values.company.nit}
            onChange={(e) => updateCompany('nit', formatNIT(e.target.value))}
            placeholder="XXX.XXX.XXX-X"
            maxLength={13}
            className={cn(
              'w-full px-3 py-2 rounded-lg border text-sm text-[#0a0a0a] font-mono focus:outline-none focus:ring-1',
              fieldBorderClass('nit', !!values.company.nit),
            )}
          />
        </div>

        <div className="relative">
          <label className="flex items-center gap-1.5 text-xs font-medium text-[#525252] mb-1.5">
            Sector
            <ConfidenceDot level={getFieldConfidence('sector')} />
          </label>
          <button
            type="button"
            onClick={() => setSectorOpen(!sectorOpen)}
            className={cn(
              'w-full px-3 py-2 rounded-lg border text-sm text-left bg-white focus:outline-none focus:ring-1',
              fieldBorderClass('sector', !!values.company.sector),
            )}
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
        <label className="flex items-center gap-1.5 text-xs font-medium text-[#525252] mb-2">
          Tipo de Sociedad
          <ConfidenceDot level={getFieldConfidence('entityType')} />
        </label>
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
          <label className="flex items-center gap-1.5 text-xs font-medium text-[#525252] mb-1.5">
            Ciudad
            <ConfidenceDot level={getFieldConfidence('city')} />
          </label>
          <input
            type="text"
            value={values.company.city ?? ''}
            onChange={(e) => updateCompany('city', e.target.value)}
            placeholder="Ej: Bogota D.C."
            className={cn(
              'w-full px-3 py-2 rounded-lg border text-sm text-[#0a0a0a] focus:outline-none focus:ring-1',
              fieldBorderClass('city', !!values.company.city),
            )}
          />
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-[#525252] mb-1.5">
            Representante Legal
            <ConfidenceDot level={getFieldConfidence('legalRepresentative')} />
          </label>
          <input
            type="text"
            value={values.company.legalRepresentative ?? ''}
            onChange={(e) => updateCompany('legalRepresentative', e.target.value)}
            placeholder="Nombre completo"
            className={cn(
              'w-full px-3 py-2 rounded-lg border text-sm text-[#0a0a0a] focus:outline-none focus:ring-1',
              fieldBorderClass('legalRepresentative', !!values.company.legalRepresentative),
            )}
          />
        </div>
      </div>

      {/* Contador + Revisor Fiscal */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-[#525252] mb-1.5">
            Contador
            <ConfidenceDot level={getFieldConfidence('accountant')} />
          </label>
          <input
            type="text"
            value={values.company.accountant ?? ''}
            onChange={(e) => updateCompany('accountant', e.target.value)}
            placeholder="Nombre completo"
            className={cn(
              'w-full px-3 py-2 rounded-lg border text-sm text-[#0a0a0a] focus:outline-none focus:ring-1',
              fieldBorderClass('accountant', !!values.company.accountant),
            )}
          />
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-[#525252] mb-1.5">
            Revisor Fiscal{' '}
            <span className="text-[#a3a3a3] font-normal">-- opcional</span>
            <ConfidenceDot level={getFieldConfidence('fiscalAuditor')} />
            <span className="inline-block relative group">
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
            className={cn(
              'w-full px-3 py-2 rounded-lg border text-sm text-[#0a0a0a] focus:outline-none focus:ring-1',
              fieldBorderClass('fiscalAuditor', !!values.company.fiscalAuditor),
            )}
          />
        </div>
      </div>

      {/* Period and NIIF group -- merged from old Step 2 */}
      <div className="border-t border-[#e5e5e5] pt-5 mt-2">
        <h3 className="text-sm font-semibold text-[#0a0a0a] mb-1">Periodo y Estandares</h3>
        <p className="text-xs text-[#737373] mb-4">Periodo fiscal y marco normativo aplicable.</p>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-[#525252] mb-1.5">
              Periodo Fiscal <span className="text-[#DC2626]">*</span>
              <ConfidenceDot level={getFieldConfidence('fiscalPeriod')} />
            </label>
            <select
              value={values.fiscalPeriod}
              onChange={(e) => updateField('fiscalPeriod', e.target.value)}
              className={cn(
                'w-full px-3 py-2 rounded-lg border text-sm text-[#0a0a0a] bg-white focus:outline-none focus:ring-1',
                fieldBorderClass('fiscalPeriod', !!values.fiscalPeriod),
              )}
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
            <label className="flex items-center gap-1.5 text-xs font-medium text-[#525252] mb-1.5">
              Periodo Comparativo <span className="text-[#a3a3a3] font-normal">-- opcional</span>
            </label>
            <select
              value={values.comparativePeriod ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                updateField('comparativePeriod', val || undefined);
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
          <label className="flex items-center gap-1.5 text-xs font-medium text-[#525252] mb-2">
            Grupo NIIF <span className="text-[#DC2626]">*</span>
            <ConfidenceDot level={getFieldConfidence('niifGroup')} />
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
    </div>
  );

  // ─── Step 3: Configuracion del Reporte ─────────────────────────────────────

  const step3Config = (
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

  // ─── Step 4: Preview ───────────────────────────────────────────────────────

  const step4Preview = (
    <IntakePreview
      caseType="niif_report"
      data={values}
      onBack={() => setStep(2)}
      onSubmit={handleSubmit}
    />
  );

  // ─── Wizard Steps ──────────────────────────────────────────────────────────

  const uploadStepValid =
    extractionState.status === 'done' || skippedUpload;

  const steps: WizardStep[] = [
    {
      id: 'upload',
      label: 'Cargar',
      isValid: uploadStepValid,
      component: step1Upload,
    },
    {
      id: 'review',
      label: 'Revisar',
      isValid: !!values.company.name && !!values.company.nit && !!values.fiscalPeriod && !!values.niifGroup,
      component: step2Review,
    },
    {
      id: 'config',
      label: 'Configuracion',
      isValid: Object.values(values.outputOptions).some(Boolean),
      component: step3Config,
    },
    {
      id: 'preview',
      label: 'Vista Previa',
      isValid: true,
      component: step4Preview,
    },
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
