import type { Metadata, Viewport } from "next";
import { Inter_Tight } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { NativeBridge } from "@/components/app/native-bridge";
import { SupabaseConfigProvider } from "@/lib/supabase/client";
import { getSupabaseEnv } from "@/lib/env";
import "./globals.css";

const sans = Inter_Tight({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Dogcare", template: "%s · Dogcare" },
  description: "Organisez la garde de vos chiens entre amis et repérez immédiatement les jours sans solution.",
  applicationName: "Dogcare",
  appleWebApp: { capable: true, title: "Dogcare", statusBarStyle: "default" },
  formatDetection: { telephone: false, email: false, address: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ebe8e2",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${sans.variable} h-full`}>
      <body className="min-h-dvh">
        <SupabaseConfigProvider value={getSupabaseEnv()}>{children}</SupabaseConfigProvider>
        <Toaster />
        <ServiceWorkerRegister />
        <NativeBridge />
      </body>
    </html>
  );
}
