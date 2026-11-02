"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { ArticleDraftDTO } from "@/src/articles/contract";
import { articleErrorMessage, articleRequest, needsArticleRefresh } from "./client";

export function CreateArticleDraft() {
  const router = useRouter();
  const operationId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState("");
  async function create() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    operationId.current ??= crypto.randomUUID();
    try {
      const { draft } = await articleRequest<{ draft: ArticleDraftDTO }>("/api/admin/articles", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: operationId.current }),
      });
      router.replace(`/admin/articles/${draft.id}`);
    } catch (error) { setUncertain(needsArticleRefresh(error)); setMessage(articleErrorMessage(error)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="max-w-2xl space-y-4 rounded border p-5">
    <p>Создайте пустой черновик, затем заполните текст и настройки статьи.</p>
    <button type="button" disabled={busy} onClick={() => void create()} className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">{busy ? "Создание…" : uncertain ? "Проверить создание черновика" : "Создать черновик"}</button>
    {uncertain && <p className="text-sm text-muted-foreground">Повторная проверка использует ту же операцию создания.</p>}
    {message && <p role="alert" className="break-words">{message}</p>}
  </div>;
}
