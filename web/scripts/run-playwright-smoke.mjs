import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const hostname = process.env.WEB_SMOKE_HOSTNAME ?? "127.0.0.1";
const port = process.env.WEB_SMOKE_PORT ?? "3100";
const baseUrl = `http://${hostname}:${port}`;
const nextBin = resolve(appDirectory, "node_modules", "next", "dist", "bin", "next");
const playwrightBin = resolve(
  appDirectory,
  "node_modules",
  "@playwright",
  "test",
  "cli.js",
);
const nextReadyPattern = /Ready in\b/;

export function spawnNodeScript(scriptPath, args, options = {}) {
  return spawn(process.execPath, [scriptPath, ...args], {
    cwd: appDirectory,
    env: process.env,
    stdio: "inherit",
    ...options,
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolveWait) => {
    const timeout = setTimeout(resolveWait, timeoutMs);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolveWait();
    });
  });
}

export async function stopProcessTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    });
    await waitForExit(child, 5_000);
    return;
  }

  child.kill("SIGTERM");
  await waitForExit(child, 5_000);

  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await waitForExit(child, 5_000);
  }
}

function webProcessExitError(child, code, signal) {
  return new Error(
    `Smoke web process exited before readiness: pid=${child.pid ?? "unknown"} code=${code ?? "null"} signal=${signal ?? "null"}`,
  );
}

function childAlreadyExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function forwardAndObserve(stream, target, observer) {
  if (!stream) {
    return () => {};
  }

  const onData = (chunk) => {
    target.write(chunk);
    observer(String(chunk));
  };

  stream.on("data", onData);

  return () => {
    stream.off("data", onData);
  };
}

export function waitForNextReady({
  child,
  readyPattern = nextReadyPattern,
  timeoutMs = 60_000,
}) {
  return new Promise((resolveReady, rejectReady) => {
    let settled = false;
    let output = "";

    const cleanupCallbacks = [];

    const settle = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      child.off("exit", onExit);

      for (const cleanup of cleanupCallbacks) {
        cleanup();
      }

      callback(value);
    };

    const onOutput = (text) => {
      output = `${output}${text}`.slice(-4_000);

      if (readyPattern.test(output)) {
        if (childAlreadyExited(child)) {
          settle(
            rejectReady,
            webProcessExitError(child, child.exitCode, child.signalCode),
          );
          return;
        }

        settle(resolveReady);
      }
    };

    const onExit = (code, signal) => {
      settle(rejectReady, webProcessExitError(child, code, signal));
    };

    const timeout = setTimeout(() => {
      settle(rejectReady, new Error("Timed out waiting for spawned Next readiness"));
    }, timeoutMs);

    child.once("exit", onExit);
    cleanupCallbacks.push(forwardAndObserve(child.stdout, process.stdout, onOutput));
    cleanupCallbacks.push(forwardAndObserve(child.stderr, process.stderr, onOutput));

    if (childAlreadyExited(child)) {
      settle(rejectReady, webProcessExitError(child, child.exitCode, child.signalCode));
    }
  });
}

export function runPlaywright({ webProcess } = {}) {
  return new Promise((resolve) => {
    const child = spawnNodeScript(playwrightBin, ["test", "--config", "playwright.config.ts"], {
      env: {
        ...process.env,
        WEB_SMOKE_BASE_URL: baseUrl,
      },
    });

    let settled = false;

    const settle = async (code) => {
      if (settled) {
        return;
      }

      settled = true;
      webProcess?.off("exit", onWebExit);
      resolve(code ?? 1);
    };

    const onWebExit = async () => {
      await stopProcessTree(child);
      await settle(1);
    };

    if (webProcess) {
      webProcess.once("exit", onWebExit);

      if (childAlreadyExited(webProcess)) {
        void onWebExit();
        return;
      }
    }

    child.on("exit", (code) => {
      void settle(code);
    });
  });
}

export async function runSmoke() {
  const nextProcess = spawnNodeScript(
    nextBin,
    [
      "dev",
      "--hostname",
      hostname,
      "--port",
      port,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  try {
    await waitForNextReady({ child: nextProcess });
    return await runPlaywright({ webProcess: nextProcess });
  } finally {
    await stopProcessTree(nextProcess);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await runSmoke();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }

  process.exit(process.exitCode ?? 0);
}
