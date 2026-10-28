import { ApplicationError } from "../api/errors";

export function mediaError(code: string, status: number, message: string): ApplicationError {
  return new ApplicationError({ code, status, message });
}

export const PRIVATE_MEDIA_CACHE = "private, no-store, max-age=0, must-revalidate";
export const PUBLIC_MEDIA_CACHE = "public, max-age=0, s-maxage=3600, must-revalidate";

export function preventMediaCaching(response: Response): Response {
  response.headers.set("Cache-Control", PRIVATE_MEDIA_CACHE);
  response.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
