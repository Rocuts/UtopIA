'use client';

/**
 * ActivityLogViewer — visor unificado de actividad del sistema.
 *
 * Consume GET /api/admin/activity (feed unificado: system_activity_log +
 * agent_telemetry + notification_log + tax_engine_audits) con el token admin
 * en el header. Filtros por ventana, severidad, categoría, fuente y texto;
 * stats agregadas, tabla expandible y paginación.
 *
 * NOTA Lenis: el root envuelve la app con ReactLenis (smooth scroll). El
 * contenedor con scroll interno lleva `data-lenis-prevent` o el wheel muere.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bug,
  ChevronDown,
  Info,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Tipos (espejo de la respuesta del endpoint) ────────────────────────────

type Level = 'debug' | 'info' | 'warn' | 'error';
type Source = 'activity' | 'agent' | 'notification' | 'tax';

interface ActivityEvent {
  id: string;
  source: Source;
  ts: string;
  category: string;
  action: string;
  level: Level;
  message: string;
  workspaceId: string | null;
  durationMs: number | null;
  metadata: Record<string, unknown> | null;
}

interface ActivityResponse {
  events: ActivityEvent[];
  total: number;
  windowHours: number;
  stats: { byLevel: Record<string, number>; byCategory: Record<string, number> };
  sourcesQueried: Source[];
  page: { limit: number; offset: number; hasMore: boolean };
  availableSources: Source[];
  availableLevels: Level[];
}

// ── Constantes de UI ────────────────────────────────────────────────────────

const WINDOWS: { label: string; hours: number }[] = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
];

const LEVEL_META: Record<Level, { label: string; cls: string; icon: typeof Info }> = {
  error: { label: 'Error', cls: 'text-danger bg-danger/10 border-danger/30', icon: AlertCircle },
  warn: { label: 'Aviso', cls: 'text-warning bg-warning/10 border-warning/30', icon: AlertTriangle },
  info: { label: 'Info', cls: 'text-info bg-info/10 border-info/30', icon: Info },
  debug: { label: 'Debug', cls: 'text-n-600 bg-n-100 border-n-300', icon: Bug },
};

const LEVELS: Level[] = ['error', 'warn', 'info', 'debug'];

const SOURCE_LABEL: Record<Source, string> = {
  activity: 'Sistema',
  agent: 'Agentes IA',
  notification: 'Notificaciones',
  tax: 'Motor tributario',
};

const CATEGORY_LABEL: Record<string, string> = {
  api: 'API',
  agent: 'Agentes',
  financial: 'Financiero',
  accounting: 'Contabilidad',
  tax: 'Tributario',
  erp: 'ERP',
  notification: 'Notificaciones',
  auth: 'Auth',
  security: 'Seguridad',
  system: 'Sistema',
};

const PAGE_SIZE = 100;
const AUTO_REFRESH_MS = 15_000;

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtAbsolute(ts: string): string {
  try {
    return new Date(ts).toLocaleString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return ts;
  }
}

function fmtRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

// ── Componente principal ─────────────────────────────────────────────────────

export function ActivityLogViewer({
  token,
  onLogout,
}: {
  token: string;
  onLogout: () => void;
}) {
  const [hours, setHours] = useState(24);
  const [levels, setLevels] = useState<Level[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Debounce de la búsqueda libre.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(id);
  }, [q]);

  // Reset a la primera página cuando cambia cualquier filtro.
  useEffect(() => {
    setPage(0);
  }, [hours, levels, categories, sources, debouncedQ]);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set('hours', String(hours));
    p.set('limit', String(PAGE_SIZE));
    p.set('offset', String(page * PAGE_SIZE));
    if (levels.length) p.set('levels', levels.join(','));
    if (categories.length) p.set('categories', categories.join(','));
    if (sources.length) p.set('sources', sources.join(','));
    if (debouncedQ.trim()) p.set('q', debouncedQ.trim());
    return p.toString();
  }, [hours, page, levels, categories, sources, debouncedQ]);

  const fetchData = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/activity?${queryString}`, {
          headers: { 'x-admin-token': token },
          cache: 'no-store',
        });
        if (res.status === 401) {
          onLogout();
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.detail || body?.error || `HTTP ${res.status}`);
        }
        setData(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error desconocido');
      } finally {
        setLoading(false);
      }
    },
    [queryString, token, onLogout],
  );

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Auto-refresh sólo en la primera página (no interrumpe la paginación).
  const fetchRef = useRef(fetchData);
  fetchRef.current = fetchData;
  useEffect(() => {
    if (!autoRefresh || page !== 0) return;
    const id = setInterval(() => void fetchRef.current({ silent: true }), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, page]);

  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const hasMore = data?.page.hasMore ?? false;
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = page * PAGE_SIZE + events.length;

  const knownCategories = useMemo(() => {
    const set = new Set<string>(Object.keys(CATEGORY_LABEL));
    if (data) Object.keys(data.stats.byCategory).forEach((c) => set.add(c));
    return Array.from(set);
  }, [data]);

  return (
    <main className="min-h-screen bg-n-0 text-n-1000 flex flex-col">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-n-200 bg-n-0/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
          <Activity className="w-5 h-5 text-gold-500 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-n-1000 leading-tight">
              Consola de Actividad
            </h1>
            <p className="text-xs text-n-600 leading-tight">
              {total.toLocaleString('es-CO')} eventos · ventana {hours}h
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setAutoRefresh((v) => !v)}
              className={cn(
                'h-9 px-3 rounded-lg text-xs font-medium border transition-colors inline-flex items-center gap-1.5',
                autoRefresh
                  ? 'border-success/40 text-success bg-success/10'
                  : 'border-n-300 text-n-700 hover:text-n-1000 hover:bg-n-100',
              )}
              title="Auto-actualizar cada 15s (sólo en la primera página)"
            >
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  autoRefresh ? 'bg-success animate-pulse' : 'bg-n-400',
                )}
                aria-hidden="true"
              />
              Auto
            </button>
            <button
              onClick={() => void fetchData()}
              disabled={loading}
              className="h-9 w-9 rounded-lg border border-n-300 text-n-700 hover:text-n-1000 hover:bg-n-100 transition-colors inline-flex items-center justify-center disabled:opacity-50"
              title="Actualizar"
              aria-label="Actualizar"
            >
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} aria-hidden="true" />
            </button>
            <button
              onClick={onLogout}
              className="h-9 px-3 rounded-lg border border-n-300 text-n-700 hover:text-n-1000 hover:bg-n-100 transition-colors inline-flex items-center gap-1.5 text-xs font-medium"
              title="Salir"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              Salir
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-5 flex-1 flex flex-col gap-5 min-h-0">
        {/* ── Stats ────────────────────────────────────────────────────── */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total" value={total} tone="neutral" />
          <StatCard label="Errores" value={data?.stats.byLevel.error ?? 0} tone="danger" />
          <StatCard label="Avisos" value={data?.stats.byLevel.warn ?? 0} tone="warning" />
          <StatCard label="Info" value={data?.stats.byLevel.info ?? 0} tone="info" />
        </section>

        {/* ── Filtros ──────────────────────────────────────────────────── */}
        <section className="space-y-3">
          {/* Búsqueda + ventana */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-n-500"
                aria-hidden="true"
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar en mensaje, acción o categoría…"
                className="w-full h-10 pl-9 pr-3 rounded-lg bg-n-50 border border-n-300 text-n-1000 text-sm placeholder:text-n-400 focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-transparent"
              />
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-n-300 bg-n-50 p-1">
              {WINDOWS.map((w) => (
                <button
                  key={w.hours}
                  onClick={() => setHours(w.hours)}
                  className={cn(
                    'h-8 px-3 rounded-md text-xs font-medium transition-colors',
                    hours === w.hours
                      ? 'bg-gold-500 text-n-0'
                      : 'text-n-700 hover:text-n-1000 hover:bg-n-100',
                  )}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          {/* Chips de severidad / fuente / categoría */}
          <div className="flex flex-wrap items-center gap-2">
            <FilterGroup label="Nivel">
              {LEVELS.map((lv) => (
                <Chip
                  key={lv}
                  active={levels.includes(lv)}
                  onClick={() => setLevels((p) => toggle(p, lv))}
                  className={levels.includes(lv) ? LEVEL_META[lv].cls : undefined}
                >
                  {LEVEL_META[lv].label}
                </Chip>
              ))}
            </FilterGroup>

            <Divider />

            <FilterGroup label="Fuente">
              {(['activity', 'agent', 'notification', 'tax'] as Source[]).map((s) => (
                <Chip
                  key={s}
                  active={sources.includes(s)}
                  onClick={() => setSources((p) => toggle(p, s))}
                >
                  {SOURCE_LABEL[s]}
                </Chip>
              ))}
            </FilterGroup>
          </div>

          <FilterGroup label="Categoría">
            {knownCategories.map((c) => (
              <Chip
                key={c}
                active={categories.includes(c)}
                onClick={() => setCategories((p) => toggle(p, c))}
              >
                {CATEGORY_LABEL[c] ?? c}
                {data?.stats.byCategory[c] ? (
                  <span className="ml-1 text-n-500">{data.stats.byCategory[c]}</span>
                ) : null}
              </Chip>
            ))}
          </FilterGroup>
        </section>

        {/* ── Tabla ────────────────────────────────────────────────────── */}
        <section
          data-lenis-prevent
          className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-n-200 bg-n-0"
        >
          {error ? (
            <EmptyState
              icon={AlertCircle}
              title="No se pudo cargar la actividad"
              detail={error}
              tone="danger"
            />
          ) : loading && !data ? (
            <EmptyState icon={Loader2} title="Cargando actividad…" spin />
          ) : events.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="Sin eventos en esta ventana"
              detail="Ajusta los filtros o amplía el rango de tiempo. La bitácora se llena a medida que el sistema opera."
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-n-50 border-b border-n-200 text-left">
                <tr className="text-xs uppercase tracking-wide text-n-600">
                  <th className="font-medium px-4 py-2.5 w-[150px]">Hora</th>
                  <th className="font-medium px-2 py-2.5 w-[90px]">Nivel</th>
                  <th className="font-medium px-2 py-2.5 w-[130px]">Categoría</th>
                  <th className="font-medium px-2 py-2.5">Evento</th>
                  <th className="font-medium px-2 py-2.5 w-[80px] text-right">Dur.</th>
                  <th className="px-2 py-2.5 w-[40px]" />
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <LogRow
                    key={ev.id}
                    ev={ev}
                    open={expanded === ev.id}
                    onToggle={() => setExpanded((cur) => (cur === ev.id ? null : ev.id))}
                  />
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ── Paginación ───────────────────────────────────────────────── */}
        {events.length > 0 && (
          <footer className="flex items-center justify-between text-xs text-n-600 pb-2">
            <span>
              {from.toLocaleString('es-CO')}–{to.toLocaleString('es-CO')} de{' '}
              {total.toLocaleString('es-CO')}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="h-8 px-3 rounded-lg border border-n-300 text-n-700 hover:text-n-1000 hover:bg-n-100 transition-colors disabled:opacity-40"
              >
                Anterior
              </button>
              <span className="tabular-nums text-n-700">Pág. {page + 1}</span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasMore}
                className="h-8 px-3 rounded-lg border border-n-300 text-n-700 hover:text-n-1000 hover:bg-n-100 transition-colors disabled:opacity-40"
              >
                Siguiente
              </button>
            </div>
          </footer>
        )}
      </div>
    </main>
  );
}

// ── Subcomponentes ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'danger' | 'warning' | 'info';
}) {
  const toneCls =
    tone === 'danger'
      ? 'text-danger'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'info'
          ? 'text-info'
          : 'text-n-1000';
  return (
    <div className="rounded-xl border border-n-200 bg-n-0 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-n-600">{label}</p>
      <p className={cn('text-2xl font-semibold tabular-nums mt-0.5', toneCls)}>
        {value.toLocaleString('es-CO')}
      </p>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs font-medium text-n-600 mr-0.5">{label}:</span>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'h-7 px-2.5 rounded-full text-xs font-medium border transition-colors',
        active
          ? className ?? 'bg-gold-500/15 border-gold-500/40 text-gold-600'
          : 'border-n-300 text-n-700 hover:text-n-1000 hover:bg-n-100',
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="hidden sm:block w-px h-5 bg-n-200" aria-hidden="true" />;
}

function LogRow({
  ev,
  open,
  onToggle,
}: {
  ev: ActivityEvent;
  open: boolean;
  onToggle: () => void;
}) {
  const meta = LEVEL_META[ev.level];
  const Icon = meta.icon;
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-n-100 hover:bg-n-50 cursor-pointer align-top"
      >
        <td className="px-4 py-2.5 whitespace-nowrap">
          <span className="text-n-1000 tabular-nums">{fmtAbsolute(ev.ts)}</span>
          <span className="block text-[11px] text-n-500">{fmtRelative(ev.ts)}</span>
        </td>
        <td className="px-2 py-2.5">
          <span
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border',
              meta.cls,
            )}
          >
            <Icon className="w-3 h-3" aria-hidden="true" />
            {meta.label}
          </span>
        </td>
        <td className="px-2 py-2.5">
          <span className="text-n-700">{CATEGORY_LABEL[ev.category] ?? ev.category}</span>
        </td>
        <td className="px-2 py-2.5">
          <span className="text-n-1000">{ev.message}</span>
          <span className="block font-mono text-[11px] text-n-500">{ev.action}</span>
        </td>
        <td className="px-2 py-2.5 text-right tabular-nums text-n-600 whitespace-nowrap">
          {fmtDuration(ev.durationMs)}
        </td>
        <td className="px-2 py-2.5 text-n-500">
          <ChevronDown
            className={cn('w-4 h-4 transition-transform', open && 'rotate-180')}
            aria-hidden="true"
          />
        </td>
      </tr>
      {open && (
        <tr className="border-b border-n-100 bg-n-50">
          <td colSpan={6} className="px-4 py-3">
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs mb-3">
              <Field label="Fuente" value={SOURCE_LABEL[ev.source]} />
              <Field label="ID" value={ev.id} mono />
              <Field label="Workspace" value={ev.workspaceId ?? '—'} mono />
              <Field label="Timestamp" value={fmtAbsolute(ev.ts)} />
            </dl>
            {ev.metadata && Object.keys(ev.metadata).length > 0 && (
              <pre
                data-lenis-prevent
                className="max-h-64 overflow-auto rounded-lg bg-n-100 border border-n-200 p-3 text-[11px] leading-relaxed text-n-800 font-mono"
              >
                {JSON.stringify(ev.metadata, null, 2)}
              </pre>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-n-500 uppercase tracking-wide text-[10px]">{label}</dt>
      <dd className={cn('text-n-1000 truncate', mono && 'font-mono text-[11px]')} title={value}>
        {value}
      </dd>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  detail,
  tone,
  spin,
}: {
  icon: typeof Activity;
  title: string;
  detail?: string;
  tone?: 'danger';
  spin?: boolean;
}) {
  return (
    <div className="h-full min-h-[280px] flex flex-col items-center justify-center text-center px-6 py-12">
      <Icon
        className={cn(
          'w-8 h-8 mb-3',
          tone === 'danger' ? 'text-danger' : 'text-n-400',
          spin && 'animate-spin',
        )}
        aria-hidden="true"
      />
      <p className="text-sm font-medium text-n-1000">{title}</p>
      {detail && <p className="text-xs text-n-600 mt-1 max-w-md">{detail}</p>}
    </div>
  );
}
