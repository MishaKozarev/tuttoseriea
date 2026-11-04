import { articlePublicationApi } from "@/src/articles/api";

export async function POST(request: Request, { params }: { params: Promise<{ articleId: string }> }) {
  return articlePublicationApi(request, (await params).articleId);
}
