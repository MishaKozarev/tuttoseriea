import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { mediaError } from "./errors";

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_MAX_PIXELS = 16_000_000;
export type NormalizedAvatar = { bytes: Buffer; mimeType: "image/webp"; byteSize: number; width: number; height: number; sha256: string };

function invalid(): never { throw mediaError("MEDIA_INVALID_IMAGE", 400, "Use a static JPEG, PNG or WebP image within the avatar limits"); }

function imageFormat(bytes: Buffer): "jpeg" | "png" | "webp" {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  return invalid();
}

function rejectAnimation(bytes: Buffer, format: string): void {
  if (format === "png") {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(offset);
      const kind = bytes.toString("ascii", offset + 4, offset + 8);
      if (kind === "acTL") invalid();
      if (size > bytes.length - offset - 12) invalid();
      offset += size + 12;
      if (kind === "IEND") break;
    }
  } else if (format === "webp") {
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const kind = bytes.toString("ascii", offset, offset + 4);
      const size = bytes.readUInt32LE(offset + 4);
      if (kind === "ANIM" || kind === "ANMF" || (kind === "VP8X" && size >= 1 && (bytes[offset + 8] & 2))) invalid();
      if (size > bytes.length - offset - 8) invalid();
      offset += 8 + size + (size % 2);
    }
  }
}

let runningDecodes = 0;
export async function normalizeAvatar(bytes: Buffer, declaredMime: string): Promise<NormalizedAvatar> {
  if (bytes.length > AVATAR_MAX_BYTES) throw mediaError("MEDIA_TOO_LARGE", 413, "Avatar exceeds 5 MiB");
  const format = imageFormat(bytes);
  if (declaredMime !== `image/${format}`) invalid();
  rejectAnimation(bytes, format);
  // Bound native decodes in each Web process; refuse instead of retaining an unbounded queue.
  if (runningDecodes >= 2) throw mediaError("MEDIA_BUSY", 429, "Image processing is busy; try again later");
  runningDecodes++;
  try {
    const options = { failOn: "warning" as const, limitInputPixels: AVATAR_MAX_PIXELS, unlimited: false };
    const metadata = await sharp(bytes, options).metadata();
    if (metadata.format !== format || !metadata.width || !metadata.height ||
      metadata.width > 4096 || metadata.height > 4096 || metadata.width * metadata.height > AVATAR_MAX_PIXELS ||
      (metadata.pages ?? 1) > 1) invalid();
    const { data, info } = await sharp(bytes, options).autoOrient().resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85, effort: 4 }).timeout({ seconds: 10 }).toBuffer({ resolveWithObject: true });
    if (data.length > AVATAR_MAX_BYTES || !info.width || !info.height) invalid();
    return { bytes: data, mimeType: "image/webp", byteSize: data.length, width: info.width, height: info.height,
      sha256: createHash("sha256").update(data).digest("hex") };
  } catch (error) {
    if (error instanceof Error && "code" in error && typeof error.code === "string" && error.code.startsWith("MEDIA_")) throw error;
    return invalid();
  } finally { runningDecodes--; }
}
