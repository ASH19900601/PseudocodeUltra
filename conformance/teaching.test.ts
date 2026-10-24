import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { run } from "../core/runtime";
import { traceRows, csv, xlsx, gradeTrace } from "../core/trace";
import { flowchart, format } from "../core/tools";
import { LanguageDocument, rename } from "../core/language";
import { LanguageService } from "../core/language-service";
test("trace policies include module, loop and branch events with stable snapshots", () => {
  const source =
    "PROCEDURE P(X:INTEGER)\nIF X>0 THEN\nOUTPUT X\nENDIF\nENDPROCEDURE\nDECLARE I:INTEGER\nFOR I ← 1 TO 2\nCALL P(I)\nNEXT I";
  const r = run(source);
  for (const policy of [
    "all",
    "changes",
    "modules",
    "loops",
    "branches",
    "left-to-right",
  ] as const) {
    const data = traceRows(r.events, { policy });
    assert.ok(data.rows.length > 0, policy);
  }
  const moduleRows = traceRows(r.events, { policy: "modules" });
  assert.ok(moduleRows.rows.some((r) => r.stack === "P"));
  assert.ok(moduleRows.columns.includes("X"));
  const first = r.events.find((e) => e.variables?.I === "1");
  assert.equal(first?.variables?.I, "1");
});
test("trace fill-in marks each cell and CSV/Excel preserve complex values", () => {
  const { rows, columns } = traceRows(
    run(
      "TYPE R\nDECLARE X:INTEGER\nENDTYPE\nDECLARE A:R\nA.X ← 3\nOUTPUT A.X",
      "9618-AS",
    ).events,
  );
  assert.ok(csv(rows, columns).includes("X: 3"));
  const attempts = Object.fromEntries(
    rows.flatMap((r, i) => columns.map((c) => [i + ":" + c, r.variables[c]])),
  );
  assert.ok(gradeTrace(rows, columns, attempts).every((c) => c.correct));
  attempts["0:" + columns[0]] = "wrong";
  assert.ok(gradeTrace(rows, columns, attempts).some((c) => !c.correct));
  const dir = mkdtempSync(join(tmpdir(), "trace-xlsx-")),
    path = join(dir, "trace.xlsx");
  writeFileSync(path, xlsx(rows, columns));
  const check = spawnSync(
    "python",
    [
      "-c",
      'import zipfile,sys,xml.etree.ElementTree as E\nz=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None\nfor n in z.namelist():E.fromstring(z.read(n))\ns=E.fromstring(z.read("xl/worksheets/sheet1.xml"));assert len(s.find("{*}sheetData"))>1',
      path,
    ],
    { encoding: "utf8" },
  );
  assert.equal(check.status, 0, check.stderr);
});
test("module and method flowcharts include return edges and post-condition loops", () => {
  const source =
    "FUNCTION F(X:INTEGER) RETURNS INTEGER\nIF X>0 THEN\nRETURN X\nELSE\nRETURN 0\nENDIF\nENDFUNCTION\nOUTPUT F(1)";
  const chart = flowchart(source, "0478", "F");
  assert.ok(chart.modules.includes("F"));
  assert.equal(chart.edges.filter((e) => e.label === "RETURN").length, 2);
  const repeat = flowchart(
    "DECLARE X:INTEGER\nX ← 0\nREPEAT\nX ← X+1\nUNTIL X=2",
    "0478",
  );
  const body = repeat.nodes.find((n) => n.label === "X ← X+1")!,
    cond = repeat.nodes.find((n) => n.label.startsWith("UNTIL"))!;
  assert.ok(body.id < cond.id);
  assert.ok(
    repeat.edges.some(
      (e) => e.from === cond.id && e.to < body.id && e.label === "FALSE",
    ),
  );
});
test("class formatting retains method scopes and two-space ELSE/CASE clauses", () => {
  const source =
    "CLASS C\nPUBLIC PROCEDURE NEW()\nIF TRUE THEN\nOUTPUT 1\nELSE\nOUTPUT 2\nENDIF\nENDPROCEDURE\nENDCLASS";
  const pretty = format(source, "9618-A2");
  assert.match(pretty, /\n {8}ELSE\n {9}OUTPUT 2/);
  assert.equal(format(pretty, "9618-A2"), pretty);
});
test("field rename handles two record types and preserves unrelated bindings", () => {
  const source =
    "TYPE First\nDECLARE Value:INTEGER\nENDTYPE\nTYPE Second\nDECLARE Value:INTEGER\nENDTYPE\nDECLARE A:First\nDECLARE B:Second\nA.Value ← 1\nB.Value ← 2\nOUTPUT A.Value,B.Value";
  const doc = new LanguageDocument(source, "9618-AS"),
    at = source.indexOf("A.Value") + 2;
  const result = doc.rename(at, "Score");
  assert.match(result, /A.Score ← 1/);
  assert.match(result, /B.Value ← 2/);
  assert.deepEqual(run(result, "9618-AS").output, ["12"]);
});
test("rename rejects variable capture across scopes", () => {
  const source =
    "DECLARE X:INTEGER\nPROCEDURE P(Y:INTEGER)\nOUTPUT X+Y\nENDPROCEDURE\nX ← 1\nCALL P(2)";
  const doc = new LanguageDocument(source, "9618-AS");
  assert.throws(
    () => doc.rename(source.indexOf("X:INTEGER"), "Y"),
    /capture|冲突/,
  );
});
test("incremental diagnostics update only edited unit and invalidate declarations", () => {
  const service = new LanguageService();
  const first = "DECLARE X:INTEGER\nX ← 1\nOUTPUT X";
  assert.equal(service.update(first, "0478").incremental, false);
  const changed = service.update(first.replace("X ← 1", 'X ← "bad"'), "0478");
  assert.equal(changed.incremental, true);
  assert.ok(changed.diagnostics.some((d) => d.code === "TYPE_MISMATCH"));
  const restored = service.update(first, "0478");
  assert.deepEqual(restored.diagnostics, []);
  assert.equal(
    service.update(first.replace("INTEGER", "STRING"), "0478").incremental,
    false,
  );
});
test("incremental analysis retains transitive custom types and invalidates structural edits", () => {
  const source =
    "TYPE R\nDECLARE Value:INTEGER\nENDTYPE\nDECLARE A:R\nA.Value ← 1\nOUTPUT A.Value";
  const service = new LanguageService();
  service.update(source, "9618-AS");
  const changed = service.update(
    source.replace("A.Value ← 1", "A.Value ← 2"),
    "9618-AS",
  );
  assert.ok(changed.incremental);
  assert.deepEqual(changed.diagnostics, []);
  const structural = service.update(
    source.replace("A.Value ← 1", "IF TRUE THEN"),
    "9618-AS",
  );
  assert.equal(structural.incremental, false);
  assert.ok(structural.diagnostics.some((d) => d.message.includes("ENDIF")));
});
test("member completions respect private access and signature help tracks commas", async () => {
  const { completionItems, signatureHelp } = await import("../core/language");
  const source =
    "CLASS C\nPRIVATE Secret:INTEGER\nPUBLIC Value:INTEGER\nPUBLIC PROCEDURE NEW()\nENDPROCEDURE\nENDCLASS\nDECLARE Obj:C\nObj ← NEW C()\nOUTPUT Obj.";
  const items = completionItems(source, "9618-A2", source.length);
  assert.ok(items.some((i) => i.label.toUpperCase() === "VALUE"));
  assert.ok(!items.some((i) => i.label.toUpperCase() === "SECRET"));
  assert.equal(
    signatureHelp('OUTPUT MID("abc", 1,', "9618-AS")?.activeParameter,
    2,
  );
  assert.ok(
    signatureHelp('OUTPUT MID("abc', "9618-AS")?.label.startsWith("MID"),
  );
});
