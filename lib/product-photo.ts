// A sold car's photo: the storefront product whose name shares the most words with the order's model (at least 2).
export type ProductPhoto = { id: string; name: string; image: string };

const words = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !["diecast", "model", "car", "1", "18", "the"].includes(w)));

export function photoFor(products: ProductPhoto[], model: string): string {
  const w = words(model);
  let best: ProductPhoto | null = null, score = 1;
  for (const p of products) {
    const n = Array.from(words(p.name)).filter((x) => w.has(x)).length;
    if (n > score) { best = p; score = n; }
  }
  return best?.image ?? "";
}
