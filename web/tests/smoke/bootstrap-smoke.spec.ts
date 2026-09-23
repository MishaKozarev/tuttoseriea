import { expect, test } from "@playwright/test";

test("web public shell smoke", async ({ page, request }) => {
  await page.goto("/");

  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Serie A на русском");
  await expect(page.getByRole("contentinfo")).toBeVisible();

  const response = await request.get("/api/health");

  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ status: "ok" });
});
