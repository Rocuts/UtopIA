'use client';

/**
 * localDB — cola offline de transacciones Pyme en IndexedDB.
 *
 * Usa `idb` para guardar entradas cuando el dispositivo está sin conexión.
 * Cada entrada pendiente tiene: bookId, description, kind, amount, category,
 * entryDate, synced:boolean, createdAt:string.
 *
 * El servicio de sync (syncService.ts) lee las pendientes y las POST a
 * /api/pyme/entries cuando hay conexión.
 */

import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'utopia-pyme-offline-v1';
const DB_VERSION = 1;

export interface OfflineEntry {
  localId?: number;
  bookId: string;
  description: string;
  kind: 'ingreso' | 'egreso';
  amount: number;
  category: string | null;
  entryDate: string;
  synced: boolean;
  createdAt: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('pending')) {
          const store = db.createObjectStore('pending', { keyPath: 'localId', autoIncrement: true });
          store.createIndex('synced', 'synced');
          store.createIndex('createdAt', 'createdAt');
        }
      },
    });
  }
  return dbPromise;
}

export async function enqueueEntry(entry: Omit<OfflineEntry, 'localId' | 'synced' | 'createdAt'>): Promise<number> {
  const db = await getDB();
  return db.add('pending', {
    ...entry,
    synced: false,
    createdAt: new Date().toISOString(),
  }) as Promise<number>;
}

export async function getPendingEntries(): Promise<OfflineEntry[]> {
  const db = await getDB();
  return db.getAllFromIndex('pending', 'synced', IDBKeyRange.only(false));
}

export async function markSynced(localId: number): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('pending', 'readwrite');
  const item = await tx.store.get(localId);
  if (item) {
    item.synced = true;
    await tx.store.put(item);
  }
  await tx.done;
}

export async function countPending(): Promise<number> {
  const entries = await getPendingEntries();
  return entries.length;
}
