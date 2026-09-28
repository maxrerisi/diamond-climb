// IndexedDB persistence: one autosave record + named checkpoints (metadata and payload kept separately
// so listing checkpoints never loads populations). Every call degrades to a rejected promise if IDB is unavailable.
(function (root) {
  'use strict';
  const DB = 'diamond-climb-rl', VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB, VERSION); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('ckmeta')) db.createObjectStore('ckmeta', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('ckdata')) db.createObjectStore('ckdata');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbp.catch(() => { dbp = null; });
    return dbp;
  }

  function tx(stores, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let result;
      Promise.resolve(fn(t)).then((r) => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('transaction aborted'));
    }));
  }

  const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  const Store = {
    available: () => open().then(() => true, () => false),
    get: (key) => tx(['kv'], 'readonly', (t) => req2p(t.objectStore('kv').get(key))),
    put: (key, val) => tx(['kv'], 'readwrite', (t) => { t.objectStore('kv').put(val, key); }),
    del: (key) => tx(['kv'], 'readwrite', (t) => { t.objectStore('kv').delete(key); }),

    listCheckpoints: () => tx(['ckmeta'], 'readonly', (t) => req2p(t.objectStore('ckmeta').getAll()))
      .then((rows) => rows.sort((a, b) => b.createdAt - a.createdAt)),
    saveCheckpoint: (meta, data) => tx(['ckmeta', 'ckdata'], 'readwrite', async (t) => {
      const id = await req2p(t.objectStore('ckmeta').add(meta));
      t.objectStore('ckdata').put(data, id);
      return id;
    }),
    loadCheckpoint: (id) => tx(['ckdata'], 'readonly', (t) => req2p(t.objectStore('ckdata').get(id))),
    renameCheckpoint: (id, name) => tx(['ckmeta'], 'readwrite', async (t) => {
      const s = t.objectStore('ckmeta'), m = await req2p(s.get(id));
      if (m) { m.name = name; s.put(m); }
    }),
    deleteCheckpoint: (id) => tx(['ckmeta', 'ckdata'], 'readwrite', (t) => {
      t.objectStore('ckmeta').delete(id);
      t.objectStore('ckdata').delete(id);
    }),
  };

  root.Store = Store;
})(globalThis);
