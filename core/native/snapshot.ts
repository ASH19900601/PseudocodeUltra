import { canonical } from "../model";
export type Atom =
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "null" }
  | { kind: "call"; name: string; args: Atom[] };
export interface Instruction {
  name: string;
  args: Atom[];
}
const str = (value: string): Atom => ({ kind: "string", value });
const num = (value: number): Atom => ({ kind: "number", value });
const bool = (value: boolean): Atom => ({ kind: "boolean", value });
const nil: Atom = { kind: "null" };
const call = (name: string, ...args: Atom[]): Atom => ({
  kind: "call",
  name,
  args,
});
// Encode a graph, not a JSON tree: references, cycles and private cells survive snapshots.
export function snapshotInstructions(
  files: Record<string, { text: string; records?: Record<string, any> }>,
): Instruction[] {
  const allocations: Instruction[] = [],
    links: Instruction[] = [],
    records: Instruction[] = [],
    ids = new Map<any, string>();
  let count = 0;
  const emit = (list: Instruction[], name: string, ...args: Atom[]) =>
    list.push({ name, args });
  function cell(c: any): Atom {
    if (!c || typeof c !== "object") throw new Error("Invalid snapshot cell");
    let id = ids.get(c);
    if (id) return call("storedCell", str(id));
    id = "c" + ++count;
    ids.set(c, id);
    emit(
      allocations,
      "heapNewCell",
      str(id),
      str(canonical(c.type || "UNKNOWN")),
      bool(!!c.constant),
    );
    emit(
      links,
      "heapFillCell",
      str(id),
      value(c.value),
      str(c.access || "PUBLIC"),
      str(c.owner ? canonical(c.owner) : ""),
    );
    return call("storedCell", str(id));
  }
  function value(v: any): Atom {
    if (v === null || v === undefined) return nil;
    if (typeof v === "string") return str(v);
    if (typeof v === "boolean") return bool(v);
    if (typeof v === "number") {
      if (!Number.isFinite(v))
        throw new Error("Invalid numeric snapshot value");
      return num(v);
    }
    if (v.tag === "date")
      return call("parseDate", str(v.iso.split("-").reverse().join("/")));
    if (v.tag === "enum") return call("enumValue", str(v.type), str(v.name));
    let id = ids.get(v);
    if (id) return call("storedValue", str(id));
    id = "v" + ++count;
    ids.set(v, id);
    if (v.tag === "object") {
      emit(allocations, "heapNewObject", str(id), str(v.name), bool(!!v.class));
      for (const [name, c] of v.scope.vars as Map<string, any>)
        emit(links, "heapField", str(id), str(name), cell(c));
    } else if (v.tag === "array") {
      emit(
        allocations,
        "heapNewArray",
        str(id),
        str(v.type),
        str(v.bounds.map((b: number[]) => b.join(":")).join(",")),
      );
      for (const [key, c] of v.items as Map<string, any>)
        emit(links, "heapArrayCell", str(id), str(key), cell(c));
    } else if (v.tag === "pointer") {
      emit(allocations, "heapNewPointer", str(id));
      emit(links, "heapPointerCell", str(id), v.cell ? cell(v.cell) : nil);
    } else if (v instanceof Set) {
      emit(allocations, "heapNewSet", str(id));
      for (const item of v) emit(links, "heapSetItem", str(id), value(item));
    } else throw new Error("Unsupported snapshot value");
    return call("storedValue", str(id));
  }
  for (const [name, file] of Object.entries(files))
    for (const [position, v] of Object.entries(file.records || {}))
      emit(
        records,
        "initialRecord",
        str(name),
        num(Number(position)),
        value(v),
      );
  if (count > 100000) throw new Error("Snapshot graph exceeds resource limit");
  return [...allocations, ...links, ...records];
}
