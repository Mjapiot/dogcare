import "server-only";
import { extractAbsenceIntent, DEFAULT_GEMINI_MODEL, type GeminiResult } from "@/lib/gemini";

/** The absence assistant is offered only when a Gemini key is configured (server-only secret). */
export function assistantEnabled(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export async function understandWithGemini(text: string, ctx: Parameters<typeof extractAbsenceIntent>[1]): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, reason: "unavailable" };
  return extractAbsenceIntent(text, ctx, { apiKey, model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL });
}
