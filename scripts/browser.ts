import { existsSync } from "node:fs";
import { join } from "node:path";

// Prefer the explicitly selected browser, then an installed Chromium browser.
// With no system browser, Playwright uses its own downloaded Chromium.
export function browserExecutable(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const candidates =
    process.platform === "win32"
      ? [
          join(
            process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)",
            "Microsoft/Edge/Application/msedge.exe",
          ),
          join(
            process.env.ProgramFiles || "C:/Program Files",
            "Microsoft/Edge/Application/msedge.exe",
          ),
          join(
            process.env.ProgramFiles || "C:/Program Files",
            "Google/Chrome/Application/chrome.exe",
          ),
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : [
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/google-chrome",
          ];
  return candidates.find(existsSync);
}
