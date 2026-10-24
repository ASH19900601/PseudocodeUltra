import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { toolchains, nativeEnvironment, normalizeOutput } from "./helpers";
import { transpile, type Target } from "../../core/transpile";
import { run } from "../../core/runtime";
const source = `PROCEDURE Bump(BYREF X:INTEGER)
X ← X + 1
ENDPROCEDURE
FUNCTION Fact(N:INTEGER) RETURNS INTEGER
IF N = 0 THEN
RETURN 1
ELSE
RETURN N * Fact(N-1)
ENDIF
ENDFUNCTION
DECLARE X, I, Total : INTEGER
DECLARE A, B : ARRAY[-1:1] OF INTEGER
X ← 4
CALL Bump(X)
A[-1] ← 7
B ← A
A[-1] ← 9
Total ← 0
FOR I ← 3 TO 1 STEP -1
Total ← Total + I
NEXT I
WHILE X < 7
X ← X+1
ENDWHILE
REPEAT
X ← X-1
UNTIL X = 5
CASE OF X
1 TO 4 : OUTPUT "bad"
5 : OUTPUT "yes"
OTHERWISE : OUTPUT "bad"
ENDCASE
OUTPUT X, ":", Total, ":", Fact(5), ":", B[-1], ":", -7 DIV 3, ":", -7 MOD 3, ":", TO_UPPER("hi")
DECLARE Name:STRING
INPUT Name
OUTPUT Name`;
const expected = run(source, "9618-AS", ["0123"]).output.join("\n") + "\n";
const dir = mkdtempSync(join(tmpdir(), "pseudo-export-"));
function execute(cmd: string, args: string[], cwd = dir) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    input: "0123\n",
    timeout: 60000,
    env: {
      ...process.env,
      ...nativeEnvironment,
      DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
      DOTNET_CLI_TELEMETRY_OPTOUT: "1",
    },
  });
  assert.equal(r.status, 0, r.stdout + "\n" + r.stderr);
  return normalizeOutput(r.stdout);
}
test("M4 Python native compilation and equivalent output", () => {
  writeFileSync(join(dir, "main.py"), transpile(source, "9618-AS", "python"));
  assert.equal(execute(toolchains.python, ["main.py"]), expected);
});
test("M4 Java native compilation and equivalent output", () => {
  writeFileSync(join(dir, "Main.java"), transpile(source, "9618-AS", "java"));
  execute(toolchains.java, ["-jar", toolchains.ecj, "-17", "Main.java"]);
  assert.equal(execute(toolchains.java, ["Main"]), expected);
});
test("M4 VB.NET native compilation and equivalent output", () => {
  writeFileSync(join(dir, "Program.vb"), transpile(source, "9618-AS", "vb"));
  writeFileSync(
    join(dir, "export.vbproj"),
    '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><RootNamespace>ExportTest</RootNamespace></PropertyGroup></Project>',
  );
  execute(toolchains.dotnet, [
    "build",
    "export.vbproj",
    "--nologo",
    "-v:q",
    "--ignore-failed-sources",
  ]);
  assert.equal(
    execute(toolchains.dotnet, ["bin/Debug/net8.0/export.dll"]),
    expected,
  );
});
test("export rejects malformed AST input with source location", () => {
  for (const t of ["python", "java", "vb"] as Target[])
    assert.throws(
      () => transpile("OUTPUT (", "9618-AS", t),
      (e: any) => e.code === "PARSE_EXPR" && e.line === 1,
    );
});
