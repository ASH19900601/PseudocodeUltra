import { test } from "node:test";
import assert from "node:assert/strict";
import { profile } from "../core/dialects";
import { analyze } from "../core/semantic";
import { parse } from "../core/parser";
import { run } from "../core/runtime";
import { normalize } from "../core/lexer";
const errors = (s: string, id: any = "9618-A2") =>
  analyze(s, profile(id)).diagnostics.filter((d) => d.severity === "error");
const code = (s: string, c: string, id: any = "9618-A2") =>
  assert.ok(
    errors(s, id).some((d) => d.code === c),
    JSON.stringify(errors(s, id)),
  );
test("full type propagation through fields, array indexes, functions and pointers", () => {
  code(
    "TYPE R\nDECLARE V:REAL\nENDTYPE\nDECLARE A:ARRAY[1:2] OF R\nDECLARE I:INTEGER\nI ← A[1].V",
    "TYPE_MISMATCH",
  );
  code("TYPE P=^REAL\nDECLARE X:P\nDECLARE I:INTEGER\nI ← X^", "TYPE_MISMATCH");
  code(
    "FUNCTION F() RETURNS REAL\nRETURN 2.0\nENDFUNCTION\nDECLARE I:INTEGER\nI ← F()",
    "TYPE_MISMATCH",
  );
});
test("call type, mode, arity and all return paths checked before execution", () => {
  code("PROCEDURE P(BYREF X:INTEGER)\nENDPROCEDURE\nCALL P(1)", "LVALUE");
  code(
    'FUNCTION F(X:INTEGER) RETURNS INTEGER\nRETURN X\nENDFUNCTION\nOUTPUT F("x")',
    "TYPE_MISMATCH",
  );
  code(
    "FUNCTION F() RETURNS INTEGER\nIF TRUE THEN\nRETURN 1\nENDIF\nENDFUNCTION",
    "MISSING_RETURN",
  );
  code(
    "DECLARE X:INTEGER\nX ← 1\nPROCEDURE P\nENDPROCEDURE",
    "MODULE_POSITION",
    "0478",
  );
});
test("official IGCSE underscore, APPEND, and parameter ceiling enforced", () => {
  code("DECLARE Bad_Name:INTEGER", "IDENTIFIER", "0478");
  assert.ok(
    parse('OPENFILE "a" FOR APPEND', profile("0478")).diagnostics.some(
      (d) => d.severity === "error",
    ),
  );
  assert.ok(
    parse(
      "PROCEDURE P(A:INTEGER,B:INTEGER,C:INTEGER,D:INTEGER)\nENDPROCEDURE",
      profile("0478"),
    ).diagnostics.some((d) => d.severity === "error"),
  );
});
test("cyclic records and inheritance diagnosed without host recursion crash", () => {
  code("TYPE R\nDECLARE X:R\nENDTYPE", "TYPE_CYCLE");
  assert.doesNotThrow(() =>
    code(
      "CLASS A INHERITS B\nENDCLASS\nCLASS B INHERITS A\nENDCLASS",
      "TYPE_CYCLE",
    ),
  );
  code("TYPE P=^Missing", "UNKNOWN_TYPE");
});
test("record/array copy rebases equal-size bounds without sharing values", () => {
  assert.deepEqual(
    run(
      "DECLARE A:ARRAY[1:2] OF INTEGER\nDECLARE B:ARRAY[0:1] OF INTEGER\nB[0] ← 8\nB[1] ← 9\nA ← B\nB[0] ← 3\nOUTPUT A[1],A[2]",
    ).output,
    ["89"],
  );
});
test("enum ordinal arithmetic and strong enum typing", () => {
  assert.deepEqual(
    run(
      "TYPE Season=(Spring,Summer,Autumn,Winter)\nDECLARE S:Season\nS ← Spring+1\nOUTPUT S,S>Spring, Winter-Spring",
      "9618-A2",
    ).output,
    ["SUMMERTRUE3"],
  );
  assert.throws(
    () => run("TYPE E=(One,Two)\nDECLARE X:E\nX ← Two+1", "9618-A2"),
    (e: any) => e.code === "ENUM_RANGE",
  );
  code('TYPE E=(One,Two)\nDECLARE X:E\nX ← "ONE"', "TYPE_MISMATCH");
});
test("PDF normalization preserves literal contents and comment text", () => {
  assert.equal(
    normalize('OUTPUT "a<-b−c" // − comment\nX <- 2 − 1'),
    'OUTPUT "a<-b−c" // − comment\nX ← 2 - 1',
  );
});
test("AST ranges reference original source with <- and indentation", () => {
  const source = "DECLARE X:INTEGER\r\n    X <- 1 + 2\r\n    OUTPUT X";
  const p = parse(source, profile("0478"));
  const n = p.body[1],
    e = n.value;
  assert.equal(source.slice(e.from, e.to), "1 + 2");
  assert.equal(e.token.line, 2);
  assert.equal(p.body[2].values[0].token.column, 12);
  assert.equal(source.slice(n.target.from, n.target.to), "X");
});
test("missing nested terminators recover at enclosing block and continue diagnostics", () => {
  const d = parse(
    "WHILE TRUE DO\nIF TRUE THEN\nOUTPUT 1\nENDWHILE\nOUTPUT .5",
    profile("0478"),
  ).diagnostics;
  assert.ok(d.some((d) => d.message.includes("ENDIF")));
  assert.ok(d.some((d) => d.code === "LEX_REAL"));
});
test("Insert RAND requires INTEGER and DAYINDEX Sunday=1", () => {
  code("OUTPUT RAND(1.5)", "TYPE_MISMATCH");
  assert.deepEqual(run("OUTPUT DAYINDEX(12/05/2024)", "9618-AS").output, ["1"]);
});
test("IGCSE parameterless function and multiline expressions preserve exact spans", () => {
  const source =
    "FUNCTION Answer RETURNS INTEGER\nRETURN 42\nENDFUNCTION\nDECLARE X:INTEGER\nX ← Answer\nOUTPUT (\n  X +\n  1\n)";
  assert.deepEqual(run(source).output, ["43"]);
  const p = parse(source, profile("0478"));
  const expr = p.body.at(-1)!.values[0];
  assert.equal(expr.right.token.line, 8);
  assert.equal(expr.right.token.column, 3);
});
test("keyword and terminator code actions produce parsable corrected source", () => {
  const source = "if TRUE then\nOUTPUT 1";
  const p = analyze(source, profile("0478"));
  const action = p.diagnostics.find((d) => d.code === "STYLE_CASE")
    ?.actions?.[0];
  assert.ok(action);
  const edit = action.edits[0];
  const fixed =
    source.slice(0, edit.from) + edit.insert + source.slice(edit.to);
  assert.ok(fixed.startsWith("IF"));
  const missing = p.diagnostics.find((d) => d.message.includes("Missing ENDIF"))
    ?.actions?.[0];
  assert.ok(missing);
  const e = missing.edits[0];
  assert.ok(
    !parse(
      source.slice(0, e.from) + e.insert + source.slice(e.to),
      profile("0478"),
    ).diagnostics.some((d) => d.severity === "error"),
  );
});
test("deep hostile expressions and blocks return diagnostics instead of host errors", () => {
  for (const source of [
    "OUTPUT " + "(".repeat(1000) + "1" + ")".repeat(1000),
    "OUTPUT " + Array(10000).fill("1").join("+"),
    "IF TRUE THEN\n".repeat(300) + "OUTPUT 1\n" + "ENDIF\n".repeat(300),
  ])
    assert.doesNotThrow(() => {
      assert.ok(
        parse(source, profile("0478")).diagnostics.some(
          (d) => d.severity === "error",
        ),
      );
    });
});
test("IGCSE OTHERWISE has no colon and CASE never tests later cases after a hit", () => {
  assert.deepEqual(
    run(
      'DECLARE X:STRING\nX ← "a:b"\nCASE OF X\n"a:b" : OUTPUT "yes"\nOTHERWISE OUTPUT "no"\nENDCASE',
    ).output,
    ["yes"],
  );
  assert.deepEqual(
    run('CASE OF 1\n1 : OUTPUT "yes"\n1/0 : OUTPUT "bad"\nENDCASE').output,
    ["yes"],
  );
});
test("Guide NEW creates a typed object without a separate DECLARE", () => {
  const source =
    "CLASS Counter\nPRIVATE Value:INTEGER\nPUBLIC PROCEDURE NEW(N:INTEGER)\nValue ← N\nENDPROCEDURE\nPUBLIC FUNCTION Get() RETURNS INTEGER\nRETURN Value\nENDFUNCTION\nENDCLASS\nItem ← NEW Counter(5)\nOUTPUT Item.Get()";
  assert.deepEqual(run(source, "9618-A2").output, ["5"]);
});
