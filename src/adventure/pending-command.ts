import { storedPlanningEnvelopeSchema, type StoredPlanningEnvelope } from '../shared/adventure-recovery'

const databaseName = 'lifespace-adventure-pending-v1'
const storeName = 'commands'
const channelName = 'lifespace-adventure-pending-v1'
const tabId = crypto.randomUUID()

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(storeName)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Storage blocked'))
    request.onsuccess = () => resolve(request.result)
  })
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  const db = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason); return }
      const tx = db.transaction(storeName, mode, { durability: 'strict' })
      const request = action(tx.objectStore(storeName))
      const abort = () => { try { tx.abort() } catch { /* transaction already settled */ } }
      signal?.addEventListener('abort', abort, { once: true })
      const cleanup = () => signal?.removeEventListener('abort', abort)
      tx.oncomplete = () => { cleanup(); resolve(request.result) }
      tx.onerror = () => { cleanup(); reject(tx.error) }
      tx.onabort = () => { cleanup(); reject(tx.error ?? new Error('Storage aborted')) }
    })
  } finally { db.close() }
}

export async function readPending(owner: string): Promise<StoredPlanningEnvelope | undefined> {
  const value: unknown = await transaction('readonly', store => store.get(owner))
  if (value === undefined) return undefined
  return storedPlanningEnvelopeSchema.parse(value)
}

export async function savePending(owner: string, envelope: StoredPlanningEnvelope, signal?: AbortSignal) {
  await transaction('readwrite', store => store.add(storedPlanningEnvelopeSchema.parse(envelope), owner), signal)
  announce()
}

export async function clearPending(owner: string, envelope: StoredPlanningEnvelope, signal?: AbortSignal) {
  const value = await readPending(owner)
  if (!value || JSON.stringify(value) !== JSON.stringify(storedPlanningEnvelopeSchema.parse(envelope))) throw new Error('Pending command changed')
  await transaction('readwrite', store => store.delete(owner), signal)
  announce()
}

export class PendingBusyError extends Error {}

export function withPendingLock<T>(owner: string, action: () => Promise<T>, onlyIfAvailable = false): Promise<T> {
  if (!navigator.locks || !indexedDB || typeof BroadcastChannel === 'undefined') return Promise.reject(new Error('Safe storage unavailable'))
  const name = `lifespace-adventure-command:${owner}`
  if (onlyIfAvailable) return navigator.locks.request(name, { ifAvailable: true }, lock => {
    if (!lock) throw new PendingBusyError()
    return action()
  })
  return navigator.locks.request(name, action)
}

function announce() {
  const channel = new BroadcastChannel(channelName)
  channel.postMessage(tabId)
  channel.close()
}

export function watchPending(onChange: () => void) {
  const channel = new BroadcastChannel(channelName)
  channel.onmessage = event => { if (event.data !== tabId) onChange() }
  return () => channel.close()
}
