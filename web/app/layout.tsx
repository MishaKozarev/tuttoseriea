import type { Metadata } from "next";
import { headers } from "next/headers";

import { buildRootMetadata } from "@/src/seo/site";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  await headers();

  return buildRootMetadata();
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className="h-full bg-background antialiased">
      <body className="min-h-full font-sans">
        {children}
      </body>
    </html>
  );
}
