import { categoriesApi } from "@/src/admin/categories-api";
export const GET = (request: Request) => categoriesApi(request, "article");
export const POST = (request: Request) => categoriesApi(request, "article");
