import { spawn } from "node:child_process";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { stopProcessTree, waitForNextReady } from "../../scripts/run-playwright-smoke.mjs";

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
  it("confirms the owned server has exited and releases captured streams", async () => {
    const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});require('node:http').createServer((req,res)=>res.end('fixture')).listen(0,'127.0.0.1',()=>console.log('Ready in fixture'))"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await waitForNextReady({ child, timeoutMs: 5_000 });
      await stopProcessTree(child);
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      expect(child.stdout.destroyed).toBe(true); expect(child.stderr.destroyed).toBe(true);
      // Already-exited cleanup is repeatable and must not signal another PID.
      await stopProcessTree(child);
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
  }, 20_000);

  it("lets the parent exit naturally when Windows taskkill is unavailable", async () => {
    const helper = pathToFileURL(resolve(webRoot, "scripts/run-playwright-smoke.mjs")).href;
    const program = `
      import { spawn } from 'node:child_process';
      import { stopProcessTree, waitForNextReady } from ${JSON.stringify(helper)};
      const child=spawn(process.execPath,['-e',"require('node:http').createServer((req,res)=>res.end('fixture')).listen(0,'127.0.0.1',()=>console.log('Ready in fixture'))"],{stdio:['ignore','pipe','pipe']});
      try {
        await waitForNextReady({child,timeoutMs:5000});
        await stopProcessTree(child);
        if(child.exitCode===null&&child.signalCode===null) throw Error('Owned server is still running');
        console.log('fixture_cleanup_confirmed');
      } finally { if(child.exitCode===null&&child.signalCode===null) child.kill('SIGKILL'); }
    `;
    const wrapper = spawn(process.execPath, ["--input-type=module", "-e", program], {
      env: { ...process.env, PATH: "" }, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = ""; wrapper.stdout.on("data", chunk => { output += String(chunk); }); wrapper.stderr.on("data", chunk => { output += String(chunk); });
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; wrapper.kill("SIGKILL"); }, 15_000);
    try {
      const code = await new Promise<number | null>(resolveExit => wrapper.once("exit", resolveExit));
      expect(timedOut).toBe(false); expect(code).toBe(0); expect(output).toContain("fixture_cleanup_confirmed");
    } finally { clearTimeout(timeout); await stopProcessTree(wrapper); }
  }, 20_000);

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
          "<!doctype html><title>dummy</title><body>tuttoseriea.com</body>",
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
