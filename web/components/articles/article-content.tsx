import { Fragment, type ReactNode } from "react";

import type { ArticleImageDTO } from "@/src/articles/contract";
import { parseArticleDocument, type ArticleDocument, type ArticleNode } from "@/src/articles/document";

export function ArticleContent({ content, images, visibility = "private" }: {
  content: ArticleDocument; images: ArticleImageDTO[]; visibility?: "private" | "public";
}) {
  const document = parseArticleDocument(content);
  const attachments = new Map(images.map(image => [image.id, image]));
  // Only trusted callers choose public rendering. JSON nodes and DTO URLs cannot
  // choose a source or make an asset public; the Media route checks its relation.
  const imageScope = visibility === "public" ? "public" : "private";

  function nodeView(node: ArticleNode, key: string): ReactNode {
    const children = node.content?.map((child, index) => nodeView(child, `${key}.${index}`));
    switch (node.type) {
      case "text": {
        let text: ReactNode = node.text;
        for (const mark of node.marks ?? []) {
          switch (mark.type) {
            case "bold": text = <strong>{text}</strong>; break;
            case "italic": text = <em>{text}</em>; break;
            case "strike": text = <s>{text}</s>; break;
            case "code": text = <code className="rounded bg-muted px-1 font-mono text-sm">{text}</code>; break;
            case "underline": text = <u>{text}</u>; break;
            case "link": {
              const href = mark.attrs!.href;
              const external = /^https?:\/\//.test(href);
              text = <a href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer nofollow" : undefined} className="underline underline-offset-4">{text}</a>;
              break;
            }
          }
        }
        return <Fragment key={key}>{text}</Fragment>;
      }
      case "hardBreak": return <br key={key} />;
      case "paragraph": return <p key={key} className="whitespace-pre-wrap leading-7">{children?.length ? children : <br />}</p>;
      case "heading": {
        if (node.attrs?.level === 2) return <h2 key={key} className="pt-3 text-2xl font-semibold">{children}</h2>;
        if (node.attrs?.level === 3) return <h3 key={key} className="pt-2 text-xl font-semibold">{children}</h3>;
        return <h4 key={key} className="pt-2 text-lg font-semibold">{children}</h4>;
      }
      case "blockquote": return <blockquote key={key} className="space-y-3 border-l-4 pl-4 text-muted-foreground">{children}</blockquote>;
      case "bulletList": return <ul key={key} className="list-disc space-y-2 pl-6">{children}</ul>;
      case "orderedList": return <ol key={key} start={node.attrs?.start ?? 1} className="list-decimal space-y-2 pl-6">{children}</ol>;
      case "listItem": return <li key={key} className="space-y-2">{children}</li>;
      case "articleImage": {
        const image = attachments.get(node.attrs!.assetId!);
        if (!image) return <p key={key} role="alert">{imageScope === "private" ? "Изображение недоступно для этого черновика." : "Изображение недоступно."}</p>;
        return <figure key={key} className="space-y-2">
          {/* Controlled Media bypasses the independent Next image optimizer cache. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/media/${imageScope}/${image.id}.webp`} alt={node.attrs?.alt ?? ""} width={image.width} height={image.height} className="h-auto max-w-full rounded" />
          {node.attrs?.caption && <figcaption className="text-sm text-muted-foreground">{node.attrs.caption}</figcaption>}
        </figure>;
      }
      case "doc": return <Fragment key={key}>{children}</Fragment>;
    }
  }

  return <div className="space-y-5 break-words" data-article-content>{nodeView(document, "article")}</div>;
}
