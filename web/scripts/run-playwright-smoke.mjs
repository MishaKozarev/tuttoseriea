import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const hostname = "127.0.0.1";
const port = "3100";
const baseUrl = `http://${hostname}:${port}`;
const nextBin = resolve(appDirectory, "node_modules", "next", "dist", "bin", "next");
const playwrightBin = resolve(
  appDirectory,
  "node_modules",
  "@playwright",
  "test",
  "cli.js",
);

function spawnNodeScript(scriptPath, args, options = {}) {
  return spawn(process.execPath, [scriptPath, ...args], {
    cwd: appDirectory,
    env: process.env,
    stdio: "inherit",
    ...options,
  });
}

function stopProcessTree(child) {
  if (child.killed || child.exitCode !== null) {
    return;
  }

  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    });
    return;
  }

  child.kill("SIGTERM");
}

async function waitForHealth() {
  const healthUrl = `${baseUrl}/api/health`;

  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const response = await fetch(healthUrl);

      if (response.ok) {
        return;
      }
    } catch {
      // The dev server is still starting.
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  }

  throw new Error(`Timed out waiting for ${healthUrl}`);
}

function runPlaywright() {
  return new Promise((resolve) => {
    const child = spawnNodeScript(playwrightBin, ["test", "--config", "playwright.config.ts"], {
      env: {
        ...process.env,
        WEB_SMOKE_BASE_URL: baseUrl,
      },
    });

    child.on("exit", (code) => {
      resolve(code ?? 1);
    });
  });
}

const nextProcess = spawnNodeScript(nextBin, [
  "dev",
  "--hostname",
  hostname,
  "--port",
  port,
]);

try {
  await waitForHealth();
  process.exitCode = await runPlaywright();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  stopProcessTree(nextProcess);
}

process.exit(process.exitCode ?? 0);
