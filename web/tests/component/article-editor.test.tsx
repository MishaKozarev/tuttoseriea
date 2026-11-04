// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArticleDraftDTO, ArticlePublicationDTO } from "@/src/articles/contract";
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
import { ArticlesList } from "@/components/articles/list";

const id = "11111111-2222-4333-8444-555555555555";
const imageId = "22222222-2222-4333-8444-555555555555";
function draft(overrides: Partial<ArticleDraftDTO> = {}): ArticleDraftDTO {
  return { id, authorAccountId: id, authorName: "Автор", h1: "Исходный заголовок", seoTitle: "", metaDescription: "", slug: "", slugMode: "auto",
    formatVersion: 1, content: EMPTY_ARTICLE_DOCUMENT, categoryIds: [], tagIds: [], categories: [], tags: [], images: [],
    revision: 0, publication: null, canPublish: false, createdAt: "2026-11-02T10:00:00Z", updatedAt: "2026-11-02T10:00:00Z", ...overrides };
}
const publication = (overrides: Partial<ArticlePublicationDTO> = {}): ArticlePublicationDTO => ({
  revision: 1, sourceRevision: 0, slug: "published-slug", firstPublishedAt: "2026-11-04T10:00:00Z", updatedAt: "2026-11-04T10:00:00Z", ...overrides,
});

