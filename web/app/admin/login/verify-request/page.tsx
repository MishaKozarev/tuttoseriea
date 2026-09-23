import { Container } from "@/components/layout/container";
import { resolveAdminReturnPath } from "@/src/identity/admin-return";

export default async function AdminVerifyRequestPage({
  searchParams,
}: PageProps<"/admin/login/verify-request">) {
  const params = await searchParams;

  return (
    <main className="flex min-h-dvh items-center bg-background py-10">
      <Container size="narrow">
        <div className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground">
            tuttoseriea.com
          </p>
          <h1 className="text-2xl font-semibold text-foreground">
            Проверьте email
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Если адрес заранее разрешён для staff-доступа и delivery включён,
            magic-link будет отправлен. Внешняя SMTP-отправка по умолчанию
            отключена.
          </p>
          <p className="sr-only">
            Return path: {resolveAdminReturnPath(params.returnTo)}
          </p>
        </div>
      </Container>
    </main>
  );
}
