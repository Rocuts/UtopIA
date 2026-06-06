export const SPRING = { stiffness: 400, damping: 25 };

export const INITIAL_MSG: Record<string, Record<string, string>> = {
  general: {
    es: 'Bienvenido a 1+1. Soy su asistente especializado en consultoría contable, tributaria y financiera colombiana.\n\nPuede:\n- **Hacer cualquier pregunta** sobre contabilidad, NIIF, impuestos o finanzas\n- **Subir documentos** (PDF, Excel, Word, imágenes) usando el botón 📎 o arrastrando al chat\n- **Analizar extractos bancarios**, facturas, balances de prueba y más\n\n¿En qué puedo ayudarle?',
    en: 'Welcome to 1+1. I am your assistant specialized in Colombian accounting, tax and financial consulting.\n\nYou can:\n- **Ask any question** about accounting, IFRS, taxes or finance\n- **Upload documents** (PDF, Excel, Word, images) using the 📎 button or dragging to the chat\n- **Analyze bank statements**, invoices, trial balances and more\n\nHow can I help you?',
  },
  default: {
    es: 'Bienvenido a 1+1. Soy su asistente especializado en consultoría contable y tributaria colombiana. ¿En qué puedo ayudarle hoy?',
    en: 'Welcome to 1+1. I am your assistant specialized in Colombian accounting and tax consulting. How can I help you today?',
  },
};

// Case-aware starter prompts (shown on empty state)
export const STARTER_PROMPTS: Record<string, Record<'es' | 'en', string[]>> = {
  'dian-defense': {
    es: [
      'Recibí un requerimiento especial, ¿cómo respondo?',
      'Calcula la sanción del Art. 641 por 3 meses de extemporaneidad',
      '¿Cuáles son mis recursos frente a una liquidación oficial?',
      'Plazo para responder un pliego de cargos',
    ],
    en: [
      'I received a special DIAN requirement, how do I respond?',
      'Calculate the Art. 641 sanction for 3 months of late filing',
      'What remedies do I have against an official liquidation?',
      'Deadline to respond to a statement of charges',
    ],
  },
  'tax-refund': {
    es: [
      'Requisitos para devolución de IVA',
      'Diferencia entre devolución y compensación',
      '¿Qué documentos soporte necesito?',
      'Plazos DIAN para responder la solicitud',
    ],
    en: [
      'Requirements for VAT refund',
      'Difference between refund and offset',
      'What supporting documents do I need?',
      'DIAN deadlines to respond to the request',
    ],
  },
  'due-diligence': {
    es: [
      'Indicadores clave para due diligence financiero',
      '¿Qué contingencias tributarias revisar?',
      'Análisis de razones financieras bajo NIIF',
      'Red flags contables en una PYME',
    ],
    en: [
      'Key indicators for financial due diligence',
      'Which tax contingencies should I review?',
      'Financial ratio analysis under IFRS',
      'Accounting red flags in a SME',
    ],
  },
  'financial-intelligence': {
    es: [
      'Calcula el WACC para una empresa de retail',
      'Estructura de costos de un restaurante',
      'Punto de equilibrio con estos datos',
      'Proyección de flujo de caja a 3 años',
    ],
    en: [
      'Calculate WACC for a retail company',
      'Cost structure of a restaurant',
      'Break-even point with these figures',
      '3-year cash flow projection',
    ],
  },
  default: {
    es: [
      '¿Cuándo debo declarar renta este año?',
      'Diferencia entre IVA común y simplificado',
      '¿Cómo calculo una sanción por extemporaneidad?',
      'Explícame el principio de devengado bajo NIIF',
    ],
    en: [
      'When must I file income tax this year?',
      'Difference between common and simplified VAT',
      'How do I calculate a late-filing sanction?',
      'Explain the accrual principle under IFRS',
    ],
  },
};
