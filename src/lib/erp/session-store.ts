// ---------------------------------------------------------------------------
// ERP session store — tokens / sesiones indexados por conexión
// ---------------------------------------------------------------------------
// Cada token, cookie de sesión o refresh token rotado que obtiene un conector
// se guarda bajo una clave `proveedor:ámbito:huella`, donde la huella es un
// SHA-256 de TODOS los campos de identidad y secreto de las credenciales
// (URL base, tenant, empresa, base de datos, usuario, client id y secretos).
//
// Consecuencias:
//   - Dos empresas del mismo proveedor nunca comparten entrada: cualquier
//     diferencia en sus credenciales produce otra huella.
//   - Unas credenciales con el mismo usuario pero otro secreto tampoco reciben
//     el token emitido para el secreto correcto.
//   - Los secretos no se guardan en claro como clave del Map.
//
// Los conectores reciben el store por constructor. `getConnector` (registry)
// les pasa `sharedERPSessionStore` para reutilizar un token vigente entre
// llamadas de la MISMA conexión; una instancia creada con `new` sin argumento
// tiene su propio store (aislamiento de pruebas).
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import type { ERPCredentials } from './types';

/** Campos que identifican la conexión o la autentican. `tokenExpiry` no cuenta. */
const IDENTITY_FIELDS = [
  'baseUrl',
  'tenantId',
  'companyId',
  'databaseName',
  'username',
  'clientId',
  'apiKey',
  'apiToken',
  'password',
  'accessToken',
  'refreshToken',
  'clientSecret',
] as const satisfies ReadonlyArray<keyof ERPCredentials>;

/** SHA-256 hex de la identidad completa de la conexión (proveedor + credenciales). */
export function credentialFingerprint(credentials: ERPCredentials): string {
  const canonical = IDENTITY_FIELDS.map((field) => [field, credentials[field] ?? null]);
  return createHash('sha256')
    .update(JSON.stringify([credentials.provider, canonical]))
    .digest('hex');
}

/** Clave de caché para un estado (`token`, `session`, `refresh`, …) de UNA conexión. */
export function connectionKey(credentials: ERPCredentials, scope: string): string {
  return `${credentials.provider}:${scope}:${credentialFingerprint(credentials)}`;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

export interface ResolveOptions {
  /** Margen antes de la expiración a partir del cual se renueva. */
  refreshMarginMs?: number;
  /** Ignora la entrada vigente y vuelve a autenticar (p. ej. testConnection o 401). */
  forceRefresh?: boolean;
}

export class ERPSessionStore {
  private readonly entries = new Map<string, Entry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly maxEntries = 1000) {}

  get<T>(key: string, refreshMarginMs = 0): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt - refreshMarginMs) {
      if (Date.now() >= entry.expiresAt) this.entries.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    if (this.entries.size >= this.maxEntries) this.prune();
    this.entries.set(key, { value, expiresAt: Date.now() + Math.max(0, ttlMs) });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Devuelve el valor vigente de `key` o lo obtiene con `loader`. Las cargas
   * concurrentes de la MISMA clave comparten una sola petición; claves
   * distintas (otras credenciales) nunca se mezclan.
   */
  async resolve<T>(
    key: string,
    loader: () => Promise<{ value: T; ttlMs: number }>,
    options: ResolveOptions = {},
  ): Promise<T> {
    if (!options.forceRefresh) {
      const cached = this.get<T>(key, options.refreshMarginMs ?? 0);
      if (cached !== null) return cached;
      const pending = this.inFlight.get(key) as Promise<T> | undefined;
      if (pending) return pending;
    }

    const promise = (async () => {
      const { value, ttlMs } = await loader();
      this.set(key, value, ttlMs);
      return value;
    })();
    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    }
  }

  /** Objeto auxiliar por conexión (p. ej. limitador de tasa) con TTL deslizante. */
  getOrCreate<T>(key: string, factory: () => T, ttlMs = 60 * 60 * 1000): T {
    const existing = this.get<T>(key);
    if (existing !== null) {
      this.set(key, existing, ttlMs);
      return existing;
    }
    const created = factory();
    this.set(key, created, ttlMs);
    return created;
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now >= entry.expiresAt) this.entries.delete(key);
    }
    // Si sigue lleno, descarta las entradas más antiguas (orden de inserción).
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

/** Store del proceso: cada entrada pertenece a una sola conexión (clave con huella). */
export const sharedERPSessionStore = new ERPSessionStore();
