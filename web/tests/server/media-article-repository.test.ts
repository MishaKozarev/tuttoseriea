import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), write: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/db", () => ({ getDbPool: () => ({ query: mocks.query }) }));
vi.mock("@/src/articles/service", () => ({ withArticleDraftWrite: mocks.write }));

import { attachArticleDraftImage, findArticleDraftImage, findLinkedAvatar } from "@/src/media/repository";
import type { StoredPurposeMediaAsset } from "@/src/media/storage";

const articleId = "bd996433-5bfa-41a7-883f-f55f4d9e9803";
const asset: StoredPurposeMediaAsset = { id: "be996433-5bfa-41a7-883f-f55f4d9e9803", kind: "article_image", storageKey: "be996433-5bfa-41a7-883f-f55f4d9e9803.webp", mimeType: "image/webp", byteSize: 100, width: 2048, height: 1024, sha256: "a".repeat(64), uploaderAccountId: "writer" };
const actor = { accountId: "writer", authUserId: "auth", sessionToken: "trusted", manageAll: false };
const input = { articleId, expectedRevision: 1, operationId: articleId, asset };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue({ rows: [{ count: 0 }] });
  mocks.write.mockImplementation(async (_id, revision, work) => ({ result: await work({ query: mocks.query }, actor, revision + 1), revision: revision + 1 }));
});

describe("Media purposes and Article attachment access", () => {
  it("keeps the public and own-avatar query restricted to avatar assets", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    expect(await findLinkedAvatar(asset.id)).toBeNull();
    expect(mocks.query.mock.calls[0][0]).toContain("m.kind='avatar'");
    expect(mocks.query.mock.calls[0][0]).not.toContain("article.draft_images");
  });
  it("resolves private images only through an Article attachment and the trusted owner's or manager's ACL", async () => {
    mocks.query.mockResolvedValue({ rows: [asset] });
    expect(await findArticleDraftImage(asset.id, actor)).toEqual(asset);
    const [sql, args] = mocks.query.mock.calls[0];
    expect(sql).toContain("join article.draft_images"); expect(sql).toContain("m.kind='article_image'");
    expect(sql).toContain("a.author_account_id=$2"); expect(sql).not.toContain("m.uploader_account_id=$2");
    expect(args).toEqual([asset.id, "writer", false]);
    await findArticleDraftImage(asset.id, { ...actor, accountId: "sa", manageAll: true });
    expect(mocks.query.mock.calls[1][1]).toEqual([asset.id, "sa", true]);
  });
  it("delegates CAS/session locking and receipt handling while atomically inserting metadata and the draft link", async () => {
    const result = await attachArticleDraftImage(input);
    expect(result).toEqual({ result: { id: asset.id, url: `/media/private/${asset.id}.webp`, width: 2048, height: 1024, byteSize: 100 }, revision: 2 });
    expect(mocks.write).toHaveBeenCalledWith(articleId, 1, expect.any(Function), { operationId: articleId, fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const calls = mocks.query.mock.calls;
    expect(calls).toHaveLength(3); expect(calls[0][0]).toContain("count(*)");
    expect(calls[1][0]).toContain("insert into media.assets"); expect(calls[1][0]).toContain("'article_image'");
    expect(calls[2]).toEqual(["insert into article.draft_images(draft_id,media_id) values($1,$2)", [articleId, asset.id]]);
  });
  it("rejects another purpose, changed actor, and attachment overflow before metadata insertion", async () => {
    await expect(attachArticleDraftImage({ ...input, asset: { ...asset, kind: "avatar" } })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mocks.write).not.toHaveBeenCalled();
    await expect(attachArticleDraftImage({ ...input, asset: { ...asset, uploaderAccountId: "another" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.query).not.toHaveBeenCalled();
    mocks.query.mockResolvedValue({ rows: [{ count: 20 }] });
    await expect(attachArticleDraftImage(input)).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
  it("does not insert a second attachment when the locked helper returns a stored receipt", async () => {
    const receipt = { result: { id: asset.id, url: `/media/private/${asset.id}.webp`, width: 2048, height: 1024, byteSize: 100 }, revision: 2 };
    mocks.write.mockResolvedValue(receipt);
    expect(await attachArticleDraftImage(input)).toEqual(receipt);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
