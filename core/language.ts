import { profile, type DialectId } from "./dialects";
import {
  lex,
  normalizeWithMap,
  keywords,
  expression,
  type Token,
  type Expr,
} from "./lexer";
import { parse, type Node } from "./parser";
import { Model, canonical, type Environment } from "./model";
import { builtinSignature, signatureText } from "./builtins";
export interface Definition {
  id: string;
  name: string;
  type: string;
  line: number;
  column: number;
  from: number;
  to: number;
  scope: string;
  kind: string;
}
export interface Reference {
  from: number;
  to: number;
  line: number;
  column: number;
  symbol: Definition;
}
export class LanguageDocument {
  program;
  model: Model;
  tokens: Token[];
  private tokensByLine = new Map<number, Token[]>();
  symbols: Definition[] = [];
  references: Reference[] = [];
  byOffset = new Map<number, Reference>();
  private globals = new Map<string, Definition>();
  private moduleSymbols = new Map<string, Definition>();
  private locals = new Map<Node, Map<string, Definition>>();
  private members = new Map<string, Definition>();
  private types = new Map<string, Definition>();
  private enums = new Map<string, Definition>();
  constructor(
    public source: string,
    public dialect: DialectId,
  ) {
    this.program = parse(source, profile(dialect));
    this.model = new Model(this.program);
    const norm = normalizeWithMap(source);
    try {
      this.tokens = lex(norm.text).map((t) => ({
        ...t,
        from: norm.offsets[t.from!] ?? source.length,
        to: norm.offsets[t.to!] ?? source.length,
      }));
    } catch {
      this.tokens = [];
    }
    const rows = source.split("\n"),
      offsets: number[] = [];
    let offset = 0;
    for (const row of rows) {
      offsets.push(offset);
      offset += row.length + 1;
    }
    for (const t of this.tokens) {
      t.column = t.from! - (offsets[t.line - 1] || 0) + 1;
      const row = this.tokensByLine.get(t.line) || [];
      row.push(t);
      this.tokensByLine.set(t.line, row);
    }
    const token = (n: Node, name: string, after = -1) =>
      Array.from(
        { length: (n.headerEndLine || n.line) - n.line + 1 },
        (_, i) => this.tokensByLine.get(n.line + i) || [],
      )
        .flat()
        .find(
          (t) =>
            t.from! > after &&
            t.kind === "name" &&
            canonical(t.text) === canonical(name),
        );
    const create = (
      name: string,
      type: string,
      kind: string,
      scope: string,
      t: Token | undefined,
      group?: Definition,
    ) => {
      if (!t) return undefined;
      const d: Definition = group
        ? { ...group }
        : {
            id: kind + ":" + t.from,
            name,
            type,
            line: t.line,
            column: t.column,
            from: t.from!,
            to: t.to!,
            scope,
            kind,
          };
      if (!group) this.symbols.push(d);
      this.bind(t, d);
      return d;
    };
    for (const n of this.program.body) {
      if (["type", "class"].includes(n.kind)) {
        const d = create(
          n.name,
          n.kind.toUpperCase(),
          n.kind,
          "main",
          token(n, n.name),
        );
        if (d) this.types.set(canonical(n.name), d);
      }
      if (["function", "procedure"].includes(n.kind)) {
        const d = create(
          n.name,
          n.type || "VOID",
          n.kind,
          "main",
          token(n, n.name),
        );
        if (d) {
          this.globals.set(canonical(n.name), d);
          this.moduleSymbols.set(canonical(n.name), d);
        }
      }
    }
    for (const t of this.model.types.values()) {
      const owner = canonical(t.name);
      for (const f of t.body || [])
        if (f.kind === "declare")
          for (const name of f.names) {
            const d = create(name, f.type, "field", t.name, token(f, name));
            if (d) this.members.set(owner + "." + canonical(name), d);
          }
      if (t.definition?.startsWith("(")) {
        for (const name of t.definition.slice(1, -1).split(",")) {
          const d = create(
            name.trim(),
            owner,
            "enum",
            t.name,
            token(t, name.trim()),
          );
          if (d) this.enums.set(canonical(name), d);
        }
      }
    }
    const classes = [...this.model.types.values()]
      .filter((t) => t.kind === "class")
      .sort((a, b) => {
        try {
          return (
            this.model.ancestors(a.name).length -
            this.model.ancestors(b.name).length
          );
        } catch {
          return 0;
        }
      });
    for (const t of classes)
      for (const n of t.body || [])
        if (["function", "procedure"].includes(n.kind)) {
          const parent = t.base && this.model.method(t.base, n.name),
            inherited =
              parent &&
              parent.access !== "PRIVATE" &&
              canonical(n.name) !== "NEW"
                ? this.members.get(
                    canonical(parent.owner) + "." + canonical(parent.name),
                  )
                : undefined;
          const d = create(
            n.name,
            n.type || "VOID",
            n.kind,
            t.name,
            token(n, n.name),
            inherited,
          );
          if (d)
            this.members.set(canonical(t.name) + "." + canonical(n.name), d);
        }
    const declare = (nodes: Node[], scope: Node | undefined) => {
      const map = scope
        ? this.locals.get(scope) || new Map<string, Definition>()
        : this.globals;
      if (scope) this.locals.set(scope, map);
      for (const n of nodes) {
        if (n.kind === "declare")
          for (const name of n.names) {
            const d = create(
              name,
              n.type,
              "variable",
              scope?.owner
                ? scope.owner + "." + scope.name
                : scope?.name || "main",
              token(n, name),
            );
            if (d) map.set(canonical(name), d);
          }
        if (
          n.kind === "assign" &&
          n.target.kind === "name" &&
          n.value.kind === "new" &&
          !map.has(canonical(n.target.name))
        ) {
          const d = create(
            n.target.name,
            n.value.name,
            "variable",
            scope?.name || "main",
            token(n, n.target.name),
          );
          if (d) map.set(canonical(n.target.name), d);
        }
        if (n.kind === "constant" || (n.kind === "define" && n.type)) {
          const d = create(
            n.name,
            n.type ||
              this.model.type(
                n.value,
                this.model.environment(scope, scope?.owner),
              ),
            n.kind === "constant" ? "constant" : "variable",
            scope?.name || "main",
            token(n, n.name),
          );
          if (d) map.set(canonical(n.name), d);
        }
        if (["function", "procedure"].includes(n.kind)) {
          const local = new Map<string, Definition>();
          this.locals.set(n, local);
          let cursor = token(n, n.name)?.from || 0;
          for (const p of n.params) {
            const t = token(n, p.name, cursor);
            if (t) cursor = t.from!;
            const d = create(
              p.name,
              p.type,
              "parameter",
              n.owner ? n.owner + "." + n.name : n.name,
              t,
            );
            if (d) local.set(canonical(p.name), d);
          }
          declare(n.body, n);
        } else if (!["class", "type"].includes(n.kind)) {
          if (n.body) declare(n.body, scope);
          if (n.other) declare(n.other, scope);
          for (const b of n.branches || []) declare(b.body, scope);
        }
      }
    };
    declare(this.program.body, undefined);
    for (const cls of classes)
      declare(
        cls.body.filter((n: Node) =>
          ["function", "procedure"].includes(n.kind),
        ),
        undefined,
      );
    const member = (
      type: string,
      name: string,
      env: Environment,
      method = false,
    ) => {
      if (method) {
        const own =
          env.owner &&
          this.model.types
            .get(env.owner)
            ?.body?.find(
              (n: Node) =>
                ["function", "procedure"].includes(n.kind) &&
                canonical(n.name) === canonical(name) &&
                n.access === "PRIVATE",
            );
        const m = own || this.model.method(type, name);
        return m
          ? this.members.get(canonical(m.owner) + "." + canonical(m.name))
          : undefined;
      }
      const fields = this.model.fields(type),
        key = canonical(name),
        f =
          fields.find(
            (f) =>
              f.owner === env.owner && f.name === key && f.access === "PRIVATE",
          ) ||
          fields
            .filter((f) => f.name === key && f.access !== "PRIVATE")
            .at(-1) ||
          fields.filter((f) => f.name === key).at(-1);
      return f ? this.members.get(f.owner + "." + key) : undefined;
    };
    const resolveName = (name: string, env: Environment) =>
      this.locals.get(env.module!)?.get(canonical(name)) ||
      (env.owner ? member(env.owner, name, env) : undefined) ||
      this.globals.get(canonical(name)) ||
      this.enums.get(canonical(name));
    const expressions = (e: Expr, env: Environment) => {
      switch (e.kind) {
        case "name":
          this.bind(e.token, resolveName(e.name, env));
          break;
        case "literal":
          break;
        case "new": {
          const target = this.tokens.find(
            (t) =>
              t.from! > e.token.from! &&
              canonical(t.text) === canonical(e.name),
          );
          this.bind(target, this.types.get(canonical(e.name)));
          e.args.forEach((a) => expressions(a, env));
          break;
        }
        case "unary":
          expressions(e.right, env);
          break;
        case "binary":
          expressions(e.left, env);
          expressions(e.right, env);
          break;
        case "index":
          expressions(e.target, env);
          e.args.forEach((a) => expressions(a, env));
          break;
        case "deref":
          expressions(e.target, env);
          break;
        case "member":
          expressions(e.target, env);
          this.bind(
            e.nameToken,
            member(this.model.type(e.target, env), e.name, env),
          );
          break;
        case "call": {
          if (e.target.kind === "name") {
            const d =
              (env.owner
                ? member(env.owner, e.target.name, env, true)
                : undefined) ||
              this.moduleSymbols.get(canonical(e.target.name));
            this.bind(e.target.token, d);
          } else if (e.target.kind === "member") {
            expressions(e.target.target, env);
            this.bind(
              e.target.nameToken,
              member(
                this.model.type(e.target.target, env),
                e.target.name,
                env,
                true,
              ),
            );
          }
          e.args.forEach((a) => expressions(a, env));
          break;
        }
      }
    };
    const walk = (nodes: Node[], env: Environment) => {
      for (const n of nodes) {
        if (
          [
            "declare",
            "type",
            "class",
            "procedure",
            "function",
            "define",
          ].includes(n.kind)
        ) {
          const header = Array.from(
            { length: (n.headerEndLine || n.line) - n.line + 1 },
            (_, i) => this.tokensByLine.get(n.line + i) || [],
          ).flat();
          for (const t of header) {
            if (this.byOffset.has(t.from!)) continue;
            const d = this.types.get(canonical(t.text));
            if (d) this.bind(t, d);
          }
        }
        if (["procedure", "function"].includes(n.kind)) {
          walk(n.body, this.model.environment(n, n.owner));
          continue;
        }
        if (n.kind === "class") {
          walk(n.body, this.model.environment(undefined, canonical(n.name)));
          continue;
        }
        if (n.kind === "type") continue;
        for (const key of ["cond", "value", "target", "from", "to", "step"])
          if (n[key]?.kind) expressions(n[key], env);
        for (const e of n.values || []) expressions(e, env);
        if (n.kind === "for") {
          const t = token(n, n.name);
          this.bind(t, resolveName(n.name, env));
          const next = this.tokens.find(
            (t) =>
              t.line === n.endLine && canonical(t.text) === canonical(n.name),
          );
          this.bind(next, resolveName(n.name, env));
        }
        if (n.body) walk(n.body, env);
        if (n.other) walk(n.other, env);
        for (const b of n.branches || []) {
          for (const range of b.ranges)
            for (const e of range) expressions(e, env);
          walk(b.body, env);
        }
      }
    };
    walk(this.program.body, this.model.global);
    this.references = [...this.byOffset.values()].sort(
      (a, b) => a.from - b.from,
    );
  }
  private bind(token: Token | undefined, symbol: Definition | undefined) {
    if (token && symbol && token.from !== undefined)
      this.byOffset.set(token.from, {
        from: token.from,
        to: token.to ?? token.from + token.text.length,
        line: token.line,
        column: token.column,
        symbol,
      });
  }
  at(position: number): Reference | undefined {
    let lo = 0,
      hi = this.references.length;
    while (lo < hi) {
      const m = (lo + hi) >>> 1;
      if (this.references[m].from <= position) lo = m + 1;
      else hi = m;
    }
    const r = this.references[lo - 1];
    return r && position <= r.to ? r : undefined;
  }
  find(name: string, line: number, column?: number) {
    return (
      this.references.find(
        (r) =>
          r.line === line &&
          canonical(r.symbol.name) === canonical(name) &&
          (column === undefined || r.column === column),
      )?.symbol ||
      this.symbols.find(
        (d) => canonical(d.name) === canonical(name) && d.scope === "main",
      )
    );
  }
  rename(position: number, replacement: string) {
    const old = this.at(position)?.symbol;
    if (!old) throw new Error("找不到声明 / Definition not found");
    if (
      !/^[A-Za-z][A-Za-z0-9_]*$/.test(replacement) ||
      keywords.has(canonical(replacement)) ||
      (profile(this.dialect).whileDo && replacement.includes("_"))
    )
      throw new Error("无效或保留的标识符 / Invalid identifier");
    if (old.name.toUpperCase() === "NEW")
      throw new Error("构造函数必须叫 NEW / Constructor name is fixed");
    if (
      this.symbols.some(
        (s) =>
          s.id !== old.id &&
          s.scope === old.scope &&
          canonical(s.name) === canonical(replacement),
      )
    )
      throw new Error("名称冲突 / Identifier conflict");
    const edits = this.references
      .filter((r) => r.symbol.id === old.id)
      .map((r) => ({ from: r.from, to: r.to, insert: replacement }));
    let result = this.source;
    for (const e of [...edits].reverse())
      result = result.slice(0, e.from) + replacement + result.slice(e.to);
    const map = (offset: number) =>
      offset +
      edits
        .filter((e) => e.to <= offset)
        .reduce((n, e) => n + replacement.length - (e.to - e.from), 0);
    const updated = new LanguageDocument(result, this.dialect);
    for (const r of this.references) {
      const next = updated.at(map(r.from)),
        expected = r.symbol.kind + ":" + map(r.symbol.from);
      if (!next || next.symbol.id !== expected)
        throw new Error(
          "重命名会改变其他名称绑定 / Rename would capture a different symbol",
        );
    }
    return result;
  }
}
let cache: { source: string; id: DialectId; doc: LanguageDocument } | undefined;
export function languageDocument(source: string, id: DialectId) {
  if (cache?.source === source && cache.id === id) return cache.doc;
  const doc = new LanguageDocument(source, id);
  cache = { source, id, doc };
  return doc;
}
export function outline(source: string, id: DialectId): Definition[] {
  return languageDocument(source, id).symbols;
}
export function definition(
  source: string,
  id: DialectId,
  name: string,
  line: number,
  column?: number,
) {
  return languageDocument(source, id).find(name, line, column);
}
export function rename(
  source: string,
  id: DialectId,
  name: string,
  replacement: string,
  line: number,
  column?: number,
) {
  const doc = languageDocument(source, id),
    ref = doc.references.find(
      (r) =>
        r.line === line &&
        canonical(r.symbol.name) === canonical(name) &&
        (column === undefined || r.column === column),
    );
  if (!ref) throw new Error("找不到声明 / Definition not found");
  return doc.rename(ref.from, replacement);
}
export function completionKeywords(id: DialectId) {
  const p = profile(id),
    advanced = new Set(
      "CLASS ENDCLASS INHERITS PUBLIC PRIVATE NEW SUPER SET DEFINE SEEK GETRECORD PUTRECORD".split(
        " ",
      ),
    );
  return [...keywords].filter(
    (k) =>
      (p.advanced || !advanced.has(k)) &&
      (p.paramModes ||
        !["BYREF", "BYVAL", "TYPE", "ENDTYPE", "DATE", "APPEND"].includes(k)),
  );
}
export function hover(source: string, id: DialectId, position: number) {
  try {
    const doc = languageDocument(source, id),
      reference = doc.at(position);
    if (reference) {
      const s = reference.symbol;
      return `${s.name} : ${s.type} · ${s.scope} · Line ${s.line}`;
    }
    const token = doc.tokens.find(
      (t) => t.from! <= position && t.to! >= position && t.kind === "name",
    );
    const builtin = token && builtinSignature(token.text, profile(id));
    return builtin
      ? signatureText(builtin) +
          "\n" +
          builtin.description +
          "\n" +
          builtin.source.doc +
          " " +
          builtin.source.section
      : undefined;
  } catch {
    return undefined;
  }
}

