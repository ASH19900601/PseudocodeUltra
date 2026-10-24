import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const tools = resolve(
  process.env.PSEUDO_TOOLS_DIR ||
    (process.platform === "win32" ? ".tools" : "/workspace/.tools"),
);
const executable = (name: string, fallback: string) => {
  const local = join(
    tools,
    name,
    "bin",
    name + (process.platform === "win32" ? ".exe" : ""),
  );
  return existsSync(local) ? local : fallback;
};
const localDotnet = join(
  tools,
  "dotnet",
  "dotnet" + (process.platform === "win32" ? ".exe" : ""),
);
export const toolchains = {
  python: process.env.PYTHON_BIN || "python",
  java: process.env.JAVA_BIN || executable("java", "java"),
  ecj: process.env.ECJ_JAR || join(tools, "ecj.jar"),
  dotnet:
    process.env.DOTNET_BIN ||
    (existsSync(localDotnet) ? localDotnet : "dotnet"),
};
export const nativeEnvironment = {
  ...process.env,
  DOTNET_CLI_HOME: join(tmpdir(), "pseudocode-dotnet-home"),
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
  DOTNET_CLI_TELEMETRY_OPTOUT: "1",
  DOTNET_NOLOGO: "1",
  PYTHONIOENCODING: "utf-8",
};
export const normalizeOutput = (text: string) => text.replace(/\r\n/g, "\n");
