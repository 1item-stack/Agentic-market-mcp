// Text helpers: HTML stripping and Hebrew-aware tokenising for search.

const FINALS = { 'ם': 'מ', 'ן': 'נ', 'ץ': 'צ', 'ף': 'פ', 'ך': 'כ' };
const PREFIXES = ['ה', 'ו', 'ב', 'ל', 'מ', 'ש', 'כ'];

export function stripHtml(html = '') {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalize(s = '') {
  return String(s)
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '') // niqqud and cantillation
    .replace(/[םןץףך]/g, (c) => FINALS[c])
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function tokens(s = '') {
  return normalize(s).split(' ').filter((t) => t.length > 1);
}

// Variants of a query token: as typed, without a one-letter Hebrew prefix,
// and without a plural suffix. Lets "לאגרטלים" match "אגרטל".
export function variants(token) {
  const out = new Set([token]);
  const isHebrew = /[א-ת]/.test(token);
  if (!isHebrew) return [...out];
  let bases = [token];
  if (token.length > 3 && PREFIXES.includes(token[0])) bases.push(token.slice(1));
  for (const b of bases) {
    out.add(b);
    if (b.length > 4 && (b.endsWith('ימ') || b.endsWith('ות'))) out.add(b.slice(0, -2));
  }
  // Derived stems shorter than three letters match too much, so drop them.
  return [...out].filter((t) => t === token || t.length > 2);
}
