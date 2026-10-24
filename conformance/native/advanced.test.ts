import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { transpile, type Target } from "../../core/transpile";
import { run } from "../../core/runtime";
const programs: Record<string, string> = {
  "formal-bounds-case-return-and-value-equality": `TYPE E=(One,Two)
TYPE Es=SET OF E
TYPE P=^INTEGER
CONSTANT Limit = 3
PROCEDURE Change(N:INTEGER,BYREF Data:ARRAY[1:N] OF INTEGER)
Data[1] ← 9
ENDPROCEDURE
FUNCTION Choose(K:INTEGER) RETURNS INTEGER
CASE OF K
1 : RETURN 1
OTHERWISE : RETURN 99
ENDCASE
OUTPUT 777
ENDFUNCTION
DECLARE A:ARRAY[1:Limit] OF INTEGER
A[1] ← 2
CALL Change(Limit,A)
DEFINE S(One,Two,One):Es
DEFINE T(Two,One):Es
DECLARE X:INTEGER
DECLARE R,Q:P
X ← 3
R ← ^X
Q ← R
OUTPUT A[1],Choose(2),S=T,R=Q`,

  "private-shadow-and-initializers": `CLASS Base
PRIVATE Value:INTEGER
Value ← 3
PUBLIC PROCEDURE NEW()
ENDPROCEDURE
PRIVATE FUNCTION Hidden() RETURNS INTEGER
RETURN Value
ENDFUNCTION
PUBLIC FUNCTION ReadBase() RETURNS INTEGER
RETURN Hidden()
ENDFUNCTION
ENDCLASS
CLASS Middle INHERITS Base
PRIVATE Value:INTEGER
Value ← 7
PUBLIC PROCEDURE NEW()
SUPER.NEW()
ENDPROCEDURE
PRIVATE FUNCTION Hidden() RETURNS INTEGER
RETURN Value
ENDFUNCTION
PUBLIC FUNCTION ReadMiddle() RETURNS INTEGER
RETURN Hidden()
ENDFUNCTION
ENDCLASS
CLASS Child INHERITS Middle
PUBLIC PROCEDURE NEW()
SUPER.NEW()
ENDPROCEDURE
ENDCLASS
DECLARE C:Child
C ← NEW Child()
OUTPUT C.ReadBase(), C.ReadMiddle()`,
  "enum-ordinal-array-rebasing": `TYPE Season=(Spring,Summer,Autumn,Winter)
TYPE Ptr=^Season
DECLARE S:Season
DECLARE P:Ptr
S ← Spring
P ← ^S
P^ ← P^ + 1
DECLARE A:ARRAY[1:2] OF INTEGER
DECLARE B:ARRAY[0:1] OF INTEGER
B[0] ← 8
B[1] ← 9
A ← B
PROCEDURE Change(BYVAL X:ARRAY[4:5] OF INTEGER)
X[4] ← 0
OUTPUT X[5]
ENDPROCEDURE
CALL Change(A)
OUTPUT S, S>Spring, Winter-Spring, A[1], A[2]`,
  "records-date-arrays": `TYPE Student
DECLARE Name:STRING
DECLARE Birthday:DATE
DECLARE Values:ARRAY[-1:1] OF REAL
ENDTYPE
PROCEDURE Update(BYREF P:Student)
P.Name ← "Updated"
P.Values[-1] ← 2.5
ENDPROCEDURE
DECLARE A,B:Student
A.Name ← "Alice"
A.Birthday ← 09/05/2008
A.Values[-1] ← 1.5
B ← A
CALL Update(A)
DECLARE Students:ARRAY[1:2] OF Student
Students[1] ← B
OUTPUT A.Name, ":", B.Name, ":", B.Values[-1], ":", DAY(B.Birthday), ":", Students[1].Name`,
  "enums-pointer-sets": `TYPE Season = (Spring,Summer,Autumn,Winter)
TYPE NumberPointer = ^INTEGER
TYPE Numbers = SET OF INTEGER
DECLARE S:Season
S ← Summer
DECLARE X:INTEGER
X ← 4
DECLARE P:NumberPointer
P ← ^X
P^ ← P^ + 3
DEFINE A(1,2,3):Numbers
DEFINE B(3,4):Numbers
DECLARE C:Numbers
C ← A+B
OUTPUT S, ":", X, ":", C
C ← A*B
OUTPUT C
C ← A-B
OUTPUT C`,
  "text-random-files": `TYPE Entry
DECLARE Name:STRING
DECLARE Score:INTEGER
ENDTYPE
DECLARE A,B:Entry
A.Name ← "Alice"
A.Score ← 9
OPENFILE "scores" FOR RANDOM
SEEK "scores", 3
PUTRECORD "scores", A
A.Score ← 2
SEEK "scores", 3
GETRECORD "scores", B
CLOSEFILE "scores"
OPENFILE "names" FOR WRITE
WRITEFILE "names", B.Name
CLOSEFILE "names"
OPENFILE "names" FOR APPEND
WRITEFILE "names", "Bob"
CLOSEFILE "names"
DECLARE Line:STRING
OPENFILE "names" FOR READ
WHILE NOT EOF("names")
READFILE "names", Line
OUTPUT Line
ENDWHILE
CLOSEFILE "names"
OUTPUT B.Score`,
  "oop-inheritance-dispatch": `CLASS Base
PRIVATE Name:STRING
PUBLIC PROCEDURE NEW(N:STRING)
Name ← N
ENDPROCEDURE
PUBLIC FUNCTION GetName() RETURNS STRING
RETURN Name
ENDFUNCTION
PUBLIC FUNCTION Describe() RETURNS STRING
RETURN "base"
ENDFUNCTION
ENDCLASS
CLASS Child INHERITS Base
PRIVATE Count:INTEGER
PUBLIC PROCEDURE NEW(N:STRING)
SUPER.NEW(N)
Count ← 0
ENDPROCEDURE
PUBLIC PROCEDURE Increment()
Count ← Count+1
ENDPROCEDURE
PUBLIC FUNCTION GetCount() RETURNS INTEGER
RETURN Count
ENDFUNCTION
PUBLIC FUNCTION Describe() RETURNS STRING
RETURN "child"
ENDFUNCTION
ENDCLASS
PROCEDURE Inc(BYVAL C:Child)
C.Increment()
ENDPROCEDURE
DECLARE C:Child
C ← NEW Child("Alex")
CALL Inc(C)
DECLARE B:Base
B ← C
OUTPUT C.GetName(), ":", C.GetCount(), ":", B.Describe()`,
  "all-insert-builtins": `DECLARE D:DATE
D ← SETDATE(9,5,2023)
OUTPUT LEFT("Hello",2),RIGHT("Hello",2),MID("Hello",2,3), LENGTH("Hello"),UCASE('a'),LCASE('B'),TO_UPPER("hi"),TO_LOWER("OK")
OUTPUT NUM_TO_STR(12.5), STR_TO_NUM("4.5"),IS_NUM("x"),ASC('A'),CHR(66),INT(-2.9), INT(RAND(10))
OUTPUT DAY(D),MONTH(D),YEAR(D),DAYINDEX(D),DAY(TODAY())`,
};
const dotnet = process.env.DOTNET_BIN || "/workspace/.tools/dotnet/dotnet";
function execute(cmd: string, args: string[], cwd: string) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    timeout: 60000,
    env: {
      ...process.env,
      DOTNET_CLI_HOME: "/tmp/dotnet-home",
      DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
      DOTNET_CLI_TELEMETRY_OPTOUT: "1",
    },
  });
  assert.equal(r.status, 0, r.stdout + "\n" + r.stderr);
  return r.stdout;
}
for (const [name, source] of Object.entries(programs))
  for (const target of ["python", "java", "vb"] as Target[])
    test(`M4 native ${target}: ${name}`, () => {
      const dir = mkdtempSync(join(tmpdir(), "pseudo-complex-"));
      const opts = { seed: 42, clock: "2026-10-24" };
      const expected =
        run(source, "9618-A2", [], opts).output.join("\n") + "\n";
      const code = transpile(source, "9618-A2", target, opts);
      if (target === "python") {
        writeFileSync(join(dir, "main.py"), code);
        assert.equal(execute("python", ["main.py"], dir), expected);
      } else if (target === "java") {
        writeFileSync(join(dir, "Main.java"), code);
        execute(
          "java",
          [
            "-jar",
            process.env.ECJ_JAR || "/workspace/.tools/ecj.jar",
            "-17",
            "Main.java",
          ],
          dir,
        );
        assert.equal(execute("java", ["Main"], dir), expected);
      } else {
        writeFileSync(join(dir, "Program.vb"), code);
        writeFileSync(
          join(dir, "export.vbproj"),
          '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
        );
        execute(
          dotnet,
          ["build", "--nologo", "-v:q", "--ignore-failed-sources"],
          dir,
        );
        assert.equal(
          execute(dotnet, ["bin/Debug/net8.0/export.dll"], dir),
          expected,
        );
      }
    });
