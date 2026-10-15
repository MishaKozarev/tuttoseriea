import { getFootballAdminJob } from "@/src/admin/football-jobs-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await context.params;
  return getFootballAdminJob(request, requestId);
}
