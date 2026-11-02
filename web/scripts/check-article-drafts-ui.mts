import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { chromium, expect, type APIResponse, type Browser, type BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import sharp from "sharp";
import { seedArticleStaff, type ArticleStaffFixture } from "./articles-test-helpers.mjs";
import { articleTestTargets } from "./articles-test-target";
import { totpCode } from "./auth-test-helpers";
import { spawnNodeScript, waitForNextReady, stopProcessTree } from "./run-playwright-smoke.mjs";
import type { ArticleDraftDTO, ArticleImageDTO, ArticleSaveInput } from "../src/articles/contract";
import type { ArticleDocument } from "../src/articles/document";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });
let phase = "preflight";
const runId = randomUUID();
const origin = "http://127.0.0.1:3138";
const mediaRoot = resolve(".media-fixtures", `article-drafts-ui-${runId}`);
const fixtures: ArticleStaffFixture[] = [];
const categoryIds = [randomUUID(), randomUUID()];
const sources = [
  { table: "clubs", column: "club_id", providerId: "provider_club_id", id: randomUUID(), tagId: randomUUID(), label: `Fixture ${runId.slice(0, 8)} Club` },
  { table: "players", column: "player_id", providerId: "provider_player_id", id: randomUUID(), tagId: randomUUID(), label: `Fixture ${runId.slice(0, 8)} Player` },
  { table: "coaches", column: "coach_id", providerId: "provider_coach_id", id: randomUUID(), tagId: randomUUID(), label: `Fixture ${runId.slice(0, 8)} Coach` },
  { table: "competitions", column: "competition_id", providerId: "provider_competition_id", id: randomUUID(), tagId: randomUUID(), label: `Fixture ${runId.slice(0, 8)} Competition` },
] as const;
const categoryNames = categoryIds.map((_, index) => `Draft fixture ${runId} ${index + 1}`);

