#!/usr/bin/env bash
set -euo pipefail
cd /workspace/PesudocodeUltra
node --version
npm ci --cache /workspace/.cache/npm
npm run setup:toolchains
npm run build
