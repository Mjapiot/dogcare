import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeP8Key } from "@/lib/apns-key";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");

describe("normalizeP8Key accepts every way the key may have been pasted", () => {
  it.each([
    ["the original file", pem],
    ["line breaks turned into spaces", pem.replace(/\n/g, " ")],
    ["literal \\n sequences", pem.replace(/\n/g, "\\n")],
    ["surrounding quotes", `"${pem}"`],
    ["Windows line endings", pem.replace(/\n/g, "\r\n")],
    ["only the base64 body", body],
    ["no line breaks at all", pem.replace(/\n/g, "")],
  ])("%s", (_label, pasted) => {
    expect(() => createPrivateKey(normalizeP8Key(pasted))).not.toThrow();
  });
});
