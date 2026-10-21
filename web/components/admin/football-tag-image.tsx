"use client";
import { useState } from "react";
import { usableCoachPhoto } from "@/src/football/coaches";
export function FootballTagImage({ url, name }: { url: string | null; name: string }) {
  const src = usableCoachPhoto(url); const [failed, setFailed] = useState<string | null>(null);
  return <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted text-center text-xs">
    {src && src !== failed ?
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={name} loading="lazy" onError={() => setFailed(src)} className="size-full object-contain" /> : <span>Нет изображения</span>}
  </div>;
}
