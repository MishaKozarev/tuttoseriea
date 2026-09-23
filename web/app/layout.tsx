import type { Metadata } from "next";

import { PublicShell } from "@/components/layout/public-shell";

import "./globals.css";

export const metadata: Metadata = {
  title: "tuttoseriea.com",
  description: "Русскоязычная платформа о Серии A.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className="h-full bg-background antialiased">
      <body className="min-h-full font-sans">
        <PublicShell>{children}</PublicShell>
      </body>
    </html>
  );
}
