import { ownWriterProfileApi } from "@/src/admin/writers-api";

export const GET = (request: Request) => ownWriterProfileApi(request);
export const PATCH = (request: Request) => ownWriterProfileApi(request);
