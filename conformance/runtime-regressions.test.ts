import { test } from "node:test";
import assert from "node:assert/strict";
import { Machine, run, type RunOptions } from "../core/runtime";
import { DiagnosticError } from "../core/dialects";
import { transpile, type Target } from "../core/transpile";
import { round } from "../core/policies";

function errorOf(source: string, options: RunOptions = {}) {
  try {
    run(source, "0478", [], options);
  } catch (error) {
    assert.ok(error instanceof DiagnosticError);
    return error;
  }
  assert.fail("Expected a diagnostic");
}

test("fast arithmetic checks intermediate overflow before comparisons or cancellation", () => {
  for (const expression of [
    "10 ^ 1000 > 0",
    "(10 ^ 1000 - 10 ^ 1000) = 0",
    "(100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000 * 10) > 0",
  ]) {
    const source = `DECLARE I:INTEGER\nDECLARE B:BOOLEAN\nFOR I ← 1 TO 1\nB ← ${expression}\nNEXT I`;
    assert.equal(
      errorOf(source, { fast: true, trace: false }).code,
      "OVERFLOW",
    );
    assert.equal(errorOf(source).code, "OVERFLOW");
  }
});

test("fast runtime diagnostics retain the failing expression's source position", () => {
  const source =
    "DECLARE I,N:INTEGER\nFOR I ← 1 TO 1\n    N ← 4 DIV (I - 1)\nNEXT I";
  const normal = errorOf(source),
    fast = errorOf(source, { fast: true, trace: false });
  assert.deepEqual(
    { code: fast.code, line: fast.line, column: fast.column },
    { code: normal.code, line: normal.line, column: normal.column },
  );
});

test("REPEAT fast execution preserves instruction counts and exact resource limits", () => {
  const source =
    "DECLARE N:INTEGER\nN ← 0\nREPEAT\nN ← N+1\nUNTIL N=3\nOUTPUT N";
  const normal = run(source, "0478", [], { trace: false });
  const fast = run(source, "0478", [], {
    fast: true,
    trace: false,
    maxSteps: normal.machine.steps,
  });
  assert.equal(fast.machine.steps, normal.machine.steps);
  assert.deepEqual(fast.output, ["3"]);
});

test("fast loop limit failures preserve the same completed assignments", () => {
  for (const source of [
    "DECLARE N:INTEGER\nN ← 0\nWHILE N<3 DO\nN ← N+1\nENDWHILE",
    "DECLARE N,I:INTEGER\nN ← 0\nFOR I ← 1 TO 3\nN ← N+1\nNEXT I",
  ]) {
    const values: any[] = [];
    for (const fast of [false, true]) {
      const machine = new Machine(source, "0478", {
        fast,
        trace: false,
        maxSteps: 4,
      });
      assert.throws(
        () => {
          while (!machine.generator.next().done) {}
        },
        (e: any) => e.code === "STEP_LIMIT",
      );
      values.push(
        [...machine.global.vars].map(([name, cell]) => [name, cell.value]),
      );
    }
    assert.deepEqual(values[1], values[0]);
  }
});

test("fast execution preserves shared BYREF cells under different parameter names", () => {
  const source =
    "PROCEDURE Bump(BYREF X:INTEGER,BYREF Y:INTEGER)\nDECLARE I:INTEGER\nFOR I ← 1 TO 2\nX ← X+1\nY ← Y+1\nNEXT I\nENDPROCEDURE\nDECLARE A:INTEGER\nA ← 0\nCALL Bump(A,A)\nOUTPUT A";
  assert.deepEqual(
    run(source, "9618-AS", [], { fast: true, trace: false }).output,
    ["4"],
  );
  assert.deepEqual(run(source, "9618-AS", [], { trace: false }).output, ["4"]);
});

test("case-insensitive file dictionaries do not expose inherited object properties", () => {
  assert.throws(
    () =>
      run('OPENFILE "constructor" FOR READ', "9618-AS", [], {
        policies: { filenameCase: "insensitive" },
      }),
    (e: any) => e.code === "FILE_MISSING",
  );
  assert.deepEqual(
    run(
      'DECLARE S:STRING\nOPENFILE "CONSTRUCTOR" FOR READ\nREADFILE "Constructor",S\nCLOSEFILE "constructor"\nOUTPUT S',
      "9618-AS",
      [],
      {
        files: { constructor: { text: "safe\n" } },
        policies: { filenameCase: "insensitive" },
      },
    ).output,
    ["safe"],
  );
});

test("numeric conversion rejects non-finite numeric text and IS_NUM agrees", () => {
  const text = "9".repeat(400);
  assert.deepEqual(run(`OUTPUT IS_NUM("${text}")`, "9618-AS").output, [
    "FALSE",
  ]);
  assert.throws(
    () => run(`OUTPUT STR_TO_NUM("${text}")`, "9618-AS"),
    (e: any) => e.code === "BUILTIN_VALUE",
  );
});

