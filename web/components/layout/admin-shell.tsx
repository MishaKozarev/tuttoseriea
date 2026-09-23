import type { ReactNode } from "react";

import { Container } from "@/components/layout/container";

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b bg-background">
        <Container
          size="wide"
          className="flex min-h-14 items-center justify-between gap-4"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              tuttoseriea.com
            </p>
            <p className="text-sm text-muted-foreground">Администрирование</p>
          </div>
        </Container>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
