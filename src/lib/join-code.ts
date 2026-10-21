/** Group join codes: 8 characters from an alphabet without look-alikes. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Cleans what the user typed ("k7pq-m2xd " → "K7PQM2XD"), or null if it cannot be a code. */
export function normalizeJoinCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length !== 8) return null;
  return [...cleaned].every((c) => ALPHABET.includes(c)) ? cleaned : null;
}

/** Readable form: "K7PQ-M2XD". */
export function formatJoinCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
