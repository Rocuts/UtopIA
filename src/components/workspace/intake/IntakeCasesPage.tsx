'use client';

/**
 * IntakeCasesPage — /workspace/intake ("Intake · Nuevo caso").
 *
 * Diseño del handoff "Intake.html" cableado al flujo REAL:
 * grid de 11 tipos de caso (tintados por área Escudo/Valor/Verdad/Futuro);
 * al elegir uno se abre el intake real del workspace
 * (`openIntakeForType(caseType)` → IntakeModal con el formulario verdadero
 * que lanza el pipeline correspondiente).
 *
 * El prototipo simulaba un formulario propio y un número de caso aleatorio;
 * aquí el caso se crea de verdad a través del mismo flujo que usa el resto
 * de la app (NiifEliteButton, CommandPalette, áreas) — cero duplicación de
 * formularios y cero teatro.
 */

import Link from 'next/link';
import {
  ArrowLeft,
  ArrowLeftRight,
  Banknote,
  ClipboardCheck,
  FileSearch,
  FolderPlus,
  Gem,
  GitCompare,
  LineChart,
  Route,
  Shield,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { WorkspaceFX } from '@/components/workspace/WorkspaceFX';
import type { CaseType } from '@/types/platform';

// ─── Áreas ───────────────────────────────────────────────────────────────────

type AreaId = 'escudo' | 'valor' | 'verdad' | 'futuro';

interface AreaDef {
  name: string;
  color: string;
}

const AREAS: Record<AreaId, AreaDef> = {
  escudo: { name: 'El Escudo', color: '#A83838' },
  valor: { name: 'El Valor', color: '#B8934A' },
  verdad: { name: 'La Verdad', color: '#3D6B7E' },
  futuro: { name: 'El Futuro', color: '#5A7F7A' },
};

// ─── Casos (cada uno mapea a un CaseType real con pipeline) ─────────────────

interface CaseDef {
  id: string;
  title: string;
  icon: LucideIcon;
  area: AreaId;
  desc: string;
  caseType: CaseType;
}

const CASES: CaseDef[] = [
  { id: 'defensa', title: 'Defensa ante la DIAN', icon: Shield, area: 'escudo', desc: 'Requerimientos, pliegos de cargos y liquidaciones oficiales.', caseType: 'dian_defense' },
  { id: 'devolucion', title: 'Devolución de saldos', icon: Banknote, area: 'escudo', desc: 'Recupere saldos a favor en renta o IVA.', caseType: 'tax_refund' },
  { id: 'due', title: 'Due diligence', icon: FileSearch, area: 'valor', desc: 'Auditoría preventiva para inversión, fusión o venta.', caseType: 'due_diligence' },
  { id: 'inteligencia', title: 'Inteligencia financiera', icon: LineChart, area: 'valor', desc: 'Rentabilidad, costos, flujo de caja y escenarios.', caseType: 'financial_intel' },
  { id: 'niif', title: 'Reporte NIIF Elite', icon: Sparkles, area: 'valor', desc: 'Estados financieros bajo NIIF generados por IA.', caseType: 'niif_report' },
  { id: 'planeacion', title: 'Planeación tributaria', icon: Route, area: 'escudo', desc: 'Optimización lícita de su carga fiscal.', caseType: 'tax_planning' },
  { id: 'precios', title: 'Precios de transferencia', icon: ArrowLeftRight, area: 'escudo', desc: 'Operaciones con vinculados del exterior.', caseType: 'transfer_pricing' },
  { id: 'valoracion', title: 'Valoración de empresa', icon: Gem, area: 'valor', desc: 'DCF y múltiplos de mercado.', caseType: 'business_valuation' },
  { id: 'auditoria', title: 'Auditoría fiscal', icon: ShieldCheck, area: 'verdad', desc: 'Dictamen de revisoría fiscal tipo NIA 700.', caseType: 'fiscal_audit_opinion' },
  { id: 'conciliacion', title: 'Conciliación fiscal', icon: GitCompare, area: 'verdad', desc: 'Cruce entre contabilidad y declaraciones.', caseType: 'tax_reconciliation' },
  { id: 'factibilidad', title: 'Estudio de factibilidad', icon: ClipboardCheck, area: 'futuro', desc: 'Viabilidad de un nuevo proyecto o inversión.', caseType: 'feasibility_study' },
];

// ─── Página ──────────────────────────────────────────────────────────────────

export function IntakeCasesPage() {
  const { openIntakeForType } = useWorkspace();

  return (
    <div className="relative min-h-full w-full">
      <WorkspaceFX />

      <div className="relative z-[2] mx-auto w-full max-w-5xl px-4 pt-5 pb-16 sm:px-6 lg:px-8">
        {/* Back link */}
        <Link
          href="/workspace"
          className="inline-flex items-center gap-1.5 rounded-sm text-sm text-n-600 transition-colors hover:text-n-1000 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          Volver al Comando
        </Link>

        {/* Page head */}
        <div className="py-5">
          <div className="mb-3 inline-flex items-center gap-2.5 font-bold text-gold-600">
            <span className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-sm bg-gradient-to-br from-gold-500 to-gold-600 text-white">
              <FolderPlus className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <span className="text-xs uppercase tracking-eyebrow">Intake · Nuevo caso</span>
          </div>
          <h1 className="font-serif-elite text-[clamp(2rem,3.6vw,2.6rem)] font-medium leading-tight tracking-tight text-n-1000">
            ¿Qué caso necesita abrir?
          </h1>
          <p className="mt-2 max-w-[62ch] text-[15px] text-n-600">
            Elija el tipo de caso. Se abre el formulario correspondiente y el
            caso se enruta al área que lo trabaja.
          </p>
        </div>

        {/* Grid de casos → abre el intake real */}
        <div className="grid grid-cols-1 gap-3.5 min-[560px]:grid-cols-2 min-[860px]:grid-cols-3">
          {CASES.map((c) => {
            const a = AREAS[c.area];
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => openIntakeForType(c.caseType)}
                className="group relative overflow-hidden rounded-xl border border-n-200 bg-n-0 p-5 text-left transition-all duration-200 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2"
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = a.color;
                  e.currentTarget.style.boxShadow = `0 20px 38px -22px color-mix(in srgb, ${a.color} 55%, transparent)`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '';
                  e.currentTarget.style.boxShadow = '';
                }}
              >
                {/* Barra de acento izquierda (hover) */}
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-0 top-0 w-1 origin-top scale-y-0 transition-transform duration-200 group-hover:scale-y-100"
                  style={{ background: a.color }}
                />
                <span
                  className="mb-3.5 inline-flex h-[42px] w-[42px] items-center justify-center rounded-md"
                  style={{
                    background: `color-mix(in srgb, ${a.color} 14%, transparent)`,
                    color: a.color,
                  }}
                >
                  <Icon className="h-[21px] w-[21px]" strokeWidth={1.75} aria-hidden="true" />
                </span>
                <div className="text-[15px] font-semibold text-n-1000">{c.title}</div>
                <div className="mt-1 text-sm leading-snug text-n-600">{c.desc}</div>
                <div
                  className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em]"
                  style={{ color: a.color }}
                >
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: a.color }}
                  />
                  {a.name}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
