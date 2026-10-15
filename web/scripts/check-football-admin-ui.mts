import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { chromium, expect, type Browser } from "@playwright/test";
import { Pool } from "pg";

import { spawnNodeScript, waitForNextReady, stopProcessTree } from "./run-playwright-smoke.mjs";
import { synchronizationFixture } from "../tests/fixtures/football-synchronization";
import type { SynchronizationCommand } from "../src/admin/football-synchronization-client";
import { parseAdminJobCommand } from "../src/jobs/admin-contract";
import { localizationFixture } from "../tests/fixtures/football-localization";
import { parseLocalizationEdit, type FootballLocalizationEntity } from "../src/football/localization-management";
import { resolveFootballProperName } from "../src/football/localization";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });
let phase = "preflight";

async function main() {
  const migration = new URL(process.env.MIGRATION_DATABASE_URL ?? "");
  const runtime = new URL(process.env.DATABASE_URL ?? "");
  for (const url of [migration, runtime]) {
    assert(["127.0.0.1", "localhost"].includes(url.hostname), "Only loopback PostgreSQL is allowed");
    assert(url.port === "15432" || (process.env.CI === "true" && url.port === "5432" && url.pathname === "/tuttoseriea_ci"), "Only LOCAL/exact CI PostgreSQL is allowed");
  }
  assert.equal(migration.host, runtime.host); assert.equal(migration.pathname, runtime.pathname);
  const pool = new Pool({ connectionString: migration.toString(), max: 1 });
  const identities = ["writer", "admin", "super_admin"].map((role) => ({ role, userId: randomUUID(), accountId: randomUUID(), token: randomUUID() }));
  const origin = "http://127.0.0.1:3119";
  const pagePath = "/admin/football/synchronization";
  let server: ReturnType<typeof spawnNodeScript> | undefined;
  let browser: Browser | undefined;
  const count = async () => (await pool.query<{ count: number }>("select count(*)::int as count from jobs.admin_requests")).rows[0].count;
  try {
    const before = await count();
    await pool.query("begin");
    for (const identity of identities) {
      await pool.query("insert into auth.users (id, email) values ($1, $2)", [identity.userId, `${identity.userId}@synchronization-check.invalid`]);
      await pool.query("insert into identity.accounts (id, auth_user_id) values ($1, $2)", [identity.accountId, identity.userId]);
      await pool.query("insert into identity.account_roles (account_id, role_id) values ($1, $2)", [identity.accountId, identity.role]);
      await pool.query("insert into auth.sessions (session_token, user_id, expires) values ($1, $2, $3)", [identity.token, identity.userId, new Date(Date.now() + 60 * 60 * 1000)]);
    }
    await pool.query("commit");
    phase = "LOCAL Next startup";
    server = spawnNodeScript(resolve("node_modules/next/dist/bin/next"), ["start", "--hostname", "127.0.0.1", "--port", "3119"], {
      env: { ...process.env, AUTH_URL: origin, AUTH_SECRET: "local-only-football-admin-browser-fixture-secret",
        AUTH_STAFF_EMAIL_DELIVERY: "disabled", API_FOOTBALL_ENABLE_REAL: "false", FOOTBALL_ADMIN_CONSUMER_ENABLED: "false", NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForNextReady({ child: server });
    phase = "Chromium startup";
    browser = await chromium.launch({ headless: true });
    let externalRequests = 0;
    const localContext = async () => {
      const context = await browser!.newContext({ baseURL: origin });
      await context.route("**/*", async (route) => {
        if (new URL(route.request().url()).origin !== origin) { externalRequests++; await route.abort(); }
        else await route.continue();
      });
      return context;
    };
    const anonymous = await localContext();
    const anonymousPage = await anonymous.newPage();
    phase = "anonymous authorization";
    await anonymousPage.goto(pagePath);
    await expect(anonymousPage).toHaveURL(/\/admin\/login\?/);
    assert.equal(new URL(anonymousPage.url()).pathname, "/admin/login");
    assert.equal(new URL(anonymousPage.url()).searchParams.get("returnTo"), pagePath);
    assert.equal((await anonymous.request.get("/api/admin/football/jobs")).status(), 401);
    await anonymousPage.goto("/admin/football/localization");
    await expect(anonymousPage).toHaveURL(/\/admin\/login\?/);
    assert.equal(new URL(anonymousPage.url()).searchParams.get("returnTo"), "/admin/football/localization");
    assert.equal((await anonymous.request.get("/api/admin/football/localization")).status(), 401);
    assert.equal((await anonymous.request.patch("/api/admin/football/localization/clubs/fixture", { data: {}, headers: { origin } })).status(), 401);
    await anonymousPage.goto("/admin/football/data");
    await expect(anonymousPage).toHaveURL(/\/admin\/login\?/);
    assert.equal(new URL(anonymousPage.url()).searchParams.get("returnTo"), "/admin/football/data");
    await anonymous.close();
    for (const identity of identities) {
      phase = `${identity.role} authorization`;
      const context = await localContext();
      await context.addCookies([{ name: "authjs.session-token", value: identity.token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
      const page = await context.newPage();
      const response = await page.goto(pagePath);
      if (identity.role !== "super_admin") {
        await expect(page.getByRole("heading", { name: "Доступ запрещён" })).toBeVisible();
        // Next can stream a 200 shell before forbidden(); protected UI must never render.
        assert([200, 403].includes(response?.status() ?? 0));
        await expect(page.getByRole("radio")).toHaveCount(0);
        assert.equal((await context.request.get("/api/admin/football/jobs")).status(), 403);
        await page.goto("/admin/football/localization");
        await expect(page.getByRole("heading", { name: "Доступ запрещён" })).toBeVisible();
        await expect(page.getByRole("textbox", { name: "Русское название (name_ru)" })).toHaveCount(0);
        assert.equal((await context.request.get("/api/admin/football/localization")).status(), 403);
        assert.equal((await context.request.patch("/api/admin/football/localization/clubs/fixture", { data: {}, headers: { origin } })).status(), 403);
        await page.goto("/admin/football/data?view=players");
        await expect(page.getByRole("heading", { name: "Доступ запрещён" })).toBeVisible();
        await expect(page.getByRole("searchbox")).toHaveCount(0);
      } else {
        assert.equal(response?.status(), 200);
        assert.equal((await context.request.get("/api/admin/football/jobs")).status(), 200);
        let record: ReturnType<typeof synchronizationFixture> | null = null;
        const commands: SynchronizationCommand[] = [];
        // All browser traffic stays local. POST admissions below are fake, never live jobs.
        await context.route("**/*", async (route) => {
          if (new URL(route.request().url()).origin !== origin) { externalRequests++; await route.abort(); return; }
          if (!new URL(route.request().url()).pathname.startsWith("/api/admin/football/jobs")) { await route.continue(); return; }
          if (route.request().method() === "POST") {
            const command = route.request().postDataJSON() as SynchronizationCommand;
            parseAdminJobCommand(command);
            commands.push(command);
            record ??= { ...synchronizationFixture(), actorAccountId: identity.accountId, requestKey: command.requestKey };
            if (commands.length === 1) { await route.abort("failed"); return; }
            await route.fulfill({ json: { requestId: record.id, executionId: record.execution.id, deduplicated: true } });
          } else await route.fulfill({ json: { requests: record ? [record] : [] } });
        });
        await page.reload();
        phase = "confirmation and lost response";
        const refresh = page.getByRole("button", { name: "Обновить состояние" });
        await expect(refresh).toBeEnabled();
        await expect(page.getByRole("radio")).toHaveCount(8);
        const launch = page.getByRole("button", { name: "Отправить запрос на запуск" });
        await expect(launch).toBeDisabled();
        await page.getByRole("checkbox").check(); await launch.click();
        await expect(page.getByRole("main").getByRole("alert")).toContainText("NETWORK_ERROR");
        await page.getByRole("button", { name: "Повторить тот же запрос" }).click();
        await expect(page.getByRole("main").getByRole("status")).toContainText("исходный execution");
        await expect(refresh).toBeEnabled();
        const detail = page.getByRole("region", { name: "Состояние execution" });
        await expect(detail).toContainText("(pending)");
        await expect(detail).toContainText("Если Admin consumer не активен");
        assert.equal(commands.length, 2); assert.deepEqual(commands[0], commands[1]);
        const accepted = (() : ReturnType<typeof synchronizationFixture> | null => record)();
        assert(accepted);
        phase = "status refresh";
        for (const status of ["running", "succeeded"] as const) {
          accepted.execution.status = status; accepted.execution.attemptCount = 1;
          await refresh.click(); await expect(refresh).toBeEnabled();
          await expect(detail).toContainText(`(${status})`);
        }
        assert.equal(commands.length, 2, "GET refresh repeated the POST");
        await expect(page.getByRole("checkbox")).not.toBeChecked();
        await expect(page.getByRole("button", { name: "Отправить запрос на запуск" })).toBeDisabled();
        phase = "mobile layout";
        await page.setViewportSize({ width: 390, height: 844 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Synchronization UI overflows mobile viewport");
        assert.equal(externalRequests, 0, "Unexpected external browser request");
        phase = "localization browser flow";
        assert.equal((await context.request.get("/api/admin/football/localization")).status(), 200);
        let localized: FootballLocalizationEntity = localizationFixture();
        let writes = 0;
        // Intercept every localization PATCH: browser checks never mutate canonical names.
        await context.route("**/api/admin/football/localization**", async (route) => {
          if (route.request().method() === "PATCH") {
            writes++;
            const edit = parseLocalizationEdit(route.request().postDataJSON());
            if (edit.expectedRevision !== localized.localizationRevision) {
              await route.fulfill({ status: 409, json: { error: { code: "LOCALIZATION_CONFLICT", message: "Fixture conflict", requestId: "localization-browser" } } }); return;
            }
            localized = { ...localized, nameRu: edit.nameRu, nameRuReviewStatus: edit.action === "review" ? "reviewed" : "unreviewed", localizationRevision: localized.localizationRevision + 1 };
            localized.displayName = resolveFootballProperName({ providerName: localized.providerName, nameRu: localized.nameRu, reviewStatus: localized.nameRuReviewStatus });
          }
          await route.fulfill({ json: new URL(route.request().url()).search
            ? { items: [localized], total: 1, page: 1, pageSize: 20, totalPages: 1 } : { entity: localized } });
        });
        await page.goto("/admin/football/localization");
        const find = page.getByRole("button", { name: "Найти" });
        await expect(find).toBeEnabled();
        await page.getByRole("button", { name: "Редактировать Fixture Club" }).click();
        const name = page.getByRole("textbox", { name: "Русское название (name_ru)" });
        const save = page.getByRole("button", { name: "Сохранить как unreviewed" });
        const review = page.getByRole("button", { name: "Подтвердить как reviewed" });
        const editor = page.getByRole("region", { name: "Русское название: Fixture Club" });
        await name.fill("Тестовое имя"); await save.click(); await expect(find).toBeEnabled();
        await expect(editor).toContainText("Не подтверждено (unreviewed)");
        await expect(editor).toContainText("Публичное название: Fixture Club");
        await expect(review).toBeDisabled();
        await page.getByRole("checkbox").check(); await review.click(); await expect(find).toBeEnabled();
        await expect(editor).toContainText("Подтверждено (reviewed)");
        await expect(editor).toContainText("Публичное название: Тестовое имя");
        assert.equal(writes, 2);
        await name.fill("Мой черновик");
        localized = { ...localized, nameRu: "Чужая правка", nameRuReviewStatus: "unreviewed", localizationRevision: 3, displayName: localized.providerName };
        await save.click(); await expect(find).toBeEnabled();
        await expect(page.getByRole("main").getByRole("alert")).toContainText("LOCALIZATION_CONFLICT");
        await expect(name).toHaveValue("Мой черновик"); await expect(save).toBeDisabled();
        await page.getByRole("button", { name: "Загрузить актуальную версию" }).click(); await expect(find).toBeEnabled();
        await expect(name).toHaveValue("Чужая правка");
        assert.equal(writes, 3, "GET reconciliation repeated a mutation");
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Localization UI overflows mobile viewport");
        assert.equal(externalRequests, 0);
        phase = "Football Data read browser flow";
        for (const [view, title] of [["clubs", "Клубы"], ["players", "Игроки"], ["matches", "Матчи"], ["standings", "Турнирная таблица"]]) {
          assert.equal((await page.goto(`/admin/football/data?view=${view}`))?.status(), 200);
          await expect(page.getByRole("heading", { name: "Football данные", exact: true })).toBeVisible();
          await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
          await expect(page.getByRole("link", { name: "Обновить данные из PostgreSQL" })).toBeVisible();
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Data ${view} overflows mobile viewport`);
        }
        await page.goto("/admin/football/data?view=matches");
        await page.getByRole("searchbox").fill("missing-data-browser-fixture");
        await page.getByLabel("Статус", { exact: true }).selectOption("finished");
        await page.getByRole("button", { name: "Найти", exact: true }).click();
        await expect(page).toHaveURL(/query=missing-data-browser-fixture/);
        await expect(page.getByText("По заданным условиям ничего не найдено.")).toBeVisible();
        assert.equal(new URL(page.url()).searchParams.get("status"), "finished");
        assert.equal(commands.length, 2, "Data reads admitted a job");
        assert.equal(writes, 3, "Data reads edited localization");
        assert.equal(externalRequests, 0);
      }
      await context.close();
    }
    assert.equal(await count(), before, "Browser check admitted a live Admin request");
  } catch (error) {
    if (error instanceof Error && ["confirmation and lost response", "status refresh", "mobile layout", "localization browser flow", "Football Data read browser flow"].includes(phase)) {
      let diagnostic = error.message;
      for (const identity of identities) diagnostic = diagnostic.replaceAll(identity.token, "[REDACTED]");
      console.error(diagnostic.replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED]").slice(0, 1800));
    }
    throw error;
  } finally {
    phase = `cleanup after ${phase}`;
    await browser?.close().catch(() => undefined);
    if (server) await stopProcessTree(server);
    await pool.query("rollback").catch(() => undefined);
    await pool.query("delete from auth.users where id = any($1::text[])", [identities.map((identity) => identity.userId)]);
    assert.equal((await pool.query<{ count: number }>("select count(*)::int as count from auth.users where id = any($1::text[])", [identities.map((identity) => identity.userId)])).rows[0].count, 0);
    await pool.end();
  }
  console.log("football_admin_ui_check=passed");
  console.log("football_admin_ui_auth_matrix=anonymous_writer_admin_super_admin");
  console.log("football_admin_ui_confirmation_replay_get_refresh_mobile=true");
  console.log("football_admin_ui_localization_save_review_conflict_reload_mobile=true");
  console.log("football_admin_ui_data_read_auth_tabs_search_filters_mobile=true");
  console.log("real_admissions=0 provider_requests=0 fixture_cleanup=complete");
}

main().catch((error: unknown) => {
  // Never print session cookies or connection strings from browser/DB errors.
  console.error("football_admin_ui_check=failed", phase, error instanceof assert.AssertionError ? error.message :
    { name: error instanceof Error ? error.name : "UnknownError", code: (error as { code?: string })?.code });
  process.exitCode = 1;
});
