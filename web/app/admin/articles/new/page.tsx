import Link from "next/link";
import { forbidden, redirect } from "next/navigation";

import { AdminShell } from "@/components/layout/admin-shell";
import { Container } from "@/components/layout/container";
import { CreateArticleDraft } from "@/components/articles/create-draft";
import { getArticlesAccess } from "@/src/articles/access";

export default async function NewArticlePage() {
  const access = await getArticlesAccess("/admin/articles/new");
  if (access.type === "redirect") redirect(access.location);
  if (access.type === "forbidden") forbidden();
  return <AdminShell><section className="py-10"><Container size="wide" className="space-y-6">
    <h1 className="text-2xl font-semibold">Новая статья</h1>
    <Link href="/admin/articles" className="inline-block underline">К списку черновиков</Link>
    <CreateArticleDraft />
  </Container></section></AdminShell>;
}
