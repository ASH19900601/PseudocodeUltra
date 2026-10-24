import { profile, DiagnosticError, type DialectId } from "./dialects";
import { parse, type Node } from "./parser";
import { analyze } from "./semantic";
import type { RuntimePolicies } from "./policies";
import { snapshotInstructions, type Atom } from "./native/snapshot";
import { canonical, Model, type Environment } from "./model";
import type { Expr } from "./lexer";
import { pythonRuntime } from "./native/python";
import { javaRuntime } from "./native/java";
import { vbRuntime } from "./native/vb";
export type Target = "python" | "java" | "vb";
export interface ExportOptions {
  seed?: number;
  clock?: string;
  files?: Record<string, { text: string; records?: Record<string, any> }>;
  maxSteps?: number;
  policies?: Partial<RuntimePolicies>;
  profileOptions?: Parameters<typeof profile>[1];
}
export function transpile(
  source: string,
  id: DialectId,
  target: Target,
  options: ExportOptions = {},
): string {
  const program = analyze(
    source,
    profile(id, { ...options.profileOptions, strictness: "exam" }),
  );
  const error = program.diagnostics.find((d) => d.severity === "error");
  if (error)
    throw new DiagnosticError(
      error.code,
      error.message,
      error.line,
      error.column,
    );
  const model = new Model(program),
    py = target === "python",
    vb = target === "vb",
    nil = py ? "None" : vb ? "Nothing" : "null";
  let env = model.environment(),
    indent = py ? 0 : 1,
    counter = 0;
  const q = (s: string) =>
    vb
      ? '"' +
        s
          .replace(/"/g, '""')
          .replace(/\n/g, '" & vbLf & "')
          .replace(/\r/g, '" & vbCr & "') +
        '"'
      : JSON.stringify(s);
  const bool = (b: boolean) =>
    py || vb ? (b ? "True" : "False") : b ? "true" : "false";
  const call = (name: string, args: string[]) => `${name}(${args.join(", ")})`;
  const valueCell = (value: string, type: string, constant = false) =>
    call("newCell", [value, q(type), bool(constant)]);
  const get = (name: string) =>
    py
      ? `s[${q(canonical(name))}]`
      : vb
        ? `s(${q(canonical(name))})`
        : `s.get(${q(canonical(name))})`;
  const fname = (n: Node) =>
    "fn_" + (n.owner ? canonical(n.owner) + "_" : "") + canonical(n.name);
  const arg = (e: Expr) =>
    ["name", "index", "member", "deref"].includes(e.kind) &&
    !(
      e.kind === "name" &&
      (model.enums.has(canonical(e.name)) ||
        model.modules.get(canonical(e.name))?.kind === "function")
    )
      ? cell(e)
      : valueCell(expr(e), model.type(e, env));
  function cell(e: Expr): string {
    if (e.kind === "name") return get(e.name);
    if (e.kind === "index")
      return call("at", [expr(e.target), ...e.args.map(expr)]);
    if (e.kind === "member")
      return call("field", [
        expr(e.target),
        q(canonical(e.name)),
        q(env.owner || ""),
      ]);
    if (e.kind === "deref") return call("deref", [expr(e.target)]);
    throw new DiagnosticError(
      "LVALUE",
      "需要可赋值变量 / Assignable variable required",
      e.token.line,
      e.token.column,
    );
  }
  function expr(e: Expr): string {
    switch (e.kind) {
      case "literal":
        if (e.type === "DATE") return call("parseDate", [q(e.value)]);
        return typeof e.value === "boolean"
          ? bool(e.value)
          : typeof e.value === "string"
            ? q(e.value)
            : String(e.value) +
              (py
                ? ""
                : vb
                  ? "R"
                  : Number.isInteger(e.value) && !String(e.value).includes("e")
                    ? ".0"
                    : "");
      case "name":
        if (
          model.modules.get(canonical(e.name))?.kind === "function" &&
          model.modules.get(canonical(e.name))!.params.length === 0
        )
          return call(fname(model.modules.get(canonical(e.name))!), []);
        if (model.enums.has(canonical(e.name)))
          return call("enumValue", [
            q(model.enums.get(canonical(e.name))!),
            q(canonical(e.name)),
          ]);
        if (canonical(e.name) === "SUPER") return "self";
      case "index":
      case "member":
      case "deref":
        return call("readCell", [cell(e)]);
      case "unary":
        return e.op === "^"
          ? call("pointer", [cell(e.right)])
          : e.op === "NOT"
            ? (py ? "(not " : vb ? "(Not " : "(!") +
              call("truth", [expr(e.right)]) +
              ")"
            : call("op", [
                q(e.op === "-" ? "*" : "+"),
                e.op === "-" ? (vb ? "-1.0" : "-1") : vb ? "0.0" : "0",
                expr(e.right),
              ]);
      case "binary":
        if (
          (e.op === "AND" || e.op === "OR") &&
          options.policies?.shortCircuit === false
        )
          return call("logical", [q(e.op), expr(e.left), expr(e.right)]);
        if (e.op === "AND" || e.op === "OR")
          return (
            "(" +
            call("truth", [expr(e.left)]) +
            (py
              ? e.op === "AND"
                ? " and "
                : " or "
              : vb
                ? e.op === "AND"
                  ? " AndAlso "
                  : " OrElse "
                : e.op === "AND"
                  ? " && "
                  : " || ") +
            call("truth", [expr(e.right)]) +
            ")"
          );
        return call("op", [q(e.op), expr(e.left), expr(e.right)]);
      case "new":
        return call("make_" + canonical(e.name), e.args.map(arg));
      case "call": {
        if (e.target.kind === "member") {
          if (
            e.target.target.kind === "name" &&
            canonical(e.target.target.name) === "SUPER"
          ) {
            const base = model.types.get(env.owner || "")?.base,
              method = base && model.method(base, e.target.name);
            if (!method)
              throw new DiagnosticError(
                "CALL",
                "未知父类方法 / Unknown super method",
                e.token.line,
              );
            return call(fname(method), ["self", ...e.args.map(arg)]);
          }
          return call("dispatch", [
            expr(e.target.target),
            q(canonical(e.target.name)),
            q(env.owner || ""),
            ...e.args.map(arg),
          ]);
        }
        if (e.target.kind !== "name")
          throw new DiagnosticError(
            "CALL",
            "无效调用 / Invalid call",
            e.token.line,
          );
        const name = canonical(e.target.name),
          method = env.owner && model.method(env.owner, name),
          fn = method || model.modules.get(name);
        if (fn && method && method.access === "PRIVATE")
          return call(fname(method), ["self", ...e.args.map(arg)]);
        if (fn)
          return method
            ? call("dispatch", [
                "self",
                q(name),
                q(env.owner!),
                ...e.args.map(arg),
              ])
            : call(fname(fn), e.args.map(arg));
        return call("builtin", [q(name), ...e.args.map(expr)]);
      }
    }
  }
  function returns(nodes: Node[]): boolean {
    return nodes.some(
      (n) =>
        n.kind === "return" ||
        (n.kind === "if" && returns(n.body) && returns(n.other)) ||
        (n.kind === "case" &&
          n.branches.some((b: any) => b.otherwise) &&
          n.branches.every((b: any) => returns(b.body))),
    );
  }
  const lines: string[] = [];
  const emit = (s: string) => lines.push("    ".repeat(indent) + s);
  const statement = (s: string) => emit(s + (py || vb ? "" : ";"));
  const open = (s: string) => {
    emit(s + (py ? ":" : vb ? "" : " {"));
    indent++;
  };
  const close = (s: string) => {
    indent--;
    if (!py) emit(vb ? s : "}");
  };
  const local = (name: string, value: string, type = "Object") =>
    statement(
      (py ? "" : vb ? "Dim " : "") +
        name +
        (py ? "" : vb ? " As " + type : "") +
        (py || vb ? " = " : " = ") +
        value,
    );
  const declareLocal = (name: string, value: string, type = "Object") =>
    statement(
      py
        ? `${name} = ${value}`
        : vb
          ? `Dim ${name} As ${type} = ${value}`
          : `${type} ${name} = ${value}`,
    );
  const bind = (name: string, c: string) =>
    statement(
      py
        ? `s[${q(canonical(name))}] = ${c}`
        : vb
          ? `s(${q(canonical(name))}) = ${c}`
          : `s.put(${q(canonical(name))}, ${c})`,
    );
  function put(e: Expr, v: Expr) {
    statement(call("put", [cell(e), expr(v), q(model.type(v, env))]));
  }
  function block(nodes: Node[]) {
    if (py && !nodes.length) emit("pass");
    let emitted = false;
    for (const n of nodes) {
      if (["function", "procedure", "type", "class"].includes(n.kind)) continue;
      emitted = true;
      emit(
        (py ? "#" : vb ? "'" : "//") +
          ` Source line ${n.line}: ${n.text.replace(/[\r\n]/g, " ")}`,
      );
      statement(call("tick", [String(n.line)]));
      switch (n.kind) {
        case "declare":
          for (const name of n.names)
            bind(
              name,
              valueCell(
                call("defaultValue", [q(canonical(n.type)), "s"]),
                canonical(n.type),
              ),
            );
          break;
        case "constant":
          bind(
            n.name,
            valueCell(expr(n.value), model.type(n.value, env), true),
          );
          break;
        case "define":
          if (n.type)
            bind(
              n.name,
              valueCell(
                call("defaultValue", [q(canonical(n.type)), "s"]),
                canonical(n.type),
              ),
            );
          statement(
            call("put", [
              get(n.name),
              call("makeSet", n.values.map(expr)),
              q(
                canonical(
                  n.type ||
                    env.symbols.get(canonical(n.name))?.type ||
                    "UNKNOWN",
                ),
              ),
            ]),
          );
          break;
        case "assign":
          if (
            n.target.kind === "name" &&
            n.value.kind === "new" &&
            env.symbols.get(canonical(n.target.name))?.node === n
          )
            bind(n.target.name, valueCell(nil, canonical(n.value.name)));
          put(n.target, n.value);
          break;
        case "input":
          statement(call("readInput", [cell(n.target)]));
          break;
        case "output":
          statement(
            call(
              "output",
              n.values.map((e: Expr) =>
                call("render", [expr(e), q(model.type(e, env))]),
              ),
            ),
          );
          break;
        case "call":
          statement(expr(n.value));
          break;
        case "return":
          statement((vb ? "Return " : "return ") + expr(n.value));
          break;
        case "if":
          open(
            py
              ? `if truth(${expr(n.cond)})`
              : vb
                ? `If truth(${expr(n.cond)}) Then`
                : `if (truth(${expr(n.cond)}))`,
          );
          block(n.body);
          if (n.other.length) {
            indent--;
            emit(py ? "else:" : vb ? "Else" : "} else {");
            indent++;
            block(n.other);
          }
          close("End If");
          break;
        case "while":
          open(
            py
              ? `while truth(${expr(n.cond)})`
              : vb
                ? `While truth(${expr(n.cond)})`
                : `while (truth(${expr(n.cond)}))`,
          );
          statement(call("tick", [String(n.line)]));
          block(n.body);
          close("End While");
          break;
        case "repeat":
          open(py ? "while True" : vb ? "Do" : "while (true)");
          statement(call("tick", [String(n.line)]));
          block(n.body);
          emit(
            py
              ? `if truth(${expr(n.cond)}): break`
              : vb
                ? `If truth(${expr(n.cond)}) Then Exit Do`
                : `if (truth(${expr(n.cond)})) break;`,
          );
          close("Loop");
          break;
        case "for": {
          const k = ++counter,
            a = "from" + k,
            b = "limit" + k,
            c = "stride" + k;
          declareLocal(
            a,
            call("whole", [expr(n.from)]),
            vb ? "Double" : "double",
          );
          declareLocal(
            b,
            call("whole", [expr(n.to)]),
            vb ? "Double" : "double",
          );
          declareLocal(
            c,
            call("whole", [expr(n.step)]),
            vb ? "Double" : "double",
          );
          statement(call("validStep", [c]));
          statement(call("put", [get(n.name), a, q("INTEGER")]));
          const bound =
            options.policies?.forBounds === "eachIteration"
              ? call("whole", [expr(n.to)])
              : b;
          const cond = py
            ? `number(readCell(${get(n.name)})) <= ${bound} if ${c} > 0 else number(readCell(${get(n.name)})) >= ${bound}`
            : vb
              ? `If(${c} > 0, number(readCell(${get(n.name)})) <= ${bound}, number(readCell(${get(n.name)})) >= ${bound})`
              : `(${c} > 0 ? number(readCell(${get(n.name)})) <= ${bound} : number(readCell(${get(n.name)})) >= ${bound})`;
          open(
            py
              ? "while " + cond
              : vb
                ? "While " + cond
                : "while (" + cond + ")",
          );
          statement(call("tick", [String(n.line)]));
          block(n.body);
          statement(
            call("put", [
              get(n.name),
              call("op", [q("+"), call("readCell", [get(n.name)]), c]),
              q("INTEGER"),
            ]),
          );
          close("End While");
          break;
        }
        case "case": {
          const k = "choice" + ++counter;
          declareLocal(k, expr(n.value));
          n.branches.forEach((b: any, i: number) => {
            const and = py ? " and " : vb ? " AndAlso " : " && ",
              or = py ? " or " : vb ? " OrElse " : " || ";
            const cond = b.otherwise
              ? bool(true)
              : b.ranges
                  .map((r: Expr[]) =>
                    r.length === 1
                      ? call("truth", [call("op", [q("="), k, expr(r[0])])])
                      : "(" +
                        call("truth", [call("op", [q(">="), k, expr(r[0])])]) +
                        and +
                        call("truth", [call("op", [q("<="), k, expr(r[1])])]) +
                        ")",
                  )
                  .join(or);
            if (i) {
              indent--;
              emit(
                b.otherwise
                  ? py
                    ? "else:"
                    : vb
                      ? "Else"
                      : "} else {"
                  : py
                    ? `elif ${cond}:`
                    : vb
                      ? `ElseIf ${cond} Then`
                      : `} else if (${cond}) {`,
              );
              indent++;
            } else if (!b.otherwise)
              open(py ? "if " + cond : vb ? `If ${cond} Then` : `if (${cond})`);
            block(b.body);
          });
          if (
            n.branches.length &&
            !(n.branches.length === 1 && n.branches[0].otherwise)
          )
            close("End If");
          break;
        }
        case "open":
          statement(call("openFile", [expr(n.file), q(n.mode)]));
          break;
        case "close":
          statement(call("closeFile", [expr(n.file)]));
          break;
        case "writefile":
          statement(call("writeFile", [expr(n.file), expr(n.value)]));
          break;
        case "readfile":
          statement(call("readFile", [expr(n.file), cell(n.value)]));
          break;
        case "seek":
          statement(call("seek", [expr(n.file), expr(n.value)]));
          break;
        case "putrecord":
          statement(call("putRecord", [expr(n.file), expr(n.value)]));
          break;
        case "getrecord":
          statement(call("getRecord", [expr(n.file), cell(n.value)]));
          break;
        default:
          throw new DiagnosticError(
            "EXPORT_NODE",
            "未知 AST 节点 / Unknown AST node " + n.kind,
            n.line,
          );
      }
      if (returns([n])) return;
    }
    if (py && !emitted && nodes.length) emit("pass");
  }
  // Emit native module and method functions. All names are generated from validated identifiers.
  const allModules = [
    ...model.modules.values(),
    ...[...model.types.values()]
      .filter((n) => n.kind === "class")
      .flatMap((n) =>
        n.body.filter((x: Node) => ["function", "procedure"].includes(x.kind)),
      ),
  ];
  for (const n of allModules) {
    env = model.environment(n, n.owner);
    const params = [
      ...(n.owner ? [py ? "self" : vb ? "self As Obj" : "Obj self"] : []),
      ...n.params.map((_: any, i: number) =>
        py ? "p" + i : vb ? `p${i} As Cell` : `Cell p${i}`,
      ),
    ];
    open(
      py
        ? `def ${fname(n)}(${params.join(", ")})`
        : vb
          ? `Function ${fname(n)}(${params.join(", ")}) As Object`
          : `static Object ${fname(n)}(${params.join(", ")})`,
    );
    declareLocal(
      "s",
      py
        ? 'globals()["s"].copy()'
        : vb
          ? "New Dictionary(Of String, Cell)(globalScope)"
          : "new LinkedHashMap<>(globalScope)",
      vb ? "Dictionary(Of String, Cell)" : "Map<String, Cell>",
    );
    if (n.owner) {
      statement(call("bindFields", ["s", "self", q(n.owner)]));
      bind("THIS", valueCell("self", n.owner));
    }
    for (let i = 0; i < n.params.length; i++) {
      const a = n.params[i];
      bind(
        a.name,
        call("parameter", [
          `p${i}`,
          q(canonical(a.type)),
          bool(a.mode === "BYREF"),
          "s",
        ]),
      );
    }
    statement(call("enterCall", [q((n.owner ? n.owner + "." : "") + n.name)]));
    open(py ? "try" : vb ? "Try" : "try");
    block(n.body);
    if (n.kind === "procedure")
      statement(vb ? "Return Nothing" : py ? "return None" : "return null");
    else if (!returns(n.body))
      statement((vb ? "Return " : "return ") + call("missingReturn", []));
    close("");
    if (vb) {
      lines.pop();
      emit("Finally");
      indent++;
    } else if (py) {
      emit("finally:");
      indent++;
    } else {
      emit("finally {");
      indent++;
    }
    statement(call("leaveCall", []));
    close(vb ? "End Try" : "");
    close("End Function");
  }
  // Constructors allocate native typed cells, then run base-to-derived property initializers.
  for (const cls of [...model.types.values()].filter(
    (n) => n.kind === "class",
  )) {
    const name = canonical(cls.name),
      ctor = model.method(name, "NEW"),
      params = (ctor?.params || []).map((_: any, i: number) =>
        py ? "p" + i : vb ? `p${i} As Cell` : `Cell p${i}`,
      );
    env = model.environment(undefined, name);
    open(
      py
        ? `def make_${name}(${params.join(", ")})`
        : vb
          ? `Function make_${name}(${params.join(", ")}) As Object`
          : `static Object make_${name}(${params.join(", ")})`,
    );
    declareLocal(
      "self",
      call("allocate", [q(name), py ? 'globals()["s"]' : "globalScope"]),
      vb ? "Obj" : "Obj",
    );
    declareLocal(
      "s",
      py
        ? "dict(self.fields)"
        : vb
          ? "New Dictionary(Of String, Cell)(self.fields)"
          : "new LinkedHashMap<>(self.fields)",
      vb ? "Dictionary(Of String, Cell)" : "Map<String, Cell>",
    );
    for (const ancestor of model.ancestors(name)) {
      statement(
        py
          ? 's = globals()["s"].copy()'
          : vb
            ? "s = New Dictionary(Of String, Cell)(globalScope)"
            : "s = new LinkedHashMap<>(globalScope)",
      );
      statement(call("bindFields", ["s", "self", q(canonical(ancestor.name))]));
      bind("THIS", valueCell("self", name));
      env = model.environment(undefined, canonical(ancestor.name));
      block(
        (ancestor.body || []).filter(
          (n: Node) => !["declare", "function", "procedure"].includes(n.kind),
        ),
      );
    }
    if (ctor)
      statement(
        call(fname(ctor), [
          "self",
          ...ctor.params.map((_: any, i: number) => "p" + i),
        ]),
      );
    statement((vb ? "Return " : "return ") + "self");
    close("End Function");
  }
  // Runtime method dispatch preserves overridden methods through base-typed variables.
  open(
    py
      ? "def dispatch(value, method, caller, *args)"
      : vb
        ? "Function dispatch(value As Object, method As String, caller As String, ParamArray args() As Cell) As Object"
        : "static Object dispatch(Object value, String method, String caller, Cell... args)",
  );
  declareLocal(
    "obj",
    py ? "value" : vb ? "CType(value, Obj)" : "(Obj)value",
    vb ? "Obj" : "Obj",
  );
  for (const cls of [...model.types.values()].filter(
    (n) => n.kind === "class",
  )) {
    const methods = new Map<string, Node>();
    for (const base of model.ancestors(cls.name))
      for (const m of base.body)
        if (["function", "procedure"].includes(m.kind))
          methods.set(canonical(m.name), m);
    for (const [name, m] of methods) {
      const cond = py
        ? `obj.name == ${q(canonical(cls.name))} and method == ${q(name)}`
        : vb
          ? `obj.name = ${q(canonical(cls.name))} AndAlso method = ${q(name)}`
          : `obj.name.equals(${q(canonical(cls.name))}) && method.equals(${q(name)})`;
      open(
        py ? "if " + cond : vb ? "If " + cond + " Then" : "if (" + cond + ")",
      );
      statement(
        call("privateAccess", [
          q(m.access || "PUBLIC"),
          q(m.owner || canonical(cls.name)),
          "caller",
        ]),
      );
      statement(call("arity", ["args", String(m.params.length)]));
      statement(
        (vb ? "Return " : "return ") +
          call(fname(m), [
            "obj",
            ...m.params.map((_: any, i: number) =>
              py ? `args[${i}]` : vb ? `args(${i})` : `args[${i}]`,
            ),
          ]),
      );
      close("End If");
    }
  }
  statement(call("unknownMethod", []));
  if (!py) statement(vb ? "Return Nothing" : "return null");
  close("End Function");
  const snapshot = snapshotInstructions(options.files || {});
  const loaders: string[] = [];
  const atom = (a: Atom): string =>
    a.kind === "null"
      ? nil
      : a.kind === "string"
        ? q(a.value)
        : a.kind === "boolean"
          ? bool(a.value)
          : a.kind === "number"
            ? String(a.value) +
              (py ? "" : vb ? "R" : Number.isInteger(a.value) ? ".0" : "")
            : call(a.name, a.args.map(atom));
  for (let i = 0; i < snapshot.length; i += 100) {
    const name = "loadData" + i / 100;
    loaders.push(name);
    open(py ? `def ${name}()` : vb ? `Sub ${name}()` : `static void ${name}()`);
    for (const instruction of snapshot.slice(i, i + 100))
      statement(call(instruction.name, instruction.args.map(atom)));
    close("End Sub");
  }
  // Metadata initialization is generated, so the standalone program needs no parser or external package.
  function initialize() {
    for (const [name, value] of Object.entries(options.policies || {}))
      statement(call("configurePolicy", [q(name), q(String(value))]));
    statement(
      call("configure", [
        q(id),
        String(options.seed ?? 123456789) + (py ? "" : "L"),
        q(options.clock || ""),
        String(options.maxSteps ?? 100000),
      ]),
    );
    for (const t of model.types.values()) {
      statement(
        call("registerType", [
          q(canonical(t.name)),
          q(t.kind),
          q(canonical(t.base || "")),
          q(canonical(t.definition || "")),
        ]),
      );
      for (const f of (t.body || []).filter((f: Node) => f.kind === "declare"))
        for (const name of f.names)
          statement(
            call("registerField", [
              q(canonical(t.name)),
              q(canonical(name)),
              q(canonical(f.type)),
              q(f.access || "PUBLIC"),
            ]),
          );
    }
    for (const [name, f] of Object.entries(options.files || {}))
      statement(call("initialFile", [q(name), q(f.text)]));
    for (const name of loaders) statement(call(name, []));
  }
  env = model.environment();
  if (py) {
    emit("s = {}");
    initialize();
    block(program.body);
    statement("finish()");
    return pythonRuntime + "\n" + lines.join("\n") + "\n";
  }
  open(vb ? "Sub Main()" : "public static void main(String[] args)");
  declareLocal(
    "s",
    "globalScope",
    vb ? "Dictionary(Of String, Cell)" : "Map<String, Cell>",
  );
  initialize();
  block(program.body);
  statement("finish()");
  close("End Sub");
  return (
    (vb ? vbRuntime : javaRuntime) +
    "\n" +
    lines.join("\n") +
    (vb ? "\nEnd Module\n" : "\n}\n")
  );
}
