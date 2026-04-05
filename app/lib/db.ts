/**
 * IndexedDB persistence layer for sessions.
 * Replaces localStorage to overcome the 5 MB limit.
 */

const DB_NAME    = "mimilang-db";
const DB_VERSION = 1;
const STORE      = "sessions";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadSessionsFromDB(): Promise<any[]> {
  const db  = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror   = () => reject(req.error);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function saveSessionsToDB(sessions: any[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.clear();
    sessions.forEach((s) => store.put(s));
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}
