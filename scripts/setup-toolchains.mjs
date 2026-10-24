import { spawnSync } from "node:child_process";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  cpSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { resolve, join } from "node:path";

if (process.platform !== "win32") {
  const result = spawnSync("bash", ["scripts/setup-toolchains.sh"], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}
const tools = resolve(process.env.PSEUDO_TOOLS_DIR || ".tools");
mkdirSync(tools, { recursive: true });
async function response(url) {
  const result = await fetch(url, { signal: AbortSignal.timeout(600000) });
  if (!result.ok) throw new Error(`${url}: HTTP ${result.status}`);
  return result;
}
async function download(url, filename, algorithm, expected) {
  const target = join(tools, filename);
  async function checksum() {
    const hash = createHash(algorithm);
    for await (const chunk of createReadStream(target)) hash.update(chunk);
    return hash.digest("hex");
  }
  if (existsSync(target) && (await checksum()) === expected.trim().toLowerCase())
    return target;
  console.log(`Downloading ${filename}`);
  await pipeline(
    Readable.fromWeb((await response(url)).body),
    createWriteStream(target),
  );
  if ((await checksum()) !== expected.trim().toLowerCase()) {
    rmSync(target);
    throw new Error(`Checksum mismatch for ${filename}`);
  }
  return target;
}
function extract(archive, destination) {
  mkdirSync(destination, { recursive: true });
  const result = spawnSync("tar.exe", ["-xf", archive, "-C", destination], {
    stdio: "inherit",
  });
  if (result.error || result.status !== 0)
    throw new Error(result.error?.message || "Archive extraction failed");
  rmSync(archive);
}
if (!existsSync(join(tools, "java/bin/java.exe"))) {
  const staging = join(tools, "java-extract");
  if (!existsSync(staging)) {
    const assets = await (
      await response(
        "https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse",
      )
    ).json();
    const pkg = assets[0].binary.package;
    const archive = await download(
      pkg.link,
      "java.zip",
      "sha256",
      pkg.checksum,
    );
    extract(archive, staging);
  }
  const directory = readdirSync(staging, { withFileTypes: true }).find((item) =>
    item.isDirectory(),
  );
  if (!directory) throw new Error("Java archive contains no runtime");
  cpSync(join(staging, directory.name), join(tools, "java"), {
    recursive: true,
  });
}
if (!existsSync(join(tools, "ecj.jar"))) {
  const url =
    "https://repo.maven.apache.org/maven2/org/eclipse/jdt/ecj/3.40.0/ecj-3.40.0.jar";
  const digest = await (await response(url + ".sha1")).text();
  await download(url, "ecj.jar", "sha1", digest);
}
if (!existsSync(join(tools, "dotnet/dotnet.exe"))) {
  const releases = await (
    await response(
      "https://builds.dotnet.microsoft.com/dotnet/release-metadata/8.0/releases.json",
    )
  ).json();
  const sdk = releases.releases.find((release) => release.sdk)?.sdk;
  const pkg = sdk.files.find(
    (file) => file.rid === "win-x64" && file.name.endsWith(".zip"),
  );
  const archive = await download(pkg.url, "dotnet.zip", "sha512", pkg.hash);
  extract(archive, join(tools, "dotnet"));
}
for (const [name, args] of [
  ["java/bin/java.exe", ["-version"]],
  ["dotnet/dotnet.exe", ["--version"]],
]) {
  const result = spawnSync(join(tools, name), args, { stdio: "inherit" });
  if (result.error || result.status !== 0)
    throw new Error(result.error?.message || `Cannot execute ${name}`);
}
console.log(`Native test toolchains ready: ${tools}`);
