import { existsSync, readSync, openSync, closeSync } from "node:fs";
import pg from "pg";
import { applyTagManifestBatch, createTagManifest, parseTagOperatorArguments, requireTag, TagReconciliationError,
  validateTagOperatorConnection, verifyTagManifest } from "../src/taxonomy/tag-reconciliation";

function readManifest(path: string | undefined): unknown {
  const fd = path ? openSync(path, "r") : 0, chunks: Buffer[] = []; let length = 0;
  try {
    while (true) {
      const buffer = Buffer.alloc(65536), n = readSync(fd, buffer);
      if (!n) break; length += n; requireTag(length <= 25_000_000, "TAG_MANIFEST_TOO_LARGE"); chunks.push(buffer.subarray(0, n));
    }
  } finally { if (path) closeSync(fd); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function main() {
  if (process.argv.length === 3 && process.argv[2] === "--check-runtime") {
    console.log("tag_operator_runtime=ready database_connections=0 provider_requests=0"); return;
  }
  const command = parseTagOperatorArguments(process.argv.slice(2));
  for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
  requireTag(process.env.MIGRATION_DATABASE_URL, "TAG_OWNER_CONNECTION_REQUIRED");
  const connection = process.env.MIGRATION_DATABASE_URL;
  const target = validateTagOperatorConnection(command.stage, connection, process.getuid?.());
  const pool = new pg.Pool({ connectionString: connection, max: 1 });
  try {
    const client = await pool.connect();
    try {
      // pg query parameters may not override the reviewed DSN target.
      const actual = (client as unknown as { connectionParameters: { host: string; port: number; database: string } }).connectionParameters;
      const url = new URL(connection);
      requireTag(actual.host === url.hostname && actual.database === target.database && Number(actual.port) === Number(url.port || 5432), "TAG_CONNECTION_DRIFT");
      const identity = (await client.query(`select current_database() as database,
        exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_roles r on r.oid=c.relowner
          where n.nspname='taxonomy' and c.relname='football_tags' and r.rolname=current_user) as owner`)).rows[0];
      requireTag(identity.database === target.database && identity.owner, "TAG_OWNER_SCHEMA_PREFLIGHT_FAILED");
      const runtimeRole = process.env.DATABASE_APP_ROLE;
      requireTag(runtimeRole, "TAG_RUNTIME_ROLE_REQUIRED");
      const grants = (await client.query(`select has_table_privilege($1,'taxonomy.football_tags','SELECT') as s,
        has_table_privilege($1,'taxonomy.football_tags','INSERT') as i,has_table_privilege($1,'taxonomy.football_tags','UPDATE') as u,
        has_table_privilege($1,'taxonomy.football_tags','DELETE') as d`, [runtimeRole])).rows[0];
      requireTag(grants.s && grants.i && !grants.u && !grants.d, "TAG_RUNTIME_GRANTS_MISMATCH");
      if (command.action === "apply") {
        const result = await applyTagManifestBatch(client, readManifest(command.manifest), target, command.batch, command.confirm);
        console.log(JSON.stringify({ event: "tag_batch_complete", target, planHash: command.confirm,
          uid: process.getuid?.(), operator: process.env.SUDO_USER ?? process.env.USERNAME ?? process.env.USER ?? "unknown", ...result }));
      } else {
        await client.query("begin isolation level repeatable read read only");
        try {
          const result = command.action === "plan" ? await createTagManifest(client, target) : await verifyTagManifest(client, readManifest(command.manifest), target);
          await client.query("commit"); console.log(JSON.stringify(result, null, 2));
          if ("complete" in result && !result.complete) process.exitCode = 2;
        } catch (error) { await client.query("rollback"); throw error; }
      }
    } finally { client.release(); }
  } finally { await pool.end(); }
}
main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "tag_operator_failed", code: error instanceof TagReconciliationError ? error.code : "TAG_OPERATOR_FAILED" })); process.exitCode = 1;
});
