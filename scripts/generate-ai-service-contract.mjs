import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const aiServiceDir = path.join(repoRoot, "ai-service");
const webDir = path.join(repoRoot, "web");
const uvCacheDir = path.join(repoRoot, ".uv-cache");
const targetPath = path.join(
  webDir,
  "src",
  "generated",
  "ai-service-openapi.d.ts",
);
const openapiTypescriptCliPath = path.join(
  webDir,
  "node_modules",
  "openapi-typescript",
  "bin",
  "cli.js",
);
const check = process.argv.includes("--check");
const uvCommand = process.platform === "win32" ? "uv.exe" : "uv";

function run(command, args, options) {
  const stdio = options?.stdio;
  const result = spawnSync(command, args, {
    ...(stdio === "inherit" ? {} : { encoding: "utf8" }),
    ...options,
  });

  if (result.error) {
    process.stderr.write(`${command}: ${result.error.message}\n`);
    process.exit(1);
  }

  if (result.status !== 0) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    process.exit(result.status ?? 1);
  }

  return result.stdout ?? "";
}

const schemaJson = run(
  uvCommand,
  ["run", "--no-sync", "python", "-m", "tuttoseriea_ai_service.openapi"],
  {
    cwd: aiServiceDir,
    env: {
      ...process.env,
      UV_CACHE_DIR: process.env.UV_CACHE_DIR ?? uvCacheDir,
    },
  },
);

const tempDir = mkdtempSync(path.join(tmpdir(), "tuttoseriea-ai-openapi-"));

try {
  const schemaPath = path.join(tempDir, "openapi.json");
  writeFileSync(schemaPath, schemaJson, "utf8");
  mkdirSync(path.dirname(targetPath), { recursive: true });

  const args = [
    openapiTypescriptCliPath,
    schemaPath,
    "--alphabetize",
    "--output",
    targetPath,
  ];

  if (check) {
    args.push("--check");
  }

  run(process.execPath, args, {
    cwd: webDir,
    stdio: "inherit",
  });
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}
