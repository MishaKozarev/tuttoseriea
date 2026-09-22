import { expect, test } from "@playwright/test";

test("web bootstrap smoke", async ({ page, request }) => {
  await page.goto("/");

  await expect(page.getByText("Bootstrap E2E marker")).toBeVisible();

  const response = await request.get("/api/health");

  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ status: "ok" });
});
