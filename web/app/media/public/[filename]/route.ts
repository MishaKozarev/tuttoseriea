import { rejectMediaMethod, serveAvatar } from "@/src/media/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ filename: string }> };
export async function GET(request: Request, context: Context) { return serveAvatar(request, (await context.params).filename, "public"); }
export const HEAD = GET;
export const POST = rejectMediaMethod;
export const PUT = rejectMediaMethod;
export const PATCH = rejectMediaMethod;
export const DELETE = rejectMediaMethod;
export const OPTIONS = rejectMediaMethod;
