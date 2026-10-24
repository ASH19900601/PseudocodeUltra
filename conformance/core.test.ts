import { test } from "node:test";
import assert from "node:assert/strict";
import { run, Machine } from "../core/runtime";
import { parse } from "../core/parser";
import { profile, DiagnosticError } from "../core/dialects";
import { analyze } from "../core/semantic";
import { format, traceCSV, flowchart } from "../core/tools";
const result = (s: string, id: any = "0478", inputs: string[] = []) =>
  run(s, id, inputs).output;
function bad(s: string, code: string, id: any = "0478") {
  assert.throws(
    () => run(s, id),
    (e: any) => e instanceof DiagnosticError && e.code === code,
  );
}
test("M1 arithmetic, precedence, constants, case-insensitive variables", () =>
  assert.deepEqual(
    result(
      "CONSTANT Limit ← 4\nDECLARE Total : INTEGER\ntotal ← 2 + Limit * 3\nOUTPUT TOTAL",
    ),
    ["14"],
  ));
test("M1 IF, FOR, WHILE, REPEAT and INPUT", () =>
  assert.deepEqual(
    result(
      'DECLARE I, Sum : INTEGER\nINPUT Sum\nFOR I ← 1 TO 3\nSum ← Sum + I\nNEXT I\nWHILE Sum < 10 DO\nSum ← Sum + 1\nENDWHILE\nREPEAT\nSum ← Sum - 1\nUNTIL Sum = 8\nIF Sum = 8 THEN\nOUTPUT "yes"\nELSE\nOUTPUT "no"\nENDIF',
      "0478",
      ["1"],
    ),
    ["yes"],
  ));
test("M1 CASE first match, range, otherwise", () =>
  assert.deepEqual(
    result(
      'DECLARE A : INTEGER\nA ← 3\nCASE OF A\n1 : OUTPUT "one"\n2 TO 4 : OUTPUT "range"\nOTHERWISE : OUTPUT "other"\nENDCASE',
    ),
    ["range"],
  ));
test("M1 array lower bounds, deep copy, two dimensions", () =>
  assert.deepEqual(
    result(
      "DECLARE A, B : ARRAY[-1:1, 2:3] OF INTEGER\nA[-1,2] ← 7\nB ← A\nA[-1,2] ← 9\nOUTPUT B[-1,2]",
    ),
    ["7"],
  ));
test("M1 procedures and functions", () =>
  assert.deepEqual(
    result(
      "FUNCTION Double(X : INTEGER) RETURNS INTEGER\nRETURN X * 2\nENDFUNCTION\nPROCEDURE Show\nOUTPUT Double(5)\nENDPROCEDURE\nCALL Show",
    ),
    ["10"],
  ));
test("M1 builtins and power", () =>
  assert.deepEqual(
    result(
      'OUTPUT SUBSTRING("hello",2,3), UCASE("ok"), ROUND(-1.25,1), DIV(10,3), MOD(10,3), 2^3',
    ),
    ["ellOK-1.3318"],
  ));
test("M1 errors: declaration, constant, type, bounds, numeric syntax", () => {
  bad("OUTPUT Missing", "UNDECLARED");
  bad("CONSTANT A ← 1\nA ← 2", "CONSTANT");
  bad('DECLARE A : INTEGER\nA ← "x"', "TYPE_MISMATCH");
  bad("DECLARE A : ARRAY[1:2] OF INTEGER\nOUTPUT A[0]", "ARRAY_BOUNDS");
  bad("OUTPUT .5", "LEX_REAL");
  bad("CONSTANT A ← 1+2", "PARSE_STATEMENT");
});
test("M1 dialect restrictions and block errors", () => {
  bad("WHILE TRUE\nENDWHILE", "PARSE_STATEMENT");
  bad("FOR I ← 1 TO 2\nNEXT J", "PARSE_STATEMENT");
  bad(
    "PROCEDURE P(A:INTEGER,B:INTEGER,C:INTEGER,D:INTEGER)\nENDPROCEDURE",
    "PARSE_STATEMENT",
  );
  bad("DECLARE D : DATE", "DIALECT_TYPE");
});
test("M1 PDF normalization and short circuit", () =>
  assert.deepEqual(
    result(
      "DECLARE X : INTEGER\nX <- 4 – 1\nIF FALSE AND 1 / 0 = 1 THEN\nOUTPUT ꞌxꞌ\nENDIF\nOUTPUT X",
    ),
    ["3"],
  ));
