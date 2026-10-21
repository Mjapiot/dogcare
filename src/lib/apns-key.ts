/**
 * Rebuilds a valid PEM from however the .p8 key was pasted into an
 * environment variable: with or without the BEGIN/END lines, line breaks
 * turned into spaces or literal "\n", surrounding quotes, Windows line endings.
 */
export function normalizeP8Key(raw: string): string {
  let value = raw.trim().replace(/^["']|["']$/g, "").replace(/\\n/g, "\n").replace(/\\r/g, "");
  value = value.replace(/-----(BEGIN|END) [A-Z ]*PRIVATE KEY-----/g, " ");
  const body = value.replace(/[^A-Za-z0-9+/=]/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return ["-----BEGIN PRIVATE KEY-----", ...lines, "-----END PRIVATE KEY-----", ""].join("\n");
}
