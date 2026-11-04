import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { articleSlugBase, articleSlugCandidate } from "@/src/articles/slug";
import { parseArticleSave } from "@/src/articles/contract";
import { assignArticleDraftSlug } from "@/src/articles/repository";

const id = "5e03d92b-cf69-4288-8e43-6a02e9340497";
describe("Article address preparation", () => {
  it.each([
    ["Победа спустя три десятилетия", "pobeda-spustya-tri-desyatiletiya"],
    ["  Ночь, Ёж и ЧАЙ!  ", "noch-yozh-i-chay"],
    ["Café — SERIE А: 2026/27", "cafe-serie-a-2026-27"],
    ["й ё Й Ё", "y-yo-y-yo"], ["", ""], ["   ", ""], ["⚽ !!!", `article-${id}`],
  ])("deterministically prepares %s", (title, slug) => {
    expect(articleSlugBase(title, id)).toBe(slug);
    expect(articleSlugBase(title, id)).toBe(articleSlugBase(title, id));
  });
  it("normalizes equivalent Unicode and keeps all collision suffixes inside 160 characters", () => {
    expect(articleSlugBase("Е\u0308ж", id)).toBe(articleSlugBase("Ёж", id));
    const base = articleSlugBase("Щ".repeat(300), id);
    expect(base).toHaveLength(160);
    for (const index of [0, 1, 9, 99, 999999]) {
      const candidate = articleSlugCandidate(base, index);
      expect(candidate.length).toBeLessThanOrEqual(160); expect(candidate).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
    expect(articleSlugCandidate("match", 0)).toBe("match");
    expect(articleSlugCandidate("match", 1)).toBe("match-2");
  });
  it("allows a draft save without either address field and retains strict manual validation", () => {
    const save = { operationId: id, expectedRevision: 0, formatVersion: 1, content: { type: "doc" },
      h1: "Название", seoTitle: "Другое SEO", metaDescription: "", categoryIds: [], tagIds: [] };
    expect(parseArticleSave(save)).toMatchObject({ h1: "Название", slug: undefined, slugMode: undefined });
    expect(parseArticleSave({ ...save, slugMode: "auto" }).slugMode).toBe("auto");
    expect(() => parseArticleSave({ ...save, slugMode: "unknown" })).toThrow();
    expect(() => parseArticleSave({ ...save, slugMode: "manual", slug: "NOT valid" })).toThrow();
  });
});

describe("PostgreSQL Article address reservation", () => {
  it("checks both draft/public namespaces under one lock and automatically skips collisions", async () => {
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes("union select") ? [{ slug: "match" }, { slug: "match-2" }] : [] }));
    expect(await assignArticleDraftSlug({ query } as never, id, "match", "auto")).toBe("match-3");
    expect(query.mock.calls[0][0]).toBe("select pg_advisory_xact_lock(910230212,1)");
    expect(query).toHaveBeenCalledWith("update article.drafts set slug=$2,slug_mode=$3 where article_id=$1", [id, "match-3", "auto"]);
  });
  it("recovers from a real unique-index race through a savepoint rather than requiring manual renaming", async () => {
    let raced = false;
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("update article.drafts") && !raced) { raced = true; throw { code: "23505", constraint: "article_drafts_slug_unique" }; }
      return { rows: [] };
    });
    expect(await assignArticleDraftSlug({ query } as never, id, "match", "manual")).toBe("match-2");
    expect(query).toHaveBeenCalledWith("rollback to savepoint article_slug_candidate");
  });
  it("does not swallow an immutable published URL rejection", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("update article.drafts")) throw { code: "23514", constraint: "article_published_slug_immutable" };
      return { rows: [] };
    });
    await expect(assignArticleDraftSlug({ query } as never, id, "match", "auto")).rejects.toMatchObject({ constraint: "article_published_slug_immutable" });
  });
});
