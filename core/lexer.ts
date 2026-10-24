import { DiagnosticError } from "./dialects";
export interface Token {
  kind: "name" | "number" | "string" | "char" | "date" | "symbol" | "eof";
  text: string;
  line: number;
  column: number;
  from?: number;
  to?: number;
  endLine?: number;
  endColumn?: number;
}
export const keywords = new Set(
  "DECLARE CONSTANT ARRAY OF INTEGER REAL STRING CHAR BOOLEAN DATE IF THEN ELSE ENDIF CASE OTHERWISE ENDCASE FOR TO STEP NEXT WHILE DO ENDWHILE REPEAT UNTIL PROCEDURE ENDPROCEDURE FUNCTION ENDFUNCTION RETURNS RETURN CALL BYREF BYVAL INPUT OUTPUT TRUE FALSE AND OR NOT DIV MOD TYPE ENDTYPE SET DEFINE CLASS ENDCLASS INHERITS PUBLIC PRIVATE NEW SUPER OPENFILE CLOSEFILE READFILE WRITEFILE READ WRITE APPEND RANDOM SEEK GETRECORD PUTRECORD".split(
    " ",
  ),
);
export function normalizeWithMap(raw: string) {
  let text = "",
    quote = "",
    delimiter = "",
    comment = false;
  const offsets: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    let out = c;
    if (c === "\r") {
      out = "\n";
      if (raw[i + 1] === "\n") {
        offsets.push(i);
        text += out;
        i++;
        comment = false;
        continue;
      }
    }
    if (c === "\n") comment = false;
    if (!quote && !comment && c === "/" && raw[i + 1] === "/") comment = true;
    if (!comment) {
      if (quote) {
        if (c === "\\" && raw[i + 1]) {
          offsets.push(i);
          text += c;
          offsets.push(i + 1);
          text += raw[++i];
          continue;
        }
        if (
          c === delimiter ||
          c === quote ||
          (quote === '"' && delimiter !== '"' && ["“", "”"].includes(c)) ||
          (quote === "'" && delimiter !== "'" && ["ꞌ", "‘", "’"].includes(c))
        ) {
          out = quote;
          quote = "";
          delimiter = "";
        }
      } else if (['"', "'", "“", "”", "ꞌ", "‘", "’"].includes(c)) {
        quote = ['"', "“", "”"].includes(c) ? '"' : "'";
        delimiter = c;
        out = quote;
      } else if (c === "<" && raw[i + 1] === "-") {
        out = "←";
        offsets.push(i);
        text += out;
        i++;
        continue;
      } else if (["–", "−"].includes(c)) out = "-";
    }
    offsets.push(i);
    text += out;
  }
  offsets.push(raw.length);
  return { text, offsets };
}
export function normalize(s: string) {
  return normalizeWithMap(s).text;
}
export function lex(
  raw: string,
  lineOffset = 0,
  columnOffset = 0,
  offset = 0,
): Token[] {
  const s = normalize(raw);
  const out: Token[] = [];
  let i = 0,
    line = 1 + lineOffset,
    col = 1 + columnOffset;
  function push(kind: Token["kind"], text: string, n: number) {
    out.push({
      kind,
      text,
      line,
      column: col,
      from: offset + i,
      to: offset + i + n,
      endLine: line,
      endColumn: col + n,
    });
    i += n;
    col += n;
  }
  while (i < s.length) {
    let c = s[i];
    if (c === "\n") {
      i++;
      line++;
      col = 1;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      col++;
      continue;
    }
    if (s.slice(i, i + 2) === "//") {
      while (i < s.length && s[i] !== "\n") {
        i++;
        col++;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1,
        v = "";
      while (j < s.length && s[j] !== c && s[j] !== "\n") {
        if (s[j] === "\\" && s[j + 1] === c) {
          v += c;
          j += 2;
        } else v += s[j++];
      }
      if (s[j] !== c)
        throw new DiagnosticError(
          "LEX_STRING",
          "字符串未闭合 / Unterminated string",
          line,
          col,
        );
      if (c === "'" && [...v].length !== 1)
        throw new DiagnosticError(
          "LEX_CHAR",
          "CHAR 必须恰好一个字符 / CHAR needs one character",
          line,
          col,
        );
      push(c === '"' ? "string" : "char", v, j - i + 1);
      continue;
    }
    if (c === "." && /\d/.test(s[i + 1] || ""))
      throw new DiagnosticError(
        "LEX_REAL",
        "小数需要前导零 / Leading zero required",
        line,
        col,
      );
    let m = s.slice(i).match(/^\d{2}\/\d{2}\/\d{4}(?!\d)/);
    if (m) {
      push("date", m[0], m[0].length);
      continue;
    }
    m = s.slice(i).match(/^\d+(?:\.\d+)?/);
    if (m) {
      if (s[i + m[0].length] === "." && s[i + m[0].length + 1] !== ".")
        throw new DiagnosticError(
          "LEX_REAL",
          "小数点两侧必须有数字 / Digits required on both sides",
          line,
          col,
        );
      push("number", m[0], m[0].length);
      continue;
    }
    m = s.slice(i).match(/^[A-Za-z][A-Za-z0-9_]*/);
    if (m) {
      push("name", m[0], m[0].length);
      continue;
    }
    m = s.slice(i).match(/^(?:<=|>=|<>|←|[+\-*/^&=<>()[\],:.])/);
    if (m) {
      push("symbol", m[0], m[0].length);
      continue;
    }
    throw new DiagnosticError(
      "LEX_CHAR",
      `无法识别字符 / Unexpected character ${c}`,
      line,
      col,
    );
  }
  out.push({
    kind: "eof",
    text: "",
    line,
    column: col,
    from: offset + i,
    to: offset + i,
    endLine: line,
    endColumn: col,
  });
  return out;
}
export type Expr = (
  | { kind: "literal"; value: any; type: string; token: Token }
  | { kind: "name"; name: string; token: Token }
  | { kind: "unary"; op: string; right: Expr; token: Token }
  | { kind: "binary"; op: string; left: Expr; right: Expr; token: Token }
  | { kind: "call"; target: Expr; args: Expr[]; token: Token }
  | { kind: "index"; target: Expr; args: Expr[]; token: Token }
  | { kind: "member"; target: Expr; name: string; token: Token }
  | { kind: "deref"; target: Expr; token: Token }
  | { kind: "new"; name: string; args: Expr[]; token: Token }
) & {
  from?: number;
  to?: number;
  endLine?: number;
  endColumn?: number;
  nameToken?: Token;
  endToken?: Token;
};
const prec: Record<string, number> = {
  OR: 1,
  AND: 2,
  "=": 3,
  "<>": 3,
  "<": 3,
  ">": 3,
  "<=": 3,
  ">=": 3,
  "&": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  DIV: 6,
  MOD: 6,
  "^": 7,
};
export class ExpressionParser {
  i = 0;
  depth = 0;
  nodes = 0;
  constructor(
    public tokens: Token[],
    public pointerMode = false,
    public logicalPrecedence: "standard" | "leftToRight" = "standard",
  ) {}
  peek() {
    return this.tokens[Math.min(this.i, this.tokens.length - 1)];
  }
  take() {
    return this.tokens[Math.min(this.i++, this.tokens.length - 1)];
  }
  match(s: string) {
    if (this.peek().text.toUpperCase() === s) {
      this.i++;
      return true;
    }
    return false;
  }
  need(s: string) {
    if (!this.match(s)) this.fail(`需要 / Expected ${s}`);
  }
  fail(s: string): never {
    const t = this.peek();
    throw new DiagnosticError("PARSE_EXPR", s, t.line, t.column);
  }
  list(end: string) {
    const a: Expr[] = [];
    if (!this.match(end)) {
      do {
        a.push(this.expr());
      } while (this.match(","));
      this.need(end);
    }
    return a;
  }
  expr(min = 0): Expr {
    if (++this.depth > 128) {
      this.depth--;
      this.fail("表达式嵌套层数超限 / Expression nesting limit");
    }
    try {
      const t = this.take();
      let e: Expr;
      if (t.kind === "number")
        e = {
          kind: "literal",
          value: Number(t.text),
          type: t.text.includes(".") ? "REAL" : "INTEGER",
          token: t,
        };
      else if (t.kind === "string" || t.kind === "char" || t.kind === "date")
        e = {
          kind: "literal",
          value: t.text,
          type: t.kind.toUpperCase(),
          token: t,
        };
      else if (["TRUE", "FALSE"].includes(t.text.toUpperCase()))
        e = {
          kind: "literal",
          value: t.text.toUpperCase() === "TRUE",
          type: "BOOLEAN",
          token: t,
        };
      else if (t.text === "(") {
        e = this.expr();
        this.need(")");
      } else if (["-", "+", "NOT", "^"].includes(t.text.toUpperCase()))
        e = {
          kind: "unary",
          op: t.text.toUpperCase(),
          right: this.expr(t.text.toUpperCase() === "NOT" ? 3 : 7),
          token: t,
        };
      else if (t.text.toUpperCase() === "NEW") {
        const n = this.take();
        this.need("(");
        e = {
          kind: "new",
          name: n.text,
          args: this.list(")"),
          token: t,
          endToken: this.tokens[this.i - 1],
        };
      } else if (t.kind === "name")
        e = { kind: "name", name: t.text, token: t };
      else this.fail("需要表达式 / Expected expression");
      while (true) {
        const p = this.peek();
        if (p.text === "(") {
          this.take();
          e = {
            kind: "call",
            target: e,
            args: this.list(")"),
            token: p,
            endToken: this.tokens[this.i - 1],
          };
          continue;
        }
        if (p.text === "[") {
          this.take();
          e = {
            kind: "index",
            target: e,
            args: this.list("]"),
            token: p,
            endToken: this.tokens[this.i - 1],
          };
          continue;
        }
        if (p.text === ".") {
          this.take();
          const nameToken = this.take();
          if (nameToken.kind !== "name")
            this.fail("需要成员名称 / Member name required");
          e = {
            kind: "member",
            target: e,
            name: nameToken.text,
            token: p,
            nameToken,
            endToken: nameToken,
          };
          continue;
        }
        if (p.text === "^" && this.pointerMode) {
          this.take();
          e = { kind: "deref", target: e, token: p };
          continue;
        }
        if (++this.nodes > 512)
          this.fail("单个表达式过长 / Expression complexity limit");
        const op = p.text.toUpperCase(),
          v =
            this.logicalPrecedence === "leftToRight" && op === "OR"
              ? 2
              : prec[op];
        if (!v || v < min) break;
        this.take();
        e = {
          kind: "binary",
          op,
          left: e,
          right: this.expr(v + (op === "^" ? 0 : 1)),
          token: p,
        };
      }
      return e;
    } finally {
      this.depth--;
    }
  }
}
export function expression(
  s: string,
  line = 1,
  column = 1,
  offset = 0,
  pointerMode = false,
  logicalPrecedence: "standard" | "leftToRight" = "standard",
): Expr {
  const p = new ExpressionParser(
    lex(s, line - 1, column - 1, offset),
    pointerMode,
    logicalPrecedence,
  );
  const e = p.expr();
  if (p.peek().kind !== "eof") p.fail(`多余内容 / Unexpected ${p.peek().text}`);
  function spans(x: Expr): void {
    const children: Expr[] =
      x.kind === "binary"
        ? [x.left, x.right]
        : x.kind === "unary"
          ? [x.right]
          : ["call", "index"].includes(x.kind)
            ? [(x as any).target, ...(x as any).args]
            : ["member", "deref"].includes(x.kind)
              ? [(x as any).target]
              : x.kind === "new"
                ? x.args
                : [];
    children.forEach(spans);
    x.from = Math.min(
      x.token.from ?? offset,
      ...children.map((c) => c.from ?? offset),
    );
    x.to = Math.max(
      x.endToken?.to ?? x.token.to ?? offset,
      ...children.map((c) => c.to ?? offset),
    );
    x.endLine = x.token.line;
    x.endColumn = (x.to ?? 0) - (offset - column + 1) + 1;
  }
  spans(e);
  e.to = p.tokens[Math.max(0, p.i - 1)].to;
  e.endColumn = p.tokens[Math.max(0, p.i - 1)].endColumn;
  return e;
}
export function splitTop(s: string, separator = ","): string[] {
  const ts = lex(s);
  let depth = 0,
    last = 0;
  const a: string[] = [];
  for (const t of ts) {
    if (["(", "["].includes(t.text)) depth++;
    if ([")", "]"].includes(t.text)) depth--;
    if (t.text === separator && depth === 0) {
      a.push(s.slice(last, t.column - 1).trim());
      last = t.column;
    }
  }
  a.push(s.slice(last).trim());
  return a;
}
