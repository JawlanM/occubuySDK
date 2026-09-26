// Helpers for per-partner domain binding (dev plan 1.7). A partner's allowed origins come
// from the portal through /partners/sync; POST /api/scores checks the browser's Origin
// header against them so a copied key doesn't work from someone else's website.

// "https://JMRealestate.com.au/" -> "https://jmrealestate.com.au". Returns null for anything
// that isn't a bare http(s) origin (paths, queries, other schemes), so junk never gets stored.
export function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  return url.origin;
}

export function normalizeOriginList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const origins: string[] = [];
  for (const item of value) {
    const origin = normalizeOrigin(item);
    if (!origin) return null;
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

// localhost / 127.0.0.1 on any port - always allowed for sandbox keys so partners can test
// before they register a real domain
export function isLocalDevOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}
