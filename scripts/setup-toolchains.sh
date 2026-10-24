#!/usr/bin/env bash
# Optional native-export acceptance toolchains. Never changes OS packages.
set -euo pipefail
TOOLS_DIR="${PSEUDO_TOOLS_DIR:-/workspace/.tools}"
mkdir -p "$TOOLS_DIR"
if [ ! -f "$TOOLS_DIR/ecj.jar" ]; then
  curl -fLsS --retry 2 https://repo.maven.apache.org/maven2/org/eclipse/jdt/ecj/3.40.0/ecj-3.40.0.jar -o "$TOOLS_DIR/ecj.jar.download"
  curl -fLsS https://repo.maven.apache.org/maven2/org/eclipse/jdt/ecj/3.40.0/ecj-3.40.0.jar.sha1 -o "$TOOLS_DIR/ecj.sha1"
  python - "$TOOLS_DIR" <<'PY'
import hashlib,sys,pathlib
p=pathlib.Path(sys.argv[1])
# Maven Central publishes SHA-1 for this artifact; transport still uses verified TLS.
assert hashlib.file_digest((p/'ecj.jar.download').open('rb'),'sha1').hexdigest()==(p/'ecj.sha1').read_text().strip()
(p/'ecj.jar.download').rename(p/'ecj.jar')
PY
fi
if [ ! -x "$TOOLS_DIR/dotnet/dotnet" ]; then
  curl -fLsS --retry 2 https://builds.dotnet.microsoft.com/dotnet/Sdk/8.0.100/dotnet-sdk-8.0.100-linux-x64.tar.gz -o "$TOOLS_DIR/dotnet-sdk.tar.gz"
  curl -fLsS https://builds.dotnet.microsoft.com/dotnet/release-metadata/8.0/releases.json -o "$TOOLS_DIR/dotnet-releases.json"
  python - "$TOOLS_DIR" <<'PY'
import json,hashlib,sys,pathlib
p=pathlib.Path(sys.argv[1]);j=json.loads((p/'dotnet-releases.json').read_text())
s=next(s for r in j['releases'] for s in r.get('sdks',[]) if s['version']=='8.0.100')
f=next(f for f in s['files'] if f['rid']=='linux-x64' and f['name'].endswith('.tar.gz'))
assert hashlib.file_digest((p/'dotnet-sdk.tar.gz').open('rb'),'sha512').hexdigest()==f['hash'].lower()
PY
  mkdir -p "$TOOLS_DIR/dotnet"
  tar -xzf "$TOOLS_DIR/dotnet-sdk.tar.gz" -C "$TOOLS_DIR/dotnet"
  rm "$TOOLS_DIR/dotnet-sdk.tar.gz"
fi
java -version
"$TOOLS_DIR/dotnet/dotnet" --version
