import { timingSafeEqual } from "node:crypto";

/**
 * Vercel Cron calls with "Authorization: Bearer <CRON_SECRET>". Without a
 * configured secret (16+ characters) nothing is authorized.
 */
export function isAuthorizedCron(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(authorization);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
