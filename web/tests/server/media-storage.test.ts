import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, readdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
vi.mock("server-only", () => ({}));
import { getMediaStorageConfig, hasExactMount, validateMediaRoot } from "@/src/media/config";
import { readAvatarFile, saveAvatarFile } from "@/src/media/storage";

const id = "bd996433-5bfa-41a7-883f-f55f4d9e9803";
const bytes = Buffer.from("normalized-image-fixture");
const image = { bytes, mimeType: "image/webp" as const, width: 20, height: 20, byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "tuttoseriea-media-unit-"));
  await writeFile(path.join(root, ".media-environment"), "local\n");
  return root;
}

describe("Persistent immutable Media storage", () => {
  it("requires explicit absolute roots and exact environment markers, never creates a missing root", async () => {
    expect(() => getMediaStorageConfig({})).toThrow();
    expect(() => getMediaStorageConfig({ MEDIA_STORAGE_ROOT: "relative", MEDIA_STORAGE_ENV: "local" })).toThrow();
    const root = await fixtureRoot();
    expect(await validateMediaRoot({ root, environment: "local" }, { platform: "win32" })).toBe(root);
    await expect(validateMediaRoot({ root, environment: "production" }, { platform: "win32" })).rejects.toMatchObject({ code: "MEDIA_STORAGE_UNAVAILABLE" });
    await expect(validateMediaRoot({ root: path.join(root, "absent"), environment: "local" }, { platform: "win32" })).rejects.toMatchObject({ code: "MEDIA_STORAGE_UNAVAILABLE" });
    expect(await readdir(root)).toEqual([".media-environment"]);
  });
  it("requires an exact Linux mount even in LOCAL containers", async () => {
    const root = await fixtureRoot();
    await expect(validateMediaRoot({ root, environment: "local" }, { platform: "linux", mountInfo: "1 0 0:1 / / rw - ext4 /dev/root rw" })).rejects.toMatchObject({ code: "MEDIA_STORAGE_UNAVAILABLE" });
    const mountInfo = `2 1 0:2 / ${root.replace(/ /g, "\\040")} rw - ext4 /dev/disk rw`;
    expect(hasExactMount(mountInfo, root)).toBe(true);
    expect(await validateMediaRoot({ root, environment: "local" }, { platform: "linux", mountInfo })).toBe(root);
  });
  it("allows only one concurrent exclusive create and preserves the first bytes", async () => {
    const root = await fixtureRoot();
    const writes = await Promise.allSettled([saveAvatarFile(root, image, "owner", id), saveAvatarFile(root, image, "owner", id)]);
    expect(writes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(writes.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await readFile(path.join(root, `${id}.webp`))).toEqual(bytes);
    await expect(saveAvatarFile(root, { ...image, bytes: Buffer.from("replacement") }, "owner", id)).rejects.toMatchObject({ code: "MEDIA_STORAGE_UNAVAILABLE" });
    expect(await readFile(path.join(root, `${id}.webp`))).toEqual(bytes);
  });
  it("retains unlinked files and verifies size, checksum and canonical ID mapping on reads", async () => {
    const root = await fixtureRoot();
    const asset = await saveAvatarFile(root, image, "owner", id);
    expect(await readAvatarFile(root, asset)).toEqual(bytes);
    await expect(readAvatarFile(root, { ...asset, sha256: "0".repeat(64) })).rejects.toMatchObject({ code: "MEDIA_STORAGE_UNAVAILABLE" });
    await expect(readAvatarFile(root, { ...asset, storageKey: "../outside.webp" })).rejects.toMatchObject({ code: "MEDIA_STORAGE_UNAVAILABLE" });
    expect(await readdir(root)).toContain(`${id}.webp`);
  });
  it.skipIf(process.platform === "win32")("rejects symlinks instead of reading outside storage", async () => {
    const root = await fixtureRoot();
    await writeFile(path.join(root, "outside"), bytes);
    await symlink(path.join(root, "outside"), path.join(root, `${id}.webp`));
    await expect(readAvatarFile(root, { ...image, id, storageKey: `${id}.webp`, uploaderAccountId: "owner" })).rejects.toMatchObject({ code: "MEDIA_STORAGE_UNAVAILABLE" });
  });
});
