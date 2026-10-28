import Link from "next/link";
import { forbidden, redirect } from "next/navigation";
import { AdminShell } from "@/components/layout/admin-shell";
import { Container } from "@/components/layout/container";
import { WriterProfileEditor } from "@/components/admin/writer-profile";
import { getOwnWriterAccess } from "@/src/identity/writer-access";
import { getOwnWriterProfile } from "@/src/identity/writer-service";
import type { WriterProfileDTO } from "@/src/identity/writer-contract";
import { logger } from "@/src/logging/logger";

export default async function WriterProfilePage() {
  const access = await getOwnWriterAccess();
  if (access.type === "redirect") redirect(access.location);
  if (access.type === "forbidden") forbidden();
  let profile: WriterProfileDTO | null = null;
  try { profile = await getOwnWriterProfile(); }
  catch { logger.error("Writer profile page read failed", { context: { event: "writer.profile_read_failed" } }); }
  return <AdminShell><section className="py-10"><Container size="wide" className="space-y-6">
    <h1 className="text-2xl font-semibold">Кабинет автора</h1>
    <Link href="/admin" className="underline">В кабинет</Link>
    {profile ? <WriterProfileEditor initial={profile} /> : <p role="alert">Не удалось загрузить профиль. Обновите страницу.</p>}
  </Container></section></AdminShell>;
}
