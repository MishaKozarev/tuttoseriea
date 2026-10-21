import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { FOOTBALL_TAG_SOURCES, type FootballTagKind } from "../football/tagged-upsert";
type Db = Pick<PoolClient, "query">;
export type TagTarget = { stage: "local" | "staging"; database: string };
type Entry = { kind: FootballTagKind; sourceId: string; tagId: string | null };
export type TagManifest = { version: 1; target: TagTarget; scope: "persisted-football"; createdAt: string; batchSize: 500;
  batchCount: number; entries: Entry[]; forecast: { sources: number; createTags: number; alreadyTagged: number }; hash: string };
export class TagReconciliationError extends Error { constructor(readonly code: string) { super(code); } }
export function requireTag(condition: unknown, code: string): asserts condition {
  if (!condition) throw new TagReconciliationError(code);
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sourceSql = Object.entries(FOOTBALL_TAG_SOURCES).map(([kind, column]) =>
  `select '${kind}'::text as kind,s.id as source_id,t.id as tag_id from football.${kind} s
   left join taxonomy.football_tags t on t.${column}=s.id`).join(" union all ");
export async function createTagManifest(db: Db, target: TagTarget): Promise<TagManifest> {
  const rows = (await db.query<{ kind: FootballTagKind; source_id: string; tag_id: string | null }>(
    `with sources as (${sourceSql}) select * from sources order by kind,source_id limit 100001`)).rows;
  requireTag(rows.length <= 100000, "TAG_SCOPE_LIMIT_EXCEEDED");
  const createdAt = (await db.query<{ at: Date }>("select now() as at")).rows[0].at.toISOString();
  const entries = rows.map(row => ({ kind: row.kind, sourceId: row.source_id, tagId: row.tag_id }));
  const alreadyTagged = entries.filter(e => e.tagId !== null).length;
  const value = { version: 1 as const, target, scope: "persisted-football" as const, createdAt, batchSize: 500 as const,
    batchCount: Math.ceil(entries.length / 500), entries, forecast: { sources: entries.length, createTags: entries.length - alreadyTagged, alreadyTagged } };
  return { ...value, hash: hash(value) };
}
export function validateTagManifest(input: unknown, target: TagTarget): TagManifest {
  requireTag(input && typeof input === "object" && !Array.isArray(input), "TAG_INVALID_MANIFEST");
  const m = input as TagManifest;
  requireTag(Object.keys(m).sort().join(",") === "batchCount,batchSize,createdAt,entries,forecast,hash,scope,target,version" &&
    m.version === 1 && m.scope === "persisted-football" && m.batchSize === 500 &&
    m.target?.stage === target.stage && m.target?.database === target.database &&
    Object.keys(m.target).sort().join(",") === "database,stage" &&
    typeof m.createdAt === "string" && Number.isFinite(new Date(m.createdAt).getTime()) &&
    Array.isArray(m.entries) && m.entries.length <= 100000 && m.batchCount === Math.ceil(m.entries.length / 500), "TAG_INVALID_MANIFEST");
  const identities = new Set<string>();
  for (const entry of m.entries) {
    requireTag(entry && Object.keys(entry).sort().join(",") === "kind,sourceId,tagId" && Object.hasOwn(FOOTBALL_TAG_SOURCES, entry.kind) &&
      typeof entry.sourceId === "string" && !!entry.sourceId.trim() && entry.sourceId.length <= 128 && !/[\p{Cc}]/u.test(entry.sourceId) &&
      (entry.tagId === null || typeof entry.tagId === "string" && !!entry.tagId.trim() && entry.tagId.length <= 128), "TAG_INVALID_MANIFEST");
    const key = JSON.stringify([entry.kind, entry.sourceId]); requireTag(!identities.has(key), "TAG_DUPLICATE_SCOPE"); identities.add(key);
  }
  const alreadyTagged = m.entries.filter(e => e.tagId !== null).length;
  requireTag(m.forecast && Object.keys(m.forecast).sort().join(",") === "alreadyTagged,createTags,sources" &&
    m.forecast.sources === m.entries.length && m.forecast.alreadyTagged === alreadyTagged &&
    m.forecast.createTags === m.entries.length - alreadyTagged, "TAG_INVALID_FORECAST");
  // Rebuild canonical key order; untrusted JSON object order is not part of approval identity.
  const value = { version: m.version, target: { stage: m.target.stage, database: m.target.database }, scope: m.scope,
    createdAt: m.createdAt, batchSize: m.batchSize, batchCount: m.batchCount,
    entries: m.entries.map(e => ({ kind: e.kind, sourceId: e.sourceId, tagId: e.tagId })),
    forecast: { sources: m.forecast.sources, createTags: m.forecast.createTags, alreadyTagged: m.forecast.alreadyTagged } };
  requireTag(typeof m.hash === "string" && /^[a-f0-9]{64}$/.test(m.hash) && hash(value) === m.hash, "TAG_MANIFEST_HASH_MISMATCH");
  return { ...value, hash: m.hash };
}
async function checkEntry(db: Db, entry: Entry, lock: boolean) {
  const column = FOOTBALL_TAG_SOURCES[entry.kind];
  const source = await db.query(`select id from football.${entry.kind} where id=$1${lock ? " for key share" : ""}`, [entry.sourceId]);
  requireTag(source.rows.length === 1, "TAG_SOURCE_DISAPPEARED");
  const current = (await db.query<{ id: string }>(`select id from taxonomy.football_tags where ${column}=$1`, [entry.sourceId])).rows[0];
  requireTag(!entry.tagId || current?.id === entry.tagId, "TAG_IDENTITY_DRIFT");
  return current;
}
export async function applyTagManifestBatch(db: PoolClient, input: unknown, target: TagTarget, batch: number, confirm: string) {
  const manifest = validateTagManifest(input, target);
  requireTag(confirm === manifest.hash, "TAG_CONFIRMATION_REQUIRED");
  requireTag(Number.isInteger(batch) && batch >= 1 && batch <= manifest.batchCount, "TAG_INVALID_BATCH");
  await db.query("begin");
  try {
    const locked = (await db.query<{ locked: boolean }>("select pg_try_advisory_xact_lock(hashtextextended('football-tags-reconciliation:v1',0)) as locked")).rows[0].locked;
    requireTag(locked, "TAG_RECONCILIATION_BUSY");
    let created = 0;
    const entries = manifest.entries.slice((batch - 1) * 500, batch * 500);
    for (const entry of entries) {
      const current = await checkEntry(db, entry, true);
      if (!current) {
        const column = FOOTBALL_TAG_SOURCES[entry.kind];
        const inserted = await db.query(`insert into taxonomy.football_tags(id,${column}) values(gen_random_uuid()::text,$1)
          on conflict(${column}) do nothing returning id`, [entry.sourceId]);
        created += inserted.rows.length;
      }
    }
    await db.query("commit");
    return { batch, sources: entries.length, created, alreadyTagged: entries.length - created };
  } catch (error) { await db.query("rollback"); throw error; }
}
export async function verifyTagManifest(db: Db, input: unknown, target: TagTarget) {
  const manifest = validateTagManifest(input, target); let linked = 0;
  for (const entry of manifest.entries) if (await checkEntry(db, entry, false)) linked++;
  return { complete: linked === manifest.entries.length, sources: manifest.entries.length, linked,
    remaining: manifest.entries.length - linked, hash: manifest.hash };
}

export function parseTagOperatorArguments(args: readonly string[]) {
  const values = new Map<string, string>();
  for (const arg of args) {
    const match = /^--(stage|action|scope|batch|confirm|manifest)=(.+)$/.exec(arg);
    requireTag(match && !values.has(match[1]), "TAG_INVALID_ARGUMENTS"); values.set(match[1], match[2]);
  }
  const stage = values.get("stage"), action = values.get("action") ?? "plan";
  requireTag(stage === "local" || stage === "staging", "TAG_EXPLICIT_STAGE_REQUIRED");
  requireTag(["plan", "apply", "verify"].includes(action), "TAG_INVALID_ACTION");
  const allowed = action === "plan" ? ["stage", "action", "scope"] : action === "apply" ? ["stage", "action", "batch", "confirm", "manifest"] : ["stage", "action", "manifest"];
  requireTag([...values.keys()].every(k => allowed.includes(k)), "TAG_INVALID_ARGUMENTS");
  if (action === "plan") requireTag(values.get("scope") === "persisted-football", "TAG_EXPLICIT_SCOPE_REQUIRED");
  if (action === "apply") requireTag(/^[1-9][0-9]{0,2}$/.test(values.get("batch") ?? "") && /^[a-f0-9]{64}$/.test(values.get("confirm") ?? ""), "TAG_CONFIRMATION_REQUIRED");
  return { stage: stage as "local" | "staging", action, batch: Number(values.get("batch")), confirm: values.get("confirm") ?? "", manifest: values.get("manifest") };
}
export function validateTagOperatorConnection(stage: "local" | "staging", connection: string, uid: number | undefined): TagTarget {
  const url = new URL(connection);
  requireTag(["postgres:", "postgresql:"].includes(url.protocol) && !url.search && !url.hash, "TAG_INVALID_CONNECTION");
  if (stage === "local") requireTag(["127.0.0.1", "localhost"].includes(url.hostname) && url.port === "15432" && url.pathname === "/tuttoseriea_local", "TAG_LOCAL_TARGET_REQUIRED");
  else requireTag(stage === "staging" && uid === 0 && url.hostname === "postgres" && (!url.port || url.port === "5432") && url.pathname === "/tuttoseriea_staging", "TAG_STAGING_ROOT_TARGET_REQUIRED");
  return { stage, database: url.pathname.slice(1) };
}
