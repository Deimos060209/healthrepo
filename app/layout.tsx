import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { ToastProvider } from "@/components/ToastProvider";
import { Navbar } from "@/components/Navbar";
import { BottomNav } from "@/components/BottomNav";
import { RouteGuard } from "@/components/RouteGuard";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://healthrepo.vercel.app"),
  title: {
    default: "HealthRepo — Your Health. Your Right. Your Repo.",
    template: "%s · HealthRepo",
  },
  description:
    "Photograph a packaged product to check Legal Metrology compliance and screen its ingredients for harmful or banned substances.",
  applicationName: "HealthRepo",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "HealthRepo",
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0d9488",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} min-h-full flex flex-col antialiased`}>
        <AuthProvider>
          <ToastProvider>
            <Navbar />
            <RouteGuard>{children}</RouteGuard>
            <BottomNav />
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
