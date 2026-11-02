import { articleOptionsApi } from "@/src/articles/api";
export const GET = (request: Request) => articleOptionsApi(request, "categories");
