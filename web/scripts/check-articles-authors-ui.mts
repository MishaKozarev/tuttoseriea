import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { chromium, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { Pool } from "pg";
import sharp from "sharp";
import { seedArticleStaff, type ArticleStaffFixture } from "./articles-test-helpers.mjs";
import { totpCode } from "./auth-test-helpers";
import { spawnNodeScript, waitForNextReady, stopProcessTree } from "./run-playwright-smoke.mjs";
import { articleTestTargets } from "./articles-test-target";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });
let phase = "preflight";
const runId = randomUUID();
const origin = "http://127.0.0.1:3139";
// Playwright owns and clears test-results; immutable Media fixtures must live elsewhere.
const mediaRoot = resolve(".media-fixtures", `articles-authors-ui-${runId}`);
const newEmail = `created-${runId}@articles-check.invalid`;
const newPassword = `Synthetic created writer ${randomUUID()}`;
const fixtures: ArticleStaffFixture[] = [];

async function main() {
  const { migration } = articleTestTargets(process.env);
  const pool = new Pool({ connectionString: migration.href, max: 2 });
  let server: ReturnType<typeof spawnNodeScript> | undefined;
  let browser: Browser | undefined;
  let externalRequests = 0;
  try {
    const occupied = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) }).then(() => true).catch(() => false);
    assert.equal(occupied, false, "Fixture port is already occupied");
    const beforeJobs = Number((await pool.query("select count(*) from jobs.admin_requests")).rows[0].count);
    const superAdmin = await seedArticleStaff(pool, ["super_admin"]); fixtures.push(superAdmin);
    const existingAdmin = await seedArticleStaff(pool, ["admin"]); fixtures.push(existingAdmin);
    const otherWriter = await seedArticleStaff(pool, ["writer"]); fixtures.push(otherWriter);
    const existingHash = (await pool.query("select password from auth.credential_accounts where user_id=$1 and provider_id='credential'", [existingAdmin.userId])).rows[0].password;
    await mkdir(mediaRoot, { recursive: true });
    await writeFile(resolve(mediaRoot, ".media-environment"), "local\n", { flag: "wx" });
    phase = "built Next startup";
    server = spawnNodeScript(resolve("node_modules/next/dist/bin/next"), ["start", "--hostname", "127.0.0.1", "--port", "3139"], {
      env: { ...process.env, AUTH_URL: origin, AUTH_WRITES_ENABLED: "true", AUTH_TRUSTED_IP_HEADER: "x-real-ip", BETTER_AUTH_SECRET: `synthetic-authors-ui-${randomUUID()}-${randomUUID()}`,
        MEDIA_STORAGE_ROOT: mediaRoot, MEDIA_STORAGE_ENV: "local", EMAIL_DELIVERY_MODE: "disabled", API_FOOTBALL_ENABLE_REAL: "false", FOOTBALL_ADMIN_CONSUMER_ENABLED: "false", NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForNextReady({ child: server });
    // Request output is not an acceptance artifact; keep credentials and cookies out of diagnostics.
    server.stdout?.on("data", () => {}); server.stderr?.on("data", () => {});
    browser = await chromium.launch({ headless: true });
    let contextIndex = 0;
    async function context() {
      const next = await browser!.newContext({ baseURL: origin, extraHTTPHeaders: { "x-real-ip": `2001:db8:${runId.slice(0, 4)}:${(++contextIndex).toString(16)}::1` } });
      await next.route("**/*", async route => {
        if (new URL(route.request().url()).origin !== origin) { externalRequests++; await route.abort(); }
        else await route.continue();
      });
      return next;
    }
    async function login(account: Pick<ArticleStaffFixture, "email" | "password">, target: string, client?: BrowserContext) {
      const next = client ?? await context(), page = await next.newPage();
      await page.goto(`/admin/login?${new URLSearchParams({ returnTo: target })}`);
      await page.getByLabel("Email", { exact: true }).fill(account.email);
      await page.getByLabel("Пароль", { exact: true }).fill(account.password);
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      return { context: next, page };
    }
    async function lookup(page: Page, email: string) {
      await page.getByLabel("Найти аккаунт по email").fill(email);
      const loading = page.waitForResponse(response => response.url().includes("/api/admin/writers?email="));
      await page.getByRole("button", { name: "Обновить список", exact: true }).click();
      assert.equal((await loading).status(), 200);
      await expect(page.getByRole("status")).toContainText("Список обновлён.");
    }

    phase = "anonymous page and API authorization";
    const anonymous = await context(), anonymousPage = await anonymous.newPage();
    for (const path of ["/admin/writers", "/admin/profile"]) {
      await anonymousPage.goto(path); await expect(anonymousPage).toHaveURL(/\/admin\/login\?/);
      assert.equal((await anonymous.request.get(`/api${path}`)).status(), 401);
    }
    phase = "Super Admin real password and mandatory MFA";
    const staff = await login(superAdmin, "/admin/writers");
    await expect(staff.page).toHaveURL(/\/admin\/login\/two-factor/);
    assert.equal((await staff.context.request.get("/api/admin/writers")).status(), 401);
    assert.equal((await staff.context.request.post("/api/admin/writers", { headers: { origin }, data: { action: "create", email: newEmail, password: newPassword, operationId: randomUUID() } })).status(), 401);
    await staff.page.getByLabel("Действующий пароль", { exact: true }).fill(superAdmin.password);
    const enabling = staff.page.waitForResponse(response => response.url().endsWith("/two-factor/enable") && response.request().method() === "POST");
    await staff.page.getByRole("button", { name: "Подключить TOTP" }).click();
    const enrollment = await (await enabling).json() as { totpURI: string };
    await staff.page.getByRole("checkbox", { name: "Я сохранил резервные коды" }).check();
    await staff.page.getByLabel("Код TOTP", { exact: true }).fill(totpCode(enrollment.totpURI));
    await staff.page.getByRole("button", { name: "Подтвердить", exact: true }).click();
    await expect(staff.page.getByRole("heading", { name: "Управление авторами" })).toBeVisible();

    phase = "new Writer through ADMIN";
    await staff.page.getByLabel("Email нового автора").fill(newEmail);
    await staff.page.getByLabel("Пароль нового автора").fill(newPassword);
    await staff.page.getByRole("button", { name: "Создать Writer", exact: true }).click();
    await expect(staff.page.getByRole("status")).toContainText("Автор создан.");
    await expect(staff.page.getByLabel("Пароль нового автора")).toHaveValue("");
    const createdRows = (await pool.query("select u.id as user_id,a.id as account_id from auth.users u join identity.accounts a on a.auth_user_id=u.id where u.email=$1", [newEmail])).rows;
    assert.equal(createdRows.length, 1);
    const created = { userId: createdRows[0].user_id as string, accountId: createdRows[0].account_id as string, email: newEmail, password: newPassword }; fixtures.push(created);
    assert.equal(Number((await pool.query("select count(*) from identity.account_permission_assignments where account_id=$1 and granted", [created.accountId])).rows[0].count), 0);

    phase = "explicit existing Account attachment preserves credentials and roles";
    const beforeAttachment = await login(existingAdmin, "/admin/writers");
    await expect(beforeAttachment.page.getByRole("heading", { name: "Доступ запрещён" })).toBeVisible();
    assert.equal((await beforeAttachment.context.request.get("/api/admin/writers")).status(), 403);
    assert.equal((await beforeAttachment.context.request.get("/api/admin/profile")).status(), 403);
    await lookup(staff.page, existingAdmin.email);
    await staff.page.getByRole("button", { name: `Назначить Writer: ${existingAdmin.email}`, exact: true }).click();
    await expect(staff.page.getByRole("status")).toContainText("назначена роль Writer");
    const identity = (await pool.query("select a.id,u.id as user_id,c.password,array(select role_id from identity.account_roles where account_id=a.id order by role_id) as roles from identity.accounts a join auth.users u on u.id=a.auth_user_id join auth.credential_accounts c on c.user_id=u.id and c.provider_id='credential' where u.email=$1", [existingAdmin.email])).rows[0];
    assert.equal(identity.id, existingAdmin.accountId); assert.equal(identity.user_id, existingAdmin.userId); assert.equal(identity.password, existingHash); assert.deepEqual(identity.roles, ["admin", "writer"]);
    assert.equal((await beforeAttachment.context.request.get("/api/admin/profile")).status(), 401, "Role attachment failed to revoke the previous session");
    const attached = await login(existingAdmin, "/admin/profile");
    await expect(attached.page.getByRole("heading", { name: "Кабинет автора" })).toBeVisible();

    phase = "Writer own public profile and server ownership";
    const author = await login(created, "/admin/profile");
    await expect(author.page.getByRole("heading", { name: "Кабинет автора" })).toBeVisible();
    await expect(author.page.getByText("Самостоятельная публикация собственных статей: не разрешена.", { exact: true })).toBeVisible();
    const nickname = `Автор ${runId.slice(0, 8)}`;
    await author.page.getByLabel("Публичный никнейм").fill(nickname);
    await author.page.getByRole("button", { name: "Добавить ссылку" }).click();
    await author.page.getByLabel("Название ссылки 1").fill("Канал");
    await author.page.getByLabel("Адрес ссылки 1").fill("https://example.invalid/author");
    await author.page.getByRole("button", { name: "Сохранить профиль", exact: true }).click();
    await expect(author.page.getByRole("status")).toHaveText("Профиль сохранён.");
    assert.equal((await pool.query("select email from auth.users where id=$1", [created.userId])).rows[0].email, newEmail);
    assert.equal((await author.context.request.get("/api/admin/writers")).status(), 403);
    assert.equal((await author.context.request.post("/api/admin/writers", { headers: { origin }, data: { action: "attach", accountId: otherWriter.accountId, operationId: randomUUID() } })).status(), 403);
    assert.equal((await author.context.request.patch(`/api/admin/writers/${created.accountId}/publication`, { headers: { origin }, data: { enabled: true, expectedRevision: 0, operationId: randomUUID() } })).status(), 403);
    assert.equal((await author.context.request.patch("/api/admin/profile", { headers: { origin }, data: { accountId: otherWriter.accountId, nickname: "Forged", socialLinks: [], expectedRevision: 0, operationId: randomUUID() } })).status(), 400);

    phase = "individual publication grant and revocation";
    await lookup(staff.page, newEmail);
    await staff.page.getByRole("button", { name: `Разрешить публикацию: ${newEmail}`, exact: true }).click();
    await expect(staff.page.getByRole("status")).toHaveText("Право самостоятельной публикации выдано.");
    await author.page.getByRole("button", { name: "Обновить профиль", exact: true }).click();
    await expect(author.page.getByText("Самостоятельная публикация собственных статей: разрешена.", { exact: true })).toBeVisible();
    await staff.page.getByRole("button", { name: `Отозвать право публикации: ${newEmail}`, exact: true }).click();
    await expect(staff.page.getByRole("status")).toHaveText("Право самостоятельной публикации отозвано.");
    await author.page.getByRole("button", { name: "Обновить профиль", exact: true }).click();
    await expect(author.page.getByText("Самостоятельная публикация собственных статей: не разрешена.", { exact: true })).toBeVisible();

    phase = "real browser avatar upload";
    const firstImage = await sharp({ create: { width: 24, height: 24, channels: 3, background: "#2468ac" } }).png().toBuffer();
    await author.page.getByLabel("Новый аватар").setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: firstImage });
    await author.page.getByRole("button", { name: "Сохранить аватар", exact: true }).click();
    if (process.platform === "win32") {
      await expect(author.page.getByRole("status")).toHaveText("Аватар сохранён.");
      const firstUrl = await author.page.getByAltText("Текущий аватар").getAttribute("src"); assert(firstUrl); assert(firstUrl.startsWith("/media/public/"));
      assert.equal((await anonymous.request.get(firstUrl)).status(), 200);
      const firstAsset = (await pool.query("select m.* from media.assets m join identity.writer_profiles p on p.avatar_media_id=m.id where p.account_id=$1", [created.accountId])).rows[0];
      const bytes = await readFile(resolve(mediaRoot, firstAsset.storage_key));
      assert.equal(bytes.length, Number(firstAsset.byte_size)); assert.equal(createHash("sha256").update(bytes).digest("hex"), firstAsset.sha256);
      const privateUrl = firstUrl.replace("/public/", "/private/");
      phase = "avatar private access and optimizer denial";
      const anonymousPrivate = await anonymous.request.get(privateUrl); assert.equal(anonymousPrivate.status(), 401); assert(anonymousPrivate.headers()["cache-control"]?.includes("no-store"));
      assert.equal((await author.context.request.get(privateUrl)).status(), 200);
      assert.equal((await author.context.request.get(`/_next/image?${new URLSearchParams({ url: firstUrl, w: "640", q: "75" })}`)).status(), 404);
      const secondImage = await sharp({ create: { width: 24, height: 24, channels: 3, background: "#ac6824" } }).png().toBuffer();
      phase = "avatar replacement retains the old immutable file";
      await author.page.getByLabel("Новый аватар").setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: secondImage });
      const replacement = author.page.waitForResponse(response => response.url().endsWith("/api/admin/profile/avatar") && response.request().method() === "POST");
      await author.page.getByRole("button", { name: "Сохранить аватар", exact: true }).click();
      assert.equal((await replacement).status(), 200);
      await expect(author.page.getByRole("status")).toHaveText("Аватар сохранён.");
      await expect(author.page.getByAltText("Текущий аватар")).not.toHaveAttribute("src", firstUrl);
      const secondUrl = await author.page.getByAltText("Текущий аватар").getAttribute("src"); assert(secondUrl); assert.notEqual(secondUrl, firstUrl);
      assert.equal((await anonymous.request.get(firstUrl)).status(), 404); assert.equal((await anonymous.request.get(secondUrl)).status(), 200);
      assert.deepEqual(await readFile(resolve(mediaRoot, firstAsset.storage_key)), bytes, "Replacement changed or deleted the previous immutable file");
      phase = "avatar private access denied to a different authenticated Writer";
      const stranger = await login(otherWriter, "/admin/profile");
      await expect(stranger.page.getByRole("heading", { name: "Кабинет автора" })).toBeVisible();
      assert.equal((await stranger.context.request.get(secondUrl.replace("/public/", "/private/"))).status(), 404);
    } else {
      // Linux native Next intentionally has no bind mount. The production-image check exercises real storage.
      await expect(author.page.getByRole("status")).toContainText("MEDIA_STORAGE_UNAVAILABLE");
      assert.deepEqual(await readdir(mediaRoot), [".media-environment"]);
      assert.equal(Number((await pool.query("select count(*) from media.assets where uploader_account_id=$1", [created.accountId])).rows[0].count), 0);
      await author.page.getByRole("button", { name: "Обновить профиль", exact: true }).click();
    }

    phase = "real stale revision and explicit refresh recovery";
    const current = (await (await author.context.request.get("/api/admin/profile")).json()).profile;
    const concurrent = await author.context.request.patch("/api/admin/profile", { headers: { origin }, data: { nickname: "Обновлено в другой вкладке", socialLinks: [], expectedRevision: current.revision, operationId: randomUUID() } });
    assert.equal(concurrent.status(), 200);
    await author.page.getByLabel("Публичный никнейм").fill("Несохранённый локальный текст");
    await author.page.getByRole("button", { name: "Сохранить профиль", exact: true }).click();
    await expect(author.page.getByRole("status")).toContainText("WRITER_CONFLICT");
    await expect(author.page.getByLabel("Публичный никнейм")).toHaveValue("Несохранённый локальный текст");
    await expect(author.page.getByRole("button", { name: "Сохранить профиль", exact: true })).toBeDisabled();
    await author.page.getByRole("button", { name: "Обновить профиль", exact: true }).click();
    await expect(author.page.getByLabel("Публичный никнейм")).toHaveValue("Обновлено в другой вкладке");
    await author.page.setViewportSize({ width: 390, height: 844 });
    assert(await author.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Writer profile overflows mobile viewport");
    await staff.page.setViewportSize({ width: 390, height: 844 });
    assert(await staff.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Writer management overflows mobile viewport");
    phase = "disabled Writer loses actions while current avatar remains public";
    await pool.query("update identity.accounts set status='disabled' where id=$1", [created.accountId]);
    assert.equal((await author.context.request.get("/api/admin/profile")).status(), 401);
    if (process.platform === "win32") {
      const currentAvatar = await author.page.getByAltText("Текущий аватар").getAttribute("src"); assert(currentAvatar);
      assert.equal((await anonymous.request.get(currentAvatar)).status(), 200, "Disabling a fixture Account hid its current public avatar");
    }
    assert.equal(externalRequests, 0); assert.equal(Number((await pool.query("select count(*) from jobs.admin_requests")).rows[0].count), beforeJobs);
    assert((await pool.query("select email_verified_flag from auth.users where id=any($1::text[])", [fixtures.map(fixture => fixture.userId)])).rows.every(row => row.email_verified_flag === false));
    console.log(`articles_authors_ui_check=passed accounts=fixture-only identity=preserved mfa=real permissions=grant-revoke ownership=server cas=real provider_requests=0 avatar=${process.platform === "win32" ? "real-upload" : "no-bind-denied;production-image-checked-separately"}`);
    console.log(`retained_fixture_media=${mediaRoot}`);
  } finally {
    await browser?.close().catch(() => undefined);
    if (server) await stopProcessTree(server);
    // A lost create response may still have committed; discover only this run's exact generated address.
    const created = (await pool.query("select u.id as user_id,a.id as account_id from auth.users u join identity.accounts a on a.auth_user_id=u.id where u.email=$1", [newEmail])).rows;
    for (const row of created) if (!fixtures.some(fixture => fixture.userId === row.user_id)) fixtures.push({ userId: row.user_id, accountId: row.account_id, email: newEmail, password: newPassword });
    const accountIds = fixtures.map(fixture => fixture.accountId), userIds = fixtures.map(fixture => fixture.userId);
    try {
      assert.equal(Number((await pool.query("select count(*) from identity.account_permission_assignments where changed_by_account_id=any($1::text[]) and not(account_id=any($1::text[]))", [accountIds])).rows[0].count), 0, "Fixture touched a foreign Account");
      await pool.query("delete from identity.account_permission_assignments where account_id=any($1::text[])", [accountIds]);
      await pool.query("delete from identity.writer_profiles where account_id=any($1::text[])", [accountIds]);
      await pool.query("delete from identity.writer_operation_receipts where actor_account_id=any($1::text[]) or target_account_id=any($1::text[])", [accountIds]);
      await pool.query("delete from media.assets where uploader_account_id=any($1::text[])", [accountIds]);
      await pool.query("delete from auth.security_audit where target_account_id=any($1::text[])", [accountIds]);
      await pool.query("delete from auth.users where id=any($1::text[])", [userIds]);
      assert.equal(Number((await pool.query("select count(*) from auth.users where id=any($1::text[])", [userIds])).rows[0].count), 0);
    } finally { await pool.end(); }
    // Immutable fixture files are retained; there is no physical deletion or orphan cleanup.
  }
}

main().catch((error: unknown) => {
  console.error(`articles_authors_ui_check=failed phase=${phase} type=${error instanceof Error ? error.name : "unknown"}`);
  process.exitCode = 1;
});