describe("Article publication controls", () => {
  it("hides publication actions when the current DTO denies permission", () => {
    render(<ArticleEditor initial={draft({ publication: publication(), slug: "published-slug", revision: 2 })} />);
    expect(screen.queryByRole("button", { name: /Опубликовать|Обновить публикацию/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Открыть опубликованную статью" }).getAttribute("href")).toBe("/articles/published-slug");
    expect((screen.getByLabelText("Slug") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Есть сохранённые изменения, которые ещё не опубликованы/)).toBeTruthy();
  });

  it("publishes only the saved revision and prevents concurrent publication/save requests", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>(done => { resolve = done; }));
    render(<ArticleEditor initial={draft({ canPublish: true, revision: 7, slug: "published-slug" })} />);
    const button = screen.getByRole("button", { name: "Опубликовать статью" });
    fireEvent.click(button); fireEvent.click(button);
    fireEvent.submit(screen.getByRole("form", { name: "Редактор черновика" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe(`/api/admin/articles/${id}/publication`); expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ action: "publish", operationId: expect.any(String), expectedRevision: 7, expectedPublicationRevision: 0 });
    resolve(response({ draft: draft({ canPublish: true, revision: 7, slug: "published-slug", publication: publication({ sourceRevision: 7 }) }) }));
    await screen.findByText("Статья опубликована.");
    expect(screen.getByText(/Ревизия 7 · Все правки сохранены/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Обновить публикацию" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Slug") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("link", { name: "Открыть опубликованную статью" }).getAttribute("href")).toBe("/articles/published-slug");
  });

  it("requires saving dirty fields before publishing and uses fresh permissions from save", async () => {
    fetchMock.mockResolvedValueOnce(response({ draft: draft({ h1: "Сохранённый заголовок", revision: 1, canPublish: false }) }));
    render(<ArticleEditor initial={draft({ canPublish: true })} />);
    fireEvent.change(screen.getByLabelText("Название статьи"), { target: { value: "Сохранённый заголовок" } });
    const publish = screen.getByRole("button", { name: "Опубликовать статью" });
    expect((publish as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(publish); expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByText("Черновик сохранён.");
    expect(screen.queryByRole("button", { name: "Опубликовать статью" })).toBeNull();
    expect((screen.getByLabelText("Название статьи") as HTMLInputElement).value).toBe("Сохранённый заголовок");
  });

  it("reveals newly granted publication after a successful save", async () => {
    fetchMock.mockResolvedValueOnce(response({ draft: draft({ revision: 1, canPublish: true }) }));
    render(<ArticleEditor initial={draft()} />);
    expect(screen.queryByRole("button", { name: "Опубликовать статью" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByText("Черновик сохранён.");
    expect((screen.getByRole("button", { name: "Опубликовать статью" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("updates a publication separately from draft saving and retains its stable URL", async () => {
    fetchMock.mockResolvedValueOnce(response({ draft: draft({ canPublish: true, revision: 6, slug: "published-slug", publication: publication({ revision: 4, sourceRevision: 6 }) }) }));
    render(<ArticleEditor initial={draft({ canPublish: true, revision: 6, slug: "published-slug", publication: publication({ revision: 3, sourceRevision: 5 }) })} />);
    expect((screen.getByLabelText("Slug") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Обновить публикацию" }));
    await screen.findByText("Публикация обновлена.");
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ action: "update", operationId: expect.any(String), expectedRevision: 6, expectedPublicationRevision: 3 });
    expect(screen.getByText(/Ревизия 6 · Все правки сохранены/)).toBeTruthy();
    expect(screen.getByText("Опубликована · версия 4")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Открыть опубликованную статью" }).getAttribute("href")).toBe("/articles/published-slug");
    expect((screen.getByRole("button", { name: "Обновить публикацию" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("hides stale publication permission after server denial without retrying or losing fields", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: { code: "FORBIDDEN", requestId: "grant-revoked" } }, 403));
    render(<ArticleEditor initial={draft({ canPublish: true, slug: "draft-slug" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Опубликовать статью" }));
    await screen.findByText(/Недостаточно прав/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Опубликовать статью" })).toBeNull();
    expect((screen.getByLabelText("Название статьи") as HTMLInputElement).value).toBe("Исходный заголовок");
    expect((screen.getByRole("button", { name: "Сохранить черновик" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("draft-slug");
  });

  it.each(["conflict", "unknown outcome"])("requires explicit refresh/choice after publication %s and preserves subsequent local edits", async failure => {
    if (failure === "conflict") fetchMock.mockResolvedValueOnce(response({ error: { code: "ARTICLE_CONFLICT", requestId: "pub-conflict" } }, 409));
    else fetchMock.mockRejectedValueOnce(new Error("private publication diagnostics"));
    fetchMock.mockResolvedValueOnce(response({ draft: draft({ canPublish: true, revision: 2, slug: "published-slug", publication: publication({ sourceRevision: 2 }) }) }));
    render(<ArticleEditor initial={draft({ canPublish: true, revision: 2, slug: "local-slug" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Опубликовать статью" }));
    await screen.findByRole("alert");
    expect((screen.getByRole("button", { name: "Опубликовать статью" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Название статьи"), { target: { value: "Мои последующие правки" } });
    fireEvent.click(screen.getByRole("button", { name: "Загрузить текущую версию" }));
    await screen.findByRole("button", { name: "Продолжить с моими правками" });
    expect((screen.getByLabelText("Название статьи") as HTMLInputElement).value).toBe("Мои последующие правки");
    expect((screen.getByRole("button", { name: "Опубликовать статью" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Продолжить с моими правками" }));
    expect((screen.getByLabelText("Название статьи") as HTMLInputElement).value).toBe("Мои последующие правки");
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("published-slug");
    expect((screen.getByLabelText("Slug") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Обновить публикацию" }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).not.toContain("private publication diagnostics");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("requires refresh when another actor publishes before a changed slug is saved", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: { code: "ARTICLE_SLUG_IMMUTABLE", requestId: "slug-fixed" } }, 409));
    render(<ArticleEditor initial={draft({ canPublish: true })} />);
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "local-unsaved-slug" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByRole("alert");
    expect(screen.getByText(/Slug закреплён после первой публикации/)).toBeTruthy();
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("local-unsaved-slug");
    expect((screen.getByRole("button", { name: "Сохранить черновик" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows publication readiness errors while retaining editable fields", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: { code: "ARTICLE_NOT_READY", requestId: "not-ready" } }, 400));
    render(<ArticleEditor initial={draft({ canPublish: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Опубликовать статью" }));
    await screen.findByText(/Для публикации заполните название и текст статьи/);
    expect((screen.getByRole("button", { name: "Сохранить черновик" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText("Название статьи") as HTMLInputElement).value).toBe("Исходный заголовок");
  });

  it("shows publication status and pending saved changes in the Article list", () => {
    const unpublished = draft({ id: imageId, h1: "Ещё черновик" });
    const published = draft({ h1: "Рабочий заголовок", revision: 3, publication: publication({ sourceRevision: 2 }) });
    render(<ArticlesList data={{ items: [unpublished, published], page: 1, total: 2, totalPages: 1 }} scope="own" manageAll={false} />);
    expect(screen.getByRole("link", { name: "Ещё черновик" }).getAttribute("href")).toBe(`/admin/articles/${imageId}`);
    expect(screen.getByRole("link", { name: "Рабочий заголовок" }).getAttribute("href")).toBe(`/admin/articles/${id}`);
    expect(screen.getByText("Не опубликована.")).toBeTruthy();
    expect(screen.getByText(/Опубликована · версия 1/).textContent).toContain("Есть сохранённые изменения");
    expect(screen.getByRole("link", { name: "Открыть опубликованную статью" }).getAttribute("href")).toBe("/articles/published-slug");
  });
});
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
    fireEvent.change(screen.getByLabelText("Название статьи"), { target: { value: "Мой заголовок" } });
    fireEvent.change(screen.getByLabelText("SEO title"), { target: { value: "Мой SEO" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByText("Черновик сохранён.");
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe(`/api/admin/articles/${id}`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ h1: "Мой заголовок", seoTitle: "Мой SEO", metaDescription: "", slugMode: "auto",
      categoryIds: [], tagIds: [], content: EMPTY_ARTICLE_DOCUMENT, formatVersion: 1, expectedRevision: 0, operationId: expect.any(String) });
    expect(screen.getByText(/Все правки сохранены/)).toBeTruthy();
  });

  it.each(["conflict", "lost response"])("preserves dirty fields after %s and requires an explicit choice after GET", async failure => {
    if (failure === "conflict") fetchMock.mockResolvedValueOnce(response({ error: { code: "ARTICLE_CONFLICT", requestId: "request-one" } }, 409));
    else fetchMock.mockRejectedValueOnce(new Error("private network diagnostics"));
    fetchMock.mockResolvedValueOnce(response({ draft: draft({ h1: "Чужое изменение", revision: 3 }) }));
    fetchMock.mockResolvedValueOnce(response({ draft: draft({ h1: "Мой вариант", revision: 4 }) }));
    render(<ArticleEditor initial={draft()} />);
    fireEvent.change(screen.getByLabelText("Название статьи"), { target: { value: "Мой вариант" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByRole("alert");
    expect((screen.getByLabelText("Название статьи") as HTMLInputElement).value).toBe("Мой вариант");
    expect((screen.getByRole("button", { name: "Сохранить черновик" }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).not.toContain("private network diagnostics");
    fireEvent.click(screen.getByRole("button", { name: "Загрузить текущую версию" }));
    await screen.findByRole("button", { name: "Продолжить с моими правками" });
    expect((screen.getByLabelText("Название статьи") as HTMLInputElement).value).toBe("Мой вариант");
    fireEvent.click(screen.getByRole("button", { name: "Продолжить с моими правками" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByText("Черновик сохранён.");
    expect(JSON.parse(fetchMock.mock.calls[2][1]?.body as string).expectedRevision).toBe(3);
  });

  it("updates only attachments/revision after upload and keeps unsaved text fields", async () => {
    fetchMock.mockResolvedValueOnce(response({ image: { id: imageId, url: `/media/private/${imageId}.webp`, width: 800, height: 600, byteSize: 1234 }, revision: 2 }));
    fetchMock.mockResolvedValueOnce(response({ draft: draft({ h1: "Ещё не сохранён", revision: 3 }) }));
    render(<ArticleEditor initial={draft()} />);
    fireEvent.change(screen.getByLabelText("Название статьи"), { target: { value: "Ещё не сохранён" } });
    const file = new File(["fixture image"], "fixture.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Загрузить изображение"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Загрузить файл" }));
    await screen.findByText("Изображение загружено. Выберите его и вставьте в текст.");
    expect((screen.getByLabelText("Название статьи") as HTMLInputElement).value).toBe("Ещё не сохранён");
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
    fetchMock.mockResolvedValueOnce(response({ draft: draft({ slug: "different-slug", slugMode: "manual", revision: 1 }) }));
    render(<ArticleEditor initial={draft()} />);
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "occupied-slug" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByText(/Этот адрес уже занят/);
    expect((screen.getByRole("button", { name: "Сохранить черновик" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "different-slug" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByText("Черновик сохранён.");
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toMatchObject({ slug: "different-slug", slugMode: "manual", expectedRevision: 0 });
  });

  it("loads the server version only after explicit replacement confirmation", async () => {
    fetchMock.mockResolvedValueOnce(response({ draft: draft({ h1: "Версия из базы", revision: 4 }) }));
    render(<ArticleEditor initial={draft()} />);
    fireEvent.change(screen.getByLabelText("Название статьи"), { target: { value: "Локальные правки" } });
    fireEvent.click(screen.getByRole("button", { name: "Загрузить текущую версию" }));
    await screen.findByRole("button", { name: "Использовать текущую версию" });
    expect((screen.getByLabelText("Название статьи") as HTMLInputElement).value).toBe("Локальные правки");
    fireEvent.click(screen.getByRole("button", { name: "Использовать текущую версию" }));
    expect(window.confirm).toHaveBeenCalled();
    expect((screen.getByLabelText("Название статьи") as HTMLInputElement).value).toBe("Версия из базы");
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

describe("Article title and automatic/manual addresses", () => {
  const title = "Победа спустя три десятилетия";
  const base = "pobeda-spustya-tri-desyatiletiya";

  it("saves an unfinished automatic draft without requiring an explicit slug or SEO fields", async () => {
    fetchMock.mockResolvedValueOnce(response({ draft: draft({ h1: "", revision: 1 }) }));
    render(<ArticleEditor initial={draft({ h1: "" })} />);
    expect(screen.queryByLabelText("Заголовок H1")).toBeNull();
    expect((screen.getByLabelText("Название статьи") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByText("Черновик сохранён.");
    const input = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(input).toMatchObject({ h1: "", seoTitle: "", metaDescription: "", slugMode: "auto", expectedRevision: 0 });
    expect(input).not.toHaveProperty("slug");
  });

  it("previews a Cyrillic title immediately and keeps SEO Title independent", () => {
    render(<ArticleEditor initial={draft({ h1: "", seoTitle: "Независимый SEO title" })} />);
    fireEvent.change(screen.getByLabelText("Название статьи"), { target: { value: title } });
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe(base);
    expect((screen.getByLabelText("SEO title") as HTMLInputElement).value).toBe("Независимый SEO title");
    fireEvent.change(screen.getByLabelText("SEO title"), { target: { value: "Другой SEO title" } });
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe(base);
    expect((screen.getByLabelText("Название статьи") as HTMLInputElement).value).toBe(title);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts the server-reserved collision suffix and retains it while the title base is unchanged", async () => {
    fetchMock.mockResolvedValueOnce(response({ draft: draft({ h1: title, slug: `${base}-2`, slugMode: "auto", revision: 1 }) }));
    render(<ArticleEditor initial={draft({ h1: "" })} />);
    fireEvent.change(screen.getByLabelText("Название статьи"), { target: { value: title } });
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe(base);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByText("Черновик сохранён.");
    const input = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(input).toMatchObject({ slugMode: "auto", h1: title, seoTitle: "" }); expect(input).not.toHaveProperty("slug");
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe(`${base}-2`);
    fireEvent.change(screen.getByLabelText("Название статьи"), { target: { value: `${title}!` } });
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe(`${base}-2`);
    fireEvent.change(screen.getByLabelText("Название статьи"), { target: { value: "Новое название" } });
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("novoe-nazvanie");
    expect((screen.getByLabelText("SEO title") as HTMLInputElement).value).toBe("");
  });

  it("turns an edited suggestion into a manual slug and preserves it through title changes and reopening", async () => {
    const saved = draft({ h1: "Новое название", slug: "my-editorial-address", slugMode: "manual", revision: 1 });
    fetchMock.mockResolvedValueOnce(response({ draft: saved }));
    const view = render(<ArticleEditor initial={draft({ h1: title })} />);
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "my-editorial-address" } });
    fireEvent.change(screen.getByLabelText("Название статьи"), { target: { value: "Новое название" } });
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("my-editorial-address");
    expect(screen.getByText(/Адрес изменён вручную/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByText("Черновик сохранён.");
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({ h1: "Новое название", slugMode: "manual", slug: "my-editorial-address" });
    view.unmount(); render(<ArticleEditor initial={saved} />);
    fireEvent.change(screen.getByLabelText("Название статьи"), { target: { value: "Ещё одно название" } });
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("my-editorial-address");
  });

  it("returns a legacy manual address to automatic mode only after the explicit action", async () => {
    fetchMock.mockResolvedValueOnce(response({ draft: draft({ h1: title, seoTitle: "Мой SEO", slug: `${base}-3`, slugMode: "auto", revision: 1 }) }));
    render(<ArticleEditor initial={draft({ h1: title, seoTitle: "Мой SEO", slug: "legacy-manual-address", slugMode: "manual" })} />);
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("legacy-manual-address");
    fireEvent.click(screen.getByRole("button", { name: "Вернуть автоматический адрес" }));
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe(base);
    expect((screen.getByLabelText("SEO title") as HTMLInputElement).value).toBe("Мой SEO");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByText("Черновик сохранён.");
    const input = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(input).toMatchObject({ slugMode: "auto", seoTitle: "Мой SEO" }); expect(input).not.toHaveProperty("slug");
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe(`${base}-3`);
    expect((screen.getByLabelText("SEO title") as HTMLInputElement).value).toBe("Мой SEO");
    expect((screen.getByRole("button", { name: "Вернуть автоматический адрес" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps a reserved automatic address on reopening and clears the suggestion for an empty title", () => {
    render(<ArticleEditor initial={draft({ h1: title, slug: `${base}-4`, slugMode: "auto" })} />);
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe(`${base}-4`);
    fireEvent.change(screen.getByLabelText("SEO title"), { target: { value: "SEO меняется отдельно" } });
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe(`${base}-4`);
    fireEvent.change(screen.getByLabelText("Название статьи"), { target: { value: "" } });
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Название статьи"), { target: { value: "⚽️" } });
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe(`article-${id}`);
  });

  it.each(["auto", "manual"] as const)("keeps a published %s address locked when title or SEO changes", slugMode => {
    render(<ArticleEditor initial={draft({ h1: title, slug: "published-slug", slugMode, publication: publication() })} />);
    fireEvent.change(screen.getByLabelText("Название статьи"), { target: { value: "Новое название" } });
    fireEvent.change(screen.getByLabelText("SEO title"), { target: { value: "Другой SEO" } });
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("published-slug");
    expect((screen.getByLabelText("Slug") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Вернуть автоматический адрес" })).toBeNull();
  });

  it("preserves an unsaved manual slug and title across conflict refresh choices", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: { code: "ARTICLE_CONFLICT", requestId: "mode-conflict" } }, 409));
    fetchMock.mockResolvedValueOnce(response({ draft: draft({ h1: "Серверное название", slug: "server-title", slugMode: "auto", revision: 3 }) }));
    fetchMock.mockResolvedValueOnce(response({ draft: draft({ h1: "Моё название", slug: "my-manual-address", slugMode: "manual", revision: 4 }) }));
    render(<ArticleEditor initial={draft({ h1: title })} />);
    fireEvent.change(screen.getByLabelText("Название статьи"), { target: { value: "Моё название" } });
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "my-manual-address" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByRole("alert");
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("my-manual-address");
    fireEvent.click(screen.getByRole("button", { name: "Загрузить текущую версию" }));
    await screen.findByRole("button", { name: "Продолжить с моими правками" });
    fireEvent.click(screen.getByRole("button", { name: "Продолжить с моими правками" }));
    expect((screen.getByLabelText("Название статьи") as HTMLInputElement).value).toBe("Моё название");
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("my-manual-address");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByText("Черновик сохранён.");
    expect(JSON.parse(fetchMock.mock.calls[2][1]?.body as string)).toMatchObject({ expectedRevision: 3, slug: "my-manual-address", slugMode: "manual" });
  });
});
