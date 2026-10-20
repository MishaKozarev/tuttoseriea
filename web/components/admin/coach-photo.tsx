"use client";
import { useState } from "react";
import { usableCoachPhoto } from "@/src/football/coaches";

export function CoachPhoto({ url }: { url: string | null }) {
  const src = usableCoachPhoto(url);
  const [failed, setFailed] = useState<string | null>(null);
  return <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted text-center text-xs">
    {src && failed !== src ?
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="Фото тренера" loading="lazy" className="size-full object-cover" onError={() => setFailed(src)} />
      : <span>Фото недоступно</span>}
  </div>;
}
