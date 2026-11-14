import { tokens, variants } from './text.js';

const WEIGHTS = { title: 5, type: 4, tags: 3, description: 1 };

export function search(products, { query, minPrice, maxPrice, inStockOnly = true, limit = 8 }) {
  const qTokens = tokens(query).map(variants);
  const results = [];
  for (const p of products) {
    if (inStockOnly && !p.available) continue;
    if (p.price == null) continue;
    if (maxPrice != null && p.price > maxPrice) continue;
    if (minPrice != null && p.price < minPrice) continue;
    let score = 0;
    let matched = 0;
    for (const forms of qTokens) {
      let best = 0;
      for (const [field, weight] of Object.entries(WEIGHTS)) {
        if (weight <= best) continue;
        if (forms.some((f) => p._n[field].includes(f))) best = weight;
      }
      if (best) matched++;
      score += best;
    }
    if (qTokens.length && !matched) continue;
    if (qTokens.length && matched === qTokens.length) score += 4; // every word matched
    results.push({ p, score, matched });
  }
  results.sort((a, b) => b.score - a.score || a.p.price - b.p.price);
  return { total: results.length, items: results.slice(0, limit).map((r) => r.p) };
}
