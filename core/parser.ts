import {
  DiagnosticError,
  ruleSource,
  syntaxSource,
  type Diagnostic,
  type Profile,
} from "./dialects";
import {
  expression,
  lex,
  normalize,
  normalizeWithMap,
  splitTop,
  keywords,
  type Expr,
} from "./lexer";
export interface Node {
  kind: string;
  line: number;
  text: string;
  [key: string]: any;
}
export interface Program {
  body: Node[];
  diagnostics: Diagnostic[];
  source: string;
  rawSource?: string;
  continuationLines?: number[];
}
export function parse(raw: string, p: Profile): Program {
  const normalization = normalizeWithMap(raw);
  const source = normalization.text,
    lines = source.split("\n"),
    diagnostics: Diagnostic[] = [];
  const originalLines = source.split("\n"),
    lineOffsets: number[] = [];
  let lineOffset = 0;
  for (const line of originalLines) {
    lineOffsets.push(lineOffset);
    lineOffset += line.length + 1;
  }
  const expressionCursor = new Map<number, number>();
  const continuationEnd = new Map<number, number>();
  function commentBlank(row: string) {
    try {
      const tokens = lex(row);
      const end = tokens.at(-1)?.column || 1;
      let quote = "";
      for (let j = 0; j < row.length; j++) {
        const c = row[j];
        if (quote) {
          if (c === "\\") {
            j++;
            continue;
          }
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (row.slice(j, j + 2) === "//")
          return row.slice(0, j) + " ".repeat(row.length - j);
      }
      return row;
    } catch {
      return row;
    }
  }
  for (let start = 0; start < lines.length; start++) {
    let balance = 0,
      end = start;
    while (end < lines.length) {
      const row = commentBlank(originalLines[end]);
      try {
        for (const token of lex(row))
          if (token.kind === "symbol") {
            if (["(", "["].includes(token.text)) balance++;
            if ([")", "]"].includes(token.text)) balance--;
          }
      } catch {
        break;
      }
      const more = balance > 0 || /[,+\-*/&←]\s*$/.test(row);
      if (!more || end + 1 >= lines.length) break;
      end++;
    }
    if (end > start) {
      lines[start] = originalLines
        .slice(start, end + 1)
        .map(commentBlank)
        .join(" ");
      for (let j = start + 1; j <= end; j++) lines[j] = "";
      continuationEnd.set(start + 1, end + 1);
      start = end;
    }
  }
  let depth = 0;
  let i = 0;
  const diag = (e: DiagnosticError, severity: "error" | "warning" = "error") =>
    diagnostics.push({
      code: e.code,
      message: e.message,
      line: e.line,
      column: e.column,
      severity,
      source:
        e.code === "PARSE_STATEMENT" || e.code === "PARSE_EXPR"
          ? syntaxSource(originalLines[e.line - 1] || "", p)
          : ruleSource(e.code, p),
    });
  function err(message: string, line: number): never {
    throw new DiagnosticError("PARSE_STATEMENT", message, line);
  }
  function ex(s: string, line: number) {
    const row = lines[line - 1] || originalLines[line - 1] || "",
      start = expressionCursor.get(line) || 0;
    let index = row.indexOf(s, start);
    if (index < 0) index = row.indexOf(s);
    if (index < 0) index = 0;
    expressionCursor.set(line, index + s.length);
    try {
      return expression(
        s,
        line,
        index + 1,
        (lineOffsets[line - 1] || 0) + index,
        !p.whileDo,
        p.logicalPrecedence,
      );
    } catch (error) {
      if (error instanceof DiagnosticError) {
        const position = (lineOffsets[error.line - 1] || 0) + error.column - 1;
        let actual = error.line - 1;
        while (
          actual + 1 < lineOffsets.length &&
          lineOffsets[actual + 1] <= position
        )
          actual++;
        error.line = actual + 1;
        error.column = position - lineOffsets[actual] + 1;
      }
      throw error;
    }
  }
  function clean(s: string) {
    let quoted = "";
    for (let j = 0; j < s.length; j++) {
      if (quoted) {
        if (s[j] === "\\") {
          j++;
          continue;
        }
        if (s[j] === quoted) quoted = "";
      } else if (s[j] === '"' || s[j] === "'") quoted = s[j];
      else if (s.slice(j, j + 2) === "//") return s.slice(0, j).trim();
    }
    return s.trim();
  }
  function isCaseBranch(text: string) {
    if (/^OTHERWISE\b/i.test(text)) return true;
    try {
      return (
        lex(text).some((t) => t.kind === "symbol" && t.text === ":") &&
        !/^(DECLARE|PUBLIC|PRIVATE)\b/i.test(text)
      );
    } catch {
      return false;
    }
  }
  function block(stops: string[] = []): Node[] {
    if (depth >= 128) err("嵌套层数超限 / Block nesting limit", i + 1);
    depth++;
    try {
      const nodes: Node[] = [];
      while (i < lines.length) {
        let text = clean(lines[i]);
        const line = i + 1;
        let access: string | undefined;
        const am = text.match(/^(PUBLIC|PRIVATE)\s+(.+)$/i);
        if (am) {
          access = am[1].toUpperCase();
          text = am[2];
          if (!/^(PROCEDURE|FUNCTION|DECLARE)\b/i.test(text))
            text = "DECLARE " + text;
        }
        const u = text.toUpperCase();
        if (
          stops.some(
            (s) =>
              u === s ||
              u.startsWith(s + " ") ||
              (s === "@BRANCH" && isCaseBranch(text)),
          )
        )
          return nodes;
        if (
          stops.length &&
          /^(ENDIF|ENDWHILE|NEXT|UNTIL|ENDCASE|ENDPROCEDURE|ENDFUNCTION|ENDTYPE|ENDCLASS|ELSE)\b/i.test(
            text,
          )
        )
          return nodes;
        i++;
        if (!text) continue;
        try {
          let m: RegExpMatchArray | null,
            n: Node = { kind: "", line, text };
          if ((m = text.match(/^DECLARE\s+(.+?)\s*:\s*(.+)$/i))) {
            n = { ...n, kind: "declare", names: splitTop(m[1]), type: m[2] };
          } else if ((m = text.match(/^CONSTANT\s+(\w+)\s*(?:=|←)\s*(.+)$/i))) {
            if (p.whileDo && /^CONSTANT\s+\w+\s*=/i.test(text)) {
              const at =
                (lineOffsets[line - 1] || 0) +
                originalLines[line - 1].indexOf("=");
              diag(
                new DiagnosticError(
                  "DIALECT_CONSTANT",
                  "0478/2210 常量使用 ← / Constant declaration requires ←",
                  line,
                ),
                p.strictness === "exam" ? "error" : "warning",
              );
              const d = diagnostics.at(-1)!;
              d.actions = [
                {
                  name: "改为 ← / Use assignment arrow",
                  edits: [
                    {
                      from: normalization.offsets[at],
                      to: normalization.offsets[at + 1],
                      insert: "←",
                    },
                  ],
                },
              ];
            }
            const value = ex(m[2], line);
            if (
              value.kind !== "literal" &&
              !(
                value.kind === "unary" &&
                ["-", "+"].includes(value.op) &&
                value.right.kind === "literal"
              )
            )
              err("CONSTANT 只能是字面量 / Literal required", line);
            n = { ...n, kind: "constant", name: m[1], value };
          } else if ((m = text.match(/^IF\s+(.+?)(?:\s+THEN)?$/i))) {
            let cond = m[1];
            if (!/\sTHEN$/i.test(text)) {
              if (clean(lines[i] || "").toUpperCase() === "THEN") i++;
              else err("IF 缺少 THEN / Missing THEN", line);
            }
            n = {
              ...n,
              kind: "if",
              cond: ex(cond, line),
              body: block(["ELSE", "ENDIF"]),
              other: [],
            };
            if (clean(lines[i] || "").toUpperCase() === "ELSE") {
              i++;
              n.other = block(["ENDIF"]);
            }
            close("ENDIF", line);
          } else if ((m = text.match(/^WHILE\s+(.+?)(\s+DO)?$/i))) {
            if (p.whileDo && !m[2])
              err("此方言 WHILE 需要 DO / WHILE requires DO", line);
            if (!p.whileDo && m[2])
              err("9618 WHILE 不使用 DO / Remove DO", line);
            n = {
              ...n,
              kind: "while",
              cond: ex(m[1], line),
              body: block(["ENDWHILE"]),
            };
            close("ENDWHILE", line);
          } else if (u === "REPEAT") {
            n = { ...n, kind: "repeat", body: block(["UNTIL"]) };
            const end = clean(lines[i] || "").match(/^UNTIL\s+(.+)$/i);
            if (!end) err("缺少 UNTIL / Missing UNTIL", line);
            n.cond = ex(end[1], i + 1);
            i++;
          } else if (
            (m = text.match(
              /^FOR\s+(\w+)\s*←\s*(.+?)\s+TO\s+(.+?)(?:\s+STEP\s+(.+))?$/i,
            ))
          ) {
            n = {
              ...n,
              kind: "for",
              name: m[1],
              from: ex(m[2], line),
              to: ex(m[3], line),
              step: ex(m[4] || "1", line),
              body: block(["NEXT"]),
            };
            const end = clean(lines[i] || "").match(/^NEXT(?:\s+(\w+))?$/i);
            if (!end) err("缺少 NEXT / Missing NEXT", line);
            if (end[1] && end[1].toUpperCase() !== m[1].toUpperCase())
              err("NEXT 变量与 FOR 不匹配 / NEXT variable mismatch", i + 1);
            i++;
          } else if ((m = text.match(/^CASE\s+OF\s+(.+)$/i))) {
            n = { ...n, kind: "case", value: ex(m[1], line), branches: [] };
            while (
              i < lines.length &&
              clean(lines[i]).toUpperCase() !== "ENDCASE"
            ) {
              let header = clean(lines[i]);
              if (!header) {
                i++;
                continue;
              }
              const colon = lex(header).find(
                (t) => t.kind === "symbol" && t.text === ":",
              );
              let b: RegExpMatchArray | null = null;
              if (/^OTHERWISE\b/i.test(header)) {
                const rest = header.slice(9).trim();
                if (rest.startsWith(":"))
                  b = [
                    "",
                    "OTHERWISE",
                    rest.slice(1).trim(),
                  ] as RegExpMatchArray;
                else if (p.whileDo)
                  b = ["", "OTHERWISE", rest] as RegExpMatchArray;
              } else if (colon)
                b = [
                  "",
                  header.slice(0, colon.column - 1).trim(),
                  header.slice(colon.column).trim(),
                ] as RegExpMatchArray;
              if (!b) err("CASE 分支需要冒号 / Expected branch colon", i + 1);
              const bl = i + 1;
              i++;
              const otherwise = b[1].toUpperCase() === "OTHERWISE";
              const ranges = otherwise
                ? []
                : splitTop(b[1]).map((v) =>
                    v.split(/\s+TO\s+/i).map((x) => ex(x, bl)),
                  );
              const body: Node[] = [];
              if (b[2]) {
                expressionCursor.set(
                  bl,
                  colon ? colon.column : header.indexOf(b[2]),
                );
                const original = lines[i - 1];
                lines[i - 1] = b[2];
                i--;
                body.push(...block(["ENDCASE", "@BRANCH"]));
                lines[bl - 1] = original;
              } else body.push(...block(["ENDCASE", "@BRANCH"]));
              if (n.branches.some((x: any) => x.otherwise))
                err("OTHERWISE 必须在最后 / OTHERWISE must be last", bl);
              n.branches.push({ otherwise, ranges, body, line: bl });
            }
            close("ENDCASE", line);
          } else if (
            (m = text.match(
              /^(PROCEDURE|FUNCTION)\s+(\w+)(?:\s*\((.*)\))?(?:\s+RETURNS\s+(.+))?$/i,
            ))
          ) {
            const fn = m[1].toUpperCase() === "FUNCTION";
            if (!fn && !p.parens && m[3] !== undefined && !m[3].trim())
              err(
                "无参过程不使用括号 / Parameterless procedure has no parentheses",
                line,
              );
            if (p.parens && m[3] === undefined)
              err("9618 子程序需要括号 / Parentheses required", line);
            let mode = "BYVAL";
            const params = m[3]?.trim()
              ? splitTop(m[3]).map((v) => {
                  const pm = v.match(
                    /^(?:(BYREF|BYVAL)\s+)?(\w+)\s*:\s*(.+)$/i,
                  );
                  if (!pm) err("参数声明无效 / Invalid parameter", line);
                  if (pm[1]) mode = pm[1].toUpperCase();
                  if (pm[1] && !p.paramModes)
                    err(
                      "此方言没有 BYREF/BYVAL / Parameter mode unavailable",
                      line,
                    );
                  if (fn && mode === "BYREF")
                    err(
                      "函数不能使用 BYREF / Functions cannot use BYREF",
                      line,
                    );
                  return { mode, name: pm[2], type: pm[3] };
                })
              : [];
            if (params.length > p.maxParams)
              err("此方言最多 3 个参数 / At most three parameters", line);
            if (fn && !m[4])
              err("函数需要 RETURNS / Return type required", line);
            if (!fn && m[4])
              err(
                "过程不能声明 RETURNS / Procedures cannot have a return type",
                line,
              );
            n = {
              ...n,
              kind: fn ? "function" : "procedure",
              name: m[2],
              params,
              type: m[4],
              body: block([fn ? "ENDFUNCTION" : "ENDPROCEDURE"]),
            };
            close(fn ? "ENDFUNCTION" : "ENDPROCEDURE", line);
          } else if ((m = text.match(/^TYPE\s+(\w+)(?:\s*=\s*(.+))?$/i))) {
            n = { ...n, kind: "type", name: m[1], definition: m[2] };
            if (!m[2]) {
              n.body = block(["ENDTYPE"]);
              close("ENDTYPE", line);
            }
          } else if (
            (m = text.match(/^CLASS\s+(\w+)(?:\s+INHERITS\s+(\w+))?$/i))
          ) {
            n = {
              ...n,
              kind: "class",
              name: m[1],
              base: m[2],
              body: block(["ENDCLASS"]),
            };
            for (const member of n.body) member.owner = n.name.toUpperCase();
            close("ENDCLASS", line);
          } else if ((m = text.match(/^OUTPUT\s+(.+)$/i)))
            n = {
              ...n,
              kind: "output",
              values: splitTop(m[1]).map((v) => ex(v, line)),
            };
          else if ((m = text.match(/^INPUT\s+(.+)$/i)))
            n = { ...n, kind: "input", target: ex(m[1], line) };
          else if ((m = text.match(/^RETURN\s+(.+)$/i)))
            n = { ...n, kind: "return", value: ex(m[1], line) };
          else if ((m = text.match(/^CALL\s+(.+)$/i))) {
            let value = ex(m[1], line);
            if (value.kind === "name" && !p.parens)
              value = {
                kind: "call",
                target: value,
                args: [],
                token: value.token,
              };
            if (value.kind !== "call")
              err("CALL 需要过程调用 / Procedure call required", line);
            n = { ...n, kind: "call", value };
          } else if (
            (m = text.match(
              /^OPENFILE\s+(.+)\s+FOR\s+(READ|WRITE|APPEND|RANDOM)$/i,
            ))
          )
            n = {
              ...n,
              kind: "open",
              file: ex(m[1], line),
              mode: m[2].toUpperCase(),
            };
          else if ((m = text.match(/^CLOSEFILE\s+(.+)$/i)))
            n = { ...n, kind: "close", file: ex(m[1], line) };
          else if (
            (m = text.match(
              /^(READFILE|WRITEFILE|SEEK|GETRECORD|PUTRECORD)\s+(.+)$/i,
            ))
          ) {
            const a = splitTop(m[2]);
            if (a.length !== 2)
              err("文件操作需要两个参数 / Two operands required", line);
            n = {
              ...n,
              kind: m[1].toLowerCase(),
              file: ex(a[0], line),
              value: ex(a[1], line),
            };
          } else if (
            (m = text.match(/^DEFINE\s+(\w+)\s*\((.*?)\)(?:\s*:\s*(\w+))?$/i))
          )
            n = {
              ...n,
              kind: "define",
              name: m[1],
              type: m[3],
              values: splitTop(m[2])
                .filter(Boolean)
                .map((x) => ex(x, line)),
            };
          else {
            const ts = lex(text);
            const arrow = ts.find((t) => t.text === "←");
            if (!arrow) {
              const value = ex(text, line);
              if (value.kind !== "call" || value.target.kind !== "member")
                err(`无法识别语句 / Unknown statement: ${text}`, line);
              n = { ...n, kind: "call", value };
            } else
              n = {
                ...n,
                kind: "assign",
                target: ex(text.slice(0, arrow.column - 1), line),
                value: ex(text.slice(arrow.column), line),
              };
          }
          if (
            ["type", "class", "define"].includes(n.kind) &&
            p.id !== "9618-AS" &&
            !p.advanced
          )
            err("此方言不支持自定义类型 / Custom types unavailable", line);
          if (
            (n.kind === "class" ||
              n.kind === "define" ||
              (n.kind === "type" && n.definition)) &&
            !p.advanced
          )
            err("仅 A2 支持此特性 / A2 feature", line);
          if (n.kind === "open" && n.mode === "APPEND" && p.whileDo)
            err("0478/2210 仅使用 READ/WRITE / APPEND unavailable", line);
          if (
            ["seek", "getrecord", "putrecord"].includes(n.kind) &&
            !p.advanced
          )
            err("随机文件操作仅 A2 可用 / Random files require A2", line);
          if (n.kind === "open" && n.mode === "RANDOM" && !p.advanced)
            err("随机文件仅 A2 可用 / Random files require A2", line);
          if (access) n.access = access;
          n.headerEndLine = continuationEnd.get(line) || line;
          n.endLine = Math.max(i, continuationEnd.get(line) || i);
          const start =
            (lineOffsets[line - 1] || 0) +
            Math.max(0, originalLines[line - 1]?.search(/\S/) || 0);
          n.span = {
            from: start,
            to:
              n.endLine < lineOffsets.length
                ? lineOffsets[n.endLine] - 1
                : source.length,
            line,
            column: start - (lineOffsets[line - 1] || 0) + 1,
          };
          nodes.push(n);
        } catch (e) {
          if (e instanceof DiagnosticError) diag(e);
          else throw e;
        }
      }
      return nodes;
    } finally {
      depth--;
    }
  }
  function close(end: string, line: number) {
    if (clean(lines[i] || "").toUpperCase() !== end) {
      diag(
        new DiagnosticError(
          "PARSE_STATEMENT",
          `第 ${line} 行缺少 ${end} / Missing ${end}`,
          line,
        ),
      );
      return;
    }
    i++;
  }
  const body = block();
  if (source !== raw)
    diag(
      new DiagnosticError(
        "NORMALIZED",
        "已规范化 PDF 引号、减号或赋值箭头 / PDF punctuation normalized",
      ),
      "warning",
    );
  // Expose spans in the caller's original UTF-16 document, including <- and CRLF.
  const rawOffsets: number[] = [];
  let rawOffset = 0;
  for (const line of raw.split("\n")) {
    rawOffsets.push(rawOffset);
    rawOffset += line.length + 1;
  }
  const seen = new Set<any>();
  function remap(value: any) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (typeof value.from === "number") {
      value.from = normalization.offsets[value.from] ?? raw.length;
      if (typeof value.to === "number")
        value.to = normalization.offsets[value.to] ?? raw.length;
      let lo = 0,
        hi = rawOffsets.length;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >>> 1;
        if (rawOffsets[mid] <= value.from) lo = mid;
        else hi = mid;
      }
      if (value.line) {
        value.line = lo + 1;
        value.column = value.from - rawOffsets[lo] + 1;
      }
      if (value.token) value.column = value.from - rawOffsets[lo] + 1;
    }
    for (const child of Object.values(value))
      if (Array.isArray(child)) child.forEach(remap);
      else if (child && typeof child === "object") remap(child);
  }
  body.forEach(remap);
  for (let line = 0; line < originalLines.length; line++) {
    try {
      for (const token of lex(originalLines[line], line, 0, lineOffsets[line]))
        if (
          token.kind === "name" &&
          keywords.has(token.text.toUpperCase()) &&
          token.text !== token.text.toUpperCase()
        ) {
          const from = normalization.offsets[token.from!] ?? 0,
            to = normalization.offsets[token.to!] ?? from;
          diagnostics.push({
            code: "STYLE_CASE",
            message: "关键字应大写 / Uppercase keyword expected",
            line: line + 1,
            column: from - (rawOffsets[line] || 0) + 1,
            from,
            to,
            severity: "warning",
            source: ruleSource("STYLE_CASE", p),
            actions: [
              {
                name: "转为大写 / Uppercase keyword",
                edits: [{ from, to, insert: token.text.toUpperCase() }],
              },
            ],
          });
        }
    } catch {}
  }
  for (const d of diagnostics)
    if (d.message.includes("Missing ")) {
      const end = d.message.match(/Missing (\w+)/)?.[1];
      if (end) {
        const n = body.find((n) => n.line === d.line);
        const at = n?.span?.to ?? raw.length;
        d.actions = [
          {
            name: "补充 " + end + " / Insert terminator",
            edits: [{ from: at, to: at, insert: "\n" + end + "\n" }],
          },
        ];
      }
    }
  if (p.strictness === "lenient")
    for (let i = diagnostics.length - 1; i >= 0; i--)
      if (
        diagnostics[i].severity === "warning" &&
        ["STYLE_CASE", "NORMALIZED", "DIALECT_CONSTANT"].includes(
          diagnostics[i].code,
        )
      )
        diagnostics.splice(i, 1);
  const normalizedDiagnostic = diagnostics.find((d) => d.code === "NORMALIZED");
  if (normalizedDiagnostic)
    normalizedDiagnostic.actions = [
      {
        name: "规范化粘贴字符 / Normalize pasted code",
        edits: [{ from: 0, to: raw.length, insert: source }],
      },
    ];
  return {
    body,
    diagnostics,
    source,
    rawSource: raw,
    continuationLines: [...continuationEnd].flatMap(([start, end]) =>
      Array.from({ length: end - start }, (_, i) => start + i + 1),
    ),
  };
}
