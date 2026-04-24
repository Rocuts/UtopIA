'use client';

/**
 * Submódulo Dictámenes Especiales.
 *
 * Grid de cards con los tipos de dictámenes/certificaciones que la firma emite:
 *  - Certificación de Ingresos (Art. 594-3 ET)
 *  - Certificación de Retenciones
 *  - Informe de Utilidades Tributarias (Art. 49 ET)
 *  - Dictamen sobre Cumplimiento (Ley 222/1995)
 *  - Certificación NIIF (Grupos 1/2/3)
 *  - Reporte de partes vinculadas (Art. 260-1 ET)
 *
 * Cada card tiene un botón "Solicitar" que abre un modal simple con un form
 * de contacto/solicitud. El footer tiene un CTA "Dictamen personalizado" que
 * abre el mismo modal con el tipo pre-seleccionado como "custom".
 */

import Link from 'next/link';
import { useState, useCallback } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  FileCheck,
  ArrowLeft,
  ArrowRight,
  FileText,
  Receipt,
  Landmark,
  ScrollText,
  BadgeCheck,
  Network,
  Check,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { EliteCard } from '@/components/ui/EliteCard';
import { EliteButton } from '@/components/ui/EliteButton';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { GlassModal } from '@/components/ui/GlassModal';
import { cn } from '@/lib/utils';

// ─── Tipos de dictámenes ─────────────────────────────────────────────────────

interface DictamenType {
  id: string;
  title: { es: string; en: string };
  description: { es: string; en: string };
  norm: string;
  audience: { es: string; en: string };
  icon: LucideIcon;
  accent: 'gold' | 'wine';
}

const DICTAMEN_TYPES: DictamenType[] = [
  {
    id: 'certificacion-ingresos',
    title: {
      es: 'Certificación de Ingresos',
      en: 'Income Certification',
    },
    description: {
      es: 'Certificado formal de ingresos para personas naturales y jurídicas que no están obligadas a declarar renta.',
      en: 'Formal income certificate for individuals and legal entities not required to file income tax.',
    },
    norm: 'Art. 594-3 ET',
    audience: { es: 'Bancos, visas, arriendos', en: 'Banks, visas, leases' },
    icon: Receipt,
    accent: 'gold',
  },
  {
    id: 'certificacion-retenciones',
    title: {
      es: 'Certificación de Retenciones',
      en: 'Withholding Certification',
    },
    description: {
      es: 'Certificados de retención en la fuente por concepto de renta, IVA e ICA, emitidos conforme a la normatividad DIAN.',
      en: 'Withholding certificates for income tax, VAT, and ICA, issued under DIAN regulation.',
    },
    norm: 'Art. 378-381 ET',
    audience: { es: 'Proveedores, empleados', en: 'Vendors, employees' },
    icon: ScrollText,
    accent: 'gold',
  },
  {
    id: 'utilidades-tributarias',
    title: {
      es: 'Informe de Utilidades Tributarias',
      en: 'Tax Earnings Report',
    },
    description: {
      es: 'Cálculo formal de utilidades susceptibles de distribución no gravada (Art. 49) para determinar dividendos no constitutivos de renta.',
      en: 'Formal calculation of distributable earnings (Art. 49) to determine non-taxable dividends.',
    },
    norm: 'Art. 49 ET',
    audience: { es: 'Socios, accionistas', en: 'Shareholders' },
    icon: Landmark,
    accent: 'gold',
  },
  {
    id: 'dictamen-cumplimiento',
    title: {
      es: 'Dictamen sobre Cumplimiento',
      en: 'Compliance Opinion',
    },
    description: {
      es: 'Opinión formal sobre cumplimiento de obligaciones societarias, laborales, tributarias y contables de la sociedad.',
      en: 'Formal opinion on compliance with corporate, labor, tax, and accounting obligations.',
    },
    norm: 'Ley 222/1995',
    audience: { es: 'Junta directiva, asamblea', en: 'Board, assembly' },
    icon: BadgeCheck,
    accent: 'wine',
  },
  {
    id: 'certificacion-niif',
    title: {
      es: 'Certificación NIIF (Grupos 1/2/3)',
      en: 'IFRS Certification (Groups 1/2/3)',
    },
    description: {
      es: 'Dictamen sobre la adopción y aplicación de NIIF plenas o PYMES según el grupo regulatorio asignado por la Supersociedades.',
      en: 'Opinion on IFRS adoption and application per the group assigned by Supersociedades.',
    },
    norm: 'Decretos 2420/2015, 2483/2018',
    audience: { es: 'Supersociedades, bancos', en: 'Supersociedades, banks' },
    icon: FileText,
    accent: 'gold',
  },
  {
    id: 'partes-vinculadas',
    title: {
      es: 'Reporte de Partes Vinculadas',
      en: 'Related Parties Report',
    },
    description: {
      es: 'Informe formal de operaciones con partes vinculadas para fines de precios de transferencia y revelaciones NIIF (NIC 24).',
      en: 'Formal report of related-party transactions for transfer pricing and IFRS disclosures (IAS 24).',
    },
    norm: 'Art. 260-1 ET · NIC 24',
    audience: { es: 'DIAN, auditores', en: 'DIAN, auditors' },
    icon: Network,
    accent: 'wine',
  },
];

