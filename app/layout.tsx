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
        <meta name="theme-color" content="#6366f1" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className="h-screen overflow-hidden">{children}</body>
    </html>
  );
}
