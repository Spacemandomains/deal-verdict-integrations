// CHECK_DEAL — ElizaOS action for Deal Verdict
// ==============================================
// Before the character buys anything, it checks the deal: POST the
// product + found price to Deal Verdict ($0.01/call, USDC on Base via
// x402) and get back real_deal / fake_discount / overpriced / fair,
// the lowest price found elsewhere, and cited sources.
//
// Payment is handled inside the handler with @x402/fetch. The agent's
// EVM key comes from the character settings (EVM_PRIVATE_KEY) or the
// environment. Keep only a small USDC float in that wallet: each
// check costs exactly $0.01, and a failed check (HTTP 502 — too few
// priced sources) is never settled / never charged.

import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
} from "@elizaos/core";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

export const DEAL_VERDICT_URL = "https://x402-web-reader.vercel.app/api/deal-verdict";

async function fetchDealVerdict(
  input: { product: string; price: number; compareAtPrice?: number },
  privateKey: string,
) {
  const signer = privateKeyToAccount(privateKey as `0x${string}`);
  const client = new x402Client();
  registerExactEvmScheme(client, { signer });
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  const res = await fetchWithPayment(DEAL_VERDICT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Deal Verdict HTTP ${res.status}`);
  return res.json();
}

export const checkDealAction: Action = {
  name: "CHECK_DEAL",
  similes: ["DEAL_VERDICT", "IS_THIS_A_DEAL", "CHECK_PRICE"],
  description:
    "Check whether a price is a real deal BEFORE buying. Costs $0.01 " +
    "via x402. Send a product name and the price found; returns " +
    "real_deal / fake_discount / overpriced / fair, the lowest price " +
    "found elsewhere, the typical price, and cited sources. Use " +
    "whenever a purchase, checkout, or Black Friday / Cyber Monday " +
    "deal is being considered.",

  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message.content?.text ?? "").toLowerCase();
    return /\$\s?\d/.test(text) || text.includes("deal") || text.includes("buy");
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback,
  ) => {
    const text = message.content?.text ?? "";
    // Price = the LAST $ amount in the message (the found price);
    // an earlier $ amount, if any, is treated as the "was" price.
    const amounts = [...text.matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g)].map((m) =>
      Number(m[1].replace(/,/g, "")),
    );
    if (amounts.length === 0) {
      await callback?.({
        text: "Tell me the product and the price you found (e.g. \"AirPods Pro 2 for $189, was $249\") and I'll check if it's a real deal for $0.01.",
      });
      return { success: false, error: "no_price" } as any;
    }
    const price = amounts[amounts.length - 1];
    const compareAtPrice = amounts.length > 1 ? amounts[0] : undefined;
    const product =
      text
        .replace(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g, "")
        .replace(/\b(check|deal|buy|for|was|is this a|please)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim() || "product";

    const privateKey =
      (runtime.getSetting?.("EVM_PRIVATE_KEY") as string) || process.env.EVM_PRIVATE_KEY;
    if (!privateKey) {
      await callback?.({
        text: "Deal Verdict is not configured: set EVM_PRIVATE_KEY (a wallet with a small USDC float on Base) in the character settings.",
      });
      return { success: false, error: "no_key" } as any;
    }

    try {
      const card: any = await fetchDealVerdict({ product, price, compareAtPrice }, privateKey);
      const buy = card.verdict === "real_deal" || card.verdict === "fair";
      const reply =
        `Deal Verdict for ${card.product ?? product} at $${price}: **${card.verdict}**\n` +
        `Lowest found: $${card.lowestFound?.price} (${card.lowestFound?.store ?? "source"})\n` +
        `Typical price: $${card.typicalPrice} — you save $${card.savingsVsTypical} vs typical\n` +
        (buy
          ? "Gate: OK to buy at this price."
          : "Gate: do NOT buy at this price — use the lowest-found source instead.");
      await callback?.({ text: reply, actions: ["CHECK_DEAL"] });
      return { success: true, data: card } as any;
    } catch (err) {
      await callback?.({
        text: "I couldn't get a verdict — not enough priced sources right now, and a failed check is never charged. Try again shortly.",
      });
      return { success: false, error: String(err) } as any;
    }
  },

  examples: [
    [
      {
        name: "user",
        content: { text: "Found AirPods Pro 2 for $189, was $249 — good deal?" },
      },
      {
        name: "agent",
        content: { text: "Checking that price before you buy — one moment.", actions: ["CHECK_DEAL"] },
      },
    ],
  ] as any,
};
