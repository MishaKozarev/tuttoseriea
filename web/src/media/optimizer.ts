// Keep this module free of DB/Node-only dependencies: Proxy rejects Media
// optimizer targets before the optimizer cache and without a database read.
export function isMediaOptimizerTarget(requestUrl: string, applicationOrigin?: string): boolean {
  const request = new URL(requestUrl);
  const origins = new Set([request.origin]);
  if (applicationOrigin) {
    try { origins.add(new URL(applicationOrigin).origin); } catch { /* An invalid config never authorizes another origin. */ }
  }
  if (!request.pathname.startsWith("/_next/image")) return false;
  for (const target of request.searchParams.getAll("url")) {
    let decoded = target;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        // WHATWG URL normalizes dot segments and backslashes, like Next's fetch.
        const normalized = new URL(decoded.replace(/\\/g, "/"), request.origin);
        if (origins.has(normalized.origin) && /^\/+media(?:\/|$)/i.test(normalized.pathname)) return true;
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch { break; }
    }
  }
  return false;
}
