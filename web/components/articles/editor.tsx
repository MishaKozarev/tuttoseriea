"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { JSONContent } from "@tiptap/core";

import { parseArticleSave, type ArticleDraftDTO, type ArticleImageDTO } from "@/src/articles/contract";
import { ARTICLE_FORMAT_VERSION, ArticleError, safeArticleLink } from "@/src/articles/document";
import { ArticleImageNode } from "./article-image-node";
import { ArticleImages } from "./images";
import { ArticleCategoryPicker, ArticleTagPicker } from "./taxonomy-picker";
import { ArticleRequestError, articleErrorMessage, articleRequest, needsArticleRefresh } from "./client";

type Fields = { h1: string; seoTitle: string; metaDescription: string; slug: string; content: JSONContent; categoryIds: string[]; tagIds: string[] };
function fieldsFrom(draft: ArticleDraftDTO): Fields {
  return { h1: draft.h1, seoTitle: draft.seoTitle, metaDescription: draft.metaDescription, slug: draft.slug,
    content: draft.content, categoryIds: draft.categoryIds, tagIds: draft.tagIds };
}
const inputClass = "mt-1 block w-full rounded border bg-background p-2";
const buttonClass = "rounded border px-3 py-2 text-sm disabled:opacity-50";

export function ArticleEditor({ initial }: { initial: ArticleDraftDTO }) {
  const router = useRouter();
  const [fields, setFields] = useState(() => fieldsFrom(initial));
  const [savedFields, setSavedFields] = useState(() => fieldsFrom(initial));
  const [revision, setRevision] = useState(initial.revision);
  const [publication, setPublication] = useState(initial.publication);
  const [canPublish, setCanPublish] = useState(initial.canPublish);
  const [images, setImages] = useState(initial.images);
  const [categories, setCategories] = useState(initial.categories);
  const [tags, setTags] = useState(initial.tags);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [remote, setRemote] = useState<ArticleDraftDTO | null>(null);
  const [message, setMessage] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const inFlight = useRef(false);
  const dirty = JSON.stringify(fields) !== JSON.stringify(savedFields);
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [StarterKit.configure({
      heading: { levels: [2, 3, 4] }, codeBlock: false, horizontalRule: false,
      link: {
        openOnClick: false, autolink: false, linkOnPaste: false,
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer nofollow" },
        isAllowedUri: value => { try { safeArticleLink(value); return true; } catch { return false; } },
      },
    }), ArticleImageNode],
    content: initial.content,
    editorProps: { attributes: { role: "textbox", "aria-label": "Текст статьи", "aria-multiline": "true",
      class: "min-h-72 max-w-full space-y-3 overflow-x-auto rounded border p-4 outline-none focus:ring-2 focus:ring-ring [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_blockquote]:border-l-4 [&_blockquote]:pl-4 [&_h2]:text-2xl [&_h3]:text-xl [&_h4]:text-lg [&_a]:underline" } },
    onUpdate: ({ editor: current }) => setFields(previous => ({ ...previous, content: current.getJSON() })),
  });

  useEffect(() => { editor?.setEditable(!busy, false); }, [editor, busy]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function accept(draft: ArticleDraftDTO) {
    const next = fieldsFrom(draft);
    setFields(next); setSavedFields(next); setRevision(draft.revision); setImages(draft.images);
    setCategories(draft.categories); setTags(draft.tags); setBlocked(false); setRemote(null);
    setPublication(draft.publication); setCanPublish(draft.canPublish);
    editor?.commands.setContent(draft.content, { emitUpdate: false });
  }

  async function publish() {
    if (inFlight.current || blocked || dirty || remote || !canPublish || !editor || publication?.sourceRevision === revision) return;
    inFlight.current = true; setBusy(true); setPublishing(true); setMessage("");
    const updating = publication !== null;
    try {
      const { draft } = await articleRequest<{ draft: ArticleDraftDTO }>(`/api/admin/articles/${initial.id}/publication`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          action: updating ? "update" : "publish", operationId: crypto.randomUUID(),
          expectedRevision: revision, expectedPublicationRevision: publication?.revision ?? 0,
        }),
      });
      accept(draft); setMessage(updating ? "Публикация обновлена." : "Статья опубликована.");
    } catch (error) {
      if (error instanceof ArticleRequestError && (error.status === 401 || error.status === 403)) setCanPublish(false);
      setBlocked(needsArticleRefresh(error)); setMessage(articleErrorMessage(error));
    } finally { inFlight.current = false; setBusy(false); setPublishing(false); }
  }

  async function save(preview = false) {
    if (inFlight.current || blocked || !editor) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const input = parseArticleSave({ ...fields, content: editor.getJSON(), expectedRevision: revision,
        operationId: crypto.randomUUID(), formatVersion: ARTICLE_FORMAT_VERSION });
      const { draft } = await articleRequest<{ draft: ArticleDraftDTO }>(`/api/admin/articles/${initial.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      accept(draft); setMessage("Черновик сохранён.");
      if (preview) router.push(`/admin/articles/${initial.id}/preview`);
    } catch (error) {
      if (error instanceof ArticleError) setMessage(articleErrorMessage(new ArticleRequestError(error.code, undefined, error.status)));
      else { setBlocked(needsArticleRefresh(error)); setMessage(articleErrorMessage(error)); }
    } finally { inFlight.current = false; setBusy(false); }
  }

  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const { draft } = await articleRequest<{ draft: ArticleDraftDTO }>(`/api/admin/articles/${initial.id}`);
      setCanPublish(draft.canPublish);
      setRemote(draft); setMessage("Текущая версия загружена. Ваши поля пока не изменены.");
    } catch (error) { setMessage(articleErrorMessage(error)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function upload(file: File): Promise<boolean> {
    if (inFlight.current || blocked) return false;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      if (file.size > 5 * 1024 * 1024) throw new ArticleRequestError("MEDIA_TOO_LARGE", undefined, 413);
      const result = await articleRequest<{ image: ArticleImageDTO; revision: number }>(`/api/admin/articles/${initial.id}/images`, {
        method: "POST", headers: { "Content-Type": file.type, "X-Article-Revision": String(revision), "X-Operation-ID": crypto.randomUUID() }, body: file,
      });
      setRevision(result.revision); setImages(previous => previous.some(image => image.id === result.image.id) ? previous : [...previous, result.image]);
      setMessage("Изображение загружено. Выберите его и вставьте в текст.");
      return true;
    } catch (error) { setBlocked(needsArticleRefresh(error)); setMessage(articleErrorMessage(error)); return false; }
    finally { inFlight.current = false; setBusy(false); }
  }

  const imageAttrs = editor?.isActive("articleImage") ? editor.getAttributes("articleImage") : null;
  const selectedImage = imageAttrs && typeof imageAttrs.assetId === "string"
    ? { assetId: imageAttrs.assetId, alt: String(imageAttrs.alt ?? ""), caption: String(imageAttrs.caption ?? "") } : null;
  function applyLink() {
    if (!editor) return;
    try {
      const href = safeArticleLink(link);
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run(); setLinkOpen(false);
    } catch { setMessage("Укажите безопасную ссылку: http://, https://, путь от / или якорь #."); }
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Link href="/admin/articles" onClick={event => { if (dirty && !window.confirm("В черновике есть несохранённые правки. Выйти к списку?")) event.preventDefault(); }} className="underline">К списку черновиков</Link>
      <p role="status" className="text-sm text-muted-foreground">Ревизия {revision} · {dirty ? "Есть несохранённые правки" : "Все правки сохранены"}</p>
    </div>
    {message && <p role="status" className="break-words rounded border p-3">{message}</p>}
    <section aria-label="Публикация статьи" className="space-y-3 rounded border p-4">
      {publication ? <>
        <p className="font-medium">Опубликована · версия {publication.revision}</p>
        <p className="text-sm text-muted-foreground">Опубликованная ревизия черновика: {publication.sourceRevision}. {publication.sourceRevision === revision ? "Сохранённая версия уже опубликована." : "Есть сохранённые изменения, которые ещё не опубликованы."}</p>
        <Link href={`/articles/${encodeURIComponent(publication.slug)}`} target="_blank" rel="noopener noreferrer" className="inline-block break-all underline">Открыть опубликованную статью</Link>
      </> : <p className="font-medium">Статья ещё не опубликована.</p>}
      <p className="text-sm text-muted-foreground">{publication ? "Публичная версия изменится после отдельного обновления публикации." : "Публикация использует только сохранённую версию черновика."}</p>
      {canPublish ? <>
        <button type="button" disabled={busy || blocked || dirty || remote !== null || !editor || publication?.sourceRevision === revision} onClick={() => void publish()} className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">{publishing ? "Публикация…" : publication ? "Обновить публикацию" : "Опубликовать статью"}</button>
        {dirty && <p className="text-sm text-muted-foreground">Сначала сохраните правки черновика.</p>}
      </> : <p className="text-sm text-muted-foreground">Для самостоятельной публикации требуется право, назначенное Super Admin.</p>}
    </section>
    {blocked && <p role="alert" className="rounded border p-3">Перед следующей записью загрузите текущую версию. Текст, поля и выбранный файл остаются в форме.</p>}
    <button type="button" disabled={busy} onClick={() => void refresh()} className={buttonClass}>Загрузить текущую версию</button>
    {remote && <section aria-label="Загруженная текущая версия" className="space-y-3 rounded border bg-muted/40 p-4">
      <p>Текущая версия: «{remote.h1 || "Без заголовка"}», ревизия {remote.revision}. <Link href={`/admin/articles/${initial.id}/preview`} target="_blank" rel="noopener noreferrer" className="underline">Посмотреть сохранённый текст</Link></p>
      {remote.publication && <p className="text-sm text-muted-foreground">Статья опубликована: версия {remote.publication.revision}. Slug «{remote.publication.slug}» закреплён и будет использован при продолжении редактирования.</p>}
      <p className="text-sm text-muted-foreground">Продолжение со своими правками позволит сохранить их поверх загруженной версии.</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy} onClick={() => {
          setRevision(remote.revision); setImages(remote.images); setSavedFields(fieldsFrom(remote));
          setPublication(remote.publication); setCanPublish(remote.canPublish);
          if (remote.publication) setFields(previous => ({ ...previous, slug: remote.publication!.slug }));
          setBlocked(false); setRemote(null); setMessage("Ваши правки оставлены в форме. Сохранение заменит текущую версию вашим вариантом.");
        }} className={buttonClass}>Продолжить с моими правками</button>
        <button type="button" disabled={busy} onClick={() => {
          if (!dirty || window.confirm("Заменить несохранённые поля текущей версией?")) { accept(remote); setMessage("Используется текущая сохранённая версия."); }
        }} className={buttonClass}>Использовать текущую версию</button>
      </div>
    </section>}
    <form aria-label="Редактор черновика" className="space-y-6" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy} className="grid gap-4 rounded border p-4 md:grid-cols-2">
        <legend className="px-1 font-medium">Заголовок и SEO</legend>
        <label className="block md:col-span-2">Заголовок H1<input maxLength={300} value={fields.h1} onChange={event => setFields(previous => ({ ...previous, h1: event.target.value }))} className={inputClass} /></label>
        <label className="block">SEO title<input maxLength={300} value={fields.seoTitle} onChange={event => setFields(previous => ({ ...previous, seoTitle: event.target.value }))} className={inputClass} /></label>
        <div><label className="block">Slug<input maxLength={160} disabled={publication !== null} aria-describedby={publication ? "published-slug-note" : undefined} value={fields.slug} onChange={event => setFields(previous => ({ ...previous, slug: event.target.value }))} placeholder="nazvanie-stati" className={inputClass} /></label>{publication && <p id="published-slug-note" className="mt-1 text-sm text-muted-foreground">Slug закреплён после первой публикации.</p>}</div>
        <label className="block md:col-span-2">Meta description<textarea maxLength={500} rows={3} value={fields.metaDescription} onChange={event => setFields(previous => ({ ...previous, metaDescription: event.target.value }))} className={inputClass} /></label>
      </fieldset>
      <section className="space-y-3" aria-label="Редактирование текста">
        <h2 className="text-lg font-semibold">Текст статьи</h2>
        <div role="toolbar" aria-label="Форматирование статьи" className="flex flex-wrap gap-2 rounded border p-2">
          <button type="button" disabled={busy || !editor} aria-pressed={editor?.isActive("paragraph") ?? false} onClick={() => editor?.chain().focus().setParagraph().run()} className={buttonClass}>Абзац</button>
          {([2, 3, 4] as const).map(level => <button key={level} type="button" disabled={busy || !editor} aria-pressed={editor?.isActive("heading", { level }) ?? false} onClick={() => editor?.chain().focus().toggleHeading({ level }).run()} className={buttonClass}>H{level}</button>)}
          <button type="button" disabled={busy || !editor} aria-pressed={editor?.isActive("bold") ?? false} onClick={() => editor?.chain().focus().toggleBold().run()} className={buttonClass}>Жирный</button>
          <button type="button" disabled={busy || !editor} aria-pressed={editor?.isActive("italic") ?? false} onClick={() => editor?.chain().focus().toggleItalic().run()} className={buttonClass}>Курсив</button>
          <button type="button" disabled={busy || !editor} aria-pressed={editor?.isActive("underline") ?? false} onClick={() => editor?.chain().focus().toggleUnderline().run()} className={buttonClass}>Подчёркнутый</button>
          <button type="button" disabled={busy || !editor} aria-pressed={editor?.isActive("strike") ?? false} onClick={() => editor?.chain().focus().toggleStrike().run()} className={buttonClass}>Зачёркнутый</button>
          <button type="button" disabled={busy || !editor} aria-pressed={editor?.isActive("code") ?? false} onClick={() => editor?.chain().focus().toggleCode().run()} className={buttonClass}>Код</button>
          <button type="button" disabled={busy || !editor} aria-pressed={editor?.isActive("bulletList") ?? false} onClick={() => editor?.chain().focus().toggleBulletList().run()} className={buttonClass}>Маркированный список</button>
          <button type="button" disabled={busy || !editor} aria-pressed={editor?.isActive("orderedList") ?? false} onClick={() => editor?.chain().focus().toggleOrderedList().run()} className={buttonClass}>Нумерованный список</button>
          <button type="button" disabled={busy || !editor} aria-pressed={editor?.isActive("blockquote") ?? false} onClick={() => editor?.chain().focus().toggleBlockquote().run()} className={buttonClass}>Цитата</button>
          <button type="button" disabled={busy || !editor} aria-pressed={editor?.isActive("link") ?? false} onClick={() => { setLink(String(editor?.getAttributes("link").href ?? "")); setLinkOpen(previous => !previous); }} className={buttonClass}>Ссылка</button>
          <button type="button" disabled={busy || !editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()} className={buttonClass}>Отменить</button>
          <button type="button" disabled={busy || !editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()} className={buttonClass}>Повторить</button>
        </div>
        {linkOpen && <fieldset disabled={busy} className="flex flex-wrap items-end gap-3 rounded border p-3">
          <label className="min-w-0 flex-1">Адрес ссылки<input value={link} maxLength={2048} onChange={event => setLink(event.target.value)} className={inputClass} /></label>
          <button type="button" onClick={applyLink} className={buttonClass}>Применить ссылку</button>
          <button type="button" onClick={() => { editor?.chain().focus().extendMarkRange("link").unsetLink().run(); setLinkOpen(false); }} className={buttonClass}>Убрать ссылку</button>
        </fieldset>}
        {!editor && <p className="text-sm text-muted-foreground">Загрузка редактора…</p>}
        <EditorContent editor={editor} />
      </section>
      <ArticleImages images={images} disabled={busy || blocked} selectedImage={selectedImage} onUpload={upload}
        onInsert={attrs => { editor?.chain().focus().insertContent({ type: "articleImage", attrs }).run(); }}
        onUpdate={attrs => { editor?.chain().focus().updateAttributes("articleImage", attrs).run(); }} />
      <ArticleCategoryPicker disabled={busy} selected={fields.categoryIds.map(id => categories.find(item => item.id === id) ?? { id, name: "Недоступная категория" })} onChange={value => { setCategories(value); setFields(previous => ({ ...previous, categoryIds: value.map(item => item.id) })); }} />
      <ArticleTagPicker disabled={busy} selected={tags.filter(tag => fields.tagIds.includes(tag.id))} onChange={value => { setTags(value); setFields(previous => ({ ...previous, tagIds: value.map(item => item.id) })); }} />
      <div className="flex flex-wrap gap-3 border-t pt-5">
        <button type="submit" disabled={busy || blocked || !editor} className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">{busy ? "Подождите…" : "Сохранить черновик"}</button>
        <button type="button" disabled={busy || blocked || !editor} onClick={() => void save(true)} className={buttonClass}>Сохранить и посмотреть</button>
      </div>
    </form>
  </div>;
}
