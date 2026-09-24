import { describe, expect, it } from "vitest";

import { metadata as adminMetadata } from "@/app/admin/layout";
import { metadata as homePageMetadata } from "@/app/(public)/page";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  buildRobots,
  buildRootMetadata,
  buildSitemap,
  createSiteUrl,
  getPublicSiteOrigin,
} from "@/src/seo/site";

describe("site SEO configuration", () => {
  it("uses AUTH_URL as the canonical public site origin", () => {
    const origin = getPublicSiteOrigin({
      AUTH_URL: "https://staging.tuttoseriea.com",
      NODE_ENV: "production",
    });

    expect(origin.toString()).toBe("https://staging.tuttoseriea.com/");
    expect(
      createSiteUrl("/sitemap.xml", {
        AUTH_URL: "https://staging.tuttoseriea.com",
        NODE_ENV: "production",
      }),
    ).toBe("https://staging.tuttoseriea.com/sitemap.xml");
  });

  it("allows localhost fallback only for local and CI contexts", () => {
    expect(getPublicSiteOrigin({ NODE_ENV: "test" }).toString()).toBe(
      "http://localhost:3000/",
    );
    expect(getPublicSiteOrigin({ CI: "true", NODE_ENV: "production" }).toString()).toBe(
      "http://localhost:3000/",
    );
    expect(() => getPublicSiteOrigin({ NODE_ENV: "production" })).toThrow(
      /AUTH_URL is required/,
    );
  });

  it("rejects malformed or non-origin public URLs", () => {
    expect(() =>
      getPublicSiteOrigin({
        AUTH_URL: "not a url",
        NODE_ENV: "production",
      }),
    ).toThrow();
    expect(() =>
      getPublicSiteOrigin({
        AUTH_URL: "https://tuttoseriea.com/path",
        NODE_ENV: "production",
      }),
    ).toThrow(/must not include a path/);
  });

  it("keeps root metadata site-wide without an inherited canonical", () => {
    const metadata = buildRootMetadata({
      AUTH_URL: "https://tuttoseriea.com",
      NODE_ENV: "production",
    });

    expect(metadata.metadataBase).toEqual(new URL("https://tuttoseriea.com"));
    expect(metadata.title).toEqual({
      default: SITE_NAME,
      template: `%s | ${SITE_NAME}`,
    });
    expect(metadata.description).toBe(SITE_DESCRIPTION);
    expect(metadata.alternates).toBeUndefined();
  });

  it("sets the home page canonical at the page level", () => {
    expect(homePageMetadata.alternates).toEqual({
      canonical: "/",
    });
  });

  it("marks the admin subtree as noindex and nofollow", () => {
    expect(adminMetadata.robots).toEqual({
      index: false,
      follow: false,
      googleBot: {
        index: false,
        follow: false,
      },
    });
  });

  it("allows public crawl but excludes admin and API crawler targets", () => {
    const robots = buildRobots({
      AUTH_URL: "https://tuttoseriea.com",
      NODE_ENV: "production",
    });

    expect(robots).toEqual({
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api/"],
      },
      sitemap: "https://tuttoseriea.com/sitemap.xml",
    });
  });

  it("includes only existing preferred public URLs in the sitemap", () => {
    const sitemap = buildSitemap({
      AUTH_URL: "https://tuttoseriea.com",
      NODE_ENV: "production",
    });

    expect(sitemap).toEqual([{ url: "https://tuttoseriea.com/" }]);
    expect(sitemap.map((entry) => entry.url)).not.toContain(
      "https://tuttoseriea.com/admin",
    );
  });
});
