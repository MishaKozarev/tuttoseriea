import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createHash } from "node:crypto";
vi.mock("server-only", () => ({}));
import { AVATAR_MAX_BYTES, normalizeAvatar } from "@/src/media/image";

describe("Untrusted avatar decoding", () => {
  it.each(["jpeg", "png", "webp"] as const)("fully reencodes %s, removes metadata and reports saved-byte metadata", async format => {
    const input = await sharp({ create: { width: 900, height: 300, channels: 4, background: "red" } }).toFormat(format).withMetadata().toBuffer();
    const avatar = await normalizeAvatar(input, `image/${format}`);
    const metadata = await sharp(avatar.bytes).metadata();
    expect(avatar).toMatchObject({ mimeType: "image/webp", width: 512, height: 171, byteSize: avatar.bytes.length });
    expect(avatar.sha256).toBe(createHash("sha256").update(avatar.bytes).digest("hex"));
    expect(metadata.format).toBe("webp");
    expect(metadata.exif).toBeUndefined(); expect(metadata.icc).toBeUndefined(); expect(metadata.xmp).toBeUndefined();
  });
  it("rejects SVG, spoofed MIME, truncated pixels and oversized bytes", async () => {
    await expect(normalizeAvatar(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "image/png")).rejects.toMatchObject({ code: "MEDIA_INVALID_IMAGE" });
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: "blue" } }).png().toBuffer();
    await expect(normalizeAvatar(png, "image/jpeg")).rejects.toMatchObject({ code: "MEDIA_INVALID_IMAGE" });
    await expect(normalizeAvatar(png.subarray(0, Math.floor(png.length / 2)), "image/png")).rejects.toMatchObject({ code: "MEDIA_INVALID_IMAGE" });
    await expect(normalizeAvatar(Buffer.alloc(AVATAR_MAX_BYTES + 1), "image/png")).rejects.toMatchObject({ code: "MEDIA_TOO_LARGE", status: 413 });
  });
  it("rejects side and decoded-pixel limits before encoding", async () => {
    for (const [width, height] of [[4097, 1], [4096, 4096]]) {
      const png = await sharp({ create: { width, height, channels: 3, background: "white" } }).png().toBuffer();
      await expect(normalizeAvatar(png, "image/png")).rejects.toMatchObject({ code: "MEDIA_INVALID_IMAGE" });
    }
  });
  it("rejects APNG and animated WebP markers rather than silently selecting a frame", async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } }).png().toBuffer();
    const apng = Buffer.concat([png.subarray(0, 33), Buffer.from([0,0,0,8]), Buffer.from("acTL"), Buffer.alloc(12), png.subarray(33)]);
    await expect(normalizeAvatar(apng, "image/png")).rejects.toMatchObject({ code: "MEDIA_INVALID_IMAGE" });
    const webp = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } }).webp().toBuffer();
    const animated = Buffer.concat([webp.subarray(0, 12), Buffer.from("ANIM"), Buffer.alloc(10), webp.subarray(12)]);
    await expect(normalizeAvatar(animated, "image/webp")).rejects.toMatchObject({ code: "MEDIA_INVALID_IMAGE" });
  });
});
