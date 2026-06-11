'use client';

/**
 * Settings page — 1+1 Centro de Comando.
 *
 * Full redesign with 6 sections: Tema, Densidad, Idioma,
 * Integraciones, Seguridad, Restablecer. The outer wrapper is neutral (no
 * hardcoded data-theme) because A1 drives theming at <html> level from the
 * workspace shell layout. `data-lenis-prevent` stays so internal wheel-scroll
 * survives the global Lenis smooth-scroll hijack (see CLAUDE.md Layout Gotchas).
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Palette,
  Rows3,
  Languages,
  Plug,
  Shield,
  RotateCcw,
  Check,
  Monitor,
} from 'lucide-react';
import { authClient } from '@/lib/auth/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Panel = 'tema' | 'densidad' | 'idioma' | 'integraciones' | 'seguridad' | 'reset';
type Theme = 'claro' | 'sistema' | 'oscuro';
type Density = 'confortable' | 'compacto';
type Lang = 'es' | 'en';

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
const NAV_ITEMS: { id: Panel; label: string; icon: React.ReactNode }[] = [
  { id: 'tema', label: 'Tema', icon: <Palette className="w-4 h-4" /> },
  { id: 'densidad', label: 'Densidad', icon: <Rows3 className="w-4 h-4" /> },
  { id: 'idioma', label: 'Idioma', icon: <Languages className="w-4 h-4" /> },
  { id: 'integraciones', label: 'Integraciones', icon: <Plug className="w-4 h-4" /> },
  { id: 'seguridad', label: 'Seguridad', icon: <Shield className="w-4 h-4" /> },
  { id: 'reset', label: 'Restablecer', icon: <RotateCcw className="w-4 h-4" /> },
];

const INTEGRATIONS = [
  { name: 'Siigo', abbr: 'SG', color: '#0E7C5A', desc: 'Facturación y contabilidad', connected: true },
  { name: 'Alegra', abbr: 'AL', color: '#2E6FE6', desc: 'Contabilidad en la nube', connected: true },
  { name: 'Helisa', abbr: 'HE', color: '#B8934A', desc: 'ERP contable y nómina', connected: false },
  { name: 'World Office', abbr: 'WO', color: '#A83838', desc: 'Gestión empresarial', connected: false },
  { name: 'SAP Business One', abbr: 'SAP', color: '#1A5276', desc: 'ERP corporativo', connected: false },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PanelCard({
  children,
  danger = false,
}: {
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div
      className={[
        'rounded-2xl border p-6 mb-4',
        danger
          ? 'border-red-700/30 bg-red-900/4'
          : 'border-n-200 bg-n-0',
      ].join(' ')}
    >
      {children}
    </div>
  );
}

function CardTitle({ children, danger = false }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <h2
      className={[
        'font-serif-elite text-xl font-medium',
        danger ? 'text-red-500' : 'text-n-1000',
      ].join(' ')}
    >
      {children}
    </h2>
  );
}

function CardDesc({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-n-600 mt-1 mb-5">{children}</p>;
}

// Segmented control
function SegControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex p-0.5 rounded-lg bg-n-100 border border-n-200 gap-0.5 flex-wrap">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={[
            'inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all',
            value === opt.value
              ? 'bg-n-0 text-gold-600 shadow-sm'
              : 'text-n-600 hover:text-n-900',
          ].join(' ')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// Toggle
function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={[
        'relative w-[42px] h-6 rounded-full border-none transition-colors duration-200 flex-shrink-0',
        on ? 'bg-gold-500' : 'bg-n-300',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-200',
          on ? 'left-[20px]' : 'left-0.5',
        ].join(' ')}
      />
    </button>
  );
}

// Row with label + control
function SettingRow({
  name,
  desc,
  children,
  first = false,
}: {
  name: string;
  desc?: string;
  children: React.ReactNode;
  first?: boolean;
}) {
  return (
    <div
      className={[
        'flex items-center justify-between gap-4 py-4',
        first ? '' : 'border-t border-n-100',
      ].join(' ')}
    >
      <div>
        <div className="text-sm font-semibold text-n-900">{name}</div>
        {desc && <div className="text-xs text-n-600 mt-0.5">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel: Tema
// ---------------------------------------------------------------------------
function TemaPanel({
  theme,
  setTheme,
}: {
  theme: Theme;
  setTheme: (t: Theme) => void;
}) {
  const options: { id: Theme; label: string; swatch: React.ReactNode }[] = [
    {
      id: 'claro',
      label: 'Claro',
      swatch: (
        <div className="flex h-16">
          <div className="flex-1" style={{ background: '#FCFBF8' }} />
          <div className="w-[34%]" style={{ background: '#EFEBE2' }} />
        </div>
      ),
    },
    {
      id: 'sistema',
      label: 'Sistema',
      swatch: (
        <div
          className="h-16"
          style={{ background: 'linear-gradient(90deg,#FCFBF8 50%,#141210 50%)' }}
        />
      ),
    },
    {
      id: 'oscuro',
      label: 'Oscuro · Elite',
      swatch: (
        <div className="flex h-16">
          <div className="flex-1" style={{ background: '#141210' }} />
          <div className="w-[34%]" style={{ background: '#27231D' }} />
        </div>
      ),
    },
  ];

  return (
    <PanelCard>
      <CardTitle>Tema</CardTitle>
      <CardDesc>Claro es el tema principal. El oscuro permanece como modo elite.</CardDesc>
      <div className="grid grid-cols-3 gap-3 mt-4">
        {options.map((opt) => (
          <button
            key={opt.id}
            onClick={() => setTheme(opt.id)}
            className={[
              'rounded-xl border-2 overflow-hidden cursor-pointer transition-all text-left',
              theme === opt.id ? 'border-gold-500' : 'border-n-200 hover:border-n-400',
            ].join(' ')}
          >
            {opt.swatch}
            <div className="text-sm font-semibold text-n-800 px-3 py-2 text-center">
              {opt.label}
            </div>
          </button>
        ))}
      </div>
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// Panel: Densidad
// ---------------------------------------------------------------------------
function DensidadPanel({
  density,
  setDensity,
}: {
  density: Density;
  setDensity: (d: Density) => void;
}) {
  return (
    <PanelCard>
      <CardTitle>Densidad</CardTitle>
      <CardDesc>Ajuste el espaciado de tablas y tarjetas.</CardDesc>
      <SegControl
        options={[
          { value: 'confortable' as Density, label: 'Confortable' },
          { value: 'compacto' as Density, label: 'Compacto' },
        ]}
        value={density}
        onChange={setDensity}
      />
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// Panel: Idioma
// ---------------------------------------------------------------------------
function IdiomaPanel({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <PanelCard>
      <CardTitle>Idioma y formato</CardTitle>
      <CardDesc>Interfaz bilingüe. Montos y fechas en formato colombiano.</CardDesc>
      <SegControl
        options={[
          {
            value: 'es' as Lang,
            label: (
              <>
                {lang === 'es' && <Check className="w-3.5 h-3.5" />}
                Español
              </>
            ),
          },
          { value: 'en' as Lang, label: 'English' },
        ]}
        value={lang}
        onChange={setLang}
      />
      <SettingRow name="Formato de moneda" desc="COP · separador de miles con punto" first>
        <span className="font-mono text-sm text-n-700">$ 1.750.905</span>
      </SettingRow>
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// Panel: Integraciones
// ---------------------------------------------------------------------------
function IntegracionesPanel() {
  const [connected, setConnected] = useState<Record<string, boolean>>(
    Object.fromEntries(INTEGRATIONS.map((i) => [i.name, i.connected]))
  );

  return (
    <PanelCard>
      <CardTitle>Integraciones</CardTitle>
      <CardDesc>Conecte su ERP contable para sincronizar saldos y movimientos.</CardDesc>
      <div>
        {INTEGRATIONS.map((integ, idx) => (
          <div
            key={integ.name}
            className={[
              'flex items-center gap-3.5 py-3.5',
              idx > 0 ? 'border-t border-n-100' : '',
            ].join(' ')}
          >
            <div
              className="w-[42px] h-[42px] rounded-lg flex items-center justify-center font-mono font-bold text-white text-xs flex-shrink-0"
              style={{ background: integ.color }}
            >
              {integ.abbr}
            </div>
            <div>
              <div className="text-sm font-semibold text-n-900">{integ.name}</div>
              <div className="text-xs text-n-500 mt-0.5">{integ.desc}</div>
            </div>
            <div className="ml-auto">
              {connected[integ.name] ? (
                <span className="text-xs font-semibold text-green-600">● Conectado</span>
              ) : (
                <button
                  onClick={() => setConnected((prev) => ({ ...prev, [integ.name]: true }))}
                  className="h-[34px] px-3.5 rounded-lg border border-n-300 bg-n-0 text-sm font-semibold text-n-800 hover:border-gold-500 hover:text-gold-700 transition-colors"
                >
                  Conectar
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// Panel: Seguridad
// ---------------------------------------------------------------------------
function SeguridadPanel() {
  const { data: session, isPending } = authClient.useSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // ── Fase 1 (auth no activada): estado honesto, sin teatro ────────────────
  if (!isPending && !session) {
    return (
      <PanelCard>
        <CardTitle>Seguridad</CardTitle>
        <CardDesc>Proteja el acceso a su información financiera.</CardDesc>
        <div className="flex items-start gap-3 rounded-lg border border-n-200 bg-n-0 px-4 py-4">
          <Monitor className="w-5 h-5 text-n-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-n-900">Sesión anónima</div>
            <p className="text-xs text-n-600 mt-1 leading-relaxed">
              Está usando la app sin cuenta. Cuando inicie sesión, aquí podrá
              cambiar su contraseña y administrar sus sesiones activas.
            </p>
            <a
              href="/login"
              className="mt-3 inline-flex h-9 items-center rounded-lg bg-gold-500 px-4 text-xs font-semibold text-white transition-colors hover:bg-gold-600"
            >
              Iniciar sesión
            </a>
          </div>
        </div>
      </PanelCard>
    );
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwLoading(true);
    setPwMessage(null);
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setPwLoading(false);
    if (error) {
      setPwMessage({ ok: false, text: error.message ?? 'No se pudo actualizar la contraseña.' });
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setPwMessage({ ok: true, text: 'Contraseña actualizada. Las demás sesiones fueron cerradas.' });
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await authClient.signOut();
    window.location.href = '/login';
  };

  return (
    <>
      <PanelCard>
        <CardTitle>Seguridad</CardTitle>
        <CardDesc>
          {session ? `Cuenta: ${session.user.email}` : 'Cargando sesión…'}
        </CardDesc>
        <form onSubmit={handleChangePassword}>
          <div className="mb-4 max-w-[380px]">
            <label className="block text-xs font-semibold text-n-700 uppercase tracking-[.08em] mb-1.5">
              Contraseña actual
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full h-11 px-3.5 bg-n-0 border border-n-200 rounded-lg text-sm text-n-900 placeholder:text-n-400 focus:outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500/15"
            />
          </div>
          <div className="mb-5 max-w-[380px]">
            <label className="block text-xs font-semibold text-n-700 uppercase tracking-[.08em] mb-1.5">
              Nueva contraseña
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full h-11 px-3.5 bg-n-0 border border-n-200 rounded-lg text-sm text-n-900 placeholder:text-n-400 focus:outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500/15"
            />
          </div>
          {pwMessage && (
            <p
              className={`mb-4 max-w-[380px] rounded-lg border px-3 py-2 text-sm ${
                pwMessage.ok
                  ? 'border-success/30 bg-success/[0.06] text-success'
                  : 'border-danger/30 bg-danger/[0.06] text-danger'
              }`}
            >
              {pwMessage.text}
            </p>
          )}
          <button
            type="submit"
            disabled={pwLoading || isPending}
            className="h-[42px] px-5 rounded-lg bg-gold-500 hover:bg-gold-600 text-white text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {pwLoading ? 'Actualizando…' : 'Actualizar contraseña'}
          </button>
        </form>
      </PanelCard>

      <PanelCard>
        <h2 className="font-serif-elite text-lg font-medium text-n-1000 mb-1">Sesión actual</h2>
        <div className="flex items-center gap-3 py-3.5">
          <Monitor className="w-5 h-5 text-n-500 flex-shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-n-900">
              {session?.user.email ?? '…'}
            </div>
            <div className="text-xs text-n-600 mt-0.5">
              {session
                ? `Expira: ${new Date(session.session.expiresAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}`
                : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="h-[30px] px-3 rounded-lg border border-n-300 bg-n-0 text-xs font-semibold text-n-800 hover:border-red-400 hover:text-red-500 transition-colors disabled:opacity-60"
          >
            {signingOut ? 'Cerrando…' : 'Cerrar sesión'}
          </button>
        </div>
      </PanelCard>
    </>
  );
}

// ---------------------------------------------------------------------------
// Panel: Restablecer
// ---------------------------------------------------------------------------
function ResetPanel() {
  return (
    <PanelCard danger>
      <CardTitle danger>Restablecer</CardTitle>
      <CardDesc>Acciones irreversibles. Proceda con cuidado.</CardDesc>
      <SettingRow name="Limpiar datos de demostración" desc="Elimina casos y cifras de ejemplo." first>
        <button className="h-[42px] px-4 rounded-lg border border-red-700/40 bg-transparent text-red-500 font-semibold text-sm hover:bg-red-900/8 transition-colors">
          Limpiar datos
        </button>
      </SettingRow>
      <SettingRow name="Restablecer workspace" desc="Vuelve la configuración a valores de fábrica.">
        <button className="h-[42px] px-4 rounded-lg border border-red-700/40 bg-transparent text-red-500 font-semibold text-sm hover:bg-red-900/8 transition-colors">
          Restablecer
        </button>
      </SettingRow>
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function SettingsPage() {
  const [activePanel, setActivePanel] = useState<Panel>('tema');
  const [theme, setTheme] = useState<Theme>('claro');
  const [density, setDensity] = useState<Density>('confortable');
  const [lang, setLang] = useState<Lang>('es');

  return (
    <div
      data-lenis-prevent
      className="min-h-full w-full overflow-y-auto bg-n-0"
    >
      <div className="mx-auto w-full max-w-[1280px] px-5 md:px-8 py-8 md:py-12">
        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="pb-6"
        >
          <h1 className="font-serif-elite font-medium text-[clamp(2rem,3.6vw,2.6rem)] leading-tight tracking-tight text-n-1000">
            Configuración
          </h1>
          <p className="text-sm text-n-600 mt-1.5">
            Personalice su workspace — apariencia, idioma, integraciones y seguridad.
          </p>
        </motion.div>

        {/* Two-column grid */}
        <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-7 items-start pt-2">
          {/* Left nav */}
          <nav className="md:sticky md:top-[84px] flex flex-row md:flex-col gap-1 overflow-x-auto pb-2 md:pb-0">
            {NAV_ITEMS.map((item) => {
              const isActive = activePanel === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActivePanel(item.id)}
                  className={[
                    'flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all text-left whitespace-nowrap',
                    isActive
                      ? 'bg-gold-500/10 text-gold-700 font-semibold'
                      : 'text-n-600 hover:bg-n-100 hover:text-n-900',
                  ].join(' ')}
                >
                  {item.icon}
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Right panels */}
          <div className="min-w-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={activePanel}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                {activePanel === 'tema' && (
                  <TemaPanel theme={theme} setTheme={setTheme} />
                )}
                {activePanel === 'densidad' && (
                  <DensidadPanel density={density} setDensity={setDensity} />
                )}
                {activePanel === 'idioma' && (
                  <IdiomaPanel lang={lang} setLang={setLang} />
                )}
                {activePanel === 'integraciones' && <IntegracionesPanel />}
                {activePanel === 'seguridad' && (
                  <SeguridadPanel />
                )}
                {activePanel === 'reset' && <ResetPanel />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
