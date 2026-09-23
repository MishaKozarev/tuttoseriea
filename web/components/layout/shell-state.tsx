import type { ReactNode } from "react";

import { Container } from "@/components/layout/container";

type ShellStateProps = {
  action?: ReactNode;
  description: string;
  title: string;
};

export function ShellState({ action, description, title }: ShellStateProps) {
  return (
    <Container
      size="narrow"
      className="flex min-h-[28rem] flex-col justify-center py-16 sm:py-24"
    >
      <div className="space-y-5">
        <h1 className="text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
          {title}
        </h1>
        <p className="text-base leading-7 text-muted-foreground">
          {description}
        </p>
        {action ? <div className="pt-2">{action}</div> : null}
      </div>
    </Container>
  );
}
