// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArticleDraftDTO } from "@/src/articles/contract";
import { EMPTY_ARTICLE_DOCUMENT } from "@/src/articles/document";

const mocks = vi.hoisted(() => ({ getJSON: vi.fn(), setContent: vi.fn(), setEditable: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock("@tiptap/react", () => ({
  useEditor: () => ({ getJSON: mocks.getJSON, commands: { setContent: mocks.setContent }, setEditable: mocks.setEditable,
    isActive: () => false, getAttributes: () => ({}), can: () => ({ undo: () => false, redo: () => false }) }),
  EditorContent: () => <div role="textbox" aria-label="Текст статьи">Текст в редакторе</div>,
}));
import { ArticleEditor } from "@/components/articles/editor";
import { CreateArticleDraft } from "@/components/articles/create-draft";

const id = "11111111-2222-4333-8444-555555555555";
const imageId = "22222222-2222-4333-8444-555555555555";
function draft(overrides: Partial<ArticleDraftDTO> = {}): ArticleDraftDTO {
  return { id, authorAccountId: id, authorName: "Автор", h1: "Исходный заголовок", seoTitle: "", metaDescription: "", slug: "",
    formatVersion: 1, content: EMPTY_ARTICLE_DOCUMENT, categoryIds: [], tagIds: [], categories: [], tags: [], images: [],
    revision: 0, createdAt: "2026-11-02T10:00:00Z", updatedAt: "2026-11-02T10:00:00Z", ...overrides };
}
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset();
  mocks.getJSON.mockReturnValue(EMPTY_ARTICLE_DOCUMENT);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Article draft editor", () => {
  it("saves only explicit manual fields with the current CAS revision", async () => {
    fetchMock.mockResolvedValue(response({ draft: draft({ h1: "Мой заголовок", seoTitle: "Мой SEO", revision: 1 }) }));
    render(<ArticleEditor initial={draft()} />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Заголовок H1"), { target: { value: "Мой заголовок" } });
    fireEvent.change(screen.getByLabelText("SEO title"), { target: { value: "Мой SEO" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByText("Черновик сохранён.");
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe(`/api/admin/articles/${id}`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ h1: "Мой заголовок", seoTitle: "Мой SEO", metaDescription: "", slug: "",
      categoryIds: [], tagIds: [], content: EMPTY_ARTICLE_DOCUMENT, formatVersion: 1, expectedRevision: 0, operationId: expect.any(String) });
    expect(screen.getByText(/Все правки сохранены/)).toBeTruthy();
  });

  it.each(["conflict", "lost response"])("preserves dirty fields after %s and requires an explicit choice after GET", async failure => {
    if (failure === "conflict") fetchMock.mockResolvedValueOnce(response({ error: { code: "ARTICLE_CONFLICT", requestId: "request-one" } }, 409));
    else fetchMock.mockRejectedValueOnce(new Error("private network diagnostics"));
    fetchMock.mockResolvedValueOnce(response({ draft: draft({ h1: "Чужое изменение", revision: 3 }) }));
    fetchMock.mockResolvedValueOnce(response({ draft: draft({ h1: "Мой вариант", revision: 4 }) }));
    render(<ArticleEditor initial={draft()} />);
    fireEvent.change(screen.getByLabelText("Заголовок H1"), { target: { value: "Мой вариант" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByRole("alert");
    expect((screen.getByLabelText("Заголовок H1") as HTMLInputElement).value).toBe("Мой вариант");
    expect((screen.getByRole("button", { name: "Сохранить черновик" }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).not.toContain("private network diagnostics");
    fireEvent.click(screen.getByRole("button", { name: "Загрузить текущую версию" }));
    await screen.findByRole("button", { name: "Продолжить с моими правками" });
    expect((screen.getByLabelText("Заголовок H1") as HTMLInputElement).value).toBe("Мой вариант");
    fireEvent.click(screen.getByRole("button", { name: "Продолжить с моими правками" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByText("Черновик сохранён.");
    expect(JSON.parse(fetchMock.mock.calls[2][1]?.body as string).expectedRevision).toBe(3);
  });

  it("updates only attachments/revision after upload and keeps unsaved text fields", async () => {
    fetchMock.mockResolvedValueOnce(response({ image: { id: imageId, url: `/media/private/${imageId}.webp`, width: 800, height: 600, byteSize: 1234 }, revision: 2 }));
    fetchMock.mockResolvedValueOnce(response({ draft: draft({ h1: "Ещё не сохранён", revision: 3 }) }));
    render(<ArticleEditor initial={draft()} />);
    fireEvent.change(screen.getByLabelText("Заголовок H1"), { target: { value: "Ещё не сохранён" } });
    const file = new File(["fixture image"], "fixture.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Загрузить изображение"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Загрузить файл" }));
    await screen.findByText("Изображение загружено. Выберите его и вставьте в текст.");
    expect((screen.getByLabelText("Заголовок H1") as HTMLInputElement).value).toBe("Ещё не сохранён");
    expect(fetchMock.mock.calls[0][1]?.body).toBe(file);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ "Content-Type": "image/png", "X-Article-Revision": "0" });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByText("Черновик сохранён.");
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toMatchObject({ h1: "Ещё не сохранён", expectedRevision: 2, content: EMPTY_ARTICLE_DOCUMENT });
  });

  it("keeps the selected file and inputs after an upload failure", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: { code: "MEDIA_STORAGE_UNAVAILABLE", requestId: "upload-one" } }, 503));
    render(<ArticleEditor initial={draft()} />);
    fireEvent.change(screen.getByLabelText("Meta description"), { target: { value: "Мои метаданные" } });
    const file = new File(["fixture image"], "fixture.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Загрузить изображение"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Загрузить файл" }));
    await screen.findByRole("alert");
    expect((screen.getByLabelText("Загрузить изображение") as HTMLInputElement).files?.[0]).toBe(file);
    expect((screen.getByLabelText("Meta description") as HTMLTextAreaElement).value).toBe("Мои метаданные");
  });

  it("allows correcting a duplicate slug without treating it as a stale revision", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: { code: "ARTICLE_SLUG_CONFLICT", requestId: "slug-one" } }, 409));
    fetchMock.mockResolvedValueOnce(response({ draft: draft({ slug: "different-slug", revision: 1 }) }));
    render(<ArticleEditor initial={draft()} />);
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "occupied-slug" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByText(/Этот slug уже используется/);
    expect((screen.getByRole("button", { name: "Сохранить черновик" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "different-slug" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByText("Черновик сохранён.");
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toMatchObject({ slug: "different-slug", expectedRevision: 0 });
  });

  it("loads the server version only after explicit replacement confirmation", async () => {
    fetchMock.mockResolvedValueOnce(response({ draft: draft({ h1: "Версия из базы", revision: 4 }) }));
    render(<ArticleEditor initial={draft()} />);
    fireEvent.change(screen.getByLabelText("Заголовок H1"), { target: { value: "Локальные правки" } });
    fireEvent.click(screen.getByRole("button", { name: "Загрузить текущую версию" }));
    await screen.findByRole("button", { name: "Использовать текущую версию" });
    expect((screen.getByLabelText("Заголовок H1") as HTMLInputElement).value).toBe("Локальные правки");
    fireEvent.click(screen.getByRole("button", { name: "Использовать текущую версию" }));
    expect(window.confirm).toHaveBeenCalled();
    expect((screen.getByLabelText("Заголовок H1") as HTMLInputElement).value).toBe("Версия из базы");
    expect(mocks.setContent).toHaveBeenCalledWith(EMPTY_ARTICLE_DOCUMENT, { emitUpdate: false });
  });

  it("prevents simultaneous saves and navigates to preview only after success", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>(done => { resolve = done; }));
    render(<ArticleEditor initial={draft()} />);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить и посмотреть" }));
    fireEvent.submit(screen.getByRole("form", { name: "Редактор черновика" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
    resolve(response({ draft: draft({ revision: 1 }) }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(`/admin/articles/${id}/preview`));
  });

  it("uses the same creation operation after an unknown create outcome", async () => {
    fetchMock.mockRejectedValueOnce(new Error("lost create response"));
    fetchMock.mockResolvedValueOnce(response({ draft: draft() }, 201));
    render(<CreateArticleDraft />);
    fireEvent.click(screen.getByRole("button", { name: "Создать черновик" }));
    await screen.findByRole("button", { name: "Проверить создание черновика" });
    fireEvent.click(screen.getByRole("button", { name: "Проверить создание черновика" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(`/admin/articles/${id}`));
    expect(fetchMock.mock.calls[0][1]?.body).toBe(fetchMock.mock.calls[1][1]?.body);
  });
});
