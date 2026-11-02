import { Node } from "@tiptap/core";

// Assets enter through the attachment picker; pasted external HTML cannot create
// this node. The server independently checks every asset against the draft.
export const ArticleImageNode = Node.create({
  name: "articleImage",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { assetId: { default: null }, alt: { default: "" }, caption: { default: "" } };
  },
  parseHTML() { return []; },
  renderHTML({ node }) {
    const { assetId, alt, caption } = node.attrs;
    if (typeof assetId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(assetId)) {
      return ["figure", {}, "Изображение недоступно"];
    }
    return ["figure", { "data-article-image": assetId, class: "my-4 space-y-2", contenteditable: "false" },
      ["img", { src: `/media/private/${assetId}.webp`, alt: typeof alt === "string" ? alt : "", class: "h-auto max-w-full rounded" }],
      ["figcaption", { class: "text-sm text-muted-foreground" }, typeof caption === "string" ? caption : ""]];
  },
});
