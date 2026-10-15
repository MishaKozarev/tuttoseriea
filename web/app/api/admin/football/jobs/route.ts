import { createFootballAdminJob, listFootballAdminJobs } from "@/src/admin/football-jobs-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createFootballAdminJob;
export const GET = listFootballAdminJobs;
