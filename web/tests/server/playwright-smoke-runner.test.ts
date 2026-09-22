import { spawn } from "node:child_process";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { waitForNextReady } from "../../scripts/run-playwright-smoke.mjs";

const hostname = "127.0.0.1";
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const openServers = new Set<HttpServer>();
const smokeCommand =
  process.platform === "win32"
    ? {
        args: ["/d", "/s", "/c", "pnpm.cmd run test:smoke"],
        command: "cmd.exe",
      }
    : {
        args: ["run", "test:smoke"],
        command: "pnpm",
      };

function closeServer(server: HttpServer): Promise<void> {
  return new Promise((resolveClose) => {
    if (!openServers.has(server)) {
      resolveClose();
      return;
    }

    server.close(() => {
      openServers.delete(server);
      resolveClose();
    });
  });
}

function listenOnLoopback(server: HttpServer): Promise<number> {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen({ host: hostname, port: 0 }, () => {
      const address = server.address();

      if (address === null || typeof address === "string") {
        rejectListen(new Error("Expected an IPv4 test server address"));
        return;
      }

      openServers.add(server);
      resolveListen(address.port);
    });
  });
}

function runSmokeCli(port: number): Promise<{
  code: number;
  output: string;
}> {
  return new Promise((resolveRun) => {
    const child = spawn(smokeCommand.command, smokeCommand.args, {
      cwd: webRoot,
      env: {
        ...process.env,
        WEB_SMOKE_PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";

    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("exit", (code) => {
      resolveRun({ code: code ?? 1, output });
    });
  });
}

afterEach(async () => {
  await Promise.all([...openServers].map((server) => closeServer(server)));
});

describe("Playwright smoke runner lifecycle", () => {
  it(
    "fails the real smoke CLI when a stale server already occupies the target port",
    async () => {
      const requests: string[] = [];
      const server = createHttpServer((request, response) => {
        requests.push(request.url ?? "");

        if (request.url === "/api/health") {
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ status: "ok" }));
          return;
        }

        response.setHeader("content-type", "text/html");
        response.end(
          "<!doctype html><title>dummy</title><body>Bootstrap E2E marker</body>",
        );
      });
      const port = await listenOnLoopback(server);

      const result = await runSmokeCli(port);

      expect(result.code).not.toBe(0);
      expect(result.output).toContain("Smoke web process exited before readiness");
      expect(requests).toEqual([]);

      await closeServer(server);
    },
    30_000,
  );

  it("fails readiness when a real spawned web process exits early", async () => {
    const child = spawn(process.execPath, ["-e", "process.exit(42)"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    await expect(
      waitForNextReady({
        child,
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow("Smoke web process exited before readiness");
  });
});
