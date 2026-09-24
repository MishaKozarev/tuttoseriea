import { expect, test } from "@playwright/test";

const siteOrigin = process.env.WEB_SMOKE_SITE_ORIGIN ?? "http://localhost:3000";

test("web public shell smoke", async ({ page, request }) => {
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    "Русскоязычная платформа о Серии A и итальянском футболе.",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    siteOrigin,
  );
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Serie A на русском");
  await expect(page.getByRole("contentinfo")).toBeVisible();

  const response = await request.get("/api/health");

  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ status: "ok" });

  const robotsResponse = await request.get("/robots.txt");
  const robots = await robotsResponse.text();

  expect(robotsResponse.ok()).toBe(true);
  expect(robots).toContain("Allow: /");
  expect(robots).toContain("Disallow: /admin");
  expect(robots).toContain("Disallow: /api/");
  expect(robots).toContain(`Sitemap: ${siteOrigin}/sitemap.xml`);

  const sitemapResponse = await request.get("/sitemap.xml");
  const sitemap = await sitemapResponse.text();

  expect(sitemapResponse.ok()).toBe(true);
  expect(sitemap).toContain(`<loc>${siteOrigin}/</loc>`);
  expect(sitemap).not.toContain("/admin");
  expect(sitemap).not.toContain("/api/");
  expect(sitemap).not.toContain("/news");
  expect(sitemap).not.toContain("/articles");
});
