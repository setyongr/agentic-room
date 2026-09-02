import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

const SITE_NAME = "WebMCP";

export const metadata: Metadata = {
  applicationName: SITE_NAME,
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description:
    "A warm, tactile 3D home on the web — build, furnish, and inhabit spatial rooms in your browser.",
  creator: SITE_NAME,
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: "Build, furnish, and inhabit warm 3D rooms in your browser.",
    locale: "en_US",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f1e7" },
    { media: "(prefers-color-scheme: dark)", color: "#191510" },
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
