import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSettings,
  settingChoice,
  settingInteger,
  storedPolicies,
  exportFiles,
  importFiles,
} from "../web/storage";
import { run } from "../core/runtime";
import { defaultPolicies } from "../core/policies";

test("blocked localStorage still supports session edits and reports failure once", () => {
  let failures = 0;
  const settings = createSettings(
    () => {
      throw new Error("SecurityError");
    },
    () => failures++,
  );
  assert.equal(settings.getItem("source"), null);
  assert.equal(settings.setItem("source", ""), false);
  assert.equal(settings.getItem("source"), "");
  assert.equal(settings.setItem("source", "OUTPUT 1"), false);
  assert.equal(settings.getItem("source"), "OUTPUT 1");
  assert.equal(settings.persistent, false);
  assert.equal(failures, 1);
});
test("quota errors preserve the newest session source rather than the last disk value", () => {
  const settings = createSettings(() => ({
    getItem: () => "old",
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  }));
  assert.equal(settings.getItem("source"), "old");
  settings.setItem("source", "new");
  assert.equal(settings.getItem("source"), "new");
});
test("empty persisted source remains an intentional empty document", () => {
  const settings = createSettings(() => ({
    getItem: () => "",
    setItem: () => {},
  }));
  assert.equal(settings.getItem("source") ?? "default example", "");
});
test("invalid persisted settings use valid choices and integer limits", () => {
  assert.equal(
    settingChoice("corrupted", ["exam", "learning"] as const, "exam"),
    "exam",
  );
  assert.equal(
    settingChoice("learning", ["exam", "learning"] as const, "exam"),
    "learning",
  );
  for (const value of [null, "", " ", "NaN", "Infinity", "1.5", "-1", "1001"])
    assert.equal(settingInteger(value, 42, 0, 1000), 42, String(value));
  assert.equal(settingInteger("0", 42, 0, 1000), 0);
  assert.equal(settingInteger("1000", 42, 0, 1000), 1000);
});
test("malformed persisted policy values cannot silently change runtime semantics", () => {
  for (const value of ["{", "null", "[]", '"string"'])
    assert.deepEqual(storedPolicies(value), defaultPolicies);
  const policies = storedPolicies(
    JSON.stringify({
      shortCircuit: "false",
      roundHalf: "evil",
      divNegative: "floor",
      booleanOutput: "lower",
      extra: "value",
    }),
  );
  assert.equal(policies.shortCircuit, true);
  assert.equal(policies.roundHalf, "away");
  assert.equal(policies.divNegative, "floor");
  assert.equal(policies.booleanOutput, "lower");
  assert.equal(Object.hasOwn(policies, "extra"), false);
});
test("virtual-file backups round-trip text, maps, sets, aliases, undefined and pointer cycles", () => {
  const cell: any = { type: "INTEGER", value: undefined };
  const record: any = {
    tag: "object",
    scope: {
      vars: new Map([
        ["A", cell],
        ["B", cell],
      ]),
      parent: undefined,
    },
    tags: new Set(["X", "Y"]),
  };
  cell.value = { tag: "pointer", cell };
  const files = importFiles(
    exportFiles({
      ["__proto__"]: { text: "ordinary filename" },
      records: { text: "", records: { "1": record } },
    }),
  );
  assert.equal(Object.hasOwn(files, "__proto__"), true);
  assert.equal(files["__proto__"].text, "ordinary filename");
  const restored = files.records.records!["1"];
  assert.ok(restored.scope.vars instanceof Map);
  assert.ok(restored.tags instanceof Set);
  assert.deepEqual([...restored.tags], ["X", "Y"]);
  const a = restored.scope.vars.get("A"),
    b = restored.scope.vars.get("B");
  assert.equal(a, b);
  assert.equal(a.value.cell, a);
  assert.equal(restored.scope.parent, undefined);
});
test("restored random-file backup can execute records with arrays, dates, sets and pointers", () => {
  const defs = `TYPE Tags=SET OF CHAR\nTYPE Ptr=^INTEGER\nTYPE R\nDECLARE Values:ARRAY[-1:0] OF INTEGER\nDECLARE When:DATE\nDECLARE Letters:Tags\nDECLARE Ref:Ptr\nENDTYPE\n`;
  const files = run(
    defs +
      `DECLARE A:R\nDECLARE X:INTEGER\nX ← 42\nA.Values[-1] ← 5\nA.When ← 01/02/2024\nDEFINE Letters('A','B'):Tags\nA.Letters ← Letters\nA.Ref ← ^X\nOPENFILE "records" FOR RANDOM\nPUTRECORD "records",A\nCLOSEFILE "records"`,
    "9618-A2",
  ).files;
  const restored = importFiles(exportFiles(files));
  const result = run(
    defs +
      `DECLARE A:R\nOPENFILE "records" FOR RANDOM\nGETRECORD "records",A\nCLOSEFILE "records"\nA.Ref^ ← A.Ref^+1\nOUTPUT A.Values[-1],":",A.When,":",A.Letters,":",A.Ref^`,
    "9618-A2",
    [],
    { files: restored },
  );
  assert.deepEqual(result.output, ["5:01/02/2024:{A, B}:43"]);
});
test("invalid backup roots, references and versions are rejected before restoring files", () => {
  for (const source of [
    "{}",
    '{"format":"pseudocode-ultra-files","version":2,"objects":[]}',
    '{"format":"pseudocode-ultra-files","version":1,"objects":[],"root":{"ref":4}}',
    '{"format":"pseudocode-ultra-files","version":1,"objects":[],"root":null}',
  ])
    assert.throws(() => importFiles(source));
});
