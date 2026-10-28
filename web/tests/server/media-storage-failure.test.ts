import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, open, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
vi.mock("server-only", () => ({}));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
import { saveAvatarFile } from "@/src/media/storage";

const id = "bd996433-5bfa-41a7-883f-f55f4d9e9803";
const bytes = Buffer.from("normalized-fixture-bytes");
const image = { bytes, mimeType: "image/webp" as const, width: 1, height: 1, byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
beforeEach(() => { vi.mocked(open).mockImplementation(actualFs.open); });

describe("File failures leave inaccessible remnants without overwrite or deletion", () => {
  it("does not report success after a partial write and permanently reserves that key", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tuttoseriea-media-write-failure-"));
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actualFs.open(...args);
      const write = handle.writeFile.bind(handle);
      handle.writeFile = async () => { await write(Buffer.from("partial")); throw new Error("synthetic disk full"); };
      return handle;
    });
    await expect(saveAvatarFile(root, image, "owner", id)).rejects.toMatchObject({ code: "MEDIA_STORAGE_UNAVAILABLE" });
    expect(await readFile(path.join(root, `${id}.webp`), "utf8")).toBe("partial");
    await expect(saveAvatarFile(root, image, "owner", id)).rejects.toMatchObject({ code: "MEDIA_STORAGE_UNAVAILABLE" });
    expect(await readdir(root)).toEqual([`${id}.webp`]);
  });
  it("does not report a saved asset when file synchronization fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tuttoseriea-media-sync-failure-"));
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actualFs.open(...args);
      handle.sync = async () => { throw new Error("synthetic fsync failure"); };
      return handle;
    });
    await expect(saveAvatarFile(root, image, "owner", id)).rejects.toMatchObject({ code: "MEDIA_STORAGE_UNAVAILABLE" });
    expect(await readFile(path.join(root, `${id}.webp`))).toEqual(bytes);
    expect(await readdir(root)).toEqual([`${id}.webp`]);
  });
  it.skipIf(process.platform !== "linux")("requires parent directory fsync before reporting a saved asset", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tuttoseriea-media-directory-sync-failure-"));
    vi.mocked(open).mockImplementation(async (...args) => {
      const handle = await actualFs.open(...args);
      if (String(args[0]) === root) handle.sync = async () => { throw new Error("synthetic directory fsync failure"); };
      return handle;
    });
    await expect(saveAvatarFile(root, image, "owner", id)).rejects.toMatchObject({ code: "MEDIA_STORAGE_UNAVAILABLE" });
    expect(await readFile(path.join(root, `${id}.webp`))).toEqual(bytes);
  });
});
