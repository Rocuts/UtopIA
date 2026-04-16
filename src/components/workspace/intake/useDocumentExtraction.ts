import { useState, useCallback } from 'react';
import type { CompanyMetadata } from '@/types/platform';

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
}

export interface ExtractionState {
  status: 'idle' | 'uploading' | 'extracting' | 'done' | 'error';
  progress: number;
  fileName: string;
  extracted: ExtractedFields | null;
  error: string | null;
}

const INITIAL_STATE: ExtractionState = {
  status: 'idle',
  progress: 0,
  fileName: '',
  extracted: null,
  error: null,
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

export function useDocumentExtraction() {
  const [state, setState] = useState<ExtractionState>(INITIAL_STATE);

  const uploadAndExtract = useCallback(async (file: File) => {
    setState({
      status: 'uploading',
      progress: 20,
      fileName: file.name,
      extracted: null,
      error: null,
    });

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('context', file.name);

      setState(s => ({ ...s, progress: 40 }));

      const response = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'Upload failed');

      setState(s => ({ ...s, status: 'extracting', progress: 70 }));

      const rawText = data.extractedText || '';
      const { fields, confidence } = extractCompanyFromText(rawText);

      // Extract fiscal period from text
      const yearMatch = rawText.match(/(?:periodo|ano|year|vigencia)[:\s]*(\d{4})/i);
      const fiscalPeriod = yearMatch ? yearMatch[1] : undefined;
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
      };

      // Parse validation report for stats
      if (data.validationReport) {
        const accountsMatch = data.validationReport.match(/(\d+)\s*(?:cuentas|auxiliares)/i);
        if (accountsMatch) extracted.accountsDetected = parseInt(accountsMatch[1]);
        const classesMatch = data.validationReport.match(/(\d+)\s*(?:clases?\s*PUC|de\s*7)/i);
        if (classesMatch) extracted.pucClasses = parseInt(classesMatch[1]);
        extracted.equationValid = /ecuacion.*valida|equation.*valid|A\s*=\s*P\s*\+\s*E/i.test(data.validationReport);
      }

      setState({
        status: 'done',
        progress: 100,
        fileName: file.name,
        extracted,
        error: null,
      });
    } catch (err) {
      setState({
        status: 'error',
        progress: 0,
        fileName: file.name,
        extracted: null,
        error: err instanceof Error ? err.message : 'Error procesando archivo',
      });
    }
  }, []);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return { state, uploadAndExtract, reset };
}