test("NUM_TO_STR emits decimal strings accepted by STR_TO_NUM at small and large magnitudes", () => {
  for (const text of [
    "0.0000001",
    "-0.0000001",
    "1000000000000000000000",
    "0.000000000000000000000000000001",
  ]) {
    const source = `OUTPUT NUM_TO_STR(${text})\nOUTPUT STR_TO_NUM(NUM_TO_STR(${text})) = ${text}`;
    const result = run(source, "9618-AS").output;
    assert.doesNotMatch(result[0], /[eE]/);
    assert.equal(result[1], "TRUE");
  }
});

test("ROUND uses decimal ties including negatives and the chosen half-even policy", () => {
  assert.deepEqual(
    run('OUTPUT ROUND(10.075,2),":",ROUND(-10.075,2),":",ROUND(1.005,2)')
      .output,
    ["10.08:-10.08:1.01"],
  );
  assert.deepEqual(
    run('OUTPUT ROUND(10.065,2),":",ROUND(10.075,2)', "0478", [], {
      policies: { roundHalf: "even" },
    }).output,
    ["10.06:10.08"],
  );
  assert.equal(round(1e308, 15, "away"), 1e308);
  assert.equal(
    round(1.7976931348623157e308, 15, "even"),
    1.7976931348623157e308,
  );
  assert.equal(round(5e-324, 15, "away"), 0);
});

test("a loop can execute its own declarations again without hiding distinct duplicates", () => {
  assert.deepEqual(
    run(
      "DECLARE I:INTEGER\nFOR I ← 1 TO 2\nDECLARE N:INTEGER\nCONSTANT K ← 3\nN ← I+K\nOUTPUT N\nNEXT I",
    ).output,
    ["4", "5"],
  );
  assert.deepEqual(
    run(
      "TYPE Ns=SET OF INTEGER\nDECLARE I:INTEGER\nFOR I ← 1 TO 2\nDEFINE Values(I):Ns\nOUTPUT Values\nNEXT I",
      "9618-A2",
    ).output,
    ["{1}", "{2}"],
  );
  assert.throws(
    () => run("DECLARE N:INTEGER\nDECLARE N:INTEGER"),
    (e: any) => e.code === "DUPLICATE",
  );
});

test("WRITEFILE applies the same boolean and REAL output policies as OUTPUT", () => {
  const result = run(
    'DECLARE R:REAL\nR ← 4.0\nOPENFILE "out" FOR WRITE\nWRITEFILE "out",TRUE\nWRITEFILE "out",R\nCLOSEFILE "out"',
    "9618-AS",
    [],
    {
      policies: { booleanOutput: "lower", realOutput: "preserve" },
    },
  );
  assert.equal(result.files.out.text, "true\n4.0\n");
});

test("SUPER selects the base implementation while THIS keeps the actual object's dynamic type", () => {
  const source =
    'CLASS Base\nPUBLIC PROCEDURE NEW()\nENDPROCEDURE\nPUBLIC FUNCTION Name() RETURNS STRING\nRETURN "Base"\nENDFUNCTION\nPUBLIC FUNCTION CallName() RETURNS STRING\nRETURN THIS.Name()\nENDFUNCTION\nENDCLASS\nCLASS Child INHERITS Base\nPUBLIC PROCEDURE NEW()\nENDPROCEDURE\nPUBLIC FUNCTION Name() RETURNS STRING\nRETURN "Child"\nENDFUNCTION\nPUBLIC FUNCTION Test() RETURNS STRING\nRETURN SUPER.CallName()\nENDFUNCTION\nENDCLASS\nDECLARE C:Child\nC ← NEW Child()\nOUTPUT C.Test()';
  assert.deepEqual(run(source, "9618-A2").output, ["Child"]);
});

test("eachIteration FOR bounds are evaluated exactly once for every condition test", () => {
  const source =
    "FUNCTION Bound() RETURNS INTEGER\nCalls ← Calls+1\nRETURN 1\nENDFUNCTION\nDECLARE Calls,I:INTEGER\nCalls ← 0\nFOR I ← 1 TO Bound()\nOUTPUT I\nNEXT I\nOUTPUT Calls";
  assert.deepEqual(
    run(source, "0478", [], { policies: { forBounds: "eachIteration" } })
      .output,
    ["1", "2"],
  );
  assert.deepEqual(run(source).output, ["1", "1"]);
  for (const target of ["python", "java", "vb"] as Target[]) {
    const code = transpile(source, "0478", target, {
      policies: { forBounds: "eachIteration" },
    });
    assert.doesNotMatch(code, /(?:double|Double) limit\d|limit\d = whole/);
  }
});
