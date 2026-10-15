import "server-only";

/**
 * Time of the current request. Server Components render once per request,
 * so reading the clock here is intentional (statuses depend on "now").
 */
export function requestNow(): number {
  return Date.now();
}
