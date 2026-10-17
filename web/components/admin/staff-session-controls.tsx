"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { staffAuthRequest } from "./staff-auth-form";
import { useRouter } from "next/navigation";
export function StaffSessionControls({ superAdmin = false }: { superAdmin?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  return <div className="flex flex-wrap items-center gap-4">
    {superAdmin && <><Link href="/admin/football">Football Admin</Link><Link href="/admin/security">Сменить пароль</Link></>}
    <Button disabled={pending} variant="outline" onClick={async () => {
      setPending(true); setFailed(false);
      try { await staffAuthRequest("/sign-out", {}); router.replace("/admin/login"); router.refresh(); }
      catch { setPending(false); setFailed(true); }
    }}>Выйти</Button>{failed && <p role="alert">Не удалось выйти. Повторите попытку.</p>}
  </div>;
}
