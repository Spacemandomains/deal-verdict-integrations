// Deal Verdict for Coinbase AgentKit — pre-checkout deal check
// =============================================================
// Add a $0.01 "is this actually a deal?" check to any AgentKit
// shopping agent on Base, right before it buys.
//
//   Input : { product, price, compareAtPrice? }
//   Output: { verdict: "real_deal" | "fake_discount" | "overpriced"
//             | "fair", lowestFound, typicalPrice, sources[] }
//
// AgentKit's x402ActionProvider reads the 402, pays USDC from the
// agent wallet, and retries — no API key, no payment code to write.
//
// Install:  npm i @coinbase/agentkit viem
// Run:      EVM_PRIVATE_KEY=0x... npx tsx deal-verdict-agentkit.ts "Apple AirPods Pro 2" 189
//
// SPEND SAFETY: make_http_request_with_x402 pays whatever the 402
// asks — keep only a small USDC float in the agent wallet, and note
// the whitelist + $0.01 cap set below.

import { AgentKit, ViemWalletProvider, x402ActionProvider } from "@coinbase/agentkit";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

export const DEAL_VERDICT_URL = "https://x402-web-reader.vercel.app/api/deal-verdict";
export const DEAL_VERDICT_PRICE_USD = 0.01;

export async function createDealVerdictAgentKit(privateKey: `0x${string}`) {
  const walletClient = createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: base,
    transport: http(),
  });
  const walletProvider = new ViemWalletProvider(walletClient);
  const agentkit = await AgentKit.from({
    walletProvider,
    actionProviders: [
      x402ActionProvider({
        registeredServices: ["https://x402-web-reader.vercel.app"],
        maxPaymentUsdc: DEAL_VERDICT_PRICE_USD,
      } as any),
    ],
  });
  return { agentkit, walletProvider };
}

/**
 * Direct call (no LLM): pay $0.01, return { allowed, card }.
 * allowed = buy at this price (real_deal / fair).
 * On fake_discount / overpriced, card.lowestFound shows where it is
 * actually cheaper.
 */
export async function checkDealBeforeBuy(
  agentkit: AgentKit,
  input: { product: string; price: number; url?: string; compareAtPrice?: number },
): Promise<{ allowed: boolean; card: any }> {
  const action = agentkit
    .getActions()
    .find((a) => a.name.endsWith("make_http_request_with_x402"));
  if (!action) throw new Error("x402 action not found — is x402ActionProvider loaded?");

  const raw = await action.invoke({
    url: DEAL_VERDICT_URL,
    method: "POST",
    body: input,
  } as any);

  const card = typeof raw === "string" ? JSON.parse(raw) : raw;
  const verdict = card?.verdict ?? card?.data?.verdict;
  return { allowed: verdict === "real_deal" || verdict === "fair", card };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const product = process.argv[2] || "Apple AirPods Pro 2";
  const price = Number(process.argv[3] || 189);
  const key = process.env.EVM_PRIVATE_KEY as `0x${string}`;
  if (!key) throw new Error("Set EVM_PRIVATE_KEY (agent wallet, USDC on Base)");

  const { agentkit } = await createDealVerdictAgentKit(key);
  const { allowed, card } = await checkDealBeforeBuy(agentkit, { product, price });
  console.log(JSON.stringify(card, null, 2));
  console.log(
    allowed
      ? "DEAL GATE: PASS — buy at this price."
      : `DEAL GATE: BLOCKED — do not buy here. Lowest found: ${card?.lowestFound?.price} at ${card?.lowestFound?.sourceUrl}`,
  );

  // With an LLM: hand `agentkit` to @coinbase/agentkit-langchain and
  // put this in the system prompt:
  //   "Before buying any product, call make_http_request_with_x402
  //    with a POST to https://x402-web-reader.vercel.app/api/deal-verdict
  //    and body {\"product\": \"<name>\", \"price\": <found price>,
  //    \"compareAtPrice\": <claimed was-price if shown>}. It costs
  //    $0.01. Buy only if the verdict is real_deal or fair. If it is
  //    fake_discount or overpriced, do not buy at that price — show
  //    the user lowestFound instead."
}
