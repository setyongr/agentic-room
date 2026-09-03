import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { APP_DESCRIPTION, APP_NAME, APP_URL } from "@/data/appIdentity";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  applicationName: APP_NAME,
  title: {
    default: `${APP_NAME} — 3D Room Planner`,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: `${APP_NAME} — 3D Room Planner`,
    description: APP_DESCRIPTION,
    locale: "en_US",
    url: APP_URL,
    images: [{ url: new URL("/og.png", APP_URL).href, alt: `${APP_NAME} — Your room. Your agent. One shared canvas.` }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${APP_NAME} — 3D Room Planner`,
    description: APP_DESCRIPTION,
    images: [new URL("/og.png", APP_URL).href],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
