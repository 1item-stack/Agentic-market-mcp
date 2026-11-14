# Agentic Market MCP (prototype)

A headless marketplace for AI agents: one remote MCP server that searches
several Shopify stores and hands back a tracked checkout link on the
merchant's own site.

## Tools
| Tool | What it does |
| --- | --- |
| `list_stores` | Stores in the marketplace and product counts |
| `search_products` | Free-text search (Hebrew or English), price range, store filter |
| `get_product` | Full description and every variant |
| `create_checkout_link` | Cart link per store, with a tracking ref for commission |

## Run
    npm install
    npm start          # http://localhost:3000/mcp
    npm test           # end-to-end test on fixtures

## Add a store
Edit `stores.json`. Any Shopify store whose `/products.json` is public works:
    { "id": "mystore", "name": "My Store", "domain": "mystore.co.il",
      "currency": "ILS", "description": "...", "commissionPct": 12, "active": true }

## Deploy
Any Node 20+ host with a public HTTPS URL (Render, Railway, Fly.io):
start command `npm start`, the host sets `PORT`. Then add
`https://<your-host>/mcp` as a custom connector in Claude or ChatGPT.

## Attribution
Each checkout link carries a cart attribute `agentic_ref`. Shopify saves it on
the order (note attributes), so a sale can be matched to the link. Every link
is also written to stdout as one JSON line (`"event":"checkout_link"`).

## Not in this prototype
- Non-Shopify stores (needs a product-feed importer)
- Order confirmation webhook and commission invoicing
- Semantic search (this version is keyword search with Hebrew prefix and plural handling)
- Product-card UI (MCP App), rate limiting, persistent storage
