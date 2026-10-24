import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../core/runtime";
import { profile } from "../core/dialects";
import { builtinSignature } from "../core/builtins";
// Original executable fixtures derived from each published signature/rule.
const builtins: Record<
  string,
  { source: string; expected: string; args: string; dialect?: any }
> = {
  LEFT: { source: 'LEFT("ABCDEFGH",3)', expected: "ABC", args: "TRUE,3" },
  RIGHT: { source: 'RIGHT("ABCDEFGH",3)', expected: "FGH", args: "TRUE,3" },
  MID: { source: 'MID("ABCDEFGH",2,3)', expected: "BCD", args: "TRUE,2,3" },
  LENGTH: { source: 'LENGTH("Happy Days")', expected: "10", args: "TRUE" },
  TO_UPPER: {
    source: 'TO_UPPER("Error 803")',
    expected: "ERROR 803",
    args: "TRUE",
  },
  TO_LOWER: {
    source: 'TO_LOWER("JIM 803")',
    expected: "jim 803",
    args: "TRUE",
  },
  NUM_TO_STR: { source: "NUM_TO_STR(87.5)", expected: "87.5", args: "TRUE" },
  STR_TO_NUM: {
    source: 'STR_TO_NUM("23.45")',
    expected: "23.45",
    args: "TRUE",
  },
  IS_NUM: { source: 'IS_NUM("-12.36")', expected: "TRUE", args: "TRUE" },
  ASC: { source: "ASC('A')", expected: "65", args: "TRUE" },
  CHR: { source: "CHR(65)", expected: "A", args: "TRUE" },
  INT: { source: "INT(27.5415)", expected: "27", args: "TRUE" },
  RAND: { source: "INT(RAND(87))", expected: "21", args: "TRUE" },
  DAY: { source: "DAY(04/10/2003)", expected: "4", args: "TRUE" },
  MONTH: { source: "MONTH(04/10/2003)", expected: "10", args: "TRUE" },
  YEAR: { source: "YEAR(04/10/2003)", expected: "2003", args: "TRUE" },
  DAYINDEX: { source: "DAYINDEX(09/05/2023)", expected: "3", args: "TRUE" },
  SETDATE: {
    source: "SETDATE(26,10,2003)",
    expected: "26/10/2003",
    args: "TRUE,10,2003",
  },
  TODAY: { source: "TODAY()", expected: "24/10/2026", args: "1" },
  UCASE: { source: "UCASE('a')", expected: "A", args: "TRUE" },
  LCASE: { source: "LCASE('B')", expected: "b", args: "TRUE" },
  SUBSTRING: {
    source: 'SUBSTRING("Happy Days",1,5)',
    expected: "Happy",
    args: "TRUE,1,5",
    dialect: "0478",
  },
  ROUND: {
    source: "ROUND(12.345,2)",
    expected: "12.35",
    args: "TRUE,2",
    dialect: "0478",
  },
  RANDOM: {
    source: "RANDOM() >= 0 AND RANDOM() <= 1",
    expected: "TRUE",
    args: "1",
    dialect: "0478",
  },
  DIV: { source: "DIV(10,3)", expected: "3", args: "TRUE,3", dialect: "0478" },
  MOD: { source: "MOD(10,3)", expected: "1", args: "TRUE,3", dialect: "0478" },
  EOF: { source: 'EOF("empty")', expected: "TRUE", args: "TRUE" },
};
for (const [name, c] of Object.entries(builtins)) {
  const id = c.dialect || "9618-AS";
  test(`spec ${id} ${name}: positive example`, () => {
    const code =
      (name === "EOF" ? 'OPENFILE "empty" FOR READ\n' : "") +
      "OUTPUT " +
      c.source +
      (name === "EOF" ? '\nCLOSEFILE "empty"' : "");
    assert.deepEqual(
      run(code, id, [], {
        seed: 42,
        clock: "2026-10-24",
        files: { empty: { text: "" } },
      }).output,
      [c.expected],
    );
  });
  test(`spec ${id} ${name}: negative arity and diagnostic golden`, () => {
    const sig = builtinSignature(name, profile(id))!;
    const call = name + "(" + (sig.parameters.length ? "" : "1") + ")";
    assert.throws(
      () => run("OUTPUT " + call, id),
      (e: any) => {
        assert.equal(e.code, "ARITY");
        assert.equal(e.line, 1);
        assert.ok(e.column > 1);
        assert.equal(e.source.verified, true);
        assert.match(e.message, /参数|argument|Argument/);
        return true;
      },
    );
  });
  if (!["RANDOM", "TODAY"].includes(name))
    test(`spec ${id} ${name}: negative parameter type`, () =>
      assert.throws(
        () => run(`OUTPUT ${name}(${c.args})`, id),
        (e: any) => e.code === "TYPE_MISMATCH",
      ));
}
const rules = [
  [
    "CHAR widening",
    'DECLARE C:CHAR\nDECLARE S:STRING\nC ← "x"\nS ← C & "y"\nOUTPUT S',
    "xy",
    'DECLARE C:CHAR\nC ← "xx"',
    "TYPE_MISMATCH",
  ],
  [
    "case-sensitive comparison",
    'OUTPUT "Program" = "program"',
    "FALSE",
    "TYPE R\nDECLARE X:INTEGER\nENDTYPE\nDECLARE A,B:R\nOUTPUT A=B",
    "COMPARE",
  ],
  [
    "DATE/division separation",
    "OUTPUT DAY(02/01/2005), 2 / 1 / 2005",
    "20.000997506234413965",
    "OUTPUT DAY(31/02/2024)",
    "DATE",
  ],
  [
    "constant immutability",
    "CONSTANT Rate = 6.5\nOUTPUT Rate",
    "6.5",
    "CONSTANT Rate = 6.5\nRate ← 7",
    "CONSTANT",
  ],
  [
    "one-based MID boundary",
    'OUTPUT MID("abc",1,3)',
    "abc",
    'OUTPUT MID("abc",0,1)',
    "BUILTIN_RANGE",
  ],
];
for (const [name, positive, expected, negative, code] of rules)
  test("spec rule " + name + " positive / negative / diagnostic", () => {
    assert.deepEqual(run(positive, "9618-AS").output, [expected]);
    assert.throws(
      () => run(negative, "9618-AS"),
      (e: any) => {
        assert.equal(e.code, code);
        assert.ok(e.source?.verified);
        assert.ok(e.line >= 1);
        return true;
      },
    );
  });
