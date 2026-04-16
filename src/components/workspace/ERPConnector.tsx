'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plug,
  CheckCircle,
  AlertCircle,
  Loader2,
  ChevronRight,
  X,
  RefreshCw,
  Database,
  Globe,
  Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ERPProvider } from '@/lib/erp/types';

interface ProviderCard {
  id: ERPProvider;
  name: string;
  country: 'colombia' | 'international';
  authType: string;
  supportsPUC: boolean;
  supportsDIAN: boolean;
}

const COLOMBIAN_PROVIDERS: ProviderCard[] = [
  { id: 'alegra', name: 'Alegra', country: 'colombia', authType: 'Email + API Token', supportsPUC: true, supportsDIAN: true },
  { id: 'siigo', name: 'Siigo', country: 'colombia', authType: 'Usuario + Access Key', supportsPUC: true, supportsDIAN: true },
  { id: 'helisa', name: 'Helisa', country: 'colombia', authType: 'HMAC Key', supportsPUC: true, supportsDIAN: true },
  { id: 'world_office', name: 'World Office', country: 'colombia', authType: 'JWT Token', supportsPUC: true, supportsDIAN: true },
  { id: 'contapyme', name: 'ContaPyme', country: 'colombia', authType: 'API Token', supportsPUC: true, supportsDIAN: true },
];

const INTERNATIONAL_PROVIDERS: ProviderCard[] = [
  { id: 'sap_b1', name: 'SAP Business One', country: 'international', authType: 'Usuario + Contrasena + DB', supportsPUC: false, supportsDIAN: false },
  { id: 'dynamics_365', name: 'Dynamics 365', country: 'international', authType: 'OAuth 2.0 (Azure AD)', supportsPUC: false, supportsDIAN: false },
  { id: 'quickbooks', name: 'QuickBooks Online', country: 'international', authType: 'OAuth 2.0', supportsPUC: false, supportsDIAN: false },
  { id: 'xero', name: 'Xero', country: 'international', authType: 'OAuth 2.0', supportsPUC: false, supportsDIAN: false },
  { id: 'odoo', name: 'Odoo', country: 'international', authType: 'URL + Usuario + Contrasena', supportsPUC: true, supportsDIAN: false },
];

type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

interface ConnectFormProps {
  provider: ProviderCard;
  onClose: () => void;
  onConnected: () => void;
}

function ConnectForm({ provider, onClose, onConnected }: ConnectFormProps) {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  const fieldDefs = getFieldsForProvider(provider.id);

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
        throw new Error(data.error || 'Error de conexion');
      }

      setStatus('connected');
      setTimeout(onConnected, 1500);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Error de conexion');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e5e5]">
          <div className="flex items-center gap-2">
            <Plug className="w-4 h-4 text-[#D4A017]" />
            <h3 className="text-sm font-semibold text-[#0a0a0a]">Conectar {provider.name}</h3>
          </div>
          <button onClick={onClose} className="p-1 text-[#a3a3a3] hover:text-[#525252] transition-colors">
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
                Autenticacion: <span className="text-[#525252] font-medium">{provider.authType}</span>
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
            <button onClick={onClose} className="px-4 py-2 text-xs font-medium text-[#525252] hover:bg-[#fafafa] rounded-lg transition-colors">
              Cancelar
            </button>
            <button
              onClick={handleConnect}
              disabled={status === 'connecting' || fieldDefs.some(f => f.required && !fields[f.key])}
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
        { key: 'username', label: 'Email de Alegra', placeholder: 'usuario@empresa.com', required: true },
        { key: 'apiToken', label: 'API Token', placeholder: 'Token de la configuracion de Alegra', secret: true, required: true, hint: 'Configuracion > Integraciones > Token API' },
      ];
    case 'siigo':
      return [
        { key: 'username', label: 'Usuario (email)', placeholder: 'usuario@empresa.com', required: true },
        { key: 'apiKey', label: 'Access Key', placeholder: 'Clave de acceso de Siigo', secret: true, required: true, hint: 'Configuracion > Alianzas e Integraciones > Credenciales' },
      ];
    case 'helisa':
      return [
        { key: 'baseUrl', label: 'URL del servidor', placeholder: 'https://miempresa.helisa.com/KansasWS', required: true },
        { key: 'apiKey', label: 'Clave HMAC', placeholder: 'Clave de firma proporcionada por Helisa', secret: true, required: true },
      ];
    case 'world_office':
      return [
        { key: 'baseUrl', label: 'URL del tenant', placeholder: 'https://miempresa.worldoffice.cloud', required: true },
        { key: 'apiToken', label: 'JWT Token', placeholder: 'Token de Configuracion General > API', secret: true, required: true },
      ];
    case 'contapyme':
      return [
        { key: 'baseUrl', label: 'URL del servidor', placeholder: 'https://miempresa.contapyme.com', required: true },
        { key: 'apiToken', label: 'API Token', placeholder: 'Token de autenticacion', secret: true, required: true },
      ];
    case 'sap_b1':
      return [
        { key: 'baseUrl', label: 'URL del Service Layer', placeholder: 'https://servidor:50000', required: true },
        { key: 'username', label: 'Usuario SAP', placeholder: 'manager', required: true },
        { key: 'password', label: 'Contrasena', placeholder: '', secret: true, required: true },
        { key: 'databaseName', label: 'Base de datos (CompanyDB)', placeholder: 'SBODEMOCO', required: true },
      ];
    case 'dynamics_365':
      return [
        { key: 'tenantId', label: 'Tenant ID (Azure AD)', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', required: true },
        { key: 'clientId', label: 'Client ID', placeholder: 'ID de aplicacion registrada en Azure', required: true },
        { key: 'clientSecret', label: 'Client Secret', placeholder: '', secret: true, required: true },
        { key: 'companyId', label: 'Company ID (BC)', placeholder: 'ID de la empresa en Business Central', required: true },
      ];
    case 'quickbooks':
      return [
        { key: 'clientId', label: 'Client ID', placeholder: 'ID de app en developer.intuit.com', required: true },
        { key: 'clientSecret', label: 'Client Secret', placeholder: '', secret: true, required: true },
        { key: 'refreshToken', label: 'Refresh Token', placeholder: 'Token de refresco OAuth', secret: true, required: true },
        { key: 'companyId', label: 'Realm ID (Company)', placeholder: 'ID numerico de la empresa', required: true },
      ];
    case 'xero':
      return [
        { key: 'clientId', label: 'Client ID', placeholder: 'ID de app en developer.xero.com', required: true },
        { key: 'clientSecret', label: 'Client Secret', placeholder: '', secret: true, required: true },
        { key: 'refreshToken', label: 'Refresh Token', placeholder: 'Token OAuth', secret: true, required: true },
        { key: 'tenantId', label: 'Tenant ID (xero-tenant-id)', placeholder: 'ID de la organizacion Xero', required: true },
      ];
    case 'odoo':
      return [
        { key: 'baseUrl', label: 'URL de Odoo', placeholder: 'https://miempresa.odoo.com', required: true },
        { key: 'databaseName', label: 'Base de datos', placeholder: 'miempresa-production', required: true },
        { key: 'username', label: 'Usuario (email)', placeholder: 'admin@empresa.com', required: true },
        { key: 'password', label: 'Contrasena o API Key', placeholder: '', secret: true, required: true },
      ];
  }
}

