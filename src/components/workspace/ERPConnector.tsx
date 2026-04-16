'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plug,
  CheckCircle,
  AlertCircle,
  Loader2,
  ChevronRight,
  X,
  RefreshCw,
  Check,
  Globe,
  Shield,
  Trash2,
  Download,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/context/WorkspaceContext';
import type { ERPProvider } from '@/lib/erp/types';
import { ERPLogo } from './ERPLogo';

// ─── Storage helpers ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'utopia_erp_connections';

interface StoredConnection {
  provider: ERPProvider;
  credentials: Record<string, string>;
  connectedAt: string;
  lastSync: string | null;
  companyName: string;
}

function encodeConnections(connections: StoredConnection[]): string {
  return btoa(encodeURIComponent(JSON.stringify(connections)));
}

function decodeConnections(encoded: string): StoredConnection[] {
  try {
    return JSON.parse(decodeURIComponent(atob(encoded)));
  } catch {
    return [];
  }
}

function loadConnections(): StoredConnection[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  return decodeConnections(raw);
}

function saveConnections(connections: StoredConnection[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, encodeConnections(connections));
}

function removeConnection(provider: ERPProvider): void {
  const connections = loadConnections();
  saveConnections(connections.filter(c => c.provider !== provider));
}

function upsertConnection(conn: StoredConnection): void {
  const connections = loadConnections();
  const idx = connections.findIndex(c => c.provider === conn.provider);
  if (idx >= 0) {
    connections[idx] = conn;
  } else {
    connections.push(conn);
  }
  saveConnections(connections);
}

// ─── Provider data ───────────────────────────────────────────────────────────

interface ProviderCard {
  id: ERPProvider;
  name: string;
  country: 'colombia' | 'international';
  description: string;
  color: string;
  authType: string;
  supportsPUC: boolean;
  supportsDIAN: boolean;
  capabilities: string[];
}

const COLOMBIAN_PROVIDERS: ProviderCard[] = [
  { id: 'alegra', name: 'Alegra', country: 'colombia', description: 'Facturación electrónica y contabilidad en la nube', color: '#3B82F6', authType: 'Email + API Token', supportsPUC: true, supportsDIAN: true, capabilities: ['PUC', 'DIAN', 'Balance', 'Facturas', 'Contactos'] },
  { id: 'siigo', name: 'Siigo', country: 'colombia', description: 'ERP contable y facturación DIAN para PYMES', color: '#16A34A', authType: 'Usuario + Access Key', supportsPUC: true, supportsDIAN: true, capabilities: ['PUC', 'DIAN', 'Balance', 'Facturas', 'Movimientos'] },
  { id: 'helisa', name: 'Helisa', country: 'colombia', description: 'Sistema integral de gestión empresarial', color: '#7C3AED', authType: 'HMAC Key', supportsPUC: true, supportsDIAN: true, capabilities: ['PUC', 'DIAN', 'Balance', 'Movimientos'] },
  { id: 'world_office', name: 'World Office', country: 'colombia', description: 'ERP contable con facturación electrónica', color: '#4F46E5', authType: 'JWT Token', supportsPUC: true, supportsDIAN: true, capabilities: ['PUC', 'DIAN', 'Balance', 'Facturas'] },
  { id: 'contapyme', name: 'ContaPyme', country: 'colombia', description: 'Contabilidad simplificada para microempresas', color: '#0D9488', authType: 'API Token', supportsPUC: true, supportsDIAN: true, capabilities: ['PUC', 'DIAN', 'Balance'] },
];

const INTERNATIONAL_PROVIDERS: ProviderCard[] = [
  { id: 'sap_b1', name: 'SAP Business One', country: 'international', description: 'ERP empresarial para medianas empresas', color: '#0070F2', authType: 'Usuario + Contraseña + DB', supportsPUC: false, supportsDIAN: false, capabilities: ['Balance', 'Facturas', 'Movimientos', 'Contactos'] },
  { id: 'dynamics_365', name: 'Dynamics 365', country: 'international', description: 'Suite de gestión empresarial Microsoft', color: '#0078D4', authType: 'OAuth 2.0 (Azure AD)', supportsPUC: false, supportsDIAN: false, capabilities: ['Balance', 'Facturas', 'Movimientos', 'Contactos'] },
  { id: 'quickbooks', name: 'QuickBooks Online', country: 'international', description: 'Contabilidad en la nube para pequeñas empresas', color: '#2CA01C', authType: 'OAuth 2.0', supportsPUC: false, supportsDIAN: false, capabilities: ['Balance', 'Facturas', 'Contactos'] },
  { id: 'xero', name: 'Xero', country: 'international', description: 'Plataforma contable global en la nube', color: '#13B5EA', authType: 'OAuth 2.0', supportsPUC: false, supportsDIAN: false, capabilities: ['Balance', 'Facturas', 'Contactos'] },
  { id: 'odoo', name: 'Odoo', country: 'international', description: 'ERP modular de código abierto', color: '#714B67', authType: 'URL + Usuario + Contraseña', supportsPUC: true, supportsDIAN: false, capabilities: ['PUC', 'Balance', 'Facturas', 'Movimientos', 'Contactos'] },
];

