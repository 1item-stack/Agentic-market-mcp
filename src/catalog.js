// Loads each store's public Shopify catalog (/products.json), normalises it
// to one schema and keeps it in memory with a TTL.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripHtml, normalize } from './text.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TTL_MS = Number(process.env.CATALOG_TTL_MINUTES || 15) * 60_000;
const MAX_PAGES = Number(process.env.CATALOG_MAX_PAGES || 20); // 250 products a page
const FIXTURE_DIR = process.env.CATALOG_FIXTURE_DIR || '';

let storesCache = null;
const catalogs = new Map(); // storeId -> { loadedAt, products, error }
const inflight = new Map();

export async function getStores() {
  if (!storesCache) {
    const file = process.env.STORES_FILE || path.join(ROOT, 'stores.json');
    storesCache = JSON.parse(await readFile(file, 'utf8')).filter((s) => s.active);
  }
  return storesCache;
}

async function fetchRaw(store) {
  if (FIXTURE_DIR) {
    const raw = JSON.parse(await readFile(path.join(FIXTURE_DIR, `${store.id}.json`), 'utf8'));
    return raw.products || [];
  }
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://${store.domain}/products.json?limit=250&page=${page}`;
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'agentic-market-mcp/0.1' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`${store.domain} answered ${res.status} for page ${page}`);
    const batch = (await res.json()).products || [];
    all.push(...batch);
    if (batch.length < 250) break;
  }
  return all;
}

function cleanTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return [...new Set(list.map((t) => String(t).trim()).filter(Boolean)
    .filter((t) => !/^store_/i.test(t))
    .map((t) => t.replace(/^category_/i, '').split('/').pop()))];
}

function toProduct(store, p) {
  const variants = (p.variants || []).map((v) => ({
    id: String(v.id),
    title: v.title === 'Default Title' ? null : v.title,
    price: Number(v.price),
    compareAtPrice: v.compare_at_price ? Number(v.compare_at_price) : null,
    available: v.available !== false,
    sku: v.sku || null,
  }));
  const prices = variants.map((v) => v.price).filter(Number.isFinite);
  const description = stripHtml(p.body_html);
  const tags = cleanTags(p.tags);
  const product = {
    id: `${store.id}:${p.id}`,
    storeId: store.id,
    storeName: store.name,
    title: p.title,
    type: p.product_type || null,
    vendor: p.vendor || null,
    tags,
    description,
    price: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    currency: store.currency,
    available: variants.some((v) => v.available),
    image: p.images?.[0]?.src || null,
    url: `https://${store.domain}/products/${encodeURIComponent(p.handle)}`,
    variants,
  };
  // Pre-normalised fields for search.
  product._n = {
    title: normalize(p.title),
    type: normalize(p.product_type),
    tags: normalize(tags.join(' ')),
    description: normalize(description),
  };
  return product;
}

async function load(store) {
  const raw = await fetchRaw(store);
  const products = raw.map((p) => toProduct(store, p));
  catalogs.set(store.id, { loadedAt: Date.now(), products, error: null });
  return products;
}

export async function getCatalog(store) {
  const cached = catalogs.get(store.id);
  if (cached && Date.now() - cached.loadedAt < TTL_MS) return cached.products;
  if (!inflight.has(store.id)) {
    inflight.set(store.id, load(store)
      .catch((err) => {
        // Serve the stale copy when a refresh fails; surface the error otherwise.
        if (cached) { cached.error = String(err.message || err); return cached.products; }
        throw err;
      })
      .finally(() => inflight.delete(store.id)));
  }
  return inflight.get(store.id);
}

// All products across the requested stores, plus which stores failed to load.
export async function getAllProducts(storeIds) {
  const stores = (await getStores()).filter((s) => !storeIds?.length || storeIds.includes(s.id));
  const settled = await Promise.allSettled(stores.map((s) => getCatalog(s)));
  const products = [];
  const failed = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') products.push(...r.value);
    else failed.push({ storeId: stores[i].id, error: String(r.reason?.message || r.reason) });
  });
  return { products, failed, stores };
}

export async function findProduct(productId) {
  const [storeId] = String(productId).split(':');
  const store = (await getStores()).find((s) => s.id === storeId);
  if (!store) return null;
  const products = await getCatalog(store);
  const product = products.find((p) => p.id === productId);
  return product ? { product, store } : null;
}

export function publicProduct(p, { full = false } = {}) {
  const out = {
    id: p.id,
    store: p.storeName,
    title: p.title,
    type: p.type,
    price: p.price,
    priceMax: p.priceMax !== p.price ? p.priceMax : undefined,
    currency: p.currency,
    available: p.available,
    url: p.url,
    image: p.image,
    tags: p.tags.slice(0, 8),
    description: full ? p.description : p.description.slice(0, 220),
  };
  if (full) out.variants = p.variants;
  return out;
}
