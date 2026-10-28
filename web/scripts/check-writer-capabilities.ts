import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import pg from "pg";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { articleTestTargets } from "./articles-test-target";

config({ path: ".env.local", quiet: true }); config({ path: ".env", quiet: true });
const suffix = randomUUID().replaceAll("-", "");
const names = { identity: `writer_identity_${suffix}`, auth: `writer_auth_${suffix}`, media: `writer_media_${suffix}` };
const q = (value: string) => `"${value.replaceAll('"', '""')}"`;
const rewrite = (sql: string) => Object.entries(names).reduce((value, [source, target]) => value.replaceAll(`"${source}"`, q(target)).replace(new RegExp(`\\b${source}\\.`, "g"), `${q(target)}.`), sql);
let phase = "preflight";
async function main() {
  articleTestTargets(process.env);
  const ownerApplication = `writer-operator-${suffix}`;
  const owner = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 6, application_name: ownerApplication });
  const runtimeApplication = `writer-capabilities-${suffix}`;
  const runtime = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6, application_name: runtimeApplication });
  const runtimeRole = (await runtime.query<{ current_user: string }>("select current_user")).rows[0].current_user;
  const identity = q(names.identity), auth = q(names.auth), media = q(names.media);
  const accountIds: string[] = [];
  const canonicalBefore = (await owner.query(`select (select count(*) from identity.accounts) as accounts,(select count(*) from auth.users) as users`)).rows[0];
  try {
    phase = "isolated fixture schemas and actual migrations";
    await owner.query(`create schema ${identity}; create schema ${auth}`);
    for (const table of ["users", "staff_sessions", "two_factors", "credential_accounts", "staff_verifications", "security_audit"]) {
      await owner.query(`create table ${auth}.${q(table)} (like auth.${q(table)} including all)`);
    }
    for (const table of ["accounts", "roles", "account_roles"]) await owner.query(`create table ${identity}.${q(table)} (like identity.${q(table)} including all)`);
    await owner.query(`insert into ${identity}.roles select * from identity.roles`);
    for (const file of ["0024_perfect_viper.sql", "0025_writer_capabilities.sql", "0026_writer_command_revocation.sql"]) {
      const sql = rewrite(await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
      for (const statement of sql.split("--> statement-breakpoint")) if (statement.trim()) await owner.query(statement);
    }
    await owner.query(`grant usage on schema ${identity},${auth},${media} to ${q(runtimeRole)};
      grant select on all tables in schema ${identity} to ${q(runtimeRole)};
      revoke all on ${identity}.writer_operation_receipts from ${q(runtimeRole)};
      grant select,insert on ${media}.assets to ${q(runtimeRole)};
      grant execute on function ${identity}.writer_command(text,text,text,jsonb,text,text) to ${q(runtimeRole)}`);
    const sqlCommand = `select ${identity}.writer_command($1,$2,$3,$4::jsonb,$5,$6) as result`;
    const password = "Synthetic writers integration password";
    const passwordHash = await hashPassword(password);
    async function fixture(role: string, options: { mfa?: boolean; disabled?: boolean; writer?: boolean } = {}) {
      const userId = randomUUID(), accountId = randomUUID(), token = randomUUID(), email = `${userId}@writer-fixture.invalid`;
      accountIds.push(accountId);
      await owner.query(`insert into ${auth}.users(id,email,name,two_factor_enabled) values($1,$2,'Fixture',$3)`, [userId, email, !!options.mfa]);
      await owner.query(`insert into ${identity}.accounts(id,auth_user_id,status) values($1,$2,$3)`, [accountId, userId, options.disabled ? "disabled" : "active"]);
      if (role) await owner.query(`insert into ${identity}.account_roles(account_id,role_id) values($1,$2)`, [accountId, role]);
      if (options.writer && role !== "writer") await owner.query(`insert into ${identity}.account_roles(account_id,role_id) values($1,'writer')`, [accountId]);
      await owner.query(`insert into ${auth}.credential_accounts(id,user_id,account_id,provider_id,password) values($1,$2,$2,'credential',$3)`, [randomUUID(), userId, passwordHash]);
      if (options.mfa) await owner.query(`insert into ${auth}.two_factors(id,user_id,secret,backup_codes,verified) values($1,$2,'synthetic','synthetic',true)`, [randomUUID(), userId]);
      await owner.query(`insert into ${auth}.staff_sessions(id,token,user_id,expires_at,mfa_verified_at) values($1,$2,$3,clock_timestamp()+interval '1 hour',$4)`, [randomUUID(), token, userId, options.mfa ? new Date() : null]);
      return { userId, accountId, token, email };
    }
    async function command(token: string, action: string, target: string | null, payload: unknown, operationId = randomUUID()) {
      const digest = createHash("sha256").update(JSON.stringify([action, target, payload])).digest("hex");
      return (await runtime.query<{ result: { accountId: string; revision: number } }>(sqlCommand, [token, action, target, JSON.stringify(payload), operationId, digest])).rows[0].result;
    }
    async function expectError(operation: () => Promise<unknown>, expected: string) {
      try { await operation(); }
      catch (error) {
        if (error && typeof error === "object" && ("message" in error && error.message === expected || "code" in error && error.code === expected)) return;
        throw new Error(`Expected ${expected}; received ${error instanceof Error ? error.message.split("\n")[0] : "unknown"}`);
      }
      throw new Error(`Expected ${expected}; operation succeeded`);
    }
    const superAdmin = await fixture("super_admin", { mfa: true, writer: true });
    const incomplete = await fixture("super_admin", { writer: true });
    const disabled = await fixture("super_admin", { mfa: true, disabled: true });
    const writer = await fixture("writer"), admin = await fixture("admin"), foreign = await fixture("writer");
    phase = "direct DML and capability definition";
    for (const table of ["accounts", "account_roles", "writer_profiles", "account_permission_assignments", "writer_operation_receipts"]) {
      await expectError(() => runtime.query(`delete from ${identity}.${q(table)} where false`), "42501");
    }
    const definition = (await owner.query(`select p.prosecdef,p.proconfig,
      exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname='writer_command'`, [names.identity])).rows[0];
    assert.equal(definition.prosecdef, true); assert.equal(definition.public_execute, false); assert.deepEqual(definition.proconfig, ["search_path=pg_catalog, pg_temp"]);
    phase = "current actor/session/MFA and fixed operations";
    const createPayload = { email: `created-${suffix}@writer-fixture.invalid`, passwordHash };
    for (const actor of [writer, admin, incomplete]) await expectError(() => command(actor.token, "create_writer", null, createPayload), "WRITER_FORBIDDEN");
    await expectError(() => command(disabled.token, "create_writer", null, createPayload), "WRITER_UNAUTHORIZED");
    await expectError(() => command("unknown-session", "create_writer", null, createPayload), "WRITER_UNAUTHORIZED");
    await expectError(() => command(superAdmin.token, "grant_role", writer.accountId, { role: "super_admin" }), "WRITER_VALIDATION_ERROR");
    await owner.query(`update ${auth}.users set two_factor_enabled=false where id=$1`, [superAdmin.userId]);
    await expectError(() => command(superAdmin.token, "create_writer", null, createPayload), "WRITER_FORBIDDEN");
    await owner.query(`update ${auth}.users set two_factor_enabled=true where id=$1`, [superAdmin.userId]);
    await owner.query(`update ${auth}.two_factors set verified=false where user_id=$1`, [superAdmin.userId]);
    await expectError(() => command(superAdmin.token, "create_writer", null, createPayload), "WRITER_FORBIDDEN");
    await owner.query(`update ${auth}.two_factors set verified=true where user_id=$1`, [superAdmin.userId]);
    await owner.query(`update ${auth}.staff_sessions set mfa_verified_at=null where token=$1`, [superAdmin.token]);
    await expectError(() => command(superAdmin.token, "create_writer", null, createPayload), "WRITER_FORBIDDEN");
    await owner.query(`update ${auth}.staff_sessions set mfa_verified_at=clock_timestamp() where token=$1`, [superAdmin.token]);
    phase = "create/replay/canonical collision without credential replacement";
    assert.match(passwordHash, /^[0-9a-f]{32}:[0-9a-f]{128}$/, "Installed Better Auth password format changed");
    await expectError(() => command(superAdmin.token, "create_writer", null, { ...createPayload, passwordHash: `${"a".repeat(32)}:${"b".repeat(126)}` }), "WRITER_VALIDATION_ERROR");
    const createId = randomUUID();
    const created = await command(superAdmin.token, "create_writer", null, createPayload, createId);
    assert.deepEqual(await command(superAdmin.token, "create_writer", null, createPayload, createId), created);
    await expectError(() => command(superAdmin.token, "create_writer", null, { ...createPayload, email: `different-${suffix}@writer-fixture.invalid` }, createId), "WRITER_OPERATION_CONFLICT");
    await expectError(() => command(superAdmin.token, "create_writer", null, createPayload), "WRITER_ACCOUNT_EXISTS");
    const createdRows = (await owner.query(`select a.id,u.email,u.email_verified_flag,c.password,(select array_agg(role_id) from ${identity}.account_roles where account_id=a.id) as roles
      from ${identity}.accounts a join ${auth}.users u on u.id=a.auth_user_id join ${auth}.credential_accounts c on c.user_id=u.id where a.id=$1`, [created.accountId])).rows;
    assert.equal(createdRows.length, 1); assert.deepEqual(createdRows[0].roles, ["writer"]); assert.equal(createdRows[0].email_verified_flag, false);
    assert.equal(await verifyPassword({ password, hash: createdRows[0].password }), true);
    const duplicatePayload = { ...createPayload, email: `parallel-${suffix}@writer-fixture.invalid` };
    const concurrent = await Promise.allSettled([command(superAdmin.token, "create_writer", null, duplicatePayload), command(superAdmin.token, "create_writer", null, duplicatePayload)]);
    assert.equal(concurrent.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter(result => result.status === "rejected").length, 1);
    phase = "explicit attach preserves credentials/identity/roles";
    await command(superAdmin.token, "attach_writer", admin.accountId, {});
    const attached = (await owner.query(`select u.id,u.security_revision,c.password,(select array_agg(role_id order by role_id) from ${identity}.account_roles where account_id=$1) as roles
      from ${identity}.accounts a join ${auth}.users u on u.id=a.auth_user_id join ${auth}.credential_accounts c on c.user_id=u.id where a.id=$1`, [admin.accountId])).rows[0];
    assert.equal(attached.id, admin.userId); assert.equal(attached.password, passwordHash); assert.deepEqual(attached.roles, ["admin", "writer"]);
    assert.equal(attached.security_revision, 1); assert.equal((await owner.query(`select count(*)::int as count from ${auth}.staff_sessions where user_id=$1`, [admin.userId])).rows[0].count, 0);
    await expectError(() => command(superAdmin.token, "attach_writer", writer.accountId, { passwordHash: "forged" }), "WRITER_VALIDATION_ERROR");
    phase = "personal publication grant default-deny/revoke/CAS/self denial";
    assert.equal((await owner.query(`select count(*)::int as count from ${identity}.account_permission_assignments`)).rows[0].count, 0);
    await expectError(() => command(writer.token, "publish_own", writer.accountId, { enabled: true, expectedRevision: 0 }), "WRITER_FORBIDDEN");
    await expectError(() => command(superAdmin.token, "publish_own", superAdmin.accountId, { enabled: true, expectedRevision: 0 }), "WRITER_FORBIDDEN");
    await command(superAdmin.token, "publish_own", writer.accountId, { enabled: true, expectedRevision: 0 });
    await expectError(() => command(superAdmin.token, "publish_own", writer.accountId, { enabled: false, expectedRevision: 0 }), "WRITER_CONFLICT");
    await command(superAdmin.token, "publish_own", writer.accountId, { enabled: false, expectedRevision: 1 });
    assert.deepEqual((await owner.query(`select granted,revision from ${identity}.account_permission_assignments where account_id=$1`, [writer.accountId])).rows[0], { granted: false, revision: 2 });
    phase = "own profile only, CAS and forbidden links";
    const profile = { nickname: "Автор", socialLinks: [{ label: "Канал", url: "https://example.invalid/author" }], expectedRevision: 0 };
    await expectError(() => command(writer.token, "profile", foreign.accountId, profile), "WRITER_FORBIDDEN");
    await expectError(() => command(writer.token, "profile", writer.accountId, { ...profile, socialLinks: [{ label: "bad", url: "javascript:alert(1)" }] }), "WRITER_VALIDATION_ERROR");
    await command(writer.token, "profile", writer.accountId, profile);
    const races = await Promise.allSettled([command(writer.token, "profile", writer.accountId, { ...profile, nickname: "Первый", expectedRevision: 1 }), command(writer.token, "profile", writer.accountId, { ...profile, nickname: "Второй", expectedRevision: 1 })]);
    assert.equal(races.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(races.filter(result => result.status === "rejected").length, 1);
    phase = "avatar ownership/link CAS/immutable metadata and disable retention";
    const assetId = randomUUID();
    await runtime.query(`insert into ${media}.assets(id,storage_key,mime_type,byte_size,width,height,sha256,uploader_account_id) values($1,$2,'image/webp',20,10,10,$3,$4)`, [assetId, `${assetId}.webp`, "a".repeat(64), writer.accountId]);
    await expectError(() => command(foreign.token, "avatar", foreign.accountId, { mediaId: assetId, expectedRevision: 0 }), "WRITER_FORBIDDEN");
    const raceAssets = [randomUUID(), randomUUID()];
    async function replaceAvatar(id: string) {
      const client = await runtime.connect();
      try {
        await client.query("begin");
        await client.query(`insert into ${media}.assets(id,storage_key,mime_type,byte_size,width,height,sha256,uploader_account_id) values($1,$2,'image/webp',20,10,10,$3,$4)`, [id, `${id}.webp`, "b".repeat(64), writer.accountId]);
        await client.query(sqlCommand, [writer.token, "avatar", writer.accountId, JSON.stringify({ mediaId: id, expectedRevision: 2 }), randomUUID(), "b".repeat(64)]);
        await client.query("commit");
      } catch (error) { await client.query("rollback"); throw error; }
      finally { client.release(); }
    }
    const replacements = await Promise.allSettled(raceAssets.map(replaceAvatar));
    assert.equal(replacements.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(replacements.filter(result => result.status === "rejected").length, 1);
    const currentAvatar = (await owner.query(`select avatar_media_id from ${identity}.writer_profiles where account_id=$1`, [writer.accountId])).rows[0].avatar_media_id;
    assert(raceAssets.includes(currentAvatar));
    assert.equal((await owner.query(`select count(*)::int as count from ${media}.assets where id=any($1::text[])`, [raceAssets])).rows[0].count, 1, "Failed CAS must roll back metadata and preserve old link");
    await expectError(() => runtime.query(`update ${media}.assets set width=1 where id=$1`, [assetId]), "42501");
    await owner.query(`update ${identity}.accounts set status='disabled' where id=$1`, [writer.accountId]);
    assert.equal((await runtime.query(`select avatar_media_id from ${identity}.writer_profiles where account_id=$1`, [writer.accountId])).rows[0].avatar_media_id, currentAvatar);
    await expectError(() => command(writer.token, "profile", writer.accountId, { ...profile, expectedRevision: 3 }), "WRITER_UNAUTHORIZED");
    await expectError(() => command(superAdmin.token, "attach_writer", writer.accountId, {}), "WRITER_FORBIDDEN");
    await expectError(() => command(superAdmin.token, "publish_own", writer.accountId, { enabled: true, expectedRevision: 2 }), "WRITER_FORBIDDEN");
    await command(superAdmin.token, "publish_own", writer.accountId, { enabled: false, expectedRevision: 2 });
    phase = "waiter rechecks operator revocation after shared user lock";
    const client = await owner.connect();
    try {
      await client.query("begin"); await client.query("select pg_advisory_xact_lock(910230207,hashtext($1))", [superAdmin.userId]);
      // Attach rejection handling before releasing the lock: Node must never see
      // an unhandled rejected promise between COMMIT and the assertion.
      const waiting = command(superAdmin.token, "publish_own", foreign.accountId, { enabled: true, expectedRevision: 0 })
        .then(result => ({ result, error: undefined }), error => ({ result: undefined, error }));
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        await client.query("select pg_stat_clear_snapshot()");
        blocked = (await client.query(`select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid
          where a.application_name=$1 and l.locktype='advisory' and not l.granted) as blocked`, [runtimeApplication])).rows[0].blocked;
        if (blocked) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert(blocked, "Runtime mutation must be waiting on the shared actor lock");
      await client.query(`update ${auth}.users set security_revision=security_revision+1 where id=$1`, [superAdmin.userId]);
      await client.query("commit");
      const outcome = await waiting;
      assert.equal(outcome.error?.message, "WRITER_UNAUTHORIZED");
    } finally { await client.query("rollback"); client.release(); }
    phase = "capability-first lock order then operator revocation";
    await owner.query(`update ${auth}.staff_sessions set security_revision=1 where token=$1`, [superAdmin.token]);
    const mutationClient = await runtime.connect(), operatorClient = await owner.connect();
    try {
      await mutationClient.query("begin");
      await mutationClient.query(sqlCommand, [superAdmin.token, "publish_own", foreign.accountId, JSON.stringify({ enabled: true, expectedRevision: 0 }), randomUUID(), "c".repeat(64)]);
      // The capability's transaction still owns the canonical actor lock.
      await operatorClient.query("begin");
      const operatorLock = operatorClient.query("select pg_advisory_xact_lock(910230207,hashtext($1))", [superAdmin.userId])
        .then(result => ({ result, error: undefined }), error => ({ result: undefined, error }));
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        blocked = (await owner.query(`select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid
          where a.application_name=$1 and l.locktype='advisory' and not l.granted) as blocked`, [ownerApplication])).rows[0].blocked;
        if (blocked) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert(blocked, "Operator must wait for the earlier capability transaction");
      await mutationClient.query("commit");
      assert.equal((await operatorLock).error, undefined);
      await operatorClient.query(`update ${auth}.users set security_revision=security_revision+1 where id=$1`, [superAdmin.userId]);
      await operatorClient.query(`delete from ${auth}.staff_sessions where user_id=$1`, [superAdmin.userId]);
      await operatorClient.query("commit");
      assert.deepEqual((await owner.query(`select granted,revision from ${identity}.account_permission_assignments where account_id=$1`, [foreign.accountId])).rows[0], { granted: true, revision: 1 });
      await expectError(() => command(superAdmin.token, "publish_own", foreign.accountId, { enabled: false, expectedRevision: 1 }), "WRITER_UNAUTHORIZED");
    } finally {
      await mutationClient.query("rollback"); await operatorClient.query("rollback"); mutationClient.release(); operatorClient.release();
    }
    assert.deepEqual((await owner.query(`select (select count(*) from identity.accounts) as accounts,(select count(*) from auth.users) as users`)).rows[0], canonicalBefore);
    console.log("writer_capabilities=passed direct_identity_dml=denied canonical_changes=0 external_requests=0");
  } finally {
    await runtime.end();
    // Only schemas created under this random per-run namespace are removed.
    for (const schema of [names.media, names.identity, names.auth]) assert(/^writer_(?:media|identity|auth)_[0-9a-f]{32}$/.test(schema));
    await owner.query(`drop schema if exists ${media} cascade; drop schema if exists ${identity} cascade; drop schema if exists ${auth} cascade`);
    await owner.end();
  }
}
main().catch(error => {
  console.error(`Writer capability check failed during: ${phase}`);
  // Fixtures contain only generated data; omit SQL parameters and request bodies.
  console.error(error instanceof Error ? error.message.split("\n")[0] : "Unknown fixture error");
  process.exitCode = 1;
});
