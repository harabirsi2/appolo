import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Appolo — Reviews, messaging, and AI for local business",
    template: "%s · Appolo",
  },
  description:
    "Appolo turns every customer conversation into a review, a booking, and a relationship. Reviews, shared inbox, and an AI employee in one place.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}