import { traceRows, csv } from "./trace";
import { profile, type DialectId } from "./dialects";
import { normalize, lex } from "./lexer";
import { parse, type Node } from "./parser";
import { type Event } from "./runtime";
export function format(source: string, id: DialectId) {
  const size = profile(id).indent;
  let current = 0,
    continuation = 0;
  const stack: { kind: string; base: number }[] = [];
  return normalize(source)
    .split("\n")
    .map((raw) => {
      const t = raw.trim(),
        u = t.toUpperCase().replace(/^(PUBLIC|PRIVATE)\s+/, ""),
        closing = u.match(
          /^(ENDIF|ENDWHILE|NEXT|UNTIL|ENDCASE|ENDPROCEDURE|ENDFUNCTION|ENDTYPE|ENDCLASS)\b/,
        );
      let spaces = current;
      if (closing) {
        const frame = stack.pop();
        current = frame?.base ?? Math.max(0, current - size);
        spaces = current;
      } else if (/^(THEN|ELSE)\b/.test(u)) {
        const frame = [...stack].reverse().find((f) => f.kind === "IF");
        spaces = (frame?.base ?? Math.max(0, current - size)) + 2;
        current = (frame?.base ?? 0) + size;
      } else if (
        stack.at(-1)?.kind === "CASE" &&
        /^[^:]+:/.test(t) &&
        !/^DECLARE\b/i.test(t)
      ) {
        spaces = stack.at(-1)!.base + 2;
        current = stack.at(-1)!.base + size;
      } else if (continuation > 0) spaces = current + 2;
      const output = " ".repeat(Math.max(0, spaces)) + t;
      let opens = false;
      if (
        /^(IF|WHILE|FOR|REPEAT|CASE|PROCEDURE|FUNCTION|CLASS)\b/.test(u) ||
        /^TYPE\s+\w+$/i.test(u)
      ) {
        const kind = u.split(/\s/)[0];
        stack.push({ kind, base: spaces });
        current = spaces + size;
        opens = true;
      }
      try {
        const tokens = lex(t);
        for (const token of tokens)
          if (token.kind === "symbol") {
            if (["(", "["].includes(token.text)) continuation++;
            if ([")", "]"].includes(token.text)) continuation--;
          }
      } catch {}
      return output;
    })
    .join("\n");
}
export function traceCSV(events: Event[]) {
  const { columns, rows } = traceRows(events);
  return csv(rows, columns);
}
export interface FlowNode {
  id: number;
  line: number;
  label: string;
  shape: "decision" | "io" | "process" | "terminal";
}
export interface FlowEdge {
  from: number;
  to: number;
  label?: string;
}
export function flowchart(source: string, id: DialectId, module = "main") {
  const p = parse(source, profile(id)),
    nodes: FlowNode[] = [{ id: 0, line: 0, label: "START", shape: "terminal" }],
    edges: FlowEdge[] = [];
  function add(label: string, line: number, shape: FlowNode["shape"]) {
    const n = nodes.length;
    nodes.push({ id: n, label, line, shape });
    return n;
  }
  type Tail = { id: number; label?: string };
  function link(tails: Tail[], to: number) {
    for (const t of tails) edges.push({ from: t.id, to, label: t.label });
  }
  function seq(body: Node[], incoming: Tail[]): Tail[] {
    let tails = incoming;
    for (const n of body) {
      if (["function", "procedure", "class", "type"].includes(n.kind)) continue;
      if (n.kind === "repeat") {
        const entry = add("REPEAT", n.line, "process");
        link(tails, entry);
        const bodyTails = seq(n.body, [{ id: entry }]);
        const condition = add(
          "UNTIL " +
            (n.cond.from !== undefined
              ? source.slice(n.cond.from, n.cond.to)
              : n.cond.token.text),
          n.cond.token.line,
          "decision",
        );
        link(bodyTails, condition);
        edges.push({ from: condition, to: entry, label: "FALSE" });
        tails = [{ id: condition, label: "TRUE" }];
        continue;
      }
      const decision = ["if", "while", "for", "case"].includes(n.kind),
        v = add(
          n.text,
          n.line,
          decision
            ? "decision"
            : ["input", "output"].includes(n.kind)
              ? "io"
              : "process",
        );
      link(tails, v);
      if (n.kind === "if") {
        tails = [
          ...seq(n.body, [{ id: v, label: "TRUE" }]),
          ...seq(n.other, [{ id: v, label: "FALSE" }]),
        ];
      } else if (["while", "for"].includes(n.kind)) {
        link(seq(n.body, [{ id: v, label: "TRUE" }]), v);
        tails = [{ id: v, label: "FALSE" }];
      } else if (n.kind === "case") {
        tails = n.branches.flatMap((b: any, i: number) =>
          seq(b.body, [
            { id: v, label: b.otherwise ? "OTHERWISE" : "branch " + (i + 1) },
          ]),
        );
        if (!n.branches.some((b: any) => b.otherwise))
          tails.push({ id: v, label: "no match" });
      } else if (n.kind === "return") {
        exits.push(v);
        tails = [];
      } else tails = [{ id: v }];
    }
    return tails;
  }
  const modules = p.body.flatMap((n) =>
    ["function", "procedure"].includes(n.kind)
      ? [{ name: n.name, node: n }]
      : n.kind === "class"
        ? n.body
            .filter((m: Node) => ["function", "procedure"].includes(m.kind))
            .map((m: Node) => ({ name: n.name + "." + m.name, node: m }))
        : [],
  );
  const selected = modules.find(
    (m) => m.name.toUpperCase() === module.toUpperCase(),
  );
  nodes[0].label = selected ? "START " + selected.name : "START";
  const exits: number[] = [];
  const tails = seq(selected ? selected.node.body : p.body, [{ id: 0 }]);
  const end = add("END", 0, "terminal");
  link(tails, end);
  for (const from of exits) edges.push({ from, to: end, label: "RETURN" });
  return {
    nodes,
    edges,
    diagnostics: p.diagnostics,
    modules: ["main", ...modules.map((m) => m.name)],
  };
}