function saveInput(draft: ArticleDraftDTO, override: Partial<ArticleSaveInput> = {}): ArticleSaveInput {
  return { operationId: randomUUID(), expectedRevision: draft.revision, formatVersion: 1, content: draft.content,
    h1: draft.h1, seoTitle: draft.seoTitle, metaDescription: draft.metaDescription, slug: draft.slug,
    categoryIds: draft.categoryIds, tagIds: draft.tagIds, ...override };
}
function noStore(headers: Record<string, string>) {
  assert(headers["cache-control"]?.includes("no-store"), "Protected response is missing no-store");
}
async function main() {
  // Validate both DSNs before constructing any pool, exactly like the accepted
  // Authors checks. Never permit a remote or DSN-query-overridden target.
  const targets = articleTestTargets(process.env);
  const pool = new Pool({ connectionString: targets.migration.href, max: 3 });
  const runtime = new Pool({ connectionString: targets.runtime.href, max: 2 });
  let browser: Browser | undefined;
  let server: ReturnType<typeof spawnNodeScript> | undefined;
  let externalRequests = 0;
  try {
    assert.equal(await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) }).then(() => true).catch(() => false), false, "Fixture port is occupied");
    const beforeJobs = Number((await pool.query("select count(*) from jobs.admin_requests")).rows[0].count);
    const writer = await seedArticleStaff(pool, ["writer"]); fixtures.push(writer);
    const other = await seedArticleStaff(pool, ["writer"]); fixtures.push(other);
    const admin = await seedArticleStaff(pool, ["admin"]); fixtures.push(admin);
    const superAdmin = await seedArticleStaff(pool, ["super_admin"]); fixtures.push(superAdmin);
    phase = "synthetic taxonomy fixtures";
    const seed = await pool.connect();
    try {
      await seed.query("begin");
      for (const [index, id] of categoryIds.entries()) await seed.query("insert into article.categories(id,name) values($1,$2)", [id, categoryNames[index]]);
      for (const source of sources) {
        // Table/column names are the fixed source allowlist above, never input.
        const columns = source.table === "coaches" ? "" : ",slug";
        const values = source.table === "coaches" ? "" : ",$4";
        await seed.query(`insert into football.${source.table}(id,provider,${source.providerId},provider_name,name_ru,name_ru_review_status${columns})
          values($1,$2,1,$3,$3,'reviewed'${values})`, source.table === "coaches" ?
          [source.id, `article-fixture-${runId}`, source.label] : [source.id, `article-fixture-${runId}`, source.label, `article-fixture-${runId}-${source.table}`]);
        await seed.query(`insert into taxonomy.football_tags(id,${source.column}) values($1,$2)`, [source.tagId, source.id]);
      }
      await seed.query("commit");
    } catch (error) { await seed.query("rollback"); throw error; }
    finally { seed.release(); }
    await mkdir(mediaRoot, { recursive: true });
    await writeFile(resolve(mediaRoot, ".media-environment"), "local\n", { flag: "wx" });
    phase = "built Next startup";
    server = spawnNodeScript(resolve("node_modules/next/dist/bin/next"), ["start", "--hostname", "127.0.0.1", "--port", "3138"], {
      env: { ...process.env, AUTH_URL: origin, AUTH_WRITES_ENABLED: "true", AUTH_TRUSTED_IP_HEADER: "x-real-ip", BETTER_AUTH_SECRET: `synthetic-drafts-ui-${randomUUID()}-${randomUUID()}`,
        MEDIA_STORAGE_ROOT: mediaRoot, MEDIA_STORAGE_ENV: "local", EMAIL_DELIVERY_MODE: "disabled", API_FOOTBALL_ENABLE_REAL: "false", FOOTBALL_ADMIN_CONSUMER_ENABLED: "false", NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForNextReady({ child: server });
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
    async function login(account: ArticleStaffFixture, target: string) {
      const next = await context(), page = await next.newPage();
      await page.goto(`/admin/login?${new URLSearchParams({ returnTo: target })}`);
      await page.getByLabel("Email", { exact: true }).fill(account.email);
      await page.getByLabel("Пароль", { exact: true }).fill(account.password);
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      return { context: next, page };
    }
    async function getDraft(client: BrowserContext, id: string): Promise<ArticleDraftDTO> {
      const response = await client.request.get(`/api/admin/articles/${id}`);
      assert.equal(response.status(), 200); noStore(response.headers());
      return (await response.json()).draft;
    }
    async function createDraft(client: BrowserContext): Promise<ArticleDraftDTO> {
      const response = await client.request.post("/api/admin/articles", { headers: { origin }, data: { operationId: randomUUID() } });
      assert.equal(response.status(), 201); return (await response.json()).draft;
    }
    phase = "anonymous, Admin and pre-MFA admission";
    const anonymous = await context(), anonymousPage = await anonymous.newPage();
    await anonymousPage.goto("/admin/articles"); await expect(anonymousPage).toHaveURL(/\/admin\/login\?/);
    assert.equal((await anonymous.request.get("/api/admin/articles")).status(), 401);
    const ordinaryAdmin = await login(admin, "/admin/articles");
    await expect(ordinaryAdmin.page.getByRole("heading", { name: "Доступ запрещён" })).toBeVisible();
    assert.equal((await ordinaryAdmin.context.request.get("/api/admin/articles")).status(), 403);
    const staff = await login(superAdmin, "/admin/articles");
    await expect(staff.page).toHaveURL(/\/admin\/login\/two-factor/);
    assert.equal((await staff.context.request.get("/api/admin/articles")).status(), 401);
    await staff.page.getByLabel("Действующий пароль", { exact: true }).fill(superAdmin.password);
    const enabling = staff.page.waitForResponse(response => response.url().endsWith("/two-factor/enable") && response.request().method() === "POST");
    await staff.page.getByRole("button", { name: "Подключить TOTP" }).click();
    const enrollment = await (await enabling).json() as { totpURI: string };
    await staff.page.getByRole("checkbox", { name: "Я сохранил резервные коды" }).check();
    await staff.page.getByLabel("Код TOTP", { exact: true }).fill(totpCode(enrollment.totpURI));
    await staff.page.getByRole("button", { name: "Подтвердить", exact: true }).click();
    await expect(staff.page.getByRole("heading", { name: "Черновики статей" })).toBeVisible();

    phase = "Writer creates and edits through real UI without publication permission";
    const author = await login(writer, "/admin/articles");
    const stranger = await login(other, "/admin/articles");
    await expect(author.page.getByRole("heading", { name: "Черновики статей" })).toBeVisible();
    await author.page.getByRole("link", { name: "Новая статья", exact: true }).click();
    await expect(author.page.getByRole("heading", { name: "Новая статья" })).toBeVisible();
    const creating = author.page.waitForResponse(response => response.url().endsWith("/api/admin/articles") && response.request().method() === "POST");
    await author.page.getByRole("button", { name: "Создать черновик", exact: true }).click();
    const createdResponse = await creating; assert.equal(createdResponse.status(), 201);
    let draft = (await createdResponse.json()).draft as ArticleDraftDTO;
    await expect(author.page.getByRole("heading", { name: "Редактор статьи", exact: true })).toBeVisible();
    assert.equal(draft.authorAccountId, writer.accountId);
    assert.equal(Number((await pool.query("select count(*) from identity.account_permission_assignments where account_id=$1 and granted", [writer.accountId])).rows[0].count), 0);
    await author.page.getByLabel("Заголовок H1", { exact: true }).fill("Локальный редакционный черновик");
    await author.page.getByLabel("SEO title", { exact: true }).fill("Ручной SEO title");
    await author.page.getByLabel("Meta description", { exact: true }).fill("Ручное описание статьи");
    await author.page.getByLabel("Slug", { exact: true }).fill(`draft-${runId}`);
    const editor = author.page.getByRole("textbox", { name: "Текст статьи", exact: true });
    await editor.fill("Первый абзац редактора");
    await author.page.getByRole("button", { name: "Жирный", exact: true }).click();
    await editor.press("End"); await editor.pressSequentially(" Выделенный текст");
    await author.page.getByRole("button", { name: "Жирный", exact: true }).click();
    await author.page.getByLabel("Поиск категорий", { exact: true }).fill(`Draft fixture ${runId}`);
    await author.page.getByRole("button", { name: "Найти категории", exact: true }).click();
    for (const name of categoryNames) await author.page.getByRole("checkbox", { name, exact: true }).check();
    await author.page.getByLabel("Поиск Football Tags", { exact: true }).fill(`Fixture ${runId.slice(0, 8)}`);
    await author.page.getByRole("button", { name: "Найти теги", exact: true }).click();
    for (const source of sources) await author.page.getByRole("checkbox", { name: new RegExp(source.label) }).check();
    const saving = author.page.waitForResponse(response => response.url().endsWith(`/api/admin/articles/${draft.id}`) && response.request().method() === "PATCH");
    await author.page.getByRole("button", { name: "Сохранить черновик", exact: true }).click();
    assert.equal((await saving).status(), 200);
    await expect(author.page.getByText("Черновик сохранён.", { exact: true })).toBeVisible();
    draft = await getDraft(author.context, draft.id);
    assert.equal(draft.h1, "Локальный редакционный черновик"); assert.equal(draft.seoTitle, "Ручной SEO title");
    assert.equal(draft.metaDescription, "Ручное описание статьи"); assert.equal(draft.slug, `draft-${runId}`);
    assert.deepEqual([...draft.categoryIds].sort(), [...categoryIds].sort()); assert.deepEqual([...draft.tagIds].sort(), sources.map(s => s.tagId).sort());
    assert(JSON.stringify(draft.content).includes("Выделенный текст")); assert(JSON.stringify(draft.content).includes('"bold"'));
    await author.page.reload(); await expect(editor).toContainText("Выделенный текст");
    await expect(author.page.getByLabel("SEO title", { exact: true })).toHaveValue("Ручной SEO title");

    phase = "ownership, no public draft representation and rich-text roundtrip";
    assert.equal((await stranger.context.request.get(`/api/admin/articles/${draft.id}`)).status(), 404);
    assert.equal((await stranger.context.request.patch(`/api/admin/articles/${draft.id}`, { headers: { origin }, data: saveInput(draft) })).status(), 404);
    const preview = await author.context.request.get(`/admin/articles/${draft.id}/preview`); assert.equal(preview.status(), 200); noStore(preview.headers());
    const rich: ArticleDocument = { type: "doc", content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Разбор тура" }] },
      { type: "paragraph", content: [{ type: "text", text: "Выделение", marks: [{ type: "bold" }, { type: "italic" }] }, { type: "text", text: " и ссылка", marks: [{ type: "link", attrs: { href: "https://example.invalid/editorial" } }] }] },
      { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Цитата автора" }] }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Пункт списка" }] }] }] },
      { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Третий пункт" }] }] }] },
    ] };
    const richSaved = await author.context.request.patch(`/api/admin/articles/${draft.id}`, { headers: { origin }, data: saveInput(draft, { content: rich }) });
    assert.equal(richSaved.status(), 200); draft = await getDraft(author.context, draft.id); assert.deepEqual(draft.content, rich);
    await author.page.reload(); await expect(editor.getByRole("heading", { name: "Разбор тура" })).toBeVisible();
    assert.equal((await author.context.request.patch(`/api/admin/articles/${draft.id}`, { headers: { origin }, data: { ...saveInput(draft), authorAccountId: other.accountId } })).status(), 400);
    assert.equal((await author.context.request.patch(`/api/admin/articles/${draft.id}`, { headers: { origin }, data: { ...saveInput(draft), published: true } })).status(), 400);

    phase = "concurrent CAS, idempotency and reference rollback";
    const race = await Promise.all(["Изменение A", "Изменение B"].map(h1 => author.context.request.patch(`/api/admin/articles/${draft.id}`, { headers: { origin }, data: saveInput(draft, { h1 }) })));
    assert.deepEqual(race.map(r => r.status()).sort(), [200, 409]);
    const raceDraft = await getDraft(author.context, draft.id); assert.equal(raceDraft.revision, draft.revision + 1); draft = raceDraft;
    const replayPayload = saveInput(draft, { h1: "Операция повторно не применяется" });
    assert.equal((await author.context.request.patch(`/api/admin/articles/${draft.id}`, { headers: { origin }, data: replayPayload })).status(), 200);
    const once = await getDraft(author.context, draft.id);
    assert.equal((await author.context.request.patch(`/api/admin/articles/${draft.id}`, { headers: { origin }, data: replayPayload })).status(), 200);
    assert.deepEqual(await getDraft(author.context, draft.id), once); draft = once;
    for (const bad of [
      { categoryIds: [randomUUID()] }, { tagIds: [randomUUID()] },
      { content: { type: "doc", content: [{ type: "articleImage", attrs: { assetId: randomUUID(), alt: "Не связанное изображение", caption: "" } }] } as ArticleDocument },
    ]) {
      const response = await author.context.request.patch(`/api/admin/articles/${draft.id}`, { headers: { origin }, data: saveInput(draft, bad) });
      assert.equal(response.status(), 400); noStore(response.headers());
      assert.deepEqual(await getDraft(author.context, draft.id), draft, "Rejected reference partially changed the draft");
    }
    // Adversarial fixture corruption: an association alone must not turn an
    // avatar-purpose asset into Article content. No physical file is created.
    const wrongPurposeId = randomUUID();
    try {
      await pool.query(`insert into media.assets(id,storage_key,kind,mime_type,byte_size,width,height,sha256,uploader_account_id)
        values($1,$2,'avatar','image/webp',20,10,10,$3,$4)`, [wrongPurposeId, `${wrongPurposeId}.webp`, "a".repeat(64), writer.accountId]);
      await pool.query("insert into article.draft_images(draft_id,media_id) values($1,$2)", [draft.id, wrongPurposeId]);
      assert.deepEqual(await getDraft(author.context, draft.id), draft, "Draft DTO exposed a wrong-purpose image attachment");
      const wrongPurposeSave = await author.context.request.patch(`/api/admin/articles/${draft.id}`, { headers: { origin }, data: saveInput(draft, {
        content: { type: "doc", content: [{ type: "articleImage", attrs: { assetId: wrongPurposeId, alt: "Неверное назначение", caption: "" } }] },
      }) });
      assert.equal(wrongPurposeSave.status(), 400); noStore(wrongPurposeSave.headers());
      assert.equal((await wrongPurposeSave.json()).error.code, "ARTICLE_IMAGE_NOT_ATTACHED");
      assert.deepEqual(await getDraft(author.context, draft.id), draft, "Wrong-purpose image partially changed the draft");
    } finally {
      await pool.query("delete from article.draft_images where draft_id=$1 and media_id=$2", [draft.id, wrongPurposeId]);
      await pool.query("delete from media.assets where id=$1 and uploader_account_id=$2 and kind='avatar'", [wrongPurposeId, writer.accountId]);
    }
    const duplicate = await createDraft(author.context);
    const duplicateSave = await author.context.request.patch(`/api/admin/articles/${duplicate.id}`, { headers: { origin }, data: saveInput(duplicate, { slug: draft.slug }) });
    assert.equal(duplicateSave.status(), 409); assert.equal((await duplicateSave.json()).error.code, "ARTICLE_SLUG_CONFLICT");
    assert.deepEqual(await getDraft(author.context, duplicate.id), duplicate);

    phase = "browser conflict preserves edits and requires an explicit choice";
    await author.page.getByLabel("Заголовок H1", { exact: true }).fill("Несохранённый текст после конфликта");
    const conflicting = author.page.waitForResponse(response => response.url().endsWith(`/api/admin/articles/${draft.id}`) && response.request().method() === "PATCH");
    await author.page.getByRole("button", { name: "Сохранить черновик", exact: true }).click();
    assert.equal((await conflicting).status(), 409);
    await expect(author.page.getByLabel("Заголовок H1", { exact: true })).toHaveValue("Несохранённый текст после конфликта");
    await expect(author.page.getByRole("button", { name: "Сохранить черновик", exact: true })).toBeDisabled();
    await author.page.getByRole("button", { name: "Загрузить текущую версию", exact: true }).click();
    await expect(author.page.getByRole("button", { name: "Использовать текущую версию", exact: true })).toBeVisible();
    await expect(author.page.getByLabel("Заголовок H1", { exact: true })).toHaveValue("Несохранённый текст после конфликта");
    author.page.once("dialog", dialog => dialog.accept());
    await author.page.getByRole("button", { name: "Использовать текущую версию", exact: true }).click();
    await expect(author.page.getByLabel("Заголовок H1", { exact: true })).toHaveValue(draft.h1);

    phase = "actual Article image upload and protected delivery";
    const png = await sharp({ create: { width: 3000, height: 1200, channels: 3, background: "#2468ac" } }).png().withMetadata().toBuffer();
    await author.page.reload(); await author.page.getByLabel("Заголовок H1", { exact: true }).fill("Несохранённый заголовок перед upload");
    await author.page.getByLabel("Загрузить изображение", { exact: true }).setInputFiles({ name: "editorial.png", mimeType: "image/png", buffer: png });
    const uploading = author.page.waitForResponse(response => response.url().endsWith(`/api/admin/articles/${draft.id}/images`) && response.request().method() === "POST");
    await author.page.getByRole("button", { name: "Загрузить файл", exact: true }).click();
    const upload = await uploading;
    let image: ArticleImageDTO | undefined;
    if (process.platform === "win32") {
      assert.equal(upload.status(), 200); noStore(upload.headers());
      const uploaded = await upload.json() as { image: ArticleImageDTO; revision: number }; image = uploaded.image;
      assert.equal(uploaded.revision, draft.revision + 1); assert.equal(image.width, 2048); assert(image.height > 512);
      assert.equal(image.url, `/media/private/${image.id}.webp`);
      await expect(author.page.getByLabel("Заголовок H1", { exact: true })).toHaveValue("Несохранённый заголовок перед upload");
      const asset = (await pool.query("select * from media.assets where id=$1", [image.id])).rows[0];
      assert.equal(asset.kind, "article_image");
      const bytes = await readFile(resolve(mediaRoot, asset.storage_key));
      assert.equal(bytes.length, asset.byte_size); assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
      const metadata = await sharp(bytes).metadata(); assert.equal(metadata.width, 2048); assert.equal(metadata.exif, undefined);
      for (const [client, expected] of [[author.context, 200], [stranger.context, 404], [anonymous, 401], [staff.context, 200], [ordinaryAdmin.context, 403]] as const) {
        const privateResponse: APIResponse = await client.request.get(image.url); assert.equal(privateResponse.status(), expected); noStore(privateResponse.headers());
        assert.equal(privateResponse.headers()["cloudflare-cdn-cache-control"], "no-store");
        if (expected === 200) assert.deepEqual(await privateResponse.body(), bytes);
      }
      assert.equal((await anonymous.request.get(image.url.replace("/private/", "/public/"))).status(), 404);
      assert.equal((await author.context.request.get(`/_next/image?${new URLSearchParams({ url: image.url, w: "640", q: "75" })}`)).status(), 404);
      await author.page.getByRole("button", { name: "Выбрать изображение 1", exact: true }).click();
      await author.page.getByLabel("Альтернативный текст изображения", { exact: true }).fill("Тактическая схема");
      await author.page.getByLabel("Подпись изображения", { exact: true }).fill("Подпись редактора");
      await author.page.getByRole("button", { name: "Вставить изображение в текст", exact: true }).click();
      const imageSaving = author.page.waitForResponse(response => response.url().endsWith(`/api/admin/articles/${draft.id}`) && response.request().method() === "PATCH");
      await author.page.getByRole("button", { name: "Сохранить черновик", exact: true }).click();
      assert.equal((await imageSaving).status(), 200);
      await expect(author.page.getByText("Черновик сохранён.", { exact: true })).toBeVisible();
      draft = await getDraft(author.context, draft.id);
      assert(JSON.stringify(draft.content).includes(image.id)); assert(JSON.stringify(draft.content).includes("Подпись редактора"));
      await author.page.goto(`/admin/articles/${draft.id}/preview`); await expect(author.page.getByAltText("Тактическая схема", { exact: true })).toBeVisible();
      const profile = (await (await author.context.request.get("/api/admin/profile")).json()).profile;
      assert.equal((await author.context.request.patch("/api/admin/profile", { headers: { origin }, data: { nickname: "Forgery", socialLinks: [], expectedRevision: profile.revision, operationId: randomUUID(), avatarMediaId: image.id } })).status(), 400);
      // Exercise the real DB purpose guard using this fixture's normally issued
      // session. No session/token is fabricated, logged or exported.
      const token = (await pool.query("select token from auth.staff_sessions where user_id=$1 order by created_at desc limit 1", [writer.userId])).rows[0].token;
      await assert.rejects(() => runtime.query("select identity.writer_command($1,'avatar',$2,$3::jsonb,$4,$5)",
        [token, writer.accountId, JSON.stringify({ mediaId: image!.id, expectedRevision: profile.revision }), randomUUID(), "a".repeat(64)]),
      (error: unknown) => error instanceof Error && error.message === "WRITER_FORBIDDEN");
      assert.equal((await anonymous.request.get(image.url.replace("/private/", "/public/"))).status(), 404);
      // Removing the body node retains the registered private attachment and bytes.
      const removed = await author.context.request.patch(`/api/admin/articles/${draft.id}`, { headers: { origin }, data: saveInput(draft, { content: rich }) });
      assert.equal(removed.status(), 200); draft = await getDraft(author.context, draft.id);
      assert(draft.images.some(item => item.id === image!.id)); assert.deepEqual(await readFile(resolve(mediaRoot, asset.storage_key)), bytes);
    } else {
      assert.equal(upload.status(), 503); assert.equal((await upload.json()).error.code, "MEDIA_STORAGE_UNAVAILABLE");
      assert.deepEqual(await readdir(mediaRoot), [".media-environment"]);
      assert.deepEqual(await getDraft(author.context, draft.id), draft);
      console.log("article_drafts_image_positive=not-run native_linux_missing_bind=denied production_container_check_required=true");
    }

    phase = "Super Admin edits preserve author; runtime immutable ownership and exact grants";
    draft = await getDraft(author.context, draft.id);
    const staffSave = await staff.context.request.patch(`/api/admin/articles/${draft.id}`, { headers: { origin }, data: saveInput(draft, { h1: "Правка Super Admin" }) });
    assert.equal(staffSave.status(), 200);
    draft = await getDraft(author.context, draft.id); assert.equal(draft.authorAccountId, writer.accountId);
    assert.equal((await pool.query("select author_account_id from article.articles where id=$1", [draft.id])).rows[0].author_account_id, writer.accountId);
    await assert.rejects(() => runtime.query("update article.articles set author_account_id=$1 where id=$2", [other.accountId, draft.id]), (error: unknown) => (error as { code?: string }).code === "42501");
    const privileges = (await runtime.query(`select has_table_privilege(current_user,'article.articles','UPDATE') as author_update,
      has_table_privilege(current_user,'article.articles','DELETE') as article_delete,
      has_table_privilege(current_user,'article.drafts','DELETE') as draft_delete,
      has_table_privilege(current_user,'media.assets','UPDATE') as media_update,
      has_table_privilege(current_user,'media.assets','DELETE') as media_delete`)).rows[0];
    assert.deepEqual(privileges, { author_update: false, article_delete: false, draft_delete: false, media_update: false, media_delete: false });
    phase = "disabled and revoked fixture sessions lose protected access";
    await pool.query("update identity.accounts set status='disabled' where id=$1", [writer.accountId]);
    assert.equal((await author.context.request.get(`/api/admin/articles/${draft.id}`)).status(), 401);
    assert.equal((await author.context.request.patch(`/api/admin/articles/${draft.id}`, { headers: { origin }, data: saveInput(draft) })).status(), 401);
    if (image) assert.equal((await author.context.request.get(image.url)).status(), 401);
    await pool.query("delete from auth.staff_sessions where user_id=$1", [other.userId]);
    assert.equal((await stranger.context.request.get("/api/admin/articles")).status(), 401);
    assert.equal(externalRequests, 0); assert.equal(Number((await pool.query("select count(*) from jobs.admin_requests")).rows[0].count), beforeJobs);
    console.log(`article_drafts_ui_check=passed identity=fixture-only mfa=real editor=roundtrip taxonomy=2-categories-4-tag-kinds cas=real ownership=immutable references=atomic provider_requests=0 image=${process.platform === "win32" ? "real-upload-private-acl" : "no-bind-denied-positive-not-run"}`);
    console.log(`retained_fixture_media=${mediaRoot}`);
  } finally {
    await browser?.close().catch(() => undefined);
    if (server) await stopProcessTree(server);
    // Delete only this run's generated SQL fixtures, in FK dependency order.
    // Physical Media files, including failed uploads, are always retained.
    const accountIds = fixtures.map(f => f.accountId), userIds = fixtures.map(f => f.userId);
    try {
      const articleIds = (await pool.query("select id from article.articles where author_account_id=any($1::text[])", [accountIds])).rows.map(row => row.id);
      await pool.query("delete from article.operation_receipts where actor_account_id=any($1::text[])", [accountIds]);
      for (const table of ["draft_categories", "draft_tags", "draft_images"] as const) await pool.query(`delete from article.${table} where draft_id=any($1::text[])`, [articleIds]);
      await pool.query("delete from article.drafts where article_id=any($1::text[])", [articleIds]);
      await pool.query("delete from article.articles where id=any($1::text[])", [articleIds]);
      await pool.query("delete from identity.writer_profiles where account_id=any($1::text[])", [accountIds]);
      await pool.query("delete from identity.writer_operation_receipts where actor_account_id=any($1::text[]) or target_account_id=any($1::text[])", [accountIds]);
      await pool.query("delete from identity.account_permission_assignments where account_id=any($1::text[])", [accountIds]);
      await pool.query("delete from media.assets where uploader_account_id=any($1::text[])", [accountIds]);
      await pool.query("delete from auth.security_audit where target_account_id=any($1::text[])", [accountIds]);
      await pool.query("delete from auth.users where id=any($1::text[])", [userIds]);
      await pool.query("delete from article.categories where id=any($1::text[])", [categoryIds]);
      await pool.query("delete from taxonomy.football_tags where id=any($1::text[])", [sources.map(s => s.tagId)]);
      for (const source of sources) await pool.query(`delete from football.${source.table} where id=$1`, [source.id]);
      assert.equal(Number((await pool.query("select count(*) from article.articles where id=any($1::text[])", [articleIds])).rows[0].count), 0);
    } finally { await Promise.all([runtime.end(), pool.end()]); }
  }
}

main().catch((error: unknown) => {
  // Never expose browser/login bodies, DSNs, tokens, MFA codes or SQL details.
  console.error(`article_drafts_ui_check=failed phase=${phase} type=${error instanceof Error ? error.name : "unknown"}`);
  process.exitCode = 1;
});
