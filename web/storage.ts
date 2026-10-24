import type { VirtualFile } from "../core/runtime";
import { defaultPolicies, type RuntimePolicies } from "../core/policies";
import { localizeMessage } from "../core/i18n";

// Browsers can refuse both access and writes (private mode, blocked storage or quota).
// Keep the active session usable and let the UI make the loss of persistence visible.
export function createSettings(
  storage: () => Pick<Storage, "getItem" | "setItem"> = () => localStorage,
  onFailure: () => void = () => {},
) {
  const memory = new Map<string, string>();
  let failed = false;
  const fail = () => {
    if (!failed) onFailure();
    failed = true;
  };
  return {
    getItem(key: string) {
      if (memory.has(key)) return memory.get(key)!;
      try {
        return storage().getItem(key);
      } catch {
        fail();
        return null;
      }
    },
    setItem(key: string, value: string) {
      memory.set(key, value);
      try {
        storage().setItem(key, value);
        return true;
      } catch {
        fail();
        return false;
      }
    },
    get persistent() {
      return !failed;
    },
  };
}
export function settingChoice<T extends string>(
  value: string | null,
  choices: readonly T[],
  fallback: T,
): T {
  return choices.includes(value as T) ? (value as T) : fallback;
}
export function settingInteger(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
) {
  const number = value?.trim() ? Number(value) : NaN;
  return Number.isInteger(number) && number >= min && number <= max
    ? number
    : fallback;
}
export function storedPolicies(value: string | null): RuntimePolicies {
  const result = { ...defaultPolicies };
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object") return result;
    for (const key of Object.keys(result) as (keyof RuntimePolicies)[]) {
      const candidate = parsed[key];
      const allowed =
        key === "shortCircuit"
          ? [true, false]
          : {
              divNegative: ["truncate", "floor"],
              intNegative: ["truncate", "floor"],
              roundHalf: ["away", "even"],
              forBounds: ["once", "eachIteration"],
              realOutput: ["compact", "preserve"],
              booleanOutput: ["upper", "lower"],
              filenameCase: ["sensitive", "insensitive"],
            }[key];
      if ((allowed as unknown[]).includes(candidate))
        (result as any)[key] = candidate;
    }
  } catch {}
  return result;
}

// JSON graph backup keeps Maps, Sets, shared cells and pointer cycles in random files.
export function exportFiles(files: Record<string, VirtualFile>) {
  const objects: any[] = [],
    ids = new Map<object, number>();
  function encode(value: any): any {
    if (value === undefined) return { undefined: true };
    if (value === null || typeof value !== "object") return value;
    const old = ids.get(value);
    if (old !== undefined) return { ref: old };
    const id = objects.length;
    ids.set(value, id);
    objects.push(null);
    objects[id] =
      value instanceof Map
        ? {
            type: "map",
            entries: [...value].map(([k, v]) => [encode(k), encode(v)]),
          }
        : value instanceof Set
          ? { type: "set", values: [...value].map(encode) }
          : Array.isArray(value)
            ? { type: "array", values: value.map(encode) }
            : {
                type: "object",
                entries: Object.entries(value).map(([k, v]) => [k, encode(v)]),
              };
    return { ref: id };
  }
  const root = encode(files);
  return JSON.stringify(
    { format: "pseudocode-ultra-files", version: 1, root, objects },
    null,
    2,
  );
}
export function importFiles(source: string): Record<string, VirtualFile> {
  const data = JSON.parse(source);
  if (
    data.format !== "pseudocode-ultra-files" ||
    data.version !== 1 ||
    !Array.isArray(data.objects)
  )
    throw new Error(
      localizeMessage("无效的虚拟文件备份 / Invalid virtual file backup"),
    );
  const objects = data.objects.map((node: any) =>
    node?.type === "map"
      ? new Map()
      : node?.type === "set"
        ? new Set()
        : node?.type === "array"
          ? []
          : node?.type === "object"
            ? Object.create(null)
            : null,
  );
  function decode(value: any): any {
    if (!value || typeof value !== "object") return value;
    if (value.undefined === true) return undefined;
    if (
      !Number.isInteger(value.ref) ||
      value.ref < 0 ||
      value.ref >= objects.length ||
      objects[value.ref] === null
    )
      throw new Error(
        localizeMessage("无效的文件引用 / Invalid file reference"),
      );
    return objects[value.ref];
  }
  data.objects.forEach((node: any, i: number) => {
    const target = objects[i];
    if (!target)
      throw new Error(localizeMessage("无效的文件对象 / Invalid file object"));
    if (node.type === "map")
      for (const [k, v] of node.entries) target.set(decode(k), decode(v));
    else if (node.type === "set")
      for (const v of node.values) target.add(decode(v));
    else if (node.type === "array")
      for (const v of node.values) target.push(decode(v));
    else for (const [k, v] of node.entries) target[k] = decode(v);
  });
  const files = decode(data.root);
  if (
    !files ||
    typeof files !== "object" ||
    Array.isArray(files) ||
    files instanceof Map ||
    files instanceof Set ||
    Object.values(files).some((f: any) => !f || typeof f.text !== "string")
  )
    throw new Error(localizeMessage("无效的虚拟文件 / Invalid virtual files"));
  return files;
}
export async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("pseudocode-ultra", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("workspace");
    r.onsuccess = () => {
      r.result.onversionchange = () => r.result.close();
      resolve(r.result);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () =>
      reject(
        new Error(
          localizeMessage(
            "文件数据库被其他页面占用 / Database blocked by another tab",
          ),
        ),
      );
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
    r.onerror = () => {
      db.close();
      reject(r.error);
    };
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
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error || new Error("File save aborted"));
    };
  });
}
