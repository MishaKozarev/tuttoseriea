import { uploadArticleDraftImage } from "@/src/media/article-api";
import { rejectMediaMethod } from "@/src/media/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ articleId: string }> };
export async function POST(request: Request, context: Context) {
  return uploadArticleDraftImage(request, (await context.params).articleId);
}
export const GET = rejectMediaMethod;
export const HEAD = rejectMediaMethod;
export const PUT = rejectMediaMethod;
export const PATCH = rejectMediaMethod;
export const DELETE = rejectMediaMethod;
export const OPTIONS = rejectMediaMethod;
