import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
vi.mock("server-only", () => ({}));
const query = vi.hoisted(() => vi.fn());
vi.mock("@/src/db", () => ({ getDbPool: query }));
import { isMediaOptimizerTarget } from "@/src/media/optimizer";
import { config, proxy } from "@/proxy";

describe("Targeted Media optimizer exclusion", () => {
  it.each(["/media/public/id.webp", "/media/private/id.webp", "/%6dedia/public/id.webp", "/foo/../media/public/id.webp", "/%256dedia/public/id.webp", "/media%2fprivate%2fid.webp", "\\media\\public\\id.webp", "https://fixture.invalid/media/public/id.webp"])("blocks normalized Media target %s before DB or optimizer cache", async target => {
    const url = `https://fixture.invalid/_next/image?${new URLSearchParams({ url: target, w: "64", q: "75" })}`;
    expect(isMediaOptimizerTarget(url)).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
    const response = await proxy(new NextRequest(url));
    expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-middleware-next")).toBeNull(); expect(query).not.toHaveBeenCalled();
  });
  it.each(["/file.svg", "/club/logo.png", "/%66ile.svg", "/media-thumbnail.webp", "https://other.example/media/football.png", "//other.example/media/football.png"])("preserves unrelated optimizer source %s", async target => {
    const response = await proxy(new NextRequest(`https://fixture.invalid/_next/image?${new URLSearchParams({ url: target, w: "64", q: "75" })}`));
    expect(response.headers.get("x-middleware-next")).toBe("1"); expect(query).not.toHaveBeenCalled();
  });
  it("also protects the configured application origin when the internal request host differs", () => {
    expect(isMediaOptimizerTarget("http://internal:3000/_next/image?url=https%3A%2F%2Fcanonical.invalid%2Fmedia%2Fpublic%2Fid.webp&w=64&q=75", "https://canonical.invalid")).toBe(true);
  });
  it("also rejects image optimizer path suffixes handled by the installed Next server", async () => {
    const url = "https://fixture.invalid/_next/image-extra?url=%2Fmedia%2Fpublic%2Fid.webp&w=64&q=75";
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
    expect((await proxy(new NextRequest(url))).status).toBe(404);
  });
});
