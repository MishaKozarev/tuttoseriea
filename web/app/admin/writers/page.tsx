import { forbidden, redirect } from "next/navigation";
import { AdminShell } from "@/components/layout/admin-shell";
import { Container } from "@/components/layout/container";
import { CatalogNavigation } from "@/components/admin/catalog-navigation";
import { Writers } from "@/components/admin/writers";
import { getWriterManagementAccess } from "@/src/identity/writer-access";
import { listWriters } from "@/src/identity/writer-service";
import type { WriterAdminDTO } from "@/src/identity/writer-contract";
import { logger } from "@/src/logging/logger";

export default async function WritersPage() {
  const access = await getWriterManagementAccess();
  if (access.type === "redirect") redirect(access.location);
  if (access.type === "forbidden") forbidden();
  let writers: WriterAdminDTO[] | null = null;
  try { writers = await listWriters(); }
  catch { logger.error("Writer management page read failed", { context: { event: "writer.list_failed" } }); }
  return <AdminShell><section className="py-10"><Container size="wide" className="space-y-6">
    <h1 className="text-2xl font-semibold">Управление авторами</h1>
    <CatalogNavigation />
    {writers ? <Writers initial={writers} /> : <p role="alert">Не удалось загрузить авторов. Обновите страницу.</p>}
  </Container></section></AdminShell>;
}
