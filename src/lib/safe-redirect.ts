/**
 * Returns an in-app path for a user-supplied "next" value, or the fallback.
 * Rejects anything that a browser could resolve to another origin:
 * "//evil.com", "/\evil.com", "https://evil.com", control characters…
 */
export function safeRedirectPath(next: unknown, fallback = "/"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2000) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const base = "https://dogcare.invalid";
    const url = new URL(next, base);
    if (url.origin !== base) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
