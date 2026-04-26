'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
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
  'Tecnología',
  'Construcción',
  'Salud',
  'Educación',
  'Agropecuario',
  'Transporte',
  'Financiero',
  'Minero-energético',
  'Inmobiliario',
  'Otro',
];

const NIIF_GROUPS = [
  {
    value: 1 as const,
    label: 'Grupo 1 -- NIIF Plenas',
    description:
      'Emisores de valores, entidades de interés público, entidades con activos > 30.000 SMLMV o empleados > 200.',
    badge: null,
  },
  {
    value: 2 as const,
    label: 'Grupo 2 -- NIIF para PYMES',
    description:
      'Empresas que no son emisores ni de interés público, con activos entre 500 y 30.000 SMLMV o 11-200 empleados.',
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
  { key: 'kpiDashboard', label: 'Dashboard Estratégico', description: 'KPIs clave: liquidez, rentabilidad, endeudamiento' },
  { key: 'cashFlowProjection', label: 'Flujo de Caja Proyectado', description: 'Proyección a 12 meses con escenarios' },
  { key: 'breakevenAnalysis', label: 'Punto de Equilibrio', description: 'Cálculo de punto de equilibrio operativo' },
  { key: 'notesToFinancialStatements', label: '13 Notas a los EEFF', description: 'Notas completas según NIIF/NIC 1' },
  { key: 'shareholdersMinutes', label: 'Acta de Asamblea', description: 'Borrador del acta para aprobación de estados financieros' },
  { key: 'auditPipeline', label: 'Auditoría Especializada', description: '4 auditores paralelos: NIIF, Tributario, Legal, Fiscal' },
  { key: 'metaAudit', label: 'Meta-auditoría de Calidad', description: '12 dimensiones: ISO 25012, ISO 42001, IASB' },
  { key: 'excelExport', label: 'Exportación Excel', description: 'Archivo .xlsx con multiples hojas y formato corporativo' },
  { key: 'comparativeAnalysis', label: 'Análisis Comparativo', description: 'Variaciones interperiodo con análisis de tendencias' },
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
  fiscalPeriod: String(new Date().getFullYear() - 1),
  comparativePeriod: '',
  rawData: '',
  outputOptions: DEFAULT_OUTPUT_OPTIONS,
  specialInstructions: '',
};

// ─── Field label mapping for confidence tracking ────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  name: 'Razón Social',
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
        className="inline-block w-2 h-2 rounded-full bg-success shrink-0"
        title="Auto-detectado (alta confianza)"
      />
    );
  }
  if (level === 'medium') {
    return (
      <span
        className="inline-block w-2 h-2 rounded-full bg-warning shrink-0"
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
          <Sparkles className="w-5 h-5 text-gold-500" />
        </motion.div>
        <div>
          <div className="text-sm font-medium text-n-900">{currentStage.label}...</div>
          <div className="text-xs text-n-500">{fileName}</div>
        </div>
      </div>

      <div className="w-full h-2 bg-n-100 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gold-500 rounded-full"
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
                  ? 'text-success'
                  : active
                    ? 'text-gold-500'
                    : 'text-n-400',
              )}
            >
              {reached ? (
                <CheckCircle className="w-3 h-3" />
              ) : active ? (
                <motion.div
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                  className="w-3 h-3 rounded-full bg-gold-500"
                />
              ) : (
                <div className="w-3 h-3 rounded-full border border-n-200" />
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
      className="rounded-lg border border-n-200 bg-n-50 p-4 space-y-3"
    >
      <div className="flex items-center gap-2">
        <CheckCircle className="w-4 h-4 text-success" />
        <span className="text-sm font-semibold text-n-900">Balance de Prueba Detectado</span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <div className="text-lg font-bold text-n-900">{accountsDetected}</div>
          <div className="text-2xs text-n-500">Cuentas detectadas</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-n-900">{pucClasses}</div>
          <div className="text-2xs text-n-500">Clases PUC</div>
        </div>
        <div className="text-center">
          <div
            className={cn(
              'text-lg font-bold',
              equationValid ? 'text-success' : 'text-danger',
            )}
          >
            {equationValid ? 'OK' : 'ERROR'}
          </div>
          <div className="text-2xs text-n-500">Ecuación Patrimonial</div>
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
    <div className="rounded-lg border border-n-200 bg-gold-500/10 px-4 py-3 flex items-center gap-3">
      <Sparkles className="w-4 h-4 text-gold-500 shrink-0" />
      <div>
        <span className="text-sm font-semibold text-n-900">
          {detected} de {total} campos auto-detectados
        </span>
        <p className="text-xs text-n-500">
          Revise y complete los campos faltantes marcados en rojo.
        </p>
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function NiifReportIntake() {
  const {
    startNewConsultation,
    setIntakeModalOpen,
    clearIntakeDraft,
    setActiveMode,
    setPipelineInput,
    setPipelineState,
  } = useWorkspace();
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

  // Auto-advance to step 2 when extraction completes — guarded by a ref
  // so debounced re-renders (e.g. autosave from useIntakePersistence) can't
  // re-trigger prefill and yank the user back mid-edit.
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
          rawData: extracted.rawText || prev.rawData,
        };
      });

      // Auto-advance after a brief delay to show the completed state
      const timer = setTimeout(() => setStep(1), 800);
      return () => clearTimeout(timer);
    }
  }, [extractionState.status, extractionState.extracted, setValues]);

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
    const extractedRaw =
      extractionState.status === 'done' ? extractionState.extracted?.rawText : undefined;
    const resolvedRawData = (extractedRaw || values.rawData || '').trim();

    const finalIntake: NiifReportIntakeType = {
      ...values,
      rawData: resolvedRawData,
    };

    startNewConsultation('financial-report');
    setPipelineInput(finalIntake);
    setPipelineState({
      mode: 'running',
      currentStage: 1,
      stageLabels: ['Analista NIIF', 'Director de Estrategia', 'Gobierno Corporativo'],
      completedStages: [],
      auditorsStarted: [],
      auditorsComplete: [],
      auditFindings: {},
      startedAt: new Date(),
    });
    setActiveMode('pipeline');
    clearIntakeDraft('niif_report');
    setIntakeModalOpen(false);
  }, [
    values,
    extractionState,
    startNewConsultation,
    setPipelineInput,
    setPipelineState,
    setActiveMode,
    clearIntakeDraft,
    setIntakeModalOpen,
  ]);

  // Generate year options
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => currentYear - i);

  // Helper: border class based on confidence + required-state.
  // Required fields with no value always render in danger color so the user
  // sees what's missing regardless of how they reached step 2 (upload or skip).
  const fieldBorderClass = useCallback(
    (field: string, hasValue: boolean, isRequired = false): string => {
      if (isRequired && !hasValue) {
        return 'border-danger focus:border-danger focus:ring-danger';
      }
      const conf = getFieldConfidence(field);
      if (conf === 'none' && !hasValue && extractionState.status === 'done' && !skippedUpload) {
        return 'border-danger focus:border-danger focus:ring-danger';
      }
      return 'border-n-200 focus:border-gold-500 focus:ring-gold-500';
    },
    [getFieldConfidence, extractionState.status, skippedUpload],
  );

  // Required fields missing in step 2. Drives the red banner and aria-invalid hints.
  const missingRequired = useMemo(() => {
    const missing: string[] = [];
    if (!values.company.name?.trim()) missing.push('Razón Social');
    if (!values.company.nit?.trim()) missing.push('NIT');
    if (!values.fiscalPeriod) missing.push('Periodo Fiscal');
    if (!values.niifGroup) missing.push('Grupo NIIF');
    return missing;
  }, [values.company.name, values.company.nit, values.fiscalPeriod, values.niifGroup]);

  // ─── Step 1: Upload Document ──────────────────────────────────────────────

  const step1Upload = (
    <div className="space-y-5">
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Upload className="w-5 h-5 text-gold-500" />
          <h3 className="text-base font-semibold text-n-900">
            Cargue su balance de prueba o estados financieros
          </h3>
        </div>
        <p className="text-sm text-n-500">
          1+1 extrae automáticamente los datos de su archivo
        </p>
      </div>

      {extractionState.status === 'idle' || extractionState.status === 'error' ? (
        <>
          <FileUploadZone
            onUpload={handleUpload}
            label="Arrastre su archivo aquí o haga clic para seleccionar"
            sublabel="CSV, XLSX, XLS, PDF, DOCX -- Max 25MB"
            accept=".csv,.xlsx,.xls,.pdf,.docx"
            maxSizeMB={25}
            className="min-h-[260px]"
          />

          {extractionState.status === 'error' && extractionState.error && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-lg border border-danger bg-danger/10 px-4 py-3 flex items-center gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
              <div>
                <span className="text-sm font-medium text-danger">Error al procesar</span>
                <p className="text-xs text-n-500">{extractionState.error}</p>
              </div>
            </motion.div>
          )}
        </>
      ) : (
        <div className="min-h-[260px] rounded-lg border-2 border-dashed border-gold-500 bg-gold-500/5 p-8 flex items-center justify-center">
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
            className="inline-flex items-center gap-1.5 text-xs text-n-500 hover:text-n-600 transition-colors"
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
      {/* Missing-required banner: surfaces blockers regardless of upload path. */}
      {missingRequired.length > 0 && (
        <div
          id="niif-required-errors"
          role="alert"
          className="rounded-2xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          <p className="font-semibold mb-1">
            Falta(n) {missingRequired.length} campo(s) requerido(s) para continuar:
          </p>
          <ul className="list-disc list-inside space-y-0.5">
            {missingRequired.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Detection summary banner */}
      {hasExtraction && (
        <DetectionSummary confidence={confidenceMap} />
      )}

      {/* Company data section */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Building2 className="w-4 h-4 text-gold-500" />
          <h3 className="text-sm font-semibold text-n-900">Datos de la Empresa</h3>
        </div>
        <p className="text-xs text-n-500">Información de la entidad reportante.</p>
      </div>

      {/* Razon Social -- full width */}
      <div>
        <label className="flex items-center gap-1.5 text-xs font-medium text-n-600 mb-1.5">
          Razón Social <span className="text-danger">*</span>
          <ConfidenceDot level={getFieldConfidence('name')} />
        </label>
        <input
          type="text"
          value={values.company.name}
          onChange={(e) => updateCompany('name', e.target.value)}
          placeholder="Ej: Inversiones Colombia S.A.S."
          aria-invalid={!values.company.name?.trim()}
          aria-describedby={
            !values.company.name?.trim() && missingRequired.length > 0
              ? 'niif-required-errors'
              : undefined
          }
          className={cn(
            'w-full px-3 py-2 rounded-lg border text-sm text-n-900 focus:outline-none focus:ring-1',
            fieldBorderClass('name', !!values.company.name, true),
          )}
        />
      </div>

      {/* 2-column grid: NIT + Sector */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-n-600 mb-1.5">
            NIT <span className="text-danger">*</span>
            <ConfidenceDot level={getFieldConfidence('nit')} />
          </label>
          <input
            type="text"
            value={values.company.nit}
            onChange={(e) => updateCompany('nit', formatNIT(e.target.value))}
            placeholder="XXX.XXX.XXX-X"
            maxLength={13}
            aria-invalid={!values.company.nit?.trim()}
            aria-describedby={
              !values.company.nit?.trim() && missingRequired.length > 0
                ? 'niif-required-errors'
                : undefined
            }
            className={cn(
              'w-full px-3 py-2 rounded-lg border text-sm text-n-900 font-mono focus:outline-none focus:ring-1',
              fieldBorderClass('nit', !!values.company.nit, true),
            )}
          />
        </div>

        <div className="relative">
          <label className="flex items-center gap-1.5 text-xs font-medium text-n-600 mb-1.5">
            Sector
            <ConfidenceDot level={getFieldConfidence('sector')} />
          </label>
          <button
            type="button"
            onClick={() => setSectorOpen(!sectorOpen)}
            className={cn(
              'w-full px-3 py-2 rounded-lg border text-sm text-left bg-n-0 focus:outline-none focus:ring-1',
              fieldBorderClass('sector', !!values.company.sector),
            )}
          >
            <span className={values.company.sector ? 'text-n-900' : 'text-n-400'}>
              {values.company.sector || 'Seleccionar sector'}
            </span>
          </button>
          {sectorOpen && (
            <div
              data-lenis-prevent
              className="absolute z-20 top-full mt-1 left-0 right-0 bg-n-0 border border-n-200 rounded-lg shadow-lg max-h-48 overflow-y-auto styled-scrollbar"
            >
              {SECTORS.map((sector) => (
                <button
                  key={sector}
                  type="button"
                  onClick={() => {
                    updateCompany('sector', sector);
                    setSectorOpen(false);
                  }}
                  className={cn(
                    'w-full text-left px-3 py-1.5 text-xs hover:bg-gold-500/10 transition-colors',
                    values.company.sector === sector
                      ? 'bg-gold-500/10 text-gold-500 font-medium'
                      : 'text-n-600',
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
        <label className="flex items-center gap-1.5 text-xs font-medium text-n-600 mb-2">
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
                    ? 'bg-n-900 text-n-0 border-n-900'
                    : 'bg-n-0 text-n-600 border-n-200 hover:border-n-400',
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
          <label className="flex items-center gap-1.5 text-xs font-medium text-n-600 mb-1.5">
            Ciudad
            <ConfidenceDot level={getFieldConfidence('city')} />
          </label>
          <input
            type="text"
            value={values.company.city ?? ''}
            onChange={(e) => updateCompany('city', e.target.value)}
            placeholder="Ej: Bogotá D.C."
            className={cn(
              'w-full px-3 py-2 rounded-lg border text-sm text-n-900 focus:outline-none focus:ring-1',
              fieldBorderClass('city', !!values.company.city),
            )}
          />
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-n-600 mb-1.5">
            Representante Legal
            <ConfidenceDot level={getFieldConfidence('legalRepresentative')} />
          </label>
          <input
            type="text"
            value={values.company.legalRepresentative ?? ''}
            onChange={(e) => updateCompany('legalRepresentative', e.target.value)}
            placeholder="Nombre completo"
            className={cn(
              'w-full px-3 py-2 rounded-lg border text-sm text-n-900 focus:outline-none focus:ring-1',
              fieldBorderClass('legalRepresentative', !!values.company.legalRepresentative),
            )}
          />
        </div>
      </div>

      {/* Contador + Revisor Fiscal */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-n-600 mb-1.5">
            Contador
            <ConfidenceDot level={getFieldConfidence('accountant')} />
          </label>
          <input
            type="text"
            value={values.company.accountant ?? ''}
            onChange={(e) => updateCompany('accountant', e.target.value)}
            placeholder="Nombre completo"
            className={cn(
              'w-full px-3 py-2 rounded-lg border text-sm text-n-900 focus:outline-none focus:ring-1',
              fieldBorderClass('accountant', !!values.company.accountant),
            )}
          />
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-n-600 mb-1.5">
            Revisor Fiscal{' '}
            <span className="text-n-400 font-normal">-- opcional</span>
            <ConfidenceDot level={getFieldConfidence('fiscalAuditor')} />
            <span className="inline-block relative group">
              <Info className="w-3 h-3 text-n-400 inline" />
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-n-900 text-n-0 text-2xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
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
              'w-full px-3 py-2 rounded-lg border text-sm text-n-900 focus:outline-none focus:ring-1',
              fieldBorderClass('fiscalAuditor', !!values.company.fiscalAuditor),
            )}
          />
        </div>
      </div>

      {/* Period and NIIF group -- merged from old Step 2 */}
      <div className="border-t border-n-200 pt-5 mt-2">
        <h3 className="text-sm font-semibold text-n-900 mb-1">Periodo y Estandares</h3>
        <p className="text-xs text-n-500 mb-4">Periodo fiscal y marco normativo aplicable.</p>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-n-600 mb-1.5">
              Periodo Fiscal <span className="text-danger">*</span>
              <ConfidenceDot level={getFieldConfidence('fiscalPeriod')} />
            </label>
            <select
              value={values.fiscalPeriod}
              onChange={(e) => updateField('fiscalPeriod', e.target.value)}
              aria-invalid={!values.fiscalPeriod}
              aria-describedby={
                !values.fiscalPeriod && missingRequired.length > 0
                  ? 'niif-required-errors'
                  : undefined
              }
              className={cn(
                'w-full px-3 py-2 rounded-lg border text-sm text-n-900 bg-n-0 focus:outline-none focus:ring-1',
                fieldBorderClass('fiscalPeriod', !!values.fiscalPeriod, true),
              )}
            >
              <option value="">Seleccionar año</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-n-600 mb-1.5">
              Periodo Comparativo <span className="text-n-400 font-normal">-- opcional</span>
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
              className="w-full px-3 py-2 rounded-lg border border-n-200 text-sm text-n-900 bg-n-0 focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
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
          <label
            id="niif-group-label"
            className="flex items-center gap-1.5 text-xs font-medium text-n-600 mb-2"
          >
            Grupo NIIF <span className="text-danger">*</span>
            <ConfidenceDot level={getFieldConfidence('niifGroup')} />
          </label>
          <div
            role="radiogroup"
            aria-labelledby="niif-group-label"
            aria-required="true"
            aria-invalid={!values.niifGroup}
            aria-describedby={
              !values.niifGroup && missingRequired.length > 0
                ? 'niif-required-errors'
                : undefined
            }
            className="space-y-2"
          >
            {NIIF_GROUPS.map((group) => {
              const selected = values.niifGroup === group.value;
              return (
                <button
                  key={group.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => updateField('niifGroup', group.value)}
                  className={cn(
                    'w-full text-left p-4 rounded-lg border-l-4 transition-all',
                    selected
                      ? 'border-l-n-900 bg-n-50 border border-n-900'
                      : 'border-l-n-200 bg-n-0 border border-n-200 hover:border-n-300',
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-n-900">{group.label}</span>
                    {group.badge && (
                      <span className="px-2 py-0.5 text-2xs font-bold bg-n-100 text-n-700 rounded-full">
                        {group.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-n-500 leading-relaxed">{group.description}</p>
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
          <Settings2 className="w-4 h-4 text-gold-500" />
          <h3 className="text-sm font-semibold text-n-900">Configuración del Reporte</h3>
        </div>
        <p className="text-xs text-n-500">
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
                  ? 'border-gold-500 bg-gold-500/10'
                  : 'border-n-200 bg-n-0',
                isComparative && !hasComparativePeriod && 'opacity-40 cursor-not-allowed',
                !isComparative && !enabled && 'hover:border-n-300',
              )}
            >
              <div
                className={cn(
                  'w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors',
                  enabled ? 'bg-gold-500 border-gold-500' : 'border-n-300',
                )}
              >
                {enabled && <CheckCircle className="w-3.5 h-3.5 text-n-0" />}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-n-900 block">{opt.label}</span>
                <p className="text-2xs text-n-500 leading-relaxed">{opt.description}</p>
                {isComparative && !hasComparativePeriod && (
                  <p className="text-2xs text-warning mt-0.5">
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
        <label className="block text-xs font-medium text-n-600 mb-1.5">
          Instrucciones especiales{' '}
          <span className="text-n-400 font-normal">-- opcional</span>
        </label>
        <textarea
          value={values.specialInstructions ?? ''}
          onChange={(e) => updateField('specialInstructions', e.target.value)}
          placeholder="Ej: Enfatizar el análisis de cartera morosa, incluir simulación de provisión..."
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-n-200 text-sm text-n-900 resize-none focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
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
      label: 'Configuración',
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
