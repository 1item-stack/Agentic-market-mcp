// End-to-end check: starts the server on fixtures and calls every tool
// through a real MCP client over Streamable HTTP.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3911;
const child = spawn('node', [path.join(here, '../src/server.js')], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1',
    CATALOG_FIXTURE_DIR: path.join(here, 'fixtures'), STORES_FILE: path.join(here, 'stores.test.json') },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let log = '';
child.stdout.on('data', (d) => { log += d; });
await new Promise((r) => setTimeout(r, 900));

const call = async (client, name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  return { isError: !!res.isError, data: res.isError ? res.content[0].text : JSON.parse(res.content[0].text) };
};

let failed = false;
try {
  const client = new Client({ name: 'e2e', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));

  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map((t) => t.name).sort(), ['create_checkout_link', 'get_product', 'list_stores', 'search_products']);
  assert.ok(tools.every((t) => t.title && t.annotations?.readOnlyHint === true), 'every tool has a title and readOnlyHint');

  const stores = await call(client, 'list_stores');
  assert.equal(stores.data.stores.find((s) => s.id === '1item').products, 5);
  assert.equal(stores.data.unavailable[0].storeId, 'broken', 'a store that fails to load is reported, not fatal');

  // Hebrew prefix and plural: "לאגרטלים" should find vases; price cap removes the 129 one.
  const vases = await call(client, 'search_products', { query: 'אגרטלים לבנים', max_price: 100 });
  assert.equal(vases.data.results[0].title, 'אגרטל קרמיקה לבן מט');
  assert.ok(vases.data.results.every((p) => p.price <= 100));
  assert.ok(!vases.data.results.some((p) => p.title.includes('זכוכית')), 'price cap applied');
  assert.equal(vases.data.results[0].tags.includes('Store_he'), false, 'internal tags hidden');

  const gift = await call(client, 'search_products', { query: 'מתנה לחנוכת בית' });
  assert.equal(gift.data.results[0].title.startsWith('בית מזוזה'), true);

  const oos = await call(client, 'search_products', { query: 'פמפס' });
  assert.equal(oos.data.total_matches, 0, 'out of stock hidden by default');
  const oosShown = await call(client, 'search_products', { query: 'פמפס', in_stock_only: false });
  assert.equal(oosShown.data.total_matches, 1);

  const none = await call(client, 'search_products', { query: 'מקרר' });
  assert.equal(none.data.total_matches, 0);

  const vase = await call(client, 'get_product', { product_id: '1item:1002' });
  assert.equal(vase.data.variants.length, 2);
  assert.equal(vase.data.price, 49);
  const missing = await call(client, 'get_product', { product_id: '1item:999' });
  assert.equal(missing.isError, true);

  // Default variant = first in stock (the large one, 89), quantity 2, plus the mezuzah.
  const link = await call(client, 'create_checkout_link', {
    items: [{ product_id: '1item:1002', quantity: 2 }, { product_id: '1item:1004' }], channel: 'Claude' });
  const l = link.data.links[0];
  const url = new URL(l.checkout_url);
  assert.equal(url.hostname, '1item.co.il');
  assert.equal(url.pathname, '/cart/5003:2,5005:1');
  assert.equal(url.searchParams.get('attributes[agentic_ref]'), l.ref);
  assert.equal(url.searchParams.get('utm_campaign'), 'claude');
  assert.equal(l.items_total, 237);
  // The log line travels over a pipe, so give it a moment to arrive.
  for (let i = 0; i < 20 && !log.includes(`"ref":"${l.ref}"`); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(log.includes(`"ref":"${l.ref}"`), 'click written to the ledger log');

  const badLink = await call(client, 'create_checkout_link', { items: [{ product_id: '1item:1005' }] });
  assert.equal(badLink.isError, true, 'out-of-stock item gives no link');

  await client.close();
  console.log('PASS: 4 tools, all checks');
} catch (err) {
  failed = true;
  console.error('FAIL', err);
} finally {
  child.kill();
  process.exit(failed ? 1 : 0);
}