export interface LanguageCompletion {
  label: string;
  type: string;
  detail: string;
  info: string;
}
export function completionItems(
  source: string,
  id: DialectId,
  position: number,
): LanguageCompletion[] {
  const p = profile(id);
  const items: LanguageCompletion[] = [
    ...completionKeywords(id).map((label) => ({
      label,
      type: "keyword",
      detail: "keyword",
      info: p.source.doc + " " + p.source.section,
    })),
    ...p.builtins.map((name) => {
      const sig = builtinSignature(name, p)!;
      return {
        label: name,
        type: "function",
        detail: signatureText(sig),
        info:
          sig.description + " · " + sig.source.doc + " " + sig.source.section,
      };
    }),
  ];
  try {
    const doc = languageDocument(source, id);
    const line = source.slice(0, position).split("\n").length;
    let module: Node | undefined, owner: string | undefined;
    for (const n of doc.program.body) {
      if (
        ["function", "procedure"].includes(n.kind) &&
        n.line <= line &&
        n.endLine >= line
      )
        module = n;
      if (n.kind === "class" && n.line <= line && n.endLine >= line) {
        owner = canonical(n.name);
        module = n.body.find(
          (m: Node) =>
            ["function", "procedure"].includes(m.kind) &&
            m.line <= line &&
            m.endLine >= line,
        );
      }
    }
    const env = doc.model.environment(module, owner);
    const prefix = source.slice(
      Math.max(0, source.lastIndexOf("\n", position - 1) + 1),
      position,
    );
    const member = prefix.match(
      /([A-Za-z][\w]*(?:(?:\[[^\]]+\])|\^|(?:\.[A-Za-z]\w*))*)\.\w*$/,
    );
    if (member) {
      const target = expression(member[1], 1, 1, 0, !p.whileDo);
      const type = doc.model.type(target, env);
      const ancestors = doc.model.ancestors(type);
      const fields = doc.model
        .fields(type)
        .filter((f) => f.access !== "PRIVATE" || f.owner === owner)
        .map((f) => ({
          label:
            f.node.names.find((n: string) => canonical(n) === f.name) || f.name,
          type: "property",
          detail: f.type,
          info: f.owner,
        }));
      const methods = ancestors.flatMap((c) =>
        (c.body || [])
          .filter(
            (m: Node) =>
              ["function", "procedure"].includes(m.kind) &&
              (m.access !== "PRIVATE" || m.owner === owner),
          )
          .map((m: Node) => ({
            label: m.name,
            type: "method",
            detail: `${m.name}(${m.params.map((p: any) => p.name + " : " + p.type).join(", ")})${m.type ? " RETURNS " + m.type : ""}`,
            info: m.owner,
          })),
      );
      return [
        ...new Map(
          [...fields, ...methods].map((x) => [canonical(x.label), x]),
        ).values(),
      ];
    }
    for (const [name, sym] of env.symbols) {
      const original =
        doc.symbols.find(
          (d) =>
            canonical(d.name) === name &&
            ((module && d.scope === module.name) || d.scope === "main"),
        )?.name || name;
      items.push({
        label: original,
        type: sym.constant ? "constant" : "variable",
        detail: sym.type,
        info: module?.name || "main",
      });
    }
    for (const n of doc.model.modules.values())
      items.push({
        label: n.name,
        type: "function",
        detail: `${n.name}(${n.params.map((p: any) => p.name + " : " + p.type).join(", ")})${n.type ? " RETURNS " + n.type : ""}`,
        info: p.source.doc + " " + p.source.section,
      });
  } catch {}
  return [...new Map(items.map((x) => [canonical(x.label), x])).values()];
}
export interface UserSignature {
  name: string;
  label: string;
  source: string;
}
export function userSignatures(
  program: { body: Node[] },
  p: ReturnType<typeof profile>,
): UserSignature[] {
  return program.body
    .flatMap((n) =>
      ["function", "procedure"].includes(n.kind)
        ? [n]
        : n.kind === "class"
          ? n.body.filter((m: Node) =>
              ["function", "procedure"].includes(m.kind),
            )
          : [],
    )
    .map((n) => ({
      name: n.name.toUpperCase(),
      label: `${n.owner ? n.owner + "." : ""}${n.name}(${n.params.map((p: any) => `${p.mode === "BYREF" ? "BYREF " : ""}${p.name} : ${p.type}`).join(", ")})${n.type ? " RETURNS " + n.type : ""}`,
      source: p.source.doc + " " + p.source.section,
    }));
}
export function signatureHelp(
  beforeCursor: string,
  id: DialectId,
  users: UserSignature[] = [],
) {
  let tokens: Token[];
  const text = beforeCursor.slice(-5000);
  try {
    tokens = lex(text);
  } catch (e: any) {
    try {
      const rows = text.split("\n"),
        offset =
          rows
            .slice(0, (e.line || 1) - 1)
            .reduce((n, s) => n + s.length + 1, 0) +
          (e.column || 1) -
          1;
      tokens = lex(text.slice(0, offset));
    } catch {
      return undefined;
    }
  }
  const stack: { name: string; index: number }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === "symbol" && t.text === "(")
      stack.push({
        name:
          tokens[i - 1]?.kind === "name"
            ? tokens[i - 1].text.toUpperCase()
            : "",
        index: 0,
      });
    else if (t.kind === "symbol" && t.text === ")") stack.pop();
    else if (t.kind === "symbol" && t.text === "," && stack.length)
      stack.at(-1)!.index++;
  }
  const current = [...stack].reverse().find((s) => s.name);
  if (!current) return undefined;
  const builtin = builtinSignature(current.name, profile(id));
  const user = users.find((s) => s.name === current.name);
  if (!builtin && !user) return undefined;
  return {
    label: builtin ? signatureText(builtin) : user!.label,
    activeParameter: current.index,
    source: builtin
      ? builtin.source.doc + " " + builtin.source.section
      : user!.source,
  };
}
