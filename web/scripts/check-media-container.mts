import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { Pool } from "pg";
import sharp from "sharp";
import { seedArticleStaff, loginArticleStaff, type ArticleStaffFixture } from "./articles-test-helpers.mjs";
import { articleTestTargets } from "./articles-test-target";
import type { ArticleDraftDTO } from "../src/articles/contract";
import type { ArticleDocument } from "../src/articles/document";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });
const image = process.env.MEDIA_TEST_IMAGE ?? "tuttoseriea-web:local";
assert(/^[a-z0-9][a-z0-9._/:@-]+$/.test(image), "Invalid LOCAL test image name");
const { migration, runtime } = articleTestTargets(process.env);
const id = randomUUID();
const fixtureIp = `2001:db8:${id.slice(0, 4)}:${id.slice(4, 8)}::1`;
const name = `tuttoseriea-media-check-${id}`;
const root = resolve(".media-fixtures", `media-container-${id}`);
const mediaRoot = resolve(root, "media");
const envPath = resolve(root, "container.env");
const origin = "http://127.0.0.1:3138";
const pool = new Pool({ connectionString: migration.href, max: 2 });
let fixture: ArticleStaffFixture | undefined;
let otherFixture: ArticleStaffFixture | undefined;
let grantFixture: ArticleStaffFixture | undefined;
let articleId: string | undefined;
let running = false;
let phase = "preflight";
const docker = (args: string[]) => execFileSync("docker", args, { encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] }).trim();

