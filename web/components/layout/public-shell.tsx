import Link from "next/link";
import type { ReactNode } from "react";

import { Container } from "@/components/layout/container";

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b bg-background">
        <Container
          size="wide"
          className="flex min-h-14 items-center justify-between gap-4"
        >
          <Link
            href="/"
            className="inline-flex items-baseline gap-2 text-sm font-semibold text-foreground transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span>tuttoseriea.com</span>
            <span className="hidden text-sm font-normal text-muted-foreground sm:inline">
              Serie A на русском
            </span>
          </Link>
          <nav
            aria-label="Основная навигация"
            className="hidden items-center gap-5 sm:flex"
          >
            <Link
              href="/"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Главная
            </Link>
            <Link
              href="/clubs"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Клубы
            </Link>
          </nav>
        </Container>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t bg-muted/30">
        <Container
          size="wide"
          className="flex min-h-16 flex-col justify-center gap-1 py-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
        >
          <p>tuttoseriea.com</p>
          <p>Серия A на русском</p>
        </Container>
      </footer>
    </div>
  );
}
