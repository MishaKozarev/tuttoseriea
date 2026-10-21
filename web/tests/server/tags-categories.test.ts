import { describe, expect, it } from "vitest";
import { parseCategoryWrite, parseCategoryQuery } from "@/src/categories/management";
import { parseTagQuery } from "@/src/taxonomy/football-tags";
import { parseTagOperatorArguments, validateTagOperatorConnection, validateTagManifest } from "@/src/taxonomy/tag-reconciliation";
import { getPermissionsForRoles, hasPermissionForRoles, PERMISSION_IDS } from "@/src/identity/rbac";

describe("Category validation and trusted permissions", () => {
  it("normalizes a name without accepting provider/role/identity fields", () => {
    expect(parseCategoryWrite({ name: "  Category  " }, "create").name).toBe("Category");
    for (const name of ["", " \t ", "a".repeat(201), "bad\u0000name", "bad\u200bname"]) expect(() => parseCategoryWrite({ name }, "create")).toThrow();
    for (const extra of ["id", "kind", "role", "actorAccountId", "slug", "archived"]) expect(() => parseCategoryWrite({ name: "Valid", [extra]: "forged" }, "create")).toThrow();
  });
  it("requires revision and explicit destructive confirmation", () => {
    expect(() => parseCategoryWrite({ name: "Valid" }, "edit")).toThrow();
    expect(() => parseCategoryWrite({ expectedRevision: 0, confirmed: false }, "delete")).toThrow();
    expect(parseCategoryWrite({ expectedRevision: 7, confirmed: true }, "delete").expectedRevision).toBe(7);
    expect(() => parseCategoryWrite({ name: "Valid", expectedRevision: -1 }, "edit")).toThrow();
  });
  it("retains existing role grants and limits both new permissions to Super Admin", () => {
    for (const permission of [PERMISSION_IDS.articleCategoriesManage, PERMISSION_IDS.newsCategoriesManage]) {
      for (const roles of [[], ["writer"], ["admin"], ["writer", "admin"]] as const) expect(hasPermissionForRoles(roles, permission)).toBe(false);
      expect(hasPermissionForRoles(["writer", "super_admin"], permission)).toBe(true);
    }
    expect(getPermissionsForRoles(["writer", "admin"])).toEqual(["admin.access"]);
  });
  it("bounds list input and rejects duplicate/unknown parameters", () => {
    expect(parseCategoryQuery(new URLSearchParams("query=%25&page=2"))).toEqual({ query: "%", page: 2 });
    for (const query of ["page=0", "query=a&query=b", "kind=news", "page=1.5"]) expect(() => parseCategoryQuery(new URLSearchParams(query))).toThrow();
    for (const query of ["kind=topic", "kind=__proto__", "page=0", "kind=clubs&kind=players", "role=super_admin"]) expect(() => parseTagQuery(new URLSearchParams(query))).toThrow();
    expect(parseTagQuery(new URLSearchParams()).kind).toBe("all");
  });
});
describe("Bounded Football Tags operator", () => {
  it("defaults to dry-run but requires explicit target and scope", () => {
    expect(parseTagOperatorArguments(["--stage=local", "--scope=persisted-football"]).action).toBe("plan");
    for (const args of [[], ["--stage=production", "--scope=persisted-football"], ["--stage=local"], ["--stage=local", "--scope=all"],
      ["--stage=staging", "--action=apply"], ["--stage=local", "--scope=persisted-football", "--stage=local"]]) expect(() => parseTagOperatorArguments(args)).toThrow();
  });
  it("permits only exact LOCAL or root-owned STAGING target, no DSN overrides", () => {
    expect(validateTagOperatorConnection("local", "postgresql://fixture:fake@127.0.0.1:15432/tuttoseriea_local", undefined).stage).toBe("local");
    expect(validateTagOperatorConnection("staging", "postgresql://fixture:fake@postgres:5432/tuttoseriea_staging", 0).stage).toBe("staging");
    for (const url of ["postgresql://fixture:fake@postgres:5432/tuttoseriea_production", "postgresql://fixture:fake@127.0.0.1:15432/tuttoseriea_staging", "postgresql://fixture:fake@postgres:5432/tuttoseriea_staging?host=foreign"]) expect(() => validateTagOperatorConnection("staging", url, 0)).toThrow();
    expect(() => validateTagOperatorConnection("staging", "postgresql://fixture:fake@postgres/tuttoseriea_staging", 1000)).toThrow();
  });
  it("rejects unreviewed, forged or cross-target manifests", () => {
    const target = { stage: "local" as const, database: "tuttoseriea_local" };
    for (const input of [null, [], {}, { version: 1, target: { stage: "staging", database: "tuttoseriea_staging" } }]) expect(() => validateTagManifest(input, target)).toThrow();
  });
});
