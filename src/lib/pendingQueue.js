/**
 * Captured pages waiting to be read, held in IndexedDB.
 *
 * Without this a capture lives only in React state, so anything that ends the
 * page — a reload, a phone locking, a tab discarded under memory pressure —
 * loses it. That is merely annoying for one photo and unacceptable for a
 * shoebox: hitting a daily API quota twenty pages into a stack would otherwise
 * mean photographing all twenty again tomorrow.
 *
 * Deliberately local. The image never leaves the device except as the body of
 * an extraction request, so this adds no server-side storage and does not
 * change what the database holds — still only the transcribed text.
 *
 * Every operation degrades to a no-op where IndexedDB is unavailable (private
 * windows, storage disabled). Losing durability is worth a warning, not a
 * broken scanner.
 */

const DB_NAME = 'glovebox'
const STORE = 'pending-scans'
const VERSION = 1

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('vehicleId', 'vehicleId', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).catch((err) => {
    dbPromise = null // let a later call try again
    throw err
  })

  return dbPromise
}

function tx(mode, run) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, mode)
        const store = transaction.objectStore(STORE)
        let result
        try {
          result = run(store)
        } catch (err) {
          reject(err)
          return
        }
        transaction.oncomplete = () => resolve(result?.result ?? result)
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      }),
  )
}

/** True if captures will actually survive a reload on this device. */
export async function isPersistenceAvailable() {
  try {
    await openDb()
    return true
  } catch {
    return false
  }
}

export async function savePending(entry) {
  try {
    await tx('readwrite', (store) => store.put(entry))
    return true
  } catch {
    return false // in-memory only; the scan still works
  }
}

export async function updatePending(id, changes) {
  try {
    await tx('readwrite', (store) => {
      const get = store.get(id)
      get.onsuccess = () => {
        if (get.result) store.put({ ...get.result, ...changes })
      }
    })
    return true
  } catch {
    return false
  }
}

export async function deletePending(id) {
  try {
    await tx('readwrite', (store) => store.delete(id))
    return true
  } catch {
    return false
  }
}

/** Everything still waiting for this vehicle, oldest capture first. */
export async function listPending(vehicleId) {
  try {
    const rows = await tx('readonly', (store) => store.index('vehicleId').getAll(vehicleId))
    return (rows ?? []).sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0))
  } catch {
    return []
  }
}

export async function clearPending(vehicleId) {
  const rows = await listPending(vehicleId)
  await Promise.all(rows.map((row) => deletePending(row.id)))
  return rows.length
}
