import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ slugExists: vi.fn(), pageExists: vi.fn(), pool: {} }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/db", () => ({ getDbPool: () => mocks.pool }));
vi.mock("@/src/articles/public-repository", () => ({ publicArticleSlugExists: mocks.slugExists, publicArticlePageExists: mocks.pageExists }));
import { config, proxy } from "@/proxy";

beforeEach(() => { vi.resetAllMocks(); mocks.pageExists.mockResolvedValue(true); });
describe("Article pre-stream existence check", () => {
  it("sets a true 404 before an unpublished or unknown slug can start streaming", async () => {
    mocks.slugExists.mockResolvedValue(false);
    const result = await proxy(new NextRequest("https://tuttoseriea.com/articles/unknown"));
    expect(result.status).toBe(404); expect(result.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.slugExists).toHaveBeenCalledWith(mocks.pool, "unknown");
  });
  it("continues a known published slug and valid list pages", async () => {
    mocks.slugExists.mockResolvedValue(true);
    expect((await proxy(new NextRequest("https://tuttoseriea.com/articles/published"))).status).toBe(200);
    expect((await proxy(new NextRequest("https://tuttoseriea.com/articles?page=2"))).status).toBe(200);
    expect(mocks.pageExists).toHaveBeenCalledWith(mocks.pool, 2);
  });
  it("rejects malformed and absent pagination without changing Football routing", async () => {
    expect((await proxy(new NextRequest("https://tuttoseriea.com/articles?page=0"))).status).toBe(404);
    expect(mocks.pageExists).not.toHaveBeenCalled();
    mocks.pageExists.mockResolvedValue(false);
    expect((await proxy(new NextRequest("https://tuttoseriea.com/articles?page=99"))).status).toBe(404);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/articles" })).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/articles/published" })).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/articles/published/extra" })).toBe(false);
  });
});
