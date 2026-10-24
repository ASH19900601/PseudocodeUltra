import { userSignatures } from "./language";
import { profile, type Diagnostic, type DialectId } from "./dialects";
import { analyze } from "./semantic";
import { lex, normalize } from "./lexer";
import type { Node, Program } from "./parser";
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}
// Context-sensitive incremental diagnostics: reuse unchanged top-level units and
// recheck an edited statement against only the declarations it depends on.
export class LanguageService {
  private optionsKey = "";
  private source = "";
  private id: DialectId = "0478";
  private program?: Program;
  private rows: string[] = [];
  private definitions = new Map<string, string>();
  private lineNodes = new Map<number, Node>();
  private diagnostics: Diagnostic[] = [];
  signatures(options: Parameters<typeof profile>[1] = {}) {
    return this.program
      ? userSignatures(this.program, profile(this.id, options))
      : [];
  }
  continuations() {
    return this.program?.continuationLines || [];
  }
  outline() {
    return (this.program?.body || []).flatMap((n) =>
      ["function", "procedure", "class", "type"].includes(n.kind)
        ? [{ name: n.name, kind: n.kind, line: n.line }]
        : [],
    );
  }
  update(
    source: string,
    id: DialectId,
    options: Parameters<typeof profile>[1] = {},
  ): { diagnostics: Diagnostic[]; incremental: boolean } {
    const rows = source.split("\n");
    if (
      this.program &&
      JSON.stringify(options) === this.optionsKey &&
      id === this.id &&
      rows.length === this.rows.length
    ) {
      let changed = -1,
        count = 0;
      for (let i = 0; i < rows.length; i++)
        if (rows[i] !== this.rows[i]) {
          changed = i;
          count++;
          if (count > 1) break;
        }
      if (count === 0)
        return { diagnostics: this.diagnostics, incremental: true };
      const unit = this.lineNodes.get(changed + 1);
      if (
        count === 1 &&
        normalize(rows[changed]) === rows[changed] &&
        !this.diagnostics.some((d) => d.code === "NORMALIZED") &&
        unit &&
        unit.line === unit.endLine &&
        ![
          "declare",
          "constant",
          "define",
          "function",
          "procedure",
          "class",
          "type",
        ].includes(unit.kind) &&
        !/[()\[\]]/.test(rows[changed]) &&
        !/^\s*(DECLARE|CONSTANT|DEFINE|IF|THEN|ELSE|ENDIF|WHILE|ENDWHILE|FOR|NEXT|REPEAT|UNTIL|CASE|ENDCASE|PROCEDURE|ENDPROCEDURE|FUNCTION|ENDFUNCTION|TYPE|ENDTYPE|CLASS|ENDCLASS)\b/i.test(
          rows[changed],
        )
      ) {
        let tokens: ReturnType<typeof lex>;
        try {
          tokens = lex(rows[changed]);
        } catch {
          tokens = [];
        }
        const dependencies = new Set<string>();
        const context: string[] = [];
        const collect = (tokens: ReturnType<typeof lex>) => {
          for (const token of tokens)
            if (token.kind === "name") {
              const definition = this.definitions.get(token.text.toUpperCase());
              if (definition && !dependencies.has(definition)) {
                dependencies.add(definition);
                let inner: ReturnType<typeof lex> = [];
                try {
                  inner = lex(definition);
                } catch {}
                collect(inner);
                context.push(definition);
              }
            }
        };
        collect(tokens);
        const prefix = context.join("\n"),
          p = analyze(
            (prefix ? prefix + "\n" : "") + rows[changed],
            profile(id, options),
          ),
          offset = context.reduce((n, s) => n + s.split("\n").length, 0);
        const prefixLength = prefix ? prefix.length + 1 : 0,
          rowStart = rows
            .slice(0, changed)
            .reduce((n, s) => n + s.length + 1, 0),
          delta = rows[changed].length - this.rows[changed].length;
        const oldRowEnd = rowStart + this.rows[changed].length;
        const shift = (at: number) => (at >= oldRowEnd ? at + delta : at);
        const changedDiagnostics = p.diagnostics
          .filter((d) => d.line > offset)
          .map((d) => ({
            ...d,
            line: changed + 1,
            from:
              d.from !== undefined && d.from >= prefixLength
                ? rowStart + d.from - prefixLength
                : undefined,
            to:
              d.to !== undefined && d.to >= prefixLength
                ? rowStart + d.to - prefixLength
                : undefined,
            actions: d.actions?.map((a) => ({
              ...a,
              edits: a.edits.map((e) => ({
                ...e,
                from:
                  e.from >= prefixLength ? rowStart + e.from - prefixLength : 0,
                to: e.to >= prefixLength ? rowStart + e.to - prefixLength : 0,
              })),
            })),
          }));
        this.diagnostics = [
          ...this.diagnostics
            .filter((d) => d.line !== changed + 1)
            .map((d) => ({
              ...d,
              ...(d.line > changed + 1
                ? {
                    from: d.from !== undefined ? d.from + delta : undefined,
                    to: d.to !== undefined ? d.to + delta : undefined,
                  }
                : {}),
              actions: d.actions?.map((a) => ({
                ...a,
                edits: a.edits.map((e) => ({
                  ...e,
                  from: shift(e.from),
                  to: shift(e.to),
                })),
              })),
            })),
          ...changedDiagnostics,
        ];
        this.source = source;
        this.rows = rows;
        return { diagnostics: this.diagnostics, incremental: true };
      }
    }
    this.optionsKey = JSON.stringify(options);
    this.id = id;
    this.source = source;
    this.rows = rows;
    this.program = analyze(source, profile(id, options));
    this.diagnostics = this.program.diagnostics;
    this.definitions.clear();
    this.lineNodes.clear();
    for (const node of this.program.body) {
      for (let line = node.line; line <= node.endLine; line++)
        this.lineNodes.set(line, node);
      const text = rows.slice(node.line - 1, node.endLine).join("\n");
      if (node.kind === "declare")
        for (const name of node.names)
          this.definitions.set(name.toUpperCase(), text);
      if (
        [
          "constant",
          "type",
          "class",
          "function",
          "procedure",
          "define",
        ].includes(node.kind)
      )
        this.definitions.set(node.name.toUpperCase(), text);
      if (node.kind === "type" && node.definition?.startsWith("("))
        for (const name of node.definition.slice(1, -1).split(","))
          this.definitions.set(name.trim().toUpperCase(), text);
      if (
        node.kind === "assign" &&
        node.target.kind === "name" &&
        node.value.kind === "new"
      )
        this.definitions.set(node.target.name.toUpperCase(), text);
    }
    return { diagnostics: this.diagnostics, incremental: false };
  }
}
