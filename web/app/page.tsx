import { Container } from "@/components/layout/container";

export default function Home() {
  return (
    <section className="py-16 sm:py-24">
      <Container size="normal">
        <div className="max-w-3xl space-y-5">
          <p className="text-sm font-medium text-muted-foreground">
            tuttoseriea.com
          </p>
          <h1 className="text-4xl font-semibold leading-tight text-foreground sm:text-5xl">
            Serie A на русском
          </h1>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            Русскоязычная платформа о Серии A и итальянском футболе.
          </p>
        </div>
      </Container>
    </section>
  );
}
