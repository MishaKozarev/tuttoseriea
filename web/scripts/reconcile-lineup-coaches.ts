import { existsSync, readFileSync } from "node:fs";
import pg from "pg";
import { parseCoachOperatorArguments, validateCoachOperatorConnection } from "../src/football/coach-operator-command";
import { applyCoachManifestBatch, CoachReconciliationError, createCoachReconciliationPlan,
  requireCoachCondition, validateCoachManifest, verifyCoachManifest } from "../src/football/coach-reconciliation-plan";

async function main() {
  if (process.argv.length === 3 && process.argv[2] === "--check-runtime") {
    console.log("coach_operator_runtime=ready database_connections=0 provider_requests=0"); return;
  }
  const command = parseCoachOperatorArguments(process.argv.slice(2));
  for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
  const connection = process.env.MIGRATION_DATABASE_URL;
  requireCoachCondition(connection, "COACH_OWNER_CONNECTION_REQUIRED");
  const target = validateCoachOperatorConnection(command.stage, connection, process.getuid?.());
  const pool = new pg.Pool({ connectionString: connection, max: 1 });
  let client: pg.PoolClient | undefined;
  try {
    client = await pool.connect();
    const identity = (await client.query(`select current_database() as database,
      has_table_privilege(current_user,'football.match_lineups','UPDATE') as owner_write,
      exists(select 1 from information_schema.columns where table_schema='football' and table_name='coaches' and column_name='profile_observed_at') as migrated`)).rows[0];
    requireCoachCondition(identity.database === target.database && identity.owner_write && identity.migrated, "COACH_OWNER_SCHEMA_PREFLIGHT_FAILED");
    const runtimeRole = process.env.DATABASE_APP_ROLE;
    requireCoachCondition(runtimeRole, "COACH_RUNTIME_ROLE_REQUIRED");
    const grants = (await client.query(`select has_table_privilege($1,'football.coaches','SELECT') as cs,
      has_table_privilege($1,'football.coaches','INSERT') as ci,has_table_privilege($1,'football.coaches','UPDATE') as cu,
      has_table_privilege($1,'football.coaches','DELETE') as cd,has_table_privilege($1,'football.match_lineups','SELECT') as ls,
      has_table_privilege($1,'football.match_lineups','INSERT') as li,has_table_privilege($1,'football.match_lineups','UPDATE') as lu,
      has_table_privilege($1,'football.match_lineups','DELETE') as ld`, [runtimeRole])).rows[0];
    requireCoachCondition(grants.cs && grants.ci && grants.cu && !grants.cd && grants.ls && grants.li && !grants.lu && grants.ld,
      "COACH_RUNTIME_GRANTS_MISMATCH");
    if (command.action === "plan") {
      await client.query("begin isolation level repeatable read read only"); await client.query("set local time zone 'UTC'");
      const manifest = await createCoachReconciliationPlan(client, target, command.matchIds);
      await client.query("commit"); console.log(JSON.stringify(manifest, null, 2)); return;
    }
    // STAGING receives the manifest on stdin, without source mounts or deployment-state access.
    const input = readFileSync(command.manifest ?? 0, "utf8");
    requireCoachCondition(Buffer.byteLength(input) <= 2_000_000, "COACH_MANIFEST_TOO_LARGE");
    const manifest = validateCoachManifest(JSON.parse(input), target);
    if (command.action === "apply") {
      console.log(JSON.stringify({ event: "operator_start", target, operator: process.env.SUDO_USER ?? process.env.USERNAME ?? process.env.USER ?? "unknown",
        uid: process.getuid?.(), planHash: manifest.hash, pass: command.pass, batch: command.batch }));
      const result = await applyCoachManifestBatch(client, manifest, target, command.pass, command.batch, command.confirm,
        (progress) => console.log(JSON.stringify(progress)));
      console.log(JSON.stringify({ event: "batch_complete", planHash: manifest.hash, ...result }));
    } else {
      await client.query("begin isolation level repeatable read read only"); await client.query("set local time zone 'UTC'");
      const result = await verifyCoachManifest(client, manifest, target);
      await client.query("commit"); console.log(JSON.stringify(result, null, 2));
      if (!result.complete) process.exitCode = 2;
    }
  } finally {
    if (client) { await client.query("rollback"); client.release(); }
    await pool.end();
  }
}
main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "coach_operator_failed", code: error instanceof CoachReconciliationError ? error.code : "COACH_OPERATOR_FAILED" }));
  process.exitCode = 1;
});
