/**
 * Local draft recovery: the editor writes every change here and clears it after a successful save, so a
 * crash or a lost connection never loses more than the last keystrokes. IndexedDB when available,
 * memory otherwise (tests inject their own store with `setDraftStore`).
 */

const DB = 'folioverse-writer';
const STORE = 'drafts';

/** @typedef {{ content: any, baseRevision: number, savedAt: string }} Draft */
/** @typedef {{ get: (key: string) => Promise<Draft | undefined>, put: (key: string, d: Draft) => Promise<void>, remove: (key: string) => Promise<void> }} DraftStore */

/** @returns {DraftStore} */
export function memoryDraftStore() {
  const m = new Map();
  return {
    get: async (k) => (m.has(k) ? structuredClone(m.get(k)) : undefined),
    put: async (k, d) => void m.set(k, structuredClone(d)),
    remove: async (k) => void m.delete(k),
  };
}

/** @param {IDBFactory} idb @returns {DraftStore} */
export function indexedDbDraftStore(idb) {
  let opening = null;
  const open = () =>
    (opening ??= new Promise((resolve, reject) => {
      const req = idb.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  };
  return {
    get: (k) => run('readonly', (s) => s.get(k)),
    put: async (k, d) => void (await run('readwrite', (s) => s.put(d, k))),
    remove: async (k) => void (await run('readwrite', (s) => s.delete(k))),
  };
}

let store = typeof indexedDB === 'undefined' ? memoryDraftStore() : indexedDbDraftStore(indexedDB);

export const draftStore = {
  get: (k) => store.get(k).catch(() => undefined),
  put: (k, d) => store.put(k, d).catch(() => undefined),
  remove: (k) => store.remove(k).catch(() => undefined),
};

/** @param {DraftStore} s */
export function setDraftStore(s) {
  store = s;
}

export const draftKey = (workspaceId, nodeId) => `${workspaceId}:${nodeId}`;
