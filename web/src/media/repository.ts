import "server-only";
import { createHash } from "node:crypto";
import { getDbPool } from "../db";
import type { StoredMediaAsset, StoredPurposeMediaAsset } from "./storage";
import type { ArticleActor } from "../articles/access";
import type { ArticleImageDTO } from "../articles/contract";
import { ARTICLE_MAX_IMAGES } from "../articles/document";
import { withArticleDraftWrite } from "../articles/service";
import { mediaError } from "./errors";

export async function findLinkedAvatar(id: string, ownerAccountId?: string): Promise<StoredMediaAsset | null> {
  // A current Writer avatar is a public link. Account disabling does not remove
  // this link or the author's public identity. Draft Article links are private.
  const row = (await getDbPool().query<StoredMediaAsset>(`
    select m.id,m.storage_key as "storageKey",m.mime_type as "mimeType",m.byte_size as "byteSize",
      m.width,m.height,m.sha256,m.uploader_account_id as "uploaderAccountId"
    from media.assets m join identity.writer_profiles p on p.avatar_media_id=m.id
    where m.id=$1 and m.kind='avatar' ${ownerAccountId ? "and p.account_id=$2 and m.uploader_account_id=$2" : ""}
    limit 1`, ownerAccountId ? [id, ownerAccountId] : [id])).rows[0];
  return row ?? null;
}

export async function findArticleDraftImage(id: string, actor: ArticleActor): Promise<StoredMediaAsset | null> {
  // Uploading an image does not make it public. Access comes from the current
  // attachment and Article ACL, including images uploaded by a Super Admin.
  const row = (await getDbPool().query<StoredMediaAsset>(`
    select m.id,m.storage_key as "storageKey",m.mime_type as "mimeType",m.byte_size as "byteSize",
      m.width,m.height,m.sha256,m.uploader_account_id as "uploaderAccountId"
    from media.assets m join article.draft_images i on i.media_id=m.id
      join article.drafts d on d.article_id=i.draft_id
      join article.articles a on a.id=d.article_id
    where m.id=$1 and m.kind='article_image' and ($3::boolean or a.author_account_id=$2)
    limit 1`, [id, actor.accountId, actor.manageAll])).rows[0];
  return row ?? null;
}

export async function attachArticleDraftImage(input: {
  articleId: string; expectedRevision: number; operationId: string; asset: StoredPurposeMediaAsset;
}): Promise<{ result: ArticleImageDTO; revision: number }> {
  const { articleId, expectedRevision, operationId, asset } = input;
  if (asset.kind !== "article_image") throw mediaError("VALIDATION_ERROR", 400, "An Article image is required");
  const fingerprint = createHash("sha256").update(JSON.stringify({ sha256: asset.sha256, expectedRevision })).digest("hex");
  return withArticleDraftWrite<ArticleImageDTO>(articleId, expectedRevision, async (client, actor) => {
    if (actor.accountId !== asset.uploaderAccountId) throw mediaError("FORBIDDEN", 403, "Upload actor changed");
    // The helper holds the draft lock across this count, both inserts and revision
    // increment, so parallel uploads cannot bypass the attachment limit.
    const count = (await client.query<{ count: number }>("select count(*)::int as count from article.draft_images where draft_id=$1", [articleId])).rows[0].count;
    if (count >= ARTICLE_MAX_IMAGES) throw mediaError("VALIDATION_ERROR", 400, "A draft may have at most 20 uploaded images");
    await client.query(`insert into media.assets(id,storage_key,kind,mime_type,byte_size,width,height,sha256,uploader_account_id)
      values($1,$2,'article_image',$3,$4,$5,$6,$7,$8)`,
    [asset.id, asset.storageKey, asset.mimeType, asset.byteSize, asset.width, asset.height, asset.sha256, actor.accountId]);
    await client.query("insert into article.draft_images(draft_id,media_id) values($1,$2)", [articleId, asset.id]);
    return { id: asset.id, url: `/media/private/${asset.id}.webp`, width: asset.width, height: asset.height, byteSize: asset.byteSize };
  }, { operationId, fingerprint });
}
