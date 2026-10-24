import { defineConfig } from "@playwright/test";
import { browserExecutable } from "./scripts/browser";
export default defineConfig({
  testDir: "./conformance/browser",
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true,
    launchOptions: {
      executablePath: browserExecutable(),
      args: process.platform === "linux" ? ["--no-sandbox"] : [],
    },
  },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
  },
  reporter: "list",
});
