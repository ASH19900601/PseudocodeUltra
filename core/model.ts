import type { Expr } from "./lexer";
import type { Node, Program } from "./parser";
export const canonical = (s: string) =>
  s.trim().toUpperCase().replace(/\s+/g, " ");
export interface Environment {
  symbols: Map<string, { type: string; constant?: boolean; node?: Node }>;
  owner?: string;
  module?: Node;
}
export class Model {
  types = new Map<string, Node>();
  modules = new Map<string, Node>();
  enums = new Map<string, string>();
  global: Environment = { symbols: new Map() };
  constructor(public program: Program) {
    for (const n of program.body) {
      if (["type", "class"].includes(n.kind)) {
        this.types.set(canonical(n.name), n);
        if (n.definition?.startsWith("("))
          for (const name of n.definition.slice(1, -1).split(","))
            this.enums.set(canonical(name), canonical(n.name));
      }
      if (["function", "procedure"].includes(n.kind))
        this.modules.set(canonical(n.name), n);
    }
    this.collect(program.body, this.global);
  }
  collect(nodes: Node[], env: Environment) {
    for (const n of nodes) {
      if (n.kind === "declare")
        for (const name of n.names)
          env.symbols.set(canonical(name), {
            type: canonical(n.type),
            node: n,
          });
      if (
        n.kind === "assign" &&
        n.target.kind === "name" &&
        n.value.kind === "new" &&
        !env.symbols.has(canonical(n.target.name))
      )
        env.symbols.set(canonical(n.target.name), {
          type: canonical(n.value.name),
          node: n,
        });
      if (n.kind === "constant")
        env.symbols.set(canonical(n.name), {
          type: this.type(n.value, env),
          constant: true,
          node: n,
        });
      if (n.kind === "define" && n.type)
        env.symbols.set(canonical(n.name), {
          type: canonical(n.type),
          node: n,
        });
      if (!["class", "type", "function", "procedure"].includes(n.kind)) {
        if (n.body) this.collect(n.body, env);
        if (n.other) this.collect(n.other, env);
        for (const b of n.branches || []) this.collect(b.body, env);
      }
    }
  }
  ancestors(name: string): Node[] {
    const nodes: Node[] = [];
    const visited = new Set<string>();
    let n = this.types.get(canonical(name));
    while (n) {
      const key = canonical(n.name);
      if (visited.has(key)) throw new Error("Inheritance cycle: " + key);
      visited.add(key);
      nodes.unshift(n);
      n = n.base ? this.types.get(canonical(n.base)) : undefined;
    }
    return nodes;
  }
  fields(name: string) {
    return this.ancestors(name).flatMap((n) =>
      (n.body || [])
        .filter((f: Node) => f.kind === "declare")
        .flatMap((f: Node) =>
          f.names.map((name: string) => ({
            name: canonical(name),
            type: canonical(f.type),
            access: f.access || "PUBLIC",
            owner: canonical(n.name),
            node: f,
          })),
        ),
    );
  }
  method(name: string, method: string): Node | undefined {
    return this.ancestors(name)
      .reverse()
      .flatMap((n) => n.body || [])
      .find(
        (n) =>
          ["function", "procedure"].includes(n.kind) &&
          canonical(n.name) === canonical(method),
      );
  }
  environment(module?: Node, owner?: string): Environment {
    const env: Environment = {
      symbols: new Map(this.global.symbols),
      module,
      owner,
    };
    if (owner) {
      for (const f of this.fields(owner))
        if (f.access !== "PRIVATE" || f.owner === owner)
          env.symbols.set(f.name, { type: f.type, node: f.node });
      env.symbols.set("THIS", { type: owner });
      const base = this.types.get(owner)?.base;
      if (base) env.symbols.set("SUPER", { type: canonical(base) });
    }
    for (const p of module?.params || [])
      env.symbols.set(canonical(p.name), { type: canonical(p.type) });
    if (module) this.collect(module.body, env);
    return env;
  }
  type(e: Expr, env: Environment): string {
    switch (e.kind) {
      case "literal":
        return e.type;
      case "name":
        return (
          env.symbols.get(canonical(e.name))?.type ||
          this.modules.get(canonical(e.name))?.type?.toUpperCase() ||
          this.enums.get(canonical(e.name)) ||
          "UNKNOWN"
        );
      case "new":
        return canonical(e.name);
      case "index":
        return this.type(e.target, env).replace(/^ARRAY\s*\[.*\]\s*OF\s*/, "");
      case "member":
        return (
          (
            this.fields(this.type(e.target, env)).find(
              (f) =>
                f.name === canonical(e.name) &&
                f.owner === env.owner &&
                f.access === "PRIVATE",
            ) ||
            this.fields(this.type(e.target, env))
              .filter(
                (f) => f.name === canonical(e.name) && f.access !== "PRIVATE",
              )
              .at(-1) ||
            this.fields(this.type(e.target, env))
              .filter((f) => f.name === canonical(e.name))
              .at(-1)
          )?.type || "UNKNOWN"
        );
      case "deref":
        return (
          this.types
            .get(this.type(e.target, env))
            ?.definition?.slice(1)
            .trim()
            .toUpperCase() || "UNKNOWN"
        );
      case "unary":
        return e.op === "NOT"
          ? "BOOLEAN"
          : e.op === "^"
            ? "^" + this.type(e.right, env)
            : this.type(e.right, env);
      case "binary": {
        if (["AND", "OR", "=", "<>", "<", "<=", ">", ">="].includes(e.op))
          return "BOOLEAN";
        if (e.op === "&") return "STRING";
        if (e.op === "DIV" || e.op === "MOD") return "INTEGER";
        if (e.op === "/") return "REAL";
        const a = this.type(e.left, env),
          b = this.type(e.right, env);
        if (this.types.get(a)?.definition?.startsWith("(")) {
          if (a === b && e.op === "-") return "INTEGER";
          if (b === "INTEGER" && ["+", "-"].includes(e.op)) return a;
        }
        return a === "REAL" || b === "REAL" ? "REAL" : a === b ? a : "UNKNOWN";
      }
      case "call": {
        let fn: Node | undefined;
        if (e.target.kind === "member")
          fn = this.method(this.type(e.target.target, env), e.target.name);
        if (e.target.kind === "name") {
          const name = canonical(e.target.name);
          fn =
            (env.owner ? this.method(env.owner, name) : undefined) ||
            this.modules.get(name);
          if (!fn) {
            if (
              [
                "LENGTH",
                "ASC",
                "INT",
                "DIV",
                "MOD",
                "DAY",
                "MONTH",
                "YEAR",
                "DAYINDEX",
              ].includes(name)
            )
              return "INTEGER";
            if (["RAND", "RANDOM"].includes(name)) return "REAL";
            if (name === "ROUND")
              return e.args[1]?.kind === "literal" && e.args[1].value === 0
                ? "INTEGER"
                : "REAL";
            if (name === "STR_TO_NUM")
              return e.args[0]?.kind === "literal"
                ? String(e.args[0].value).includes(".")
                  ? "REAL"
                  : "INTEGER"
                : "NUMBER";
            if (["IS_NUM", "EOF"].includes(name)) return "BOOLEAN";
            if (["SETDATE", "TODAY"].includes(name)) return "DATE";
            if (["UCASE", "LCASE", "TO_UPPER", "TO_LOWER"].includes(name))
              return e.args.length ? this.type(e.args[0], env) : "UNKNOWN";
            return "STRING";
          }
        }
        return fn ? canonical(fn.type || "VOID") : "UNKNOWN";
      }
    }
  }
  assignable(target: string, source: string) {
    target = canonical(target);
    source = canonical(source);
    if (source === "UNKNOWN" || target === "UNKNOWN") return true;
    if (target === source) return true;
    const a = target.match(/^ARRAY\s*\[(.+)\]\s+OF\s+(.+)$/),
      b = source.match(/^ARRAY\s*\[(.+)\]\s+OF\s+(.+)$/);
    if (a && b) {
      if (a[2] !== b[2]) return false;
      const da = a[1].split(","),
        db = b[1].split(",");
      return (
        da.length === db.length &&
        da.every((d, i) => {
          const x = d.split(":").map(Number),
            y = db[i].split(":").map(Number);
          return [...x, ...y].some(Number.isNaN) || x[1] - x[0] === y[1] - y[0];
        })
      );
    }
    if (target === "REAL" && source === "INTEGER") return true;
    if (
      ["STRING", "CHAR"].includes(target) &&
      ["STRING", "CHAR"].includes(source)
    )
      return true;
    const def = this.types.get(target);
    if (def?.definition?.startsWith("^") && source.startsWith("^"))
      return canonical(def.definition) === source;
    if (this.types.get(source)?.kind === "class")
      return this.ancestors(source).some((n) => canonical(n.name) === target);
    return false;
  }
}
