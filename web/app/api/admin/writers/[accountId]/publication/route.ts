import { writerPublicationApi } from "@/src/admin/writers-api";

export async function PATCH(request: Request, context: { params: Promise<{ accountId: string }> }) {
  return writerPublicationApi(request, (await context.params).accountId);
}
