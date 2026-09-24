import { useState, useCallback, useRef } from 'react';
import type { CompanyMetadata } from '@/types/platform';
import { uploadDocument, type UploadDocumentResult } from '@/lib/upload/blob-client';
import {
  MULTIPLICADOR_UNIDAD,
  type UnidadMonetaria,
  type UploadUnitInfo,
} from '@/lib/upload/ingest-directives';
import { rememberUploadedPreprocessed } from '@/lib/upload/preprocessed-handoff';
import { fiscalPeriodFromPreprocessed, pickNiifRawDataFromUpload } from './niifIntakeValidation';

export type FieldConfidence = 'high' | 'medium' | 'none';

export interface ExtractedFields {
  company: Partial<CompanyMetadata>;
  fiscalPeriod?: string;
  comparativePeriod?: string;
  niifGroup?: 1 | 2 | 3;
  confidence: Record<string, FieldConfidence>;
  rawText: string;
  validationReport?: string;
  isTrialBalance: boolean;
  accountsDetected?: number;
  pucClasses?: number;
  equationValid?: boolean;
  /**
   * P4-a: unidad que declara el balance ("en miles de pesos") y la que
   * confirmó el usuario. `requiresConfirmation` bloquea el informe hasta que
   * el usuario elija pesos / miles / millones.
   */
  unit?: UploadUnitInfo | null;
  /** Motivos por los que el balance no se pudo preprocesar (422 en /niif). */
  ingestErrors?: string[];
}

export interface ExtractionState {
  status: 'idle' | 'uploading' | 'extracting' | 'done' | 'error';
  progress: number;
  fileName: string;
  extracted: ExtractedFields | null;
  error: string | null;
  /**
   * Reproceso del archivo con la unidad confirmada (P4-a). Mientras
   * `confirming`, `extracted` conserva la lectura anterior.
   */
  unitConfirmation: { status: 'idle' | 'confirming' | 'error'; error: string | null };
}

const INITIAL_STATE: ExtractionState = {
  status: 'idle',
  progress: 0,
  fileName: '',
  extracted: null,
  error: null,
  unitConfirmation: { status: 'idle', error: null },
};

function extractCompanyFromText(text: string): { fields: Partial<CompanyMetadata>; confidence: Record<string, FieldConfidence> } {
  const fields: Partial<CompanyMetadata> = {};
  const confidence: Record<string, FieldConfidence> = {};

  // NIT extraction: XXX.XXX.XXX-X pattern
  const nitMatch = text.match(/(?:NIT|N\.I\.T\.?|nit)[:\s]*(\d{3}\.?\d{3}\.?\d{3}[-\s]?\d)/i);
  if (nitMatch) {
    fields.nit = nitMatch[1].replace(/\s/g, '');
    confidence.nit = 'high';
  }

  // Company name: look near NIT or "Razon Social" or "Empresa"
  const namePatterns = [
    /(?:razon\s*social|empresa|sociedad|compania)[:\s]*([A-Z][A-Za-z\s&.,]+(?:S\.?A\.?S\.?|S\.?A\.?|LTDA\.?|S\.?C\.?S\.?))/i,
    /(?:^|\n)([A-Z][A-Z\s&.,]{5,}(?:S\.?A\.?S\.?|S\.?A\.?|LTDA\.?|S\.?C\.?S\.?))/m,
  ];
  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match) {
      fields.name = match[1].trim();
      confidence.name = 'medium';
      break;
    }
  }

  // Entity type from name or context
  const textUpper = text.toUpperCase();
  if (textUpper.includes('S.A.S') || textUpper.includes('SAS')) {
    fields.entityType = 'SAS';
    confidence.entityType = 'high';
  } else if (textUpper.includes('LTDA')) {
    fields.entityType = 'LTDA';
    confidence.entityType = 'high';
  } else if (/\bS\.?A\b/.test(textUpper) && !textUpper.includes('SAS')) {
    fields.entityType = 'SA';
    confidence.entityType = 'medium';
  }

  // Period: look for year patterns
  const yearMatch = text.match(/(?:periodo|periodo\s*fiscal|ano|year|vigencia)[:\s]*(\d{4})/i);
  if (yearMatch) {
    confidence.fiscalPeriod = 'high';
  }

  // City
  const cityPatterns = ['bogota', 'medellin', 'cali', 'barranquilla', 'cartagena', 'bucaramanga', 'pereira', 'manizales', 'cucuta', 'ibague'];
  const lower = text.toLowerCase();
  for (const city of cityPatterns) {
    if (lower.includes(city)) {
      fields.city = city.charAt(0).toUpperCase() + city.slice(1);
      confidence.city = 'medium';
      break;
    }
  }

  // Representante Legal
  const repMatch = text.match(/(?:representante\s*legal|rep\.?\s*legal)[:\s]*([A-Z][a-zA-Z\s]{3,40})/i);
  if (repMatch) {
    fields.legalRepresentative = repMatch[1].trim();
    confidence.legalRepresentative = 'medium';
  }

  // Contador
  const contMatch = text.match(/(?:contador\s*(?:publico)?|C\.?P\.?)[:\s]*([A-Z][a-zA-Z\s]{3,40})/i);
  if (contMatch) {
    fields.accountant = contMatch[1].trim();
    confidence.accountant = 'medium';
  }

  // Revisor Fiscal
  const revMatch = text.match(/(?:revisor\s*fiscal|R\.?F\.?)[:\s]*([A-Z][a-zA-Z\s]{3,40})/i);
  if (revMatch) {
    fields.fiscalAuditor = revMatch[1].trim();
    confidence.fiscalAuditor = 'medium';
  }

  return { fields, confidence };
}

