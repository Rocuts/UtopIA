'use client';

/**
 * /workspace/escudo/precios-transferencia — Submódulo Precios de Transferencia.
 *
 * Portada de producto para `/api/transfer-pricing` (pipeline 3 agentes:
 * Analista TP → Comparables → Documentación). Abre IntakeModal con
 * `caseType='transfer_pricing'` que renderiza GenericPipelineIntake.
 *
 * Cobertura normativa: Arts. 260-1 a 260-11 E.T., Decreto 2120/2017, 6 métodos,
 * Formato 1125 DIAN.
 */

import { useCallback } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import {
  Network,
  ChevronLeft,
  Users2,
  ScanSearch,
  FileSpreadsheet,
  ArrowRight,
  Globe2,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cn } from '@/lib/utils';
import { EliteButton } from '@/components/ui/EliteButton';
import { EliteCard } from '@/components/ui/EliteCard';
import { SectionHeader } from '@/components/ui/SectionHeader';

export default function PreciosTransferenciaPage() {
  const { t, language } = useLanguage();
  const reduced = useReducedMotion();
  const { openIntakeForType } = useWorkspace();

  const copy = t.elite.areas.escudo.submodules.preciosTransferencia;

  const handleStart = useCallback(() => {
    openIntakeForType('transfer_pricing');
  }, [openIntakeForType]);

  const methods =
    language === 'es'
      ? [
          { code: 'PC', name: 'Precio Comparable no Controlado' },
          { code: 'PR', name: 'Precio de Reventa' },
          { code: 'CN', name: 'Costo Adicionado' },
          { code: 'PD', name: 'Partición de Utilidades' },
          { code: 'ML', name: 'Márgenes Transaccionales' },
          { code: 'MUT', name: 'Método de Utilidad Transaccional' },
        ]
      : [
          { code: 'CUP', name: 'Comparable Uncontrolled Price' },
          { code: 'RPM', name: 'Resale Price Method' },
          { code: 'CPM', name: 'Cost Plus Method' },
          { code: 'PSM', name: 'Profit Split Method' },
          { code: 'TNMM', name: 'Transactional Net Margin Method' },
          { code: 'TPM', name: 'Transactional Profit Method' },
        ];

  const agents =
    language === 'es'
      ? [
          {
            num: '01',
            icon: Users2,
            title: 'Analista TP',
            body:
              'Caracteriza cada operación vinculada: función, activo y riesgo. Determina el método más apropiado bajo las reglas OCDE y el E.T. colombiano.',
          },
          {
            num: '02',
            icon: ScanSearch,
            title: 'Análisis de Comparables',
            body:
              'Búsqueda y depuración de comparables (propias e independientes). Cálculo del rango intercuartil y determinación del punto medio aplicable.',
          },
          {
            num: '03',
            icon: FileSpreadsheet,
            title: 'Documentación DIAN',
            body:
              'Redacción del Informe Local, Master File y Formato 1125. Cumple los estándares del Decreto 2120/2017 y resoluciones DIAN vigentes.',
          },
        ]
      : [
          {
            num: '01',
            icon: Users2,
            title: 'TP Analyst',
            body:
              'Characterizes each related-party transaction: function, asset, risk. Determines the most appropriate method under OECD rules and the Colombian Tax Statute.',
          },
          {
            num: '02',
            icon: ScanSearch,
            title: 'Comparable Analysis',
            body:
              'Search and curation of comparables (internal and external). Interquartile range and median point determination.',
          },
          {
            num: '03',
            icon: FileSpreadsheet,
            title: 'DIAN Documentation',
            body:
              'Drafts the Local File, Master File, and Form 1125. Complies with Decree 2120/2017 standards and current DIAN resolutions.',
          },
        ];

  const fadeItem = (i: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 12 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.45,
            delay: 0.05 + i * 0.07,
            ease: [0.16, 1, 0.3, 1] as const,
          },
        };

  return (
    <div
      data-theme="elite"
      className="relative w-full min-h-full overflow-y-auto bg-n-1000 text-n-100"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute top-[10%] -left-[10%] w-[500px] h-[500px] rounded-full blur-[120px] opacity-25"
          style={{
            background:
              'radial-gradient(circle, rgba(114,47,55,0.35) 0%, rgba(114,47,55,0) 70%)',
          }}
        />
      </div>

      <div className="relative z-[1] max-w-[1240px] mx-auto px-6 md:px-10 pt-6 pb-24">
        {/* Breadcrumb */}
        <motion.div {...fadeItem(0)} className="mb-6">
          <Link
            href="/workspace/escudo"
            prefetch={false}
            className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-n-500 hover:text-gold-500 transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            {language === 'es' ? 'El Escudo' : 'The Shield'}
          </Link>
        </motion.div>

        {/* Hero */}
        <motion.div {...fadeItem(1)} className="mb-10 flex items-start gap-5">
          <div
            aria-hidden="true"
            className="shrink-0 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-[rgba(114,47,55,0.18)] text-area-escudo glow-wine"
          >
            <Network className="h-7 w-7" strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
            <SectionHeader
              eyebrow={language === 'es' ? 'Operaciones Vinculadas' : 'Related-Party Transactions'}
              title={copy.title}
              subtitle={copy.description}
              align="left"
              accent="wine"
            />
          </div>
        </motion.div>

        {/* Narrativa */}
        <motion.div
          {...fadeItem(2)}
          className="max-w-3xl space-y-5 text-md leading-relaxed text-n-300 mb-12"
        >
          <p>
            {language === 'es'
              ? 'Cuando una compañía colombiana opera con vinculadas del exterior — o con empresas en zonas francas, regímenes tributarios especiales o paraísos fiscales — debe demostrar a la DIAN que sus precios respetan el principio de plena competencia. La ausencia o debilidad de esa documentación es uno de los focos más agresivos de fiscalización en 2026.'
              : 'When a Colombian company transacts with foreign related parties — or with entities in free-trade zones, special tax regimes, or low-tax jurisdictions — it must prove to DIAN that its prices comply with the armʼs length principle. Missing or weak documentation is one of the most aggressive audit targets in 2026.'}
          </p>
          <p>
            {language === 'es'
              ? 'Nuestro motor de Precios de Transferencia aplica los 6 métodos reconocidos por la OCDE y adoptados por el Decreto 2120/2017 (Arts. 260-1 a 260-11 E.T.), construye el análisis funcional (FAR), busca comparables de mercado y genera el Informe Local, Master File y Formato 1125 en el formato exacto que exige la DIAN.'
              : 'Our Transfer Pricing engine applies the 6 OECD-recognized methods adopted by Decree 2120/2017 (Arts. 260-1 to 260-11 T.S.), builds the functional analysis (FAR), searches for market comparables, and produces the Local File, Master File, and Form 1125 in the exact format DIAN requires.'}
          </p>
          <p>
            {language === 'es'
              ? 'El resultado es documentación defensiva lista para presentar — no solo un cálculo. Si la DIAN pregunta, usted tiene evidencia técnica auditable en horas, no en semanas.'
              : 'The output is defense-ready documentation — not just a calculation. If DIAN asks, you have auditable technical evidence in hours, not weeks.'}
          </p>
        </motion.div>

        {/* Methods strip */}
        <motion.div
          {...fadeItem(3)}
          className="mb-12 rounded-xl glass-elite p-5 md:p-6"
          aria-label={language === 'es' ? 'Métodos de precios de transferencia' : 'Transfer pricing methods'}
        >
          <div className="flex items-center gap-2 mb-3">
            <Globe2 className="h-4 w-4 text-gold-500" strokeWidth={2} aria-hidden="true" />
            <span className="uppercase tracking-eyebrow text-xs font-medium text-gold-500">
              {language === 'es' ? '6 métodos OCDE' : '6 OECD methods'}
            </span>
          </div>
          <ul role="list" className="grid gap-2.5 grid-cols-2 md:grid-cols-3">
            {methods.map((m) => (
              <li
                key={m.code}
                className="flex items-baseline gap-2 text-sm text-n-300"
              >
                <span className="font-semibold text-gold-500 tabular-nums w-10 shrink-0">
                  {m.code}
                </span>
                <span className="text-n-500 leading-snug">{m.name}</span>
              </li>
            ))}
          </ul>
        </motion.div>

        {/* Agents grid */}
        <motion.div {...fadeItem(4)} className="grid gap-4 md:grid-cols-3 mb-12">
          {agents.map((agent) => (
            <EliteCard key={agent.num} variant="glass" padding="md" hover="none">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span
                    aria-hidden="true"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[rgba(114,47,55,0.18)] text-area-escudo"
                  >
                    <agent.icon className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <span className="font-serif-elite text-xl text-n-600 tabular-nums">
                    {agent.num}
                  </span>
                </div>
                <h3 className="font-serif-elite text-lg leading-tight font-normal text-n-100">
                  {agent.title}
                </h3>
                <p className="text-sm leading-relaxed text-n-500">{agent.body}</p>
              </div>
            </EliteCard>
          ))}
        </motion.div>

        {/* CTA */}
        <motion.div
          {...fadeItem(5)}
          className={cn(
            'relative overflow-hidden rounded-[16px] p-6 md:p-8',
            'glass-elite-elevated border-elite-gold glow-wine',
          )}
        >
          <div
            aria-hidden="true"
            className="absolute -right-24 -top-24 w-[320px] h-[320px] rounded-full blur-[110px] opacity-40"
            style={{
              background:
                'radial-gradient(circle, rgba(114,47,55,0.45) 0%, rgba(114,47,55,0) 70%)',
            }}
          />
          <div className="relative z-[1] flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div className="flex items-start gap-3 md:max-w-xl">
              <span
                aria-hidden="true"
                className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-md bg-[rgba(114,47,55,0.2)] text-area-escudo"
              >
                <Network className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <div>
                <h3 className="font-serif-elite text-xl leading-tight text-n-100 mb-1.5">
                  {language === 'es'
                    ? 'Analice sus operaciones vinculadas'
                    : 'Analyze your related-party transactions'}
                </h3>
                <p className="text-sm leading-relaxed text-n-500">
                  {language === 'es'
                    ? 'Indique operaciones, vinculadas y flujos. Recibirá el estudio técnico y el Formato 1125 listos para la DIAN.'
                    : 'List transactions, related parties, and flows. Receive the technical study and Form 1125 ready for DIAN.'}
                </p>
              </div>
            </div>
            <EliteButton
              variant="wine"
              size="lg"
              onClick={handleStart}
              rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={2} />}
              glow
            >
              {language === 'es' ? 'Analizar operaciones vinculadas' : 'Analyze related parties'}
            </EliteButton>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
