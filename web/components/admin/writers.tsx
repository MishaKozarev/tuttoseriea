"use client";

import { useRef, useState } from "react";
import type { WriterAdminDTO, WriterProfileDTO } from "@/src/identity/writer-contract";
import { requiresWriterRefresh, writerErrorMessage, writerRequest } from "@/src/admin/writers-client";

export function Writers({ initial }: { initial: WriterAdminDTO[] }) {
  const [writers, setWriters] = useState(initial);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [lookupEmail, setLookupEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);

  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const query = lookupEmail.trim() ? `?${new URLSearchParams({ email: lookupEmail.trim() })}` : "";
      const result = await writerRequest<{ writers: WriterAdminDTO[] }>(`/api/admin/writers${query}`);
      setWriters(result.writers); setUncertain(false); setMessage("Список обновлён.");
    } catch (error) { setMessage(writerErrorMessage(error)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function mutate(path: string, method: string, body: Record<string, unknown>, success: string) {
    if (inFlight.current || uncertain) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const result = await writerRequest<{ writer?: WriterAdminDTO; profile?: WriterProfileDTO }>(path, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, operationId: crypto.randomUUID() }),
      });
      if (result.writer) {
        const writer = result.writer;
        setWriters(previous => [writer, ...previous.filter(item => item.accountId !== writer.accountId)]);
      } else if (result.profile) {
        const profile = result.profile;
        setWriters(previous => previous.map(writer => writer.accountId === profile.accountId ? { ...writer, profile, canPublishOwn: profile.canPublishOwn, publicationRevision: profile.publicationRevision } : writer));
      } else throw new Error("Unknown outcome");
      setMessage(success);
    } catch (error) { setUncertain(requiresWriterRefresh(error)); setMessage(writerErrorMessage(error)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <div className="space-y-6">
    <section className="space-y-3 rounded border p-4" aria-labelledby="new-writer-heading">
      <h2 id="new-writer-heading" className="text-lg font-semibold">Создать нового автора</h2>
      <p className="text-sm text-muted-foreground">Email используется для входа. Публичный никнейм автор выберет в своём кабинете. Данные для входа передайте автору лично.</p>
      <form className="space-y-3" onSubmit={event => {
        event.preventDefault();
        const submittedPassword = password;
        setPassword("");
        void mutate("/api/admin/writers", "POST", { action: "create", email, password: submittedPassword }, "Автор создан. Данные для входа можно передать автору.");
      }}>
        <label className="block">Email нового автора<input type="email" required maxLength={254} autoComplete="off" value={email} disabled={busy} onChange={event => setEmail(event.target.value)} className="mt-1 block w-full max-w-lg rounded border p-2" /></label>
        <label className="block">Пароль нового автора<input type="password" required minLength={15} maxLength={128} autoComplete="new-password" value={password} disabled={busy} onChange={event => setPassword(event.target.value)} className="mt-1 block w-full max-w-lg rounded border p-2" /></label>
        <p className="text-sm text-muted-foreground">Пароль: от 15 до 128 символов.</p>
        <button disabled={busy || uncertain} className="rounded border px-4 py-2">Создать Writer</button>
      </form>
    </section>
    <section className="space-y-3" aria-labelledby="writers-heading">
      <h2 id="writers-heading" className="text-lg font-semibold">Авторы и существующие аккаунты</h2>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void refresh(); }}>
        <label className="min-w-0 flex-1">Найти аккаунт по email<input type="email" maxLength={254} value={lookupEmail} onChange={event => setLookupEmail(event.target.value)} disabled={busy} className="mt-1 block w-full max-w-lg rounded border p-2" /></label>
        <button disabled={busy} className="rounded border px-4 py-2">Обновить список</button>
      </form>
      <p className="text-sm text-muted-foreground">Укажите точный email для поиска существующего аккаунта. Без поиска показаны последние 50 авторов.</p>
      {uncertain && <p role="alert">Обновите список перед следующим изменением. Для проверки создания найдите указанный email.</p>}
      {!writers.length && <p>Аккаунты не найдены.</p>}
      <ul className="space-y-3">{writers.map(writer => <li key={writer.accountId} className="space-y-3 rounded border p-4">
        <div className="break-words"><p className="font-medium">{writer.profile.nickname || "Никнейм пока не выбран"}</p><p>{writer.email}</p></div>
        <p className="text-sm">Роли: {writer.roles.join(", ") || "не назначены"}. Аккаунт: {writer.status === "active" ? "активен" : "отключён"}.</p>
        {writer.isWriter ? <>
          <p>Самостоятельная публикация собственных статей: {writer.canPublishOwn ? "разрешена" : "не разрешена"}.</p>
          <button disabled={busy || uncertain} className="rounded border px-3 py-2" onClick={() => void mutate(
            `/api/admin/writers/${encodeURIComponent(writer.accountId)}/publication`, "PATCH",
            { enabled: !writer.canPublishOwn, expectedRevision: writer.publicationRevision },
            writer.canPublishOwn ? "Право самостоятельной публикации отозвано." : "Право самостоятельной публикации выдано.",
          )}>{writer.canPublishOwn ? "Отозвать право публикации" : "Разрешить публикацию"}: {writer.email}</button>
        </> : <>
          <p className="text-sm">Роль Writer добавится к существующим ролям. Для входа используется действующий пароль этого аккаунта.</p>
          <button disabled={busy || uncertain} className="rounded border px-3 py-2" onClick={() => void mutate("/api/admin/writers", "POST", { action: "attach", accountId: writer.accountId }, "Существующему аккаунту назначена роль Writer.")}>Назначить Writer: {writer.email}</button>
        </>}
      </li>)}</ul>
    </section>
    {message && <p role="status" className="break-words">{message}</p>}
  </div>;
}
