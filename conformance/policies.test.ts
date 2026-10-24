import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../core/runtime";
test("explicit negative DIV/MOD, INT and half-even ROUND policies", () => {
  assert.deepEqual(
    run("OUTPUT -7 DIV 3, -7 MOD 3, INT(-2.9)", "9618-AS", [], {
      policies: { divNegative: "floor", intNegative: "floor" },
    }).output,
    ["-32-3"],
  );
  assert.deepEqual(
    run("OUTPUT ROUND(2.5,0),ROUND(-2.5,0)", "0478", [], {
      policies: { roundHalf: "even" },
    }).output,
    ["2-2"],
  );
});
test("short circuit, bound evaluation and output formatting policies apply", () => {
  assert.throws(
    () =>
      run("IF FALSE AND 1/0=0 THEN\nOUTPUT 1\nENDIF", "0478", [], {
        policies: { shortCircuit: false },
      }),
    (e: any) => e.code === "DIV_ZERO",
  );
  const s =
    "DECLARE I,N:INTEGER\nN ← 4\nFOR I ← 1 TO N\nN ← N-1\nNEXT I\nOUTPUT N";
  assert.deepEqual(run(s).output, ["0"]);
  assert.deepEqual(
    run(s, "0478", [], { policies: { forBounds: "eachIteration" } }).output,
    ["2"],
  );
  assert.deepEqual(
    run("DECLARE R:REAL\nR ← 4.0\nOUTPUT R,TRUE", "0478", [], {
      policies: { realOutput: "preserve", booleanOutput: "lower" },
    }).output,
    ["4.0true"],
  );
});
test("filename policy is explicit; initial virtual files preserve case-insensitive reads", () => {
  const s =
    'DECLARE S:STRING\nOPENFILE "DATA.TXT" FOR READ\nREADFILE "data.txt",S\nCLOSEFILE "Data.txt"\nOUTPUT S';
  assert.deepEqual(
    run(s, "9618-AS", [], {
      files: { "Data.Txt": { text: "hello\n" } },
      policies: { filenameCase: "insensitive" },
    }).output,
    ["hello"],
  );
});
test("fast execution returns the same result and instruction limits remain effective", () => {
  const source =
    "DECLARE I,Total:INTEGER\nTotal ← 0\nFOR I ← 1 TO 100\nIF I MOD 2=0 THEN\nTotal ← Total+I\nENDIF\nNEXT I\nOUTPUT Total";
  assert.deepEqual(
    run(source, "9618-AS", [], { fast: true, trace: false }).output,
    run(source, "9618-AS").output,
  );
  assert.throws(
    () =>
      run("WHILE TRUE DO\nENDWHILE", "0478", [], {
        fast: true,
        trace: false,
        maxSteps: 100,
      }),
    (e: any) => e.code === "STEP_LIMIT",
  );
});
test("set value equality deduplicates date/enum values and pointer equality compares cells", () => {
  const s =
    "TYPE E=(One,Two)\nTYPE Es=SET OF E\nTYPE P=^INTEGER\nDEFINE A(One,One,Two):Es\nDEFINE B(Two,One):Es\nDECLARE X:INTEGER\nDECLARE R,S:P\nX ← 3\nR ← ^X\nS ← R\nOUTPUT A, A=B,R=S";
  assert.deepEqual(run(s, "9618-A2").output, ["{ONE, TWO}TRUETRUE"]);
});
test("logical precedence is a real dialect setting and native AST semantics are explicit", () => {
  const code = "OUTPUT TRUE OR FALSE AND FALSE";
  assert.deepEqual(run(code).output, ["TRUE"]);
  assert.deepEqual(
    run(code, "0478", [], {
      profileOptions: { logicalPrecedence: "leftToRight" },
    }).output,
    ["FALSE"],
  );
});
test("BYREF array types resolve formal bound names without losing the alias", () => {
  const source =
    "CONSTANT Limit = 3\nPROCEDURE Change(N:INTEGER,BYREF Data:ARRAY[1:N] OF INTEGER)\nData[1] ← 9\nENDPROCEDURE\nDECLARE A:ARRAY[1:Limit] OF INTEGER\nA[1] ← 2\nCALL Change(Limit,A)\nOUTPUT A[1]";
  assert.deepEqual(run(source, "9618-AS").output, ["9"]);
});
