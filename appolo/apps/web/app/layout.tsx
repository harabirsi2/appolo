import type { Metadata } from "next";
import { fontVariables } from "./fonts";
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
  themeColor: "#07080A",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body className="min-h-screen bg-bg text-ink antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}