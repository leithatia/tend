const DB_NAME = 'daily-planner-db';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tasks')) {
        db.createObjectStore('tasks', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('exceptions')) {
        const store = db.createObjectStore('exceptions', { keyPath: ['taskId', 'date'] });
        store.createIndex('taskId', 'taskId');
        store.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('completions')) {
        const store = db.createObjectStore('completions', { keyPath: ['taskId', 'date'] });
        store.createIndex('taskId', 'taskId');
        store.createIndex('date', 'date');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(storeNames, mode) {
  const db = await openDB();
  return db.transaction(storeNames, mode);
}

async function getAll(storeName) {
  const t = await tx([storeName], 'readonly');
  return reqToPromise(t.objectStore(storeName).getAll());
}

async function put(storeName, value) {
  const t = await tx([storeName], 'readwrite');
  return reqToPromise(t.objectStore(storeName).put(value));
}

async function deleteKey(storeName, key) {
  const t = await tx([storeName], 'readwrite');
  return reqToPromise(t.objectStore(storeName).delete(key));
}

async function getAllByIndex(storeName, indexName, value) {
  const t = await tx([storeName], 'readonly');
  return reqToPromise(t.objectStore(storeName).index(indexName).getAll(value));
}

export const Tasks = {
  getAll: () => getAll('tasks'),
  put: (task) => put('tasks', task),
  delete: (id) => deleteKey('tasks', id),
};

export const Exceptions = {
  getAll: () => getAll('exceptions'),
  put: (exception) => put('exceptions', exception),
  delete: (taskId, date) => deleteKey('exceptions', [taskId, date]),
  getForTask: (taskId) => getAllByIndex('exceptions', 'taskId', taskId),
};

export const Completions = {
  getAll: () => getAll('completions'),
  put: (completion) => put('completions', completion),
  delete: (taskId, date) => deleteKey('completions', [taskId, date]),
  getForTask: (taskId) => getAllByIndex('completions', 'taskId', taskId),
};

export async function deleteTaskCascade(taskId) {
  const [exceptions, completions] = await Promise.all([
    Exceptions.getForTask(taskId),
    Completions.getForTask(taskId),
  ]);
  await Promise.all([
    Tasks.delete(taskId),
    ...exceptions.map((e) => Exceptions.delete(e.taskId, e.date)),
    ...completions.map((c) => Completions.delete(c.taskId, c.date)),
  ]);
}

export async function exportAll() {
  const [tasks, exceptions, completions] = await Promise.all([
    Tasks.getAll(),
    Exceptions.getAll(),
    Completions.getAll(),
  ]);
  return {
    app: 'daily-planner',
    schemaVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    tasks,
    exceptions,
    completions,
  };
}

export async function importAll(data) {
  if (!data || !Array.isArray(data.tasks)) {
    throw new Error('That file does not look like a daily-planner backup.');
  }
  const db = await openDB();
  const t = db.transaction(['tasks', 'exceptions', 'completions'], 'readwrite');
  const stores = {
    tasks: t.objectStore('tasks'),
    exceptions: t.objectStore('exceptions'),
    completions: t.objectStore('completions'),
  };
  stores.tasks.clear();
  stores.exceptions.clear();
  stores.completions.clear();
  (data.tasks || []).forEach((x) => stores.tasks.put(x));
  (data.exceptions || []).forEach((x) => stores.exceptions.put(x));
  (data.completions || []).forEach((x) => stores.completions.put(x));

  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
