"use client";

import { useRef, useState } from "react";
import type { WriterProfileDTO } from "@/src/identity/writer-contract";
import { requiresWriterRefresh, writerErrorMessage, writerRequest } from "@/src/admin/writers-client";

export function WriterProfileEditor({ initial }: { initial: WriterProfileDTO }) {
  const [profile, setProfile] = useState(initial);
  const [nickname, setNickname] = useState(initial.nickname);
  const [socialLinks, setSocialLinks] = useState(initial.socialLinks);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);

  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const result = await writerRequest<{ profile: WriterProfileDTO }>("/api/admin/profile");
      setProfile(result.profile); setNickname(result.profile.nickname); setSocialLinks(result.profile.socialLinks); setUncertain(false);
      setMessage("Профиль обновлён. Можно продолжать редактирование.");
    } catch (error) { setMessage(writerErrorMessage(error)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function save(upload: boolean) {
    if (inFlight.current || uncertain || upload && !avatar) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const operationId = crypto.randomUUID();
      const result = await writerRequest<{ profile: WriterProfileDTO }>(upload ? "/api/admin/profile/avatar" : "/api/admin/profile", upload ? {
        method: "POST", headers: { "Content-Type": avatar!.type, "X-Profile-Revision": String(profile.revision), "X-Operation-ID": operationId }, body: avatar,
      } : {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname, socialLinks, expectedRevision: profile.revision, operationId }),
      });
      setProfile(result.profile);
      if (!upload) { setNickname(result.profile.nickname); setSocialLinks(result.profile.socialLinks); }
      setMessage(upload ? "Аватар сохранён." : "Профиль сохранён.");
    } catch (error) { setUncertain(requiresWriterRefresh(error)); setMessage(writerErrorMessage(error)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <div className="space-y-6">
    <p>Самостоятельная публикация собственных статей: {profile.canPublishOwn ? "разрешена" : "не разрешена"}.</p>
    <button disabled={busy} onClick={() => void refresh()} className="rounded border px-4 py-2">Обновить профиль</button>
    {uncertain && <p role="alert">Сначала обновите профиль. После обновления несохранённые поля заменятся данными из базы; выбранный файл останется доступен.</p>}
    <form className="space-y-4 rounded border p-4" onSubmit={event => { event.preventDefault(); void save(false); }}>
      <h2 className="text-lg font-semibold">Публичные данные автора</h2>
      <label className="block">Публичный никнейм<input required maxLength={60} value={nickname} disabled={busy} onChange={event => setNickname(event.target.value)} className="mt-1 block w-full max-w-lg rounded border p-2" /></label>
      <p className="text-sm text-muted-foreground">Этот никнейм будет виден читателям. Для входа используйте выданный email.</p>
      <fieldset className="space-y-3"><legend className="font-medium">Социальные сети</legend>
        {socialLinks.map((link, index) => <div key={index} className="flex flex-wrap items-end gap-3 rounded border p-3">
          <label className="min-w-0 flex-1">Название ссылки {index + 1}<input required maxLength={60} value={link.label} disabled={busy} onChange={event => setSocialLinks(previous => previous.map((item, at) => at === index ? { ...item, label: event.target.value } : item))} className="mt-1 block w-full rounded border p-2" /></label>
          <label className="min-w-0 flex-1">Адрес ссылки {index + 1}<input required type="url" maxLength={2048} placeholder="https://" value={link.url} disabled={busy} onChange={event => setSocialLinks(previous => previous.map((item, at) => at === index ? { ...item, url: event.target.value } : item))} className="mt-1 block w-full rounded border p-2" /></label>
          <button type="button" disabled={busy} onClick={() => setSocialLinks(previous => previous.filter((_, at) => at !== index))} className="rounded border px-3 py-2">Убрать ссылку {index + 1}</button>
        </div>)}
        <button type="button" disabled={busy || socialLinks.length >= 10} onClick={() => setSocialLinks(previous => [...previous, { label: "", url: "" }])} className="rounded border px-3 py-2">Добавить ссылку</button>
      </fieldset>
      <button disabled={busy || uncertain || !nickname.trim()} className="rounded border px-4 py-2">Сохранить профиль</button>
    </form>
    <form className="space-y-3 rounded border p-4" onSubmit={event => { event.preventDefault(); void save(true); }}>
      <h2 className="text-lg font-semibold">Аватар</h2>
      <p className="text-sm text-muted-foreground">После сохранения аватар доступен всем.</p>
      {/* Controlled Media URLs bypass the independent optimizer cache. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {profile.avatarUrl ? <div className="h-32 w-32 overflow-hidden rounded"><img src={profile.avatarUrl} alt="Текущий аватар" width={128} height={128} className="h-full w-full object-cover" /></div> : <p>Аватар пока не загружен.</p>}
      <label className="block">Новый аватар<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => setAvatar(event.target.files?.[0] ?? null)} className="mt-1 block w-full max-w-lg rounded border p-2" /></label>
      <p className="text-sm text-muted-foreground">Статичный JPEG, PNG или WebP до 5 MiB; сторона до 4096 px, до 16 млн пикселей. Изображение сохраняется в WebP размером до 512×512.</p>
      <button disabled={busy || uncertain || !avatar} className="rounded border px-4 py-2">Сохранить аватар</button>
    </form>
    {message && <p role="status" className="break-words">{message}</p>}
  </div>;
}
