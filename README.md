# Deal Verdict — integration snippets

**Add a $0.01 "is this actually a deal?" check to your shopping agent.**

Deal Verdict is a live x402 endpoint on Base, built for Black Friday,
Cyber Monday, and every checkout after:

```
POST https://x402-web-reader.vercel.app/api/deal-verdict
Body: { "product": "Apple AirPods Pro 2", "price": 189, "compareAtPrice": 249 }
Price: $0.01/call, USDC on Base — no API key, pay per call via x402
```

- `product` — product name or URL (required)
- `price` — the price your agent found (required)
- `compareAtPrice` — the claimed "was" price, if the listing shows one (optional)
- `url` — the product page URL (optional)

You get back one verdict:

```json
{
  "verdict": "real_deal | fake_discount | overpriced | fair",
  "lowestFound": { "price": 149, "sourceUrl": "https://…", "store": "…" },
  "typicalPrice": 219.99,
  "savingsVsTypical": 30.99,
  "sources": [ { "price": 189, "sourceUrl": "https://…", "store": "…" } ]
}
```

Prices come from live web search across major retailers, and every
price in the answer is cited with its source. If fewer than 3 priced
sources can be found, the endpoint returns HTTP 502 and the call is
**never charged** — no verdict is ever fabricated.

## Pick your framework

| Folder | What it is |
|---|---|
| `plain/` | Framework-agnostic client (`deal-verdict.mjs`). Includes a free dry-run that prints the 402 price challenge without paying. |
| `agentkit/` | Coinbase AgentKit snippet (`deal-verdict-agentkit.ts`). Uses the built-in `x402ActionProvider` — whitelist the service, call `checkDealBeforeBuy()` before checkout. |
| `elizaos/` | ElizaOS plugin (`plugin-deal-verdict`). One action, `CHECK_DEAL`: the character checks a price before buying and reports the verdict + lowest price found. |

## The gate rule (all frameworks)

```
verdict = check(product, price)
real_deal / fair          -> buy at this price
fake_discount / overpriced -> do NOT buy here — use lowestFound
```

## Why agents add it

A shopping agent that buys at a fake "sale" price wastes its user's
money — the exact failure its user hired it to avoid. One $0.01 check
before checkout compares the price against the live market and cites
its sources. On Black Friday and Cyber Monday, when thousands of
listings run inflated "was" prices, this is the difference between an
agent that finds deals and an agent that finds *ads*.

## Notes for builders

- Wallet: any EVM wallet with a small USDC float on Base. Payments are
  gas-free for the payer (x402 exact scheme, CDP facilitator).
- Discovery: `/.well-known/x402`, OpenAPI and an A2A agent card are
  published at `https://x402-web-reader.vercel.app`.
- Listed: Coinbase Bazaar (cataloged), Agent402, x402dash,
  agent-tools.cloud #3264.
- Sibling endpoint in the same service: Read-Lite — page → clean
  markdown, $0.005/call (`POST /api/read-lite`), for reading the
  product pages before you check their prices.

Questions / integration help: open an issue or reply to @FounderWilfred on X.
