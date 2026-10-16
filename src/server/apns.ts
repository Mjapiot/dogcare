import "server-only";
import { connect, constants, type ClientHttp2Session } from "node:http2";
import { createPrivateKey, sign } from "node:crypto";
import type { PushPayload } from "@/lib/push-payload";

/**
 * Apple Push Notification service (token-based auth, HTTP/2).
 * Env: APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (.p8 content),
 * APNS_BUNDLE_ID (defaults to app.dogcare.ios).
 */
const HOSTS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
} as const;
export type ApnsEnvironment = keyof typeof HOSTS;

export function isApnsConfigured(): boolean {
  return Boolean(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_PRIVATE_KEY);
}

let cachedJwt: { token: string; issuedAt: number } | null = null;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Provider token, reused for 50 minutes (Apple accepts up to 60). */
function providerToken(): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedJwt.issuedAt < 50 * 60) return cachedJwt.token;
  const keyId = process.env.APNS_KEY_ID!;
  const teamId = process.env.APNS_TEAM_ID!;
  const pem = process.env.APNS_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = base64url(JSON.stringify({ iss: teamId, iat: now }));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), {
    key: createPrivateKey(pem),
    dsaEncoding: "ieee-p1363",
  });
  cachedJwt = { token: `${header}.${claims}.${base64url(signature)}`, issuedAt: now };
  return cachedJwt.token;
}

export type ApnsResult = "ok" | "gone" | "wrong-environment" | "error";

function request(session: ClientHttp2Session, deviceToken: string, payload: PushPayload): Promise<ApnsResult> {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      aps: {
        alert: { title: payload.title, body: payload.body },
        sound: "default",
        "thread-id": payload.tag,
      },
      url: payload.url,
    });
    const req = session.request({
      [constants.HTTP2_HEADER_METHOD]: "POST",
      [constants.HTTP2_HEADER_PATH]: `/3/device/${deviceToken}`,
      authorization: `bearer ${providerToken()}`,
      "apns-topic": process.env.APNS_BUNDLE_ID ?? "app.dogcare.ios",
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-collapse-id": payload.tag.slice(0, 64),
      "content-type": "application/json",
    });
    let status = 0;
    let data = "";
    req.setEncoding("utf8");
    req.on("response", (headers) => {
      status = Number(headers[constants.HTTP2_HEADER_STATUS]);
    });
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (status === 200) return resolve("ok");
      let reason = "";
      try {
        reason = (JSON.parse(data) as { reason?: string }).reason ?? "";
      } catch {
        // empty body
      }
      if (status === 410 || reason === "Unregistered") return resolve("gone");
      if (reason === "BadDeviceToken" || reason === "BadEnvironmentKeyInToken") return resolve("wrong-environment");
      console.error("[dogcare] apns error", status, reason);
      resolve("error");
    });
    req.on("error", () => resolve("error"));
    req.end(body);
  });
}

/**
 * Sends to one device. Builds from Xcode use the sandbox, TestFlight/App
 * Store builds use production: the known environment is tried first, then
 * the other one if Apple reports a token/environment mismatch.
 */
export async function sendApns(
  deviceToken: string,
  payload: PushPayload,
  known: ApnsEnvironment | null,
): Promise<{ result: ApnsResult; environment: ApnsEnvironment | null }> {
  const order: ApnsEnvironment[] = known === "sandbox" ? ["sandbox", "production"] : ["production", "sandbox"];
  for (const env of order) {
    const session = connect(HOSTS[env]);
    session.on("error", () => {});
    try {
      const result = await request(session, deviceToken, payload);
      if (result !== "wrong-environment") return { result, environment: result === "ok" ? env : known };
    } finally {
      session.close();
    }
  }
  return { result: "gone", environment: known };
}
