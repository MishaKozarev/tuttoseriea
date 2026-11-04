// Shared, deterministic address preparation. SEO Title is deliberately not input.
export const ARTICLE_SLUG_MAX_LENGTH = 160;
export type ArticleSlugMode = "auto" | "manual";

const cyrillic: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya", і: "i", ї: "yi", є: "ye", ґ: "g", ў: "u",
};

export function articleSlugBase(title: string, articleId: string): string {
  if (!title.trim()) return "";
  // Transliterate before NFKD: decomposing ё/й first would lose their distinction.
  const base = title.normalize("NFC").toLowerCase()
    .replace(/[а-яёіїєґў]/gu, character => cyrillic[character])
    .normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, ARTICLE_SLUG_MAX_LENGTH).replace(/-+$/g, "");
  return base || `article-${articleId}`;
}

export function articleSlugCandidate(base: string, index: number): string {
  const suffix = index === 0 ? "" : `-${index + 1}`;
  return base.slice(0, ARTICLE_SLUG_MAX_LENGTH - suffix.length).replace(/-+$/g, "") + suffix;
}
