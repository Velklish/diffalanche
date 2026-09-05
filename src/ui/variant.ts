export type RendererName = "git-diff-view" | "react-diff-view";

export type Variant = {
  renderer: RendererName;
  /**
   * Syntax highlighting by the diff library: `git-diff-view` highlights with
   * lowlight on its own, `react-diff-view` through refractor tokens.
   */
  highlight: boolean;
  /** Mount a file's diff only near the viewport, keeping its measured height as a spacer. */
  virtual: boolean;
};

/**
 * The variant is a query parameter so one build measures every candidate. The
 * defaults are the combination [ADR-008](../../docs/adr/adr-008-diff-rendering-verdict.md)
 * chose; the others are kept until DA-21 fixes the renderer.
 */
export function readVariant(search: string): Variant {
  const params = new URLSearchParams(search);
  const renderer = params.get("renderer") === "git-diff-view" ? "git-diff-view" : "react-diff-view";
  return {
    renderer,
    highlight: params.get("highlight") !== "0",
    virtual: params.get("virtual") !== "0",
  };
}

export function variantName(variant: Variant): string {
  const parts: string[] = [variant.renderer, variant.highlight ? "highlight" : "plain"];
  if (variant.virtual) parts.push("virtual");
  return parts.join(" · ");
}
