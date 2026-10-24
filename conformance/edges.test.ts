import { test } from "node:test";
import assert from "node:assert/strict";
import { run, Machine } from "../core/runtime";
import { profile, DiagnosticError } from "../core/dialects";
import { parse } from "../core/parser";
import { definition, rename, completionKeywords } from "../core/language";
import { lex } from "../core/lexer";
function bad(s: string, code: string, id: any = "9618-A2") {
  assert.throws(
    () => run(s, id),
    (e: any) => e.code === code,
    code,
  );
}
test("runtime REAL type preserved across variables and division", () => {
  bad("DECLARE R:REAL\nDECLARE I:INTEGER\nR ← 4.0\nI ← R", "TYPE_MISMATCH");
  bad("DECLARE I:INTEGER\nI ← 4 / 2", "TYPE_MISMATCH");
});
test("CALL/procedure/function separation and constant BYREF protection", () => {
  bad("PROCEDURE P()\nENDPROCEDURE\nOUTPUT P()", "CALL_KIND");
  bad(
    "FUNCTION F() RETURNS INTEGER\nRETURN 1\nENDFUNCTION\nCALL F()",
    "CALL_FUNCTION",
  );
  bad(
    "PROCEDURE P(BYREF X:INTEGER)\nX ← 2\nENDPROCEDURE\nCONSTANT A = 1\nCALL P(A)",
    "CONSTANT",
  );
});
test("PRIVATE access denied externally and in derived class", () => {
  const c =
    "CLASS Base\nPRIVATE X:INTEGER\nPUBLIC PROCEDURE NEW()\nX ← 1\nENDPROCEDURE\nENDCLASS\n";
  bad(c + "DECLARE B:Base\nB ← NEW Base()\nOUTPUT B.X", "PRIVATE");
  bad(
    c +
      "CLASS Child INHERITS Base\nPUBLIC PROCEDURE NEW()\nX ← 9\nENDPROCEDURE\nENDCLASS\nDECLARE C:Child\nC ← NEW Child()",
    "UNDECLARED",
  );
});
test("pointer dereference in arithmetic and comparisons", () =>
  assert.deepEqual(
    run(
      "TYPE Ptr = ^INTEGER\nDECLARE P:Ptr\nDECLARE X:INTEGER\nX ← 3\nP ← ^X\nOUTPUT P^ + 2, P^ = 3",
      "9618-A2",
    ).output,
    ["5TRUE"],
  ));
test("two-dimensional array bounds and shape errors", () => {
  bad(
    "DECLARE A:ARRAY[1:2] OF INTEGER\nDECLARE B:ARRAY[0:2] OF INTEGER\nA ← B",
    "ARRAY_SHAPE",
  );
  bad("DECLARE A:ARRAY[1:2,1:2] OF INTEGER\nA[1] ← 3", "ARRAY_BOUNDS");
});
test("file mode violations, duplicate open and unclosed warning", () => {
  bad('OPENFILE "a" FOR WRITE\nDECLARE S:STRING\nREADFILE "a", S', "FILE_MODE");
  bad('OPENFILE "a" FOR WRITE\nOPENFILE "a" FOR READ', "FILE_OPEN");
  assert.ok(
    run('OPENFILE "a" FOR WRITE', "9618-AS").events.some(
      (e) => e.kind === "warning",
    ),
  );
});
test("record random-file values survive structured-clone persistence", () => {
  const prefix = "TYPE R\nDECLARE V:INTEGER\nENDTYPE\nDECLARE X:R\n";
  const a = run(
    prefix +
      'X.V ← 8\nOPENFILE "r" FOR RANDOM\nPUTRECORD "r", X\nCLOSEFILE "r"',
    "9618-A2",
  );
  const b = run(
    prefix +
      'OPENFILE "r" FOR RANDOM\nGETRECORD "r", X\nOUTPUT X.V\nCLOSEFILE "r"',
    "9618-A2",
    [],
    { files: structuredClone(a.files) },
  );
  assert.deepEqual(b.output, ["8"]);
});
test("TODAY injectable clock; negative INT/DIV/MOD policies", () =>
  assert.deepEqual(
    run("OUTPUT TODAY(),INT(-2.9), -7 DIV 3, -7 MOD 3", "9618-AS", [], {
      clock: "2026-10-24",
    }).output,
    ["24/10/2026-2-2-1"],
  ));
