import Link from "next/link";

import { publicArticleListPath, type PublicArticlePage } from "@/src/articles/public-contract";

export function PublicArticlesList({ data }: { data: PublicArticlePage }) {
  return <div className="space-y-8">
    {data.items.length ? <ul className="grid gap-6 md:grid-cols-2">{data.items.map(article => <li key={article.id} className="min-w-0 overflow-hidden rounded-lg border">
      <article className="space-y-4 p-5">
        {article.cover ? <Link href={`/articles/${article.slug}`} aria-label={article.h1} tabIndex={-1}>
          {/* Controlled public Media bypasses the independent optimizer cache. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/media/public/${article.cover.id}.webp`} alt={article.cover.alt} width={article.cover.width} height={article.cover.height} className="aspect-video w-full rounded object-cover" />
        </Link> : <div role="img" aria-label="Изображение статьи отсутствует" className="flex aspect-video w-full items-center justify-center rounded bg-muted text-sm text-muted-foreground">Без изображения</div>}
        <h2 className="break-words text-xl font-semibold"><Link href={`/articles/${article.slug}`} className="underline-offset-4 hover:underline">{article.h1}</Link></h2>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><span className="break-words">{article.author.nickname}</span><span aria-hidden="true">·</span>
          <time dateTime={article.firstPublishedAt}>{new Date(article.firstPublishedAt).toLocaleDateString("ru-RU", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" })}</time>
        </div>
      </article>
    </li>)}</ul> : <p className="rounded border p-6 text-muted-foreground">Опубликованных статей пока нет.</p>}
    {(data.page > 1 || data.page < data.totalPages) && <nav aria-label="Страницы статей" className="flex flex-wrap items-center gap-4 text-sm">
      {data.page > 1 && <Link href={publicArticleListPath(data.page - 1)} className="rounded border px-4 py-2">Предыдущая страница</Link>}
      <span className="text-muted-foreground">Страница {data.page} из {data.totalPages}</span>
      {data.page < data.totalPages && <Link href={publicArticleListPath(data.page + 1)} className="rounded border px-4 py-2">Следующая страница</Link>}
    </nav>}
  </div>;
}
