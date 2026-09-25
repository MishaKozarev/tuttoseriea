import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runnerDirectory = path.join(appDirectory, "dist", "job-runner");

await mkdir(runnerDirectory, { recursive: true });
await writeFile(
  path.join(runnerDirectory, "cli.js"),
  'require("./jobs/cli.js");\n',
  "utf8",
);
