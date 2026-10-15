import { editFootballLocalization, getFootballLocalization } from "@/src/admin/football-localization-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ kind: string; id: string }> };
export async function GET(request: Request, context: Context) {
  const { kind, id } = await context.params;
  return getFootballLocalization(request, kind, id);
}
export async function PATCH(request: Request, context: Context) {
  const { kind, id } = await context.params;
  return editFootballLocalization(request, kind, id);
}
