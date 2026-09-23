import type { HTMLAttributes } from "react";
import { cn } from "cn";

type ContainerSize = "wide" | "normal" | "narrow";

const containerSizeClass: Record<ContainerSize, string> = {
  wide: "max-w-[var(--container-wide)]",
  normal: "max-w-[var(--container-normal)]",
  narrow: "max-w-[var(--container-narrow)]",
};

type ContainerProps = HTMLAttributes<HTMLDivElement> & {
  size?: ContainerSize;
};

export function Container({
  className,
  size = "normal",
  ...props
}: ContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-[var(--container-padding)]",
        containerSizeClass[size],
        className,
      )}
      {...props}
    />
  );
}
