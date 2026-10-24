import { ruleSource, type Diagnostic, type Profile } from "./dialects";
import { keywords, type Expr } from "./lexer";
import { parse, type Node, type Program } from "./parser";
import { Model, canonical, type Environment } from "./model";
import { builtinSignature } from "./builtins";
import { format } from "./tools";
export function analyze(source: string, p: Profile): Program {
  const program = parse(source, p),
    ds = program.diagnostics;
  let model: Model;
  try {
    model = new Model(program);
  } catch (e: any) {
    ds.push({
      code: "TYPE_CYCLE",
      message: e.message,
      line: 1,
      column: 1,
      severity: "error",
      source: ruleSource("UNKNOWN_TYPE", p),
    });
    return program;
  }
  const add = (
    code: string,
    message: string,
    at: Node | Expr | number,
    severity: "error" | "warning" = "error",
    actions?: Diagnostic["actions"],
  ) => {
    const x: any = typeof at === "number" ? { line: at } : at;
    const token = x.token;
    const line = token?.line || x.line || 1,
      from = typeof x.from === "number" ? x.from : x.span?.from;
    ds.push({
      code,
      message,
      line,
      column: token?.column || x.span?.column || 1,
      severity,
      source: ruleSource(code, p),
      from,
      to: typeof x.to === "number" ? x.to : x.span?.to,
      actions,
    });
  };
  const suggestedTypes = new Map<string, string>();
  const compatible = (a: string, b: string) =>
    model.assignable(a, b) ||
    (b === "NUMBER" && ["INTEGER", "REAL"].includes(a));
  const knownType = (
    t: string,
    at: Node | number,
    path: string[] = [],
    env: Environment = model.global,
  ) => {
    t = canonical(t);
    const a = t.match(/^ARRAY\s*\[(.+)\]\s+OF\s+(.+)$/);
    if (a) {
      const dims = a[1].split(",");
      if (
        dims.length > 2 ||
        dims.some((d) => !/^\s*-?[A-Z0-9_]+\s*:\s*-?[A-Z0-9_]+\s*$/.test(d))
      )
        add(
          "ARRAY_BOUNDS",
          "无效数组维数或边界 / Invalid array dimensions or bounds",
          at,
        );
      for (const dimension of dims) {
        const values = dimension.split(":").map((s) => s.trim());
        for (const value of values)
          if (!/^-?\d+$/.test(value)) {
            const symbol = env.symbols.get(value);
            if (!symbol)
              add(
                "UNDECLARED",
                "数组边界未声明 / Undeclared array bound " + value,
                at,
              );
            else if (symbol.type !== "INTEGER")
              add(
                "ARRAY_BOUNDS",
                "数组边界必须为 INTEGER / Integer array bounds required",
                at,
              );
          }
        if (
          values.every((v) => /^-?\d+$/.test(v)) &&
          Number(values[1]) < Number(values[0])
        )
          add("ARRAY_BOUNDS", "数组上界小于下界 / Invalid bound order", at);
      }
      knownType(a[2], at, path, env);
      return;
    }
    if (p.types.includes(t)) return;
    const def = model.types.get(t);
    if (!def) {
      add(
        ["INTEGER", "REAL", "STRING", "CHAR", "BOOLEAN", "DATE"].includes(t)
          ? "DIALECT_TYPE"
          : "UNKNOWN_TYPE",
        `未知或本方言不可用的类型 / Unknown type ${t}`,
        at,
      );
      return;
    }
    if (def.kind === "class") {
      try {
        model.ancestors(t);
      } catch {
        add("TYPE_CYCLE", "继承循环 / Inheritance cycle", at);
      }
      return;
    }
    if (path.includes(t)) {
      add(
        "TYPE_CYCLE",
        "记录值类型循环引用；请使用指针 / Recursive value type",
        at,
      );
      return;
    }
    if (def.definition) {
      if (def.definition.startsWith("^")) {
        const target = canonical(def.definition.slice(1));
        if (!p.types.includes(target) && !model.types.has(target))
          add("UNKNOWN_TYPE", "未知指针目标类型 / Unknown pointer target", at);
        return;
      }
      if (/^SET OF /i.test(def.definition)) {
        knownType(def.definition.slice(7), at, [...path, t]);
        return;
      }
      if (def.definition.startsWith("(")) return;
      add("TYPE_DEFINITION", "无效类型定义 / Invalid type definition", at);
      return;
    }
    for (const f of def.body || []) {
      if (f.kind !== "declare")
        add(
          "RECORD_FIELD",
          "记录只允许字段声明 / Record fields require declarations",
          f,
        );
      else knownType(f.type, f, [...path, t]);
    }
  };
  const identifier = (name: string, n: Node, constructor = false) => {
    const key = canonical(name);
    if (
      !/^[A-Za-z][A-Za-z0-9_]*$/.test(name) ||
      (keywords.has(key) && !(constructor && key === "NEW"))
    )
      add(
        "IDENTIFIER",
        "无效或保留的标识符 / Invalid or reserved identifier " + name,
        n,
      );
    if (p.whileDo && name.includes("_"))
      add(
        "IDENTIFIER",
        "0478/2210 标识符禁止下划线 / Underscores are not permitted",
        n,
      );
    if (p.styleChecks && !/^[A-Z]/.test(name) && !["i", "j"].includes(name))
      add(
        "STYLE_IDENTIFIER",
        "建议使用 PascalCase / Use PascalCase",
        n,
        "warning",
      );
  };
  function fieldType(
    type: string,
    name: string,
    env: Environment,
    e: Expr,
  ): string {
    const fields = model.fields(type),
      key = canonical(name);
    const own = fields.find(
      (f) => f.name === key && f.owner === env.owner && f.access === "PRIVATE",
    );
    const field =
      own ||
      fields.filter((f) => f.name === key && f.access !== "PRIVATE").at(-1) ||
      fields.filter((f) => f.name === key).at(-1);
    if (!field) {
      add("MEMBER", `不存在的成员 / Unknown member ${name}`, e);
      return "UNKNOWN";
    }
    if (field.access === "PRIVATE" && field.owner !== env.owner)
      add("PRIVATE", "不能访问 PRIVATE 成员 / Private member", e);
    return field.type;
  }
  function expression(
    e: Expr,
    env: Environment,
    asProcedure = false,
    lvalue = false,
  ): string {
    if (lvalue && !["name", "index", "member", "deref"].includes(e.kind))
      add("LVALUE", "需要可赋值变量 / Assignable variable required", e);
    switch (e.kind) {
      case "literal":
        if (!p.types.includes(e.type))
          add("DIALECT_TYPE", "此方言不支持 " + e.type, e);
        return e.type;
      case "name": {
        const name = canonical(e.name),
          sym = env.symbols.get(name);
        const fn = model.modules.get(name);
        if (!sym && fn && !lvalue) {
          if (p.parens)
            add("CALL_FORM", "9618 函数调用需要括号 / Parentheses required", e);
          if (fn.kind !== "function")
            add("CALL_KIND", "过程必须使用 CALL / CALL requires procedure", e);
          if (fn.params.length)
            add("ARITY", "此函数需要实参 / Function arguments required", e);
          return canonical(fn.type || "VOID");
        }
        if (model.enums.has(name) && !lvalue) return model.enums.get(name)!;
        if (!sym) {
          const severity = p.strictness === "exam" ? "error" : "warning";
          const type =
            suggestedTypes.get(
              (env.module?.name || env.owner || "main") + ":" + name,
            ) || "INTEGER";
          const pos = env.module
            ? (program.rawSource || source)
                .split("\n")
                .slice(0, env.module.headerEndLine || env.module.line)
                .join("\n").length + 1
            : 0;
          add("UNDECLARED", `未声明变量 / Undeclared ${e.name}`, e, severity, [
            {
              name: "补充声明 / Add DECLARE",
              edits: [
                { from: pos, to: pos, insert: `DECLARE ${e.name} : ${type}\n` },
              ],
            },
          ]);
          return "UNKNOWN";
        }
        if (lvalue && sym.constant)
          add("CONSTANT", "禁止修改常量 / Cannot assign constant", e);
        return sym.type;
      }
      case "index": {
        const t = expression(e.target, env),
          m = t.match(/^ARRAY\s*\[(.+)\]\s+OF\s+(.+)$/);
        if (!m && t !== "UNKNOWN")
          add("NOT_ARRAY", "需要数组 / Array required", e);
        if (m && m[1].split(",").length !== e.args.length)
          add(
            "ARRAY_BOUNDS",
            "数组下标数量错误 / Array index dimension mismatch",
            e,
          );
        for (const a of e.args)
          if (!["INTEGER", "UNKNOWN"].includes(expression(a, env)))
            add(
              "ARRAY_INDEX_TYPE",
              "数组下标必须为 INTEGER / Integer index required",
              a,
            );
        return m?.[2] || "UNKNOWN";
      }
      case "member":
        return fieldType(expression(e.target, env), e.name, env, e);
      case "deref": {
        const t = expression(e.target, env),
          d = model.types.get(t);
        if (!d?.definition?.startsWith("^")) {
          if (t !== "UNKNOWN")
            add("POINTER_TYPE", "需要指针 / Pointer required", e);
          return "UNKNOWN";
        }
        return canonical(d.definition.slice(1));
      }
      case "unary": {
        const t = expression(e.right, env, false, e.op === "^");
        if (e.op === "^") {
          if (!p.advanced)
            add("DIALECT_FEATURE", "指针仅 A2 可用 / A2 pointer feature", e);
          return "^" + t;
        }
        if (e.op === "NOT") {
          if (!["BOOLEAN", "UNKNOWN"].includes(t))
            add(
              "TYPE_MISMATCH",
              "NOT 需要 BOOLEAN / Boolean operand required",
              e,
            );
          return "BOOLEAN";
        }
        if (!["INTEGER", "REAL", "NUMBER", "UNKNOWN"].includes(t))
          add(
            "TYPE_MISMATCH",
            "数值运算需要数字 / Numeric operand required",
            e,
          );
        return t;
      }
      case "binary": {
        const a = expression(e.left, env),
          b = expression(e.right, env);
        if (["AND", "OR"].includes(e.op)) {
          if (
            !["BOOLEAN", "UNKNOWN"].includes(a) ||
            !["BOOLEAN", "UNKNOWN"].includes(b)
          )
            add(
              "TYPE_MISMATCH",
              "逻辑操作需要 BOOLEAN / Boolean operands required",
              e,
            );
          return "BOOLEAN";
        }
        if (["=", "<>", "<", ">", "<=", ">="].includes(e.op)) {
          if (
            a.startsWith("ARRAY") ||
            b.startsWith("ARRAY") ||
            model.types.get(a)?.body ||
            model.types.get(b)?.body
          )
            add(
              "COMPARE",
              "记录、对象和数组不能比较 / Composite values cannot be compared",
              e,
            );
          else if (!compatible(a, b) && !compatible(b, a))
            add("TYPE_MISMATCH", "比较类型不兼容 / Incompatible comparison", e);
          return "BOOLEAN";
        }
        if (e.op === "&") {
          if (
            !["CHAR", "STRING", "UNKNOWN"].includes(a) ||
            !["CHAR", "STRING", "UNKNOWN"].includes(b)
          )
            add(
              "TYPE_MISMATCH",
              "拼接需要字符串或字符 / String operands required",
              e,
            );
          return "STRING";
        }
        if (e.op === "^" && !p.whileDo)
          add("DIALECT_OPERATOR", "9618 中 ^ 用于指针 / Power unavailable", e);
        if (
          model.types.get(a)?.definition?.startsWith("SET OF ") &&
          a === b &&
          ["+", "-", "*"].includes(e.op)
        )
          return a;
        if (model.types.get(a)?.definition?.startsWith("(")) {
          if (a === b && e.op === "-") return "INTEGER";
          if (b === "INTEGER" && ["+", "-"].includes(e.op)) return a;
        }
        if (
          !["INTEGER", "REAL", "NUMBER", "UNKNOWN"].includes(a) ||
          !["INTEGER", "REAL", "NUMBER", "UNKNOWN"].includes(b)
        )
          add(
            "TYPE_MISMATCH",
            "算术运算需要数字 / Numeric operands required",
            e,
          );
        if (
          ["DIV", "MOD"].includes(e.op) &&
          (!["INTEGER", "UNKNOWN"].includes(a) ||
            !["INTEGER", "UNKNOWN"].includes(b))
        )
          add(
            "TYPE_MISMATCH",
            "DIV/MOD 需要 INTEGER / Integer operands required",
            e,
          );
        return model.type(e, env);
      }
      case "new": {
        if (!p.advanced)
          add("DIALECT_FEATURE", "类仅 A2 可用 / Classes require A2", e);
        const type = canonical(e.name),
          cls = model.types.get(type);
        if (!cls || cls.kind !== "class") {
          add("CLASS", "未知类 / Unknown class " + e.name, e);
          return "UNKNOWN";
        }
        const ctor = model.method(type, "NEW");
        if (ctor?.access === "PRIVATE" && ctor.owner !== env.owner)
          add("PRIVATE", "不能调用 PRIVATE 构造函数 / Private constructor", e);
        validateCall(ctor, e.args, env, e, true);
        return type;
      }
      case "call": {
        let fn: Node | undefined,
          name = "";
        if (e.target.kind === "name") {
          name = canonical(e.target.name);
          fn =
            (env.owner ? model.method(env.owner, name) : undefined) ||
            model.modules.get(name);
        } else if (e.target.kind === "member") {
          const owner = expression(e.target.target, env);
          name = canonical(e.target.name);
          fn = model.method(owner, name);
          if (fn?.access === "PRIVATE" && fn.owner !== env.owner)
            add("PRIVATE", "不能调用 PRIVATE 方法 / Private method", e);
        } else {
          add("CALL", "无效调用目标 / Invalid call target", e);
          return "UNKNOWN";
        }
        if (fn) {
          if ((fn.kind === "procedure") !== asProcedure)
            add(
              "CALL_KIND",
              "函数作为表达式，过程使用 CALL / Function-expression / CALL-procedure required",
              e,
            );
          validateCall(fn, e.args, env, e, false);
          return fn.type ? canonical(fn.type) : "VOID";
        }
        const builtin = builtinSignature(name, p);
        if (!builtin) {
          add("CALL", "未知或本方言不可用的子程序 / Unknown module " + name, e);
          e.args.forEach((a) => expression(a, env));
          return "UNKNOWN";
        }
        if (asProcedure)
          add(
            "CALL_FUNCTION",
            "函数不能使用 CALL / CALL requires procedure",
            e,
          );
        if (e.args.length !== builtin.parameters.length) {
          add(
            "ARITY",
            "内置函数参数数量错误 / Builtin argument count mismatch",
            e,
          );
          ds.at(-1)!.source = builtin.source;
        }
        for (let i = 0; i < e.args.length; i++) {
          const t = expression(e.args[i], env),
            required = builtin.parameters[i]?.type;
          if (required && !required.split("|").some((a) => compatible(a, t))) {
            add(
              "TYPE_MISMATCH",
              `${name} 第 ${i + 1} 个参数应为 ${required} / Invalid argument type`,
              e.args[i],
            );
            ds.at(-1)!.source = builtin.source;
          }
        }
        if (builtin.returns === "SAME")
          return e.args[0] ? model.type(e.args[0], env) : "UNKNOWN";
        return model.type(e, env);
      }
    }
  }
  function validateCall(
    fn: Node | undefined,
    args: Expr[],
    env: Environment,
    at: Expr,
    isNew: boolean,
  ) {
    if (!fn) {
      if (args.length)
        add("ARITY", "无参构造函数 / No constructor arguments", at);
      return;
    }
    if (args.length !== fn.params.length)
      add("ARITY", "实参数量不匹配 / Argument count mismatch", at);
    args.forEach((arg, i) => {
      const p = fn.params[i];
      const t = expression(arg, env, false, p?.mode === "BYREF");
      if (!p) return;
      const expected = canonical(p.type);
      if (p.mode === "BYREF") {
        if (
          t !== expected &&
          t !== "UNKNOWN" &&
          !(
            t.startsWith("ARRAY") &&
            expected.startsWith("ARRAY") &&
            model.assignable(expected, t)
          )
        )
          add("TYPE_MISMATCH", "BYREF 类型必须相同 / BYREF type mismatch", arg);
      } else if (!compatible(expected, t))
        add("TYPE_MISMATCH", "参数类型不匹配 / Argument type mismatch", arg);
    });
  }
  function returns(nodes: Node[]): boolean {
    return nodes.some(
      (n) =>
        n.kind === "return" ||
        (n.kind === "repeat" && returns(n.body)) ||
        (n.kind === "if" && returns(n.body) && returns(n.other)) ||
        (n.kind === "case" &&
          n.branches.some((b: any) => b.otherwise) &&
          n.branches.every((b: any) => returns(b.body))),
    );
  }
  const validateDeclarations = (
    nodes: Node[],
    env: Environment,
    local = new Set<string>(
      (env.module?.params || []).map((p: any) => canonical(p.name)),
    ),
    allowDefinitions = false,
  ) => {
    for (const n of nodes) {
      if (
        !allowDefinitions &&
        ["class", "type", "function", "procedure"].includes(n.kind)
      )
        add(
          "MODULE_POSITION",
          "定义不能嵌套在语句或子程序内 / Nested definitions are not supported",
          n,
        );
      if (n.kind === "declare")
        for (const name of n.names) {
          identifier(name, n);
          const k = canonical(name);
          if (local.has(k)) add("DUPLICATE", "重复声明 / Duplicate " + name, n);
          local.add(k);
          knownType(n.type, n, [], env);
        }
      if (
        n.kind === "assign" &&
        n.target.kind === "name" &&
        n.value.kind === "new"
      )
        local.add(canonical(n.target.name));
      if (n.kind === "constant" || (n.kind === "define" && n.type)) {
        identifier(n.name, n);
        if (local.has(canonical(n.name)))
          add("DUPLICATE", "重复声明 / Duplicate " + n.name, n);
        local.add(canonical(n.name));
        if (n.type) knownType(n.type, n);
      }
      if (!["class", "type", "function", "procedure"].includes(n.kind)) {
        if (n.body) validateDeclarations(n.body, env, local);
        if (n.other) validateDeclarations(n.other, env, local);
        for (const b of n.branches || [])
          validateDeclarations(b.body, env, local);
      }
    }
  };
  function walk(nodes: Node[], env: Environment) {
    for (const n of nodes) {
      switch (n.kind) {
        case "declare":
          break;
        case "constant":
          expression(n.value, env);
          break;
        case "assign": {
          if (
            n.target.kind === "name" &&
            !env.symbols.has(canonical(n.target.name))
          )
            suggestedTypes.set(
              (env.module?.name || env.owner || "main") +
                ":" +
                canonical(n.target.name),
              model.type(n.value, env) === "UNKNOWN"
                ? "INTEGER"
                : model.type(n.value, env),
            );
          const target = expression(n.target, env, false, true),
            value = expression(n.value, env);
          if (
            target === "CHAR" &&
            n.value.kind === "literal" &&
            n.value.type === "STRING" &&
            [...n.value.value].length !== 1
          )
            add(
              "TYPE_MISMATCH",
              "CHAR 只能容纳一个字符 / CHAR requires one character",
              n.value,
            );
          if (
            p.strictness !== "exam" &&
            n.target.kind === "name" &&
            target === "UNKNOWN"
          )
            env.symbols.set(canonical(n.target.name), { type: value });
          if (!compatible(target, value))
            add(
              target.startsWith("ARRAY") && value.startsWith("ARRAY")
                ? "ARRAY_SHAPE"
                : "TYPE_MISMATCH",
              `不能将 ${value} 赋给 ${target} / Incompatible assignment`,
              n,
            );
          break;
        }
        case "input":
          expression(n.target, env, false, true);
          break;
        case "output":
          n.values.forEach((e: Expr) => expression(e, env));
          break;
        case "call":
          if (
            n.value.target.kind === "name" &&
            model.modules.get(canonical(n.value.target.name))?.kind ===
              "function"
          )
            add(
              "CALL_FUNCTION",
              "函数不能使用 CALL / CALL requires procedure",
              n,
            );
          expression(n.value, env, true);
          break;
        case "return":
          if (env.module?.kind !== "function")
            add("RETURN", "RETURN 只能位于函数 / RETURN requires function", n);
          {
            const t = expression(n.value, env);
            if (env.module?.type && !compatible(canonical(env.module.type), t))
              add(
                "TYPE_MISMATCH",
                "返回值类型不匹配 / Return type mismatch",
                n,
              );
          }
          break;
        case "if":
        case "while":
        case "repeat": {
          const t = expression(n.cond, env);
          if (!["BOOLEAN", "UNKNOWN"].includes(t))
            add(
              "CONDITION_TYPE",
              "条件必须为 BOOLEAN / Boolean condition required",
              n.cond,
            );
          walk(n.body, env);
          if (n.other) walk(n.other, env);
          break;
        }
        case "for": {
          if (env.symbols.get(canonical(n.name))?.constant)
            add(
              "CONSTANT",
              "FOR 不能修改常量 / Loop variable cannot be constant",
              n,
            );
          if (env.symbols.get(canonical(n.name))?.type !== "INTEGER")
            add(
              "FOR_TYPE",
              "FOR 变量必须为 INTEGER / Integer loop variable required",
              n,
            );
          for (const e of [n.from, n.to, n.step])
            if (!["INTEGER", "UNKNOWN"].includes(expression(e, env)))
              add(
                "FOR_TYPE",
                "FOR 边界与 STEP 必须为 INTEGER / Integer bounds required",
                e,
              );
          if (n.step.kind === "literal" && n.step.value === 0)
            add("FOR_STEP", "STEP 不能为 0 / STEP cannot be zero", n.step);
          walk(n.body, env);
          break;
        }
        case "case": {
          const type = expression(n.value, env),
            ranges: { lo: any; hi: any }[] = [];
          for (const b of n.branches) {
            for (const r of b.ranges) {
              if (r.length > 2)
                add(
                  "CASE_RANGE",
                  "CASE 范围需要一个或两个端点 / CASE ranges require one or two endpoints",
                  b.line,
                );
              for (const e of r) {
                const t = expression(e, env);
                if (!compatible(type, t) && !compatible(t, type))
                  add(
                    "TYPE_MISMATCH",
                    "CASE 分支类型不匹配 / CASE branch type mismatch",
                    e,
                  );
              }
              if (r.every((e: Expr) => e.kind === "literal")) {
                const lo = r[0].value,
                  hi = r.at(-1).value;
                if (lo > hi)
                  add(
                    "CASE_RANGE",
                    "CASE 范围上界小于下界 / CASE range bounds are reversed",
                    b.line,
                  );
                if (ranges.some((x) => lo <= x.hi && hi >= x.lo))
                  add(
                    "CASE_OVERLAP",
                    "CASE 分支重复或重叠 / CASE branches overlap",
                    b.line,
                    "warning",
                  );
                ranges.push({ lo, hi });
              }
            }
            walk(b.body, env);
          }
          break;
        }
        case "define": {
          const t = env.symbols.get(canonical(n.name))?.type || "UNKNOWN",
            def = model.types.get(t)?.definition;
          if (!def?.startsWith("SET OF "))
            add("SET", "DEFINE 需要集合类型 / Set type required", n);
          for (const e of n.values) {
            const actual = expression(e, env);
            if (def && !compatible(canonical(def.slice(7)), actual))
              add(
                "TYPE_MISMATCH",
                "集合元素类型不匹配 / Set element type mismatch",
                e,
              );
          }
          break;
        }
        case "open":
        case "close":
        case "readfile":
        case "writefile":
        case "seek":
        case "getrecord":
        case "putrecord": {
          const t = expression(n.file, env);
          if (!["STRING", "CHAR", "UNKNOWN"].includes(t))
            add(
              "TYPE_MISMATCH",
              "文件名必须为 STRING / String filename required",
              n.file,
            );
          if (n.value) {
            const vt = expression(
              n.value,
              env,
              false,
              ["readfile", "getrecord"].includes(n.kind),
            );
            if (n.kind === "seek" && !["INTEGER", "UNKNOWN"].includes(vt))
              add(
                "TYPE_MISMATCH",
                "SEEK 需要 INTEGER 位置 / Integer file position required",
                n.value,
              );
          }
          break;
        }
      }
    }
  }
  let badInheritance = false;
  for (const t of model.types.values())
    if (t.kind === "class") {
      try {
        model.ancestors(t.name);
      } catch {
        add("TYPE_CYCLE", "继承循环 / Inheritance cycle", t);
        badInheritance = true;
      }
    }
  if (badInheritance) return program;
  const names = new Set<string>();
  let hasMain = false;
  for (const n of program.body) {
    if (["type", "class", "procedure", "function"].includes(n.kind)) {
      identifier(n.name, n);
      const name = canonical(n.name);
      if (names.has(name))
        add("DUPLICATE", "重复定义 / Duplicate definition " + name, n);
      names.add(name);
      if (p.whileDo && hasMain && ["function", "procedure"].includes(n.kind))
        add(
          "MODULE_POSITION",
          "0478/2210 子程序须定义在主程序之前 / Define modules before main code",
          n,
        );
    } else hasMain = true;
  }
  const enumValues = new Set<string>();
  for (const t of model.types.values()) {
    knownType(t.name, t);
    if (t.kind === "type" && !t.definition) {
      const fields = new Set<string>();
      for (const f of t.body || [])
        if (f.kind === "declare")
          for (const name of f.names) {
            identifier(name, f);
            if (fields.has(canonical(name)))
              add(
                "DUPLICATE",
                "重复记录字段 / Duplicate record field " + name,
                f,
              );
            fields.add(canonical(name));
          }
    }
    if (t.definition?.startsWith("(")) {
      const values = new Set<string>();
      for (const name of t.definition.slice(1, -1).split(",")) {
        identifier(name.trim(), t);
        const key = canonical(name);
        if (
          values.has(key) ||
          enumValues.has(key) ||
          names.has(key) ||
          model.global.symbols.has(key)
        )
          add(
            "DUPLICATE",
            "重复或冲突的枚举成员 / Duplicate or conflicting enum member " +
              name.trim(),
            t,
          );
        values.add(key);
        enumValues.add(key);
      }
    }
    if (t.kind === "class") {
      if (t.base && model.types.get(canonical(t.base))?.kind !== "class")
        add(
          "CLASS",
          "父类必须是已声明的 CLASS / Superclass must be a declared class",
          t,
        );
      let fields: ReturnType<Model["fields"]> = [];
      try {
        fields = model.fields(t.name);
      } catch {
        continue;
      }
      const keys = new Set<string>();
      for (const f of fields) {
        identifier(f.name, f.node);
        const key = f.access === "PRIVATE" ? f.owner + "." + f.name : f.name;
        if (keys.has(key))
          add("DUPLICATE", "重复字段 / Duplicate field " + f.name, f.node);
        keys.add(key);
      }
      const methods = new Set<string>();
      for (const m of t.body) {
        if (["procedure", "function"].includes(m.kind)) {
          identifier(m.name, m, true);
          if (methods.has(canonical(m.name)))
            add("DUPLICATE", "重复方法 / Duplicate method", m);
          methods.add(canonical(m.name));
          if (canonical(m.name) === "NEW" && m.kind !== "procedure")
            add(
              "CONSTRUCTOR",
              "NEW 必须是过程 / Constructor must be a procedure",
              m,
            );
          const inherited = t.base && model.method(t.base, m.name);
          if (
            inherited &&
            inherited.access !== "PRIVATE" &&
            canonical(m.name) !== "NEW" &&
            (inherited.kind !== m.kind ||
              canonical(inherited.type || "") !== canonical(m.type || "") ||
              JSON.stringify(
                inherited.params.map((p: any) => [canonical(p.type), p.mode]),
              ) !==
                JSON.stringify(
                  m.params.map((p: any) => [canonical(p.type), p.mode]),
                ) ||
              m.access === "PRIVATE")
          )
            add(
              "OVERRIDE",
              "重写方法签名或访问权限不兼容 / Incompatible override",
              m,
            );
        } else if (!["declare", "assign"].includes(m.kind))
          add(
            "CLASS_INITIALIZER",
            "类中只允许属性、方法和属性初始化 / Invalid class member",
            m,
          );
      }
      const initEnv = model.environment(undefined, canonical(t.name));
      walk(
        t.body.filter((n: Node) => n.kind === "assign"),
        initEnv,
      );
    }
  }
  const modules = [
    ...model.modules.values(),
    ...[...model.types.values()]
      .filter((t) => t.kind === "class")
      .flatMap((t) =>
        t.body.filter((n: Node) => ["procedure", "function"].includes(n.kind)),
      ),
  ];
  for (const n of modules) {
    const env = model.environment(n, n.owner);
    const params = new Set<string>();
    for (const p of n.params) {
      identifier(p.name, n);
      if (params.has(canonical(p.name)))
        add("DUPLICATE", "重复参数 / Duplicate parameter", n);
      params.add(canonical(p.name));
      knownType(p.type, n, [], env);
    }
    if (n.type) knownType(n.type, n);
    if (n.kind === "function" && !returns(n.body))
      add("MISSING_RETURN", "并非所有执行路径都返回 / Not all paths return", n);
    validateDeclarations(n.body, env);
    walk(n.body, env);
  }
  validateDeclarations(program.body, model.global, new Set(), true);
  walk(program.body, model.global);
  if (p.styleChecks) {
    const formatted = format(source, p.id).split("\n");
    let offset = 0;
    source.split("\n").forEach((row, index) => {
      const rowStart = offset;
      offset += row.length + 1;
      if (
        row.trim() &&
        row.match(/^\s*/)?.[0] !== formatted[index]?.match(/^\s*/)?.[0]
      ) {
        const from = rowStart,
          end = from + (row.match(/^\s*/)?.[0].length || 0);
        add(
          "STYLE_INDENT",
          "缩进不符合当前方言 / Nonstandard indentation",
          index + 1,
          "warning",
          [
            {
              name: "修复缩进 / Fix indentation",
              edits: [
                {
                  from,
                  to: end,
                  insert: formatted[index]?.match(/^\s*/)?.[0] || "",
                },
              ],
            },
          ],
        );
      }
    });
  }
  return program;
}
