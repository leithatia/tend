import { exportAll, importAll } from './db.js';

const LAST_EXPORT_KEY = 'dp_lastExportAt';

// localStorage can throw (private browsing, storage disabled) — this is a
// convenience nudge, not core data, so failures here are silently ignored.
export function getLastExportAt() {
  try {
    return Number(localStorage.getItem(LAST_EXPORT_KEY) || 0);
  } catch {
    return 0;
  }
}

function recordExportNow() {
  try {
    localStorage.setItem(LAST_EXPORT_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

export async function downloadExport() {
  const data = await exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tend-backup-${data.exportedAt.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  recordExportNow();
}

function readFileAsJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch {
        reject(new Error('That file is not valid JSON.'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export async function importFromFile(file) {
  const data = await readFileAsJSON(file);
  await importAll(data);
}
