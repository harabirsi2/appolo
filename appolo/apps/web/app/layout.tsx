import type { Metadata } from "next";
import "./globals.css";

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
  themeColor: "#0a0c10",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}