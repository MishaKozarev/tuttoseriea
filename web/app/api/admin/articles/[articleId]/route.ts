import { articleDraftApi } from "@/src/articles/api";
type Context = { params: Promise<{ articleId: string }> };
export const GET = async (request: Request, context: Context) => articleDraftApi(request, (await context.params).articleId);
export const PATCH = async (request: Request, context: Context) => articleDraftApi(request, (await context.params).articleId);
