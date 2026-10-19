import type { LibraryEntry } from "./types";
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("litedisplay", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("blueprints", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
export async function libraryList(): Promise<LibraryEntry[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("blueprints", "readonly"),
      r = tx.objectStore("blueprints").getAll();
    tx.oncomplete = () => {
      db.close();
      resolve(
        (r.result as LibraryEntry[]).sort((a, b) => b.savedAt - a.savedAt),
      );
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function libraryPut(entry: LibraryEntry) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("blueprints", "readwrite");
    tx.objectStore("blueprints").put(entry);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function libraryDelete(id: string) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("blueprints", "readwrite");
    tx.objectStore("blueprints").delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export const fingerprint = async (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
export function download(
  data: BlobPart | Blob,
  name: string,
  type = "application/octet-stream",
) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
