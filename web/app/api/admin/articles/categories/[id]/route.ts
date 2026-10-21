import { categoriesApi } from "@/src/admin/categories-api";
type Context = { params: Promise<{ id: string }> };
export const GET = async (request: Request, context: Context) => categoriesApi(request, "article", (await context.params).id);
export const PATCH = GET;
export const DELETE = GET;