/**
 * Campos del intake a partir de la respuesta de /api/upload. Pura: la usan la
 * subida inicial y el reproceso con la unidad confirmada (P4-a).
 */
export function buildExtractedFields(data: UploadDocumentResult): ExtractedFields {
  // Dato tabular SIN el informe de validación: es lo que el pipeline NIIF
  // re-parsea en servidor (ingesta-01). `extractedText` queda para el chat.
  const rawText = pickNiifRawDataFromUpload(data);
  const { fields, confidence } = extractCompanyFromText(rawText);

  // Periodo fiscal (pipeline-flujo-17): primero el del balance preprocesado
  // por /api/upload — es el que el servidor compara contra el intake y, si
  // difieren, sella el informe —; si no trae un año, el rótulo del texto.
  const yearMatch = rawText.match(/(?:periodo|ano|year|vigencia)[:\s]*(\d{4})/i);
  const fiscalPeriod =
    fiscalPeriodFromPreprocessed(data.preprocessed) ?? (yearMatch ? yearMatch[1] : undefined);
  if (fiscalPeriod) confidence.fiscalPeriod = 'high';

  // Detect NIIF group from text
  let niifGroup: 1 | 2 | 3 | undefined;
  const lowerText = rawText.toLowerCase();
  if (lowerText.includes('grupo 1') || lowerText.includes('niif plenas')) {
    niifGroup = 1;
    confidence.niifGroup = 'high';
  } else if (lowerText.includes('grupo 3') || lowerText.includes('microempresa')) {
    niifGroup = 3;
    confidence.niifGroup = 'high';
  } else {
    niifGroup = 2; // default
    confidence.niifGroup = 'none';
  }

  const extracted: ExtractedFields = {
    company: fields,
    fiscalPeriod,
    niifGroup,
    confidence,
    rawText,
    validationReport: data.validationReport,
    isTrialBalance: data.isTrialBalance || !!data.validationReport,
    accountsDetected: undefined,
    pucClasses: undefined,
    equationValid: undefined,
    unit: data.unit ?? null,
    ingestErrors: data.ingestErrors ?? [],
  };

  // Parse validation report for stats
  if (data.validationReport) {
    const accountsMatch = data.validationReport.match(/(\d+)\s*(?:cuentas|auxiliares)/i);
    if (accountsMatch) extracted.accountsDetected = parseInt(accountsMatch[1]);
    const classesMatch = data.validationReport.match(/(\d+)\s*(?:clases?\s*PUC|de\s*7)/i);
    if (classesMatch) extracted.pucClasses = parseInt(classesMatch[1]);
    extracted.equationValid = /ecuacion.*valida|equation.*valid|A\s*=\s*P\s*\+\s*E/i.test(data.validationReport);
  }
  return extracted;
}

export function useDocumentExtraction() {
  const [state, setState] = useState<ExtractionState>(INITIAL_STATE);
  // Último archivo subido: la confirmación de unidad lo reenvía (P4-a).
  const lastFileRef = useRef<File | null>(null);

  const uploadAndExtract = useCallback(async (file: File) => {
    lastFileRef.current = file;
    setState({
      status: 'uploading',
      progress: 0,
      fileName: file.name,
      extracted: null,
      error: null,
      unitConfirmation: { status: 'idle', error: null },
    });

    try {
      // Subida directa a Blob: el callback reporta progreso real 0..100.
      const data = await uploadDocument(file, file.name, pct =>
        setState(s => ({ ...s, status: 'uploading', progress: pct })),
      );

      // Subida completa — el servidor está procesando (OCR/RAG/preprocesado).
      setState(s => ({ ...s, status: 'extracting', progress: 100 }));

      const extracted = buildExtractedFields(data);
      // El preprocesado del upload se reenvía a /niif sólo mientras `rawData`
      // siga siendo este mismo texto (handoff en memoria, no en localStorage).
      rememberUploadedPreprocessed(extracted.rawText, data.preprocessed);

      setState({
        status: 'done',
        progress: 100,
        fileName: file.name,
        extracted,
        error: null,
        unitConfirmation: { status: 'idle', error: null },
      });
    } catch (err) {
      setState({
        status: 'error',
        progress: 0,
        fileName: file.name,
        extracted: null,
        error: err instanceof Error ? err.message : 'Error procesando archivo',
        unitConfirmation: { status: 'idle', error: null },
      });
    }
  }, []);

  /**
   * P4-a: reenvía el último archivo con la unidad que eligió el usuario. El
   * servidor reexpresa los importes en centavos exactos y devuelve `rawData`
   * con la directiva de la unidad; la lectura anterior se conserva hasta que
   * llega la nueva (un error no borra lo ya extraído).
   */
  const confirmUnit = useCallback(async (unidad: UnidadMonetaria) => {
    const file = lastFileRef.current;
    if (!file) return;
    setState(s => ({ ...s, unitConfirmation: { status: 'confirming', error: null } }));
    try {
      const data = await uploadDocument(file, file.name, undefined, {
        unitMultiplier: MULTIPLICADOR_UNIDAD[unidad],
      });
      const extracted = buildExtractedFields(data);
      rememberUploadedPreprocessed(extracted.rawText, data.preprocessed);
      setState(s => ({ ...s, extracted, unitConfirmation: { status: 'idle', error: null } }));
    } catch (err) {
      setState(s => ({
        ...s,
        unitConfirmation: {
          status: 'error',
          error: err instanceof Error ? err.message : 'Error procesando archivo',
        },
      }));
    }
  }, []);

  const reset = useCallback(() => {
    lastFileRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  return { state, uploadAndExtract, confirmUnit, reset };
}
