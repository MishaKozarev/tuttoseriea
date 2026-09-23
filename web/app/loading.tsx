import { Container } from "@/components/layout/container";

export default function Loading() {
  return (
    <Container
      size="normal"
      className="py-16 sm:py-24"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Загрузка</span>
      <div className="max-w-3xl space-y-5">
        <div className="h-4 w-32 animate-pulse rounded-md bg-muted" />
        <div className="h-11 w-full max-w-xl animate-pulse rounded-lg bg-muted" />
        <div className="space-y-3">
          <div className="h-4 w-full max-w-2xl animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-full max-w-lg animate-pulse rounded-md bg-muted" />
        </div>
      </div>
    </Container>
  );
}
