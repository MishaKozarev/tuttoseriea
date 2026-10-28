import { writersApi } from "@/src/admin/writers-api";

export const GET = (request: Request) => writersApi(request);
export const POST = (request: Request) => writersApi(request);
