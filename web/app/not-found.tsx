import Link from "next/link";

import { ShellState } from "@/components/layout/shell-state";

export default function NotFound() {
  return (
    <ShellState
      title="Страница не найдена"
      description="Такого адреса сейчас нет на tuttoseriea.com."
      action={
        <Link
          href="/"
          className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          На главную
        </Link>
      }
    />
  );
}
