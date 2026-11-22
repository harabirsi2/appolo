import type { Metadata, Viewport } from "next";
import { fontVariables } from "./fonts";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";
import { DEFAULT_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  // Canonicals, OG images and the sitemap all need absolute URLs, and every
  // page supplies relative paths; this is the base they resolve against.
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Appolo — Rate and rank what you love",
    template: "%s · Appolo",
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: { siteName: SITE_NAME, type: "website", title: SITE_NAME, description: SITE_TAGLINE },
  twitter: { card: "summary_large_image" },
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "black-translucent" },
  // Home-screen icon for iOS, which ignores the manifest's icons.
  icons: { apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }] },
};

/**
 * `viewportFit: cover` is what makes the safe-area insets non-zero on a
 * notched phone; without it env(safe-area-inset-*) resolves to 0 and the bottom
 * nav sits under the home indicator in the installed app.
 *
 * Maximum scale is deliberately not restricted: pinch-zoom stays available.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#07080A",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body className="min-h-screen bg-bg text-ink antialiased" suppressHydrationWarning>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}