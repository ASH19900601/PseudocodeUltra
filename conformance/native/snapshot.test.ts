import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { transpile, type Target } from "../../core/transpile";
import { run } from "../../core/runtime";
const defs = `TYPE Season=(Spring,Summer)
TYPE Letters=SET OF CHAR
TYPE NumberPointer=^INTEGER
TYPE Item
DECLARE Name:STRING
DECLARE When:DATE
DECLARE Values:ARRAY[-1:0] OF INTEGER
DECLARE Mode:Season
DECLARE Tags:Letters
DECLARE Ref:NumberPointer
ENDTYPE
`;
const initialized = run(
  defs +
    `DECLARE A:Item
DECLARE X:INTEGER
X ← 42
A.Name ← "Alex"
A.When ← 01/02/2024
A.Values[-1] ← 5
A.Mode ← Summer
DEFINE Tags('A','B'):Letters
A.Tags ← Tags
A.Ref ← ^X
OPENFILE "records" FOR RANDOM
PUTRECORD "records",A
CLOSEFILE "records"`,
  "9618-A2",
);
const files = structuredClone(initialized.files),
  source =
    defs +
    `DECLARE A:Item
OPENFILE "records" FOR RANDOM
GETRECORD "records",A
CLOSEFILE "records"
A.Ref^ ← A.Ref^ + 1
OUTPUT A.Name,":",A.When,":",A.Values[-1],":",A.Mode,":",A.Tags,":",A.Ref^`;
for (const target of ["python", "java", "vb"] as Target[])
  test(`native ${target} embeds persistent random-file object graphs`, () => {
    const code = transpile(source, "9618-A2", target, { files }),
      expected = run(source, "9618-A2", [], { files }).output.join("\n") + "\n",
      dir = mkdtempSync(join(tmpdir(), "snapshot-export-"));
    const exec = (cmd: string, args: string[]) => {
      const r = spawnSync(cmd, args, {
        cwd: dir,
        encoding: "utf8",
        timeout: 60000,
        env: {
          ...process.env,
          DOTNET_CLI_HOME: "/tmp/dotnet-home",
          DOTNET_CLI_TELEMETRY_OPTOUT: "1",
        },
      });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      return r.stdout;
    };
    if (target === "python") {
      writeFileSync(join(dir, "main.py"), code);
      assert.equal(exec("python", ["main.py"]), expected);
    } else if (target === "java") {
      writeFileSync(join(dir, "Main.java"), code);
      exec("java", [
        "-jar",
        process.env.ECJ_JAR || "/workspace/.tools/ecj.jar",
        "-17",
        "Main.java",
      ]);
      assert.equal(exec("java", ["Main"]), expected);
    } else {
      writeFileSync(join(dir, "Program.vb"), code);
      writeFileSync(
        join(dir, "export.vbproj"),
        '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
      );
      const dotnet =
        process.env.DOTNET_BIN || "/workspace/.tools/dotnet/dotnet";
      exec(dotnet, ["build", "-v:q", "--nologo", "--ignore-failed-sources"]);
      assert.equal(exec(dotnet, ["bin/Debug/net8.0/export.dll"]), expected);
    }
  });
