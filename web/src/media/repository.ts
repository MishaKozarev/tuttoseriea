import "server-only";
import { getDbPool } from "../db";
import type { StoredMediaAsset } from "./storage";

export async function findLinkedAvatar(id: string, ownerAccountId?: string): Promise<StoredMediaAsset | null> {
  // A current Writer avatar is a public link. Account disabling does not remove
  // this link or the author's public identity. Article links belong to a later part.
  const row = (await getDbPool().query<StoredMediaAsset>(`
    select m.id,m.storage_key as "storageKey",m.mime_type as "mimeType",m.byte_size as "byteSize",
      m.width,m.height,m.sha256,m.uploader_account_id as "uploaderAccountId"
    from media.assets m join identity.writer_profiles p on p.avatar_media_id=m.id
    where m.id=$1 ${ownerAccountId ? "and p.account_id=$2 and m.uploader_account_id=$2" : ""}
    limit 1`, ownerAccountId ? [id, ownerAccountId] : [id])).rows[0];
  return row ?? null;
}
