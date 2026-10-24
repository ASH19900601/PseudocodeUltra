import type { VirtualFile } from "../core/runtime";
export async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("pseudocode-ultra", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("workspace");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function loadFiles(): Promise<Record<string, VirtualFile>> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const r = db.transaction("workspace").objectStore("workspace").get("files");
    r.onsuccess = () => {
      resolve(r.result || {});
      db.close();
    };
    r.onerror = () => reject(r.error);
  });
}
export async function saveFiles(files: Record<string, VirtualFile>) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("workspace", "readwrite");
    tx.objectStore("workspace").put(files, "files");
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}
