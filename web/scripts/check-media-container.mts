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

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });
const image = process.env.MEDIA_TEST_IMAGE ?? "tuttoseriea-web:local";
assert(/^[a-z0-9][a-z0-9._/:@-]+$/.test(image), "Invalid LOCAL test image name");
const { migration, runtime } = articleTestTargets(process.env);
const id = randomUUID();
const name = `tuttoseriea-media-check-${id}`;
const root = resolve(".media-fixtures", `media-container-${id}`);
const mediaRoot = resolve(root, "media");
const envPath = resolve(root, "container.env");
const origin = "http://127.0.0.1:3138";
const pool = new Pool({ connectionString: migration.href, max: 2 });
let fixture: ArticleStaffFixture | undefined;
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
    DATABASE_URL: containerRuntime.href, AUTH_URL: origin, AUTH_WRITES_ENABLED: "true",
    BETTER_AUTH_SECRET: `local-container-fixture-${randomUUID()}-${randomUUID()}`,
    EMAIL_DELIVERY_MODE: "disabled", API_FOOTBALL_ENABLE_REAL: "false", FOOTBALL_ADMIN_CONSUMER_ENABLED: "false",
    AI_SERVICE_URL: "http://127.0.0.1:8000", AI_SERVICE_INTERNAL_API_KEY: `fixture-${randomUUID()}`,
    MEDIA_STORAGE_ROOT: "/var/lib/tuttoseriea/media", MEDIA_STORAGE_ENV: "local",
  };
  assert(Object.values(environment).every(value => !/[\r\n]/.test(value)), "Environment file cannot contain multiline values");
  await writeFile(envPath, Object.entries(environment).map(([key, value]) => `${key}=${value}`).join("\n"), { flag: "wx", mode: 0o600 });
  fixture = await seedArticleStaff(pool);
  phase = "real upload through production image";
  await start(true);
  let cookie = await loginArticleStaff(origin, fixture);
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
  phase = "container replacement with unchanged bind";
  stop(); await start(true);
  const restored = await fetch(origin + saved.avatarUrl);
  assert.equal(restored.status, 200); assert.equal(hash(Buffer.from(await restored.arrayBuffer())), metadata.sha256);
  assert.equal(hash(storedBytes(metadata.storage_key)), metadata.sha256);
  phase = "missing bind fails closed";
  stop(); await start(false);
  cookie = await loginArticleStaff(origin, fixture);
  const denied = await upload(cookie, saved.revision, png);
  assert.equal(denied.status, 503); assert.equal((await denied.json()).error.code, "MEDIA_STORAGE_UNAVAILABLE");
  assert.equal(Number((await pool.query("select count(*) from media.assets where uploader_account_id=$1", [fixture.accountId])).rows[0].count), 1);
  assert.equal(docker(["exec", name, "node", "-e", "process.stdout.write(String(require('node:fs').existsSync('/var/lib/tuttoseriea/media')))" ]), "false");
  console.log("media_container_check=passed upload=real image_user=restricted sharp=loaded replacement=preserved missing_bind=denied");
  console.log(`retained_fixture_files=${mediaRoot}`);
} catch (error) {
  // Do not emit raw Docker/app exceptions: env files contain runtime credentials.
  console.error(`media_container_check=failed phase=${phase} type=${error instanceof Error ? error.name : "unknown"}`);
  process.exitCode = 1;
} finally {
  try { stop(); } finally {
    if (fixture) {
      await pool.query("delete from identity.writer_profiles where account_id=$1", [fixture.accountId]);
      await pool.query("delete from identity.writer_operation_receipts where actor_account_id=$1 or target_account_id=$1", [fixture.accountId]);
      await pool.query("delete from media.assets where uploader_account_id=$1", [fixture.accountId]);
      await pool.query("delete from auth.security_audit where target_account_id=$1", [fixture.accountId]);
      await pool.query("delete from auth.users where id=$1", [fixture.userId]);
    }
    await pool.end();
  }
}
