'use client';

import type { Metadata } from 'next';
import { ShieldCheck, Terminal } from 'lucide-react';

// Panel administrativo separado del workspace. NO indexar.
// metadata export is kept in a separate server wrapper; this file is 'use client'
// so metadata is defined in layout or a parallel server component.

const LOG_ENTRIES = [
  { time: '14:32:08', actor: 'agent.fiscal',  action: 'Generó respuesta defensa DIAN',        status: 'ok',   code: '200'   },
  { time: '14:31:54', actor: 'user.YO',        action: 'Abrió pipeline NIIF Elite',            status: 'ok',   code: '200'   },
  { time: '14:30:12', actor: 'agent.auditor',  action: 'Dictamen control interno',             status: 'ok',   code: '200'   },
  { time: '14:28:47', actor: 'erp.siigo',      action: 'Sync saldos · 1.204 movimientos',     status: 'ok',   code: '200'   },
  { time: '14:25:03', actor: 'agent.valor',    action: 'Recalculó DCF — Grupo 2tres',          status: 'warn', code: 'retry' },
  { time: '14:22:19', actor: 'sentinel',       action: 'Disparó alerta vencimiento renta',    status: 'ok',   code: '200'   },
  { time: '14:19:55', actor: 'user.YO',        action: 'Exportó libro mayor (XLSX)',           status: 'ok',   code: '200'   },
  { time: '14:15:41', actor: 'ocr.vision',     action: 'Lectura factura fallida',              status: 'err',  code: '422'   },
] as const;

const SERVICES = [
  { name: 'API Gateway',           uptime: '99,98%', status: 'ok'   },
  { name: 'Motor de agentes IA',   uptime: '99,95%', status: 'ok'   },
  { name: 'Supabase · Postgres',   uptime: '100%',   status: 'ok'   },
  { name: 'Streaming SSE',         uptime: '99,9%',  status: 'ok'   },
  { name: 'OCR · Google Vision',   uptime: '98,2%',  status: 'warn' },
  { name: 'Conectores ERP',        uptime: '99,7%',  status: 'ok'   },
] as const;

type StatusKind = 'ok' | 'warn' | 'err';

function statusDotClass(s: StatusKind) {
  if (s === 'ok')   return 'bg-[#4F7A4C] shadow-[0_0_8px_#4F7A4C]';
  if (s === 'warn') return 'bg-[#C48A2E] shadow-[0_0_8px_#C48A2E]';
  return 'bg-[#A83838] shadow-[0_0_8px_#A83838]';
}

function statusTextClass(s: StatusKind) {
  if (s === 'ok')   return 'text-[#4F7A4C]';
  if (s === 'warn') return 'text-[#C48A2E]';
  return 'text-[#A83838]';
}

export default function AdminPage() {
  return (
    <main className="min-h-screen bg-n-50 px-6 py-8 md:px-10">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Back link */}
        <a
          href="/workspace"
          className="inline-flex items-center gap-2 text-n-600 hover:text-n-1000 text-sm transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Volver al Comando
        </a>

        {/* Page header */}
        <div className="pb-2">
          <h1 className="flex items-center gap-3 font-display font-medium text-[clamp(2rem,3.6vw,2.6rem)] text-n-1000 tracking-tight">
            <span className="w-9 h-9 rounded-lg grid place-items-center bg-gold-500/10 text-gold-500 flex-shrink-0">
              <Terminal className="w-5 h-5" />
            </span>
            Consola de administración
          </h1>
          <p className="mt-1.5 text-n-600 text-sm">
            Telemetría, observabilidad y registro de actividad del orquestador 1+1.
          </p>
        </div>

        {/* Token auth bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-[#4F7A4C]/[0.08] border border-[#4F7A4C]/30">
          <ShieldCheck className="w-[18px] h-[18px] text-[#4F7A4C] flex-shrink-0" />
          <span className="text-sm font-semibold text-n-800">
            Acceso autorizado · token de servicio válido
          </span>
          <span className="ml-auto font-mono text-xs text-n-600 bg-n-100 px-2.5 py-1 rounded-md">
            tok_1p1_live_•••••8f2a
          </span>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <StatCard label="Solicitudes · 24 h" value="18.420" detail="▲ 6,2% vs. ayer" detailColor="text-[#4F7A4C]" />
          <StatCard label="Latencia p95"        value="842"    unit="ms" detail="Streaming SSE estable" detailColor="text-n-500" />
          <StatCard label="Agentes activos"     value="7"      detail="Fiscal · Contable · Auditor…" detailColor="text-n-500" />
          <StatCard label="Tasa de error"       value="0,18"   unit="%" detail="Dentro de SLA" detailColor="text-[#4F7A4C]" />
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.7fr_1fr] gap-5 items-start">

          {/* Activity log */}
          <div className="bg-n-0 border border-n-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-n-100">
              <span className="font-semibold text-n-900 text-sm">Registro de actividad</span>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-[#4F7A4C]/10 text-[#4F7A4C]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#4F7A4C] animate-pulse" />
                En vivo
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {['Hora', 'Actor', 'Acción', 'Estado'].map((h) => (
                      <th
                        key={h}
                        className="text-left text-[10px] uppercase tracking-widest text-n-500 font-bold px-3.5 pb-3 pt-3"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {LOG_ENTRIES.map((row, i) => (
                    <tr key={i} className="border-t border-n-100 hover:bg-gold-500/5 transition-colors">
                      <td className="px-3.5 py-3 font-mono text-xs text-n-600 whitespace-nowrap">{row.time}</td>
                      <td className="px-3.5 py-3 font-mono text-xs text-n-700 whitespace-nowrap">{row.actor}</td>
                      <td className="px-3.5 py-3 text-sm text-n-900 font-medium">{row.action}</td>
                      <td className={`px-3.5 py-3 font-mono text-xs whitespace-nowrap ${statusTextClass(row.status as StatusKind)}`}>
                        ● {row.code}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Services status */}
          <div className="bg-n-0 border border-n-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-n-100">
              <span className="font-semibold text-n-900 text-sm">Estado de servicios</span>
            </div>
            <div className="px-4 py-2">
              {SERVICES.map((svc, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 py-3.5 border-t border-n-100 first:border-t-0"
                >
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass(svc.status as StatusKind)}`}
                  />
                  <span className="flex-1 text-sm text-n-900 font-medium">{svc.name}</span>
                  <span className="font-mono text-xs text-n-500">{svc.uptime}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: string;
  unit?: string;
  detail: string;
  detailColor: string;
}

function StatCard({ label, value, unit, detail, detailColor }: StatCardProps) {
  return (
    <div className="bg-n-0 border border-n-200 rounded-xl p-5">
      <div className="text-[10px] uppercase tracking-widest text-n-500 font-semibold">{label}</div>
      <div className="font-mono font-semibold text-3xl text-n-1000 mt-2 leading-none">
        {value}
        {unit && <span className="text-sm text-n-500 ml-1">{unit}</span>}
      </div>
      <div className={`text-xs mt-1.5 ${detailColor}`}>{detail}</div>
    </div>
  );
}
