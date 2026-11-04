import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { Pool, type PoolClient } from "pg";

import { articleTestTargets } from "./articles-test-target";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });
let phase = "target validation";

function runtimeIdentifier(value: string): string {
  assert.match(value, /^[A-Za-z_][A-Za-z0-9_]{0,62}$/, "Runtime role identifier is invalid");
  return `"${value}"`;
}

type SqlFailure = { code?: string; constraint?: string };
async function expectedError(db: PoolClient, work: () => Promise<unknown>, code: string | readonly string[], constraint?: string) {
  await db.query("savepoint expected_failure");
  let failure: unknown;
  try { await work(); } catch (error) { failure = error; }
  finally {
    await db.query("rollback to savepoint expected_failure");
    await db.query("release savepoint expected_failure");
  }
  assert(failure, "Rejected mutation unexpectedly succeeded");
  const allowed = typeof code === "string" ? [code] : code;
  if (!allowed.includes((failure as SqlFailure).code ?? "")) {
    throw Object.assign(new Error("Unexpected PostgreSQL rejection code"), { name: "UnexpectedPostgresCode", code: (failure as SqlFailure).code });
  }
  if (constraint) assert.equal((failure as SqlFailure).constraint, constraint, "Unexpected PostgreSQL rejection constraint");
}

async function exactTableGrants(db: PoolClient, role: string, table: string, expected: string[]) {
  const privileges = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"];
  const actual = (await db.query<{ privilege: string }>(`select privilege from unnest($3::text[]) as privilege
    where has_table_privilege($1,$2,privilege) order by privilege`, [role, table, privileges])).rows.map(row => row.privilege);
  assert.deepEqual(actual, [...expected].sort(), "Unexpected effective runtime table grants");
}

