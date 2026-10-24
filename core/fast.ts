import type { Node } from "./parser";
import type { Expr } from "./lexer";
// This optimizer only receives validated ASTs. User text is never interpolated as JS code.
// Unsupported constructs stay in the resumable interpreter. Debug mode never uses this path.
export interface FastContext {
  steps: number;
  limit: number;
  line: number;
  column?: number;
  fail: (code: string, message: string) => never;
  lookup: (
    name: string,
  ) => { type: string; value: any; constant?: boolean } | undefined;
}
export function optimizeLoop(node: Node, context: FastContext): boolean {
  const cells: { type: string; value: any; constant?: boolean }[] = [],
    names = new Map<string, number>();
  let count = 0;
  const index = (name: string) => {
    const key = name.toUpperCase();
    if (names.has(key)) return names.get(key)!;
    const cell = context.lookup(key);
    if (
      !cell ||
      !["INTEGER", "REAL", "STRING", "CHAR", "BOOLEAN"].includes(
        cell.type.toUpperCase(),
      )
    )
      throw new Error("unsupported");
    const alias = cells.indexOf(cell);
    if (alias >= 0) {
      names.set(key, alias);
      return alias;
    }
    const i = cells.length;
    cells.push(cell);
    names.set(key, i);
    return i;
  };
  const exp = (e: Expr): string => {
    const location = `${e.token.line},${e.token.column}`;
    switch (e.kind) {
      case "literal":
        if (e.type === "DATE") throw new Error("unsupported");
        return JSON.stringify(e.value);
      case "name":
        return `read(v${index(e.name)},${location})`;
      case "unary":
        if (e.op === "^") throw new Error("unsupported");
        return e.op === "NOT"
          ? `(!truth(${exp(e.right)}))`
          : `(${e.op}${exp(e.right)})`;
      case "binary": {
        const a = exp(e.left),
          b = exp(e.right);
        if (["AND", "OR"].includes(e.op))
          return `(truth(${a}) ${e.op === "AND" ? "&&" : "||"} truth(${b}))`;
        if (e.op === "&") return `(${a}+${b})`;
        if (e.op === "DIV" || e.op === "MOD" || e.op === "/")
          return `divide(${JSON.stringify(e.op)},${a},${b},${location})`;
        if (["+", "-", "*", "^"].includes(e.op))
          return `finite((${a}${e.op === "^" ? "**" : e.op}${b}),${location})`;
        return `(${a} ${{ "=": "===", "<>": "!==" }[e.op] || e.op} ${b})`;
      }
      default:
        throw new Error("unsupported");
    }
  };
  const write = (name: string, e: string) => {
    const i = index(name);
    if (cells[i].constant) throw new Error("unsupported");
    const type = cells[i].type.toUpperCase();
    return `v${i}=${e};${["INTEGER", "REAL"].includes(type) ? `if(!Number.${type === "INTEGER" ? "isInteger" : "isFinite"}(v${i}))fail('TYPE_MISMATCH','Invalid numeric result');` : type === "CHAR" ? `if([...v${i}].length!==1)fail('TYPE_MISMATCH','CHAR needs one character');` : ""}`;
  };
  const block = (nodes: Node[]): string =>
    nodes
      .map((n) => {
        const tick = `line=${n.line};column=${n.span?.column || 1};if(++steps>limit)fail('STEP_LIMIT','Instruction limit exceeded');`;
        switch (n.kind) {
          case "assign":
            if (n.target.kind !== "name") throw new Error("unsupported");
            return tick + write(n.target.name, exp(n.value));
          case "if":
            return (
              tick +
              `if(truth(${exp(n.cond)})){${block(n.body)}}else{${block(n.other)}}`
            );
          case "for": {
            const id = ++count,
              a = "a" + id,
              b = "b" + id,
              c = "c" + id;
            return (
              tick +
              `{let ${a}=${exp(n.from)},${b}=${exp(n.to)},${c}=${exp(n.step)};if(![${a},${b},${c}].every(Number.isInteger))fail('FOR_TYPE','Integer bounds required');if(${c}===0)fail('FOR_STEP','STEP cannot be zero');${write(n.name, a)}while(${c}>0?v${index(n.name)}<=${b}:v${index(n.name)}>=${b}){${block(n.body)}${tick}${write(n.name, `v${index(n.name)}+${c}`)}}}`
            );
          }
          case "while":
            return (
              tick + `while(truth(${exp(n.cond)})){${block(n.body)}${tick}}`
            );
          case "repeat":
            return (
              tick +
              `while(true){${block(n.body)}if(truth(${exp(n.cond)}))break;${tick}}`
            );
          default:
            throw new Error("unsupported");
        }
      })
      .join("\n");
  let code: string;
  try {
    code = block([node]);
  } catch {
    return false;
  }
  const prelude = `let steps=context.steps,line=context.line,column=context.column||1;const limit=context.limit;const fail=(code,message)=>{context.line=line;context.column=column;context.steps=steps;context.fail(code,message)};const read=(v,l,c)=>{if(v===undefined){line=l;column=c;fail('UNINITIALIZED','Uninitialized variable')}return v};const truth=v=>{if(typeof v!=='boolean')fail('TYPE_MISMATCH','Boolean condition required');return v};const finite=(v,l,c)=>{if(!Number.isFinite(v)){line=l;column=c;fail('OVERFLOW','Numeric overflow')}return v};const divide=(op,a,b,l,c)=>{if(b===0){line=l;column=c;fail('DIV_ZERO','Division by zero')}return finite(op==='/'?a/b:op==='DIV'?Math.trunc(a/b):a-Math.trunc(a/b)*b,l,c)};`;
  const vars = cells.map((_, i) => `let v${i}=cells[${i}].value;`).join("");
  const save = cells.map((_, i) => `cells[${i}].value=v${i};`).join("");
  const compiled = new Function(
    "cells",
    "context",
    prelude +
      vars +
      "try{" +
      code +
      "}finally{" +
      save +
      "context.steps=steps;context.line=line;context.column=column;}",
  );
  compiled(cells, context);
  return true;
}
