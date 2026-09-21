import type { Metadata } from "next";
import type { ReactNode } from "react";
// @ts-expect-error Next.js bundles this side-effect CSS import at build time.
import "./globals.css";

export const metadata: Metadata = {
  title: "News Pulse — Topic-Clustered News Timeline",
  description: "Live news from multiple outlets, automatically grouped into topic clusters on a timeline.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}