test("M2 records are deep copied", () =>
  assert.deepEqual(
    result(
      'TYPE Pupil\nDECLARE Name : STRING\nENDTYPE\nDECLARE A, B : Pupil\nA.Name ← "Alice"\nB ← A\nA.Name ← "Bob"\nOUTPUT B.Name',
      "9618-AS",
    ),
    ["Alice"],
  ));
test("M2 BYREF aliases original cell, BYVAL copies", () =>
  assert.deepEqual(
    result(
      "PROCEDURE Add(BYREF X:INTEGER, BYVAL Y:INTEGER)\nX ← X + 1\nY ← 99\nENDPROCEDURE\nDECLARE A, B : INTEGER\nA ← 1\nB ← 2\nCALL Add(A,B)\nOUTPUT A,B",
      "9618-AS",
    ),
    ["22"],
  ));
test("M2 Insert strings and conversion", () =>
  assert.deepEqual(
    result(
      'OUTPUT LEFT("Hello",2), RIGHT("Hello",2), MID("Hello",2,3), TO_UPPER("hi"), TO_LOWER("OK"), NUM_TO_STR(4), STR_TO_NUM("12"), IS_NUM("x"), ASC(\'A\'), CHR(66)',
      "9618-AS",
    ),
    ["HeloellHIok412FALSE65B"],
  ));
test("M2 dates versus division and CHAR/STRING rules", () =>
  assert.deepEqual(
    result(
      'DECLARE D : DATE\nD ← 09/05/2023\nOUTPUT DAY(D),MONTH(D),YEAR(D),DAYINDEX(D), DAY(SETDATE(1,2,2024)), 2 / 1 / 2005\nDECLARE C : CHAR\nC ← "a"\nOUTPUT C & "bc", "Program" = "program"',
      "9618-AS",
    ),
    ["952023310.000997506234413965", "abcFALSE"],
  ));
test("M2 invalid date, EOF mode, builtin validation", () => {
  bad("OUTPUT DAY(31/02/2024)", "DATE", "9618-AS");
  bad('OUTPUT EOF("a")', "FILE_MODE", "9618-AS");
  bad('OUTPUT MID("a",2,1)', "BUILTIN_RANGE", "9618-AS");
  bad('OUTPUT UCASE("abc")', "TYPE_MISMATCH", "9618-AS");
  bad("OUTPUT INT()", "ARITY", "9618-AS");
});
test("M2 virtual text files and EOF", () => {
  const r = run(
    'OPENFILE "x" FOR WRITE\nWRITEFILE "x", "hello"\nCLOSEFILE "x"\nDECLARE S : STRING\nOPENFILE "x" FOR READ\nREADFILE "x", S\nOUTPUT S, EOF("x")\nCLOSEFILE "x"',
    "9618-AS",
  );
  assert.deepEqual(r.output, ["helloTRUE"]);
  assert.equal(r.files.x.text, "hello\n");
});
test("M3 enums, pointers and sets", () =>
  assert.deepEqual(
    result(
      "TYPE Colour = (Red, Green, Blue)\nTYPE IntPtr = ^INTEGER\nTYPE Numbers = SET OF INTEGER\nDECLARE C : Colour\nC ← Green\nDECLARE X : INTEGER\nX ← 5\nDECLARE P : IntPtr\nP ← ^X\nP^ ← 7\nDECLARE S : Numbers\nDEFINE S(1,2,2)\nOUTPUT C,X,S",
      "9618-A2",
    ),
    ["GREEN7{1, 2}"],
  ));
test("M3 recursion", () =>
  assert.deepEqual(
    result(
      "FUNCTION Fact(N:INTEGER) RETURNS INTEGER\nIF N = 0 THEN\nRETURN 1\nELSE\nRETURN N * Fact(N-1)\nENDIF\nENDFUNCTION\nOUTPUT Fact(6)",
      "9618-A2",
    ),
    ["720"],
  ));
