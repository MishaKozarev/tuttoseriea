import { describe, expect, it } from "vitest";
import { articleTestTargets } from "../../scripts/articles-test-target";

const local = "postgresql://fixture:synthetic@127.0.0.1:15432/tuttoseriea_local";
describe("Articles fixture database isolation", () => {
  it("accepts only matching LOCAL or explicit isolated-CI targets", () => {
    expect(articleTestTargets({ DATABASE_URL: local, MIGRATION_DATABASE_URL: local }).runtime.port).toBe("15432");
    const ci = local.replace(":15432/tuttoseriea_local", ":5432/tuttoseriea_ci");
    expect(articleTestTargets({ DATABASE_URL: ci, MIGRATION_DATABASE_URL: ci, CI: "true" }).runtime.port).toBe("5432");
    expect(() => articleTestTargets({ DATABASE_URL: ci, MIGRATION_DATABASE_URL: ci })).toThrow();
  });
  it.each(["?host=remote.invalid", "?port=5432", "?database=other", "?%68ost=remote.invalid", "#remote", "?application_name=override"])("rejects pg connection-string override %s before any connection", override => {
    expect(() => articleTestTargets({ DATABASE_URL: local + override, MIGRATION_DATABASE_URL: local })).toThrow();
    expect(() => articleTestTargets({ DATABASE_URL: local, MIGRATION_DATABASE_URL: local + override })).toThrow();
  });
  it("rejects mismatched hosts, databases, protocols and malformed secret values without echoing them", () => {
    for (const value of [local.replace("127.0.0.1", "localhost"), local.replace("tuttoseriea_local", "other"), local.replace("postgresql:", "https:"), "sensitive-malformed-value"]) {
      expect(() => articleTestTargets({ DATABASE_URL: value, MIGRATION_DATABASE_URL: local })).toThrow();
    }
    try { articleTestTargets({ DATABASE_URL: "sensitive-malformed-value", MIGRATION_DATABASE_URL: local }); }
    catch (error) { expect(String(error)).not.toContain("sensitive-malformed-value"); }
  });
});
