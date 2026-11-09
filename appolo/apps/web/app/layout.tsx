import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import "./globals.css";

/** Editorial display face for page titles and the wordmark. */
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Appolo — Rate and rank what you love",
    template: "%s · Appolo",
  },
  description:
    "Rate movies, TV, music, podcasts, and books through quick head-to-head matchups, get a personalised score, and build your ranked top five.",
  applicationName: "Appolo",
  appleWebApp: { capable: true, title: "Appolo", statusBarStyle: "black-translucent" },
};

export const viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} min-h-screen bg-bg text-ink antialiased`}>{children}</body>
    </html>
  );
}