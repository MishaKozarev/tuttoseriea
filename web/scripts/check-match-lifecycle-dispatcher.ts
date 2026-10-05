import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appDirectory, "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const wrapper = readRepoFile(
  "scripts/vds/tuttoseriea-dispatch-match-lifecycle-staging",
);
const service = readRepoFile(
  "scripts/vds/tuttoseriea-match-lifecycle-staging.service",
);
const timer = readRepoFile(
  "scripts/vds/tuttoseriea-match-lifecycle-staging.timer",
);
const productionWorkflow = readRepoFile(".github/workflows/run-job-production.yml");
const registry = readRepoFile("web/src/jobs/registry.ts");

for (const fragment of [
  "accepts no arguments",
  "read_current_release \"$environment\"",
  "config_dir=\"${base_dir}/config\"",
  "match-dispatcher.env",
  "ghcr.io/mishakozarev/tuttoseriea/web",
  "--pull never",
  "--network \"$network\"",
  "--env-file \"$runtime_env\"",
  "--env-file \"$runner_env\"",
  "--env-file \"$dispatcher_env\"",
  "\"$image_ref\"",
  "node /app/job-runner/dispatcher.js --run",
]) {
  assert(wrapper.includes(fragment), `Dispatcher wrapper is missing: ${fragment}`);
}

assert(
  !/docker exec|eval|bash -c|sh -c|\$\{[1-9@*]\}/u.test(wrapper),
  "Dispatcher wrapper exposes a forbidden execution or argument path",
);
assert(
  !/--entrypoint|--env(?:\s|=)|-e\s/u.test(wrapper),
  "Dispatcher wrapper permits caller-selected entrypoint or environment",
);
assert(
  service.includes(
    "ExecStart=/usr/local/sbin/tuttoseriea-dispatch-match-lifecycle-staging",
  ) && service.includes("Type=oneshot") && service.includes("User=root"),
  "Dispatcher service does not use the exact root-owned oneshot wrapper",
);
assert(
  timer.includes("OnCalendar=*-*-* *:*:00") &&
    timer.includes("Persistent=false") &&
    timer.includes("tuttoseriea-match-lifecycle-staging.service"),
  "Dispatcher timer does not retain the exact one-minute non-persistent contract",
);
assert(
  !productionWorkflow.includes("dispatcher") &&
    !productionWorkflow.includes("match-lifecycle"),
  "Production workflow was expanded for the STAGING dispatcher",
);

const registryDefinitions = registry.match(
  /createJobRegistry\(\[([\s\S]*?)\]\)/u,
)?.[1];
const registeredDefinitions = registryDefinitions?.match(/syncSerieA[A-Za-z]+Job/gu) ?? [];
assert(
  registeredDefinitions.length === 8,
  `Production job registry must remain at 8 types, got ${registeredDefinitions.length}`,
);

console.log("match_lifecycle_dispatcher_operational_check=passed");
console.log("match_lifecycle_dispatcher_exact_image=true");
console.log("match_lifecycle_dispatcher_no_arbitrary_args=true");
console.log("match_lifecycle_dispatcher_production_unchanged=true");
console.log("production_job_types=8");
