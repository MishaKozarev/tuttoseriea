// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ArticleContent } from "@/components/articles/article-content";
import type { ArticleDocument } from "@/src/articles/document";

afterEach(cleanup);
const assetId = "11111111-2222-4333-8444-555555555555";
describe("Protected article content renderer", () => {
  it("renders supported structure and escapes text, captions and alt attributes", () => {
    const content: ArticleDocument = { type: "doc", content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Раздел" }] },
      { type: "paragraph", content: [{ type: "text", text: "<script>unsafe()</script>", marks: [{ type: "bold" }, { type: "italic" }] }, { type: "hardBreak" }, { type: "text", text: "Ссылка", marks: [{ type: "link", attrs: { href: "https://example.com/" } }] }] },
      { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Пункт" }] }] }] },
      { type: "articleImage", attrs: { assetId, alt: '<img onerror="unsafe()">', caption: "<script>caption()</script>" } },
    ] };
    const { container } = render(<ArticleContent content={content} images={[{ id: assetId, url: "https://external.invalid/untrusted", width: 800, height: 600, byteSize: 1000 }]} />);
    expect(screen.getByRole("heading", { name: "Раздел", level: 2 })).toBeTruthy();
    expect(screen.getByText("<script>unsafe()</script>")).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("ol")?.getAttribute("start")).toBe("3");
    expect(screen.getByRole("img").getAttribute("src")).toBe(`/media/private/${assetId}.webp`);
    expect(screen.getByRole("img").hasAttribute("onerror")).toBe(false);
    expect(screen.getByRole("link", { name: "Ссылка" }).getAttribute("rel")).toContain("noopener");
  });
  it("does not render an image that is absent from this draft's attachment list", () => {
    render(<ArticleContent content={{ type: "doc", content: [{ type: "articleImage", attrs: { assetId, alt: "", caption: "" } }] }} images={[]} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("недоступно");
  });
  it("uses public URLs only for the trusted public renderer mode and still ignores arbitrary DTO sources", () => {
    const content: ArticleDocument = { type: "doc", content: [{ type: "articleImage", attrs: { assetId, alt: "Опубликованная схема", caption: "Публичная подпись" } }] };
    render(<ArticleContent content={content} images={[{ id: assetId, url: "https://external.invalid/untrusted", width: 2048, height: 1024, byteSize: 1000 }]} visibility="public" />);
    expect(screen.getByRole("img").getAttribute("src")).toBe(`/media/public/${assetId}.webp`);
    expect(screen.getByRole("img").getAttribute("alt")).toBe("Опубликованная схема");
    expect(screen.getByText("Публичная подпись")).toBeTruthy();
  });
  it("keeps an image absent from the published snapshot allowlist hidden in public mode", () => {
    render(<ArticleContent content={{ type: "doc", content: [{ type: "articleImage", attrs: { assetId, alt: "", caption: "" } }] }} images={[]} visibility="public" />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("Изображение недоступно.");
  });
  it("does not accept an image source or visibility flag supplied in editorial JSON", () => {
    const content = { type: "doc", content: [{ type: "articleImage", attrs: { assetId, alt: "", caption: "", src: "/media/public/forged.webp", visibility: "public" } }] } as unknown as ArticleDocument;
    expect(() => render(<ArticleContent content={content} images={[]} visibility="public" />)).toThrow();
  });
  it("uses the shared validator to reject arbitrary HTML nodes and unsafe links", () => {
    expect(() => render(<ArticleContent content={{ type: "doc", content: [{ type: "html", text: "unsafe" }] } as unknown as ArticleDocument} images={[]} />)).toThrow();
    expect(() => render(<ArticleContent content={{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "unsafe", marks: [{ type: "link", attrs: { href: "javascript:unsafe()" } }] }] }] }} images={[]} />)).toThrow();
  });
});
