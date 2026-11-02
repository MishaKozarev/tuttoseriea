import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createHash } from "node:crypto";
vi.mock("server-only", () => ({}));
import { AVATAR_MAX_BYTES, normalizeArticleImage, normalizeAvatar } from "@/src/media/image";

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

describe("Draft Article image processing", () => {
  it.each(["jpeg", "png", "webp"] as const)("keeps an editorial %s image within 2048px while avatars remain within 512px", async format => {
    const input = await sharp({ create: { width: 3000, height: 1200, channels: 3, background: "red" } }).toFormat(format).withMetadata().toBuffer();
    const image = await normalizeArticleImage(input, `image/${format}`);
    const metadata = await sharp(image.bytes).metadata();
    expect(image).toMatchObject({ mimeType: "image/webp", width: 2048, height: 819, byteSize: image.bytes.length });
    expect(image.sha256).toBe(createHash("sha256").update(image.bytes).digest("hex"));
    expect(metadata.exif).toBeUndefined(); expect(metadata.icc).toBeUndefined(); expect(metadata.xmp).toBeUndefined();
    expect((await normalizeAvatar(input, `image/${format}`)).width).toBe(512);
  });
  it("does not upscale small draft images and retains the shared input safety limits", async () => {
    const png = await sharp({ create: { width: 320, height: 160, channels: 3, background: "blue" } }).png().toBuffer();
    expect(await normalizeArticleImage(png, "image/png")).toMatchObject({ width: 320, height: 160 });
    await expect(normalizeArticleImage(png, "image/jpeg")).rejects.toMatchObject({ code: "MEDIA_INVALID_IMAGE" });
    await expect(normalizeArticleImage(Buffer.alloc(AVATAR_MAX_BYTES + 1), "image/png")).rejects.toMatchObject({ code: "MEDIA_TOO_LARGE", status: 413 });
    const wide = await sharp({ create: { width: 4097, height: 1, channels: 3, background: "blue" } }).png().toBuffer();
    await expect(normalizeArticleImage(wide, "image/png")).rejects.toMatchObject({ code: "MEDIA_INVALID_IMAGE" });
    const apng = Buffer.concat([png.subarray(0, 33), Buffer.from([0,0,0,8]), Buffer.from("acTL"), Buffer.alloc(12), png.subarray(33)]);
    await expect(normalizeArticleImage(apng, "image/png")).rejects.toMatchObject({ code: "MEDIA_INVALID_IMAGE" });
    await expect(normalizeArticleImage(Buffer.from("<svg/>"), "image/svg+xml")).rejects.toMatchObject({ code: "MEDIA_INVALID_IMAGE" });
  });
  it("shares the two-decode process limit with avatar uploads", async () => {
    const png = await sharp({ create: { width: 3000, height: 1200, channels: 3, background: "blue" } }).png().toBuffer();
    const results = await Promise.allSettled([normalizeAvatar(png, "image/png"), normalizeArticleImage(png, "image/png"), normalizeArticleImage(png, "image/png")]);
    expect(results[0].status).toBe("fulfilled"); expect(results[1].status).toBe("fulfilled");
    expect(results[2]).toMatchObject({ status: "rejected", reason: { code: "MEDIA_BUSY", status: 429 } });
  });
});
