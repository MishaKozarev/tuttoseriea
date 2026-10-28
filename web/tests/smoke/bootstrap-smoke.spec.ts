import { expect, test } from "@playwright/test";

const siteOrigin = process.env.WEB_SMOKE_SITE_ORIGIN ?? "http://localhost:3000";

test("Media cannot enter the independent Next image cache", async ({ request }) => {
  for (const target of ["/media/public/00000000-0000-0000-0000-000000000001.webp", "/media/private/00000000-0000-0000-0000-000000000001.webp", "/%6dedia/public/00000000-0000-0000-0000-000000000001.webp", "/foo/../media/public/00000000-0000-0000-0000-000000000001.webp"]) {
    for (const headers of [{}, { "x-middleware-subrequest": "proxy:proxy:proxy:proxy:proxy", "x-nextjs-data": "1" }] as Record<string, string>[]) {
      const response = await request.get(`/_next/image?${new URLSearchParams({ url: target, w: "64", q: "75" })}`, { headers });
      expect(response.status()).toBe(404); expect(response.headers()["cache-control"]).toContain("no-store");
      expect(response.headers()["cloudflare-cdn-cache-control"]).toBe("no-store");
    }
  }
  // The pre-existing optimizer still evaluates unrelated sources. SVG remains
  // rejected by Next's default image policy, rather than our Media 404 guard.
  const other = await request.get("/_next/image?url=%2Ffile.svg&w=64&q=75");
  expect(other.status()).toBe(400);
});

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
  expect(sitemap).toContain(`<loc>${siteOrigin}/clubs</loc>`);
  expect(sitemap).toContain(`<loc>${siteOrigin}/calendar</loc>`);
  expect(sitemap).toContain(`<loc>${siteOrigin}/table</loc>`);
  expect(sitemap).toContain(`<loc>${siteOrigin}/statistics</loc>`);
  expect(sitemap).not.toContain("/admin");
  expect(sitemap).not.toContain("/api/");
  expect(sitemap).not.toContain("/news");
  expect(sitemap).not.toContain("/articles");

  const unknownClubResponse = await request.get("/clubs/not-a-real-club");
  const unknownClubHtml = await unknownClubResponse.text();

  expect(unknownClubResponse.status()).toBe(404);
  expect(unknownClubHtml).toContain('name="robots" content="noindex"');

  const unknownPlayerResponse = await request.get("/players/not-a-real-player");
  const unknownPlayerHtml = await unknownPlayerResponse.text();

  expect(unknownPlayerResponse.status()).toBe(404);
  expect(unknownPlayerHtml).toContain('name="robots" content="noindex"');

  const unknownMatchResponse = await request.get("/matches/not-a-real-match");
  const unknownMatchHtml = await unknownMatchResponse.text();

  expect(unknownMatchResponse.status()).toBe(404);
  expect(unknownMatchHtml).toContain('name="robots" content="noindex"');

  await page.goto("/calendar");

  await expect(page.getByRole("heading", { name: "Календарь Серии А" })).toBeVisible();
  await expect(page.getByText(/Календарь появится после синхронизации матчей/)).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${siteOrigin}/calendar`,
  );

  await page.goto("/table");

  await expect(page.getByRole("heading", { name: "Таблица Серии А" })).toBeVisible();
  await expect(page.getByText(/Таблица появится после синхронизации/)).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${siteOrigin}/table`,
  );

  await page.goto("/statistics");

  await expect(page.getByRole("heading", { name: "Статистика Серии А" })).toBeVisible();
  await expect(page.getByText("Данные о бомбардирах пока отсутствуют.")).toBeVisible();
  await expect(page.getByText("Данные о голевых передачах пока отсутствуют.")).toBeVisible();
  await expect(page.getByText("Данные о сыгранных матчах пока отсутствуют.")).toBeVisible();
  await expect(page.getByText("Данные о сыгранных минутах пока отсутствуют.")).toBeVisible();
  await expect(page.getByText("Статистика команд пока отсутствует.")).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${siteOrigin}/statistics`,
  );
});
