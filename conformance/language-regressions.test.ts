import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../core/semantic";
import { profile } from "../core/dialects";
import { run } from "../core/runtime";
import { LanguageService } from "../core/language-service";
import { signatureHelp } from "../core/language";
import { traceRows } from "../core/trace";
import { format } from "../core/tools";

const diagnostics = (source: string) =>
  analyze(source, profile("9618-A2")).diagnostics;
const has = (source: string, code: string) =>
  assert.ok(
    diagnostics(source).some((d) => d.code === code),
    source + " should report " + code,
  );

test("escaped quotes do not turn string content into a line comment", () => {
  assert.deepEqual(run(String.raw`OUTPUT "a \" // text"`).output, [
    'a " // text',
  ]);
});

test("CASE branch bodies can output strings containing colons", () => {
  const source = 'CASE OF 1\n1:\nOUTPUT "a:b"\nENDCASE';
  assert.deepEqual(run(source, "9618-AS").output, ["a:b"]);
  assert.equal(
    format(source, "9618-AS"),
    'CASE OF 1\n  1:\n   OUTPUT "a:b"\nENDCASE',
  );
});

test("procedures reject a RETURNS clause", () => {
  has("PROCEDURE P() RETURNS INTEGER\nENDPROCEDURE", "PARSE_STATEMENT");
});

test("write operations diagnose nonassignable expression targets before execution", () => {
  for (const source of [
    "1 ← 2",
    "INPUT 1",
    'READFILE "a", 1',
    'GETRECORD "a", 1',
    "PROCEDURE P(BYREF X:INTEGER)\nENDPROCEDURE\nCALL P(1+2)",
  ])
    has(source, "LVALUE");
});

test("FOR cannot overwrite a constant loop variable", () => {
  has("CONSTANT X = 1\nFOR X ← 1 TO 3\nOUTPUT X\nNEXT X", "CONSTANT");
});

test("CASE bodies receive declaration, identifier and type validation", () => {
  const source =
    "CASE OF 1\n1: DECLARE A:INTEGER\nDECLARE A:STRING\nDECLARE IF:INTEGER\nDECLARE B:Missing\nENDCASE";
  for (const code of ["DUPLICATE", "IDENTIFIER", "UNKNOWN_TYPE"])
    has(source, code);
});

test("record fields reject duplicate names and reserved identifiers", () => {
  const source =
    "TYPE R\nDECLARE X:INTEGER\nDECLARE X:STRING\nDECLARE IF:INTEGER\nENDTYPE";
  has(source, "DUPLICATE");
  has(source, "IDENTIFIER");
});

test("enum members reject duplicate, empty and reserved identifiers", () => {
  has("TYPE E = (A, A)", "DUPLICATE");
  has("TYPE E = (A)\nTYPE F = (A)", "DUPLICATE");
  has("TYPE E = (IF)", "IDENTIFIER");
  has("TYPE E = ()", "IDENTIFIER");
});

test("a class superclass must be a class rather than a record", () => {
  has(
    "TYPE R\nDECLARE X:INTEGER\nENDTYPE\nCLASS C INHERITS R\nENDCLASS",
    "CLASS",
  );
});

test("an unconditional return in REPEAT satisfies a function return path", () => {
  const source =
    "FUNCTION F() RETURNS INTEGER\nREPEAT\nRETURN 1\nUNTIL TRUE\nENDFUNCTION\nOUTPUT F()";
  assert.deepEqual(diagnostics(source), []);
  assert.deepEqual(run(source, "9618-A2").output, ["1"]);
});

test("nested definitions produce a diagnostic instead of being silently ignored", () => {
  has(
    "PROCEDURE P()\nPROCEDURE Q()\nENDPROCEDURE\nENDPROCEDURE",
    "MODULE_POSITION",
  );
  has("IF TRUE THEN\nPROCEDURE Q()\nENDPROCEDURE\nENDIF", "MODULE_POSITION");
});

test("CASE rejects reversed or multiply chained range endpoints", () => {
  for (const range of ["3 TO 1", "1 TO 2 TO 3"])
    has(`CASE OF 1\n${range}: OUTPUT 1\nENDCASE`, "CASE_RANGE");
});

test("incremental dependencies include enum members and implicit object variables", () => {
  const enums = "TYPE E = (A, B)\nOUTPUT A";
  const service = new LanguageService();
  service.update(enums, "9618-A2");
  assert.deepEqual(
    service.update(enums.replace("OUTPUT A", "OUTPUT B"), "9618-A2")
      .diagnostics,
    [],
  );
  const implicit =
    "CLASS C\nPUBLIC PROCEDURE NEW()\nENDPROCEDURE\nENDCLASS\nObj ← NEW C()\nOUTPUT Obj";
  service.update(implicit, "9618-A2");
  assert.deepEqual(
    service.update(implicit.replace("OUTPUT Obj", "OUTPUT Obj, 1"), "9618-A2")
      .diagnostics,
    [],
  );
});

test("editing an earlier row remaps later quick fix edits", () => {
  const original = "DECLARE X:INTEGER\nX ← 1\noutput X";
  const edited = original.replace("X ← 1", "X ← 123456");
  const service = new LanguageService();
  service.update(original, "0478");
  const result = service.update(edited, "0478");
  assert.ok(result.incremental);
  const edit = result.diagnostics.find((d) => d.code === "STYLE_CASE")!
    .actions![0].edits[0];
  assert.equal(edited.slice(edit.from, edit.to), "output");
  assert.equal(
    edited.slice(0, edit.from) + edit.insert + edited.slice(edit.to),
    edited.replace("output", "OUTPUT"),
  );
});

test("editing normalized punctuation retains a safe whole-document quick fix", () => {
  const original = "DECLARE X:INTEGER\nX ← 1\nOUTPUT X";
  const edited = original.replace("X ← 1", "X <- 2");
  const service = new LanguageService();
  service.update(original, "0478");
  const diagnostic = service
    .update(edited, "0478")
    .diagnostics.find((d) => d.code === "NORMALIZED");
  assert.ok(diagnostic);
  assert.deepEqual(diagnostic.actions![0].edits, [
    { from: 0, to: edited.length, insert: edited.replace("<-", "←") },
  ]);
});

test("signature parameter index excludes array subscript commas", () => {
  assert.equal(
    signatureHelp("OUTPUT MID(A[1,2],", "9618-AS")?.activeParameter,
    1,
  );
  assert.equal(
    signatureHelp("OUTPUT MID(A[1,2", "9618-AS")?.activeParameter,
    0,
  );
  assert.equal(
    signatureHelp('OUTPUT MID("abc", 1,', "9618-AS")?.activeParameter,
    2,
  );
});

test("trace repeated values are compared with the preceding visible filtered row", () => {
  const { events } = run("DECLARE I:INTEGER\nFOR I ← 1 TO 2\nOUTPUT I\nNEXT I");
  const table = traceRows(events, { policy: "loops", hideRepeated: true });
  assert.deepEqual(
    table.rows.map((r) => r.variables.I),
    ["1", "2"],
  );
});