test("diagnostic golden contract includes code, line and bilingual message", () => {
  try {
    run("DECLARE A : ARRAY[1:2] OF INTEGER\nA[3] ← 0");
  } catch (e) {
    assert.ok(e instanceof DiagnosticError);
    assert.deepEqual(
      { code: e.code, line: e.line, message: e.message },
      {
        code: "ARRAY_BOUNDS",
        line: 2,
        message: "数组越界 / Array index out of bounds",
      },
    );
  }
});
test("language definition and scoped rename preserve strings/comments", () => {
  const s =
    'DECLARE X:INTEGER\nPROCEDURE P(X:INTEGER)\nOUTPUT X, "X" // X\nENDPROCEDURE\nX ← 1\nCALL P(X)';
  assert.equal(definition(s, "0478", "X", 3)?.line, 2);
  assert.equal(definition(s, "0478", "X", 5)?.line, 1);
  const r = rename(s, "0478", "X", "Value", 3);
  assert.match(r, /PROCEDURE P\(Value:INTEGER\)/);
  assert.match(r, /OUTPUT Value, "X" \/\/ X/);
  assert.match(r, /\nX ← 1/);
  assert.ok(!completionKeywords("0478").includes("CLASS"));
  assert.ok(completionKeywords("9618-A2").includes("CLASS"));
});
test("parser deterministic fuzz: 1000 malformed token streams do not throw", () => {
  let seed = 42;
  const words = [
    "IF",
    "THEN",
    '"x"',
    "ENDIF",
    "FOR",
    "NEXT",
    "←",
    "DECLARE",
    "A",
    "1",
    "(",
    ")",
    "[",
    "]",
    ",",
    ":",
    "TYPE",
    "CLASS",
    "ENDCLASS",
    "CASE",
    "OF",
    "OUTPUT",
    "WHILE",
    "ENDWHILE",
    "\n",
    "+",
    "^",
    "// hi\n",
  ];
  for (let i = 0; i < 1000; i++) {
    let s = "";
    for (let j = 0; j < 12; j++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      s += words[seed % words.length] + " ";
    }
    assert.doesNotThrow(() => parse(s, profile("9618-A2")));
  }
});
test("INPUT validation and recursion limit", () => {
  assert.throws(
    () => run("DECLARE I:INTEGER\nINPUT I", "0478", ["x"]),
    /numeric input/,
  );
  bad(
    "FUNCTION R() RETURNS INTEGER\nRETURN R()\nENDFUNCTION\nOUTPUT R()",
    "CALL_DEPTH",
  );
});
test("Guide §4.1 official DEFINE syntax and §10.1 method statement", () => {
  assert.deepEqual(
    run(
      "TYPE LetterSet = SET OF CHAR\nDEFINE Vowels ('A','E','I','O','U'): LetterSet\nOUTPUT Vowels",
      "9618-A2",
    ).output,
    ["{A, E, I, O, U}"],
  );
  assert.deepEqual(
    run(
      "CLASS C\nPRIVATE X:INTEGER\nPUBLIC PROCEDURE NEW()\nX ← 0\nENDPROCEDURE\nPUBLIC PROCEDURE SetValue(N:INTEGER)\nX ← N\nENDPROCEDURE\nPUBLIC FUNCTION Get() RETURNS INTEGER\nRETURN X\nENDFUNCTION\nENDCLASS\nDECLARE Obj:C\nObj ← NEW C()\nObj.SetValue(3)\nOUTPUT Obj.Get()",
      "9618-A2",
    ).output,
    ["3"],
  );
});
