// Deal Verdict — plain x402 client (framework-agnostic)
// ======================================================
// Send a product + the price your agent found, get a verdict back:
//   { verdict: "real_deal" | "fake_discount" | "overpriced" | "fair",
//     lowestFound: { price, sourceUrl, store }, typicalPrice,
//     savingsVsTypical, sources: [...] }
//
// Price: $0.01/call, USDC on Base, paid via x402. No API key.
// Endpoint: https://x402-web-reader.vercel.app/api/deal-verdict
//
// Install:  npm i @x402/fetch @x402/evm viem
// Run:      EVM_PRIVATE_KEY=0x... node deal-verdict.mjs "Apple AirPods Pro 2" 189 249
// No key?   Free dry-run: sends the unpaid request, prints the 402
//           payment challenge (price / network / payTo), pays nothing.
//
// Built for shopping agents: call it BEFORE checkout, every time.

import { privateKeyToAccount } from "viem/accounts";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

export const DEAL_VERDICT_URL = "https://x402-web-reader.vercel.app/api/deal-verdict";
export const DEAL_VERDICT_PRICE_USD = 0.01;

/**
 * Check whether a price is a real deal.
 * @param {{product: string, price: number, url?: string, compareAtPrice?: number}} input
 *   product: product name or product URL (required)
 *   price: the price your agent found, in USD (required)
 *   compareAtPrice: the claimed "was" / list price, if the listing shows one
 * @param {import("viem").Account} signer  viem account holding USDC on Base
 */
export async function getDealVerdict(input, signer) {
  const client = new x402Client();
  registerExactEvmScheme(client, { signer });
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  const res = await fetchWithPayment(DEAL_VERDICT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    // 502 = not enough priced sources to judge. x402 does not settle
    // on a failed response — you are never charged for it.
    throw new Error(`Deal Verdict failed: HTTP ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * The pre-checkout gate:
 * real_deal / fair => buy at this price.
 * fake_discount / overpriced => do NOT buy here — check lowestFound.
 */
export function shouldBuyAtThisPrice(card) {
  return card.verdict === "real_deal" || card.verdict === "fair";
}

// --- CLI / dry-run ---------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const product = process.argv[2] || "Apple AirPods Pro 2";
  const price = Number(process.argv[3] || 189);
  const compareAtPrice = process.argv[4] ? Number(process.argv[4]) : undefined;
  const key = process.env.EVM_PRIVATE_KEY;

  if (!key) {
    console.log("No EVM_PRIVATE_KEY set — dry run only, nothing will be paid.");
    const res = await fetch(DEAL_VERDICT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product, price, compareAtPrice }),
    });
    console.log("HTTP status:", res.status, "(402 = payment challenge, as expected)");
    const challenge = res.headers.get("payment-required");
    if (challenge) {
      const decoded = JSON.parse(Buffer.from(challenge, "base64").toString("utf8"));
      const option = decoded.accepts?.[0] ?? {};
      console.log("Price:", option.amount, "atomic USDC =", `$${Number(option.amount) / 1e6}`);
      console.log("Network:", option.network, "| Pay to:", option.payTo);
    }
    process.exit(0);
  }

  const signer = privateKeyToAccount(key);
  const card = await getDealVerdict({ product, price, compareAtPrice }, signer);
  console.log(JSON.stringify(card, null, 2));
  console.log("Buy at this price:", shouldBuyAtThisPrice(card));
  if (!shouldBuyAtThisPrice(card) && card.lowestFound) {
    console.log("Cheaper at:", card.lowestFound.store, card.lowestFound.sourceUrl);
  }
}
