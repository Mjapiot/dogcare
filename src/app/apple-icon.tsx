import { ImageResponse } from "next/og";
import { AppIconMark } from "@/components/pwa/app-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<AppIconMark size={180} padding={20} />, size);
}
