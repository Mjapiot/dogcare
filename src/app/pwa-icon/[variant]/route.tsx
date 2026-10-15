import { ImageResponse } from "next/og";
import { AppIconMark } from "@/components/pwa/app-icon";

const VARIANTS: Record<string, { size: number; padding: number }> = {
  "192": { size: 192, padding: 18 },
  "512": { size: 512, padding: 48 },
  // maskable icons need a safe zone (inner 80%)
  maskable: { size: 512, padding: 110 },
};

export const dynamic = "force-static";

export function generateStaticParams() {
  return Object.keys(VARIANTS).map((variant) => ({ variant }));
}

export async function GET(_request: Request, ctx: RouteContext<"/pwa-icon/[variant]">) {
  const { variant } = await ctx.params;
  const config = VARIANTS[variant];
  if (!config) return new Response("Not found", { status: 404 });
  return new ImageResponse(<AppIconMark size={config.size} padding={config.padding} />, {
    width: config.size,
    height: config.size,
  });
}
