import "server-only";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for cookie-authenticated mutations. Browsers attach Sec-Fetch-Site and/or Origin
 * to every cross-site POST/PUT/PATCH/DELETE; requests carrying neither are not browser-driven and
 * therefore cannot ride a victim's cookies. `same-site` is rejected on purpose: sibling
 * subdomains are not trusted.
 */
export function isCrossSiteMutation(request: Request, allowedOrigins: readonly string[]): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return false;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null) return fetchSite !== "same-origin" && fetchSite !== "none";

  const origin = request.headers.get("origin");
  if (origin === null) return false;
  return !allowedOrigins.includes(origin);
}
