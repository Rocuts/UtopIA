// ---------------------------------------------------------------------------
// System prompt — Agente 1: Analista de Mercado (Feasibility)
// ---------------------------------------------------------------------------
// Outcome-first GPT-5.4 (CTCO + XML). Schema (MarketAnalysisReportSchema) se
// enforza via experimental_output. El prompt declara invariantes y juicios.
// ---------------------------------------------------------------------------

import type { ProjectInfo } from '../types';
import { SMMLV_2026 } from '@/lib/tax/taxCalculator';
import { UVT_2026_COP } from '@/lib/accounting/tax-engine/constants';

// valoracion-19: tamaño empresarial por ingresos por actividades ordinarias en
// UVT según macrosector — Decreto 1074/2015 arts. 2.2.1.13.2.1-2 (adicionados
// por el Decreto 957/2019, vigentes desde el 5-dic-2019; corpus local
// src/data/tax_docs/decreto_1074_2015.md). El criterio de activos (Ley 590/2000
// y 905/2004) ya no es el criterio de clasificación.
const UVT_2026 = UVT_2026_COP;
const MIPYME_UVT_CEILINGS: Array<{ sector: string; micro: number; pequena: number; mediana: number }> = [
  { sector: 'Manufactura', micro: 23_563, pequena: 204_995, mediana: 1_736_565 },
  { sector: 'Servicios', micro: 32_988, pequena: 131_951, mediana: 483_034 },
  { sector: 'Comercio', micro: 44_769, pequena: 431_196, mediana: 2_160_692 },
];

/** Enteros con separador de miles "." (es-CO), sin depender de ICU. */
function thousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function buildMipymeClassificationBlock(): string {
  const rows = MIPYME_UVT_CEILINGS.map(
    (r) =>
      `  ${r.sector}: micro <= ${thousands(r.micro)} UVT ($${thousands(r.micro * UVT_2026)}); pequena <= ${thousands(r.pequena)} UVT ($${thousands(r.pequena * UVT_2026)}); mediana <= ${thousands(r.mediana)} UVT ($${thousands(r.mediana * UVT_2026)}); grande por encima.`,
  );
  return [
    '- Clasificacion MIPYME (Decreto 957/2019, compilado en el Decreto 1074/2015 arts. 2.2.1.13.2.1-2): criterio exclusivo = ingresos por actividades ordinarias anuales del ano anterior, en UVT, segun macrosector (pesos con UVT 2026 = $' + thousands(UVT_2026) + ', referencial):',
    ...rows,
    '  Si la actividad no corresponde exclusivamente a un macrosector se usan los rangos de manufactura; con ingresos de varios sectores, el de mayores ingresos.',
  ].join('\n');
}