async function main() {
  // URL query parameters can override pg hosts. Validate both targets before Pool.
  const targets = articleTestTargets(process.env);
  const runtimeRole = decodeURIComponent(targets.runtime.username);
  const quotedRole = runtimeIdentifier(runtimeRole);
  assert.notEqual(runtimeRole, decodeURIComponent(targets.migration.username), "Owner and runtime roles must differ");
  const owner = new Pool({ connectionString: targets.migration.href, max: 1, connectionTimeoutMillis: 5000,
    application_name: "article-publications-db-safeguard" });
  const userId = randomUUID(), accountId = randomUUID(), articleId = randomUUID(), secondArticleId = randomUUID(), categoryId = randomUUID();
  const slug = `publication-check-${articleId}`;
  const body = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Synthetic publication safeguard text" }] }] });
  let db: PoolClient | undefined;
  let began = false;
  try {
    phase = "connect owner";
    db = await owner.connect();
    await db.query("begin"); began = true;
    await db.query("set local statement_timeout='10s'");
    await db.query("set local lock_timeout='3s'");

    phase = "effective runtime grants";
    const role = (await db.query<{ rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolreplication: boolean; rolbypassrls: boolean }>(
      "select rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls from pg_roles where rolname=$1", [runtimeRole])).rows[0];
    assert(role, "Runtime role is absent");
    assert.deepEqual(role, { rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false });
    await exactTableGrants(db, runtimeRole, "article.publications", ["SELECT", "INSERT", "UPDATE"]);
    for (const table of ["publication_categories", "publication_tags", "publication_images"]) {
      await exactTableGrants(db, runtimeRole, `article.${table}`, ["SELECT", "INSERT", "DELETE"]);
    }

    phase = "trigger function execution ACL";
    const functions = (await db.query<{ name: string; publicExecute: boolean; runtimeExecute: boolean; securityDefiner: boolean }>(`select p.proname as name,
      exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') as "publicExecute",
      has_function_privilege($1,p.oid,'EXECUTE') as "runtimeExecute",p.prosecdef as "securityDefiner"
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='article' and p.proname=any($2::text[]) order by p.proname`,
    [runtimeRole, ["guard_publication_identity", "guard_published_draft_slug"]])).rows;
    assert.equal(functions.length, 2, "Expected both canonical trigger functions");
    assert.deepEqual(functions.map(fn => fn.name), ["guard_publication_identity", "guard_published_draft_slug"]);
    for (const fn of functions) {
      assert.equal(fn.publicExecute, false); assert.equal(fn.runtimeExecute, false); assert.equal(fn.securityDefiner, false);
    }

    phase = "owner transaction fixtures";
    await db.query("insert into auth.users(id,email,name) values($1,$2,'Publication safeguard fixture')", [userId, `publication-db-${userId}@fixture.invalid`]);
    await db.query("insert into identity.accounts(id,auth_user_id) values($1,$2)", [accountId, userId]);
    for (const id of [articleId, secondArticleId]) {
      await db.query("insert into article.articles(id,author_account_id) values($1,$2)", [id, accountId]);
      await db.query("insert into article.drafts(article_id,content,h1,slug) values($1,$2::jsonb,'Synthetic draft',$3)", [id, body, id === articleId ? slug : `publication-check-${id}`]);
    }
    await db.query("insert into article.categories(id,name) values($1,$2)", [categoryId, `Publication safeguard ${categoryId}`]);
    await db.query(`insert into article.publications(article_id,revision,source_revision,format_version,content,h1,seo_title,meta_description,slug)
      values($1,1,0,1,$2::jsonb,'Synthetic publication','','',$3)`, [articleId, body, slug]);
    await db.query("insert into article.publication_categories(publication_id,category_id) values($1,$2)", [articleId, categoryId]);
    assert.equal((await db.query<{ count: number }>("select count(*)::int as count from article.draft_categories where category_id=$1", [categoryId])).rows[0].count, 0);

    phase = "assume exact runtime role";
    await db.query(`set local role ${quotedRole}`);
    assert.equal((await db.query<{ role: string }>("select current_user as role")).rows[0].role, runtimeRole);

    phase = "published draft slug trigger";
    await expectedError(db, () => db!.query("update article.drafts set slug=$2 where article_id=$1", [articleId, `changed-${articleId}`]), "23514", "article_published_slug_immutable");
    phase = "publication slug trigger";
    await expectedError(db, () => db!.query("update article.publications set slug=$2 where article_id=$1", [articleId, `changed-${articleId}`]), "23514", "article_published_slug_immutable");
    phase = "first publication time trigger";
    await expectedError(db, () => db!.query("update article.publications set first_published_at=first_published_at+interval '1 second' where article_id=$1", [articleId]), "23514", "article_published_slug_immutable");
    phase = "Article author update denied";
    await expectedError(db, () => db!.query("update article.articles set author_account_id=$2 where id=$1", [articleId, accountId]), "42501");
    phase = "publication deletion denied";
    await expectedError(db, () => db!.query("delete from article.publications where article_id=$1", [articleId]), "42501");
    phase = "publication-only category FK";
    // RESTRICT may report restrict_violation rather than foreign_key_violation;
    // the existing category repository maps both to CATEGORY_IN_USE.
    await expectedError(db, () => db!.query("delete from article.categories where id=$1", [categoryId]), ["23503", "23001"], "publication_categories_category_id_categories_id_fk");
    phase = "unique public slug";
    await expectedError(db, () => db!.query(`insert into article.publications(article_id,revision,source_revision,format_version,content,h1,seo_title,meta_description,slug)
      values($1,1,0,1,$2::jsonb,'Other synthetic publication','','',$3)`, [secondArticleId, body, slug]), "23505", "article_publications_slug_unique");
    phase = "child relation update denied";
    for (const table of ["publication_categories", "publication_tags", "publication_images"]) {
      await expectedError(db, () => db!.query(`update article.${table} set publication_id=publication_id where publication_id=$1`, [articleId]), "42501");
    }

    phase = "allowed runtime writes preserve published identity";
    assert.equal((await db.query("update article.drafts set h1='Edited synthetic draft' where article_id=$1", [articleId])).rowCount, 1);
    assert.equal((await db.query("update article.publications set h1='Edited synthetic publication' where article_id=$1", [articleId])).rowCount, 1);
    assert.equal((await db.query("delete from article.publication_categories where publication_id=$1 and category_id=$2", [articleId, categoryId])).rowCount, 1);
    await db.query("insert into article.publication_categories(publication_id,category_id) values($1,$2)", [articleId, categoryId]);
    assert.equal((await db.query<{ slug: string }>("select slug from article.publications where article_id=$1", [articleId])).rows[0].slug, slug);

    phase = "rollback all fixtures";
    await db.query("rollback"); began = false;
    phase = "verify fixture absence";
    const absence = (await db.query<{ users: number; accounts: number; articles: number; categories: number; publications: number }>(`select
      (select count(*)::int from auth.users where id=$1) as users,
      (select count(*)::int from identity.accounts where id=$2) as accounts,
      (select count(*)::int from article.articles where id=any($3::text[])) as articles,
      (select count(*)::int from article.categories where id=$4) as categories,
      (select count(*)::int from article.publications where article_id=any($3::text[])) as publications`,
    [userId, accountId, [articleId, secondArticleId], categoryId])).rows[0];
    assert.deepEqual(absence, { users: 0, accounts: 0, articles: 0, categories: 0, publications: 0 });
  } finally {
    try {
      if (began && db) {
        try { await db.query("rollback"); }
        catch (error) { phase = "rollback interrupted fixtures"; throw error; }
      }
    } finally {
      db?.release();
      await owner.end();
    }
  }
  console.log(JSON.stringify({ check: "article-publications-db", result: "PASS", fixturesRolledBack: true,
    immutablePublishedIdentity: true, runtimeGrants: true, publicationCategoryRestrict: true, triggerExecuteDenied: true }));
}

main().catch((error: unknown) => {
  const failure = error as { name?: unknown; code?: unknown };
  const name = typeof failure?.name === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(failure.name) ? failure.name : "Error";
  const code = typeof failure?.code === "string" && /^[A-Z0-9_]{1,40}$/.test(failure.code) ? failure.code : "CHECK_FAILED";
  console.error(JSON.stringify({ check: "article-publications-db", result: "FAIL", phase, name, code }));
  process.exitCode = 1;
});
