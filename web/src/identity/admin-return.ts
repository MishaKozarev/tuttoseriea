export const DEFAULT_ADMIN_RETURN_PATH = "/admin";

function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function resolveAdminReturnPath(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    return DEFAULT_ADMIN_RETURN_PATH;
  }

  try {
    const url = new URL(value, "https://tuttoseriea.local");

    if (url.origin !== "https://tuttoseriea.local" || !isAdminPath(url.pathname)) {
      return DEFAULT_ADMIN_RETURN_PATH;
    }

    return `${url.pathname}${url.search}`;
  } catch {
    return DEFAULT_ADMIN_RETURN_PATH;
  }
}

export function createAdminLoginPath(returnTo: unknown): string {
  const safeReturnPath = resolveAdminReturnPath(returnTo);
  const searchParams = new URLSearchParams({ returnTo: safeReturnPath });

  return `/admin/login?${searchParams}`;
}

export function resolveAdminAuthRedirectUrl(url: string, baseUrl: string): string {
  try {
    const parsedBaseUrl = new URL(baseUrl);
    const parsedUrl = new URL(url, parsedBaseUrl);

    if (parsedUrl.origin !== parsedBaseUrl.origin) {
      return `${parsedBaseUrl.origin}${DEFAULT_ADMIN_RETURN_PATH}`;
    }

    return `${parsedBaseUrl.origin}${resolveAdminReturnPath(
      `${parsedUrl.pathname}${parsedUrl.search}`,
    )}`;
  } catch {
    return `${baseUrl}${DEFAULT_ADMIN_RETURN_PATH}`;
  }
}
