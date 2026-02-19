/**
 * IndexedDB persistence for the Novel Indicator browser engine worker.
 * Raw store/retrieve only; worker owns run state and merge logic.
 */

const DB_NAME = 'novel-indicator-browser-db'
const DB_VERSION = 2
const RUN_STORE_NAME = 'runs'
const KLINE_STORE_NAME = 'klines'

let dbPromise: Promise<IDBDatabase> | null = null

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(RUN_STORE_NAME)) {
        db.createObjectStore(RUN_STORE_NAME, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(KLINE_STORE_NAME)) {
        db.createObjectStore(KLINE_STORE_NAME, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IDB open error'))
  })
  return dbPromise
}

export async function putRunStore(id: string, data: { id: string; bundle: unknown }): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(RUN_STORE_NAME, 'readwrite')
    tx.objectStore(RUN_STORE_NAME).put(data)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IDB write error'))
  })
}

export async function getAllRunStore(): Promise<Array<{ id: string; bundle: unknown }>> {
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(RUN_STORE_NAME, 'readonly')
    const req = tx.objectStore(RUN_STORE_NAME).getAll()
    req.onsuccess = () => resolve((req.result ?? []) as Array<{ id: string; bundle: unknown }>)
    req.onerror = () => reject(req.error ?? new Error('IDB read error'))
  })
}

export async function getKlineCache(key: string): Promise<{ fetched_at: number; rows: unknown[] } | null> {
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(KLINE_STORE_NAME, 'readonly')
    const req = tx.objectStore(KLINE_STORE_NAME).get(key)
    req.onsuccess = () =>
      resolve((req.result as { key: string; fetched_at: number; rows: unknown[] } | undefined) ?? null)
    req.onerror = () => reject(req.error ?? new Error('IDB read error'))
  })
}

export async function putKlineCache(key: string, fetched_at: number, rows: unknown[]): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KLINE_STORE_NAME, 'readwrite')
    tx.objectStore(KLINE_STORE_NAME).put({ key, fetched_at, rows })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IDB write error'))
  })
}
