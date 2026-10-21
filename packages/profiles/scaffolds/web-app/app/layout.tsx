import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = { title: "App", description: "Built with Karigor" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0e5e55" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Inter for Latin text, Hind Siliguri for Bangla; the system font shows until they load. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Hind+Siliguri:wght@400;600&display=swap" />
      </head>
      <body className="min-h-screen bg-ground font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
