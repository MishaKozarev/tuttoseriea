import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { ArticleImageNode } from "@/components/articles/article-image-node";
import { ArticleError, EMPTY_ARTICLE_DOCUMENT, articleImageIds, parseArticleDocument, safeArticleLink, type ArticleDocument } from "@/src/articles/document";
import { parseArticleCreate, parseArticleListQuery, parseArticleSave } from "@/src/articles/contract";

const image = "33f73737-9c32-43f4-9f48-125c6f7d0222";
const operationId = "13f73737-9c32-43f4-9f48-125c6f7d0222";
const sample: ArticleDocument = { type: "doc", content: [
  { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Итальянский футбол" }] },
  { type: "paragraph", content: [
    { type: "text", text: "Текст <script> остаётся текстом", marks: [{ type: "bold" }, { type: "italic" }] },
    { type: "hardBreak" }, { type: "text", text: "Клуб", marks: [{ type: "link", attrs: { href: "/clubs/juventus" } }] },
  ] },
  { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Цитата автора" }] }] },
  { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [
    { type: "paragraph", content: [{ type: "text", text: "Первый пункт" }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Вложенный пункт" }] }] }] },
  ] }] },
  { type: "articleImage", attrs: { assetId: image, alt: "Стадион", caption: "Ручная подпись" } },
] };
const save = { operationId, expectedRevision: 0, formatVersion: 1, content: sample,
  h1: "Материал", seoTitle: "SEO вручную", metaDescription: "Ручное описание", slug: "serie-a-draft", categoryIds: [], tagIds: [] };

describe("Versioned editorial document contract", () => {
  it("accepts the installed editor schema serialization including default attributes after reopening saved rich content", () => {
    const schema = getSchema([StarterKit.configure({ heading: { levels: [2, 3, 4] }, codeBlock: false, horizontalRule: false }), ArticleImageNode]);
    const editorDocument = schema.nodeFromJSON(sample).toJSON();
    expect(parseArticleDocument(editorDocument)).toEqual(sample);
  });
  it("round-trips rich Russian text, nested lists, links, image ID, alt and caption without HTML conversion", () => {
    const parsed = parseArticleDocument(JSON.parse(JSON.stringify(sample)));
    expect(parsed).toEqual(sample);
    expect(parseArticleDocument(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expect(articleImageIds(parsed)).toEqual([image]);
  });
  it("accepts a genuinely empty draft and does not manufacture SEO or categories", () => {
    const input = { ...save, content: { type: "doc" }, h1: "", seoTitle: "", metaDescription: "", slug: "" };
    expect(parseArticleSave(input)).toMatchObject({ content: EMPTY_ARTICLE_DOCUMENT, h1: "", seoTitle: "", metaDescription: "", slug: "", categoryIds: [] });
  });
  it("normalizes only known editor link defaults and preserves the safe URL", () => {
    const input = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Ссылка", marks: [
      { type: "link", attrs: { href: "https://example.test/path", target: "_blank", rel: "noopener noreferrer nofollow", class: null } },
    ] }] }] };
    expect(parseArticleDocument(input).content[0].content?.[0].marks).toEqual([{ type: "link", attrs: { href: "https://example.test/path" } }]);
  });
  it.each(["javascript:alert(1)", "data:text/html,attack", "//evil.test/", "https://name:password@example.test", "https://example.test\n/path", "https:\\evil.test", " file:///tmp/a"])("rejects unsafe link %s", link => {
    expect(() => safeArticleLink(link)).toThrow(ArticleError);
  });
  it.each([
    { type: "doc", content: [{ type: "html", text: "<script>attack</script>" }] },
    { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [] }] },
    { type: "doc", content: [{ type: "text", text: "Text outside paragraph" }] },
    { type: "doc", content: [{ type: "bulletList", content: [{ type: "paragraph" }] }] },
    { type: "doc", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
    { type: "doc", content: [{ type: "paragraph", attrs: { style: "background:url(attack)" } }] },
    { type: "doc", content: [{ type: "articleImage", attrs: { assetId: image, alt: "", caption: "", src: "/media/public/secret.webp" } }] },
    { type: "doc", content: [{ type: "articleImage", attrs: { assetId: "../secret", alt: "", caption: "" } }] },
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "link", marks: [{ type: "link", attrs: { href: "javascript:attack" } }] }] }] },
  ])("rejects unrecognized nodes, structure, attributes and untrusted image locations", input => {
    expect(() => parseArticleDocument(input)).toThrow(ArticleError);
  });
  it("bounds document complexity, image count and text size", () => {
    let nested: unknown = { type: "paragraph" };
    for (let i = 0; i < 18; i++) nested = { type: "blockquote", content: [nested] };
    for (const input of [
      { type: "doc", content: [nested] },
      { type: "doc", content: Array.from({ length: 5001 }, () => ({ type: "paragraph" })) },
      { type: "doc", content: Array.from({ length: 21 }, () => ({ type: "articleImage", attrs: { assetId: image, alt: "", caption: "" } })) },
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a".repeat(200_001) }] }] },
    ]) expect(() => parseArticleDocument(input)).toThrow(ArticleError);
  });
  it("rejects author, status and publication fields instead of accepting a draft-to-public bypass", () => {
    for (const extra of [{ authorAccountId: "other" }, { status: "published" }, { published: true }, { canPublishOwn: true }]) {
      expect(() => parseArticleSave({ ...save, ...extra })).toThrow(ArticleError);
      expect(() => parseArticleCreate({ operationId, ...extra })).toThrow(ArticleError);
    }
  });
  it("rejects unsupported formats, duplicate relations and silently malformed slugs", () => {
    for (const input of [{ ...save, formatVersion: 2 }, { ...save, categoryIds: ["one", "one"] }, { ...save, slug: "Change Me" }, { ...save, expectedRevision: -1 }]) {
      expect(() => parseArticleSave(input)).toThrow(ArticleError);
    }
    expect(parseArticleListQuery(new URLSearchParams("scope=own&page=2"))).toEqual({ scope: "own", page: 2 });
    expect(() => parseArticleListQuery(new URLSearchParams("page=1&page=2"))).toThrow(ArticleError);
  });
});
