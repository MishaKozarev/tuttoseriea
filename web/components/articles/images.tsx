"use client";

import { useRef, useState } from "react";
import type { ArticleImageDTO } from "@/src/articles/contract";
import { ARTICLE_MAX_IMAGES } from "@/src/articles/document";

type ImageAttributes = { assetId: string; alt: string; caption: string };
export function ArticleImages({ images, disabled, selectedImage, onUpload, onInsert, onUpdate }: {
  images: ArticleImageDTO[]; disabled: boolean; selectedImage: ImageAttributes | null;
  onUpload: (file: File) => Promise<boolean>; onInsert: (attrs: ImageAttributes) => void; onUpdate: (attrs: ImageAttributes) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [chosen, setChosen] = useState<string>("");
  const [alt, setAlt] = useState("");
  const [caption, setCaption] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const [editingSelected, setEditingSelected] = useState(false);
  async function upload() {
    if (!file) return;
    if (await onUpload(file)) { setFile(null); if (input.current) input.current.value = ""; }
  }
  const selectedExists = images.some(image => image.id === chosen);
  return <fieldset disabled={disabled} className="space-y-4 rounded border p-4">
    <legend className="px-1 font-medium">Изображения черновика</legend>
    <label className="block">Загрузить изображение<input ref={input} type="file" accept="image/jpeg,image/png,image/webp" disabled={images.length >= ARTICLE_MAX_IMAGES} onChange={event => setFile(event.target.files?.[0] ?? null)} className="mt-1 block max-w-full text-sm" /></label>
    <p className="text-sm text-muted-foreground">Статичный JPEG, PNG или WebP до 5 MiB, сторона до 4096 px, до 16 млн пикселей. До {ARTICLE_MAX_IMAGES} вложений. Загрузка не делает изображение публичным. При публикации открываются только изображения опубликованного текста.</p>
    <button type="button" disabled={!file || images.length >= ARTICLE_MAX_IMAGES} onClick={() => void upload()} className="rounded border px-3 py-2 text-sm disabled:opacity-50">Загрузить файл</button>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{images.map((image, index) => <button key={image.id} type="button" aria-pressed={chosen === image.id} aria-label={`Выбрать изображение ${index + 1}`} onClick={() => { setChosen(image.id); setEditingSelected(false); setAlt(""); setCaption(""); }} className="min-w-0 space-y-2 rounded border p-2 text-left text-sm aria-pressed:ring-2 aria-pressed:ring-ring">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/media/private/${image.id}.webp`} alt={`Вложение ${index + 1}`} width={image.width} height={image.height} className="aspect-video w-full rounded object-contain" />
      <span className="block">Изображение {index + 1}</span>
    </button>)}</div>
    {selectedImage && <button type="button" onClick={() => { setChosen(selectedImage.assetId); setAlt(selectedImage.alt); setCaption(selectedImage.caption); setEditingSelected(true); }} className="rounded border px-3 py-2 text-sm">Изменить описание выделенного изображения</button>}
    {selectedExists && <div className="space-y-3 rounded bg-muted/40 p-3">
      <label className="block">Альтернативный текст изображения<input value={alt} maxLength={500} onChange={event => setAlt(event.target.value)} className="mt-1 block w-full rounded border bg-background p-2" /></label>
      <label className="block">Подпись изображения<input value={caption} maxLength={1000} onChange={event => setCaption(event.target.value)} className="mt-1 block w-full rounded border bg-background p-2" /></label>
      <button type="button" disabled={editingSelected && selectedImage?.assetId !== chosen} onClick={() => {
        const attrs = { assetId: chosen, alt, caption };
        if (editingSelected) onUpdate(attrs); else onInsert(attrs);
      }} className="rounded border px-3 py-2 text-sm disabled:opacity-50">{editingSelected ? "Применить описание к выделенному изображению" : "Вставить изображение в текст"}</button>
    </div>}
  </fieldset>;
}
