import assert from "node:assert/strict";

/** Validate before constructing a Pool; pg connection-string query parameters can override host/port. */
export function articleTestTargets(env: Record<string, string | undefined>) {
  const parse = (key: string): URL => {
    let target: URL;
    try { target = new URL(env[key] ?? ""); } catch { assert.fail("Explicit LOCAL/exact-CI database configuration is required"); }
    assert(["postgres:", "postgresql:"].includes(target.protocol) && !target.search && !target.hash, "DSN protocol/query overrides are not allowed in fixture checks");
    assert(["localhost", "127.0.0.1"].includes(target.hostname), "Fixture database must be loopback");
    assert((target.port === "15432" && target.pathname === "/tuttoseriea_local") ||
      (env.CI === "true" && target.port === "5432" && target.pathname === "/tuttoseriea_ci"), "Only LOCAL/exact isolated CI database is allowed");
    return target;
  };
  const migration = parse("MIGRATION_DATABASE_URL"), runtime = parse("DATABASE_URL");
  assert.equal(runtime.host, migration.host, "Runtime and migration connections must name the same host");
  assert.equal(runtime.pathname, migration.pathname, "Runtime and migration connections must name the same database");
  return { migration, runtime };
}