export function ERPConnector() {
  const [selectedProvider, setSelectedProvider] = useState<ProviderCard | null>(null);
  const [connectedProviders, setConnectedProviders] = useState<Set<ERPProvider>>(new Set());

  return (
    <div className="space-y-6">
      {/* Colombian ERPs */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-[#D4A017]" />
          <h3 className="text-xs font-bold text-[#0a0a0a] uppercase tracking-wider">ERPs Colombianos</h3>
          <span className="text-[10px] text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">PUC + DIAN</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {COLOMBIAN_PROVIDERS.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedProvider(p)}
              className={cn(
                'flex items-center gap-3 p-3 rounded-xl border text-left transition-all group',
                connectedProviders.has(p.id)
                  ? 'border-[#22C55E]/30 bg-[#F0FDF4]'
                  : 'border-[#e5e5e5] bg-white hover:border-[#D4A017] hover:shadow-sm',
              )}
            >
              <div className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold',
                connectedProviders.has(p.id)
                  ? 'bg-[#22C55E]/15 text-[#16A34A]'
                  : 'bg-[#fafafa] text-[#525252] group-hover:bg-[#D4A017]/10 group-hover:text-[#D4A017]',
              )}>
                {connectedProviders.has(p.id) ? <CheckCircle className="w-4 h-4" /> : <Database className="w-4 h-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold text-[#0a0a0a]">{p.name}</span>
                <p className="text-[10px] text-[#a3a3a3]">{p.authType}</p>
              </div>
              {!connectedProviders.has(p.id) && (
                <ChevronRight className="w-3.5 h-3.5 text-[#d4d4d4] group-hover:text-[#D4A017] shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* International ERPs */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Globe className="w-4 h-4 text-[#525252]" />
          <h3 className="text-xs font-bold text-[#0a0a0a] uppercase tracking-wider">ERPs Internacionales</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {INTERNATIONAL_PROVIDERS.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedProvider(p)}
              className={cn(
                'flex items-center gap-3 p-3 rounded-xl border text-left transition-all group',
                connectedProviders.has(p.id)
                  ? 'border-[#22C55E]/30 bg-[#F0FDF4]'
                  : 'border-[#e5e5e5] bg-white hover:border-[#0a0a0a] hover:shadow-sm',
              )}
            >
              <div className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold',
                connectedProviders.has(p.id)
                  ? 'bg-[#22C55E]/15 text-[#16A34A]'
                  : 'bg-[#fafafa] text-[#525252]',
              )}>
                {connectedProviders.has(p.id) ? <CheckCircle className="w-4 h-4" /> : <Database className="w-4 h-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold text-[#0a0a0a]">{p.name}</span>
                <p className="text-[10px] text-[#a3a3a3]">{p.authType}</p>
              </div>
              {!connectedProviders.has(p.id) && (
                <ChevronRight className="w-3.5 h-3.5 text-[#d4d4d4] shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Connection Modal */}
      <AnimatePresence>
        {selectedProvider && (
          <ConnectForm
            provider={selectedProvider}
            onClose={() => setSelectedProvider(null)}
            onConnected={() => {
              setConnectedProviders(prev => new Set([...prev, selectedProvider.id]));
              setSelectedProvider(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
