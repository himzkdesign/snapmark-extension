/**
 * Large screenshot handoff via IndexedDB (extension origin), avoiding chrome.storage.local ~5MB quota.
 * @see https://developer.chrome.com/docs/extensions/mv3/storage/
 */
(function () {
  const DB_NAME = "SnapMarkDB";
  const DB_VERSION = 1;
  const STORE = "screenshots";
  const KEY_CURRENT = "current";

  /**
   * @param {string} dataUrl
   * @param {string} type e.g. "visible" | "fullpage"
   * @returns {Promise<void>}
   */
  async function saveScreenshotToIdb(dataUrl, type) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = /** @type {IDBOpenDBRequest} */ (event.target).result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
      request.onsuccess = (event) => {
        const db = /** @type {IDBOpenDBRequest} */ (event.target).result;
        if (!db.objectStoreNames.contains(STORE)) {
          reject(new Error("SnapMarkDB: missing object store"));
          return;
        }
        const tx = db.transaction(STORE, "readwrite");
        tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
        tx.oncomplete = () => resolve();
        tx.objectStore(STORE).put({ dataUrl, type }, KEY_CURRENT);
      };
    });
  }

  /**
   * @returns {Promise<{ dataUrl: string; type: string } | null>}
   */
  async function loadScreenshotFromIdb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = /** @type {IDBOpenDBRequest} */ (event.target).result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
      request.onsuccess = (event) => {
        const db = /** @type {IDBOpenDBRequest} */ (event.target).result;
        if (!db.objectStoreNames.contains(STORE)) {
          resolve(null);
          return;
        }
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(KEY_CURRENT);
        req.onerror = () => reject(req.error || new Error("IndexedDB read failed"));
        req.onsuccess = () => {
          const v = req.result;
          if (!v || typeof v.dataUrl !== "string") {
            resolve(null);
            return;
          }
          resolve({ dataUrl: v.dataUrl, type: typeof v.type === "string" ? v.type : "visible" });
        };
      };
    });
  }

  /** @returns {Promise<void>} */
  async function clearScreenshotFromIdb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
      request.onsuccess = (event) => {
        const db = /** @type {IDBOpenDBRequest} */ (event.target).result;
        if (!db.objectStoreNames.contains(STORE)) {
          resolve();
          return;
        }
        const tx = db.transaction(STORE, "readwrite");
        tx.onerror = () => reject(tx.error || new Error("IndexedDB clear failed"));
        tx.oncomplete = () => resolve();
        tx.objectStore(STORE).delete(KEY_CURRENT);
      };
    });
  }

  const g = typeof globalThis !== "undefined" ? globalThis : window;
  g.saveScreenshotToIdb = saveScreenshotToIdb;
  g.loadScreenshotFromIdb = loadScreenshotFromIdb;
  g.clearScreenshotFromIdb = clearScreenshotFromIdb;
})();