type ConnectionStatus = 'idle' | 'testing' | 'connecting' | 'connected' | 'error';

const CAPABILITY_LABELS: Record<string, string> = {
  PUC: 'Plan de Cuentas',
  DIAN: 'Reportes DIAN',
  Balance: 'Balance de Prueba',
  Facturas: 'Facturación',
  Movimientos: 'Movimientos',
  Contactos: 'Terceros',
};

// ─── Field definitions ───────────────────────────────────────────────────────

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  required?: boolean;
  hint?: string;
}

function getFieldsForProvider(provider: ERPProvider): FieldDef[] {
  switch (provider) {
    case 'alegra':
      return [
        { key: 'username', label: 'Email de Alegra', placeholder: 'usuario@empresa.com', required: true, hint: 'El email con el que inicia sesión en Alegra' },
        { key: 'apiToken', label: 'API Token', placeholder: 'Token de la configuración de Alegra', secret: true, required: true, hint: 'Encuentre su API Token en Alegra > Configuración > Integraciones' },
      ];
    case 'siigo':
      return [
        { key: 'username', label: 'Usuario (email)', placeholder: 'usuario@empresa.com', required: true },
        { key: 'apiKey', label: 'Access Key', placeholder: 'Clave de acceso de Siigo', secret: true, required: true, hint: 'Configuración > Alianzas e Integraciones > Credenciales' },
      ];
    case 'helisa':
      return [
        { key: 'baseUrl', label: 'URL del servidor', placeholder: 'https://miempresa.helisa.com/KansasWS', required: true },
        { key: 'apiKey', label: 'Clave HMAC', placeholder: 'Clave de firma proporcionada por Helisa', secret: true, required: true },
      ];
    case 'world_office':
      return [
        { key: 'baseUrl', label: 'URL del tenant', placeholder: 'https://miempresa.worldoffice.cloud', required: true },
        { key: 'apiToken', label: 'JWT Token', placeholder: 'Token de Configuración General > API', secret: true, required: true },
      ];
    case 'contapyme':
      return [
        { key: 'baseUrl', label: 'URL del servidor', placeholder: 'https://miempresa.contapyme.com', required: true },
        { key: 'apiToken', label: 'API Token', placeholder: 'Token de autenticación', secret: true, required: true },
      ];
    case 'sap_b1':
      return [
        { key: 'baseUrl', label: 'URL del Service Layer', placeholder: 'https://servidor:50000', required: true },
        { key: 'username', label: 'Usuario SAP', placeholder: 'manager', required: true },
        { key: 'password', label: 'Contraseña', placeholder: '', secret: true, required: true },
        { key: 'databaseName', label: 'Base de datos (CompanyDB)', placeholder: 'SBODEMOCO', required: true },
      ];
    case 'dynamics_365':
      return [
        { key: 'tenantId', label: 'Tenant ID (Azure AD)', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', required: true },
        { key: 'clientId', label: 'Client ID', placeholder: 'ID de aplicación registrada en Azure', required: true },
        { key: 'clientSecret', label: 'Client Secret', placeholder: '', secret: true, required: true },
        { key: 'companyId', label: 'Company ID (BC)', placeholder: 'ID de la empresa en Business Central', required: true },
      ];
    case 'quickbooks':
      return [
        { key: 'clientId', label: 'Client ID', placeholder: 'ID de app en developer.intuit.com', required: true },
        { key: 'clientSecret', label: 'Client Secret', placeholder: '', secret: true, required: true },
        { key: 'refreshToken', label: 'Refresh Token', placeholder: 'Token de refresco OAuth', secret: true, required: true },
        { key: 'companyId', label: 'Realm ID (Company)', placeholder: 'ID numérico de la empresa', required: true },
      ];
    case 'xero':
      return [
        { key: 'clientId', label: 'Client ID', placeholder: 'ID de app en developer.xero.com', required: true },
        { key: 'clientSecret', label: 'Client Secret', placeholder: '', secret: true, required: true },
        { key: 'refreshToken', label: 'Refresh Token', placeholder: 'Token OAuth', secret: true, required: true },
        { key: 'tenantId', label: 'Tenant ID (xero-tenant-id)', placeholder: 'ID de la organización Xero', required: true },
      ];
    case 'odoo':
      return [
        { key: 'baseUrl', label: 'URL de Odoo', placeholder: 'https://miempresa.odoo.com', required: true },
        { key: 'databaseName', label: 'Base de datos', placeholder: 'miempresa-production', required: true },
        { key: 'username', label: 'Usuario (email)', placeholder: 'admin@empresa.com', required: true },
        { key: 'password', label: 'Contraseña o API Key', placeholder: '', secret: true, required: true },
      ];
  }
}

// ─── Connect Form Modal ──────────────────────────────────────────────────────

interface ConnectFormProps {
  provider: ProviderCard;
  onClose: () => void;
  onConnected: (credentials: Record<string, string>) => void;
}

function ConnectForm({ provider, onClose, onConnected }: ConnectFormProps) {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  const fieldDefs = getFieldsForProvider(provider.id);

  const handleTest = async () => {
    setStatus('testing');
    setError('');

    try {
      const response = await fetch('/api/erp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: provider.id,
          credentials: fields,
          testOnly: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al probar la conexión');
      }

      setStatus('idle');
      setError('');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Error de conexión');
    }
  };

  const handleConnect = async () => {
    setStatus('connecting');
    setError('');

    try {
      const response = await fetch('/api/erp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: provider.id,
          credentials: fields,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error de conexión');
      }

      setStatus('connected');
      setTimeout(() => onConnected(fields), 1200);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Error de conexión');
    }
  };

  const allRequiredFilled = fieldDefs.every(f => !f.required || fields[f.key]?.trim());

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-form-title"
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e5e5]">
          <div className="flex items-center gap-2">
            <Plug className="w-4 h-4 text-[#D4A017]" />
            <h3 id="connect-form-title" className="text-sm font-semibold text-[#0a0a0a]">Conectar {provider.name}</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-[#a3a3a3] hover:text-[#525252] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <div className="px-6 py-5 space-y-4">
          {status === 'connected' ? (
            <div className="text-center py-4">
              <CheckCircle className="w-10 h-10 text-[#22C55E] mx-auto mb-2" />
              <p className="text-sm font-semibold text-[#16A34A]">Conectado exitosamente</p>
              <p className="text-xs text-[#a3a3a3] mt-1">Ya puede importar datos desde {provider.name}</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-[#a3a3a3]">
                Autenticación: <span className="text-[#525252] font-medium">{provider.authType}</span>
              </p>

              {fieldDefs.map(field => (
                <div key={field.key}>
                  <label className="block text-xs font-medium text-[#525252] mb-1">{field.label}</label>
                  <input
                    type={field.secret ? 'password' : 'text'}
                    value={fields[field.key] || ''}
                    onChange={e => setFields(f => ({ ...f, [field.key]: e.target.value }))}
                    className="w-full border border-[#e5e5e5] rounded-lg px-3 py-2 text-sm text-[#0a0a0a] focus:border-[#0a0a0a] focus:outline-none transition-colors"
                    placeholder={field.placeholder}
                  />
                  {field.hint && <p className="text-[10px] text-[#a3a3a3] mt-0.5">{field.hint}</p>}
                </div>
              ))}

              {status === 'error' && (
                <div className="flex items-center gap-2 text-xs text-[#DC2626] bg-[#FEF2F2] border border-[#FECACA] rounded-lg px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Actions */}
        {status !== 'connected' && (
          <div className="px-6 py-4 border-t border-[#e5e5e5] flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-medium text-[#525252] hover:bg-[#fafafa] rounded-lg transition-colors">
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleTest}
              disabled={!allRequiredFilled || status === 'testing' || status === 'connecting'}
              className="px-4 py-2 rounded-lg text-xs font-medium border border-[#e5e5e5] text-[#525252] hover:bg-[#fafafa] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {status === 'testing' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {status === 'testing' ? 'Probando...' : 'Probar conexión'}
            </button>
            <button
              type="button"
              onClick={handleConnect}
              disabled={!allRequiredFilled || status === 'connecting' || status === 'testing'}
              className={cn(
                'px-5 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5',
                status === 'connecting'
                  ? 'bg-[#D4A017]/50 text-white cursor-wait'
                  : 'bg-[#D4A017] hover:bg-[#A87C10] text-white disabled:bg-[#e5e5e5] disabled:text-[#a3a3a3] disabled:cursor-not-allowed',
              )}
            >
              {status === 'connecting' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {status === 'connecting' ? 'Conectando...' : 'Conectar'}
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ─── Disconnect Confirmation Modal ───────────────────────────────────────────

interface DisconnectModalProps {
  providerName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function DisconnectModal({ providerName, onConfirm, onCancel }: DisconnectModalProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="disconnect-modal-title"
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
      >
        <div className="px-6 py-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-[#FEF2F2] flex items-center justify-center">
              <Trash2 className="w-4 h-4 text-[#DC2626]" />
            </div>
            <h3 id="disconnect-modal-title" className="text-sm font-semibold text-[#0a0a0a]">¿Desconectar {providerName}?</h3>
          </div>
          <p className="text-xs text-[#a3a3a3]">
            Se eliminarán las credenciales almacenadas. Deberá volver a conectar para sincronizar datos.
          </p>
        </div>
        <div className="px-6 py-4 border-t border-[#e5e5e5] flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-xs font-medium text-[#525252] hover:bg-[#fafafa] rounded-lg transition-colors">
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#DC2626] hover:bg-[#B91C1C] text-white transition-colors"
          >
            Desconectar
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Sync Modal ──────────────────────────────────────────────────────────────

interface SyncModalProps {
  provider: ProviderCard;
  onClose: () => void;
  onSyncComplete: (recordCount: number) => void;
}

function SyncModal({ provider, onClose, onSyncComplete }: SyncModalProps) {
  const { openIntakeForType } = useWorkspace();
  const [syncOptions, setSyncOptions] = useState({
    trialBalance: true,
    chartOfAccounts: false,
    journalEntries: false,
    invoices: false,
    contacts: false,
  });
  const [year, setYear] = useState(new Date().getFullYear());
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{ success: boolean; recordCount: number } | null>(null);
  const [error, setError] = useState('');

  const handleSync = async () => {
    setSyncing(true);
    setError('');
    setResult(null);

    try {
      const response = await fetch('/api/erp/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: provider.id,
          options: syncOptions,
          year,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error de sincronización');
      }

      const count = data.recordCount ?? 0;
      setResult({ success: true, recordCount: count });
      onSyncComplete(count);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de sincronización');
      setResult({ success: false, recordCount: 0 });
    } finally {
      setSyncing(false);
    }
  };

  const handleCreateReport = () => {
    onClose();
    openIntakeForType('niif_report');
  };

  const anySelected = Object.values(syncOptions).some(Boolean);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-modal-title"
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e5e5]">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-[#D4A017]" />
            <h3 id="sync-modal-title" className="text-sm font-semibold text-[#0a0a0a]">Sincronizar {provider.name}</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-[#a3a3a3] hover:text-[#525252] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {result?.success ? (
            <div className="text-center py-2 space-y-3">
              <CheckCircle className="w-10 h-10 text-[#22C55E] mx-auto" />
              <div>
                <p className="text-sm font-semibold text-[#16A34A]">
                  {result.recordCount} registros sincronizados
                </p>
                <p className="text-xs text-[#a3a3a3] mt-1">
                  Datos importados exitosamente desde {provider.name}
                </p>
              </div>
              <button
                type="button"
                onClick={handleCreateReport}
                className="px-5 py-2.5 rounded-lg text-xs font-semibold bg-[#D4A017] hover:bg-[#A87C10] text-white transition-colors"
              >
                Crear Reporte NIIF con estos datos
              </button>
            </div>
          ) : (
            <>
              {/* Sync options */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-[#525252]">Datos a sincronizar</p>
                {[
                  { key: 'trialBalance' as const, label: 'Balance de Prueba' },
                  { key: 'chartOfAccounts' as const, label: 'Plan de Cuentas' },
                  { key: 'journalEntries' as const, label: 'Movimientos Contables' },
                  { key: 'invoices' as const, label: 'Facturas' },
                  { key: 'contacts' as const, label: 'Terceros / Contactos' },
                ].map(opt => (
                  <label key={opt.key} className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-[#fafafa] cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={syncOptions[opt.key]}
                      onChange={() => setSyncOptions(prev => ({ ...prev, [opt.key]: !prev[opt.key] }))}
                      className="w-3.5 h-3.5 rounded border-[#d4d4d4] text-[#D4A017] focus:ring-[#D4A017] accent-[#D4A017]"
                    />
                    <span className="text-xs text-[#0a0a0a]">{opt.label}</span>
                  </label>
                ))}
              </div>

              {/* Year selector */}
              <div>
                <label className="block text-xs font-medium text-[#525252] mb-1">Periodo (año)</label>
                <select
                  value={year}
                  onChange={e => setYear(Number(e.target.value))}
                  className="w-full border border-[#e5e5e5] rounded-lg px-3 py-2 text-sm text-[#0a0a0a] focus:border-[#0a0a0a] focus:outline-none transition-colors bg-white"
                >
                  {[2026, 2025, 2024, 2023].map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-xs text-[#DC2626] bg-[#FEF2F2] border border-[#FECACA] rounded-lg px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Actions */}
        {!result?.success && (
          <div className="px-6 py-4 border-t border-[#e5e5e5] flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-medium text-[#525252] hover:bg-[#fafafa] rounded-lg transition-colors">
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing || !anySelected}
              className={cn(
                'px-5 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5',
                syncing
                  ? 'bg-[#D4A017]/50 text-white cursor-wait'
                  : 'bg-[#D4A017] hover:bg-[#A87C10] text-white disabled:bg-[#e5e5e5] disabled:text-[#a3a3a3] disabled:cursor-not-allowed',
              )}
            >
              {syncing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {syncing ? 'Sincronizando...' : 'Iniciar Sincronización'}
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ─── Format helpers ──────────────────────────────────────────────────────────

function formatSyncDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Provider Card Component ─────────────────────────────────────────────────

interface ProviderCardViewProps {
  provider: ProviderCard;
  connection: StoredConnection | undefined;
  onConnect: () => void;
  onSync: () => void;
  onDisconnect: () => void;
}

function ProviderCardView({ provider, connection, onConnect, onSync, onDisconnect }: ProviderCardViewProps) {
  const isConnected = !!connection;

  return (
    <div
      className={cn(
        'flex flex-col p-4 rounded-xl border transition-all',
        isConnected
          ? 'border-[#22C55E]/30 bg-[#F0FDF4]'
          : 'border-[#e5e5e5] bg-white hover:border-[#d4d4d4] hover:shadow-sm',
      )}
    >
      {/* Header: brand logo + name + status */}
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'w-9 h-9 rounded-lg flex items-center justify-center shrink-0 overflow-hidden',
            isConnected && 'ring-2 ring-[#22C55E]/30',
          )}
        >
          <ERPLogo provider={provider.id} size={36} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[#0a0a0a]">{provider.name}</span>
            <span className={cn(
              'inline-flex items-center gap-1 text-[10px] font-medium shrink-0',
              isConnected ? 'text-[#16A34A]' : 'text-[#a3a3a3]',
            )}>
              <span className={cn(
                'w-1.5 h-1.5 rounded-full',
                isConnected ? 'bg-[#22C55E]' : 'bg-[#d4d4d4]',
              )} />
              {isConnected ? 'Conectado' : 'No conectado'}
            </span>
          </div>
          <p className="text-[11px] text-[#737373] mt-0.5 leading-snug">{provider.description}</p>
        </div>
      </div>

      {/* Connected: last sync */}
      {isConnected && connection.lastSync && (
        <div className="flex items-center gap-1.5 mt-2 text-[10px] text-[#16A34A]">
          <RefreshCw className="w-3 h-3" />
          Última sync: {formatSyncDate(connection.lastSync)}
        </div>
      )}

      {/* Capabilities */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2.5 flex-1">
        {provider.capabilities.map(cap => (
          <span key={cap} className="inline-flex items-center gap-1 text-[11px] text-[#525252]">
            <Check className="w-3 h-3 shrink-0" style={{ color: provider.color }} />
            {CAPABILITY_LABELS[cap] || cap}
          </span>
        ))}
      </div>

      {/* Action */}
      <div className="mt-2.5">
        {isConnected ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSync}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#D4A017] hover:bg-[#A87C10] text-white transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Sincronizar
            </button>
            <button
              type="button"
              onClick={onDisconnect}
              className="p-1.5 rounded-lg text-[#a3a3a3] hover:text-[#DC2626] hover:bg-[#FEF2F2] transition-colors"
              title="Desconectar"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#e5e5e5] text-[#525252] hover:border-[#D4A017] hover:text-[#D4A017] hover:bg-[#FFFBEB] transition-all"
          >
            Conectar
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function ERPConnector() {
  const [connections, setConnections] = useState<StoredConnection[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderCard | null>(null);
  const [syncProvider, setSyncProvider] = useState<ProviderCard | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<ProviderCard | null>(null);

  // Load saved connections on mount
  useEffect(() => {
    setConnections(loadConnections());
  }, []);

  const getConnection = useCallback((providerId: ERPProvider): StoredConnection | undefined => {
    return connections.find(c => c.provider === providerId);
  }, [connections]);

  const handleConnected = useCallback((provider: ProviderCard, credentials: Record<string, string>) => {
    const conn: StoredConnection = {
      provider: provider.id,
      credentials,
      connectedAt: new Date().toISOString(),
      lastSync: null,
      companyName: credentials.username || credentials.companyId || provider.name,
    };
    upsertConnection(conn);
    setConnections(loadConnections());
    setSelectedProvider(null);
  }, []);

  const handleDisconnect = useCallback((provider: ProviderCard) => {
    removeConnection(provider.id);
    setConnections(loadConnections());
    setDisconnectTarget(null);
  }, []);

  const handleSyncComplete = useCallback((provider: ProviderCard, recordCount: number) => {
    const existing = loadConnections().find(c => c.provider === provider.id);
    if (existing) {
      existing.lastSync = new Date().toISOString();
      upsertConnection(existing);
      setConnections(loadConnections());
    }
    void recordCount; // used by SyncModal internally
  }, []);

  const connectedCount = connections.length;

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      {connectedCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#F0FDF4] border border-[#22C55E]/20">
          <CheckCircle className="w-4 h-4 text-[#22C55E]" />
          <span className="text-xs font-medium text-[#16A34A]">
            {connectedCount} ERP{connectedCount > 1 ? 's' : ''} conectado{connectedCount > 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Colombian ERPs */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-[#D4A017]" />
          <h3 className="text-xs font-bold text-[#0a0a0a] uppercase tracking-wider">ERPs Colombianos</h3>
          <span className="text-[10px] text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">PUC + DIAN</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {COLOMBIAN_PROVIDERS.map(p => (
            <ProviderCardView
              key={p.id}
              provider={p}
              connection={getConnection(p.id)}
              onConnect={() => setSelectedProvider(p)}
              onSync={() => setSyncProvider(p)}
              onDisconnect={() => setDisconnectTarget(p)}
            />
          ))}
        </div>
      </div>

      {/* International ERPs */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Globe className="w-4 h-4 text-[#525252]" />
          <h3 className="text-xs font-bold text-[#0a0a0a] uppercase tracking-wider">ERPs Internacionales</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {INTERNATIONAL_PROVIDERS.map(p => (
            <ProviderCardView
              key={p.id}
              provider={p}
              connection={getConnection(p.id)}
              onConnect={() => setSelectedProvider(p)}
              onSync={() => setSyncProvider(p)}
              onDisconnect={() => setDisconnectTarget(p)}
            />
          ))}
        </div>
      </div>

      {/* Connect Modal */}
      <AnimatePresence>
        {selectedProvider && (
          <ConnectForm
            provider={selectedProvider}
            onClose={() => setSelectedProvider(null)}
            onConnected={(credentials) => handleConnected(selectedProvider, credentials)}
          />
        )}
      </AnimatePresence>

      {/* Sync Modal */}
      <AnimatePresence>
        {syncProvider && (
          <SyncModal
            provider={syncProvider}
            onClose={() => setSyncProvider(null)}
            onSyncComplete={(count) => handleSyncComplete(syncProvider, count)}
          />
        )}
      </AnimatePresence>

      {/* Disconnect Confirmation */}
      <AnimatePresence>
        {disconnectTarget && (
          <DisconnectModal
            providerName={disconnectTarget.name}
            onConfirm={() => handleDisconnect(disconnectTarget)}
            onCancel={() => setDisconnectTarget(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