async function start(withMount: boolean) {
  const args = ["run", "--detach", "--name", name, "--publish", "127.0.0.1:3138:3000", "--env-file", envPath];
  if (process.platform === "linux") args.push("--add-host", "host.docker.internal:host-gateway");
  if (withMount) args.push("--mount", `type=bind,source=${mediaRoot},target=/var/lib/tuttoseriea/media`);
  args.push(image); docker(args); running = true;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* wait for this container's server */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Fixture container did not become ready");
}
function stop() {
  if (running) { docker(["stop", "--time", "10", name]); docker(["rm", name]); running = false; }
}
function storedBytes(key: string): Buffer {
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/);
  // CI's host UID may differ from the image's UID. Exercise the actual Web
  // user, preserving the private directory/file modes instead of widening ACLs.
  return Buffer.from(docker(["exec", name, "node", "-e", `process.stdout.write(require('node:fs').readFileSync('/var/lib/tuttoseriea/media/${key}').toString('base64'))`]), "base64");
}
async function upload(cookie: string, revision: number, input: Buffer) {
  return fetch(`${origin}/api/admin/profile/avatar`, { method: "POST", headers: {
    origin, cookie, "Content-Type": "image/png", "X-Profile-Revision": String(revision), "X-Operation-ID": randomUUID(),
  }, body: new Uint8Array(input) });
}
try {
  // Exact temporary names only; never stop unrelated servers or Docker resources.
  const listener = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) }).then(() => true).catch(() => false);
  assert.equal(listener, false, "Fixture port is already occupied");
  assert.equal(docker(["image", "inspect", image, "--format", "{{.Config.User}}"]), "node", "Test must exercise the restricted production Web user");
  await mkdir(mediaRoot, { recursive: true });
  await writeFile(resolve(mediaRoot, ".media-environment"), "local\n", { flag: "wx" });
  await chmod(mediaRoot, 0o700);
  const imageUser = JSON.parse(docker(["run", "--rm", "--network", "none", "--entrypoint", "node", image, "-e", "process.stdout.write(JSON.stringify([process.getuid(),process.getgid()]))"])) as number[];
  assert(imageUser.every(value => Number.isSafeInteger(value) && value > 0));
  docker(["run", "--rm", "--network", "none", "--user", "0", "--entrypoint", "node", "--mount", `type=bind,source=${mediaRoot},target=/media-fixture`, image, "-e",
    `const fs=require('node:fs');fs.chownSync('/media-fixture',${imageUser[0]},${imageUser[1]});fs.chmodSync('/media-fixture',0o700);fs.chownSync('/media-fixture/.media-environment',${imageUser[0]},${imageUser[1]});`]);
  const containerRuntime = new URL(runtime); containerRuntime.hostname = "host.docker.internal";
  const environment = {
    DATABASE_URL: containerRuntime.href, AUTH_URL: origin, AUTH_WRITES_ENABLED: "true", AUTH_TRUSTED_IP_HEADER: "x-real-ip",
    BETTER_AUTH_SECRET: `local-container-fixture-${randomUUID()}-${randomUUID()}`,
    EMAIL_DELIVERY_MODE: "disabled", API_FOOTBALL_ENABLE_REAL: "false", FOOTBALL_ADMIN_CONSUMER_ENABLED: "false",
    AI_SERVICE_URL: "http://127.0.0.1:8000", AI_SERVICE_INTERNAL_API_KEY: `fixture-${randomUUID()}`,
    MEDIA_STORAGE_ROOT: "/var/lib/tuttoseriea/media", MEDIA_STORAGE_ENV: "local",
  };
  assert(Object.values(environment).every(value => !/[\r\n]/.test(value)), "Environment file cannot contain multiline values");
  await writeFile(envPath, Object.entries(environment).map(([key, value]) => `${key}=${value}`).join("\n"), { flag: "wx", mode: 0o600 });
  fixture = await seedArticleStaff(pool);
  otherFixture = await seedArticleStaff(pool);
  grantFixture = await seedArticleStaff(pool, ["super_admin"]);
  // Owner-only, generated fixture setup. Publishing still uses the Writer's real
  // password-issued session and the application's fresh permission checks.
  await pool.query(`insert into identity.account_permission_assignments(account_id,permission_id,granted,changed_by_account_id)
    values($1,'article.publish.own',true,$2)`, [fixture.accountId, grantFixture.accountId]);
  phase = "real upload through production image";
  await start(true);
  const cookie = await loginArticleStaff(origin, fixture, fixtureIp);
  const otherCookie = await loginArticleStaff(origin, otherFixture, fixtureIp);
  const profileResponse = await fetch(`${origin}/api/admin/profile`, { headers: { cookie } });
  assert.equal(profileResponse.status, 200);
  const { profile } = await profileResponse.json() as { profile: { revision: number } };
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#123456" } }).png().toBuffer();
  const response = await upload(cookie, profile.revision, png);
  assert.equal(response.status, 200, "Production container upload failed");
  const saved = (await response.json() as { profile: { avatarMediaId: string; avatarUrl: string; revision: number } }).profile;
  assert.match(saved.avatarMediaId, /^[0-9a-f-]{36}$/);
  const metadata = (await pool.query<{ storage_key: string; byte_size: number; sha256: string }>("select storage_key,byte_size,sha256 from media.assets where id=$1", [saved.avatarMediaId])).rows[0];
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const bytes = storedBytes(metadata.storage_key);
  assert.equal(bytes.length, Number(metadata.byte_size)); assert.equal(hash(bytes), metadata.sha256);
  assert.equal(hash(Buffer.from(await (await fetch(origin + saved.avatarUrl)).arrayBuffer())), metadata.sha256);
  phase = "real private Article image through production image";
  const created = await fetch(`${origin}/api/admin/articles`, { method: "POST", headers: { origin, cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ operationId: randomUUID() }) });
  assert.equal(created.status, 201);
  let draft = (await created.json()).draft as ArticleDraftDTO;
  articleId = draft.id;
  const articlePng = await sharp({ create: { width: 2600, height: 1400, channels: 3, background: "#7256a4" } }).png().toBuffer();
  const uploadArticle = (session: string, input = articlePng) => fetch(`${origin}/api/admin/articles/${articleId}/images`, { method: "POST", headers: {
    origin, cookie: session, "Content-Type": "image/png", "X-Article-Revision": String(draft.revision), "X-Operation-ID": randomUUID(),
  }, body: new Uint8Array(input) });
  const articleUpload = await uploadArticle(cookie);
  assert.equal(articleUpload.status, 200, "Production Article image upload failed");
  const attached = await articleUpload.json() as { image: { id: string; url: string; width: number; height: number }; revision: number };
  draft.revision = attached.revision;
  assert.equal(attached.image.width, 2048); assert(attached.image.height <= 2048);
  const articleMetadata = (await pool.query<{ storage_key: string; byte_size: number; sha256: string; kind: string }>(
    "select storage_key,byte_size,sha256,kind from media.assets where id=$1", [attached.image.id])).rows[0];
  assert.equal(articleMetadata.kind, "article_image");
  assert.equal(hash(storedBytes(articleMetadata.storage_key)), articleMetadata.sha256);
  const ownPrivate = await fetch(origin + attached.image.url, { headers: { cookie } });
  assert.equal(ownPrivate.status, 200); assert(ownPrivate.headers.get("cache-control")?.includes("no-store"));
  assert.equal(hash(Buffer.from(await ownPrivate.arrayBuffer())), articleMetadata.sha256);
  for (const session of [undefined, otherCookie]) {
    const deniedPrivate = await fetch(origin + attached.image.url, { headers: session ? { cookie: session } : {} });
    assert.equal(deniedPrivate.status, session ? 404 : 401);
    assert(deniedPrivate.headers.get("cache-control")?.includes("no-store"));
  }
  assert.equal((await fetch(origin + attached.image.url.replace("/private/", "/public/"))).status, 404);
  const optimized = await fetch(`${origin}/_next/image?${new URLSearchParams({ url: attached.image.url, w: "640", q: "75" })}`, { headers: { cookie } });
  assert.equal(optimized.status, 404); assert(optimized.headers.get("cache-control")?.includes("no-store"));
  phase = "published snapshot admits only its referenced Article image";
  const secondPng = await sharp({ create: { width: 2600, height: 1400, channels: 3, background: "#a45672" } }).png().toBuffer();
  const unusedUpload = await uploadArticle(cookie, secondPng);
  assert.equal(unusedUpload.status, 200);
  const unused = await unusedUpload.json() as { image: { id: string; url: string }; revision: number };
  draft.revision = unused.revision;
  const unusedMetadata = (await pool.query<{ storage_key: string; sha256: string }>("select storage_key,sha256 from media.assets where id=$1", [unused.image.id])).rows[0];
  const publicUrl = attached.image.url.replace("/private/", "/public/");
  const unusedPublicUrl = unused.image.url.replace("/private/", "/public/");
  const body = (mediaId: string): ArticleDocument => ({ type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "Редакционный текст контейнерной проверки." }] },
    { type: "articleImage", attrs: { assetId: mediaId, alt: "Схема матча", caption: "Подпись автора" } },
  ] });
  const saveDraft = async (content: ArticleDocument) => {
    const savedDraft = await fetch(`${origin}/api/admin/articles/${articleId}`, { method: "PATCH", headers: { origin, cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ operationId: randomUUID(), expectedRevision: draft.revision, formatVersion: 1, content,
        h1: "Контейнерная проверка публикации", seoTitle: "", metaDescription: "", slug: `media-check-${id}`, categoryIds: [], tagIds: [] }) });
    assert.equal(savedDraft.status, 200); draft = (await savedDraft.json()).draft;
  };
  const publish = async (action: "publish" | "update") => {
    const published = await fetch(`${origin}/api/admin/articles/${articleId}/publication`, { method: "POST", headers: { origin, cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action, operationId: randomUUID(), expectedRevision: draft.revision, expectedPublicationRevision: draft.publication?.revision ?? 0 }) });
    assert.equal(published.status, 200); draft = (await published.json()).draft;
  };
  const assertPublic = async (url: string, expectedHash: string) => {
    const result = await fetch(origin + url);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "public, max-age=0, s-maxage=3600, must-revalidate");
    assert.equal(result.headers.get("cloudflare-cdn-cache-control"), "public, max-age=3600, must-revalidate");
    assert.equal(hash(Buffer.from(await result.arrayBuffer())), expectedHash);
  };
  const assertPublicDenied = async (url: string) => {
    const result = await fetch(origin + url);
    assert.equal(result.status, 404); assert(result.headers.get("cache-control")?.includes("no-store"));
    assert.equal(result.headers.get("cloudflare-cdn-cache-control"), "no-store");
  };
  await saveDraft(body(attached.image.id));
  await assertPublicDenied(publicUrl); await assertPublicDenied(unusedPublicUrl);
  await publish("publish");
  assert.equal(draft.publication?.revision, 1);
  assert.deepEqual((await pool.query("select media_id from article.publication_images where publication_id=$1", [articleId])).rows.map(row => row.media_id), [attached.image.id]);
  await assertPublic(publicUrl, articleMetadata.sha256);
  await assertPublicDenied(unusedPublicUrl);
  const publicHead = await fetch(origin + publicUrl, { method: "HEAD" });
  assert.equal(publicHead.status, 200); assert.equal(await publicHead.text(), "");
  assert.equal(publicHead.headers.get("content-length"), String(articleMetadata.byte_size));
  for (const [url, session, status] of [[attached.image.url, undefined, 401], [unused.image.url, undefined, 401], [unused.image.url, cookie, 200],
    [unused.image.url, otherCookie, 404]] as const) {
    const result = await fetch(origin + url, { headers: session ? { cookie: session } : {} });
    assert.equal(result.status, status); assert(result.headers.get("cache-control")?.includes("no-store"));
    assert.equal(result.headers.get("cloudflare-cdn-cache-control"), "no-store");
  }
  const optimizedPublic = await fetch(`${origin}/_next/image?${new URLSearchParams({ url: publicUrl, w: "640", q: "75" })}`);
  assert.equal(optimizedPublic.status, 404); assert(optimizedPublic.headers.get("cache-control")?.includes("no-store"));
  // Saving a different working draft cannot change the published image set.
  await saveDraft(body(unused.image.id));
  await assertPublic(publicUrl, articleMetadata.sha256); await assertPublicDenied(unusedPublicUrl);
  await pool.query("update identity.accounts set status='disabled' where id=$1", [fixture.accountId]);
  await assertPublic(publicUrl, articleMetadata.sha256);
  assert.equal((await fetch(origin + attached.image.url, { headers: { cookie } })).status, 401);
  await pool.query("update identity.accounts set status='active' where id=$1", [fixture.accountId]);
  phase = "container replacement with unchanged bind";
  stop(); await start(true);
  const restored = await fetch(origin + saved.avatarUrl);
  assert.equal(restored.status, 200); assert.equal(hash(Buffer.from(await restored.arrayBuffer())), metadata.sha256);
  assert.equal(hash(storedBytes(metadata.storage_key)), metadata.sha256);
  const restoredArticle = await fetch(origin + attached.image.url, { headers: { cookie } });
  assert.equal(restoredArticle.status, 200);
  assert.equal(hash(Buffer.from(await restoredArticle.arrayBuffer())), articleMetadata.sha256);
  assert.equal(hash(storedBytes(articleMetadata.storage_key)), articleMetadata.sha256);
  await assertPublic(publicUrl, articleMetadata.sha256); await assertPublicDenied(unusedPublicUrl);
  assert.equal(hash(storedBytes(unusedMetadata.storage_key)), unusedMetadata.sha256);
  phase = "explicit publication update changes only current public image relations";
  await publish("update");
  assert.equal(draft.publication?.revision, 2);
  await assertPublicDenied(publicUrl); await assertPublic(unusedPublicUrl, unusedMetadata.sha256);
  assert.equal(hash(storedBytes(articleMetadata.storage_key)), articleMetadata.sha256);
  const retainedPrivate = await fetch(origin + attached.image.url, { headers: { cookie } });
  assert.equal(retainedPrivate.status, 200); assert(retainedPrivate.headers.get("cache-control")?.includes("no-store"));
  assert.equal(hash(Buffer.from(await retainedPrivate.arrayBuffer())), articleMetadata.sha256);
  phase = "missing bind fails closed";
  stop(); await start(false);
  // Database-backed sessions survive replacement with the same runtime key.
  // Reuse the two real logins instead of consuming unrelated sign-in buckets.
  const denied = await upload(cookie, saved.revision, png);
  assert.equal(denied.status, 503); assert.equal((await denied.json()).error.code, "MEDIA_STORAGE_UNAVAILABLE");
  const articleDenied = await uploadArticle(cookie);
  assert.equal(articleDenied.status, 503); assert.equal((await articleDenied.json()).error.code, "MEDIA_STORAGE_UNAVAILABLE");
  const missingPublicFile = await fetch(origin + unusedPublicUrl);
  assert.equal(missingPublicFile.status, 503); assert(missingPublicFile.headers.get("cache-control")?.includes("no-store"));
  await assertPublicDenied(publicUrl);
  assert.equal(Number((await pool.query("select count(*) from media.assets where uploader_account_id=$1", [fixture.accountId])).rows[0].count), 3);
  assert.equal(docker(["exec", name, "node", "-e", "process.stdout.write(String(require('node:fs').existsSync('/var/lib/tuttoseriea/media')))" ]), "false");
  console.log("media_container_check=passed avatar=preserved article_image=real-2048 snapshot_images=public-only-referenced draft_only=private publication_update=origin-denied-old disabled_author=public-retained ownership=enforced image_user=restricted sharp=loaded replacement=preserved missing_bind=denied");
  console.log(`retained_fixture_files=${mediaRoot}`);
} catch (error) {
  // Do not emit raw Docker/app exceptions: env files contain runtime credentials.
  console.error(`media_container_check=failed phase=${phase} type=${error instanceof Error ? error.name : "unknown"}`);
  if (error instanceof assert.AssertionError) {
    const safe = (value: unknown) => typeof value === "number" || typeof value === "boolean" ? value : "not-emitted";
    const location = error.stack?.match(/check-media-container\.mts:\d+:\d+/)?.[0] ?? "unknown";
    console.error(JSON.stringify({ assertion: location, actual: safe(error.actual), expected: safe(error.expected) }));
  }
  process.exitCode = 1;
} finally {
  try { stop(); } finally {
    if (articleId && fixture) {
      assert.equal((await pool.query("select author_account_id from article.articles where id=$1", [articleId])).rows[0]?.author_account_id, fixture.accountId);
      await pool.query("delete from article.operation_receipts where article_id=$1", [articleId]);
      for (const table of ["publication_images", "publication_categories", "publication_tags"]) await pool.query(`delete from article.${table} where publication_id=$1`, [articleId]);
      await pool.query("delete from article.publications where article_id=$1", [articleId]);
      for (const table of ["draft_images", "draft_categories", "draft_tags"]) await pool.query(`delete from article.${table} where draft_id=$1`, [articleId]);
      await pool.query("delete from article.drafts where article_id=$1", [articleId]);
      await pool.query("delete from article.articles where id=$1", [articleId]);
    }
    const accountIds = [fixture, otherFixture, grantFixture].filter((account): account is ArticleStaffFixture => !!account).map(account => account.accountId);
    await pool.query("delete from identity.account_permission_assignments where account_id=any($1::text[])", [accountIds]);
    for (const account of [fixture, otherFixture, grantFixture]) if (account) {
      await pool.query("delete from identity.writer_profiles where account_id=$1", [account.accountId]);
      await pool.query("delete from identity.writer_operation_receipts where actor_account_id=$1 or target_account_id=$1", [account.accountId]);
      await pool.query("delete from media.assets where uploader_account_id=$1", [account.accountId]);
      await pool.query("delete from auth.security_audit where target_account_id=$1", [account.accountId]);
      await pool.query("delete from auth.users where id=$1", [account.userId]);
    }
    await pool.end();
  }
}
