// Shared editorial format. This module deliberately has no server, DOM or editor dependency.
export const ARTICLE_FORMAT_VERSION = 1 as const;
export const ARTICLE_MAX_DOCUMENT_BYTES = 768 * 1024;
export const ARTICLE_MAX_IMAGES = 20;
export type ArticleMark = { type: "bold" | "italic" | "strike" | "code" | "underline" | "link"; attrs?: { href: string } };
export type ArticleNode = {
  type: "doc" | "paragraph" | "heading" | "blockquote" | "bulletList" | "orderedList" | "listItem" | "text" | "hardBreak" | "articleImage";
  content?: ArticleNode[];
  text?: string;
  marks?: ArticleMark[];
  attrs?: { level?: number; start?: number; assetId?: string; alt?: string; caption?: string };
};
export type ArticleDocument = ArticleNode & { type: "doc"; content: ArticleNode[] };
export const EMPTY_ARTICLE_DOCUMENT: ArticleDocument = { type: "doc", content: [{ type: "paragraph" }] };

export class ArticleError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); this.name = "ArticleError"; }
}
export function articleError(code = "VALIDATION_ERROR", status = 400, message = "Некорректные данные статьи."): never {
  throw new ArticleError(code, status, message);
}
export function articleRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) articleError();
  return value as Record<string, unknown>;
}
export function articleFields(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) articleError();
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function articleMediaId(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) articleError();
  return value;
}
export function safeArticleLink(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\p{Cc}\p{Cf}\\]/u.test(value) || value !== value.trim()) articleError();
  if (value.startsWith("#") || value.startsWith("/") && !value.startsWith("//")) return value;
  let url: URL;
  try { url = new URL(value); } catch { articleError(); }
  if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password) articleError();
  return url.href;
}
const blockTypes = new Set(["paragraph", "heading", "blockquote", "bulletList", "orderedList", "articleImage"]);
const simpleMarks = new Set(["bold", "italic", "strike", "code", "underline"]);

export function parseArticleDocument(value: unknown): ArticleDocument {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); } catch { articleError(); }
  if (!serialized || new TextEncoder().encode(serialized).length > ARTICLE_MAX_DOCUMENT_BYTES) articleError("ARTICLE_TOO_LARGE", 413, "Текст статьи слишком большой.");
  let nodes = 0, characters = 0, images = 0;
  function marks(value: unknown): ArticleMark[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > 6) articleError();
    const used = new Set<string>();
    return value.map(markValue => {
      const mark = articleRecord(markValue); articleFields(mark, ["type", "attrs"]);
      if (typeof mark.type !== "string" || used.has(mark.type)) articleError();
      used.add(mark.type);
      if (simpleMarks.has(mark.type)) {
        if (mark.attrs !== undefined && Object.keys(articleRecord(mark.attrs)).length) articleError();
        return { type: mark.type } as ArticleMark;
      }
      if (mark.type !== "link") articleError();
      const attrs = articleRecord(mark.attrs);
      // Tiptap adds these fixed presentation defaults; store only the domain URL.
      articleFields(attrs, ["href", "target", "rel", "class", "title"]);
      if (attrs.target != null && attrs.target !== "_blank" && attrs.target !== "_self" ||
          attrs.class != null || attrs.rel != null && attrs.rel !== "noopener noreferrer nofollow" && attrs.rel !== "noopener noreferrer" ||
          attrs.title != null && (typeof attrs.title !== "string" || attrs.title.length > 300 || /[\p{Cc}\p{Cf}]/u.test(attrs.title))) articleError();
      return { type: "link", attrs: { href: safeArticleLink(attrs.href) } };
    });
  }
  function parse(input: unknown, depth: number): ArticleNode {
    if (++nodes > 5000 || depth > 16) articleError("ARTICLE_TOO_LARGE", 413, "Слишком сложная структура статьи.");
    const node = articleRecord(input); articleFields(node, ["type", "content", "text", "marks", "attrs"]);
    if (typeof node.type !== "string") articleError();
    if (node.type === "text") {
      if (typeof node.text !== "string" || !node.text || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(node.text) || node.content !== undefined || node.attrs !== undefined) articleError();
      characters += node.text.length;
      if (characters > 200_000) articleError("ARTICLE_TOO_LARGE", 413, "Текст статьи слишком большой.");
      const result: ArticleNode = { type: "text", text: node.text };
      const parsedMarks = marks(node.marks); if (parsedMarks?.length) result.marks = parsedMarks;
      return result;
    }
    if (node.text !== undefined || node.marks !== undefined) articleError();
    if (node.type === "hardBreak") {
      if (node.content !== undefined || node.attrs !== undefined && Object.keys(articleRecord(node.attrs)).length) articleError();
      return { type: "hardBreak" };
    }
    if (node.type === "articleImage") {
      if (++images > ARTICLE_MAX_IMAGES || node.content !== undefined) articleError();
      const attrs = articleRecord(node.attrs); articleFields(attrs, ["assetId", "alt", "caption"]);
      const alt = attrs.alt ?? "", caption = attrs.caption ?? "";
      if (typeof alt !== "string" || alt.length > 500 || typeof caption !== "string" || caption.length > 1000 || /[\p{Cc}\p{Cf}]/u.test(alt + caption)) articleError();
      return { type: "articleImage", attrs: { assetId: articleMediaId(attrs.assetId), alt, caption } };
    }
    if (!["doc", "paragraph", "heading", "blockquote", "bulletList", "orderedList", "listItem"].includes(node.type)) articleError();
    if (node.type === "doc" && depth !== 0 || node.type !== "doc" && depth === 0) articleError();
    const result: ArticleNode = { type: node.type as ArticleNode["type"] };
    const attrs = node.attrs === undefined ? {} : articleRecord(node.attrs);
    if (node.type === "heading") {
      articleFields(attrs, ["level"]);
      if (![2, 3, 4].includes(Number(attrs.level)) || typeof attrs.level !== "number") articleError();
      result.attrs = { level: attrs.level };
    } else if (node.type === "orderedList") {
      articleFields(attrs, ["start", "type"]);
      const start = attrs.start ?? 1;
      if (!Number.isSafeInteger(start) || Number(start) < 1 || Number(start) > 1_000_000 || attrs.type != null) articleError();
      result.attrs = { start: Number(start) };
    } else if (Object.keys(attrs).length) articleError();
    if (node.content !== undefined && !Array.isArray(node.content)) articleError();
    const children = ((node.content ?? []) as unknown[]).map(child => parse(child, depth + 1));
    if (["paragraph", "heading"].includes(node.type)) {
      if (children.some(child => !["text", "hardBreak"].includes(child.type))) articleError();
    } else if (["bulletList", "orderedList"].includes(node.type)) {
      if (!children.length || children.some(child => child.type !== "listItem")) articleError();
    } else {
      if (children.some(child => !blockTypes.has(child.type))) articleError();
      if (node.type === "listItem" && children[0]?.type !== "paragraph" || node.type === "blockquote" && !children.length) articleError();
    }
    if (children.length) result.content = children;
    return result;
  }
  const parsed = parse(value, 0);
  return { ...parsed, type: "doc", content: parsed.content?.length ? parsed.content : [{ type: "paragraph" }] };
}
export function articleImageIds(document: ArticleDocument): string[] {
  const ids = new Set<string>();
  function visit(node: ArticleNode) { if (node.type === "articleImage" && node.attrs?.assetId) ids.add(node.attrs.assetId); node.content?.forEach(visit); }
  visit(document); return [...ids];
}
export const documentMediaIds = articleImageIds;
