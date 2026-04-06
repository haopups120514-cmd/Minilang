import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mimilang",
  description: "Real-time lecture transcription and translation",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#a78bfa" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className="h-dvh overflow-hidden">{children}</body>
    </html>
  );
}
