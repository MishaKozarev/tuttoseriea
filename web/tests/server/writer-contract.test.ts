import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseProfileEdit, writerEmail, writerAccountId } from "@/src/identity/writer-contract";

const base = { nickname: " Автор ", socialLinks: [{ label: " Канал ", url: "https://example.invalid/channel" }], expectedRevision: 0, operationId: "50000000-0000-0000-0000-000000000005" };
describe("Writer profile input boundary", () => {
  it("normalizes public profile without affecting auth identity", () => {
    expect(parseProfileEdit(base)).toEqual({ ...base, nickname: "Автор", socialLinks: [{ label: "Канал", url: "https://example.invalid/channel" }] });
    expect(writerEmail(" AUTHOR@EXAMPLE.INVALID ")).toBe("author@example.invalid");
    expect(writerAccountId("legacy-account-stable-id")).toBe("legacy-account-stable-id");
  });
  it.each(["javascript:alert(1)", "data:image/svg+xml,bad", "https://user:password@example.invalid/", "file:///private/avatar", "https://example.invalid/\u0000bad"])("rejects unsafe social URL %s", url => {
    expect(() => parseProfileEdit({ ...base, socialLinks: [{ label: "Канал", url }] })).toThrow();
  });
  it.each([
    { nickname: " " }, { nickname: "a".repeat(61) }, { nickname: "hidden\u200bname" },
    { accountId: "foreign" }, { roles: ["super_admin"] }, { canPublishOwn: true },
    { socialLinks: Array.from({ length: 11 }, () => base.socialLinks[0]) },
    { socialLinks: [{ ...base.socialLinks[0], role: "super_admin" }] }, { expectedRevision: -1 },
    { expectedRevision: 1.5 }, { operationId: "arbitrary" },
  ])("rejects out-of-contract profile edit %j", patch => {
    expect(() => parseProfileEdit({ ...base, ...patch })).toThrow();
  });
});