export function buildMarketAnalystPrompt(
  project: ProjectInfo,
  language: 'es' | 'en',
): string {
  const langInstruction =
    language === 'en'
      ? 'CRITICAL: Respond entirely in English (Colombian Spanish for citations and currency).'
      : 'CRITICO: Responde completamente en espanol colombiano (es-CO).';

  const companySize = getCompanySizeLabel(project.companySize);
  const horizon = project.evaluationHorizon || 5;

  const guardrail = `Eres el Analista Senior de Mercado e Investigacion Sectorial de 1+1.
NEVER inventes cifras de mercado, nombres de empresas competidoras ni fuentes. Cita SOLO fuentes colombianas reales: DANE, Banco de la Republica, Superintendencia de Sociedades, Confecamaras, DNP MGA, MinCIT, Procolombia, gremios reales del sector.
ALWAYS muestra TAM/SAM/SOM con cifras en COP y CAGR del sector, con la fuente al lado de cada numero.
ALWAYS clasifica el proyecto en CIIU Rev. 4 A.C. (DANE) — si no es claro, da las opciones y declara el ranking de probabilidad.`;

  const context2026 = `Marco Colombia 2026:
${buildMipymeClassificationBlock()}
  SMMLV 2026 = $${SMMLV_2026.toLocaleString('es-CO')} COP.
- Formalizacion: Camara de Comercio (Registro Mercantil), RUT (DIAN), VUE.
- Ley 2069/2020 (Ley de Emprendimiento): simplificacion de tramites, SAS simplificada.
- 5 Fuerzas de Porter como marco de competencia.
- Fuentes habituales: DANE EAM/EAS/EMM/Censo Economico, SuperSociedades SIREM, Banco de la Republica (TRM/IPC/IBR), Confecamaras (dinamica empresarial), DNP MGA.
- UVT 2026 = $${UVT_2026.toLocaleString('es-CO')} COP. Moneda en formato es-CO: $1.234.567,89.
Proyecto: "${project.projectName}" — ${project.description}. Sector: ${project.sector}${project.ciiu ? ` (CIIU ${project.ciiu})` : ''}.${project.city ? ` Ciudad: ${project.city}.` : ''}${project.department ? ` Departamento: ${project.department}.` : ''}${project.estimatedInvestment ? ` Inversion estimada: $${project.estimatedInvestment.toLocaleString('es-CO')} COP.` : ''}${companySize ? ` Clasificacion: ${companySize}.` : ''}
Horizonte de evaluacion: ${horizon} anos.
${project.isZomac ? 'Aplica regimen ZOMAC (para su tarifa el tamano se define por activos totales, Art. 236 Ley 1819/2016, distinto del criterio de ingresos del Decreto 957/2019).' : ''}${project.isZonaFranca ? ' Aplica regimen Zona Franca.' : ''}${project.isEconomiaNaranja ? ' Aplica regimen Economia Naranja (verificar derecho adquirido pre-Ley 2277/2022).' : ''}`;

  return `${guardrail}

${context2026}

<task>Producir un estudio de mercado riguroso para evaluar la viabilidad comercial del proyecto en Colombia, con TAM/SAM/SOM, segmento objetivo, panorama competitivo (5 Fuerzas), proyecciones de demanda a ${horizon} anos y barreras de entrada / requisitos regulatorios.</task>

<success_criteria>
- marketSize incluye TAM, SAM y SOM cuantificados en COP, CAGR del sector y la fuente exacta de cada numero (DANE/SuperSociedades/gremio).
- targetSegment define B2B o B2C, tamano en numero de clientes y valor, necesidades insatisfechas y disposicion a pagar.
- competitiveLandscape cubre las 5 Fuerzas Porter aplicadas al sector colombiano + ventajas competitivas + mapa de posicionamiento.
- demandProjections presenta escenarios pesimista/base/optimista a ${horizon} anos con supuestos documentados y estacionalidad si aplica.
- entryBarriers cuantifica capital requerido, identifica licencias/permisos (INVIMA si aplica, ANLA si aplica, superintendencias sectoriales) y reporta costos y tiempos de tramite estimados.
</success_criteria>

<constraints>
- ALWAYS cita la fuente al lado de cada cifra de mercado. Sin fuente = "Dato a validar con estudio de campo" + metodologia para obtenerlo.
- NEVER inventes nombres de empresas competidoras: si no conoces nombres, describe perfiles competitivos genericos por arquetipo (lider de costo, especialista de nicho, integrador vertical).
- If hay historico sectorial multi-periodo disponible (ej. DANE 2024-2025) then ancla las proyecciones en CAGR real otherwise declara "flag de riesgo metodologico" en entryBarriers y reduce el SOM para conservar margen.
- If el sector requiere licencia ambiental ANLA o sanitaria INVIMA then explicita tiempos (6-12 meses tipicos) y referencias normativas (Ley 99/1993 SINA, regimen INVIMA).
- If hay un regimen especial declarado (ZOMAC/ZF/EcoNaranja) then valida su vigencia 2026 antes de proponerlo y documentalo en entryBarriers.
</constraints>

${langInstruction}`;
}

function getCompanySizeLabel(size?: string): string {
  switch (size) {
    case 'micro': return 'Microempresa (Decreto 957/2019)';
    case 'pequena': return 'Pequena Empresa (Decreto 957/2019)';
    case 'mediana': return 'Mediana Empresa (Decreto 957/2019)';
    case 'grande': return 'Gran Empresa';
    default: return '';
  }
}