// ─── Componente ──────────────────────────────────────────────────────────────

export default function DictamenesPage() {
  const { language } = useLanguage();
  const shouldReduce = useReducedMotion();

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedDictamen, setSelectedDictamen] = useState<DictamenType | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const openRequest = useCallback((d: DictamenType) => {
    setSelectedDictamen(d);
    setCustomMode(false);
    setSubmitted(false);
    setModalOpen(true);
  }, []);

  const openCustom = useCallback(() => {
    setSelectedDictamen(null);
    setCustomMode(true);
    setSubmitted(false);
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    // Dejamos el estado para que re-abrir muestre lo último si el usuario cierra
    // por accidente. Se resetea en el siguiente openRequest/openCustom.
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Este submit es placeholder — en producción integrar con un endpoint de
    // solicitud / email. Por ahora mostramos confirmación inline.
    setSubmitted(true);
  }, []);

  return (
    <div
      data-lenis-prevent
      className="min-h-full w-full overflow-y-auto bg-n-1000"
    >
      <div className="mx-auto w-full max-w-[1280px] px-5 md:px-8 py-8 md:py-12 flex flex-col gap-8">
        {/* Back link */}
        <Link
          href="/workspace/verdad"
          className="inline-flex items-center gap-2 text-xs uppercase tracking-eyebrow text-n-500 hover:text-gold-600 transition-colors w-fit"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          {language === 'es' ? 'Volver a La Verdad' : 'Back to The Truth'}
        </Link>

        {/* Hero */}
        <SectionHeader
          eyebrow={
            language === 'es' ? 'Informes de cumplimiento' : 'Compliance reports'
          }
          title={language === 'es' ? 'Dictámenes Especiales' : 'Special Opinions'}
          subtitle={
            language === 'es'
              ? 'Certificaciones formales para socios, bancos, inversionistas y DIAN'
              : 'Formal certifications for partners, banks, investors and DIAN'
          }
          align="left"
          accent="gold"
          divider
        />

        <EliteCard variant="glass" padding="md">
          <EliteCard.Body>
            <p className="text-base leading-relaxed text-n-300">
              {language === 'es'
                ? 'Cada dictamen es emitido con fe pública por un Contador Público inscrito y se entrega firmado digitalmente con todos los soportes normativos requeridos. Los tiempos de respuesta varían entre 24 horas y 5 días hábiles según la profundidad del análisis.'
                : 'Every opinion is issued under public trust by a registered Public Accountant and delivered digitally signed with all required regulatory support. Turnaround ranges from 24 hours to 5 business days depending on analysis depth.'}
            </p>
          </EliteCard.Body>
        </EliteCard>

        {/* Grid de dictámenes */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {DICTAMEN_TYPES.map((d, idx) => {
            const Icon = d.icon;
            return (
              <motion.div
                key={d.id}
                initial={shouldReduce ? undefined : { opacity: 0, y: 12 }}
                whileInView={shouldReduce ? undefined : { opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '0px 0px -10% 0px' }}
                transition={{ delay: idx * 0.05, duration: 0.4 }}
                className="h-full"
              >
                <EliteCard
                  variant="glass"
                  padding="lg"
                  className="h-full flex flex-col gap-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div
                      aria-hidden="true"
                      className={cn(
                        'shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-md',
                        d.accent === 'gold'
                          ? 'bg-[rgb(var(--color-gold-500-rgb)_/_0.14)] text-gold-600'
                          : 'bg-[rgba(114,47,55,0.18)] text-area-escudo',
                      )}
                    >
                      <Icon className="w-[22px] h-[22px]" strokeWidth={1.6} />
                    </div>
                    <span
                      className={cn(
                        'text-xs uppercase tracking-[0.2em] font-medium px-2 py-0.5 rounded-full',
                        d.accent === 'gold'
                          ? 'bg-[rgb(var(--color-gold-500-rgb)_/_0.10)] text-gold-500'
                          : 'bg-[rgba(114,47,55,0.16)] text-area-escudo',
                      )}
                    >
                      {d.norm}
                    </span>
                  </div>

                  <div className="flex flex-col gap-1.5 flex-1">
                    <h3 className="font-serif-elite text-xl leading-tight text-n-100">
                      {language === 'es' ? d.title.es : d.title.en}
                    </h3>
                    <p className="text-sm leading-relaxed text-n-500 font-light">
                      {language === 'es' ? d.description.es : d.description.en}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 text-xs uppercase tracking-eyebrow text-n-500">
                    <span className="text-gold-500">
                      {language === 'es' ? 'Destinatario:' : 'Audience:'}
                    </span>
                    <span className="text-n-300 normal-case tracking-normal">
                      {language === 'es' ? d.audience.es : d.audience.en}
                    </span>
                  </div>

                  <div className="pt-4 mt-auto border-t border-[rgb(var(--color-gold-500-rgb)_/_0.14)]">
                    <EliteButton
                      variant="secondary"
                      size="md"
                      className="w-full justify-center"
                      onClick={() => openRequest(d)}
                      rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                    >
                      {language === 'es' ? 'Solicitar' : 'Request'}
                    </EliteButton>
                  </div>
                </EliteCard>
              </motion.div>
            );
          })}
        </div>

        {/* CTA dictamen personalizado */}
        <EliteCard variant="glass" padding="lg">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="flex flex-col gap-2 max-w-2xl">
              <div className="flex items-center gap-2">
                <FileCheck
                  className="w-4 h-4 text-gold-600"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <span className="uppercase tracking-eyebrow text-xs text-gold-500 font-medium">
                  {language === 'es' ? 'Dictamen personalizado' : 'Custom opinion'}
                </span>
              </div>
              <h3 className="font-serif-elite text-xl leading-tight text-n-100">
                {language === 'es'
                  ? '¿Necesita un dictamen fuera del catálogo?'
                  : 'Need an opinion outside the catalog?'}
              </h3>
              <p className="text-sm leading-relaxed text-n-500 font-light">
                {language === 'es'
                  ? 'Emitimos certificaciones a medida para requerimientos de DIAN, contratantes públicos, aseguradoras, entidades financieras o procesos judiciales.'
                  : 'We issue tailored certifications for DIAN requests, public contractors, insurers, financial entities, or legal proceedings.'}
              </p>
            </div>
            <EliteButton
              variant="primary"
              size="lg"
              elevated
              onClick={openCustom}
              rightIcon={<ArrowRight className="w-4 h-4" />}
            >
              {language === 'es'
                ? 'Solicitar personalizado'
                : 'Request custom'}
            </EliteButton>
          </div>
        </EliteCard>
      </div>

      {/* Modal de solicitud */}
      <GlassModal
        open={modalOpen}
        onClose={closeModal}
        size="md"
        title={
          customMode
            ? language === 'es'
              ? 'Dictamen personalizado'
              : 'Custom opinion'
            : selectedDictamen
              ? language === 'es'
                ? selectedDictamen.title.es
                : selectedDictamen.title.en
              : undefined
        }
        description={
          submitted
            ? undefined
            : language === 'es'
              ? 'Complete los datos; le responderemos en menos de 24 horas.'
              : 'Fill the form; we will respond within 24 hours.'
        }
      >
        {submitted ? (
          <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
            <div
              aria-hidden="true"
              className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(34,197,94,0.14)] text-success-light"
            >
              <Check className="w-7 h-7" strokeWidth={2} />
            </div>
            <h4 className="font-serif-elite text-xl text-n-100 leading-tight">
              {language === 'es' ? 'Solicitud enviada' : 'Request submitted'}
            </h4>
            <p className="text-sm text-n-500 max-w-sm leading-relaxed">
              {language === 'es'
                ? 'Un contador público certificado revisará su caso y le enviará una propuesta técnica y de honorarios.'
                : 'A certified Public Accountant will review your case and send a technical and fee proposal.'}
            </p>
            <EliteButton variant="secondary" size="md" onClick={closeModal}>
              {language === 'es' ? 'Cerrar' : 'Close'}
            </EliteButton>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {customMode && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-eyebrow text-n-500 font-medium">
                  {language === 'es' ? 'Tipo de dictamen' : 'Opinion type'}
                </label>
                <input
                  required
                  type="text"
                  className="rounded-[8px] bg-[rgba(10,10,10,0.6)] border border-[rgb(var(--color-gold-500-rgb)_/_0.22)] px-3 py-2.5 text-base text-n-100 placeholder:text-n-500 focus:outline-none focus:border-gold-500"
                  placeholder={
                    language === 'es'
                      ? 'Describa brevemente el dictamen solicitado'
                      : 'Briefly describe the requested opinion'
                  }
                />
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-eyebrow text-n-500 font-medium">
                  {language === 'es' ? 'Razón social' : 'Legal name'}
                </label>
                <input
                  required
                  type="text"
                  className="rounded-[8px] bg-[rgba(10,10,10,0.6)] border border-[rgb(var(--color-gold-500-rgb)_/_0.22)] px-3 py-2.5 text-base text-n-100 focus:outline-none focus:border-gold-500"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-eyebrow text-n-500 font-medium">
                  NIT
                </label>
                <input
                  required
                  type="text"
                  className="rounded-[8px] bg-[rgba(10,10,10,0.6)] border border-[rgb(var(--color-gold-500-rgb)_/_0.22)] px-3 py-2.5 text-base text-n-100 focus:outline-none focus:border-gold-500"
                  placeholder="900.123.456-7"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs uppercase tracking-eyebrow text-n-500 font-medium">
                {language === 'es' ? 'Correo de contacto' : 'Contact email'}
              </label>
              <input
                required
                type="email"
                className="rounded-[8px] bg-[rgba(10,10,10,0.6)] border border-[rgb(var(--color-gold-500-rgb)_/_0.22)] px-3 py-2.5 text-base text-n-100 focus:outline-none focus:border-gold-500"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs uppercase tracking-eyebrow text-n-500 font-medium">
                {language === 'es' ? 'Contexto adicional' : 'Additional context'}
              </label>
              <textarea
                rows={3}
                className="rounded-[8px] bg-[rgba(10,10,10,0.6)] border border-[rgb(var(--color-gold-500-rgb)_/_0.22)] px-3 py-2.5 text-base text-n-100 placeholder:text-n-500 focus:outline-none focus:border-gold-500 resize-none"
                placeholder={
                  language === 'es'
                    ? 'Propósito, destinatario, período a certificar, etc.'
                    : 'Purpose, recipient, period to certify, etc.'
                }
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <EliteButton variant="ghost" size="md" onClick={closeModal} type="button">
                {language === 'es' ? 'Cancelar' : 'Cancel'}
              </EliteButton>
              <EliteButton
                variant="primary"
                size="md"
                elevated
                type="submit"
                rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
              >
                {language === 'es' ? 'Enviar solicitud' : 'Submit request'}
              </EliteButton>
            </div>
          </form>
        )}
      </GlassModal>
    </div>
  );
}
