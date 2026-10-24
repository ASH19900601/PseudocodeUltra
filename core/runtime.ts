import {
  DiagnosticError,
  ruleSource,
  profile,
  signatures,
  type DialectId,
  type Profile,
} from "./dialects";
import { keywords, type Expr } from "./lexer";
import { parse, type Node, type Program } from "./parser";
import { analyze } from "./semantic";
import { Model } from "./model";
import { optimizeLoop } from "./fast";
import { builtinSignature } from "./builtins";
import { defaultPolicies, round, type RuntimePolicies } from "./policies";
export interface Cell {
  type: string;
  value: any;
  constant?: boolean;
  access?: string;
  owner?: string;
  name?: string;
}
export class Scope {
  vars = new Map<string, Cell>();
  constructor(public parent?: Scope) {}
  find(n: string): Cell | undefined {
    return this.vars.get(n.toUpperCase()) || this.parent?.find(n);
  }
  add(n: string, c: Cell) {
    const k = n.toUpperCase();
    if (this.vars.has(k))
      throw new DiagnosticError(
        "DUPLICATE",
        `重复声明 / Duplicate identifier ${n}`,
      );
    this.vars.set(k, c);
  }
}
export interface Event {
  kind: "step" | "trace" | "input" | "output" | "warning";
  phase?: string;
  nodeKind?: string;
  line: number;
  variables?: Record<string, any>;
  values?: Record<string, any>;
  stack?: string[];
  text?: string;
}
type G = Generator<Event, any, any>;
interface Arr {
  tag: "array";
  bounds: [number, number][];
  items: Map<string, Cell>;
  type: string;
}
interface Obj {
  class?: boolean;
  tag: "object";
  name: string;
  scope: Scope;
}
interface Ptr {
  tag: "pointer";
  cell: Cell | null;
}
interface DateVal {
  tag: "date";
  iso: string;
}
export interface VirtualFile {
  text: string;
  records?: Record<string, any>;
}
export interface RunOptions {
  strict?: boolean;
  maxSteps?: number;
  seed?: number;
  files?: Record<string, VirtualFile>;
  clock?: string;
  maxDepth?: number;
  profileOptions?: Parameters<typeof profile>[1];
  trace?: boolean;
  fast?: boolean;
  policies?: Partial<RuntimePolicies>;
}
export function display(v: any, seen = new Set<any>(), depth = 0): string {
  if (depth > 20) return "…";
  if (v && typeof v === "object") {
    if (seen.has(v)) return "[reference]";
    seen.add(v);
  }
  if (v === undefined) return "未初始化";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v?.tag === "enum") return v.name;
  if (v?.tag === "date") {
    const [y, m, d] = v.iso.split("-");
    return `${d}/${m}/${y}`;
  }
  if (v?.tag === "pointer")
    return v.cell ? "^" + display(v.cell.value, seen, depth + 1) : "NULL";
  if (v?.tag === "array")
    return (
      "[" +
      [...v.items.values()]
        .map((c) => display(c.value, seen, depth + 1))
        .join(", ") +
      "]"
    );
  if (v?.tag === "object")
    return (
      "{" +
      [...v.scope.vars]
        .map(([k, c]) => k + ": " + display(c.value, seen, depth + 1))
        .join(", ") +
      "}"
    );
  if (v instanceof Set)
    return (
      "{" + [...v].map((x) => display(x, seen, depth + 1)).join(", ") + "}"
    );
  return String(v);
}
function sameValue(a: any, b: any): boolean {
  if (a?.tag === "date" && b?.tag === "date") return a.iso === b.iso;
  if (a?.tag === "enum" && b?.tag === "enum")
    return a.type === b.type && a.ordinal === b.ordinal;
  if (a?.tag === "pointer" && b?.tag === "pointer") return a.cell === b.cell;
  return a === b;
}
function valueSet(values: Iterable<any>) {
  const set = new Set<any>();
  for (const value of values)
    if (![...set].some((v) => sameValue(v, value))) set.add(value);
  return set;
}
function clone(v: any): any {
  if (v?.tag === "object" && v.class) return v;
  if (v?.tag === "pointer") return { ...v };
  if (v?.tag === "array")
    return {
      ...v,
      items: new Map(
        [...v.items].map(([k, c]: any) => [k, { ...c, value: clone(c.value) }]),
      ),
    };
  if (v?.tag === "object") {
    const s = new Scope();
    for (const [k, c] of v.scope.vars)
      s.vars.set(k, { ...c, value: clone(c.value) });
    return { ...v, scope: s };
  }
  if (v instanceof Set) return new Set(v);
  return v && typeof v === "object" ? { ...v } : v;
}
function hydrate(v: any, seen = new Map<any, any>()): any {
  if (!v || typeof v !== "object") return v;
  if (seen.has(v)) return seen.get(v);
  if (v instanceof Map) {
    const out = new Map();
    seen.set(v, out);
    for (const [key, value] of v) out.set(key, hydrate(value, seen));
    return out;
  }
  if (v instanceof Set) {
    const out = new Set();
    seen.set(v, out);
    for (const value of v) out.add(hydrate(value, seen));
    return out;
  }
  if (v.vars instanceof Map) {
    const out = new Scope();
    seen.set(v, out);
    out.vars = hydrate(v.vars, seen);
    out.parent = hydrate(v.parent, seen);
    return out;
  }
  const out: any = Array.isArray(v) ? [] : {};
  seen.set(v, out);
  for (const [key, value] of Object.entries(v))
    Object.defineProperty(out, key, {
      value: hydrate(value, seen),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  return out;
}
class Returned {
  constructor(public value: any) {}
}
export class Machine {
  p: Profile;
  program: Program;
  model: Model;
  policies: RuntimePolicies;
  column = 1;
  global = new Scope();
  modules = new Map<string, Node>();
  types = new Map<string, Node>();
  files: Record<string, VirtualFile>;
  opened = new Map<string, { mode: string; pos: number }>();
  stack: string[] = [];
  steps = 0;
  line = 1;
  currentScope: Scope = this.global;
  seed: number;
  generator: G;
  warnings: string[] = [];
  constructor(
    source: string,
    id: DialectId = "0478",
    public options: RunOptions = {},
  ) {
    this.policies = { ...defaultPolicies, ...options.policies };
    this.p = profile(id, {
      ...options.profileOptions,
      ...(!options.profileOptions?.strictness && options.strict === false
        ? { strictness: "learning" as const }
        : {}),
    });
    this.program = analyze(source, this.p);
    this.model = new Model(this.program);
    this.files = Object.assign(
      Object.create(null),
      hydrate(structuredClone(options.files || {})),
    );
    if (this.policies.filenameCase === "insensitive")
      this.files = Object.fromEntries(
        Object.entries(this.files).map(([k, v]) => [k.toLowerCase(), v]),
      );
    this.seed = options.seed ?? 123456789;
    this.register(this.program.body);
    this.generator = this.execute();
  }
  fail(code: string, msg: string): never {
    const error = new DiagnosticError(code, msg, this.line, this.column);
    (error as any).frames = [...this.stack];
    error.source = ruleSource(code, this.p);
    throw error;
  }
  register(nodes: Node[]) {
    for (const n of nodes) {
      if (["procedure", "function"].includes(n.kind)) {
        if (this.modules.has(n.name.toUpperCase()))
          this.fail("DUPLICATE", "子程序重名 / Duplicate module");
        this.modules.set(n.name.toUpperCase(), n);
      }
      if (["type", "class"].includes(n.kind))
        this.types.set(n.name.toUpperCase(), n);
    }
  }
  snapshot(s: Scope) {
    const v: Record<string, any> = {};
    let current: Scope | undefined = s;
    while (current) {
      for (const [k, c] of current.vars) if (!(k in v)) v[k] = display(c.value);
      current = current.parent;
    }
    return v;
  }
  inspect(s: Scope) {
    const values: Record<string, any> = {};
    const seen = new Set<any>();
    let count = 0;
    const value = (v: any, depth = 0): any => {
      if (++count > 500 || depth > 6) return "…";
      if (v === undefined) return "未初始化";
      if (v?.tag === "pointer") return display(v);
      if (v?.tag === "date" || v?.tag === "enum") return display(v);
      if (v && typeof v === "object") {
        if (seen.has(v)) return "[reference]";
        seen.add(v);
        if (v.tag === "array")
          return Object.fromEntries(
            [...v.items].map(([k, c]: any) => [
              "[" + k + "]",
              value(c.value, depth + 1),
            ]),
          );
        if (v.tag === "object")
          return Object.fromEntries(
            [...v.scope.vars].map(([k, c]: any) => [
              k,
              value(c.value, depth + 1),
            ]),
          );
        if (v instanceof Set) return [...v].map((x) => value(x, depth + 1));
      }
      return v;
    };
    for (let current: Scope | undefined = s; current; current = current.parent)
      for (const [k, c] of current.vars)
        if (!(k in values)) values[k] = value(c.value);
    return values;
  }
  *execute(): G {
    if (this.program.diagnostics.some((d) => d.severity === "error")) {
      const d = this.program.diagnostics.find((d) => d.severity === "error")!;
      const error = new DiagnosticError(d.code, d.message, d.line, d.column);
      error.source = d.source;
      throw error;
    }
    for (const d of this.program.diagnostics.filter(
      (d) => d.severity === "warning",
    ))
      yield { kind: "warning", line: d.line, text: d.code + " · " + d.message };
    yield* this.block(this.program.body, this.global);
    this.currentScope = this.global;
    yield* this.observe(
      { line: this.line, kind: "complete", text: "" },
      this.global,
      "complete",
    );
    for (const f of this.opened.keys())
      yield {
        kind: "warning",
        line: this.line,
        text: `未关闭文件 / Unclosed file ${f}`,
      };
  }
  *tick(n: Node, s: Scope): G {
    this.line = n.line;
    this.currentScope = s;
    this.column = n.span?.column || 1;
    if (++this.steps > (this.options.maxSteps ?? 100000))
      this.fail("STEP_LIMIT", "超过指令上限 / Instruction limit exceeded");
    if (this.options.trace === false) return;
    yield {
      kind: "step",
      phase: "before",
      nodeKind: n.kind,
      line: n.line,
      variables: this.snapshot(s),
      values: this.inspect(s),
      stack: [...this.stack],
    };
  }
  *observe(
    n: Pick<Node, "line" | "kind" | "text">,
    s: Scope,
    phase: string,
  ): G {
    if (this.options.trace === false) return;
    yield {
      kind: "trace",
      line: n.line,
      phase,
      nodeKind: n.kind,
      variables: this.snapshot(s),
      values: this.inspect(s),
      stack: [...this.stack],
    };
  }
  typeDefault(type: string, s: Scope, path: string[] = []): any {
    type = type.trim();
    const a = type.match(/^ARRAY\s*\[(.+)\]\s+OF\s+(.+)$/i);
    if (a) {
      const bounds = a[1].split(",").map((v) => {
        const m = v.trim().match(/^(-?\w+)\s*:\s*(-?\w+)$/);
        if (!m)
          this.fail("ARRAY_BOUNDS", "数组边界格式 / Expected lower:upper");
        const num = (x: string) => {
          if (/^-?\d+$/.test(x)) return Number(x);
          const c = s.find(x);
          if (!c || c.type.toUpperCase() !== "INTEGER")
            this.fail(
              "ARRAY_BOUNDS",
              "数组边界必须为 INTEGER / Integer array bounds required",
            );
          return c.value;
        };
        const lo = num(m[1]),
          hi = num(m[2]);
        if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo)
          this.fail("ARRAY_BOUNDS", "无效数组边界 / Invalid array bounds");
        return [lo, hi] as [number, number];
      });
      if (bounds.length > 2)
        this.fail(
          "ARRAY_DIMENSION",
          "仅支持一维或二维数组 / One or two dimensions",
        );
      const size = bounds.reduce((n, [a, b]) => n * (b - a + 1), 1);
      if (size > 100000)
        this.fail("MEMORY_LIMIT", "数组过大 / Array too large");
      const arr: Arr = {
        tag: "array",
        bounds,
        items: new Map(),
        type: a[2].toUpperCase(),
      };
      const fill = (d: number, ix: number[]) => {
        if (d === bounds.length) {
          arr.items.set(ix.join(","), {
            type: arr.type,
            value: this.typeDefault(arr.type, s, path),
          });
          return;
        }
        for (let k = bounds[d][0]; k <= bounds[d][1]; k++)
          fill(d + 1, [...ix, k]);
      };
      fill(0, []);
      return arr;
    }
    const t = type.toUpperCase();
    if (this.p.types.includes(t)) return undefined;
    if (["INTEGER", "REAL", "STRING", "CHAR", "BOOLEAN", "DATE"].includes(t))
      this.fail("DIALECT_TYPE", `此方言不支持 ${t} / Type unavailable`);
    const def = this.types.get(t);
    if (!def) this.fail("UNKNOWN_TYPE", `未知类型 / Unknown type ${type}`);
    if (def.kind === "class") return undefined;
    if (def.definition) {
      if (def.definition.startsWith("^")) return { tag: "pointer", cell: null };
      if (/^SET OF /i.test(def.definition)) return new Set();
      if (/^\(.+\)$/.test(def.definition)) return undefined;
      this.fail("TYPE", "无效类型定义 / Invalid type definition");
    }
    if (path.includes(t))
      this.fail("TYPE_CYCLE", "记录值类型循环引用 / Recursive value type");
    const scope = new Scope();
    for (const f of def.body) {
      if (f.kind !== "declare")
        this.fail(
          "RECORD_FIELD",
          "记录中只允许字段声明 / Record fields must be declarations",
        );
      for (const name of f.names)
        scope.add(name, {
          type: f.type,
          value: this.typeDefault(f.type, s, [...path, t]),
        });
    }
    return { tag: "object", name: t, scope };
  }
  check(type: string, v: any) {
    const t = type.toUpperCase().trim();
    let ok = true;
    if (t === "INTEGER") ok = typeof v === "number" && Number.isInteger(v);
    else if (t === "REAL") ok = typeof v === "number" && Number.isFinite(v);
    else if (t === "STRING") ok = typeof v === "string";
    else if (t === "CHAR") ok = typeof v === "string" && [...v].length === 1;
    else if (t === "BOOLEAN") ok = typeof v === "boolean";
    else if (t === "DATE") ok = v?.tag === "date";
    else if (t.startsWith("ARRAY")) ok = v?.tag === "array";
    else {
      const d = this.types.get(t);
      if (d?.definition?.startsWith("^"))
        ok =
          v?.tag === "pointer" &&
          (!v.cell ||
            v.cell.type.toUpperCase() === d.definition.slice(1).toUpperCase());
      else if (/^SET OF /i.test(d?.definition || "")) {
        ok = v instanceof Set;
        if (ok) for (const x of v) this.check(d!.definition.slice(7), x);
      } else if (d?.definition?.startsWith("("))
        ok = v?.tag === "enum" && v.type === t;
      else
        ok =
          v?.tag === "object" && (v.name === t || this.isSubclass(v.name, t));
    }
    if (!ok)
      this.fail(
        "TYPE_MISMATCH",
        `类型不匹配 / Expected ${type}, received ${display(v)}`,
      );
  }
  isSubclass(a: string, b: string): boolean {
    const seen = new Set<string>();
    let name = a.toUpperCase();
    while (name) {
      if (seen.has(name))
        this.fail("TYPE_CYCLE", "继承循环 / Inheritance cycle");
      seen.add(name);
      const d = this.types.get(name);
      if (!d?.base) return false;
      name = d.base.toUpperCase();
      if (name === b.toUpperCase()) return true;
    }
    return false;
  }
  objectField(o: Obj, name: string) {
    const key = name.toUpperCase(),
      owner = this.stack.at(-1)?.split(".")[0];
    const own = owner ? o.scope.vars.get(owner + "." + key) : undefined;
    const c = own || o.scope.vars.get(key);
    if (c) return c;
    if ([...o.scope.vars.keys()].some((k) => k.endsWith("." + key)))
      this.fail("PRIVATE", "不能访问 PRIVATE 成员 / Private member");
    this.fail("MEMBER", "不存在的成员 / Unknown member " + name);
  }
  *cell(e: Expr, s: Scope): G {
    if (e.kind === "name") {
      let c = s.find(e.name);
      if (!c) {
        if (this.options.strict !== false)
          this.fail("UNDECLARED", `未声明变量 / Undeclared ${e.name}`);
        c = { type: "REAL", value: undefined };
        s.add(e.name, c);
        this.warnings.push(`Implicit declaration ${e.name}`);
      }
      return c;
    }
    if (e.kind === "index") {
      const a = yield* this.eval(e.target, s);
      if (a?.tag !== "array")
        this.fail("NOT_ARRAY", "需要数组 / Array required");
      const ix = [];
      for (const v of e.args) ix.push(yield* this.eval(v, s));
      if (
        ix.length !== a.bounds.length ||
        ix.some(
          (v, i) =>
            !Number.isInteger(v) || v < a.bounds[i][0] || v > a.bounds[i][1],
        )
      )
        this.fail("ARRAY_BOUNDS", "数组越界 / Array index out of bounds");
      return a.items.get(ix.join(","));
    }
    if (e.kind === "member") {
      const o = yield* this.eval(e.target, s);
      if (o?.tag !== "object")
        this.fail("MEMBER", "需要记录或对象 / Object required");
      const c = this.objectField(o, e.name);
      return c;
    }
    if (e.kind === "deref") {
      const p = yield* this.eval(e.target, s);
      if (p?.tag !== "pointer" || !p.cell)
        this.fail("NULL_POINTER", "无效或空指针 / Invalid or null pointer");
      return p.cell;
    }
    this.fail("LVALUE", "需要可赋值变量 / Assignable variable required");
  }
  *eval(e: Expr, s: Scope, asProcedure = false): G {
    this.line = e.token.line;
    this.column = e.token.column;
    switch (e.kind) {
      case "literal":
        if (e.type === "DATE") {
          if (!this.p.types.includes("DATE"))
            this.fail("DIALECT_TYPE", "DATE 不适用于此方言 / DATE unavailable");
          const [d, m, y] = e.value.split("/").map(Number);
          return this.date(d, m, y);
        }
        return e.value;
      case "name": {
        const c = s.find(e.name);
        if (c) {
          if (c.value === undefined)
            this.fail(
              "UNINITIALIZED",
              `变量尚未初始化 / Uninitialized ${e.name}`,
            );
          return c.value;
        }
        const implicit = this.modules.get(e.name.toUpperCase());
        if (implicit?.kind === "function" && implicit.params.length === 0)
          return yield* this.invoke(implicit, [], s);
        if (e.name.toUpperCase() === "SUPER") {
          const self = s.find("THIS")?.value;
          if (!self)
            this.fail("SUPER", "SUPER 仅用于方法 / SUPER needs method context");
          const owner = this.stack.at(-1)?.split(".")[0];
          const base = owner && this.types.get(owner)?.base;
          if (!base) this.fail("SUPER", "没有父类 / No superclass");
          return { ...self, superClass: base.toUpperCase() };
        }
        const d = [...this.types.values()].find(
          (t) =>
            t.definition?.startsWith("(") &&
            t.definition
              .slice(1, -1)
              .split(",")
              .some(
                (v: string) => v.trim().toUpperCase() === e.name.toUpperCase(),
              ),
        );
        if (d)
          return {
            tag: "enum",
            name: e.name.toUpperCase(),
            type: d.name.toUpperCase(),
            ordinal: d.definition
              .slice(1, -1)
              .split(",")
              .findIndex(
                (v: string) => v.trim().toUpperCase() === e.name.toUpperCase(),
              ),
          };
        this.fail("UNDECLARED", `未声明变量 / Undeclared ${e.name}`);
      }
      case "index":
      case "member":
      case "deref": {
        const c = yield* this.cell(e, s);
        if (c.value === undefined)
          this.fail("UNINITIALIZED", "变量尚未初始化 / Uninitialized variable");
        return c.value;
      }
      case "unary":
        if (e.op === "^") {
          if (!this.p.advanced)
            this.fail(
              "DIALECT_FEATURE",
              "指针仅适用于 A2 / Pointers require A2",
            );
          return { tag: "pointer", cell: yield* this.cell(e.right, s) };
        }
        {
          const v = yield* this.eval(e.right, s);
          if (e.op === "NOT") {
            this.check("BOOLEAN", v);
            return !v;
          }
          this.check("REAL", v);
          return e.op === "-" ? -v : +v;
        }
      case "binary": {
        const a = yield* this.eval(e.left, s);
        if (e.op === "AND" || e.op === "OR") {
          this.check("BOOLEAN", a);
          if (this.policies.shortCircuit && e.op === "AND" && !a) return false;
          if (this.policies.shortCircuit && e.op === "OR" && a) return true;
          const b = yield* this.eval(e.right, s);
          this.check("BOOLEAN", b);
          return e.op === "AND" ? a && b : a || b;
        }
        const b = yield* this.eval(e.right, s);
        return this.binary(e.op, a, b, e);
      }
      case "new": {
        if (!this.p.advanced)
          this.fail("DIALECT_FEATURE", "类仅适用于 A2 / Classes require A2");
        const d = this.types.get(e.name.toUpperCase());
        if (!d || d.kind !== "class")
          this.fail("CLASS", "未知类 / Unknown class");
        const obj: Obj = {
          tag: "object",
          name: e.name.toUpperCase(),
          class: true,
          scope: new Scope(),
        };
        const initialized = new Set<string>();
        const init = (c: Node) => {
          if (initialized.has(c.name.toUpperCase()))
            this.fail("TYPE_CYCLE", "继承循环 / Inheritance cycle");
          initialized.add(c.name.toUpperCase());
          if (c.base) {
            const b = this.types.get(c.base.toUpperCase());
            if (!b) this.fail("CLASS", "未知父类 / Unknown base");
            init(b);
          }
          for (const f of c.body)
            if (f.kind === "declare")
              for (const n of f.names)
                obj.scope.vars.set(
                  f.access === "PRIVATE"
                    ? c.name.toUpperCase() + "." + n.toUpperCase()
                    : n.toUpperCase(),
                  {
                    type: f.type,
                    value: this.typeDefault(f.type, s),
                    access: f.access,
                    owner: c.name.toUpperCase(),
                    name: n.toUpperCase(),
                  },
                );
        };
        init(d);
        const chain: Node[] = [];
        const seen = new Set<string>();
        let current: Node | undefined = d;
        while (current) {
          if (seen.has(current.name.toUpperCase()))
            this.fail("TYPE_CYCLE", "继承循环 / Inheritance cycle");
          seen.add(current.name.toUpperCase());
          chain.unshift(current);
          current = current.base
            ? this.types.get(current.base.toUpperCase())
            : undefined;
        }
        for (const cls of chain) {
          const local = new Scope(this.global);
          for (const f of this.model.fields(cls.name)) {
            if (f.access === "PRIVATE" && f.owner !== cls.name.toUpperCase())
              continue;
            const key =
              f.access === "PRIVATE" ? f.owner + "." + f.name : f.name;
            const cell = obj.scope.vars.get(key);
            if (cell) local.vars.set(f.name, cell);
          }
          local.vars.set("THIS", { type: obj.name, value: obj });
          this.stack.push(cls.name.toUpperCase() + ".<initializers>");
          try {
            yield* this.block(
              cls.body.filter(
                (n: Node) =>
                  !["declare", "procedure", "function"].includes(n.kind),
              ),
              local,
            );
          } finally {
            this.stack.pop();
          }
        }
        const ctor = this.method(d.name, "NEW");
        if (ctor) yield* this.invoke(ctor, e.args, s, obj);
        else if (e.args.length)
          this.fail("ARITY", "构造函数没有参数 / No constructor arguments");
        return obj;
      }
      case "call": {
        if (e.target.kind === "name") {
          const name = e.target.name.toUpperCase();
          if (signatures[name]) {
            if (asProcedure)
              this.fail(
                "CALL_FUNCTION",
                "CALL 不能用于函数 / CALL requires procedure",
              );
            if (!this.p.builtins.includes(name))
              this.fail(
                "DIALECT_BUILTIN",
                `此方言没有函数 / Builtin unavailable ${name}`,
              );
            const a = [];
            for (const x of e.args) a.push(yield* this.eval(x, s));
            this.line = e.token.line;
            this.column = e.token.column;
            try {
              return this.builtin(name, a);
            } catch (e) {
              if (e instanceof DiagnosticError)
                e.source = builtinSignature(name, this.p)?.source || e.source;
              throw e;
            }
          }
          const self = s.find("THIS")?.value;
          const owner = this.stack.at(-1)?.split(".")[0];
          const own =
            owner &&
            this.types
              .get(owner)
              ?.body?.find(
                (n: Node) =>
                  n.name?.toUpperCase() === name &&
                  n.access === "PRIVATE" &&
                  ["procedure", "function"].includes(n.kind),
              );
          const method = own || (self && this.method(self.name, name));
          const fn = method || this.modules.get(name);
          if (!fn) this.fail("CALL", `未知子程序 / Unknown module ${name}`);
          if ((fn.kind === "procedure") !== asProcedure)
            this.fail(
              "CALL_KIND",
              "函数作为表达式，过程使用 CALL / Function-expression / CALL-procedure required",
            );
          return yield* this.invoke(fn, e.args, s, method ? self : undefined);
        }
        if (e.target.kind === "member") {
          const obj = yield* this.eval(e.target.target, s);
          if (obj?.tag !== "object")
            this.fail("CALL", "方法需要对象 / Method requires object");
          let className = obj.name;
          if (obj.superClass) className = obj.superClass;
          const fn = this.method(className, e.target.name);
          if (!fn)
            this.fail("CALL", `未知方法 / Unknown method ${e.target.name}`);
          if (
            fn.access === "PRIVATE" &&
            this.stack.at(-1)?.split(".")[0] !== fn.owner
          )
            this.fail("PRIVATE", "不能调用 PRIVATE 方法 / Private method");
          if ((fn.kind === "procedure") !== asProcedure)
            this.fail(
              "CALL_KIND",
              "函数作为表达式，过程使用 CALL / Function-expression / CALL-procedure required",
            );
          return yield* this.invoke(fn, e.args, s, obj);
        }
        this.fail("CALL", "无效调用 / Invalid call");
      }
    }
  }
  method(name: string, method: string): Node | undefined {
    const seen = new Set<string>();
    while (name) {
      const key = name.toUpperCase();
      if (seen.has(key))
        this.fail("TYPE_CYCLE", "继承循环 / Inheritance cycle");
      seen.add(key);
      const d = this.types.get(key);
      const fn = d?.body?.find(
        (n: Node) =>
          ["function", "procedure"].includes(n.kind) &&
          n.name.toUpperCase() === method.toUpperCase(),
      );
      if (fn) return fn;
      name = d?.base;
    }
    return undefined;
  }
  *invoke(fn: Node, args: Expr[], caller: Scope, obj?: Obj): G {
    if (args.length !== fn.params.length)
      this.fail("ARITY", `${fn.name} 参数数量错误 / Wrong argument count`);
    if (this.stack.length >= (this.options.maxDepth ?? 128))
      this.fail("CALL_DEPTH", "递归层数超限 / Call depth exceeded");
    const local = new Scope(this.global);
    if (obj) {
      for (const f of this.model.fields(fn.owner || obj.name)) {
        if (f.access === "PRIVATE" && f.owner !== fn.owner) continue;
        const key = f.access === "PRIVATE" ? f.owner + "." + f.name : f.name;
        const cell = obj.scope.vars.get(key);
        if (cell) local.vars.set(f.name, cell);
      }
      local.vars.set("THIS", { type: obj.name, value: obj });
    }
    for (let i = 0; i < args.length; i++) {
      const p = fn.params[i];
      if (p.mode === "BYREF") {
        const c = yield* this.cell(args[i], caller);
        if (c.constant)
          this.fail("CONSTANT", "常量不能 BYREF / Constant cannot be BYREF");
        const actual = c.type.toUpperCase(),
          expected = p.type.toUpperCase();
        let arrayMatch = false;
        if (
          actual.startsWith("ARRAY") &&
          expected.startsWith("ARRAY") &&
          c.value?.tag === "array"
        ) {
          const m = expected.match(/^ARRAY\s*\[(.+)\]\s+OF\s+(.+)$/);
          if (m) {
            const bounds = m[1]
              .split(",")
              .map((d: string) =>
                d
                  .split(":")
                  .map((x) =>
                    /^-?\d+$/.test(x.trim())
                      ? Number(x)
                      : local.find(x.trim())?.value,
                  ),
              );
            arrayMatch =
              c.value.type === m[2] &&
              JSON.stringify(bounds) === JSON.stringify(c.value.bounds);
          }
        }
        if (actual !== expected && !arrayMatch)
          this.fail(
            "TYPE_MISMATCH",
            "BYREF 类型必须相同 / BYREF type mismatch",
          );
        local.vars.set(p.name.toUpperCase(), c);
      } else {
        const v = yield* this.eval(args[i], caller);
        this.check(p.type, v);
        const c = {
          type: p.type,
          value: p.type.toUpperCase().startsWith("ARRAY")
            ? this.typeDefault(p.type, local)
            : undefined,
        };
        this.put(c, v);
        local.vars.set(p.name.toUpperCase(), c);
      }
    }
    this.stack.push((obj ? (fn.owner || obj.name) + "." : "") + fn.name);
    try {
      yield* this.observe(fn, local, "module-entry");
      yield* this.block(fn.body, local);
      if (fn.kind === "function")
        this.fail("MISSING_RETURN", "函数执行路径缺少 RETURN / Missing return");
    } catch (e) {
      if (e instanceof Returned) {
        if (fn.kind !== "function")
          this.fail(
            "RETURN",
            "过程不能返回值 / Procedure cannot return a value",
          );
        this.check(fn.type, e.value);
        return e.value;
      }
      throw e;
    } finally {
      yield* this.observe(fn, local, "module-exit");
      this.stack.pop();
    }
  }
  binary(op: string, a: any, b: any, e?: Expr): any {
    if (e) {
      this.line = e.token.line;
      this.column = e.token.column;
    }
    if (a?.tag === "pointer" || b?.tag === "pointer") {
      if (
        a?.tag !== "pointer" ||
        b?.tag !== "pointer" ||
        !["=", "<>"].includes(op)
      )
        this.fail(
          "COMPARE",
          "指针仅支持地址相等比较 / Pointer address equality required",
        );
      return op === "=" ? a.cell === b.cell : a.cell !== b.cell;
    }
    if (
      a instanceof Set &&
      b instanceof Set &&
      ["=", "<>", "<", ">", "<=", ">="].includes(op)
    ) {
      const subset = (x: Set<any>, y: Set<any>) =>
        [...x].every((v) => [...y].some((w) => sameValue(v, w)));
      const ab = subset(a, b),
        ba = subset(b, a);
      return op === "="
        ? ab && ba
        : op === "<>"
          ? !ab || !ba
          : op === "<"
            ? ab && a.size < b.size
            : op === ">"
              ? ba && a.size > b.size
              : op === "<="
                ? ab
                : ba;
    }
    if (a?.tag === "enum" || b?.tag === "enum") {
      if (a?.tag !== "enum")
        this.fail("TYPE_MISMATCH", "枚举类型不匹配 / Enum mismatch");
      if (b?.tag === "enum") {
        if (a.type !== b.type)
          this.fail("TYPE_MISMATCH", "枚举类型不匹配 / Enum mismatch");
        if (op === "-") return a.ordinal - b.ordinal;
        return this.binary(op, a.ordinal, b.ordinal);
      }
      if (!["+", "-"].includes(op))
        this.fail(
          "OPERATOR",
          "枚举仅支持序数运算 / Enum ordinal operation required",
        );
      this.check("INTEGER", b);
      const values = this.types
          .get(a.type)!
          .definition.slice(1, -1)
          .split(",")
          .map((s: string) => s.trim().toUpperCase()),
        ordinal = a.ordinal + (op === "+" ? b : -b);
      if (ordinal < 0 || ordinal >= values.length)
        this.fail("ENUM_RANGE", "枚举序数越界 / Enum ordinal out of range");
      return { tag: "enum", name: values[ordinal], type: a.type, ordinal };
    }
    if (["=", "<>", "<", ">", "<=", ">="].includes(op)) {
      if (
        a?.tag === "object" ||
        b?.tag === "object" ||
        a?.tag === "array" ||
        b?.tag === "array"
      )
        this.fail(
          "COMPARE",
          "记录和数组不能比较 / Records and arrays cannot be compared",
        );
      if (a?.tag === "date" && b?.tag === "date") {
        a = a.iso;
        b = b.iso;
      }
      if (typeof a !== typeof b)
        this.fail("TYPE_MISMATCH", "比较类型不匹配 / Comparison type mismatch");
      switch (op) {
        case "=":
          return a === b;
        case "<>":
          return a !== b;
        case "<":
          return a < b;
        case ">":
          return a > b;
        case "<=":
          return a <= b;
        case ">=":
          return a >= b;
      }
    }
    if (op === "&") {
      this.check("STRING", a);
      this.check("STRING", b);
      return a + b;
    }
    if (a instanceof Set && b instanceof Set) {
      if (op === "+") return valueSet([...a, ...b]);
      if (op === "-")
        return valueSet(
          [...a].filter((x) => ![...b].some((y) => sameValue(x, y))),
        );
      if (op === "*")
        return valueSet(
          [...a].filter((x) => [...b].some((y) => sameValue(x, y))),
        );
    }
    this.check("REAL", a);
    this.check("REAL", b);
    if (["DIV", "MOD"].includes(op)) {
      this.check("INTEGER", a);
      this.check("INTEGER", b);
    }
    if (["/", "DIV", "MOD"].includes(op) && b === 0)
      this.fail("DIV_ZERO", "不能除以零 / Division by zero");
    let v: number;
    switch (op) {
      case "+":
        v = a + b;
        break;
      case "-":
        v = a - b;
        break;
      case "*":
        v = a * b;
        break;
      case "/":
        v = a / b;
        break;
      case "DIV":
        v =
          this.policies.divNegative === "floor"
            ? Math.floor(a / b)
            : Math.trunc(a / b);
        break;
      case "MOD":
        v =
          a -
          (this.policies.divNegative === "floor"
            ? Math.floor(a / b)
            : Math.trunc(a / b)) *
            b;
        break;
      case "^":
        if (!this.p.whileDo)
          this.fail(
            "DIALECT_OPERATOR",
            "9618 中 ^ 用于指针 / Power unavailable",
          );
        v = a ** b;
        break;
      default:
        this.fail("OPERATOR", `未知运算符 ${op}`);
    }
    if (!Number.isFinite(v!))
      this.fail("OVERFLOW", "数值溢出 / Numeric overflow");
    return v!;
  }
  date(d: number, m: number, y: number): DateVal {
    if (![d, m, y].every(Number.isInteger) || y < 1 || y > 9999)
      this.fail("DATE", "无效日期 / Invalid date");
    const dt = new Date(0);
    dt.setUTCFullYear(y, m - 1, d);
    dt.setUTCHours(0, 0, 0, 0);
    if (dt.getUTCDate() !== d || dt.getUTCMonth() !== m - 1)
      this.fail("DATE", "无效日期 / Invalid date");
    return { tag: "date", iso: dt.toISOString().slice(0, 10) };
  }
  builtin(name: string, a: any[]): any {
    const [lo, hi] = signatures[name];
    if (a.length < lo || a.length > hi)
      this.fail("ARITY", `${name} 参数数量错误 / Wrong argument count`);
    const str = (i: number) => {
        this.check("STRING", a[i]);
        return a[i] as string;
      },
      num = (i: number) => {
        this.check("REAL", a[i]);
        return a[i] as number;
      },
      int = (i: number) => {
        this.check("INTEGER", a[i]);
        return a[i] as number;
      };
    const slice = (s: string, start: number, count: number) => {
      if (start < 1 || count < 0 || start - 1 + count > [...s].length)
        this.fail("BUILTIN_RANGE", "字符串范围越界 / Invalid substring range");
      return [...s].slice(start - 1, start - 1 + count).join("");
    };
    switch (name) {
      case "LENGTH":
        return [...str(0)].length;
      case "LEFT":
        return slice(str(0), 1, int(1));
      case "RIGHT":
        return slice(str(0), [...str(0)].length - int(1) + 1, int(1));
      case "MID":
      case "SUBSTRING":
        if (name === "SUBSTRING" && int(2) <= 0)
          this.fail(
            "BUILTIN_RANGE",
            "SUBSTRING 长度应为正数 / Positive substring length required",
          );
        return slice(str(0), int(1), int(2));
      case "UCASE":
      case "LCASE":
        if (!this.p.whileDo) this.check("CHAR", a[0]);
      case "TO_UPPER":
      case "TO_LOWER":
        return name.includes("UPPER") || name === "UCASE"
          ? str(0).toUpperCase()
          : str(0).toLowerCase();
      case "NUM_TO_STR":
        return String(num(0));
      case "STR_TO_NUM": {
        const s = str(0);
        if (!/^[+-]?\d+(\.\d+)?$/.test(s))
          this.fail("BUILTIN_VALUE", "无法转换为数字 / Invalid number");
        return Number(s);
      }
      case "IS_NUM":
        return /^[+-]?\d+(\.\d+)?$/.test(str(0));
      case "ASC":
        this.check("CHAR", a[0]);
        if (a[0].codePointAt(0) > 127)
          this.fail(
            "BUILTIN_RANGE",
            "ASC 需要 ASCII 字符 / ASCII character required",
          );
        return a[0].codePointAt(0);
      case "CHR":
        if (int(0) < 0 || int(0) > 127)
          this.fail(
            "BUILTIN_RANGE",
            "CHR 需要 ASCII 0–127 / ASCII range required",
          );
        return String.fromCharCode(a[0]);
      case "INT":
        return this.policies.intNegative === "floor"
          ? Math.floor(num(0))
          : Math.trunc(num(0));
      case "ROUND": {
        const n = num(0),
          places = int(1);
        if (places < 0 || places > 15)
          this.fail(
            "BUILTIN_RANGE",
            "ROUND 位数应为 0–15 / Invalid decimal places",
          );
        return round(n, places, this.policies.roundHalf);
      }
      case "DIV":
      case "MOD":
        return this.binary(name, int(0), int(1));
      case "RANDOM":
      case "RAND": {
        this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
        const max = name === "RAND" ? int(0) : 1;
        if (max <= 0)
          this.fail(
            "BUILTIN_RANGE",
            "RAND 上界必须为正 / Positive upper bound required",
          );
        return (
          (this.seed / (name === "RANDOM" ? 4294967295 : 4294967296)) * max
        );
      }
      case "SETDATE":
        return this.date(int(0), int(1), int(2));
      case "TODAY":
        return {
          tag: "date",
          iso: this.options.clock || new Date().toISOString().slice(0, 10),
        };
      case "DAY":
      case "MONTH":
      case "YEAR":
      case "DAYINDEX": {
        this.check("DATE", a[0]);
        const dt = new Date(a[0].iso + "T00:00:00Z");
        return name === "DAY"
          ? dt.getUTCDate()
          : name === "MONTH"
            ? dt.getUTCMonth() + 1
            : name === "YEAR"
              ? dt.getUTCFullYear()
              : dt.getUTCDay() + 1;
      }
      case "EOF": {
        const f = this.file(str(0), "READ");
        return f.pos >= this.lines(str(0)).length;
      }
    }
  }
  filename(value: any): string {
    this.check("STRING", value);
    return this.policies.filenameCase === "insensitive"
      ? value.toLowerCase()
      : value;
  }
  render(value: any, type = "UNKNOWN"): string {
    if (typeof value === "boolean" && this.policies.booleanOutput === "lower")
      return String(value);
    if (
      typeof value === "number" &&
      type === "REAL" &&
      Number.isInteger(value) &&
      this.policies.realOutput === "preserve"
    )
      return String(value) + ".0";
    return display(value);
  }
  lines(name: string) {
    name = this.filename(name);
    const text = this.files[name].text;
    return text === ""
      ? []
      : text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  }
  file(name: string, mode: string) {
    name = this.filename(name);
    const f = this.opened.get(name);
    if (!f || !mode.split("|").includes(f.mode))
      this.fail("FILE_MODE", `${name} 未以 ${mode} 打开 / Wrong file mode`);
    return f!;
  }
  infer(e: Expr, s: Scope): string {
    const symbols = new Map<string, { type: string }>();
    for (let current: Scope | undefined = s; current; current = current.parent)
      for (const [name, cell] of current.vars)
        if (!symbols.has(name))
          symbols.set(name, { type: cell.type.toUpperCase() });
    return this.model.type(e, {
      symbols,
      owner: this.stack.at(-1)?.split(".")[0],
    });
  }
  put(c: Cell, v: any, expr?: Expr) {
    if (c.constant)
      this.fail("CONSTANT", "禁止修改常量 / Cannot assign constant");
    if (
      c.type.toUpperCase() === "INTEGER" &&
      expr?.kind === "binary" &&
      expr.op === "/"
    )
      this.fail("TYPE_MISMATCH", "除法结果为 REAL / Division returns REAL");
    this.check(c.type, v);
    if (c.value?.tag === "array") {
      const dest = c.value as Arr,
        src = v as Arr;
      if (
        dest.type !== src.type ||
        dest.bounds.length !== src.bounds.length ||
        dest.bounds.some(
          ([a, b], i) => b - a !== src.bounds[i][1] - src.bounds[i][0],
        )
      )
        this.fail("ARRAY_SHAPE", "数组尺寸或类型不匹配 / Array shape mismatch");
      const copy = clone(v) as Arr;
      copy.bounds = dest.bounds.map((b) => [...b] as [number, number]);
      const items = [...copy.items.values()];
      copy.items = new Map(
        [...dest.items.keys()].map((key, i) => [key, items[i]]),
      );
      c.value = copy;
      return;
    }
    c.value = clone(v);
  }
  *block(nodes: Node[], s: Scope): G {
    for (const n of nodes) {
      if (["procedure", "function", "class"].includes(n.kind)) continue;
      if (
        this.options.fast &&
        Object.entries(this.options.policies || {}).every(
          ([k, v]) => v === (defaultPolicies as any)[k],
        ) &&
        this.options.trace === false &&
        ["for", "while", "repeat"].includes(n.kind)
      ) {
        const context = {
          steps: this.steps,
          limit: this.options.maxSteps ?? 100000,
          line: n.line,
          lookup: (name: string) => s.find(name),
          fail: (code: string, message: string): never => {
            this.line = context.line;
            this.steps = context.steps;
            return this.fail(code, message);
          },
        };
        if (optimizeLoop(n, context)) {
          this.steps = context.steps;
          this.line = context.line;
          continue;
        }
      }
      yield* this.tick(n, s);
      switch (n.kind) {
        case "declare":
          for (const name of n.names) {
            if (
              keywords.has(name.toUpperCase()) ||
              !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)
            )
              this.fail("IDENTIFIER", "无效标识符 / Invalid identifier");
            s.add(name, { type: n.type, value: this.typeDefault(n.type, s) });
          }
          break;
        case "constant": {
          const v = yield* this.eval(n.value, s);
          s.add(n.name, {
            type: this.infer(n.value, s),
            value: v,
            constant: true,
          });
          break;
        }
        case "type":
          break;
        case "assign": {
          if (
            n.target.kind === "name" &&
            n.value.kind === "new" &&
            !s.find(n.target.name)
          )
            s.add(n.target.name, { type: n.value.name, value: undefined });
          if (
            this.options.strict === false &&
            n.target.kind === "name" &&
            !s.find(n.target.name)
          ) {
            const v = yield* this.eval(n.value, s),
              type = this.infer(n.value, s);
            s.add(n.target.name, {
              type:
                type === "UNKNOWN"
                  ? typeof v === "number"
                    ? "REAL"
                    : typeof v === "boolean"
                      ? "BOOLEAN"
                      : "STRING"
                  : type,
              value: clone(v),
            });
            yield {
              kind: "warning",
              line: n.line,
              text: "隐式声明 / Implicit declaration " + n.target.name,
            };
            break;
          }
          const c = yield* this.cell(n.target, s);
          if (
            c.type.toUpperCase() === "INTEGER" &&
            this.infer(n.value, s) === "REAL"
          )
            this.fail(
              "TYPE_MISMATCH",
              "REAL 不能隐式赋给 INTEGER / REAL cannot be assigned to INTEGER",
            );
          this.put(c, yield* this.eval(n.value, s), n.value);
          break;
        }
        case "output": {
          const a = [];
          for (const e of n.values)
            a.push(this.render(yield* this.eval(e, s), this.infer(e, s)));
          yield { kind: "output", line: n.line, text: a.join("") };
          break;
        }
        case "input": {
          const c = yield* this.cell(n.target, s);
          const text = yield { kind: "input", line: n.line, text: "INPUT" };
          let v: any = text;
          if (["INTEGER", "REAL"].includes(c.type.toUpperCase())) {
            if (!/^[+-]?\d+(\.\d+)?$/.test(text))
              this.fail("INPUT_TYPE", "输入不是数字 / Invalid numeric input");
            v = Number(text);
          }
          if (c.type.toUpperCase() === "BOOLEAN") {
            if (!/^(TRUE|FALSE)$/i.test(text))
              this.fail(
                "INPUT_TYPE",
                "输入必须为 TRUE/FALSE / Boolean input required",
              );
            v = text.toUpperCase() === "TRUE";
          }
          if (c.type.toUpperCase() === "DATE") {
            const m = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
            if (!m)
              this.fail(
                "INPUT_TYPE",
                "日期应为 DD/MM/YYYY / Date input format",
              );
            v = this.date(Number(m[1]), Number(m[2]), Number(m[3]));
          }
          this.put(c, v);
          break;
        }
        case "if": {
          const v = yield* this.eval(n.cond, s);
          this.check("BOOLEAN", v);
          yield* this.observe(n, s, "branch");
          yield* this.block(v ? n.body : n.other, s);
          break;
        }
        case "while":
          while (true) {
            const v = yield* this.eval(n.cond, s);
            this.check("BOOLEAN", v);
            if (!v) break;
            yield* this.block(n.body, s);
            yield* this.observe(n, s, "loop");
            yield* this.tick(n, s);
          }
          break;
        case "repeat":
          do {
            yield* this.block(n.body, s);
            yield* this.observe(n, s, "loop");
            const v = yield* this.eval(n.cond, s);
            this.check("BOOLEAN", v);
            if (v) break;
            yield* this.tick(n, s);
          } while (true);
          break;
        case "for": {
          const c = s.find(n.name);
          if (!c) this.fail("UNDECLARED", `未声明循环变量 ${n.name}`);
          if (c.type.toUpperCase() !== "INTEGER")
            this.fail(
              "FOR_TYPE",
              "FOR 变量必须为 INTEGER / Integer loop variable required",
            );
          const from = yield* this.eval(n.from, s),
            to = yield* this.eval(n.to, s),
            step = yield* this.eval(n.step, s);
          for (const v of [from, to, step]) this.check("INTEGER", v);
          if (step === 0)
            this.fail("FOR_STEP", "STEP 不能为 0 / STEP cannot be zero");
          for (
            this.put(c, from);
            step > 0
              ? c.value <=
                (this.policies.forBounds === "once"
                  ? to
                  : yield* this.eval(n.to, s))
              : c.value >=
                (this.policies.forBounds === "once"
                  ? to
                  : yield* this.eval(n.to, s));
            this.put(c, c.value + step)
          ) {
            yield* this.block(n.body, s);
            yield* this.observe(n, s, "loop");
            yield* this.tick(n, s);
          }
          break;
        }
        case "case": {
          const v = yield* this.eval(n.value, s);
          let hit = false;
          for (const b of n.branches) {
            let matches = b.otherwise;
            for (const range of b.ranges) {
              const a = yield* this.eval(range[0], s);
              if (range.length === 1) matches ||= this.binary("=", v, a);
              else {
                const z = yield* this.eval(range[1], s);
                matches ||= this.binary(">=", v, a) && this.binary("<=", v, z);
              }
            }
            if (matches && !hit) {
              hit = true;
              yield* this.observe(n, s, "branch");
              yield* this.block(b.body, s);
              break;
            }
          }
          break;
        }
        case "return":
          if (!this.stack.length)
            this.fail(
              "RETURN",
              "RETURN 只能位于函数 / RETURN outside function",
            );
          throw new Returned(yield* this.eval(n.value, s));
        case "call": {
          const target = n.value.target;
          const fn =
            target.kind === "name"
              ? this.modules.get(target.name.toUpperCase())
              : undefined;
          if (
            fn?.kind === "function" ||
            (target.kind === "name" && signatures[target.name.toUpperCase()])
          )
            this.fail(
              "CALL_FUNCTION",
              "函数不能使用 CALL / CALL requires procedure",
            );
          yield* this.eval(n.value, s, true);
          break;
        }
        case "open": {
          const name = this.filename(yield* this.eval(n.file, s));
          this.check("STRING", name);
          if (this.opened.has(name))
            this.fail("FILE_OPEN", "文件已打开 / File already open");
          if (n.mode === "READ" && !this.files[name])
            this.fail("FILE_MISSING", `文件不存在 / Missing file ${name}`);
          if (n.mode === "WRITE" || !this.files[name])
            this.files[name] = { text: "" };
          this.opened.set(name, {
            mode: n.mode,
            pos: n.mode === "RANDOM" ? 1 : 0,
          });
          break;
        }
        case "close": {
          const name = this.filename(yield* this.eval(n.file, s));
          if (!this.opened.delete(name))
            this.fail("FILE_OPEN", "文件未打开 / File not open");
          break;
        }
        case "readfile": {
          const name = this.filename(yield* this.eval(n.file, s)),
            f = this.file(name, "READ"),
            lines = this.lines(name);
          if (f.pos >= lines.length)
            this.fail("FILE_EOF", "已到文件末尾 / End of file");
          this.put(yield* this.cell(n.value, s), lines[f.pos++]);
          break;
        }
        case "writefile": {
          const name = this.filename(yield* this.eval(n.file, s));
          this.file(name, "WRITE|APPEND");
          this.files[name].text += display(yield* this.eval(n.value, s)) + "\n";
          break;
        }
        case "seek": {
          const name = this.filename(yield* this.eval(n.file, s)),
            f = this.file(name, "RANDOM"),
            v = yield* this.eval(n.value, s);
          if (!Number.isInteger(v) || v < 1)
            this.fail(
              "FILE_POSITION",
              "记录位置必须为正整数 / Positive record position",
            );
          f.pos = v;
          break;
        }
        case "putrecord":
        case "getrecord": {
          const name = this.filename(yield* this.eval(n.file, s)),
            f = this.file(name, "RANDOM");
          this.files[name].records ||= {};
          if (n.kind === "putrecord")
            this.files[name].records![f.pos] = clone(
              yield* this.eval(n.value, s),
            );
          else {
            if (!(f.pos in this.files[name].records!))
              this.fail("FILE_RECORD", "记录不存在 / Record missing");
            this.put(
              yield* this.cell(n.value, s),
              clone(this.files[name].records![f.pos]),
            );
          }
          f.pos++;
          break;
        }
        case "define": {
          if (n.type)
            s.add(n.name, { type: n.type, value: this.typeDefault(n.type, s) });
          const c = s.find(n.name);
          if (!c || !(c.value instanceof Set))
            this.fail("SET", "DEFINE 需要集合 / Set required");
          const values = [];
          for (const e of n.values) values.push(yield* this.eval(e, s));
          const v = valueSet(values);
          this.put(c, v);
          break;
        }
      }
    }
  }
}
export function run(
  source: string,
  id: DialectId = "0478",
  inputs: string[] = [],
  options: RunOptions = {},
) {
  const machine = new Machine(source, id, options),
    events: Event[] = [],
    output: string[] = [];
  let input = 0,
    next = machine.generator.next();
  while (!next.done) {
    events.push(next.value);
    if (next.value.kind === "output") output.push(next.value.text!);
    if (next.value.kind === "input") {
      if (input >= inputs.length)
        throw new DiagnosticError(
          "INPUT_MISSING",
          "缺少输入 / Missing input",
          next.value.line,
        );
      next = machine.generator.next(inputs[input++]);
    } else next = machine.generator.next();
  }
  return { machine, events, output, files: machine.files };
}
