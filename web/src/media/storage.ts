import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { getMediaStorageConfig, validateMediaRoot } from "./config";
import { mediaError } from "./errors";
import type { NormalizedAvatar } from "./image";

export const MEDIA_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type StoredMediaAsset = Omit<NormalizedAvatar, "bytes"> & { id: string; storageKey: string; uploaderAccountId: string };

function assetPath(root: string, key: string): string {
  if (!MEDIA_ID_PATTERN.test(key.slice(0, -5)) || key !== `${key.slice(0, -5)}.webp`) {
    throw mediaError("MEDIA_STORAGE_UNAVAILABLE", 503, "Media metadata is invalid");
  }
  return path.join(root, key);
}

export async function mediaRoot(): Promise<string> { return validateMediaRoot(getMediaStorageConfig()); }

export async function saveAvatarFile(root: string, image: NormalizedAvatar, uploaderAccountId: string, id = randomUUID()): Promise<StoredMediaAsset> {
  const storageKey = `${id}.webp`;
  let handle;
  try {
    handle = await open(assetPath(root, storageKey), "wx", 0o600);
    await handle.writeFile(image.bytes);
    await handle.sync();
    await handle.close(); handle = undefined;
    if (process.platform === "linux") {
      const directory = await open(root, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    }
    return { id, storageKey, uploaderAccountId, mimeType: image.mimeType, byteSize: image.byteSize,
      width: image.width, height: image.height, sha256: image.sha256 };
  } catch {
    // Never reuse, overwrite or delete this key, including a partial or otherwise unlinked file.
    throw mediaError("MEDIA_STORAGE_UNAVAILABLE", 503, "Media could not be saved");
  } finally { await handle?.close().catch(() => undefined); }
}

export async function readAvatarFile(root: string, asset: StoredMediaAsset): Promise<Buffer> {
  let handle;
  try {
    if (asset.storageKey !== `${asset.id}.webp`) throw new Error("Invalid Media identity");
    const filename = assetPath(root, asset.storageKey);
    const entry = await lstat(filename);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size !== asset.byteSize) throw new Error("Invalid Media file");
    handle = await open(filename, constants.O_RDONLY | (process.platform === "linux" ? constants.O_NOFOLLOW : 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== asset.byteSize || stat.size > 5 * 1024 * 1024) throw new Error("Invalid Media size");
    const bytes = await handle.readFile();
    if (bytes.length !== asset.byteSize || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error("Invalid Media checksum");
    return bytes;
  } catch {
    throw mediaError("MEDIA_STORAGE_UNAVAILABLE", 503, "Media file is unavailable");
  } finally { await handle?.close().catch(() => undefined); }
}