test("M3 OOP inheritance, constructors, methods and private fields", () =>
  assert.deepEqual(
    result(
      "CLASS Counter\nPRIVATE Value : INTEGER\nPUBLIC PROCEDURE NEW(Start:INTEGER)\nValue ← Start\nENDPROCEDURE\nPUBLIC FUNCTION Get() RETURNS INTEGER\nRETURN Value\nENDFUNCTION\nENDCLASS\nCLASS Child INHERITS Counter\nPUBLIC PROCEDURE NEW(Start:INTEGER)\nCALL SUPER.NEW(Start)\nENDPROCEDURE\nENDCLASS\nDECLARE C : Child\nC ← NEW Child(4)\nOUTPUT C.Get()",
      "9618-A2",
    ),
    ["4"],
  ));
test("M3 random record file retains value copies", () =>
  assert.deepEqual(
    result(
      'OPENFILE "r" FOR RANDOM\nDECLARE X : INTEGER\nX ← 7\nSEEK "r", 2\nPUTRECORD "r", X\nX ← 9\nSEEK "r", 2\nGETRECORD "r", X\nOUTPUT X\nCLOSEFILE "r"',
      "9618-A2",
    ),
    ["7"],
  ));
test("M4 step suspension, trace snapshot and flowchart edges", () => {
  const m = new Machine("DECLARE X : INTEGER\nX ← 1\nOUTPUT X");
  assert.equal(m.generator.next().value.line, 1);
  assert.equal(m.global.find("X"), undefined);
  m.generator.next();
  assert.ok(m.global.find("X"));
  const r = run("DECLARE X : INTEGER\nX ← 1\nOUTPUT X");
  assert.match(traceCSV(r.events), /"X"/);
  assert.ok(
    flowchart('IF TRUE THEN\nOUTPUT "x"\nENDIF', "0478").edges.some(
      (e) => e.label === "FALSE",
    ),
  );
});
test("M4 limit prevents infinite empty loops", () =>
  assert.throws(
    () => run("WHILE TRUE DO\nENDWHILE", "0478", [], { maxSteps: 20 }),
    /Instruction limit/,
  ));
test("semantic multiple errors, REAL division assignment and return paths", () => {
  const d = analyze(
    "DECLARE A : INTEGER\nA ← 4 / 2\nOUTPUT Unknown",
    profile("0478"),
  ).diagnostics;
  assert.ok(d.some((d) => d.code === "TYPE_MISMATCH"));
  assert.ok(d.some((d) => d.code === "UNDECLARED"));
  assert.ok(
    analyze(
      "FUNCTION F(X:INTEGER) RETURNS INTEGER\nIF X=1 THEN\nRETURN 1\nENDIF\nENDFUNCTION",
      profile("0478"),
    ).diagnostics.some((d) => d.code === "MISSING_RETURN"),
  );
});
test("formatter keeps statement order and comments", () =>
  assert.equal(
    format('IF TRUE THEN\n// hi\nOUTPUT "x"\nENDIF', "0478"),
    'IF TRUE THEN\n    // hi\n    OUTPUT "x"\nENDIF',
  ));
test("seed deterministic and positive bounds enforced", () => {
  assert.deepEqual(
    run("OUTPUT RAND(10)", "9618-AS", [], { seed: 42 }).output,
    run("OUTPUT RAND(10)", "9618-AS", [], { seed: 42 }).output,
  );
  bad("OUTPUT RAND(0)", "BUILTIN_RANGE", "9618-AS");
});
test("parser malformed-input recovery does not hang", () => {
  for (const s of [
    "IF",
    "ENDCLASS",
    "OUTPUT (",
    "DECLARE :",
    "CASE OF 1\nWHAT\nENDCASE",
    '"',
    "😀",
    "NEXT",
    "IF TRUE THEN\nOUTPUT 1",
  ])
    assert.ok(parse(s, profile("0478")).diagnostics.length > 0);
});
